import { NextResponse, after } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { loadAccountBookingById } from '@/lib/account/account-bookings';
import { cancelBookingForGuest } from '@/lib/booking/guest-actions/cancel';
import { apiError, NO_STORE_HEADERS, UNAUTHORISED_ERROR } from '@/lib/api/error-codes';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createRouteHandlerClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised', code: 'UNAUTHENTICATED' }, { status: 401 });

  const booking = await loadAccountBookingById(supabase, getSupabaseAdminClient(), id);
  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ booking });
}

/**
 * Cancel one of the caller's own bookings (P0-4, AD1).
 *
 * WHAT THIS REPLACED. It used to resolve ownership, then mint its own HMAC with
 * `createBookingHmac(id)` and HTTP-POST to `/api/confirm` against its own
 * deployment. A session-authenticated request was laundered into an
 * HMAC-authenticated one and sent over the network to reach logic that lived
 * inside a route handler. It cost a full round trip, it meant the cancel was
 * authorised by a signature this route had just forged for itself rather than
 * by the caller's session, and it made `/api/confirm` a dependency of a
 * versioned API surface. The guest action service exists so this can be a
 * function call.
 *
 * The session actor is what makes it safe: the service resolves the caller's
 * guest ids from `auth.uid()` and reads the booking through
 * `bookings_account_safe` AS THE CALLER before doing anything, so ownership is
 * a property of the database rather than of the `loadAccountBookingById` call
 * that used to sit above the fetch.
 */
export async function DELETE(request: Request, { params }: Params) {
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

  const result = await cancelBookingForGuest(
    { admin: getSupabaseAdminClient(), session: supabase },
    { bookingId: id, actor: { kind: 'session', userId: user.id } },
  );

  // The service hands deferred comms back rather than calling `after()` itself,
  // because nothing under `guest-actions/` may import `next/server`.
  if (result.scheduleNotification) after(result.scheduleNotification);

  if (!result.ok) {
    return NextResponse.json(
      // `code` is additive here, unlike on `/api/confirm` where P0-9's
      // snapshots pin the body. A client can branch on it instead of matching
      // prose, which is the whole point of P0-11's union.
      { error: result.message, code: result.code, ...(result.extra ?? {}) },
      { status: result.status, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(result.data, { headers: NO_STORE_HEADERS });
}
