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

      case 'resubscribe': {
        const custErr = requireStripeCustomer();
        if (custErr) return custErr;
        const tier = ((venue.pricing_tier as string) ?? 'appointments').toLowerCase();

        if (tier === 'light') {
          let lineItems;
          try {
            lineItems = buildLightPlanCheckoutLineItems(1);
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'Light plan prices not configured';
            console.error('[change-plan] Light resubscribe:', msg);
            return NextResponse.json({ error: msg }, { status: 500 });
          }

          const session = await stripe.checkout.sessions.create({
            customer: venue.stripe_customer_id as string,
            mode: 'subscription',
            allow_promotion_codes: true,
            payment_method_collection: 'always',
            line_items: lineItems,
            metadata: {
              venue_id: venue.id,
              plan: 'light',
              action: 'resubscribe',
            },
            success_url: `${origin}/dashboard/settings?tab=plan&resubscribed=true`,
            cancel_url: `${origin}/dashboard/settings?tab=plan`,
          });

          return NextResponse.json({ redirect_url: session.url });
        }

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

        const session = await stripe.checkout.sessions.create({
          customer: venue.stripe_customer_id as string,
          mode: 'subscription',
          allow_promotion_codes: true,
          payment_method_collection: 'always',
          line_items: buildCheckoutLineItems(priceId, 1),
          metadata: {
            venue_id: venue.id,
            plan: tier,
            action: 'resubscribe',
          },
          success_url: `${origin}/dashboard/settings?tab=plan&resubscribed=true`,
          cancel_url: `${origin}/dashboard/settings?tab=plan`,
        });

        return NextResponse.json({ redirect_url: session.url });
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (err) {
    console.error('[change-plan] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
