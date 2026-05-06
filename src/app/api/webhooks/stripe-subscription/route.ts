import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getBusinessConfig } from '@/lib/business-config';
import {
  mapStripeSubscriptionToPlanStatus,
  subscriptionCancelAtIso,
  subscriptionCancelAtPeriodEnd,
  subscriptionPeriodEndIso,
  subscriptionPeriodStartIso,
} from '@/lib/stripe/subscription-fields';
import {
  findMainPlanSubscriptionItem,
  getPersistedSubscriptionItemIds,
} from '@/lib/stripe/subscription-line-items';
import { updateVenueSmsMonthlyAllowance } from '@/lib/billing/sms-allowance';
import { handleLightPaymentMethodUpdateFromSetup } from '@/lib/stripe/light-past-due-payment-webhook';
import { communicationPoliciesEmailOnlyAppointmentsLane } from '@/lib/communications/policies';
import { defaultNotificationSettingsForLightPlan } from '@/lib/notifications/notification-settings';
import { isAppointmentPlanTier } from '@/lib/tier-enforcement';
import { DEFAULT_VENUE_BOOKING_LOG_EMAIL_CONFIG } from '@/lib/reports/booking-log-email-config';

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

  const claimed = await claimWebhookEvent(supabase, event.id, event.type);
  if (!claimed) {
    return NextResponse.json({ received: true });
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
          await supabase
            .from('venues')
            .update({ plan_status: 'past_due' })
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
        break;
      }

      default:
        console.log(`[Subscription webhook] Unhandled event type: ${event.type}`);
    }

    await recordProcessed(supabase, event.id, event.type);

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('[Subscription webhook] Processing failed:', event.id, event.type, err);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}

async function recordProcessed(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  stripeEventId: string,
  eventType: string
): Promise<void> {
  await supabase
    .from('webhook_events')
    .upsert({
      stripe_event_id: stripeEventId,
      event_type: eventType,
    }, { onConflict: 'stripe_event_id', ignoreDuplicates: true });
}

async function claimWebhookEvent(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  stripeEventId: string,
  eventType: string,
): Promise<boolean> {
  const { error } = await supabase
    .from('webhook_events')
    .insert({ stripe_event_id: stripeEventId, event_type: eventType });
  if (!error) return true;

  const code = (error as { code?: string }).code;
  if (code === '23505' || code === '409') {
    return false;
  }
  console.error('[Subscription webhook] Failed to claim event idempotency lock:', error);
  throw error;
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
      .ilike('email', userEmail.toLowerCase().trim())
      .limit(1);

    if ((existingStaffCount ?? 0) > 0) {
      console.log('[Subscription webhook] Staff record already exists for', userEmail);
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
  let cancelAtPeriodEnd = false;
  if (subscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      const ids = getPersistedSubscriptionItemIds(sub);
      mainSubscriptionItemId = ids.mainSubscriptionItemId;
      smsSubscriptionItemId = ids.smsSubscriptionItemId;
      periodEndIso = subscriptionPeriodEndIso(sub) ?? subscriptionCancelAtIso(sub);
      periodStartIso = subscriptionPeriodStartIso(sub);
      cancelAtPeriodEnd = subscriptionCancelAtPeriodEnd(sub);
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
      plan_status: cancelAtPeriodEnd ? 'cancelling' : 'active',
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
    console.error('[Subscription webhook] Failed to create venue:', venueError);
    throw new Error('Venue creation failed');
  }

  if (userEmail) {
    const { error: staffError } = await supabase.from('staff').insert({
      venue_id: venue.id,
      email: userEmail,
      name: userEmail.split('@')[0] ?? 'Admin',
      role: 'admin',
    });

    if (staffError) {
      console.error('[Subscription webhook] Failed to create staff:', staffError);
      throw new Error('Staff creation failed: ' + staffError.message);
    }
  }

  await updateVenueSmsMonthlyAllowance(venue.id);
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

  const { data: venueRows } = await supabase.from('venues').select('id').eq('stripe_customer_id', customerId);
  await supabase.from('venues').update(updates).eq('stripe_customer_id', customerId);
  for (const row of venueRows ?? []) {
    const vid = (row as { id: string }).id;
    if (vid) await updateVenueSmsMonthlyAllowance(vid);
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
  }
}
