/**
 * Calendar periods for the Settings → Reports tabs (Revenue, New bookings).
 *
 * Pure Y-M-D arithmetic on dates that are already venue-local, so no timezone
 * can shift a date into a neighbouring day. Weeks start on Monday and months
 * on the 1st, the same weeks the diary shows.
 */

export type ReportGrain = 'day' | 'week' | 'month';

export function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDaysYmd(ymd: string, delta: number): string {
  const d = parseYmd(ymd);
  d.setUTCDate(d.getUTCDate() + delta);
  return toYmd(d);
}

/**
 * The start of the period a date falls in. Weeks start on Monday; months on
 * the 1st. Pure date arithmetic on the booking's own date, so the venue's
 * timezone never shifts a booking into a neighbouring day.
 */
export function periodStartFor(ymd: string, grain: ReportGrain): string {
  if (grain === 'day') return ymd;
  const d = parseYmd(ymd);
  if (grain === 'week') {
    const dow = d.getUTCDay(); // 0 = Sunday
    const back = (dow + 6) % 7;
    d.setUTCDate(d.getUTCDate() - back);
    return toYmd(d);
  }
  d.setUTCDate(1);
  return toYmd(d);
}

/** The last date of the period that starts on `start`. */
export function periodEndFor(start: string, grain: ReportGrain): string {
  if (grain === 'day') return start;
  if (grain === 'week') return addDaysYmd(start, 6);
  const d = parseYmd(start);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return toYmd(d);
}

/** Every period start between `from` and `to`, so quiet periods still appear as zero rows. */
export function periodStartsBetween(from: string, to: string, grain: ReportGrain): string[] {
  const out: string[] = [];
  let cursor = periodStartFor(from, grain);
  let guard = 0;
  while (cursor <= to && guard < 4000) {
    out.push(cursor);
    cursor = addDaysYmd(periodEndFor(cursor, grain), 1);
    guard += 1;
  }
  return out;
}

export function clampYmd(value: string, min: string, max: string): string {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
