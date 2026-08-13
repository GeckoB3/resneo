import {
  MIN_APPOINTMENT_CORE_DURATION_MINUTES,
  minutesBetweenStartAndEndHM,
} from '@/lib/booking/validate-appointment-modification';

/**
 * Shortest bookable segment the appointment engine accepts.
 *
 * Was its own 15 while the engine allowed 5, so this clamp silently rounded a
 * short appointment back up: the modify form opened a 5 minute booking showing 15.
 */
export const MIN_CORE_DURATION_MINUTES = MIN_APPOINTMENT_CORE_DURATION_MINUTES;

export interface BookingCoreDurationSource {
  /** Venue-local start, HH:mm or HH:mm:ss. */
  booking_time: string;
  /** Venue-local wall-clock end of the bookable segment, when the row has one. */
  booking_end_time?: string | null;
  /**
   * End instant written by create/modify as the venue-local wall clock encoded
   * as UTC (see `Date.UTC(...)` in the create routes), so reading it back with
   * `toISOString()` returns that wall clock again.
   */
  estimated_end_time?: string | null;
}

/**
 * The core duration a booking ALREADY has, or null when the row carries no end
 * time at all.
 *
 * Null is deliberate, not a defect: callers must decide what an unknown
 * duration means rather than inherit a made-up number. The staff modify form
 * previously defaulted to 30 minutes here, so a row that reached it without an
 * end time silently proposed shrinking the appointment to half an hour (and,
 * for a service with processing time, produced a duration too short to hold
 * the stored blocks). It now adopts the service's catalogue duration instead.
 */
export function resolveBookingCoreDurationMinutes(
  booking: BookingCoreDurationSource,
): number | null {
  const start = booking.booking_time.slice(0, 5);

  const wallEnd = booking.booking_end_time?.trim();
  if (wallEnd && wallEnd.length >= 5) {
    return Math.max(MIN_CORE_DURATION_MINUTES, minutesBetweenStartAndEndHM(start, wallEnd.slice(0, 5)));
  }

  const iso = booking.estimated_end_time?.trim();
  if (iso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) {
      const hm = d.toISOString().slice(11, 16);
      return Math.max(MIN_CORE_DURATION_MINUTES, minutesBetweenStartAndEndHM(start, hm));
    }
  }

  return null;
}
