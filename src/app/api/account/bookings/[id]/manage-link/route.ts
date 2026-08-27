import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { loadAccountBookingById } from '@/lib/account/account-bookings';
import { createOrGetBookingShortLink } from '@/lib/booking-short-links';
import { apiError, NO_STORE_HEADERS, UNAUTHORISED_ERROR } from '@/lib/api/error-codes';

/**
 * POST /api/account/bookings/[id]/manage-link (P0-3)
 *
 * Mints, or returns, the `/b/{code}` manage link for one of the caller's own
 * bookings. It exists so that rendering a list of bookings does not write to
 * the database: `hydrateAccountBookingRow` used to mint a link for every row on
 * every GET, so opening the bookings page wrote a hundred rows and issued a
 * hundred extra queries to produce links a customer would almost never click.
 * Minting on intent turns that into one write when someone actually asks.
 *
 * POST rather than GET deliberately: this creates a token-bearing link, and a
 * GET that writes is the defect this task exists to remove.
 *
 * Ownership comes from `loadAccountBookingById`, which reads
 * `bookings_account_safe` as the caller (AD8). A booking belonging to someone
 * else is indistinguishable from one that does not exist, which is the correct
 * answer to give.
 *
 * EXEMPT FROM C7a (no /api/v1 alias): P2-5 performs cancel and reschedule in
 * the portal itself and deletes this route, so aliasing it would publish a
 * route on the versioned surface only to remove it two phases later. Recorded
 * in src/lib/api/customer-api-contract.test.ts.
 */

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createRouteHandlerClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(apiError(UNAUTHORISED_ERROR, 'UNAUTHENTICATED'), {
      status: 401,
      headers: NO_STORE_HEADERS,
    });
  }

  try {
    const booking = await loadAccountBookingById(supabase, getSupabaseAdminClient(), id);
    if (!booking) {
      return NextResponse.json(apiError('Booking not found', 'NOT_FOUND'), {
        status: 404,
        headers: NO_STORE_HEADERS,
      });
    }

    const url = await createOrGetBookingShortLink({
      venueId: booking.venue_id,
      bookingId: booking.id,
      purpose: 'manage',
    });

    return NextResponse.json({ url }, { headers: NO_STORE_HEADERS });
  } catch (e) {
    console.error('[account/bookings/manage-link]', e);
    return NextResponse.json(
      apiError('Could not open this booking. Please try again.', 'INTERNAL_ERROR'),
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
