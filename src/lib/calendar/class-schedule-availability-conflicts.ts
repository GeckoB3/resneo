/**
 * Availability guard for *scheduling a class session* on a team calendar column.
 *
 * A class session must never be placed on top of:
 *   - a venue-wide business closure / special event / amended-hours window
 *     (date-specific `availability_blocks`),
 *   - a calendar closure (staff leave from `practitioner_leave_periods`, full-day
 *     or partial; or a one-off date listed in the calendar's `days_off`),
 *   - a break (`break_times` / `break_times_by_day` on the calendar column),
 *   - blocked time (legacy `practitioner_calendar_blocks`).
 *
 * Existing bookings, events, other class sessions and unified `calendar_blocks`
 * are handled separately by `assertExperienceEventWindowFreeOnCalendar`; this
 * module covers the closure/leave/break/block sources that check did not.
 *
 * Design note — classes are *explicitly scheduled* by staff, so (like the public
 * class-availability engine) they are deliberately NOT constrained by the venue's
 * recurring weekly opening hours or the calendar's recurring weekly working hours:
 * a 7pm class is allowed even when the venue/calendar normally works 9–5. Only the
 * date-specific closures, leave, days-off and breaks above can block a session, so
 * evening/weekend classes keep working while real clashes are caught.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AvailabilityBlock, OpeningHours } from '@/types/availability';
import type { WorkingHours } from '@/types/booking-models';
import { timeToMinutes, minutesToTime, getDayOfWeek } from '@/lib/availability';
import {
  blocksForDate,
  resolveVenueWideAllowedMinuteRanges,
  isMinuteSubintervalCoveredByRanges,
} from '@/lib/availability/venue-wide-business-hours';
import { rowsToVenueWideBlocks, venueWideBlocksQueryForDate } from '@/lib/availability/venue-wide-blocks-fetch';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Deterministic, ICU-free "Mon 6 Jul 2026" for a YYYY-MM-DD string. */
export function formatScheduleDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).trim());
  if (!m) return String(iso);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dow = getDayOfWeek(iso);
  const weekday = WEEKDAYS[dow] ?? '';
  const monthName = MONTHS[month - 1] ?? String(month);
  return `${weekday} ${day} ${monthName} ${year}`.trim();
}

/** "HH:mm" from a Postgres `time` / "HH:mm" / "HH:mm:ss" value. */
function hhmm(value: string): string {
  const s = String(value).trim();
  return s.length >= 5 ? s.slice(0, 5) : s;
}

function toMinutes(value: string): number {
  return timeToMinutes(hhmm(value));
}

function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

/** Append the offending date/time to an overlap message so bulk scheduling errors name the session. */
export function withScheduleDateContext(message: string, date: string, startHHmm: string): string {
  const base = message.replace(/\s*$/, '').replace(/\.$/, '');
  return `${base} (${formatScheduleDate(date)} at ${hhmm(startHHmm)}).`;
}

/** Break ranges (minutes) for a calendar on a date — mirrors the appointment engine's getBreakRanges. */
export function classCalendarBreakRanges(
  breakTimes: Array<{ start: string; end: string }> | null | undefined,
  breakTimesByDay: WorkingHours | null | undefined,
  dateStr: string,
): Array<{ start: number; end: number }> {
  if (breakTimesByDay && typeof breakTimesByDay === 'object' && !Array.isArray(breakTimesByDay) && Object.keys(breakTimesByDay).length > 0) {
    const dayKey = String(getDayOfWeek(dateStr));
    const dayName = DAY_NAMES[getDayOfWeek(dateStr)]!;
    const ranges = breakTimesByDay[dayKey] ?? breakTimesByDay[dayName];
    if (!ranges || !Array.isArray(ranges) || ranges.length === 0) return [];
    return ranges
      .map((b) => ({ start: toMinutes(b.start), end: toMinutes(b.end) }))
      .filter((r) => r.end > r.start);
  }
  if (!Array.isArray(breakTimes)) return [];
  return breakTimes
    .map((b) => ({ start: toMinutes(b.start), end: toMinutes(b.end) }))
    .filter((r) => r.end > r.start);
}

export interface ClassWindowAvailabilityData {
  date: string;
  startMin: number;
  endMin: number;
  calendarName: string | null;
  openingHours: OpeningHours | null;
  /** Venue-wide closure / amended-hours blocks overlapping `date`. */
  venueWideBlocks: AvailabilityBlock[];
  /** `practitioner_leave_periods` rows overlapping `date` for this calendar. */
  leavePeriods: Array<{ unavailable_start_time: string | null; unavailable_end_time: string | null }>;
  /** Calendar `days_off` (recurring weekday names are ignored; only exact dates block). */
  daysOff: string[];
  breakTimes: Array<{ start: string; end: string }> | null;
  breakTimesByDay: WorkingHours | null;
  /** Legacy `practitioner_calendar_blocks` rows for this calendar on `date`. */
  blockedRanges: Array<{ start_time: string; end_time: string; reason?: string | null }>;
}

/**
 * Pure evaluation of all closure/leave/break/block sources for a class window.
 * Returns a user-facing message when the window is not schedulable, else null.
 */
export function evaluateClassWindowAvailabilityConflict(data: ClassWindowAvailabilityData): string | null {
  const { date, startMin, endMin } = data;
  if (endMin <= startMin) return 'End time must be after start time.';

  const who = data.calendarName?.trim() ? data.calendarName.trim() : 'This calendar';
  const startLabel = minutesToTime(startMin);
  const endLabel = minutesToTime(endMin);
  const dateLabel = formatScheduleDate(date);

  // 1. Venue-wide business closure (only date-specific blocks constrain classes).
  const dayBlocks = blocksForDate(data.venueWideBlocks, date);
  if (dayBlocks.length > 0) {
    const res = resolveVenueWideAllowedMinuteRanges(data.openingHours, date, data.venueWideBlocks);
    if (res.kind === 'closed') {
      return `The venue is closed on ${dateLabel}, so this class can’t be scheduled then. Remove or amend that closure first.`;
    }
    if (res.kind === 'allowed' && !isMinuteSubintervalCoveredByRanges(startMin, endMin, res.ranges)) {
      return `On ${dateLabel}, ${startLabel}–${endLabel} falls inside a venue closure or outside the venue’s amended hours for that date. Pick a time inside the open hours.`;
    }
  }

  // 2. Calendar closure — staff leave (full day or a partial window).
  for (const leave of data.leavePeriods) {
    const st = leave.unavailable_start_time;
    const en = leave.unavailable_end_time;
    if (st == null && en == null) {
      return `${who} is on leave (marked unavailable all day) on ${dateLabel}. Choose another day or remove the leave.`;
    }
    if (st != null && en != null) {
      const ls = toMinutes(st);
      const le = toMinutes(en);
      if (le > ls && overlaps(startMin, endMin, ls, le)) {
        return `${who} is on leave from ${hhmm(st)} to ${hhmm(en)} on ${dateLabel}, which clashes with this class time.`;
      }
    }
  }

  // 3. Calendar closure — a one-off day off listed against the exact date.
  if (Array.isArray(data.daysOff) && data.daysOff.includes(date)) {
    return `${who} is marked as a day off on ${dateLabel}. Choose another day or clear that day off.`;
  }

  // 4. Break on the calendar column.
  const breakRanges = classCalendarBreakRanges(data.breakTimes, data.breakTimesByDay, date);
  for (const br of breakRanges) {
    if (overlaps(startMin, endMin, br.start, br.end)) {
      return `This class time (${startLabel}–${endLabel}) overlaps a break (${minutesToTime(br.start)}–${minutesToTime(br.end)}) on ${who}’s calendar on ${dateLabel}.`;
    }
  }

  // 5. Legacy blocked time (unified calendar_blocks are covered elsewhere).
  for (const block of data.blockedRanges) {
    const bs = toMinutes(block.start_time);
    const be = toMinutes(block.end_time);
    if (be > bs && overlaps(startMin, endMin, bs, be)) {
      const reason = block.reason?.trim();
      return `This class time overlaps blocked time${reason ? ` (${reason})` : ''} on ${who}’s calendar on ${dateLabel}.`;
    }
  }

  return null;
}

/**
 * Loads closure/leave/break/block data for the calendar column and evaluates whether a class
 * window can be scheduled. Returns a user-facing message (already date-stamped) or null.
 *
 * Fails closed: if any closure/leave source cannot be read, a session is refused rather than
 * silently scheduled over a possible closure.
 */
export async function findClassScheduleWindowAvailabilityConflict(
  admin: SupabaseClient,
  params: { venueId: string; calendarId: string; date: string; startHHmm: string; endHHmm: string },
): Promise<string | null> {
  const { venueId, calendarId, date, startHHmm, endHHmm } = params;
  const startMin = toMinutes(startHHmm);
  const endMin = toMinutes(endHHmm);
  if (endMin <= startMin) return 'End time must be after start time.';

  const [calRes, leaveRes, venueRes, venueBlocksRes, pcbRes] = await Promise.all([
    admin
      .from('unified_calendars')
      .select('name, days_off, break_times, break_times_by_day')
      .eq('id', calendarId)
      .eq('venue_id', venueId)
      .maybeSingle(),
    admin
      .from('practitioner_leave_periods')
      .select('unavailable_start_time, unavailable_end_time')
      .eq('venue_id', venueId)
      .eq('practitioner_id', calendarId)
      .lte('start_date', date)
      .gte('end_date', date),
    admin.from('venues').select('opening_hours').eq('id', venueId).maybeSingle(),
    venueWideBlocksQueryForDate(admin, venueId, date),
    admin
      .from('practitioner_calendar_blocks')
      .select('start_time, end_time, reason')
      .eq('venue_id', venueId)
      .eq('practitioner_id', calendarId)
      .eq('block_date', date),
  ]);

  // Fail closed on any read error for a closure/leave source.
  if (calRes.error) {
    console.error('[findClassScheduleWindowAvailabilityConflict] unified_calendars:', calRes.error.message);
    return 'Could not verify the calendar’s availability for this date. Please try again.';
  }
  if (leaveRes.error) {
    console.error('[findClassScheduleWindowAvailabilityConflict] practitioner_leave_periods:', leaveRes.error.message);
    return 'Could not verify staff leave for this date. Please try again.';
  }
  if (venueBlocksRes.error) {
    console.error('[findClassScheduleWindowAvailabilityConflict] availability_blocks:', venueBlocksRes.error.message);
    return 'Could not verify venue closures for this date. Please try again.';
  }
  if (pcbRes.error) {
    console.error('[findClassScheduleWindowAvailabilityConflict] practitioner_calendar_blocks:', pcbRes.error.message);
    return 'Could not verify blocked time for this date. Please try again.';
  }

  const cal = (calRes.data ?? null) as {
    name?: string | null;
    days_off?: unknown;
    break_times?: unknown;
    break_times_by_day?: unknown;
  } | null;

  return evaluateClassWindowAvailabilityConflict({
    date,
    startMin,
    endMin,
    calendarName: (cal?.name as string | null) ?? null,
    openingHours: (venueRes.data?.opening_hours as OpeningHours | null) ?? null,
    venueWideBlocks: rowsToVenueWideBlocks(venueBlocksRes.data),
    leavePeriods: (leaveRes.data ?? []) as Array<{
      unavailable_start_time: string | null;
      unavailable_end_time: string | null;
    }>,
    daysOff: Array.isArray(cal?.days_off) ? (cal!.days_off as string[]) : [],
    breakTimes: Array.isArray(cal?.break_times) ? (cal!.break_times as Array<{ start: string; end: string }>) : null,
    breakTimesByDay:
      cal?.break_times_by_day && typeof cal.break_times_by_day === 'object' && !Array.isArray(cal.break_times_by_day)
        ? (cal.break_times_by_day as WorkingHours)
        : null,
    blockedRanges: (pcbRes.data ?? []) as Array<{ start_time: string; end_time: string; reason?: string | null }>,
  });
}
