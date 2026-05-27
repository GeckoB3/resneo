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
        stripe_customer_id: session.customer as string,
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
      })
      .select('id')
      .single();

    if (venueError || !venue) {
      console.error('[signup/complete] Venue creation failed:', venueError);
      return NextResponse.json({ error: 'Failed to complete signup. Please contact support.' }, { status: 500 });
    }

    const { error: staffError } = await admin.from('staff').insert({
      venue_id: venue.id,
      email: user.email,
      name: user.email?.split('@')[0] ?? 'Admin',
      role: 'admin',
    });

    if (staffError) {
      console.error('[signup/complete] Staff creation failed:', staffError);
      return NextResponse.json({ error: 'Failed to complete signup. Please contact support.' }, { status: 500 });
    }

    await updateVenueSmsMonthlyAllowance(venue.id);

    // Referral programme: if the venue signed up via a referral link, mark the
    // referrals row as referee_signed_up. Idempotent — the webhook path runs the
    // same call. We do NOT eagerly create the referrer's own referral_codes row
    // here: the venue's name is still "My Business" at this point. The Refer & Earn
    // page creates it lazily once the user has completed onboarding and renamed.
    try {
      const referralCodeFromSession = session.metadata?.referral_code?.trim() || null;
      if (referralCodeFromSession) {
        await attachReferralOnSignup({
          admin,
          referralCode: referralCodeFromSession,
          referredVenueId: venue.id,
          refereeEmail: ownerEmail,
        });
      }
    } catch (e) {
      console.error('[signup/complete] referral wiring failed (non-fatal):', e);
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
