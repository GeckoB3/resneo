import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { ensureVenueStripeCustomerForUser } from '@/lib/class-commerce/venue-stripe-customer';
import { RESERVE_NI_SUBSCRIPTION_PURPOSE } from '@/types/class-commerce';

const bodySchema = z.object({
  venue_id: z.string().uuid(),
  product_id: z.string().uuid(),
});

/**
 * POST /api/account/memberships/checkout (P0-17, implements C9)
 *
 * WHAT THIS REPLACED. It created a hosted Stripe Checkout session and returned
 * `{ url }` for the browser to navigate to, with a `success_url` of
 * `/account/memberships?checkout=success`. In an app webview with no cookie
 * that URL hits middleware, resolves no user, and redirects to `/login`, so a
 * customer who had just been charged for a subscription was shown a sign-in
 * page. It was the only money route in the app not returning a `client_secret`;
 * `credits/purchase`, `courses/checkout` and `payment-methods/setup-intent` all
 * already did.
 *
 * WHAT IT DOES NOW. Creates a SetupIntent on the venue's connected account and
 * returns its `client_secret`, exactly like the other three. The client
 * confirms the card in a Payment Element it already renders, and the
 * subscription is created SERVER SIDE from the `setup_intent.succeeded`
 * webhook.
 *
 * Why the webhook rather than a second call from the client: the card is
 * already saved by then, so a client that closes its tab between confirming and
 * calling back would leave a customer with a saved card and no membership, and
 * nothing to reconcile it from. The webhook is the only participant guaranteed
 * to run.
 *
 * Nothing downstream changed. `syncClassMembershipFromStripeSubscription` reads
 * `customer.subscription.created` and keys off the subscription's metadata, not
 * off `checkout.session.completed`, so the recording path is untouched by this
 * rework. The metadata below is what carries the purchase across the gap.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) {
      return NextResponse.json({ error: 'Unauthorised', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const json = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const { venue_id, product_id } = parsed.data;

    const { data: venue, error: vErr } = await admin
      .from('venues')
      .select('id, name, stripe_connected_account_id')
      .eq('id', venue_id)
      .maybeSingle();

    if (vErr || !venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    const acct = (venue as { stripe_connected_account_id?: string | null }).stripe_connected_account_id?.trim();
    if (!acct) {
      return NextResponse.json({ error: 'Venue has not connected Stripe' }, { status: 400 });
    }

    const { data: product, error: pErr } = await admin
      .from('class_membership_products')
      .select('*')
      .eq('id', product_id)
      .eq('venue_id', venue_id)
      .eq('active', true)
      .maybeSingle();

    if (pErr || !product) {
      return NextResponse.json({ error: 'Membership product not found' }, { status: 404 });
    }

    const priceId = (product as { stripe_price_id?: string | null }).stripe_price_id?.trim();
    if (!priceId) {
      return NextResponse.json(
        { error: 'This membership plan is not linked to a Stripe price yet. Ask the venue admin to add a price ID.' },
        { status: 400 },
      );
    }

    // Refuse a second subscription to the same plan rather than letting the
    // webhook create one. A customer who double-taps would otherwise be billed
    // twice on the venue's account, and the only cure is a manual refund.
    const { data: existing } = await admin
      .from('class_memberships')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('venue_id', venue_id)
      .eq('product_id', product_id)
      .in('status', ['active', 'trialing', 'past_due'])
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: 'You already have this membership.', code: 'ALREADY_ENROLLED' },
        { status: 409 },
      );
    }

    const { stripeCustomerId } = await ensureVenueStripeCustomerForUser(admin, {
      userId: user.id,
      venueId: venue_id,
      stripeConnectedAccountId: acct,
      email: user.email,
    });

    const setupIntent = await stripe.setupIntents.create(
      {
        customer: stripeCustomerId,
        payment_method_types: ['card'],
        // The subscription charges this card on a schedule with nobody present.
        usage: 'off_session',
        metadata: {
          reserve_ni_purpose: RESERVE_NI_SUBSCRIPTION_PURPOSE.CLASS_MEMBERSHIP,
          user_id: user.id,
          venue_id,
          product_id,
        },
      },
      { stripeAccount: acct },
    );

    if (!setupIntent.client_secret) {
      return NextResponse.json({ error: 'Could not start checkout' }, { status: 500 });
    }

    return NextResponse.json({
      client_secret: setupIntent.client_secret,
      stripe_account_id: acct,
      setup_intent_id: setupIntent.id,
      venue_id,
      product_id,
    });
  } catch (e) {
    console.error('[account/memberships/checkout]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
