import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { stripe } from '@/lib/stripe';
import { stripeSubscriptionOrCustomerHasPaymentMethod } from '@/lib/stripe/venue-customer-payment';
import {
  mapStripeSubscriptionToPlanStatus,
  subscriptionCancelAtIso,
  subscriptionPeriodEndIso,
  subscriptionPeriodStartIso,
} from '@/lib/stripe/subscription-fields';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' } as const;

/**
 * GET /api/venue/light-plan/status
 * Live Stripe + DB snapshot for the Plan tab (card on file, subscription id, period dates).
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

    const tier = String((venue as { pricing_tier?: string }).pricing_tier ?? '').toLowerCase();
    if (tier !== 'light') {
      return NextResponse.json({ error: 'Not an Appointments Light venue' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const customerId = (venue as { stripe_customer_id?: string | null }).stripe_customer_id?.trim() ?? '';
    const subId = (venue as { stripe_subscription_id?: string | null }).stripe_subscription_id?.trim() ?? '';

    const has_default_payment_method = await stripeSubscriptionOrCustomerHasPaymentMethod({
      customerId,
      subscriptionId: subId,
    });

    let stripe_subscription_status: string | null = null;
    let planStatus = (venue as { plan_status?: string | null }).plan_status ?? null;
    let periodStart =
      (venue as { subscription_current_period_start?: string | null }).subscription_current_period_start ?? null;
    let periodEnd =
      (venue as { subscription_current_period_end?: string | null }).subscription_current_period_end ?? null;
    if (subId) {
      try {
        const sub = await stripe.subscriptions.retrieve(subId);
        stripe_subscription_status = sub.status;
        planStatus = mapStripeSubscriptionToPlanStatus(sub);
        periodStart = subscriptionPeriodStartIso(sub);
        periodEnd = subscriptionPeriodEndIso(sub) ?? subscriptionCancelAtIso(sub);
        await staff.db
          .from('venues')
          .update({
            plan_status: planStatus,
            subscription_current_period_start: periodStart,
            subscription_current_period_end: periodEnd,
          })
          .eq('id', staff.venue_id);
      } catch (e) {
        console.warn('[venue/light-plan/status] stripe.subscriptions.retrieve failed', { subId, e });
        stripe_subscription_status = null;
      }
    }

    return NextResponse.json(
      {
        venue_id: staff.venue_id,
        plan_status: planStatus,
        stripe_subscription_id: subId || null,
        has_default_payment_method,
        stripe_subscription_status,
        subscription_current_period_start: periodStart,
        subscription_current_period_end: periodEnd,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    console.error('[light-plan/status] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
