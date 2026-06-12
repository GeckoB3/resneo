/**
 * Per-service booking interval + per-hour start marks.
 *
 * A service offers candidate start times on a grid anchored to the top of each hour. The grid
 * spacing is `booking_interval_minutes` (1-60). Optionally, `booking_minute_marks` restricts which
 * of those grid offsets (minutes 0-59 within the hour) are actually bookable, so a venue can e.g.
 * take bookings every 5 minutes for the first half of each hour, or only on the hour and quarter past.
 *
 * This module is the single source of truth shared by the availability engine, the save/validation
 * API, and the dashboard form, so all three agree on the grid and on what counts as a restriction.
 */

export const DEFAULT_BOOKING_INTERVAL_MINUTES = 15;
export const MIN_BOOKING_INTERVAL_MINUTES = 1;
export const MAX_BOOKING_INTERVAL_MINUTES = 60;

/** Clamp/floor an interval to the supported 1-60 range; falls back to the default when invalid. */
export function normalizeBookingIntervalMinutes(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_BOOKING_INTERVAL_MINUTES;
  const floored = Math.floor(n);
  if (floored < MIN_BOOKING_INTERVAL_MINUTES) return MIN_BOOKING_INTERVAL_MINUTES;
  if (floored > MAX_BOOKING_INTERVAL_MINUTES) return MAX_BOOKING_INTERVAL_MINUTES;
  return floored;
}

/** Every start-minute offset within an hour for the given interval, anchored at :00. */
export function bookingIntervalGrid(intervalMinutes: number): number[] {
  const interval = normalizeBookingIntervalMinutes(intervalMinutes);
  const grid: number[] = [];
  for (let m = 0; m < 60; m += interval) grid.push(m);
  return grid;
}

/** Sanitize raw marks (from DB or client) to unique, in-range, on-grid, ascending offsets. */
export function sanitizeBookingMinuteMarks(raw: unknown, intervalMinutes: number): number[] {
  if (!Array.isArray(raw)) return [];
  const grid = new Set(bookingIntervalGrid(intervalMinutes));
  return [
    ...new Set(
      raw
        .map((m) => (typeof m === 'number' ? m : Number(m)))
        .filter((m) => Number.isInteger(m) && grid.has(m)),
    ),
  ].sort((a, b) => a - b);
}

/**
 * Resolve the effective set of allowed start-minute offsets for a service.
 * Returns the explicit marks when they genuinely restrict the grid; otherwise the full interval grid.
 */
export function effectiveBookingStartOffsets(params: {
  interval_minutes?: number | null;
  minute_marks?: number[] | null;
}): { intervalMinutes: number; offsets: number[] } {
  const intervalMinutes = normalizeBookingIntervalMinutes(
    params.interval_minutes ?? DEFAULT_BOOKING_INTERVAL_MINUTES,
  );
  const grid = bookingIntervalGrid(intervalMinutes);
  const marks = sanitizeBookingMinuteMarks(params.minute_marks ?? null, intervalMinutes);
  if (marks.length > 0 && marks.length < grid.length) {
    return { intervalMinutes, offsets: marks };
  }
  return { intervalMinutes, offsets: grid };
}

/**
 * Storage normalization for the API. A full-grid or empty mark set collapses to NULL
 * ("no restriction") so the engine treats it as a plain interval.
 */
export function normalizeBookingStartForStorage(
  intervalMinutes: unknown,
  minuteMarks: unknown,
): { booking_interval_minutes: number; booking_minute_marks: number[] | null } {
  const interval = normalizeBookingIntervalMinutes(intervalMinutes ?? DEFAULT_BOOKING_INTERVAL_MINUTES);
  if (minuteMarks == null) {
    return { booking_interval_minutes: interval, booking_minute_marks: null };
  }
  const grid = bookingIntervalGrid(interval);
  const marks = sanitizeBookingMinuteMarks(minuteMarks, interval);
  const restricted = marks.length > 0 && marks.length < grid.length;
  return { booking_interval_minutes: interval, booking_minute_marks: restricted ? marks : null };
}

/** Human-readable summary like ":00, :05, :10". */
export function describeBookingStartOffsets(offsets: number[]): string {
  return offsets.map((m) => `:${String(m).padStart(2, '0')}`).join(', ');
}
