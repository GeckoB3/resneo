/**
 * Synthetic read-only blocks for the staff appointment calendar: venue closures
 * and per-calendar working-hour / leave closures.
 *
 * Amended hours get no stripe of their own. The grid follows the venue's
 * RESOLVED hours for the date, so on an amended day the closed stripes already
 * sit outside the amended window and the open part looks like any other day.
 * A sky-blue "Amended hours" band used to be drawn over the open window; it
 * told the owner nothing the grid did not already show, and made the day look
 * unlike every other working day.
 */

import { addCalendarDays } from '@/lib/calendar/schedule-blocks-grouping';
import { getWorkingRanges } from '@/lib/availability/appointment-engine';
import { getCalendarGridBounds } from '@/lib/venue-calendar-bounds';
import { getDayOfWeekForYmdInTimezone } from '@/lib/venue/venue-local-clock';
import { minutesToTime, timeToMinutes } from '@/lib/availability';
import { resolveVenueWideAllowedMinuteRanges } from '@/lib/availability/venue-wide-business-hours';
import type { AvailabilityBlock, OpeningHours } from '@/types/availability';
import type { Practitioner, TimeRange, WorkingHours } from '@/types/booking-models';

export interface ScheduleClosureCalendarBlock {
  id: string;
  practitioner_id: string | null;
  calendar_id: string | null;
  block_date: string;
  start_time: string;
  end_time: string;
  reason: string | null;
  block_type: ScheduleClosureBlockType;
  /**
   * The Label chosen for a calendar closure (`practitioner_leave_periods.leave_type`), on
   * `practitioner_leave` stripes only. {@link scheduleClosureBlockLabel} turns it into words.
   */
  leave_type?: string | null;
}

/**
 * Why `practitioner_leave` is separate from `practitioner_closed`.
 *
 * These used to be one type. Partial leave was concatenated into the same array
 * as the off-working-hours ranges and merged, so a 16:00-17:00 leave abutting a
 * 17:00 close fused into a single grey block, and "Sarah is on annual leave"
 * rendered identically to "Sarah does not work Wednesday afternoons" (SA-M28).
 *
 * The distinction is also what lets a caller decide whether a block should stop
 * staff booking over it. Leave is a person being absent; off-hours is a
 * boundary a venue can choose to work past.
 */
export type ScheduleClosureBlockType =
  | 'venue_closed'
  | 'practitioner_closed'
  | 'practitioner_leave'
  /**
   * A LINKED venue's own closed hours, on a partner column.
   *
   * Distinct from `venue_closed` so it keeps blocking. Staff may book past
   * their own venue's closing time, which is what SA-H5 is about, but choosing
   * to work late is a decision about your own business. Placing an appointment
   * inside another venue's closed hours is not the same act, and the partner
   * has not agreed to it.
   */
  | 'linked_venue_closed'
  /**
   * Minutes where the venue is shut AND the calendar is not working. Produced
   * by {@link partitionScheduleClosureBlocks}, never by a builder directly, so
   * the two single-cause stripes ("Venue closed", "<calendar> unavailable")
   * each mean exactly one thing.
   */
  | 'venue_and_calendar_closed';

export interface PractitionerLeavePeriodInput {
  practitioner_id: string;
  start_date: string;
  end_date: string;
  unavailable_start_time?: string | null;
  unavailable_end_time?: string | null;
  /** The closure form's "Label (optional)": `annual` Closed, `sick` Unavailable, `other` Other. */
  leave_type?: string | null;
}

type MinuteRange = { start: number; end: number };

function enumerateDatesInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    if (cur === to) break;
    cur = addCalendarDays(cur, 1);
  }
  return out;
}

function mergeAdjacentRanges(ranges: MinuteRange[]): MinuteRange[] {
  const sorted = [...ranges].filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  if (sorted.length === 0) return [];
  const merged: MinuteRange[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

const LINKED_DAY_NAME_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Resolve a weekly working-hours template to the open periods for one calendar weekday. */
function workingPeriodsForDay(wh: WorkingHours, dow: number): TimeRange[] {
  const numeric = wh[String(dow)];
  if (Array.isArray(numeric) && numeric.length > 0) return numeric;
  const legacy = wh[LINKED_DAY_NAME_KEYS[dow] as string];
  return Array.isArray(legacy) ? legacy : [];
}

/**
 * §8.2 — closure ("closed") blocks for a single LINKED venue's calendar column,
 * derived from that venue's own `working_hours` template for the date (in the
 * linked venue's timezone), over the [gridStartHour, gridEndHour) window. This is
 * what makes a linked column reflect the *linked* venue's opening hours — e.g. if
 * it opens an hour later than the viewing venue, that earlier hour shows greyed
 * on the linked column. Keyed on the linked column id so it matches that column.
 */
export function buildLinkedColumnClosureBlocks(params: {
  columnId: string;
  workingHours: WorkingHours | null | undefined;
  dateYmd: string;
  timeZone: string;
  gridStartHour: number;
  gridEndHour: number;
}): ScheduleClosureCalendarBlock[] {
  const { columnId, workingHours, dateYmd, timeZone, gridStartHour, gridEndHour } = params;
  const boundsStart = gridStartHour * 60;
  const boundsEnd = gridEndHour * 60;
  if (boundsEnd <= boundsStart) return [];
  const dow = getDayOfWeekForYmdInTimezone(dateYmd, timeZone);
  const open: MinuteRange[] = workingPeriodsForDay(workingHours ?? {}, dow)
    .map((p) => ({
      start: timeToMinutes((p.start ?? '').slice(0, 5)),
      end: timeToMinutes((p.end ?? '').slice(0, 5)),
    }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start);
  return closedRangesFromOpenWindows(open, boundsStart, boundsEnd).map((r, i) => ({
    id: `linked-closed:${columnId}:${dateYmd}:${i}`,
    practitioner_id: null,
    calendar_id: columnId,
    block_date: dateYmd,
    start_time: minutesToTime(r.start),
    end_time: minutesToTime(r.end),
    reason: null,
    block_type: 'linked_venue_closed' as const,
  }));
}

/** Minutes outside `open` within [boundsStart, boundsEnd). */
export function closedRangesFromOpenWindows(
  open: MinuteRange[],
  boundsStart: number,
  boundsEnd: number,
): MinuteRange[] {
  if (boundsEnd <= boundsStart) return [];
  const openSorted = mergeAdjacentRanges(open);
  const closed: MinuteRange[] = [];
  let cursor = boundsStart;
  for (const r of openSorted) {
    if (r.start > cursor) {
      closed.push({ start: cursor, end: Math.min(r.start, boundsEnd) });
    }
    cursor = Math.max(cursor, r.end);
    if (cursor >= boundsEnd) break;
  }
  if (cursor < boundsEnd) {
    closed.push({ start: cursor, end: boundsEnd });
  }
  return closed.filter((r) => r.end > r.start);
}

function intersectRanges(a: MinuteRange[], b: MinuteRange[]): MinuteRange[] {
  const out: MinuteRange[] = [];
  for (const ra of a) {
    for (const rb of b) {
      const s = Math.max(ra.start, rb.start);
      const e = Math.min(ra.end, rb.end);
      if (s < e) out.push({ start: s, end: e });
    }
  }
  return mergeAdjacentRanges(out);
}

function blockId(
  kind: ScheduleClosureCalendarBlock['block_type'],
  columnId: string,
  dateStr: string,
  startMin: number,
  endMin: number,
): string {
  return `${kind}:${columnId}:${dateStr}:${startMin}-${endMin}`;
}

function toScheduleBlock(
  kind: ScheduleClosureCalendarBlock['block_type'],
  columnId: string,
  dateStr: string,
  range: MinuteRange,
  reason: string | null,
): ScheduleClosureCalendarBlock {
  return {
    id: blockId(kind, columnId, dateStr, range.start, range.end),
    practitioner_id: columnId,
    calendar_id: columnId,
    block_date: dateStr,
    start_time: minutesToTime(range.start),
    end_time: minutesToTime(range.end),
    reason,
    block_type: kind,
  };
}

function gridMinuteBounds(
  dateStr: string,
  openingHours: OpeningHours | null | undefined,
  timeZone?: string | null,
  venueWideBlocks?: AvailabilityBlock[] | null,
): { start: number; end: number } {
  // The blocks matter here for the same reason they matter to the grid itself: these
  // stripes are CLIPPED to these bounds. Deriving them from the weekly shape alone meant a
  // day amended to run past the weekly close had its amended stripe clipped away, so the
  // owner saw an empty band exactly where the hours they had just entered should be --
  // while Stage 4 had already widened the visible grid to show them. Both sides have to
  // read the same hours or the diary contradicts itself.
  const { startHour, endHour } = getCalendarGridBounds(dateStr, openingHours, 7, 21, {
    timeZone,
    venueWideBlocks,
  });
  return { start: startHour * 60, end: endHour * 60 };
}

/**
 * Venue-wide closed windows for each visible calendar column, from the resolved
 * hours for the date (weekly hours, amended hours and closures already applied).
 */
export function buildVenueScheduleClosureBlocks(params: {
  openingHours: OpeningHours | null | undefined;
  venueWideBlocks: AvailabilityBlock[];
  fromDate: string;
  toDate: string;
  columnIds: string[];
  timeZone?: string | null;
  /**
   * The minutes the grid actually draws, when wider than the venue's own hours
   * (a booking outside them, or a drag stretching the day to let one land
   * there). The stripes are clipped to these instead, so every drawn minute
   * outside the open windows reads as closed.
   */
  gridBounds?: { start: number; end: number };
}): ScheduleClosureCalendarBlock[] {
  const { openingHours, venueWideBlocks, fromDate, toDate, columnIds, timeZone, gridBounds } = params;
  if (columnIds.length === 0) return [];

  const out: ScheduleClosureCalendarBlock[] = [];
  for (const dateStr of enumerateDatesInclusive(fromDate, toDate)) {
    const bounds = gridBounds ?? gridMinuteBounds(dateStr, openingHours, timeZone, venueWideBlocks);
    const resolution = resolveVenueWideAllowedMinuteRanges(openingHours, dateStr, venueWideBlocks);

    let closedRanges: MinuteRange[] = [];
    if (resolution.kind === 'closed') {
      closedRanges = [{ start: bounds.start, end: bounds.end }];
    } else if (resolution.kind === 'allowed') {
      closedRanges = closedRangesFromOpenWindows(resolution.ranges, bounds.start, bounds.end);
    } else {
      continue;
    }

    for (const columnId of columnIds) {
      for (const range of closedRanges) {
        out.push(toScheduleBlock('venue_closed', columnId, dateStr, range, null));
      }
    }
  }

  return out;
}

function isFullDayLeave(row: PractitionerLeavePeriodInput): boolean {
  return (
    (row.unavailable_start_time == null || row.unavailable_start_time === '') &&
    (row.unavailable_end_time == null || row.unavailable_end_time === '')
  );
}

/** A calendar's recorded leave on one date: a full day, or the partial windows, merged. */
export function leaveForPractitionerOnDate(
  practitionerId: string,
  dateStr: string,
  leavePeriods: PractitionerLeavePeriodInput[],
): { fullDay: boolean; partial: MinuteRange[] } {
  let fullDay = false;
  const partial: MinuteRange[] = [];
  for (const row of leavePeriods) {
    if (row.practitioner_id !== practitionerId) continue;
    if (dateStr < row.start_date || dateStr > row.end_date) continue;
    if (isFullDayLeave(row)) {
      fullDay = true;
      continue;
    }
    const st = row.unavailable_start_time?.slice(0, 5);
    const en = row.unavailable_end_time?.slice(0, 5);
    if (st && en) {
      const start = timeToMinutes(st);
      const end = timeToMinutes(en);
      if (end > start) partial.push({ start, end });
    }
  }
  return { fullDay, partial: mergeAdjacentRanges(partial) };
}

/**
 * Which label wins where closures with different labels cover the same minutes: the
 * strongest statement. Anything unrecognised ranks with `other`.
 */
function leaveTypeRank(leaveType: string | null | undefined): number {
  if (leaveType === 'annual') return 0;
  if (leaveType === 'sick') return 1;
  return 2;
}

type LabelledMinuteRange = MinuteRange & { leaveType: string | null };

/**
 * {@link leaveForPractitionerOnDate} with each closure's Label kept, so the diary can say
 * what the owner chose. Full-day closures cover the whole day under one label. Part-day
 * windows are cut where their labels change, so two closures with different labels never
 * fuse into one stripe; where they overlap, {@link leaveTypeRank} decides.
 */
export function labelledLeaveForPractitionerOnDate(
  practitionerId: string,
  dateStr: string,
  leavePeriods: PractitionerLeavePeriodInput[],
): { fullDay: { leaveType: string | null } | null; partial: LabelledMinuteRange[] } {
  let fullDay: { leaveType: string | null } | null = null;
  const windows: LabelledMinuteRange[] = [];
  for (const row of leavePeriods) {
    if (row.practitioner_id !== practitionerId) continue;
    if (dateStr < row.start_date || dateStr > row.end_date) continue;
    const leaveType = row.leave_type ?? null;
    if (isFullDayLeave(row)) {
      if (!fullDay || leaveTypeRank(leaveType) < leaveTypeRank(fullDay.leaveType)) fullDay = { leaveType };
      continue;
    }
    const st = row.unavailable_start_time?.slice(0, 5);
    const en = row.unavailable_end_time?.slice(0, 5);
    if (st && en) {
      const start = timeToMinutes(st);
      const end = timeToMinutes(en);
      if (end > start) windows.push({ start, end, leaveType });
    }
  }

  const cuts = [...new Set(windows.flatMap((w) => [w.start, w.end]))].sort((a, b) => a - b);
  const partial: LabelledMinuteRange[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const start = cuts[i]!;
    const end = cuts[i + 1]!;
    let winner: LabelledMinuteRange | null = null;
    for (const w of windows) {
      if (w.start >= end || w.end <= start) continue;
      if (!winner || leaveTypeRank(w.leaveType) < leaveTypeRank(winner.leaveType)) winner = w;
    }
    if (!winner) continue;
    const last = partial[partial.length - 1];
    if (last && last.end === start && leaveTypeRank(last.leaveType) === leaveTypeRank(winner.leaveType)) {
      last.end = end;
    } else {
      partial.push({ start, end, leaveType: winner.leaveType });
    }
  }
  return { fullDay, partial };
}

type PractitionerClosureInput = {
  id: string;
  is_active: boolean;
  working_hours?: Practitioner['working_hours'];
  days_off?: Practitioner['days_off'];
  break_times?: Practitioner['break_times'];
  break_times_by_day?: Practitioner['break_times_by_day'];
};

/**
 * Per-calendar closed windows from weekly working hours, days off, and leave periods.
 */
export function buildPractitionerScheduleClosureBlocks(params: {
  practitioners: PractitionerClosureInput[];
  leavePeriods: PractitionerLeavePeriodInput[];
  fromDate: string;
  toDate: string;
  openingHours: OpeningHours | null | undefined;
  timeZone?: string | null;
  /** As on {@link buildVenueScheduleClosureBlocks}: the drawn range, when wider than the hours. */
  gridBounds?: { start: number; end: number };
}): ScheduleClosureCalendarBlock[] {
  const { practitioners, leavePeriods, fromDate, toDate, openingHours, timeZone, gridBounds } = params;
  const out: ScheduleClosureCalendarBlock[] = [];

  for (const prac of practitioners) {
    if (!prac.is_active) continue;
    const asPractitioner = prac as Practitioner;

    for (const dateStr of enumerateDatesInclusive(fromDate, toDate)) {
      const bounds = gridBounds ?? gridMinuteBounds(dateStr, openingHours, timeZone);
      const leave = labelledLeaveForPractitionerOnDate(prac.id, dateStr, leavePeriods);
      const working = getWorkingRanges(asPractitioner, dateStr);

      let closedRanges: MinuteRange[] = [];
      let leaveRanges: LabelledMinuteRange[] = [];

      if (leave.fullDay) {
        // Recorded leave outranks an implicit day off: it says why, and the
        // day-off boundary would only say the same thing less usefully.
        leaveRanges = [{ start: bounds.start, end: bounds.end, leaveType: leave.fullDay.leaveType }];
      } else if (working.length === 0) {
        closedRanges = [{ start: bounds.start, end: bounds.end }];
      } else {
        closedRanges = closedRangesFromOpenWindows(working, bounds.start, bounds.end);
        if (leave.partial.length > 0) {
          // Clip leave to the hours actually worked instead of merging the two
          // sets. The minutes covered are identical to the merged version, so
          // nothing that was greyed stops being greyed; they are now two
          // non-overlapping sets carrying which is which. Each labelled window
          // is clipped on its own so differently labelled closures stay apart.
          const workingInBounds = intersectRanges(working, [
            { start: bounds.start, end: bounds.end },
          ]);
          leaveRanges = leave.partial.flatMap((window) =>
            intersectRanges([window], workingInBounds).map((r) => ({ ...r, leaveType: window.leaveType })),
          );
        }
      }

      for (const range of closedRanges) {
        out.push(toScheduleBlock('practitioner_closed', prac.id, dateStr, range, null));
      }
      for (const range of leaveRanges) {
        out.push({
          ...toScheduleBlock('practitioner_leave', prac.id, dateStr, range, null),
          leave_type: range.leaveType,
        });
      }
    }
  }

  return out;
}

export function isScheduleClosureBlockType(blockType: string | undefined): boolean {
  return (
    blockType === 'venue_closed' ||
    blockType === 'practitioner_closed' ||
    blockType === 'practitioner_leave' ||
    blockType === 'linked_venue_closed' ||
    blockType === 'venue_and_calendar_closed'
  );
}

function hm(t: string): string {
  return t.slice(0, 5);
}

/**
 * The words a calendar closure's Label puts on its stripe. `annual` and `sick` read
 * as their options on the form. `other` reads "On leave", the stripe's wording
 * from before it followed the Label: "Other 09:00 to 17:00" would explain less.
 * The app repo draws the same three words (R36).
 */
export function leaveStripeLabel(leaveType: string | null | undefined): string {
  if (leaveType === 'annual') return 'Closed';
  if (leaveType === 'sick') return 'Unavailable';
  return 'On leave';
}

/**
 * The words on a closure stripe. Every stripe says why the minutes are
 * unavailable and which minutes: "Venue closed 18:00 to 20:00" when the
 * calendar would work but the business is shut, "Hannah unavailable 08:00 to
 * 09:00" when the business is open but the calendar is not working, and a
 * calendar closure's own Label ("Closed 09:00 to 13:00") when one was entered.
 */
export function scheduleClosureBlockLabel(
  blockType: string | undefined,
  opts?: { columnName?: string | null; startTime?: string; endTime?: string; leaveType?: string | null },
): string {
  const range = opts?.startTime && opts?.endTime ? ` ${hm(opts.startTime)} to ${hm(opts.endTime)}` : '';
  if (blockType === 'practitioner_leave') return `${leaveStripeLabel(opts?.leaveType)}${range}`;
  if (blockType === 'venue_closed') return `Venue closed${range}`;
  if (blockType === 'practitioner_closed') {
    const who = opts?.columnName?.trim() || 'Calendar';
    return `${who} unavailable${range}`;
  }
  if (blockType === 'linked_venue_closed') return `Linked venue closed${range}`;
  if (blockType === 'venue_and_calendar_closed') {
    // The venue is shut too, but the calendar's own closure is what keeps
    // these minutes closed, so it is named rather than a bare "Closed".
    const who = opts?.columnName?.trim() || 'Calendar';
    return `${who} closed${range}`;
  }
  return `Closed${range}`;
}

function subtractRanges(from: MinuteRange[], remove: MinuteRange[]): MinuteRange[] {
  let out = mergeAdjacentRanges(from);
  for (const r of mergeAdjacentRanges(remove)) {
    const next: MinuteRange[] = [];
    for (const f of out) {
      if (r.end <= f.start || r.start >= f.end) {
        next.push(f);
        continue;
      }
      if (r.start > f.start) next.push({ start: f.start, end: r.start });
      if (r.end < f.end) next.push({ start: r.end, end: f.end });
    }
    out = next;
  }
  return out;
}

/**
 * Splits venue-closed and calendar-closed stripes so no minute carries two
 * explanations. Where only the venue is shut the stripe stays `venue_closed`;
 * where only the calendar is off it stays `practitioner_closed`; where both
 * apply it becomes `venue_and_calendar_closed`. Leave and linked-venue stripes
 * pass through untouched.
 */
export function partitionScheduleClosureBlocks(
  blocks: ScheduleClosureCalendarBlock[],
): ScheduleClosureCalendarBlock[] {
  type Key = string;
  const venueByKey = new Map<Key, MinuteRange[]>();
  const calByKey = new Map<Key, MinuteRange[]>();
  const passthrough: ScheduleClosureCalendarBlock[] = [];
  const keyOf = (b: ScheduleClosureCalendarBlock) => `${b.calendar_id ?? b.practitioner_id ?? ''}|${b.block_date}`;
  const rangeOf = (b: ScheduleClosureCalendarBlock): MinuteRange => ({
    start: timeToMinutes(hm(b.start_time)),
    end: timeToMinutes(hm(b.end_time)),
  });
  for (const b of blocks) {
    if (b.block_type === 'venue_closed') {
      venueByKey.set(keyOf(b), [...(venueByKey.get(keyOf(b)) ?? []), rangeOf(b)]);
    } else if (b.block_type === 'practitioner_closed') {
      calByKey.set(keyOf(b), [...(calByKey.get(keyOf(b)) ?? []), rangeOf(b)]);
    } else {
      passthrough.push(b);
    }
  }
  const out: ScheduleClosureCalendarBlock[] = [];
  const keys = new Set<Key>([...venueByKey.keys(), ...calByKey.keys()]);
  for (const key of keys) {
    const [columnId, dateStr] = key.split('|') as [string, string];
    const venue = venueByKey.get(key) ?? [];
    const cal = calByKey.get(key) ?? [];
    const both = intersectRanges(venue, cal);
    for (const r of subtractRanges(venue, cal)) out.push(toScheduleBlock('venue_closed', columnId, dateStr, r, null));
    for (const r of subtractRanges(cal, venue)) out.push(toScheduleBlock('practitioner_closed', columnId, dateStr, r, null));
    for (const r of both) out.push(toScheduleBlock('venue_and_calendar_closed', columnId, dateStr, r, null));
  }
  return [...out, ...passthrough];
}

/**
 * The earliest start and latest end any of these calendars is scheduled to
 * work across the dates, in minutes from midnight. The diary widens its grid
 * to this so a calendar working past the venue's hours is always drawn, with
 * the venue-closed stripe explaining the difference.
 */
export function calendarWorkingBoundsForDates(
  practitioners: PractitionerClosureInput[],
  fromDate: string,
  toDate: string,
): { start: number; end: number } | null {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const prac of practitioners) {
    if (!prac.is_active) continue;
    for (const dateStr of enumerateDatesInclusive(fromDate, toDate)) {
      for (const r of getWorkingRanges(prac as Practitioner, dateStr)) {
        if (!Number.isFinite(r.start) || !Number.isFinite(r.end) || r.end <= r.start) continue;
        start = Math.min(start, r.start);
        end = Math.max(end, r.end);
      }
    }
  }
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
}
