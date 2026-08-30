import { readJsonBody, runSessionBookingAction } from '@/lib/api/session-booking-action';
import {
  cancelBookingForGuest,
  type CancelBookingData,
} from '@/lib/booking/guest-actions/cancel';
import {
  cancelCourseForGuest,
  type CancelCourseData,
} from '@/lib/booking/guest-actions/cancel-course';
import type { GuestActionResult } from '@/lib/booking/guest-actions/types';

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
 *
 * **`{ scope: 'course' }` cancels every remaining session of the course this
 * booking belongs to** (P2-2a, Register Q-21). A body parameter rather than a
 * route of its own: the thing being cancelled is still one of the caller's
 * bookings, reached at its own id and authorised the same way, and a second
 * route would need its own v1 alias under C7a to publish a second spelling of
 * cancel on the versioned surface. Anything other than 'course' is the single
 * booking, so a client that sends nothing, or sends a scope this route has not
 * heard of, gets the narrower action rather than a wider one.
 *
 * The body is read INSIDE the callback, after the 401, which
 * `account-routes-auth.test.ts` asserts for every route under /api/account.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  // Annotated, because the two branches return different data types and the
  // inferred union of two `GuestActionResult<T>`s is not a
  // `GuestActionResult<A | B>`. The response body is the union either way.
  return runSessionBookingAction<CancelBookingData | CancelCourseData>(
    request,
    async ({ clients, actor }): Promise<GuestActionResult<CancelBookingData | CancelCourseData>> => {
      const body = await readJsonBody(request);
      return body.scope === 'course'
        ? cancelCourseForGuest(clients, { bookingId: id, actor })
        : cancelBookingForGuest(clients, { bookingId: id, actor });
    },
  );
}
