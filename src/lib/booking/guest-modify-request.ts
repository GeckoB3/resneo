/**
 * Where a guest's "change my booking" request goes, given who is asking (P2-3).
 *
 * There are four modify surfaces (table, resource, class, appointment) and, as
 * of the portal, three actors. Before this, each surface hand-rolled the same
 * `fetch('/api/confirm', {booking_id, ...auth, action:'modify', ...})`, which
 * worked because there was only ever one actor that could act: the emailed
 * link. A signed-in customer carries no token, so every one of those four
 * fetches would have posted a modify with no credential and been refused.
 *
 * Wiring them one at a time is how three of the four end up wired and the
 * fourth quietly stays token-only, so the decision lives here once. Adding an
 * actor is then one change, not four, and the surfaces cannot disagree about
 * which route a modify goes to.
 *
 * **The two routes take different bodies, and that is deliberate, not an
 * oversight.** `/api/confirm` is the token surface's multiplexer and needs to
 * be told which booking and which action; the account route has the booking in
 * its path and does nothing but reschedule, so a body that named either again
 * would be a second place for them to disagree. Both answer failures with the
 * same `{ error }` key, which is why callers need no branch after this one.
 */
import type { GuestBookingDetailActor } from '@/lib/booking/guest-booking-actor';

/**
 * The fields a modify can carry, across all four booking models. Every one is
 * optional because no surface sends them all: a class move sends only its
 * target instance, and a table move sends no practitioner.
 */
export interface GuestModifyChanges {
  booking_date?: string;
  booking_time?: string | null;
  party_size?: number;
  practitioner_id?: string;
  appointment_service_id?: string;
  duration_minutes?: number | null;
  booking_end_time?: string | null;
  target_class_instance_id?: string;
}

export interface GuestModifyRequest {
  url: string;
  body: Record<string, unknown>;
}

/**
 * Build the request, or `null` when this actor cannot perform a modify.
 *
 * Null rather than a throw: the caller's job at that point is to not render a
 * button, and a component that has to try/catch to find out whether an action
 * exists will end up rendering the button anyway.
 */
export function buildGuestModifyRequest(
  actor: GuestBookingDetailActor,
  bookingId: string,
  changes: GuestModifyChanges,
): GuestModifyRequest | null {
  if (actor.kind === 'session') {
    return {
      url: `/api/account/bookings/${encodeURIComponent(bookingId)}/reschedule`,
      body: { ...changes },
    };
  }
  return {
    url: '/api/confirm',
    body: {
      booking_id: bookingId,
      ...(actor.kind === 'token' ? { token: actor.token } : { hmac: actor.hmac }),
      action: 'modify',
      ...changes,
    },
  };
}

/**
 * The one message a failed modify shows.
 *
 * Lifted from the four copies that were drifting: three of them special-cased
 * 412 and one did not, so the same lost update read as "updated elsewhere" on a
 * table booking and "Failed to update booking." on a class.
 */
export async function readGuestModifyError(res: Response): Promise<string> {
  if (res.status === 412) {
    return 'This booking was updated elsewhere. Refresh the page and try again.';
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  return body.error ?? body.message ?? 'Failed to update booking.';
}
