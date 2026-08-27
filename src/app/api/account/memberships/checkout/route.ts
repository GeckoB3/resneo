import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { ensureVenueStripeCustomerForUser } from '@/lib/class-commerce/venue-stripe-customer';
import { RESERVE_NI_SUBSCRIPTION_PURPOSE } from '@/types/class-commerce';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';

const bodySchema = z.object({
  venue_id: z.string().uuid(),
  product_id: z.string().uuid(),
});

/**
 * POST /api/account/memberships/checkout — Stripe Checkout (subscription) on the venue connected account.
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

    const { stripeCustomerId } = await ensureVenueStripeCustomerForUser(admin, {
      userId: user.id,
      venueId: venue_id,
      stripeConnectedAccountId: acct,
      email: user.email,
    });

    const base =
      process.env.NEXT_PUBLIC_BASE_URL?.trim() !== ''
        ? normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL!)
        : new URL(request.url).origin;

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: stripeCustomerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${base}/account/memberships?checkout=success`,
        cancel_url: `${base}/account/memberships?checkout=cancel`,
        metadata: {
          reserve_ni_purpose: RESERVE_NI_SUBSCRIPTION_PURPOSE.CLASS_MEMBERSHIP,
          user_id: user.id,
          venue_id,
          product_id,
        },
        subscription_data: {
          metadata: {
            reserve_ni_purpose: RESERVE_NI_SUBSCRIPTION_PURPOSE.CLASS_MEMBERSHIP,
            user_id: user.id,
            venue_id,
            product_id,
          },
        },
      },
      { stripeAccount: acct },
    );

    if (!session.url) {
      return NextResponse.json({ error: 'Could not start checkout' }, { status: 500 });
    }

    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error('[account/memberships/checkout]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
