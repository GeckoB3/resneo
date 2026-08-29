import { runSessionBookingAction } from '@/lib/api/session-booking-action';
import { getBookingDetailForGuest } from '@/lib/booking/guest-actions/booking-detail';
import { cancelBookingForGuest } from '@/lib/booking/guest-actions/cancel';

type Params = { params: Promise<{ id: string }> };

/**
 * One of the caller's own bookings, in full (P2-4, AD9).
 *
 * **The body IS the shared booking DTO**, which is the point rather than a
 * convenience: AD9 has `/manage` and `/account/bookings/[bookingId]` render one
 * component, so a rich page over a thin route would put the two back out of
 * step the moment the page needed a field the route did not carry.
 *
 * It used to return `{ booking }` wrapping an `AccountBookingRow`, a second
 * shape describing the same booking with fewer fields and different names.
 * Nothing consumed it: the shipped app is staff-only and never calls this path
 * (§5D.0), so the change is safe to make now and would not have been later.
 *
 * A 404, not a 403, for a booking belonging to someone else. The reasoning is
 * in `guest-actions/authorise.ts`.
 */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return runSessionBookingAction(request, ({ clients, actor }) =>
    getBookingDetailForGuest(clients, { bookingId: id, actor }),
  );
}

/**
 * Cancel one of the caller's own bookings (P0-4, AD1).
 *
 * WHAT THIS REPLACED. It used to resolve ownership, then mint its own HMAC with
 * `createBookingHmac(id)` and HTTP-POST to `/api/confirm` against its own
 * deployment. A session-authenticated request was laundered into an
 * HMAC-authenticated one and sent over the network to reach logic that lived
 * inside a route handler. The guest action service exists so this can be a
 * function call.
 *
 * Kept as DELETE on the resource, which is why P2-1's `/cancel` route has no
 * v1 alias: cancel is already here.
 */
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return runSessionBookingAction(request, ({ clients, actor }) =>
    cancelBookingForGuest(clients, { bookingId: id, actor }),
  );
}
