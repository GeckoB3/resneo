/**
 * Wall-clock date and time in a venue IANA timezone (e.g. Europe/London).
 * Used for same-day booking cutoffs so server UTC does not leak into guest UX.
 */

export function formatYmdInTimezone(utcMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Whole calendar days from `fromYmd` to `toYmd`, negative when `toYmd` is
 * earlier. Pure Y-M-D arithmetic with no timezone in it: both arguments are
 * already venue-local dates, so this is exactly the "calendar days apart" a
 * venue means by "48 hours notice".
 *
 * Shared by the appointment engine (`slotMinutesFromNow`) and the resource
 * engine (`earliestGuestSlotStartMinute`); it was private to the former until
 * RS-2 needed the same rule in the latter.
 */
export function wholeDaysBetweenYmd(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split('-').map(Number);
  const [ty, tm, td] = toYmd.split('-').map(Number);
  const from = Date.UTC(fy!, fm! - 1, fd!);
  const to = Date.UTC(ty!, tm! - 1, td!);
  return Math.round((to - from) / 86_400_000);
}

export function addDaysToYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return t.toISOString().slice(0, 10);
}

/**
 * `venueLocalDateTimeToUtcMs` USED TO LIVE HERE. It is deleted, not deprecated,
 * and this note is why (SA-H1).
 *
 * It found the instant for a wall time by walking a 15-minute grid outward from
 * noon UTC and returning noon if nothing matched. Every real IANA offset is a
 * multiple of 15 minutes, so only wall times ending :00, :15, :30 or :45 could
 * ever match: **1344 of the 1440 minutes in a day silently resolved to noon.**
 *
 * It was not a rare edge. `booking_interval_minutes` accepts 1 to 60,
 * `booking_start_times` accepts arbitrary `HH:MM`, appointment intervals step
 * from the range start rather than from `:00` (so a day opening at 09:05 makes
 * every slot off-grid), and staff drag snaps to one minute, which the shipped
 * help article tells them to do.
 *
 * Every caller now uses {@link venueLocalWallTimeToUtcMs}, which was already in
 * this file, already correct, and already documented as the one to use for
 * booking times. That is the whole shape of this finding: the good function
 * existed and seven call sites used the broken one. Deleting rather than
 * fixing-in-place is deliberate, so there is no second implementation left for
 * a future caller to pick by accident.
 */

/** Offset of `timeZone` from UTC at `utcMs` (positive east of UTC), read via Intl. */
function timeZoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const wallAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return wallAsUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Convert a venue-local wall time (date + HH:mm) to UTC epoch milliseconds,
 * exact for ANY minute value. Resolves via the timezone offset with a second
 * pass, which is what makes it correct across DST transitions.
 *
 * The two irregular cases, both pinned by tests so they are known rather than
 * accidental:
 *
 *  * **Spring forward, a wall time that never happens** (01:30 on a UK spring
 *    transition day) maps to the instant the clocks skipped to.
 *  * **Autumn back, a wall time that happens twice** (01:30 on a UK autumn
 *    transition day) resolves to the SECOND occurrence, after the clocks go
 *    back. Most date libraries default to the first. Left as-is deliberately:
 *    it is one repeated hour a year, in the middle of the night, and
 *    `cancellation-deadline` has shipped on this behaviour.
 */
export function venueLocalWallTimeToUtcMs(dateYmd: string, timeHHmm: string, timeZone: string): number {
  const [y, mo, d] = dateYmd.split('-').map(Number);
  const [h, min] = timeHHmm.slice(0, 5).split(':').map(Number);
  const guess = Date.UTC(y!, mo! - 1, d!, h!, min!, 0);
  const first = guess - timeZoneOffsetMs(guess, timeZone);
  return guess - timeZoneOffsetMs(first, timeZone);
}

/**
 * End of a given calendar day (last millisecond) in the venue timezone, as a UTC Date.
 * Used for "per visit" compliance records (validity_period_days = 0), which are valid for
 * one calendar day in venue local time and then need renewing.
 */
export function endOfLocalDayForYmd(dayYmd: string, venueTimezone: string): Date {
  const tz = venueTimezone.trim() || 'Europe/London';
  const nextMidnightUtcMs = venueLocalWallTimeToUtcMs(addDaysToYmd(dayYmd, 1), '00:00', tz);
  return new Date(nextMidnightUtcMs - 1);
}

/**
 * End of the calendar day (last millisecond) of `capturedAtUtc` in the venue timezone.
 * This is the fallback for a per-visit record captured with no known appointment (an
 * in-venue walk-in capture). When the appointment IS known, callers use
 * {@link endOfLocalDayForYmd} with the booking date instead, so a form completed in
 * advance stays valid for the visit it was completed for.
 */
export function endOfCaptureDayInVenueTimezone(capturedAtUtc: Date, venueTimezone: string): Date {
  const tz = venueTimezone.trim() || 'Europe/London';
  return endOfLocalDayForYmd(formatYmdInTimezone(capturedAtUtc.getTime(), tz), tz);
}

/**
 * Weekday (0=Sunday … 6=Saturday) for a calendar date in the venue timezone.
 * Used for recurring rules keyed by JS getDay() conventions.
 */
export function getDayOfWeekForYmdInTimezone(ymd: string, timeZone: string): number {
  const [y, mo, d] = ymd.split('-').map(Number);
  const utcMs = Date.UTC(y, mo - 1, d, 12, 0, 0);
  const w = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(new Date(utcMs));
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[w] ?? 0;
}

export function getVenueLocalDateAndMinutes(timezone: string, at: Date = new Date()): {
  dateYmd: string;
  minutesSinceMidnight: number;
} {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    dateYmd: `${get('year')}-${get('month')}-${get('day')}`,
    minutesSinceMidnight: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** Wall-clock date and time-of-day (including seconds) in the venue timezone — for staff “start now” bookings. */
export function getVenueLocalDateTimeForBooking(timezone: string, at: Date = new Date()): {
  dateYmd: string;
  timeHHmmss: string;
} {
  const tz = timezone.trim() || 'Europe/London';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    dateYmd: `${get('year')}-${get('month')}-${get('day')}`,
    timeHHmmss: `${get('hour')}:${get('minute')}:${get('second')}`,
  };
}

/**
 * When `bookingDateYmd` is "today" in the venue timezone, slot generation should exclude starts
 * with minute-of-day ≤ this value (same clock as {@link getVenueLocalDateAndMinutes}).
 */
export function sameDaySlotCutoffForBookingDate(
  bookingDateYmd: string,
  venueTimezone: string,
  at: Date = new Date(),
): { venueDateYmd: string; minutesNow: number } | undefined {
  const { dateYmd, minutesSinceMidnight } = getVenueLocalDateAndMinutes(venueTimezone, at);
  if (bookingDateYmd !== dateYmd) return undefined;
  return { venueDateYmd: dateYmd, minutesNow: minutesSinceMidnight };
}
