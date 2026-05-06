import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { stripe } from '@/lib/stripe';
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
import { countUnifiedCalendarColumns } from '@/lib/light-plan';
import { isAppointmentPlanTier } from '@/lib/tier-enforcement';
import { stripeSubscriptionOrCustomerHasPaymentMethod } from '@/lib/stripe/venue-customer-payment';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type PlanTier = 'appointments' | 'plus' | 'restaurant' | 'light';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' } as const;

const PRICE_TIER_ENV_KEYS: Array<{ envKey: string; tier: PlanTier }> = [
  { envKey: 'STRIPE_APPOINTMENTS_PRO_PRICE_ID', tier: 'appointments' },
  { envKey: 'STRIPE_STANDARD_PRICE_ID', tier: 'appointments' },
  { envKey: 'STRIPE_APPOINTMENTS_PLUS_PRICE_ID', tier: 'plus' },
  { envKey: 'STRIPE_PLUS_PRICE_ID', tier: 'plus' },
  { envKey: 'STRIPE_RESTAURANT_PRICE_ID', tier: 'restaurant' },
  { envKey: 'STRIPE_FOUNDING_PRICE_ID', tier: 'restaurant' },
  { envKey: 'STRIPE_LIGHT_PRICE_ID', tier: 'light' },
];

function tierFromPriceId(priceId: string | undefined): PlanTier | null {
  if (!priceId) return null;
  for (const { envKey, tier } of PRICE_TIER_ENV_KEYS) {
    if (process.env[envKey]?.trim() === priceId) return tier;
  }
  return null;
}

function hasFuturePeriodEnd(sub: unknown): boolean {
  const end = subscriptionPeriodEndIso(sub) ?? subscriptionCancelAtIso(sub);
  return Boolean(end && Date.parse(end) > Date.now());
}

/**
 * GET /api/venue/billing/status
 * Live Stripe + DB snapshot for the Settings > Plan tab, including Customer Portal returns.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff || !requireAdmin(staff)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403, headers: NO_STORE_HEADERS });
    }

    const { data: venue, error } = await staff.db
      .from('venues')
      .select(
        'id, pricing_tier, plan_status, stripe_customer_id, stripe_subscription_id, subscription_current_period_start, subscription_current_period_end',
      )
      .eq('id', staff.venue_id)
      .maybeSingle();

    if (error || !venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404, headers: NO_STORE_HEADERS });
    }

    const customerId = (venue as { stripe_customer_id?: string | null }).stripe_customer_id?.trim() ?? '';
    let subId = (venue as { stripe_subscription_id?: string | null }).stripe_subscription_id?.trim() ?? '';
    let pricingTier = String((venue as { pricing_tier?: string | null }).pricing_tier ?? '').toLowerCase();
    let planStatus = (venue as { plan_status?: string | null }).plan_status ?? null;
    let periodStart =
      (venue as { subscription_current_period_start?: string | null }).subscription_current_period_start ?? null;
    let periodEnd =
      (venue as { subscription_current_period_end?: string | null }).subscription_current_period_end ?? null;
    let stripeSubscriptionStatus: string | null = null;

    if (!subId && customerId) {
      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 20,
        expand: ['data.items.data.price'],
      });
      const replacement = subscriptions.data.find((sub) =>
        ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'].includes(sub.status),
      ) ?? subscriptions.data.find((sub) => sub.status === 'canceled' && hasFuturePeriodEnd(sub));
      subId = replacement?.id ?? '';
    }

    if (subId) {
      try {
        const sub = await stripe.subscriptions.retrieve(subId, { expand: ['items.data.price'] });
        stripeSubscriptionStatus = sub.status;
        planStatus = mapStripeSubscriptionToPlanStatus(sub);
        periodStart = subscriptionPeriodStartIso(sub);
        periodEnd = subscriptionPeriodEndIso(sub) ?? subscriptionCancelAtIso(sub);

        const mainItem = findMainPlanSubscriptionItem(sub);
        const priceId =
          mainItem?.price && typeof mainItem.price === 'object'
            ? mainItem.price.id
            : typeof mainItem?.price === 'string'
              ? mainItem.price
              : undefined;
        pricingTier = tierFromPriceId(priceId) ?? pricingTier;
        const ids = getPersistedSubscriptionItemIds(sub);
        const activeCalendarCount = isAppointmentPlanTier(pricingTier)
          ? await countUnifiedCalendarColumns(staff.db, staff.venue_id)
          : null;

        await staff.db
          .from('venues')
          .update({
            pricing_tier: pricingTier,
            plan_status: planStatus,
            stripe_subscription_id: planStatus === 'cancelled' ? null : sub.id,
            stripe_subscription_item_id: planStatus === 'cancelled' ? null : ids.mainSubscriptionItemId,
            stripe_sms_subscription_item_id: planStatus === 'cancelled' ? null : ids.smsSubscriptionItemId,
            subscription_current_period_start: periodStart,
            subscription_current_period_end: periodEnd,
            ...(activeCalendarCount !== null ? { calendar_count: activeCalendarCount } : {}),
          })
          .eq('id', staff.venue_id);

        await updateVenueSmsMonthlyAllowance(staff.venue_id);

        return NextResponse.json(
          {
            venue_id: staff.venue_id,
            pricing_tier: pricingTier,
            plan_status: planStatus,
            stripe_subscription_id: planStatus === 'cancelled' ? null : sub.id,
            stripe_subscription_status: stripeSubscriptionStatus,
            subscription_current_period_start: periodStart,
            subscription_current_period_end: periodEnd,
            calendar_count: activeCalendarCount,
            has_default_payment_method: customerId
              ? await stripeSubscriptionOrCustomerHasPaymentMethod({
                  customerId,
                  subscriptionId: planStatus === 'cancelled' ? null : sub.id,
                })
              : false,
          },
          { headers: NO_STORE_HEADERS },
        );
      } catch (e) {
        console.warn('[venue/billing/status] stripe.subscriptions.retrieve failed', { subId, e });
      }
    }

    return NextResponse.json(
      {
        venue_id: staff.venue_id,
        pricing_tier: pricingTier,
        plan_status: planStatus,
        stripe_subscription_id: subId || null,
        stripe_subscription_status: stripeSubscriptionStatus,
        subscription_current_period_start: periodStart,
        subscription_current_period_end: periodEnd,
        calendar_count: null,
        has_default_payment_method: customerId
          ? await stripeSubscriptionOrCustomerHasPaymentMethod({
              customerId,
              subscriptionId: subId || null,
            })
          : false,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    console.error('[venue/billing/status] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
