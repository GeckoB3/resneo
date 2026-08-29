import { buildBookingDetailDto, type BookingDetailDto } from '@/lib/booking/booking-detail-dto';
import { loadAndAuthoriseGuestBooking } from './authorise';
import { actionSuccess, type GuestActionActor, type GuestActionClients, type GuestActionResult } from './types';

/**
 * One booking, as the guest may see it (P2-4, AD9).
 *
 * The authorisation half of the shared detail surface. `buildBookingDetailDto`
 * deliberately takes an already-authorised row and performs no checks of its
 * own; this is where the check happens, through the same primitive the actions
 * use, so a booking that is not the caller's is a 404 here exactly as it is on
 * cancel and reschedule.
 *
 * The token surface does not come through here. `GET /api/confirm` keeps its
 * own inline auth, whose 404-before-any-proof ordering and 410 on a used token
 * are pinned by `characterisation/detail.test.ts`; routing it through the
 * session primitive would change the response bodies those snapshots hold.
 * Both paths converge on the same builder, which is what AD9 needs.
 */
export async function getBookingDetailForGuest(
  clients: GuestActionClients,
  params: { bookingId: string; actor: GuestActionActor },
): Promise<GuestActionResult<BookingDetailDto>> {
  const loaded = await loadAndAuthoriseGuestBooking(clients, params.bookingId, params.actor);
  if (!loaded.ok) return loaded;
  /*
   * `includeManageUrl: false`: everything reaching here is a signed-in
   * customer, on the portal or on `/api/v1/me`, and both have authenticated
   * actions of their own. Minting a cancel-without-login short link for them
   * would write a row per page view and hand a credential to a browser that
   * already holds a session (P2-5).
   */
  return actionSuccess(
    await buildBookingDetailDto(clients.admin, loaded.data, { includeManageUrl: false }),
  );
}
