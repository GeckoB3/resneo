import { verifyConfirmToken } from '@/lib/confirm-token';
import { verifyBookingHmac } from '@/lib/short-manage-link';
import { loadAccountSafeGuests } from '@/lib/account/account-bookings';
import {
  actionFailure,
  actionSuccess,
  type GuestActionActor,
  type GuestActionBooking,
  type GuestActionClients,
  type GuestActionResult,
} from './types';

/**
 * The one place a guest action decides whether the caller may act (AD1).
 *
 * The three proofs are genuinely different and the differences are load
 * bearing, so they are enumerated here rather than smoothed into a single
 * check:
 *
 *  - TOKEN is single use. An already-consumed token is a 410, not a 400, and
 *    that distinction is what tells a guest "you already did this" apart from
 *    "this link is wrong". Note that consuming it is NOT this function's job:
 *    `confirm` stamps `confirm_token_used_at` and `modify` deliberately does
 *    not, which `reschedule-cancellation-deadline.ts` records.
 *  - HMAC is a signature over the booking id with no state, so it is reusable
 *    by design: the manage link in a confirmation email has to keep working.
 *  - SESSION is the new one. It resolves the caller's guest ids from
 *    `auth.uid()` through the session client and then reads the booking from
 *    `bookings_account_safe` AS THE CALLER, so both of AD8's layers are
 *    enforced here rather than by whoever called this.
 *
 * When both a token and an HMAC are supplied the HMAC wins, because that is
 * what `/api/confirm` does today and the characterisation snapshots pin it.
 */

/** The columns `/api/confirm` selects. Kept verbatim so the actions see the same row. */
export const GUEST_ACTION_BOOKING_COLUMNS =
  'id, venue_id, guest_id, booking_date, booking_time, booking_end_time, party_size, status, deposit_status, deposit_amount_pence, stripe_payment_intent_id, cancellation_deadline, confirm_token_hash, confirm_token_used_at, service_id, practitioner_id, appointment_service_id, calendar_id, service_item_id, service_variant_id, addons_total_duration_minutes, experience_event_id, class_instance_id, resource_id, event_session_id, updated_at, guest_attendance_confirmed_at, location_type, client_address_line1, client_address_line2, client_address_city, client_address_postcode, special_requests, dietary_notes, occasion, cancellation_actor_type, created_at, group_booking_id';

/**
 * Load the booking and authorise the actor against it, in that order.
 *
 * The order matters and is not arbitrary: `/api/confirm` returns 404 for a
 * missing booking BEFORE it validates any proof, so a bad token on a
 * non-existent booking is a 404 rather than a 400. Reversing it would change
 * what an attacker probing ids can distinguish, and would move a snapshot.
 */
export async function loadAndAuthoriseGuestBooking(
  clients: GuestActionClients,
  bookingId: string,
  actor: GuestActionActor,
): Promise<GuestActionResult<GuestActionBooking>> {
  const { data: booking, error } = await clients.admin
    .from('bookings')
    .select(GUEST_ACTION_BOOKING_COLUMNS)
    .eq('id', bookingId)
    .single();

  if (error || !booking) {
    return actionFailure(404, 'NOT_FOUND', 'Booking not found');
  }

  const row = booking as GuestActionBooking;
  const denied = await authoriseActor(clients, bookingId, actor, row);
  return denied ?? actionSuccess(row);
}

/**
 * Returns a failure when the actor may not act, or null when they may.
 *
 * Null-for-allowed rather than a boolean because each refusal carries its own
 * status and copy, and collapsing them to `false` would lose the 410.
 */
async function authoriseActor(
  clients: GuestActionClients,
  bookingId: string,
  actor: GuestActionActor,
  booking: GuestActionBooking,
): Promise<Extract<GuestActionResult<never>, { ok: false }> | null> {
  if (actor.kind === 'hmac') {
    return verifyBookingHmac(bookingId, actor.hmac)
      ? null
      : actionFailure(400, 'FORBIDDEN', 'Invalid link');
  }

  if (actor.kind === 'token') {
    if (booking.confirm_token_used_at) {
      return actionFailure(410, 'CONFLICT', 'This link has already been used');
    }
    return verifyConfirmToken(actor.token, booking.confirm_token_hash as string | null)
      ? null
      : actionFailure(400, 'FORBIDDEN', 'Invalid link');
  }

  // Session. Ownership is a property of the database, not of this code: the
  // read below runs as the caller against a view whose own WHERE clause is
  // `guest_id IN (SELECT id FROM guests WHERE user_id = auth.uid())`.
  if (!clients.session) {
    // A session actor with no session client is a programming error, not a
    // customer one. Refusing beats falling through to an admin read that would
    // authorise nobody in particular.
    return actionFailure(403, 'FORBIDDEN', 'You cannot manage this booking.');
  }

  const guests = await loadAccountSafeGuests(clients.session);
  const guestIds = guests.map((g) => g.id);
  if (guestIds.length === 0) {
    return notFoundForSession();
  }

  const { data: owned, error: ownErr } = await clients.session
    .from('bookings_account_safe')
    .select('id')
    .eq('id', bookingId)
    .in('guest_id', guestIds)
    .maybeSingle();

  if (ownErr) {
    console.error('[guest-actions] ownership read failed:', ownErr.message);
    return actionFailure(500, 'INTERNAL_ERROR', 'Could not load this booking. Please try again.');
  }
  return owned ? null : notFoundForSession();
}

/**
 * Someone else's booking is indistinguishable from one that does not exist.
 *
 * A 403 here would confirm the booking is real to anyone enumerating ids, and
 * the customer-visible difference between the two answers is nil.
 */
function notFoundForSession() {
  return actionFailure(404, 'NOT_FOUND', 'Booking not found');
}
