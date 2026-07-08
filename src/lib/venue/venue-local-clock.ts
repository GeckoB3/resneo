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

export function addDaysToYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return t.toISOString().slice(0, 10);
}

/**
 * Convert a venue-local wall time (date + HH:mm) to UTC epoch milliseconds.
 * Uses 15-minute stepping search so DST transitions are handled without extra deps.
 */
export function venueLocalDateTimeToUtcMs(dateYmd: string, timeHHmm: string, timeZone: string): number {
  const [y, mo, d] = dateYmd.split('-').map(Number);
  const [h, min] = timeHHmm.slice(0, 5).split(':').map(Number);
  const targetHm = h * 60 + min;
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const partsAt = (utcMs: number) => {
    const parts = formatter.formatToParts(new Date(utcMs));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
    const yy = get('year');
    const mm = get('month');
    const dd = get('day');
    const hh = get('hour');
    const mi = get('minute');
    const ymd = `${yy}-${mm}-${dd}`;
    const mins = Number(hh) * 60 + Number(mi);
    return { ymd, mins };
  };
  const anchor = Date.UTC(y, mo - 1, d, 12, 0, 0);
  for (let step = 0; step < 192; step++) {
    const utcMs = anchor + (step - 96) * 15 * 60 * 1000;
    const { ymd, mins } = partsAt(utcMs);
    if (ymd === dateYmd && mins === targetHm) return utcMs;
  }
  return anchor;
}

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
 * exact for ANY minute value. Unlike {@link venueLocalDateTimeToUtcMs}, which
 * probes a 15-minute grid (and falls back to noon for off-grid times, so it
 * must not be used for booking start times on 5/10-minute marks), this
 * resolves via the timezone offset with a second pass for DST transitions.
 * A nonexistent spring-forward wall time maps to the instant the clocks
 * skipped to.
 */
export function venueLocalWallTimeToUtcMs(dateYmd: string, timeHHmm: string, timeZone: string): number {
  const [y, mo, d] = dateYmd.split('-').map(Number);
  const [h, min] = timeHHmm.slice(0, 5).split(':').map(Number);
  const guess = Date.UTC(y!, mo! - 1, d!, h!, min!, 0);
  const first = guess - timeZoneOffsetMs(guess, timeZone);
  return guess - timeZoneOffsetMs(first, timeZone);
}

/**
 * End of the calendar day (last millisecond) of `capturedAtUtc` in the venue timezone,
 * as a UTC Date. Used for "per visit" compliance records (validity_period_days = 0), which
 * are valid for the day they were captured in venue local time, then need renewing.
 */
export function endOfCaptureDayInVenueTimezone(capturedAtUtc: Date, venueTimezone: string): Date {
  const tz = venueTimezone.trim() || 'Europe/London';
  const dayYmd = formatYmdInTimezone(capturedAtUtc.getTime(), tz);
  const nextMidnightUtcMs = venueLocalDateTimeToUtcMs(addDaysToYmd(dayYmd, 1), '00:00', tz);
  return new Date(nextMidnightUtcMs - 1);
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
