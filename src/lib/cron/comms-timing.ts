/**
 * Venue-local-aware timing for reminder / post-visit crons (Vercel runs in UTC —
 * naive Date parsing must not mix with “venue wall clock” booking rows).
 */

import {
  venueLocalDateTimeToUtcMs,
  formatYmdInTimezone,
} from '@/lib/venue/venue-local-clock';

/** Half-width around the configured offset; cron runs every 15m plus runtime jitter — 22m survives one missed beat. */
export const CRON_COMMS_TOLERANCE_MS = 22 * 60 * 1000;

/** Milliseconds from `now` until booking start (`booking_date` + `booking_time` in venue TZ). */
export function msUntilBookingStartUtc(
  bookingDateYmd: string,
  bookingTimeHmss: string,
  venueTimeZone: string,
  nowMs: number,
): number {
  return venueLocalDateTimeToUtcMs(bookingDateYmd, bookingTimeHmss, venueTimeZone) - nowMs;
}

/** Milliseconds since booking start (`booking_date` + `booking_time` in venue TZ). */
export function msSinceBookingStartUtc(
  bookingDateYmd: string,
  bookingTimeHmss: string,
  venueTimeZone: string,
  nowMs: number,
): number {
  return nowMs - venueLocalDateTimeToUtcMs(bookingDateYmd, bookingTimeHmss, venueTimeZone);
}

/**
 * yyyy-mm-dd list for DB filter: booking rows whose civil date might match a reminder
 * `hoursBefore` hours ahead of now (within tolerance), in venue local time.
 */
export function bookingCivilDatesForReminderWindow(opts: {
  venueTimeZone: string;
  hoursBefore: number;
  toleranceMs: number;
  nowMs: number;
}): string[] {
  const { venueTimeZone, hoursBefore, toleranceMs, nowMs } = opts;
  const targetMs = hoursBefore * 60 * 60 * 1000;
  const earliestStartUtc = nowMs + targetMs - toleranceMs;
  const latestStartUtc = nowMs + targetMs + toleranceMs;
  const startDate = formatYmdInTimezone(earliestStartUtc, venueTimeZone);
  const endDate = formatYmdInTimezone(latestStartUtc, venueTimeZone);
  const dates = [startDate];
  if (endDate !== startDate) dates.push(endDate);
  return dates;
}

/**
 * yyyy-mm-dd list for DB filter: Completed bookings whose start might fall in the post-visit
 * “hoursAfter” window after start, in venue local time.
 */
export function bookingCivilDatesForPostVisitWindow(opts: {
  venueTimeZone: string;
  hoursAfter: number;
  toleranceMs: number;
  nowMs: number;
}): string[] {
  const { venueTimeZone, hoursAfter, toleranceMs, nowMs } = opts;
  const targetMs = hoursAfter * 60 * 60 * 1000;
  /** Booking start S such that now ≈ S + hoursAfter  → S ≈ now - hoursAfter */
  const earliestBookingStartUtc = nowMs - targetMs - toleranceMs;
  const latestBookingStartUtc = nowMs - targetMs + toleranceMs;
  const startDate = formatYmdInTimezone(earliestBookingStartUtc, venueTimeZone);
  const endDate = formatYmdInTimezone(latestBookingStartUtc, venueTimeZone);
  const dates = [startDate];
  if (endDate !== startDate) dates.push(endDate);
  return dates;
}
