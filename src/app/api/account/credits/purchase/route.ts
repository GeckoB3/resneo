import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { ensureVenueStripeCustomerForUser } from '@/lib/class-commerce/venue-stripe-customer';
import { RESERVE_NI_PI_PURPOSE } from '@/types/class-commerce';

const bodySchema = z.object({
  venue_id: z.string().uuid(),
  product_id: z.string().uuid(),
});

/**
 * POST /api/account/credits/purchase — authenticated user starts payment for a credit pack.
 * Returns PaymentIntent client_secret on the venue connected account.
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
      return NextResponse.json({ error: 'Venue has not connected Stripe payments' }, { status: 400 });
    }

    const { data: product, error: pErr } = await admin
      .from('class_credit_products')
      .select('*')
      .eq('id', product_id)
      .eq('venue_id', venue_id)
      .eq('active', true)
      .maybeSingle();

    if (pErr || !product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const pricePence = (product as { price_pence: number }).price_pence;
    if (pricePence <= 0) {
      return NextResponse.json(
        { error: 'Free credit packs are not purchased online; ask the venue to grant credits.' },
        { status: 400 },
      );
    }

    const { stripeCustomerId } = await ensureVenueStripeCustomerForUser(admin, {
      userId: user.id,
      venueId: venue_id,
      stripeConnectedAccountId: acct,
      email: user.email,
    });

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: pricePence,
        currency: 'gbp',
        customer: stripeCustomerId,
        automatic_payment_methods: { enabled: true },
        metadata: {
          reserve_ni_purpose: RESERVE_NI_PI_PURPOSE.CLASS_CREDIT_PURCHASE,
          user_id: user.id,
          venue_id,
          product_id,
        },
      },
      { stripeAccount: acct },
    );

    return NextResponse.json({
      client_secret: paymentIntent.client_secret,
      stripe_account_id: acct,
      payment_intent_id: paymentIntent.id,
    });
  } catch (e) {
    console.error('[account/credits/purchase]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
