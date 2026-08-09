import { NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { escapeLikePattern } from '@/lib/db/like-escape';
import { stripe } from '@/lib/stripe';
import {
  subscriptionCancelAtIso,
  subscriptionPeriodEndIso,
  subscriptionPeriodStartIso,
  subscriptionStatus,
} from '@/lib/stripe/subscription-fields';
import {
  buildCheckoutLineItems,
  buildLightPlanCheckoutLineItems,
} from '@/lib/stripe/subscription-line-items';

/**
 * Stripe states a subscription can never come back from. Clearing
 * `cancel_at_period_end` is rejected for these, so the only way forward is a
 * brand new subscription.
 */
const UNRESUMABLE_STRIPE_STATUSES = new Set(['canceled', 'incomplete_expired']);

/**
 * Turn a Stripe rejection into the status and message it deserves. Stripe's
 * invalid-request messages say exactly what is wrong ("You cannot update a
 * subscription that is canceled"), which is far more use to an admin than a
 * blanket internal error.
 */
function stripeErrorResponse(err: unknown): NextResponse | null {
  const e = err as { type?: string; statusCode?: number; message?: string } | null;
  if (!e || typeof e.type !== 'string' || !e.type.startsWith('Stripe')) return null;
  if (e.type === 'StripeConnectionError' || e.type === 'StripeAPIError') return null;
  const status = typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 500
    ? e.statusCode
    : 400;
  return NextResponse.json(
    { error: e.message?.trim() || 'Stripe rejected the request.' },
    { status },
  );
}

/**
 * POST /api/venue/change-plan
 * Handle plan changes: cancel, resubscribe, resume.
 * Body: { action: 'cancel' | 'resubscribe' | 'resume_subscription' }
 */
export async function POST(request: Request) {
  try {
    const supabase = await createVenueRouteClient(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const { data: staffRows } = await admin
      .from('staff')
      .select('venue_id, role')
      .ilike('email', escapeLikePattern((user.email ?? '').toLowerCase().trim()))
      .limit(1);
    const staffRow = staffRows?.[0] ?? null;

    if (!staffRow?.venue_id || staffRow.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: venue } = await admin
      .from('venues')
      .select('id, pricing_tier, stripe_customer_id, stripe_subscription_id, calendar_count, booking_model')
      .eq('id', staffRow.venue_id)
      .single();

    if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

    const body = await request.json();
    const { action } = body as {
      action: 'upgrade' | 'downgrade' | 'cancel' | 'resubscribe' | 'resume_subscription';
    };

    const origin = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

    const requireStripeCustomer = () => {
      const cid = venue.stripe_customer_id as string | null;
      if (!cid?.trim()) {
        return NextResponse.json(
          { error: 'No billing customer on file. Contact support or complete signup billing first.' },
          { status: 400 },
        );
      }
      return null;
    };

    /**
     * Stripe Checkout for a fresh subscription on the venue's current tier.
     * Used both by `resubscribe` and by `resume_subscription` when the old
     * subscription has already closed and cannot be revived.
     */
    const startResubscribeCheckout = async (): Promise<NextResponse> => {
      const custErr = requireStripeCustomer();
      if (custErr) return custErr;
      const tier = ((venue.pricing_tier as string) ?? 'appointments').toLowerCase();

      let lineItems;
      if (tier === 'light') {
        try {
          lineItems = buildLightPlanCheckoutLineItems(1);
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Light plan prices not configured';
          console.error('[change-plan] Light resubscribe:', msg);
          return NextResponse.json({ error: msg }, { status: 500 });
        }
      } else {
        const priceIdMap: Record<string, string | undefined> = {
          appointments: process.env.STRIPE_APPOINTMENTS_PRO_PRICE_ID,
          plus: process.env.STRIPE_APPOINTMENTS_PLUS_PRICE_ID,
          restaurant: process.env.STRIPE_RESTAURANT_PRICE_ID,
          founding: process.env.STRIPE_RESTAURANT_PRICE_ID,
        };
        const priceId = priceIdMap[tier];
        if (!priceId) {
          return NextResponse.json({ error: 'Price not configured' }, { status: 500 });
        }
        lineItems = buildCheckoutLineItems(priceId, 1);
      }

      const session = await stripe.checkout.sessions.create({
        customer: venue.stripe_customer_id as string,
        mode: 'subscription',
        allow_promotion_codes: true,
        payment_method_collection: 'always',
        line_items: lineItems,
        metadata: {
          venue_id: venue.id,
          plan: tier,
          action: 'resubscribe',
        },
        success_url: `${origin}/dashboard/settings?tab=plan&resubscribed=true`,
        cancel_url: `${origin}/dashboard/settings?tab=plan`,
      });

      return NextResponse.json({ redirect_url: session.url });
    };

    switch (action) {
      case 'upgrade':
      case 'downgrade': {
        // Upgrade/downgrade between plans is no longer supported.
        // Plans are now business-type-specific (Appointments vs Restaurant).
        return NextResponse.json(
          { error: 'Plan switching is no longer available. Contact support if you need to change your plan type.' },
          { status: 400 },
        );
      }

      case 'cancel': {
        if (!venue.stripe_subscription_id) {
          return NextResponse.json({ error: 'No active subscription' }, { status: 400 });
        }
        const sub = await stripe.subscriptions.update(venue.stripe_subscription_id as string, {
          cancel_at_period_end: true,
        });
        const periodEndIso = subscriptionPeriodEndIso(sub) ?? subscriptionCancelAtIso(sub);
        const periodStartIso = subscriptionPeriodStartIso(sub);
        await admin
          .from('venues')
          .update({
            plan_status: 'cancelling',
            subscription_current_period_start: periodStartIso,
            subscription_current_period_end: periodEndIso,
          })
          .eq('id', venue.id);
        return NextResponse.json({ ok: true, message: 'Subscription will cancel at end of billing period' });
      }

      case 'resume_subscription': {
        if (!venue.stripe_subscription_id) {
          return NextResponse.json({ error: 'No subscription to resume' }, { status: 400 });
        }
        // A subscription cancelled outright (from the Stripe dashboard, by the
        // API, or by Stripe after failed retries) still shows as "cancelling"
        // here while its paid period runs, because the venue keeps access until
        // then. Stripe will not let that be un-cancelled, so send the admin to
        // checkout for a new one rather than failing at them.
        const existing = await stripe.subscriptions.retrieve(
          venue.stripe_subscription_id as string,
        );
        const existingStatus = subscriptionStatus(existing);
        if (existingStatus && UNRESUMABLE_STRIPE_STATUSES.has(existingStatus)) {
          return startResubscribeCheckout();
        }

        const sub = await stripe.subscriptions.update(venue.stripe_subscription_id as string, {
          cancel_at_period_end: false,
        });
        const periodEndIso = subscriptionPeriodEndIso(sub) ?? subscriptionCancelAtIso(sub);
        const periodStartIso = subscriptionPeriodStartIso(sub);
        const st = subscriptionStatus(sub);
        await admin
          .from('venues')
          .update({
            plan_status: st === 'trialing' ? 'trialing' : 'active',
            subscription_current_period_start: periodStartIso,
            subscription_current_period_end: periodEndIso,
          })
          .eq('id', venue.id);
        return NextResponse.json({ ok: true, message: 'Subscription will continue' });
      }

      case 'resubscribe':
        return startResubscribeCheckout();

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (err) {
    console.error('[change-plan] Error:', err);
    return stripeErrorResponse(err) ?? NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
