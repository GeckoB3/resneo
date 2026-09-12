/**
 * Shared shapes for "this calendar is dropping a service that already has bookings".
 *
 * Client-safe on purpose: the API route builds these rows and the dashboard dialog
 * renders them, so the wire shape lives in one place with no server imports.
 */

/** One upcoming booking left on a calendar that is dropping its service. */
export interface ServiceRemovalAffectedBooking {
  id: string;
  /** `service_items.id` (unified scheduling) or `appointment_services.id` (legacy). */
  service_id: string;
  service_name: string;
  /** Calendar column the booking sits on. */
  calendar_id: string;
  calendar_name: string;
  booking_date: string;
  /** HH:mm */
  booking_time: string;
  /** HH:mm, or null when the row carries no resolvable end. */
  end_time: string | null;
  guest_name: string;
  party_size: number;
  status: string;
}

/** The 409 body from a service-link save that would leave upcoming bookings behind. */
export interface ServiceRemovalConfirmation {
  message: string;
  bookings: ServiceRemovalAffectedBooking[];
  total: number;
  truncated: boolean;
}

export interface ServiceRemovalMove {
  bookingId: string;
  targetCalendarId: string;
}

export interface ServiceRemovalMoveFailure {
  bookingId: string;
  label: string;
  reason: string;
}

export function affectedBookingDateLabel(ymd: string): string {
  const parsed = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return ymd;
  const thisYear = new Date().getUTCFullYear();
  return parsed.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(parsed.getUTCFullYear() === thisYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  });
}

/** "Alex Smith, Tue 14 Oct, 10:00" for failure lines. */
export function affectedBookingLabel(booking: ServiceRemovalAffectedBooking): string {
  return `${booking.guest_name}, ${affectedBookingDateLabel(booking.booking_date)}, ${booking.booking_time}`;
}

/**
 * Reads a 409 body from `/api/venue/practitioner-services` or
 * `/api/venue/appointment-services`. Returns null for any other failure, which the
 * caller should surface as a plain error.
 */
export function parseServiceRemovalConfirmation(payload: unknown): ServiceRemovalConfirmation | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as {
    requires_confirmation?: unknown;
    message?: unknown;
    affected_bookings?: unknown;
    affected_total?: unknown;
    affected_truncated?: unknown;
  };
  if (body.requires_confirmation !== true || !Array.isArray(body.affected_bookings)) return null;
  const bookings = body.affected_bookings as ServiceRemovalAffectedBooking[];
  return {
    message:
      typeof body.message === 'string' && body.message.trim() !== ''
        ? body.message
        : 'Some upcoming bookings are already booked for this service on this calendar.',
    bookings,
    total: typeof body.affected_total === 'number' ? body.affected_total : bookings.length,
    truncated: body.affected_truncated === true,
  };
}

/**
 * Moves each chosen booking onto its target calendar, one at a time so a single clash
 * cannot take the rest down with it. Same date and time, same duration: only the column
 * changes, so the guest is not notified and nothing is cancelled.
 */
export async function moveAffectedBookings(
  moves: ServiceRemovalMove[],
  bookings: ServiceRemovalAffectedBooking[],
): Promise<{ movedIds: Set<string>; failures: ServiceRemovalMoveFailure[] }> {
  const byId = new Map(bookings.map((b) => [b.id, b] as const));
  const movedIds = new Set<string>();
  const failures: ServiceRemovalMoveFailure[] = [];

  for (const move of moves) {
    const booking = byId.get(move.bookingId);
    if (!booking) continue;
    try {
      const res = await fetch(`/api/venue/bookings/${booking.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          practitioner_id: move.targetCalendarId,
          booking_date: booking.booking_date,
          booking_time: booking.booking_time,
          // Without an explicit end the route re-derives one from the service's
          // default duration, which would quietly reset a custom length.
          ...(booking.end_time ? { booking_end_time: booking.end_time } : {}),
          // The booking already exists at this time; the target calendar's hours and
          // breaks are not a reason to refuse the move. A clash with another booking
          // still is, so `allow_manual_overlap` is deliberately not sent.
          allow_outside_hours: true,
          allow_during_breaks: true,
          // Belt and braces: the route only emails on a date or time change, and this
          // move changes neither.
          skip_booking_modification_guest_notification: true,
        }),
      });
      if (res.ok) {
        movedIds.add(booking.id);
        continue;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      failures.push({
        bookingId: booking.id,
        label: affectedBookingLabel(booking),
        reason: body.error ?? 'This booking could not be moved.',
      });
    } catch {
      failures.push({
        bookingId: booking.id,
        label: affectedBookingLabel(booking),
        reason: 'The move could not be sent. Check your connection and try again.',
      });
    }
  }

  return { movedIds, failures };
}
