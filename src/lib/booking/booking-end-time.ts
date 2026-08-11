/**
 * The two end-time columns a booking row carries, derived from one place.
 *
 * `bookings` stores the end of a booking's core segment twice, in two encodings,
 * and they must always describe the same instant:
 *
 * - `booking_end_time` — venue-local wall clock, `HH:mm:ss`. What the availability
 *   engine trusts above everything else, and what every schedule reader prefers.
 * - `estimated_end_time` — that same wall clock encoded as UTC via `Date.UTC(...)`,
 *   so reading it back with `toISOString()` returns the wall clock again.
 *
 * Writing them from separate arithmetic is how they drifted: several paths wrote
 * only `estimated_end_time`, leaving the engine to fall back to the CURRENT
 * catalogue duration and value a 150-minute variant booking as its 30-minute
 * parent. Derive both from these helpers so a path cannot write one alone.
 *
 * Neither includes buffer or processing time: this is the core bookable segment,
 * the span the customer is present for.
 */

function startMinutes(startHHmm: string): number {
  const hh = Number(startHHmm.slice(0, 2));
  const mm = Number(startHHmm.slice(3, 5));
  return hh * 60 + mm;
}

/**
 * Venue-local wall-clock end for `bookings.booking_end_time`.
 *
 * Wraps past midnight, which is correct for a bare `time` column: the booking's
 * date lives in `booking_date`, so a 23:30 start running 60 minutes stores
 * `00:30:00`.
 */
export function bookingEndTimeForStorage(startHHmm: string, durationMinutes: number): string {
  const endMin = (startMinutes(startHHmm) + Math.max(0, durationMinutes)) % (24 * 60);
  const hh = String(Math.floor(endMin / 60)).padStart(2, '0');
  const mm = String(endMin % 60).padStart(2, '0');
  return `${hh}:${mm}:00`;
}

/**
 * ISO value for `bookings.estimated_end_time`, using the venue-local-wall-clock
 * -as-UTC convention every appointment create path already writes. Rolls into
 * the next day on its own when the segment crosses midnight.
 */
export function estimatedEndTimeForStorage(
  dateYmd: string,
  startHHmm: string,
  durationMinutes: number,
): string {
  const [y, mo, d] = dateYmd.split('-').map(Number);
  const end = new Date(Date.UTC(y!, mo! - 1, d!, 0, 0, 0));
  end.setUTCMinutes(startMinutes(startHHmm) + Math.max(0, durationMinutes));
  return end.toISOString();
}

/** Both columns for one core segment, guaranteed to agree. */
export function bookingEndFieldsForStorage(params: {
  dateYmd: string;
  startHHmm: string;
  durationMinutes: number;
}): { booking_end_time: string; estimated_end_time: string } {
  const { dateYmd, startHHmm, durationMinutes } = params;
  return {
    booking_end_time: bookingEndTimeForStorage(startHHmm, durationMinutes),
    estimated_end_time: estimatedEndTimeForStorage(dateYmd, startHHmm, durationMinutes),
  };
}
