/**
 * Per-service booking interval + per-hour start marks, or fixed times of day.
 *
 * A service picks one of two ways to offer candidate start times:
 *
 * 1. Interval (default). Candidates sit on a grid anchored to the top of each hour, spaced by
 *    `booking_interval_minutes` (1-60). Optionally, `booking_minute_marks` restricts which of those
 *    grid offsets (minutes 0-59 within the hour) are actually bookable, so a venue can e.g. take
 *    bookings every 5 minutes for the first half of each hour, or only on the hour and quarter past.
 * 2. Fixed times. When `booking_start_times` is set, those absolute times of day are the only
 *    candidates and the interval grid is ignored, e.g. ["09:20","11:30","13:45","15:30"] for a
 *    business that takes a handful of jobs a day at times that do not repeat hourly.
 *
 * This module is the single source of truth shared by the availability engine, the save/validation
 * API, and the dashboard form, so all three agree on the candidates and on what counts as a restriction.
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

/** `HH:MM` on a 24-hour clock. */
const START_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Sanitize raw fixed start times (from DB or client) to unique, valid `HH:MM`, ascending. */
export function sanitizeBookingStartTimes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const time = item.slice(0, 5);
    if (!START_TIME_PATTERN.test(time)) continue;
    seen.add(time);
  }
  // Zero-padded HH:MM sorts lexicographically in chronological order.
  return [...seen].sort();
}

/** Minutes since midnight for each `HH:MM`. Assumes already sanitized. */
export function bookingStartTimesToMinutes(times: string[]): number[] {
  return times.map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)));
}

/** True when this service offers fixed times of day rather than an interval grid. */
export function usesFixedStartTimes(startTimes: unknown): boolean {
  return sanitizeBookingStartTimes(startTimes).length > 0;
}

/**
 * Candidate start minutes for one service on one date, given the bookable minute ranges left after
 * venue, calendar and service-schedule clipping.
 *
 * Fixed times win when set: each is offered only if the whole appointment (`totalSpan`, i.e. duration
 * + buffer + processing) fits inside one range, so a custom schedule can still narrow which of them
 * apply on a given day. Otherwise we step by the interval from each range start, which is identical
 * to the legacy fixed 15-minute grid for unconfigured services, so existing services keep their exact
 * slot times. A genuine per-hour restriction (a strict, non-empty subset of the interval grid) is
 * inherently hour-relative, so those marks are anchored to the top of the hour instead.
 */
export function candidateStartMinutes(params: {
  ranges: Array<{ start: number; end: number }>;
  totalSpan: number;
  interval_minutes?: number | null;
  minute_marks?: number[] | null;
  start_times?: string[] | null;
}): number[] {
  const { ranges, totalSpan } = params;

  const fixed = bookingStartTimesToMinutes(sanitizeBookingStartTimes(params.start_times ?? null));
  if (fixed.length > 0) {
    return fixed.filter((t) => ranges.some((r) => t >= r.start && t + totalSpan <= r.end));
  }

  const interval = normalizeBookingIntervalMinutes(
    params.interval_minutes ?? DEFAULT_BOOKING_INTERVAL_MINUTES,
  );
  const grid = bookingIntervalGrid(interval);
  const marks = sanitizeBookingMinuteMarks(params.minute_marks ?? null, interval);
  const hasHourRestriction = marks.length > 0 && marks.length < grid.length;
  const allowedOffsets = hasHourRestriction ? new Set(marks) : null;
  const step = hasHourRestriction ? 1 : interval;

  const out: number[] = [];
  for (const range of ranges) {
    for (let t = range.start; t + totalSpan <= range.end; t += step) {
      if (allowedOffsets && !allowedOffsets.has(((t % 60) + 60) % 60)) continue;
      out.push(t);
    }
  }
  return out;
}

/**
 * Storage normalization for the API. A full-grid or empty mark set collapses to NULL
 * ("no restriction") so the engine treats it as a plain interval, and an empty fixed-time list
 * collapses to NULL so the service falls back to the interval grid.
 */
export function normalizeBookingStartForStorage(
  intervalMinutes: unknown,
  minuteMarks: unknown,
  startTimes?: unknown,
): {
  booking_interval_minutes: number;
  booking_minute_marks: number[] | null;
  booking_start_times: string[] | null;
} {
  const interval = normalizeBookingIntervalMinutes(intervalMinutes ?? DEFAULT_BOOKING_INTERVAL_MINUTES);
  const times = sanitizeBookingStartTimes(startTimes ?? null);
  const booking_start_times = times.length > 0 ? times : null;
  if (minuteMarks == null) {
    return { booking_interval_minutes: interval, booking_minute_marks: null, booking_start_times };
  }
  const grid = bookingIntervalGrid(interval);
  const marks = sanitizeBookingMinuteMarks(minuteMarks, interval);
  const restricted = marks.length > 0 && marks.length < grid.length;
  return {
    booking_interval_minutes: interval,
    booking_minute_marks: restricted ? marks : null,
    booking_start_times,
  };
}

/** Human-readable summary like ":00, :05, :10". */
export function describeBookingStartOffsets(offsets: number[]): string {
  return offsets.map((m) => `:${String(m).padStart(2, '0')}`).join(', ');
}

/** Human-readable summary like "9:20am, 11:30am, 1:45pm". */
export function describeBookingStartTimes(times: string[]): string {
  return sanitizeBookingStartTimes(times)
    .map((t) => {
      const hour = Number(t.slice(0, 2));
      const minute = t.slice(3, 5);
      const suffix = hour < 12 ? 'am' : 'pm';
      const display = hour % 12 === 0 ? 12 : hour % 12;
      return `${display}:${minute}${suffix}`;
    })
    .join(', ');
}
