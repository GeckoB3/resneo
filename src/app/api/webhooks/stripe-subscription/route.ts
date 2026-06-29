import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getBusinessConfig } from '@/lib/business-config';
import {
  mapStripeSubscriptionToPlanStatus,
  subscriptionCancelAtIso,
  subscriptionPeriodEndIso,
  subscriptionPeriodStartIso,
} from '@/lib/stripe/subscription-fields';
import {
  findMainPlanSubscriptionItem,
  getPersistedSubscriptionItemIds,
} from '@/lib/stripe/subscription-line-items';
import { updateVenueSmsMonthlyAllowance } from '@/lib/billing/sms-allowance';
import { handleLightPaymentMethodUpdateFromSetup } from '@/lib/stripe/light-past-due-payment-webhook';
import { pauseSubscriptionOnTrialEndPaymentFailure, getStripeInvoiceSubscriptionId } from '@/lib/stripe/trial-end-payment';
import { communicationPoliciesEmailOnlyAppointmentsLane } from '@/lib/communications/policies';
import { defaultNotificationSettingsForLightPlan } from '@/lib/notifications/notification-settings';
import { isAppointmentPlanTier } from '@/lib/tier-enforcement';
import { DEFAULT_VENUE_BOOKING_LOG_EMAIL_CONFIG } from '@/lib/reports/booking-log-email-config';
import {
  claimStripeWebhookEvent,
  releaseStripeWebhookEvent,
} from '@/lib/webhooks/stripe-event-idempotency';
import { attachReferralOnSignup } from '@/lib/referrals/attach-on-signup';
import { sendNewSignupNotification } from '@/lib/emails/internal-signup-notification';
import { sendWelcomeEmail } from '@/lib/emails/welcome-email';
import {
  maybeCreditReferrerForInvoice,
  markReferralsFailedForReferee,
} from '@/lib/referrals/credit-referrer';
import { attachSalesAttributionOnSignup } from '@/lib/sales/attach-on-signup';
import { clearSignupPendingUserMetadata } from '@/lib/signup-pending-metadata';
import { escapeLikePattern } from '@/lib/db/like-escape';
import { recordSalesInvoiceRevenue } from '@/lib/sales/invoice-revenue';
import { syncSalesAttributionWithPlanStatus } from '@/lib/sales/churn';
import { recordPlatformInvoice } from '@/lib/platform/invoices';

/**
 * Configure in Stripe Dashboard: endpoint URL /api/webhooks/stripe-subscription,
 * events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted,
 * invoice.payment_succeeded, invoice.payment_failed. Secret: STRIPE_ONBOARDING_WEBHOOK_SECRET.
 */
const webhookSecret = process.env.STRIPE_ONBOARDING_WEBHOOK_SECRET;
if (!webhookSecret) {
  console.warn('STRIPE_ONBOARDING_WEBHOOK_SECRET is not set; subscription webhook verification will fail');
}

const PRICE_TIER_ENV_KEYS: Array<{ envKey: string; tier: 'appointments' | 'plus' | 'restaurant' | 'light' }> = [
  { envKey: 'STRIPE_APPOINTMENTS_PRO_PRICE_ID', tier: 'appointments' },
  { envKey: 'STRIPE_STANDARD_PRICE_ID', tier: 'appointments' },
  { envKey: 'STRIPE_APPOINTMENTS_PLUS_PRICE_ID', tier: 'plus' },
  { envKey: 'STRIPE_PLUS_PRICE_ID', tier: 'plus' },
  { envKey: 'STRIPE_RESTAURANT_PRICE_ID', tier: 'restaurant' },
  { envKey: 'STRIPE_FOUNDING_PRICE_ID', tier: 'restaurant' },
  { envKey: 'STRIPE_LIGHT_PRICE_ID', tier: 'light' },
];

function buildPriceToTierMapping(): Record<string, 'appointments' | 'plus' | 'restaurant' | 'light'> {
  const out: Record<string, 'appointments' | 'plus' | 'restaurant' | 'light'> = {};
  for (const { envKey, tier } of PRICE_TIER_ENV_KEYS) {
    const id = process.env[envKey]?.trim();
    if (id) out[id] = tier;
  }
  return out;
}

export async function POST(request: NextRequest) {
  let event: Stripe.Event;

  try {
    const rawBody = await request.text();
    const sig = request.headers.get('stripe-signature');
    if (!sig) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
    }
    if (!webhookSecret) {
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
    }
    event = Stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Subscription webhook] Signature verification failed:', message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();

  const claim = await claimStripeWebhookEvent(
    supabase,
    event.id,
    event.type,
    '[Subscription webhook]',
  );
  if (claim === 'already_processed') {
    return NextResponse.json({ received: true });
  }
  if (claim === 'concurrent') {
    return NextResponse.json({ error: 'Event processing in progress' }, { status: 500 });
  }

  console.log(`[Subscription webhook] ${event.type} (event: ${event.id})`);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        await handleCheckoutCompleted(supabase, event.data.object as Stripe.Checkout.Session);
        break;
      }

      case 'customer.subscription.updated': {
        await handleSubscriptionUpdated(supabase, event.data.object);
        break;
      }

      case 'customer.subscription.deleted': {
        await handleSubscriptionDeleted(supabase, event.data.object as Stripe.Subscription);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.customer) {
          const customerId =
            typeof invoice.customer === 'string' ? invoice.customer : invoice.customer.id;

          let planStatus: 'active' | 'trialing' | 'past_due' | 'cancelled' | 'cancelling' = 'past_due';
          try {
            const paused = await pauseSubscriptionOnTrialEndPaymentFailure(invoice);
            const subId = getStripeInvoiceSubscriptionId(invoice);
            if (paused && subId) {
              const sub = await stripe.subscriptions.retrieve(subId);
              planStatus = mapStripeSubscriptionToPlanStatus(sub);
            }
          } catch (e) {
            console.warn('[Subscription webhook] Trial-end pause handling failed:', e);
          }

          await supabase
            .from('venues')
            .update({ plan_status: planStatus })
            .eq('stripe_customer_id', customerId);
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.customer) {
          const customerId =
            typeof invoice.customer === 'string' ? invoice.customer : invoice.customer.id;
          // Only clear past_due - do not overwrite plan_status 'cancelling' (cancel_at_period_end).
          await supabase
            .from('venues')
            .update({ plan_status: 'active' })
            .eq('stripe_customer_id', customerId)
            .eq('plan_status', 'past_due');
        }
        // Referral programme: if this is the referee's first paid invoice, credit the referrer.
        // Never throws; failures are logged so they cannot break the wider webhook handler.
        try {
          await maybeCreditReferrerForInvoice(supabase, invoice);
        } catch (e) {
          console.error('[Subscription webhook] maybeCreditReferrerForInvoice failed:', e);
        }
        // Self-heal: if the checkout.session.completed webhook was missed, recover the sales
        // attribution from the subscription metadata before recording revenue (idempotent).
        try {
          await backfillSalesAttributionFromInvoice(supabase, invoice);
        } catch (e) {
          console.error('[Subscription webhook] backfillSalesAttributionFromInvoice failed:', e);
        }
        try {
          await recordSalesInvoiceRevenue(supabase, invoice);
        } catch (e) {
          console.error('[Subscription webhook] recordSalesInvoiceRevenue failed:', e);
        }
        try {
          await recordPlatformInvoice(supabase, invoice);
        } catch (e) {
          console.error('[Subscription webhook] recordPlatformInvoice failed:', e);
        }
        break;
      }

      default:
        console.log(`[Subscription webhook] Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    await releaseStripeWebhookEvent(supabase, event.id, '[Subscription webhook]');
    console.error('[Subscription webhook] Processing failed:', event.id, event.type, err);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}

/**
 * Recover a sales attribution that was lost because the `checkout.session.completed` webhook
 * (and the success-page fallback) were both missed. The sales code is mirrored onto the
 * subscription metadata at checkout, so the first paid invoice can re-attach it. Idempotent —
 * `attachSalesAttributionOnSignup` no-ops when an attribution already exists for the venue.
 */
async function backfillSalesAttributionFromInvoice(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  invoice: Stripe.Invoice,
): Promise<void> {
  const subId = getStripeInvoiceSubscriptionId(invoice);
  if (!subId) return;
  const sub = await stripe.subscriptions.retrieve(subId);
  const salesCode = (sub.metadata?.sales_code ?? '').trim() || null;
  if (!salesCode) return;
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;
  const { data: venue } = await supabase
    .from('venues')
    .select('id, email')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  if (!venue?.id) return;
  const venueId = (venue as { id: string }).id;
  // Resolve the venue's owner so the self-attribution guard can run by user id, not just email.
  const { data: ownerStaff } = await supabase
    .from('staff')
    .select('user_id')
    .eq('venue_id', venueId)
    .eq('role', 'admin')
    .not('user_id', 'is', null)
    .limit(1);
  await attachSalesAttributionOnSignup({
    admin: supabase,
    salesCode,
    referredVenueId: venueId,
    refereeEmail: invoice.customer_email ?? (venue as { email?: string | null }).email ?? null,
    refereeUserId: (ownerStaff?.[0] as { user_id?: string | null } | undefined)?.user_id ?? null,
  });
}

async function handleCheckoutCompleted(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  session: Stripe.Checkout.Session
) {
  const metadata = session.metadata ?? {};

  /** Appointments Light: past_due with existing sub — new card from Setup Checkout. */
  if (session.mode === 'setup' && metadata.action === 'light_payment_method_update' && metadata.venue_id) {
    await handleLightPaymentMethodUpdateFromSetup(supabase, session);
    return;
  }

  const businessType = metadata.business_type;
  const plan = metadata.plan;
  const supabaseUserId = metadata.supabase_user_id;

  // Handle change-plan sessions (upgrade/downgrade/resubscribe) from existing venues
  const venueIdMeta = metadata.venue_id;
  const actionMeta = metadata.action;
  if (venueIdMeta && actionMeta) {
    const oldSubId = metadata.old_subscription_id;
    if (oldSubId) {
      try {
        await stripe.subscriptions.cancel(oldSubId);
      } catch (e) {
        console.warn('[Subscription webhook] Could not cancel old subscription:', oldSubId, e);
      }
    }

    const newPlan = metadata.plan;
    const subscriptionId =
      typeof session.subscription === 'string' ? session.subscription : null;

    let mainSubscriptionItemId: string | null = null;
    let smsSubscriptionItemId: string | null = null;
    let periodEndIso: string | null = null;
    let periodStartIso: string | null = null;
    let newPlanStatus: 'active' | 'trialing' | 'past_due' | 'cancelled' | 'cancelling' = 'active';
    if (subscriptionId) {
      try {
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const ids = getPersistedSubscriptionItemIds(sub);
        mainSubscriptionItemId = ids.mainSubscriptionItemId;
        smsSubscriptionItemId = ids.smsSubscriptionItemId;
        periodEndIso = subscriptionPeriodEndIso(sub) ?? subscriptionCancelAtIso(sub);
        periodStartIso = subscriptionPeriodStartIso(sub);
        newPlanStatus = mapStripeSubscriptionToPlanStatus(sub);
      } catch {
        console.warn('[Subscription webhook] Could not retrieve new subscription item');
      }
    }

    const changePlanUpdates: Record<string, unknown> = {
      stripe_subscription_id: subscriptionId,
      stripe_subscription_item_id: mainSubscriptionItemId,
      stripe_sms_subscription_item_id: smsSubscriptionItemId,
      subscription_current_period_start: periodStartIso,
      subscription_current_period_end: periodEndIso,
      plan_status: newPlanStatus,
    };
    if (newPlan) {
      changePlanUpdates.pricing_tier = newPlan;
    }
    changePlanUpdates.calendar_count = newPlan === 'light' ? 1 : null;

    await supabase
      .from('venues')
      .update(changePlanUpdates)
      .eq('id', venueIdMeta);

    await updateVenueSmsMonthlyAllowance(venueIdMeta);

    console.log(`[Subscription webhook] Processed change-plan (${actionMeta}) for venue ${venueIdMeta}`);
    return;
  }

  if (!businessType || !plan || !supabaseUserId) {
    console.log('[Subscription webhook] checkout.session.completed missing metadata - skipping venue creation');
    return;
  }

  // Check if venue already provisioned (idempotency - the success page may have already created it)
  const customerId =
    typeof session.customer === 'string' ? session.customer : (session.customer as Stripe.Customer)?.id;
  if (customerId) {
    const { data: existingVenue } = await supabase
      .from('venues')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();

    if (existingVenue) {
      console.log('[Subscription webhook] Venue already exists for customer', customerId);
      await clearSignupPendingUserMetadata(supabase, supabaseUserId);
      return;
    }
  }

  // Also check by user email via staff table
  const { data: userData } = await supabase.auth.admin.getUserById(supabaseUserId);
  const userEmail = userData?.user?.email;
  if (userEmail) {
    const { count: existingStaffCount } = await supabase
      .from('staff')
      .select('*', { count: 'exact', head: true })
      .ilike('email', escapeLikePattern(userEmail.toLowerCase().trim()))
      .limit(1);

    if ((existingStaffCount ?? 0) > 0) {
      console.log('[Subscription webhook] Staff record already exists for', userEmail);
      await clearSignupPendingUserMetadata(supabase, supabaseUserId);
      return;
    }
  }

  const config = getBusinessConfig(businessType);

  const subscriptionId =
    typeof session.subscription === 'string' ? session.subscription : null;

  let mainSubscriptionItemId: string | null = null;
  let smsSubscriptionItemId: string | null = null;
  let periodEndIso: string | null = null;
  let periodStartIso: string | null = null;
  let signupPlanStatus: 'active' | 'trialing' | 'cancelling' = 'active';
  if (subscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      const ids = getPersistedSubscriptionItemIds(sub);
      mainSubscriptionItemId = ids.mainSubscriptionItemId;
      smsSubscriptionItemId = ids.smsSubscriptionItemId;
      periodEndIso = subscriptionPeriodEndIso(sub) ?? subscriptionCancelAtIso(sub);
      periodStartIso = subscriptionPeriodStartIso(sub);
      const mapped = mapStripeSubscriptionToPlanStatus(sub);
      if (mapped === 'trialing' || mapped === 'cancelling') {
        signupPlanStatus = mapped;
      }
    } catch {
      console.warn('[Subscription webhook] Could not retrieve subscription item');
    }
  }

  const slug = `venue-${Date.now()}`;

  const isLight = String(plan).toLowerCase() === 'light';
  const commPolicies = communicationPoliciesEmailOnlyAppointmentsLane();
  const notifDefaults = defaultNotificationSettingsForLightPlan();

  const { data: venue, error: venueError } = await supabase
    .from('venues')
    .insert({
      name: 'My Business',
      slug,
      booking_model: config.model,
      business_type: businessType,
      business_category: config.category,
      terminology: config.terms,
      pricing_tier: plan,
      plan_status: signupPlanStatus,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      stripe_subscription_item_id: mainSubscriptionItemId,
      stripe_sms_subscription_item_id: smsSubscriptionItemId,
      subscription_current_period_start: periodStartIso,
      subscription_current_period_end: periodEndIso,
      calendar_count: isLight ? 1 : null,
      onboarding_step: 0,
      onboarding_completed: false,
      appointments_onboarding_unified_flow: isAppointmentPlanTier(plan),
      daily_booking_log_email_config: DEFAULT_VENUE_BOOKING_LOG_EMAIL_CONFIG,
      ...(isLight
        ? {
            communication_policies: commPolicies as unknown as Record<string, never>,
            notification_settings: notifDefaults as unknown as Record<string, never>,
          }
        : {}),
    })
    .select('id')
    .single();

  if (venueError || !venue) {
    // The success-page POST (/api/signup/complete) won the provisioning race and already
    // created this venue under the same Stripe customer; the partial unique index on
    // venues.stripe_customer_id surfaces the duplicate as 23505. The winner also created the
    // staff row, attribution, and signup notification, so there is nothing left to do here.
    // Confirm a venue actually exists under this customer before swallowing: venues.slug is
    // also UNIQUE, so a same-millisecond signup by a different customer can raise 23505 on the
    // slug — that must re-throw so Stripe retries this event with a fresh `Date.now()` slug.
    if (venueError?.code === '23505' && customerId) {
      const { data: racedVenue } = await supabase
        .from('venues')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .maybeSingle();
      if (racedVenue) {
        console.log(
          '[Subscription webhook] Venue already provisioned by success page (unique race) for',
          customerId,
        );
        return;
      }
    }
    console.error('[Subscription webhook] Failed to create venue:', venueError);
    throw new Error('Venue creation failed');
  }

  if (userEmail) {
    const { error: staffError } = await supabase.from('staff').insert({
      venue_id: venue.id,
      email: userEmail,
      name: userEmail.split('@')[0] ?? 'Admin',
      role: 'admin',
      // Durable auth link: identity resolution prefers user_id over the
      // fragile email match, which breaks when the sign-in email changes.
      user_id: supabaseUserId,
    });

    if (staffError) {
      console.error('[Subscription webhook] Failed to create staff:', staffError);
      throw new Error('Staff creation failed: ' + staffError.message);
    }
  }

  await updateVenueSmsMonthlyAllowance(venue.id);

  // Internal heads-up that a new account just signed up. Only this guarded
  // creation path (or the success page's — whichever ran first) sends it, and
  // a send failure never fails the webhook.
  await sendNewSignupNotification({
    signupEmail: userEmail ?? null,
    plan,
    businessType,
    planStatus: signupPlanStatus,
    venueId: venue.id,
    referralCode: (metadata.referral_code ?? '').trim() || null,
    source: 'stripe_webhook',
  });

  // Friendly customer welcome from hello@resneo.com (reply-to hello@). Sits beside the internal
  // notification so it sends once per signup. Never throws, so it cannot fail the webhook or
  // trigger a Stripe retry.
  await sendWelcomeEmail({ to: userEmail ?? null });

  // Referral programme: attach the referrals row if this venue signed up via a link.
  // We do NOT eagerly create the new venue's own referral_codes row here — it's
  // created lazily on first dashboard view, once onboarding has set the real name.
  try {
    const salesCode = (metadata.sales_code ?? '').trim() || null;
    if (salesCode) {
      await attachSalesAttributionOnSignup({
        admin: supabase,
        salesCode,
        referredVenueId: venue.id,
        refereeEmail: userEmail ?? null,
        refereeUserId: (metadata.supabase_user_id ?? '').trim() || null,
      });
    } else {
      const referralCode = (metadata.referral_code ?? '').trim() || null;
      if (referralCode) {
        await attachReferralOnSignup({
          admin: supabase,
          referralCode,
          referredVenueId: venue.id,
          refereeEmail: userEmail ?? null,
        });
      }
    }
  } catch (e) {
    console.error('[Subscription webhook] sales/referral wiring failed (non-fatal):', e);
  }

  // Signup is now provisioned by the webhook (the success-page POST may never have run).
  // Clear the durable pending-signup metadata so post-login routing and the /signup
  // resume redirect stop sending this already-paid user back into a second checkout.
  await clearSignupPendingUserMetadata(supabase, supabaseUserId);
}

async function handleSubscriptionUpdated(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  subscriptionRaw: unknown
) {
  const subscription = subscriptionRaw as Stripe.Subscription;
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id;
  if (!customerId || !subscription.id) return;

  const ids = getPersistedSubscriptionItemIds(subscription);
  const mainItem = findMainPlanSubscriptionItem(subscription);

  const updates: Record<string, unknown> = {
    stripe_subscription_id: subscription.id,
    stripe_subscription_item_id: ids.mainSubscriptionItemId,
    stripe_sms_subscription_item_id: ids.smsSubscriptionItemId,
    subscription_current_period_start: subscriptionPeriodStartIso(subscriptionRaw),
    subscription_current_period_end: subscriptionPeriodEndIso(subscriptionRaw) ?? subscriptionCancelAtIso(subscriptionRaw),
  };

  const priceId = mainItem?.price && typeof mainItem.price === 'object'
    ? mainItem.price.id
    : typeof mainItem?.price === 'string'
      ? mainItem.price
      : undefined;
  const priceToTier = buildPriceToTierMapping();
  if (priceId && priceToTier[priceId]) {
    updates.pricing_tier = priceToTier[priceId];
    updates.calendar_count = null;
  } else if (priceId) {
    console.warn('[Subscription webhook] Unknown subscription price id; tier not updated', {
      subscriptionId: subscription.id,
      customerId,
      priceId,
    });
  }

  updates.plan_status = mapStripeSubscriptionToPlanStatus(subscription);

  const planStatus = updates.plan_status as string;
  const { data: venueRows } = await supabase.from('venues').select('id').eq('stripe_customer_id', customerId);
  await supabase.from('venues').update(updates).eq('stripe_customer_id', customerId);
  for (const row of venueRows ?? []) {
    const vid = (row as { id: string }).id;
    if (vid) {
      await updateVenueSmsMonthlyAllowance(vid);
      try {
        await syncSalesAttributionWithPlanStatus(supabase, vid, planStatus);
      } catch (e) {
        console.error('[Subscription webhook] syncSalesAttributionWithPlanStatus failed:', e);
      }
    }
  }
}

async function handleSubscriptionDeleted(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  subscription: Stripe.Subscription
) {
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id;
  const deletedId = subscription.id;
  if (!customerId || !deletedId) return;

  try {
    const stillOpen = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 20,
    });
    const hasReplacement = stillOpen.data.some(
      (s) =>
        s.id !== deletedId && ['active', 'trialing', 'past_due', 'unpaid'].includes(s.status),
    );
    if (hasReplacement) {
      console.log(
        `[Subscription webhook] Ignoring deleted event ${deletedId}: customer still has another subscription`,
      );
      return;
    }

    // Referral programme: subscription truly cancelled with no replacement.
    // If this venue was referred and hadn't yet hit a paid invoice, the referrer
    // can no longer be credited — mark as failed.
    try {
      const { data: refereeVenues } = await supabase
        .from('venues')
        .select('id')
        .eq('stripe_customer_id', customerId);
      for (const v of refereeVenues ?? []) {
        const vid = (v as { id?: string }).id;
        if (vid) {
          await markReferralsFailedForReferee(
            supabase,
            vid,
            'referee_subscription_cancelled',
          );
        }
      }
    } catch (e) {
      console.error('[Subscription webhook] markReferralsFailedForReferee failed:', e);
    }
  } catch (e) {
    console.warn('[Subscription webhook] Could not list subscriptions after delete; continuing cautiously', e);
  }

  /**
   * Only clear the venue row when the deleted sub matches what we stored. Otherwise a plan change
   * that cancels the *old* subscription (e.g. Light → Appointments upgrade) would wipe the new sub id.
   */
  const { data: rows } = await supabase
    .from('venues')
    .select('id, stripe_subscription_id, subscription_current_period_start, subscription_current_period_end')
    .eq('stripe_customer_id', customerId);

  let updatedAny = false;
  for (const row of rows ?? []) {
    const vid = (row as { id?: string }).id;
    const stored = (row as { stripe_subscription_id?: string | null }).stripe_subscription_id;
    if (!vid || stored !== deletedId) continue;
    const existingPeriodStart = (row as { subscription_current_period_start?: string | null })
      .subscription_current_period_start;
    const existingPeriodEnd = (row as { subscription_current_period_end?: string | null })
      .subscription_current_period_end;
    const periodStartIso = subscriptionPeriodStartIso(subscription) ?? existingPeriodStart ?? null;
    const periodEndIso = subscriptionPeriodEndIso(subscription) ?? subscriptionCancelAtIso(subscription) ?? existingPeriodEnd ?? null;
    const planStatus = mapStripeSubscriptionToPlanStatus(subscription);

    await supabase
      .from('venues')
      .update({
        plan_status: planStatus,
        stripe_subscription_id: planStatus === 'cancelling' ? deletedId : null,
        stripe_subscription_item_id: null,
        stripe_sms_subscription_item_id: null,
        subscription_current_period_start: periodStartIso,
        subscription_current_period_end: periodEndIso,
      })
      .eq('id', vid);
    updatedAny = true;

    try {
      await syncSalesAttributionWithPlanStatus(supabase, vid, planStatus);
    } catch (e) {
      console.error('[Subscription webhook] sales churn sync (deleted) failed:', e);
    }
  }

  /**
   * Fallback for desynced rows: if Stripe reports no replacement subscription for this customer,
   * ensure the venue cannot remain active in-app due to stale subscription ids.
   */
  if (!updatedAny) {
    const periodStartIso = subscriptionPeriodStartIso(subscription) ?? null;
    const periodEndIso = subscriptionPeriodEndIso(subscription) ?? subscriptionCancelAtIso(subscription) ?? null;
    const planStatus = mapStripeSubscriptionToPlanStatus(subscription);
    await supabase
      .from('venues')
      .update({
        plan_status: planStatus,
        stripe_subscription_id: planStatus === 'cancelling' ? deletedId : null,
        stripe_subscription_item_id: null,
        stripe_sms_subscription_item_id: null,
        subscription_current_period_start: periodStartIso,
        subscription_current_period_end: periodEndIso,
      })
      .eq('stripe_customer_id', customerId);

    try {
      const { data: fallbackRows } = await supabase
        .from('venues')
        .select('id')
        .eq('stripe_customer_id', customerId);
      for (const row of fallbackRows ?? []) {
        const vid = (row as { id?: string }).id;
        if (vid) await syncSalesAttributionWithPlanStatus(supabase, vid, planStatus);
      }
    } catch (e) {
      console.error('[Subscription webhook] sales churn sync (deleted fallback) failed:', e);
    }
  }
}
