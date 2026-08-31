import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { loadAccountPayments } from '@/lib/account/account-payments';
import { NO_STORE_HEADERS } from '@/lib/api/error-codes';

/**
 * GET /api/account/payments - what the customer has paid (P4-2).
 *
 * Optionally `?booking_id=` for a single booking's receipt.
 *
 * **A booking that is not the caller's returns 404, not an empty list.** The
 * two are different claims: an empty list says "this booking of yours has no
 * payments", and answering that about somebody else's booking would confirm
 * the booking exists. 404 says only "there is no such booking here", which is
 * all a stranger is entitled to learn.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorised', code: 'UNAUTHENTICATED' },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const bookingId = request.nextUrl.searchParams.get('booking_id')?.trim() || null;
    const { payments, ownedBookingIds } = await loadAccountPayments(
      supabase,
      getSupabaseAdminClient(),
      { bookingId },
    );

    if (bookingId && ownedBookingIds.length === 0) {
      return NextResponse.json(
        { error: 'Not found', code: 'NOT_FOUND' },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    /*
      Never cached. This is a financial record keyed to one person, and the
      acceptance requires a payment taken at the counter to appear on the next
      refresh, which a cached response would quietly prevent.
    */
    return NextResponse.json({ payments }, { headers: NO_STORE_HEADERS });
  } catch (e) {
    console.error('[account/payments]', e);
    return NextResponse.json(
      { error: 'Internal error', code: 'INTERNAL_ERROR' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
