/**
 * The calendar layer: one implementation of "what hours does this calendar work, and when
 * does it break", shared by every consumer.
 *
 * There were six implementations of working-hours-to-minutes and four of breaks-to-minutes
 * before this, spread across the appointment engine, the resource engine, the event-hours
 * validator and the class conflict checker. They agreed by coincidence rather than by
 * construction, and §1.2 item 10 records that at least one pair had already drifted.
 *
 * TWO AXES, and getting either wrong changes what staff can do:
 *
 * 1. **Skippability.** Everything in this module is an `hours` rule, which staff may
 *    deliberately book through with `allowOutsideHours` (a walk-in, a move, a resize).
 *    Breaks are their own tag, skippable with `allowDuringBreaks`. LEAVE is neither: it is
 *    `hard`, nothing may skip it, and it deliberately lives outside this module in the
 *    engine's own check above the hours gate. Folding leave in here would re-open SA-M3.
 *
 * 2. **Anchor or veto.** `calendarHours` produces the ANCHORING set for slot generation.
 *    Breaks must not be subtracted from it: the candidate grid is anchored to each range's
 *    start, so subtracting a break re-anchors every slot after it. Use
 *    {@link calendarBookableSegments} only for containment questions ("does this fixed
 *    window fit?"), never to anchor a grid. For containment the two are equivalent; they
 *    diverge only under anchoring, which is the whole of the plan's §2.7.
 *
 * `days_off` is an HOURS rule here, not a closure, which corrects the plan's §2.4. It sits
 * inside the `allowOutsideHours` gate today (`appointment-engine.ts` checks it via
 * `getWorkingRanges`), so treating it as a `hard` closure would silently stop staff booking
 * a walk-in on a calendar's day off -- a change §8 promises this work does not make.
 *
 * See Docs/Resneo_Scheduling_Resolver_Plan_August_2026.md §2.1, §2.4 and Stage 5.
 */

import type { WorkingHours } from '@/types/booking-models';
import { timeToMinutes } from '@/lib/availability';
import { getDayOfWeek } from '@/lib/availability/engine';
import { unionMinuteRanges } from '@/lib/availability/calendar-resource-occupancy';
import { effectiveWorkingHoursForDate } from '@/lib/availability/working-hours-rota';

export interface MinuteRange {
  start: number;
  end: number;
}

/** Per-date override, as `unified_calendars.availability_exceptions` stores it. */
export type CalendarDateOverride =
  | { closed: true }
  | { periods: Array<{ start: string; end: string }> }
  | Record<string, unknown>;

/**
 * The columns this layer reads. Deliberately structural rather than a named row type: the
 * same shape arrives as a `Practitioner`, as a `VenueResource`'s `host_calendar`, and as a
 * raw `unified_calendars` row, and all three must resolve identically.
 */
export interface CalendarScheduleRow {
  working_hours?: WorkingHours | null;
  break_times?: Array<{ start: string; end: string }> | null;
  break_times_by_day?: WorkingHours | null;
  days_off?: string[] | null;
  availability_exceptions?: Record<string, CalendarDateOverride> | null;
  /**
   * Rotating schedule (`unified_calendars.working_hours_rota`): a cycle of weekly shapes
   * that replaces `working_hours` for the dates it covers. Read as `unknown` and parsed
   * per call, so stored garbage degrades to "no rota". See working-hours-rota.ts.
   */
  working_hours_rota?: unknown;
}

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * Weekday key and name for a date.
 *
 * The engines had two derivations of this, one on a local `Date` and one on `Date.UTC`.
 * They are equivalent -- both ask which weekday that calendar date falls on -- but having
 * two invited them to drift, and §1.2 item 10 counts three across the codebase.
 */
function dayKeys(dateStr: string): { key: string; name: string } {
  const dow = getDayOfWeek(dateStr);
  return { key: String(dow), name: DAY_NAMES[dow]! };
}

function toRanges(raw: Array<{ start: string; end: string }> | null | undefined): MinuteRange[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => ({ start: timeToMinutes(r.start), end: timeToMinutes(r.end) }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start);
}

/** The per-date override for this calendar, if any. */
function overrideForDate(row: CalendarScheduleRow, dateStr: string): CalendarDateOverride | null {
  const raw = row.availability_exceptions;
  if (!raw || typeof raw !== 'object') return null;
  return (raw as Record<string, CalendarDateOverride>)[dateStr] ?? null;
}

/**
 * True when `days_off` marks this date, either as an exact ISO date or as a recurring
 * lowercase weekday name.
 *
 * Both are live: `"2026-12-25"` closes that date and `"mon"` closes every Monday for good.
 * The weekday form has no representation in the target model and no dashboard screen shows
 * it; Stage 1 item 8 closed the write surface so no new one can appear, and the engines
 * keep honouring what is already stored until Stage 6b contracts the column.
 */
export function calendarDayOff(row: CalendarScheduleRow, dateStr: string): boolean {
  if (!Array.isArray(row.days_off)) return false;
  const { name } = dayKeys(dateStr);
  return row.days_off.some((d) => d === dateStr || d === name);
}

/**
 * Working ranges for this calendar on this date, before breaks.
 *
 * A per-date Hours override REPLACES the weekly baseline, matching the venue layer. An
 * override with no valid period is IGNORED rather than treated as a closure, which is the
 * rule §2.2 settles for both layers -- an empty override is invalid data, not an intent.
 */
export function calendarHours(row: CalendarScheduleRow, dateStr: string): MinuteRange[] {
  const override = overrideForDate(row, dateStr);
  if (override && 'closed' in override && override.closed === true) return [];
  if (override && 'periods' in override) {
    const periods = toRanges(override.periods as Array<{ start: string; end: string }>);
    if (periods.length > 0) return unionMinuteRanges(periods);
  }

  if (calendarDayOff(row, dateStr)) return [];

  // A rotating schedule supplies the weekly shape for the dates it covers; outside it the
  // ordinary `working_hours` apply. Same tag (`hours`), same precedence: below overrides
  // and days off, skippable by `allowOutsideHours`.
  const hours = effectiveWorkingHoursForDate(row, dateStr) as Record<string, Array<{ start: string; end: string }>>;
  const { key, name } = dayKeys(dateStr);
  const ranges = toRanges(hours[key] ?? hours[name]);
  return ranges.length > 0 ? unionMinuteRanges(ranges) : [];
}

/**
 * Break windows for this calendar on this date.
 *
 * `break_times_by_day` wins when it is a non-empty object; otherwise the flat `break_times`
 * list applies to every day. That fallback is live on four engines and is the reason
 * §1.3 tier 2 refuses to call the flat column dead.
 */
export function calendarBreaks(row: CalendarScheduleRow, dateStr: string): MinuteRange[] {
  const byDay = row.break_times_by_day;
  if (byDay && typeof byDay === 'object' && !Array.isArray(byDay) && Object.keys(byDay).length > 0) {
    const { key, name } = dayKeys(dateStr);
    const forDay = (byDay as Record<string, Array<{ start: string; end: string }>>)[key]
      ?? (byDay as Record<string, Array<{ start: string; end: string }>>)[name];
    const ranges = toRanges(forDay);
    return ranges.length > 0 ? unionMinuteRanges(ranges) : [];
  }
  const flat = toRanges(row.break_times);
  return flat.length > 0 ? unionMinuteRanges(flat) : [];
}

function subtract(ranges: MinuteRange[], cuts: MinuteRange[]): MinuteRange[] {
  let out = ranges.filter((r) => r.end > r.start);
  for (const cut of cuts) {
    if (cut.end <= cut.start) continue;
    const next: MinuteRange[] = [];
    for (const r of out) {
      if (cut.end <= r.start || cut.start >= r.end) {
        next.push(r);
        continue;
      }
      if (cut.start > r.start) next.push({ start: r.start, end: Math.min(cut.start, r.end) });
      if (cut.end < r.end) next.push({ start: Math.max(cut.end, r.start), end: r.end });
    }
    out = next;
  }
  return out.filter((r) => r.end > r.start);
}

/**
 * Hours minus breaks, FOR CONTAINMENT CONSUMERS ONLY.
 *
 * Answers "does this fixed window fit inside a working period that is not a break?", which
 * is what the event-hours validator and the class placement checker ask. **Never use this
 * to anchor a candidate grid**: splitting the anchoring set on a break re-anchors every
 * slot after it, which is the harm §2.7 forbids. Slot generation anchors to
 * {@link calendarHours} and vetoes {@link calendarBreaks} per candidate.
 */
export function calendarBookableSegments(row: CalendarScheduleRow, dateStr: string): MinuteRange[] {
  return subtract(calendarHours(row, dateStr), calendarBreaks(row, dateStr));
}
