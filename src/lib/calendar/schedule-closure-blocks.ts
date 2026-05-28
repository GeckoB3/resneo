/**
 * Synthetic read-only blocks for the staff appointment calendar: venue closures /
 * amended hours and per-calendar working-hour / leave closures.
 */

import { addCalendarDays } from '@/lib/calendar/schedule-blocks-grouping';
import { getWorkingRanges } from '@/lib/availability/appointment-engine';
import { getCalendarGridBounds } from '@/lib/venue-calendar-bounds';
import { minutesToTime, timeToMinutes } from '@/lib/availability';
import {
  blocksForDate,
  resolveVenueWideAllowedMinuteRanges,
} from '@/lib/availability/venue-wide-business-hours';
import type { AvailabilityBlock, OpeningHours } from '@/types/availability';
import type { Practitioner } from '@/types/booking-models';

export interface ScheduleClosureCalendarBlock {
  id: string;
  practitioner_id: string | null;
  calendar_id: string | null;
  block_date: string;
  start_time: string;
  end_time: string;
  reason: string | null;
  block_type: 'venue_closed' | 'venue_amended_hours' | 'practitioner_closed';
}

export interface PractitionerLeavePeriodInput {
  practitioner_id: string;
  start_date: string;
  end_date: string;
  unavailable_start_time?: string | null;
  unavailable_end_time?: string | null;
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

function unionAmendedPeriodsForDate(blocks: AvailabilityBlock[]): MinuteRange[] {
  const periods: MinuteRange[] = [];
  for (const b of blocks) {
    if (b.block_type !== 'amended_hours' || !Array.isArray(b.override_periods)) continue;
    for (const p of b.override_periods) {
      periods.push({ start: timeToMinutes(p.open), end: timeToMinutes(p.close) });
    }
  }
  return mergeAdjacentRanges(periods);
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
): { start: number; end: number } {
  const { startHour, endHour } = getCalendarGridBounds(dateStr, openingHours, 7, 21, { timeZone });
  return { start: startHour * 60, end: endHour * 60 };
}

/**
 * Venue-wide closed windows and amended-hours indicators for each visible calendar column.
 */
export function buildVenueScheduleClosureBlocks(params: {
  openingHours: OpeningHours | null | undefined;
  venueWideBlocks: AvailabilityBlock[];
  fromDate: string;
  toDate: string;
  columnIds: string[];
  timeZone?: string | null;
}): ScheduleClosureCalendarBlock[] {
  const { openingHours, venueWideBlocks, fromDate, toDate, columnIds, timeZone } = params;
  if (columnIds.length === 0) return [];

  const out: ScheduleClosureCalendarBlock[] = [];
  for (const dateStr of enumerateDatesInclusive(fromDate, toDate)) {
    const bounds = gridMinuteBounds(dateStr, openingHours, timeZone);
    const resolution = resolveVenueWideAllowedMinuteRanges(openingHours, dateStr, venueWideBlocks);
    const dayBlocks = blocksForDate(venueWideBlocks, dateStr);
    const amendedUnion = unionAmendedPeriodsForDate(dayBlocks);

    let closedRanges: MinuteRange[] = [];
    let allowedRanges: MinuteRange[] = [];

    if (resolution.kind === 'closed') {
      closedRanges = [{ start: bounds.start, end: bounds.end }];
    } else if (resolution.kind === 'allowed') {
      allowedRanges = resolution.ranges;
      closedRanges = closedRangesFromOpenWindows(allowedRanges, bounds.start, bounds.end);
    } else {
      continue;
    }

    // `resolution.kind` is narrowed to 'closed' | 'allowed' here (the third kind
    // `continue`s above), so no further `unrestricted` guard is needed.
    const amendedRanges =
      amendedUnion.length > 0
        ? resolution.kind === 'allowed'
          ? intersectRanges(amendedUnion, allowedRanges)
          : amendedUnion.filter((r) => r.end > bounds.start && r.start < bounds.end)
        : [];

    for (const columnId of columnIds) {
      for (const range of closedRanges) {
        out.push(toScheduleBlock('venue_closed', columnId, dateStr, range, null));
      }
      for (const range of amendedRanges) {
        const clipped: MinuteRange = {
          start: Math.max(range.start, bounds.start),
          end: Math.min(range.end, bounds.end),
        };
        if (clipped.end <= clipped.start) continue;
        out.push(toScheduleBlock('venue_amended_hours', columnId, dateStr, clipped, null));
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

function leaveForPractitionerOnDate(
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
}): ScheduleClosureCalendarBlock[] {
  const { practitioners, leavePeriods, fromDate, toDate, openingHours, timeZone } = params;
  const out: ScheduleClosureCalendarBlock[] = [];

  for (const prac of practitioners) {
    if (!prac.is_active) continue;
    const asPractitioner = prac as Practitioner;

    for (const dateStr of enumerateDatesInclusive(fromDate, toDate)) {
      const bounds = gridMinuteBounds(dateStr, openingHours, timeZone);
      const leave = leaveForPractitionerOnDate(prac.id, dateStr, leavePeriods);
      const working = getWorkingRanges(asPractitioner, dateStr);

      let closedRanges: MinuteRange[] = [];
      if (leave.fullDay || working.length === 0) {
        closedRanges = [{ start: bounds.start, end: bounds.end }];
      } else {
        closedRanges = closedRangesFromOpenWindows(working, bounds.start, bounds.end);
        if (leave.partial.length > 0) {
          closedRanges = mergeAdjacentRanges([...closedRanges, ...leave.partial]);
        }
      }

      for (const range of closedRanges) {
        out.push(toScheduleBlock('practitioner_closed', prac.id, dateStr, range, null));
      }
    }
  }

  return out;
}

export function isScheduleClosureBlockType(blockType: string | undefined): boolean {
  return (
    blockType === 'venue_closed' ||
    blockType === 'venue_amended_hours' ||
    blockType === 'practitioner_closed'
  );
}

export function scheduleClosureBlockLabel(blockType: string | undefined): string {
  if (blockType === 'venue_amended_hours') return 'Amended hours';
  if (blockType === 'venue_closed' || blockType === 'practitioner_closed') return 'Closed';
  return 'Closed';
}
