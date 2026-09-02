import type { TimeRange, WorkingHours } from '@/types/booking-models';
import { getDayOfWeek } from '@/lib/availability/engine';

/**
 * Rotating schedule: a calendar whose working hours differ week by week.
 *
 * The record is a cycle of weekly shapes (each the same shape as `working_hours`),
 * the Monday the cycle starts, and the last date it applies. The week for a date
 * is the number of whole weeks since the start, modulo the cycle length. Outside
 * the window, and before the start, the calendar's ordinary `working_hours` apply.
 *
 * Everything here is pure and tolerant of stored garbage: `parseWorkingHoursRota`
 * returns null for anything that is not a valid rota, and every consumer treats
 * null as "no rota". See Docs/rotating-schedule-plan.md.
 */

export const ROTA_MIN_WEEKS = 2;
export const ROTA_MAX_WEEKS = 6;
/** Longest run "for N cycles" may produce, so a typo cannot schedule a decade. */
export const ROTA_MAX_CYCLES = 52;

export interface WorkingHoursRota {
  version: 1;
  /** The Monday week one of the cycle begins, `YYYY-MM-DD`. */
  cycle_start: string;
  /** Two to six weekly shapes, in cycle order. */
  weeks: WorkingHours[];
  /** Last date the rota applies, inclusive; null means until further notice. */
  repeat_until: string | null;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_KEYS = new Set(['0', '1', '2', '3', '4', '5', '6', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);

function isYmd(value: unknown): value is string {
  if (typeof value !== 'string' || !YMD_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y!, m! - 1, d!));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m! - 1 && probe.getUTCDate() === d;
}

/** Whole days since the epoch for a calendar date, timezone-free. */
export function ymdToDayNumber(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round(Date.UTC(y!, m! - 1, d!) / 86_400_000);
}

export function dayNumberToYmd(dayNumber: number): string {
  const date = new Date(dayNumber * 86_400_000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function addDaysYmd(ymd: string, days: number): string {
  return dayNumberToYmd(ymdToDayNumber(ymd) + days);
}

/** True when the date is a Monday. */
export function isMondayYmd(ymd: string): boolean {
  return getDayOfWeek(ymd) === 1;
}

/** The Monday on or before the date (the start of its Monday-to-Sunday week). */
export function mondayOnOrBefore(ymd: string): string {
  const dow = getDayOfWeek(ymd); // 0 = Sunday
  const back = dow === 0 ? 6 : dow - 1;
  return addDaysYmd(ymd, -back);
}

function parseWeek(raw: unknown): WorkingHours | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: WorkingHours = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!DAY_KEYS.has(key)) return null;
    if (!Array.isArray(value)) return null;
    const ranges: TimeRange[] = [];
    for (const r of value) {
      if (!r || typeof r !== 'object') return null;
      const { start, end } = r as { start?: unknown; end?: unknown };
      if (typeof start !== 'string' || typeof end !== 'string') return null;
      if (!HHMM_RE.test(start) || !HHMM_RE.test(end)) return null;
      ranges.push({ start, end });
    }
    out[key] = ranges;
  }
  return out;
}

/** A valid rota, or null for anything else (absent, malformed, wrong version). */
export function parseWorkingHoursRota(raw: unknown): WorkingHoursRota | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  if (src.version !== 1) return null;
  if (!isYmd(src.cycle_start) || !isMondayYmd(src.cycle_start)) return null;
  if (!Array.isArray(src.weeks) || src.weeks.length < ROTA_MIN_WEEKS || src.weeks.length > ROTA_MAX_WEEKS) return null;
  const weeks: WorkingHours[] = [];
  for (const w of src.weeks) {
    const week = parseWeek(w);
    if (!week) return null;
    weeks.push(week);
  }
  let repeat_until: string | null = null;
  if (src.repeat_until != null) {
    if (!isYmd(src.repeat_until)) return null;
    if (ymdToDayNumber(src.repeat_until) < ymdToDayNumber(src.cycle_start)) return null;
    repeat_until = src.repeat_until;
  }
  return { version: 1, cycle_start: src.cycle_start, weeks, repeat_until };
}

/**
 * Which week of the cycle a date falls in (0-based), or null when the date is
 * before the cycle starts or after it ends.
 */
export function rotaWeekIndexForDate(rota: WorkingHoursRota, dateYmd: string): number | null {
  if (!isYmd(dateYmd)) return null;
  const day = ymdToDayNumber(dateYmd);
  const start = ymdToDayNumber(rota.cycle_start);
  if (day < start) return null;
  if (rota.repeat_until && day > ymdToDayNumber(rota.repeat_until)) return null;
  const weeksSinceStart = Math.floor((day - start) / 7);
  return weeksSinceStart % rota.weeks.length;
}

/** The rota week's hours for a date, or null when the rota does not cover it. */
export function rotaWorkingHoursForDate(rota: WorkingHoursRota, dateYmd: string): WorkingHours | null {
  const index = rotaWeekIndexForDate(rota, dateYmd);
  return index == null ? null : rota.weeks[index] ?? null;
}

/**
 * The weekly shape that applies to a calendar on a date: the rota week when the
 * date is inside the rota, otherwise the ordinary `working_hours`. The single
 * place the choice is made; the resolver and the diary header both use it.
 */
export function effectiveWorkingHoursForDate(
  row: { working_hours?: WorkingHours | null; working_hours_rota?: unknown },
  dateYmd: string,
): WorkingHours {
  const rota = parseWorkingHoursRota(row.working_hours_rota);
  if (rota) {
    const week = rotaWorkingHoursForDate(rota, dateYmd);
    if (week) return week;
  }
  return row.working_hours ?? {};
}

/** The inclusive end date of a rota that runs for `cycles` full cycles from its start. */
export function rotaEndDateForCycles(cycleStart: string, weekCount: number, cycles: number): string {
  const safeCycles = Math.max(1, Math.min(ROTA_MAX_CYCLES, Math.floor(cycles)));
  return addDaysYmd(cycleStart, weekCount * safeCycles * 7 - 1);
}

/**
 * How many full cycles a rota runs for, when its end date lands on a cycle
 * boundary; null when it runs until further notice or ends mid-cycle.
 */
export function rotaCyclesForEndDate(rota: WorkingHoursRota): number | null {
  if (!rota.repeat_until) return null;
  const days = ymdToDayNumber(rota.repeat_until) - ymdToDayNumber(rota.cycle_start) + 1;
  const cycleDays = rota.weeks.length * 7;
  if (days <= 0 || days % cycleDays !== 0) return null;
  return days / cycleDays;
}
