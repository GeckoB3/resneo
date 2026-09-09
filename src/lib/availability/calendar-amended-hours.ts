/**
 * Amended hours for one calendar: the pure half of `/api/venue/calendar-amended-hours`.
 *
 * The store is `unified_calendars.availability_exceptions`, a per-date map that
 * `calendarHours` already reads first (a Hours override REPLACES the weekly shape, the
 * schedule periods and `days_off`). This module turns a date range plus periods into keys on
 * that map, turns the map back into runs the Closures tab can list, and shapes the
 * fail-soft mirror rows for `calendar_date_overrides`. Nothing here touches a database.
 *
 * See Docs/calendar-amended-hours-plan.md.
 */

import { addCalendarDays } from '@/lib/calendar/schedule-blocks-grouping';
import { timeToMinutes } from '@/lib/availability';

export const AMENDED_HOURS_MAX_DATES = 92;
export const AMENDED_HOURS_MAX_REASON_LENGTH = 200;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}$/;

export interface HoursPeriod {
  start: string;
  end: string;
}

/** A per-date value as stored. `reason` is ours; the resolver ignores it. */
export type DateOverrideValue =
  | { closed: true; reason?: string | null }
  | { periods: HoursPeriod[]; reason?: string | null };

export type DateOverrideMap = Record<string, DateOverrideValue>;

/** One run of consecutive dates carrying the same override, as the panel lists it. */
export interface AmendedHoursEntry {
  kind: 'hours' | 'closed';
  date_start: string;
  date_end: string;
  periods: HoursPeriod[];
  reason: string | null;
}

export function enumerateDatesInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    if (cur === to) break;
    cur = addCalendarDays(cur, 1);
  }
  return out;
}

export function isYmd(value: unknown): value is string {
  return typeof value === 'string' && YMD.test(value);
}

/**
 * Periods as the form sends them, normalised to what is stored: `HH:mm`, `end > start`,
 * sorted, overlapping or touching periods merged. Refuses an empty result rather than
 * storing it: an override with no periods is invalid data, not an intent to close
 * (resolver plan §2.2), and the CHECK on `calendar_date_overrides` refuses it too.
 */
export function normaliseHoursPeriods(
  raw: unknown,
): { ok: true; periods: HoursPeriod[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'Enter at least one open and close time.' };
  }
  const ranges: Array<{ start: number; end: number }> = [];
  for (const p of raw) {
    const start = typeof (p as HoursPeriod)?.start === 'string' ? (p as HoursPeriod).start.trim().slice(0, 5) : '';
    const end = typeof (p as HoursPeriod)?.end === 'string' ? (p as HoursPeriod).end.trim().slice(0, 5) : '';
    if (!HHMM.test(start) || !HHMM.test(end)) {
      return { ok: false, error: 'Times must be in HH:mm form.' };
    }
    const s = timeToMinutes(start);
    const e = timeToMinutes(end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e > 24 * 60) {
      return { ok: false, error: 'Times must be in HH:mm form.' };
    }
    if (e <= s) {
      // Past-midnight hours are not supported anywhere in the resolver (§2.3), and a period
      // that ends before it starts is the commonest way to type one by accident.
      return { ok: false, error: `Close time must be after open time (${start} to ${end}).` };
    }
    ranges.push({ start: s, end: e });
  }
  ranges.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }
  return { ok: true, periods: merged.map((r) => ({ start: toHhMm(r.start), end: toHhMm(r.end) })) };
}

function toHhMm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** The stored map, tolerating null, a non-object, or junk values (which are dropped). */
export function readOverrideMap(raw: unknown): DateOverrideMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: DateOverrideMap = {};
  for (const [date, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isYmd(date) || !value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const reason = typeof v.reason === 'string' && v.reason.trim() ? v.reason.trim() : null;
    if (v.closed === true) {
      out[date] = reason ? { closed: true, reason } : { closed: true };
      continue;
    }
    const norm = normaliseHoursPeriods(v.periods);
    if (!norm.ok) continue;
    out[date] = reason ? { periods: norm.periods, reason } : { periods: norm.periods };
  }
  return out;
}

export interface ApplyAmendedHoursInput {
  date_start: string;
  date_end: string;
  periods: HoursPeriod[];
  reason?: string | null;
  /** The run being edited; its keys go first so shortening a run leaves no stragglers. */
  replace?: { date_start: string; date_end: string } | null;
}

/** Returns a new map with the range set to the periods. Never mutates the input. */
export function applyAmendedHours(map: DateOverrideMap, input: ApplyAmendedHoursInput): DateOverrideMap {
  let next: DateOverrideMap = { ...map };
  if (input.replace) next = removeDateOverrides(next, input.replace.date_start, input.replace.date_end);
  const reason = input.reason?.trim() ? input.reason.trim() : null;
  for (const date of enumerateDatesInclusive(input.date_start, input.date_end)) {
    next[date] = reason ? { periods: input.periods, reason } : { periods: input.periods };
  }
  return next;
}

/** Returns a new map with every key in the range removed, whatever kind it held. */
export function removeDateOverrides(map: DateOverrideMap, from: string, to: string): DateOverrideMap {
  const next: DateOverrideMap = {};
  for (const [date, value] of Object.entries(map)) {
    if (date >= from && date <= to) continue;
    next[date] = value;
  }
  return next;
}

function sameValue(a: DateOverrideValue, b: DateOverrideValue): boolean {
  const ra = a.reason ?? null;
  const rb = b.reason ?? null;
  if (ra !== rb) return false;
  if ('closed' in a || 'closed' in b) return 'closed' in a && 'closed' in b;
  if (a.periods.length !== b.periods.length) return false;
  return a.periods.every((p, i) => p.start === b.periods[i]!.start && p.end === b.periods[i]!.end);
}

/**
 * The map as runs: consecutive dates with an identical value collapse into one entry, so
 * "16 to 20 Sep, 08:00 to 20:00" lists once. `from`/`to` clip to a window (inclusive); a run
 * that straddles the window is reported whole, because it is one thing the venue saved.
 */
export function amendedHoursEntries(map: DateOverrideMap, window?: { from: string; to: string }): AmendedHoursEntry[] {
  const dates = Object.keys(map).sort();
  const runs: AmendedHoursEntry[] = [];
  let current: AmendedHoursEntry | null = null;
  let currentValue: DateOverrideValue | null = null;
  for (const date of dates) {
    const value = map[date]!;
    if (current && currentValue && addCalendarDays(current.date_end, 1) === date && sameValue(currentValue, value)) {
      current.date_end = date;
      continue;
    }
    current = {
      kind: 'closed' in value ? 'closed' : 'hours',
      date_start: date,
      date_end: date,
      periods: 'closed' in value ? [] : value.periods.map((p) => ({ ...p })),
      reason: value.reason ?? null,
    };
    currentValue = value;
    runs.push(current);
  }
  if (!window) return runs;
  return runs.filter((r) => r.date_start <= window.to && r.date_end >= window.from);
}

/** The first date in the range on which `leave` closes the whole day, or null. */
export function firstFullDayLeaveDate(
  dateStart: string,
  dateEnd: string,
  leave: ReadonlyArray<{
    start_date: string;
    end_date: string;
    unavailable_start_time?: string | null;
    unavailable_end_time?: string | null;
  }>,
): string | null {
  const fullDay = leave.filter((l) => !l.unavailable_start_time || !l.unavailable_end_time);
  if (fullDay.length === 0) return null;
  for (const date of enumerateDatesInclusive(dateStart, dateEnd)) {
    if (fullDay.some((l) => l.start_date <= date && date <= l.end_date)) return date;
  }
  return null;
}

/**
 * Mirror rows for `calendar_date_overrides`: one `hours` row per run, periods in the
 * table's `{open, close}` shape. Closed keys are not mirrored (staff closures reach the
 * table from the leave mirror; a resource's closed key has no leave row and stays JSON-only
 * until Stage 6b decides otherwise).
 */
export function hoursOverrideMirrorRows(
  venueId: string,
  calendarId: string,
  map: DateOverrideMap,
): Array<Record<string, unknown>> {
  return amendedHoursEntries(map)
    .filter((e) => e.kind === 'hours')
    .map((e) => ({
      venue_id: venueId,
      calendar_id: calendarId,
      override_kind: 'hours',
      date_start: e.date_start,
      date_end: e.date_end,
      time_start: null,
      time_end: null,
      periods: e.periods.map((p) => ({ open: p.start, close: p.end })),
      leave_type: null,
      notes: e.reason,
      source_leave_id: null,
    }));
}
