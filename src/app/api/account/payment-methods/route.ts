import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';

/**
 * GET /api/account/payment-methods?venue_id=...
 * Lists saved cards for the signed-in user on the **venue's Stripe Connect account**
 * (per-venue Customer via `venue_customer_stripe`).
 */
export async function GET(request: Request) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorised', code: 'UNAUTHENTICATED' }, { status: 401 });

    const venueId = new URL(request.url).searchParams.get('venue_id');
    if (!venueId) {
      return NextResponse.json({
        payment_methods: [],
        capability: 'per_venue_connected_account',
        message:
          'Provide venue_id to list cards saved for that venue. Cards are stored on the venue Stripe Connect account only.',
      });
    }

    const admin = getSupabaseAdminClient();
    const { data: venue, error: vErr } = await admin
      .from('venues')
      .select('id, stripe_connected_account_id')
      .eq('id', venueId)
      .maybeSingle();

    if (vErr || !venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    const acct = (venue as { stripe_connected_account_id?: string | null }).stripe_connected_account_id?.trim();
    if (!acct) {
      return NextResponse.json({ error: 'Venue has not connected Stripe' }, { status: 400 });
    }

    const { data: row } = await admin
      .from('venue_customer_stripe')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .eq('venue_id', venueId)
      .maybeSingle();

    const customerId = (row as { stripe_customer_id?: string } | null)?.stripe_customer_id;
    if (!customerId) {
      return NextResponse.json({ payment_methods: [] });
    }

    const list = await stripe.paymentMethods.list(
      { customer: customerId, type: 'card' },
      { stripeAccount: acct },
    );

    /*
      NO Stripe identifiers (G29, §6). This route used to hand the customer
      `stripe_customer_id` and `stripe_connected_account_id`, which are the
      venue's payment plumbing and name its Connect account: nothing a customer
      can do with them is something they should be doing, and they end up in
      browser history, screenshots and support tickets. P4-6 removes them from
      the exact route it was already modifying.
    */
    return NextResponse.json({
      payment_methods: list.data.map((pm) => ({
        id: pm.id,
        brand: pm.card?.brand ?? null,
        last4: pm.card?.last4 ?? null,
        exp_month: pm.card?.exp_month ?? null,
        exp_year: pm.card?.exp_year ?? null,
      })),
    });
  } catch (e) {
    console.error('[account/payment-methods] GET', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
