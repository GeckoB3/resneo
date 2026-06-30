import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { stripe } from '@/lib/stripe';
import { STRIPE_LOGIN_LINK_ERROR_MESSAGE } from '@/lib/stripe/connect-error-message';

/**
 * POST /api/venue/stripe-connect/login-link
 *
 * Returns a single-use Stripe Express dashboard login link for the venue's
 * connected account. Login links expire and can't be stored, so we mint one on
 * demand. Admin only: the Express dashboard exposes balances, payouts and bank
 * details.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const { data: venue, error: fetchError } = await staff.db
      .from('venues')
      .select('stripe_connected_account_id')
      .eq('id', staff.venue_id)
      .single();

    if (fetchError || !venue) {
      console.error('POST /api/venue/stripe-connect/login-link - venue lookup failed:', fetchError);
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    if (!venue.stripe_connected_account_id) {
      return NextResponse.json({ error: 'No Stripe account connected' }, { status: 404 });
    }

    const loginLink = await stripe.accounts.createLoginLink(venue.stripe_connected_account_id);

    return NextResponse.json({ url: loginLink.url });
  } catch (err) {
    // Full Stripe detail stays in the logs; the admin sees a short dashboard-specific
    // message (the account is already connected, so onboarding copy would mislead).
    console.error('POST /api/venue/stripe-connect/login-link failed:', err);
    return NextResponse.json({ error: STRIPE_LOGIN_LINK_ERROR_MESSAGE }, { status: 500 });
  }
}
