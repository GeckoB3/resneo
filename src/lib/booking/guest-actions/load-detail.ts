import { loadAndAuthoriseGuestBooking } from './authorise';
import type {
  GuestActionActor,
  GuestActionBooking,
  GuestActionClients,
  GuestActionResult,
} from './types';

/**
 * Load a booking for a guest who may act on it (AD1, P0-4).
 *
 * The read half of the guest action surface: same three actors, same
 * authorisation, same refusals as cancelling or rescheduling, so a caller
 * cannot accidentally read through a weaker check than it would write through.
 *
 * WHAT THIS IS NOT. `GET /api/confirm` builds a large presentation payload for
 * the manage page: venue public data, card-hold summaries, outstanding
 * compliance form links, short links. That builder stays in the route for now,
 * deliberately. P0-9 characterised the POST handler and not the GET, so moving
 * it would be a 300-line refactor with no test that could tell me it still
 * behaves the same, and P0-4's acceptance is that nothing changed. This
 * function is the authorised-row primitive that builder should eventually be
 * layered on, and it is what the portal needs today.
 */
export async function loadGuestBookingDetail(
  clients: GuestActionClients,
  params: { bookingId: string; actor: GuestActionActor },
): Promise<GuestActionResult<GuestActionBooking>> {
  return loadAndAuthoriseGuestBooking(clients, params.bookingId, params.actor);
}
