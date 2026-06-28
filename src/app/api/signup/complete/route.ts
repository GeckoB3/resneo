import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { getPersistedSubscriptionItemIds } from '@/lib/stripe/subscription-line-items';
import {
  mapStripeSubscriptionToPlanStatus,
  subscriptionPeriodEndIso,
  subscriptionPeriodStartIso,
} from '@/lib/stripe/subscription-fields';
import { getBusinessConfig } from '@/lib/business-config';
import { updateVenueSmsMonthlyAllowance } from '@/lib/billing/sms-allowance';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import { parseNotificationSettings } from '@/lib/notifications/notification-settings';
import { clearSignupPendingUserMetadata } from '@/lib/signup-pending-metadata';
import { isAppointmentPlanTier } from '@/lib/tier-enforcement';
import { DEFAULT_VENUE_BOOKING_LOG_EMAIL_CONFIG } from '@/lib/reports/booking-log-email-config';
import { attachReferralOnSignup } from '@/lib/referrals/attach-on-signup';
import { attachSalesAttributionOnSignup } from '@/lib/sales/attach-on-signup';
import { sendNewSignupNotification } from '@/lib/emails/internal-signup-notification';
import { sendWelcomeEmail } from '@/lib/emails/welcome-email';
import { SESSION_TIMEOUT_DEFAULT_MINUTES } from '@/lib/session-timeout';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { session_id } = body as { session_id: string };

    if (!session_id) {
      return NextResponse.json({ error: 'Missing session_id' }, { status: 400 });
    }

    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['subscription'],
    });

    if (session.payment_status !== 'paid' && session.status !== 'complete') {
      return NextResponse.json({ error: 'Payment not completed' }, { status: 400 });
    }

    // Verify checkout session belongs to the authenticated user.
    const metadataUserId = session.metadata?.supabase_user_id?.trim() || null;
    const authEmail = (user.email ?? '').trim().toLowerCase();
    const sessionEmail =
      (session.customer_details?.email ?? session.customer_email ?? '').trim().toLowerCase() || null;
    const ownershipByMetadata = metadataUserId !== null && metadataUserId === user.id;
    const ownershipByEmail = Boolean(authEmail) && sessionEmail !== null && sessionEmail === authEmail;
    if (!ownershipByMetadata && !ownershipByEmail) {
      return NextResponse.json({ error: 'Session does not belong to this user' }, { status: 403 });
    }

    const admin = getSupabaseAdminClient();

    // Check if venue already exists for this user (idempotency)
    const { data: existingStaff } = await admin
      .from('staff')
      .select('venue_id')
      .ilike('email', (user.email ?? '').toLowerCase().trim())
      .order('venue_id', { ascending: true })
      .limit(10);

    if (existingStaff && existingStaff.length > 0) {
      const venueId = existingStaff[0]?.venue_id;
      if (venueId) {
        const { data: existingVenue } = await admin
          .from('venues')
          .select('pricing_tier, active_booking_models, onboarding_completed')
          .eq('id', venueId)
          .maybeSingle();
        const activeModels = Array.isArray(existingVenue?.active_booking_models)
          ? existingVenue.active_booking_models
          : [];
        if (
          isAppointmentPlanTier(existingVenue?.pricing_tier) &&
          activeModels.length === 0 &&
          existingVenue?.onboarding_completed !== true
        ) {
          await clearSignupPendingUserMetadata(admin, user.id);
          return NextResponse.json({ redirect_url: '/signup/booking-models' });
        }
      }
      await clearSignupPendingUserMetadata(admin, user.id);
      return NextResponse.json({ redirect_url: '/onboarding' });
    }

    const metadata = session.metadata ?? {};
    const businessType = metadata.business_type ?? (metadata.plan === 'appointments' ? 'other' : 'other');
    const plan = metadata.plan ?? 'appointments';
    const config = getBusinessConfig(businessType);

    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription && typeof session.subscription === 'object'
          ? session.subscription.id
          : null;

    let mainSubscriptionItemId: string | null = null;
    let smsSubscriptionItemId: string | null = null;
    let periodStartIso: string | null = null;
    let periodEndIso: string | null = null;
    let planStatus: 'active' | 'trialing' | 'past_due' | 'cancelled' | 'cancelling' = 'active';
    if (subscriptionId) {
      try {
        const subFull = await stripe.subscriptions.retrieve(subscriptionId);
        const ids = getPersistedSubscriptionItemIds(subFull);
        mainSubscriptionItemId = ids.mainSubscriptionItemId;
        smsSubscriptionItemId = ids.smsSubscriptionItemId;
        periodStartIso = subscriptionPeriodStartIso(subFull);
        periodEndIso = subscriptionPeriodEndIso(subFull);
        planStatus = mapStripeSubscriptionToPlanStatus(subFull);
      } catch (e) {
        console.warn('[signup/complete] Could not load subscription items:', e);
      }
    }

    const slug = `venue-${Date.now()}`;

    // Do not send active_booking_models here: older databases may not have the column yet.
    // When the column exists (migration applied), NOT NULL DEFAULT '[]'::jsonb matches
    // appointments post-payment (choose models next) and resolves correctly for restaurant via booking_model.
    const ownerEmail = (user.email ?? '').trim().toLowerCase() || null;
    const stripeCustomerId = session.customer as string;

    const { data: venue, error: venueError } = await admin
      .from('venues')
      .insert({
        name: 'My Business',
        slug,
        booking_model: config.model,
        business_type: businessType,
        business_category: config.category,
        terminology: config.terms,
        pricing_tier: plan,
        plan_status: planStatus,
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: subscriptionId,
        stripe_subscription_item_id: mainSubscriptionItemId,
        stripe_sms_subscription_item_id: smsSubscriptionItemId,
        subscription_current_period_start: periodStartIso,
        subscription_current_period_end: periodEndIso,
        calendar_count: null,
        onboarding_step: 0,
        onboarding_completed: false,
        appointments_onboarding_unified_flow: isAppointmentPlanTier(plan),
        email: ownerEmail,
        daily_booking_log_email_config: DEFAULT_VENUE_BOOKING_LOG_EMAIL_CONFIG,
        session_timeout_minutes: SESSION_TIMEOUT_DEFAULT_MINUTES,
      })
      .select('id')
      .single();

    if (venueError || !venue) {
      // A concurrent provisioning path (the subscription webhook) won the race and already
      // created this venue under the same Stripe customer — the partial unique index on
      // venues.stripe_customer_id surfaces that as 23505. Re-read the winner and resume the
      // funnel rather than erroring; the webhook also created the staff row + attribution.
      // Guard on the venue actually existing under our customer id: venues.slug is also UNIQUE,
      // so a same-millisecond signup by a different customer can raise 23505 on the slug — that
      // is not our race, and must fall through to the error (the user retries with a fresh slug).
      if (venueError?.code === '23505') {
        const { data: racedVenue } = await admin
          .from('venues')
          .select('pricing_tier, active_booking_models, onboarding_completed')
          .eq('stripe_customer_id', stripeCustomerId)
          .maybeSingle();
        if (racedVenue) {
          await clearSignupPendingUserMetadata(admin, user.id);
          return NextResponse.json({ redirect_url: resolvePostSignupRedirectUrl(racedVenue) });
        }
      }
      console.error('[signup/complete] Venue creation failed:', venueError);
      return NextResponse.json({ error: 'Failed to complete signup. Please contact support.' }, { status: 500 });
    }

    const { error: staffError } = await admin.from('staff').insert({
      venue_id: venue.id,
      email: user.email,
      name: user.email?.split('@')[0] ?? 'Admin',
      role: 'admin',
      // Durable auth link: identity resolution prefers user_id over the
      // fragile email match, which breaks when the sign-in email changes.
      user_id: user.id,
    });

    if (staffError) {
      console.error('[signup/complete] Staff creation failed:', staffError);
      return NextResponse.json({ error: 'Failed to complete signup. Please contact support.' }, { status: 500 });
    }

    await updateVenueSmsMonthlyAllowance(venue.id);

    // Internal heads-up that a new account just signed up. Only this guarded
    // creation path (or the webhook's — whichever ran first) sends it, and a
    // send failure never fails the signup.
    await sendNewSignupNotification({
      signupEmail: ownerEmail,
      plan,
      businessType,
      planStatus,
      venueId: venue.id,
      referralCode: session.metadata?.referral_code?.trim() || null,
      source: 'signup_complete',
    });

    // Friendly customer welcome from hello@resneo.com (reply-to hello@). Sits beside the internal
    // notification so it sends once per signup. Never throws, so it cannot fail the signup.
    await sendWelcomeEmail({ to: ownerEmail });

    // Referral programme: if the venue signed up via a referral link, mark the
    // referrals row as referee_signed_up. Idempotent — the webhook path runs the
    // same call. We do NOT eagerly create the referrer's own referral_codes row
    // here: the venue's name is still "My Business" at this point. The Refer & Earn
    // page creates it lazily once the user has completed onboarding and renamed.
    try {
      const salesCodeFromSession = session.metadata?.sales_code?.trim() || null;
      if (salesCodeFromSession) {
        await attachSalesAttributionOnSignup({
          admin,
          salesCode: salesCodeFromSession,
          referredVenueId: venue.id,
          refereeEmail: ownerEmail,
          refereeUserId: user.id,
        });
      } else {
        const referralCodeFromSession = session.metadata?.referral_code?.trim() || null;
        if (referralCodeFromSession) {
          await attachReferralOnSignup({
            admin,
            referralCode: referralCodeFromSession,
            referredVenueId: venue.id,
            refereeEmail: ownerEmail,
          });
        }
      }
    } catch (e) {
      console.error('[signup/complete] sales/referral wiring failed (non-fatal):', e);
    }

    /** Unified appointment venues: use default notification_settings (email-only confirmation; SMS/reminder 2/no-show opt-in). */
    if (isUnifiedSchedulingVenue(config.model)) {
      const notification_settings = parseNotificationSettings(null);
      const { error: notifErr } = await admin
        .from('venues')
        .update({ notification_settings: notification_settings as unknown as Record<string, never> })
        .eq('id', venue.id);
      if (notifErr) {
        console.warn('[signup/complete] Could not set default notification_settings for unified venue:', notifErr);
      }
    }

    await clearSignupPendingUserMetadata(admin, user.id);

    return NextResponse.json({
      redirect_url: isAppointmentPlanTier(plan) ? '/signup/booking-models' : '/onboarding',
    });
  } catch (err) {
    console.error('[signup/complete] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Where to send the user once their venue is provisioned (or found already-provisioned).
 * Appointment-plan venues that haven't picked booking models yet go to the model picker;
 * everything else goes to onboarding. Pure function of the venue row so the fresh-insert,
 * already-exists, and race-lost branches stay in lockstep.
 */
function resolvePostSignupRedirectUrl(
  venue: {
    pricing_tier?: string | null;
    active_booking_models?: unknown;
    onboarding_completed?: boolean | null;
  } | null,
): string {
  const activeModels = Array.isArray(venue?.active_booking_models) ? venue.active_booking_models : [];
  if (
    isAppointmentPlanTier(venue?.pricing_tier) &&
    activeModels.length === 0 &&
    venue?.onboarding_completed !== true
  ) {
    return '/signup/booking-models';
  }
  return '/onboarding';
}
