import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { stripe } from '@/lib/stripe';
import {
  findMainPlanSubscriptionItem,
  getPersistedSubscriptionItemIds,
} from '@/lib/stripe/subscription-line-items';
import {
  mapStripeSubscriptionToPlanStatus,
  subscriptionCancelAtIso,
  subscriptionPeriodEndIso,
  subscriptionPeriodStartIso,
} from '@/lib/stripe/subscription-fields';
import { isAppointmentPlanTier } from '@/lib/tier-enforcement';
import { updateVenueSmsMonthlyAllowance } from '@/lib/billing/sms-allowance';
import { countUnifiedCalendarColumns } from '@/lib/light-plan';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' } as const;

type AppointmentsTier = 'light' | 'plus' | 'appointments';

const PRICE_TIER_ENV_KEYS: Array<{ envKey: string; tier: AppointmentsTier }> = [
  { envKey: 'STRIPE_LIGHT_PRICE_ID', tier: 'light' },
  { envKey: 'STRIPE_APPOINTMENTS_PLUS_PRICE_ID', tier: 'plus' },
  { envKey: 'STRIPE_APPOINTMENTS_PRO_PRICE_ID', tier: 'appointments' },
];

function tierFromPriceId(priceId: string | undefined): AppointmentsTier | null {
  if (!priceId) return null;
  for (const { envKey, tier } of PRICE_TIER_ENV_KEYS) {
    if (process.env[envKey]?.trim() === priceId) return tier;
  }
  return null;
}

/**
 * GET /api/venue/appointments-plan/status
 * Live Stripe + DB snapshot for Appointments Light, Plus, and Pro plan state.
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
        'id, pricing_tier, plan_status, stripe_subscription_id, subscription_current_period_start, subscription_current_period_end',
      )
      .eq('id', staff.venue_id)
      .maybeSingle();

    if (error || !venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404, headers: NO_STORE_HEADERS });
    }

    const dbTier = String((venue as { pricing_tier?: string | null }).pricing_tier ?? '').toLowerCase();
    if (!isAppointmentPlanTier(dbTier)) {
      return NextResponse.json({ error: 'Not an Appointments plan venue' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const subId = (venue as { stripe_subscription_id?: string | null }).stripe_subscription_id?.trim() ?? '';
    let pricingTier = dbTier as AppointmentsTier;
    let planStatus = (venue as { plan_status?: string | null }).plan_status ?? null;
    let periodStart =
      (venue as { subscription_current_period_start?: string | null }).subscription_current_period_start ?? null;
    let periodEnd =
      (venue as { subscription_current_period_end?: string | null }).subscription_current_period_end ?? null;
    let stripeSubscriptionStatus: string | null = null;
    const activeCalendarCount = await countUnifiedCalendarColumns(staff.db, staff.venue_id);

    if (subId) {
      try {
        const sub = await stripe.subscriptions.retrieve(subId, { expand: ['items.data.price'] });
        stripeSubscriptionStatus = sub.status;
        planStatus = mapStripeSubscriptionToPlanStatus(sub);
        periodStart = subscriptionPeriodStartIso(sub);
        periodEnd = subscriptionPeriodEndIso(sub) ?? subscriptionCancelAtIso(sub);

        const mainItem = findMainPlanSubscriptionItem(sub);
        const price = mainItem?.price;
        const priceId = typeof price === 'string' ? price : price?.id;
        pricingTier = tierFromPriceId(priceId) ?? pricingTier;
        const ids = getPersistedSubscriptionItemIds(sub);

        await staff.db
          .from('venues')
          .update({
            pricing_tier: pricingTier,
            plan_status: planStatus,
            stripe_subscription_item_id: ids.mainSubscriptionItemId,
            stripe_sms_subscription_item_id: ids.smsSubscriptionItemId,
            subscription_current_period_start: periodStart,
            subscription_current_period_end: periodEnd,
            calendar_count: activeCalendarCount,
          })
          .eq('id', staff.venue_id);
        await updateVenueSmsMonthlyAllowance(staff.venue_id);
      } catch (e) {
        console.warn('[appointments-plan/status] stripe.subscriptions.retrieve failed', { subId, e });
      }
    }

    await staff.db
      .from('venues')
      .update({ calendar_count: activeCalendarCount })
      .eq('id', staff.venue_id);

    return NextResponse.json(
      {
        venue_id: staff.venue_id,
        pricing_tier: pricingTier,
        plan_status: planStatus,
        stripe_subscription_id: subId || null,
        stripe_subscription_status: stripeSubscriptionStatus,
        subscription_current_period_start: periodStart,
        subscription_current_period_end: periodEnd,
        calendar_count: activeCalendarCount,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    console.error('[appointments-plan/status] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
