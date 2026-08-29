import { runSessionBookingAction } from '@/lib/api/session-booking-action';
import { cancelBookingForGuest } from '@/lib/booking/guest-actions/cancel';

type Params = { params: Promise<{ id: string }> };

/**
 * Cancel one of the caller's own bookings from the portal (P2-1, AD1).
 *
 * The portal's spelling of an action the versioned surface already has as
 * `DELETE /api/v1/me/bookings/[id]`. Both are thin adapters over the same
 * service function, so they cannot diverge in behaviour; what differs is only
 * which surface a client is already talking to. That is also why this route
 * has no v1 alias: cancel is on v1 as a DELETE on the resource, and publishing
 * a second spelling of it there would be the same duplication P2-1's acceptance
 * rules out for the detail endpoint.
 *
 * A session actor does NOT consume the booking's confirm token. The emailed
 * link stays usable, because a portal cancel is not that link being followed.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return runSessionBookingAction(request, ({ clients, actor }) =>
    cancelBookingForGuest(clients, { bookingId: id, actor }),
  );
}
