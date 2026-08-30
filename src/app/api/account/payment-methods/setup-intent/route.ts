import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { ensureVenueStripeCustomerForUser } from '@/lib/class-commerce/venue-stripe-customer';

const bodySchema = z.object({
  venue_id: z.string().uuid(),
});

/**
 * POST /api/account/payment-methods/setup-intent — create SetupIntent on the venue connected account.
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
    const { data: venue, error: vErr } = await admin
      .from('venues')
      .select('id, stripe_connected_account_id')
      .eq('id', parsed.data.venue_id)
      .maybeSingle();

    if (vErr || !venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    const acct = (venue as { stripe_connected_account_id?: string | null }).stripe_connected_account_id?.trim();
    if (!acct) {
      return NextResponse.json({ error: 'Venue has not connected Stripe' }, { status: 400 });
    }

    const { stripeCustomerId } = await ensureVenueStripeCustomerForUser(admin, {
      userId: user.id,
      venueId: parsed.data.venue_id,
      stripeConnectedAccountId: acct,
      email: user.email,
    });

    const setupIntent = await stripe.setupIntents.create(
      {
        customer: stripeCustomerId,
        payment_method_types: ['card'],
        usage: 'off_session',
      },
      { stripeAccount: acct },
    );

    return NextResponse.json({
      client_secret: setupIntent.client_secret,
      stripe_account_id: acct,
      setup_intent_id: setupIntent.id,
    });
  } catch (e) {
    console.error('[account/payment-methods/setup-intent]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
