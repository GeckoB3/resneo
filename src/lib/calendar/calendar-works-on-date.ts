import { getWorkingRanges } from '@/lib/availability/appointment-engine';
import { effectiveWorkingHoursForDate } from '@/lib/availability/working-hours-rota';
import { resolveVenueWideAllowedMinuteRanges } from '@/lib/availability/venue-wide-business-hours';
import {
  leaveForPractitionerOnDate,
  type PractitionerLeavePeriodInput,
} from '@/lib/calendar/schedule-closure-blocks';
import { getDayOfWeekForYmdInTimezone } from '@/lib/venue/venue-local-clock';
import type { AvailabilityBlock, OpeningHours } from '@/types/availability';
import type { Practitioner, WorkingHours } from '@/types/booking-models';

const LEGACY_DAY_NAME_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

type MinuteRange = { start: number; end: number };

export interface CalendarWorkingHoursSource {
  working_hours?: WorkingHours | null;
  schedule_periods?: unknown;
  working_hours_rota?: unknown;
  /** Exact ISO dates the calendar is off (the engines also honour a lowercase weekday name). */
  days_off?: string[] | null;
}

/**
 * Whether a calendar's weekly template (or the rota period covering the date)
 * gives it any hours on `dateYmd`, minus a day off. This is the template-only
 * answer, for a LINKED column, whose owner venue shares its weekly hours but
 * not its leave or closures. Own columns use `calendarHasAvailableHoursOnDate`.
 */
export function calendarWorksOnDate(
  row: CalendarWorkingHoursSource,
  dateYmd: string,
  timeZone: string,
): boolean {
  const dow = getDayOfWeekForYmdInTimezone(dateYmd, timeZone);
  const dayName = LEGACY_DAY_NAME_KEYS[dow];
  if (Array.isArray(row.days_off) && row.days_off.some((d) => d === dateYmd || d === dayName)) {
    return false;
  }
  const hours = effectiveWorkingHoursForDate(row, dateYmd);
  const periods = hours[String(dow)] ?? hours[dayName as string];
  if (!Array.isArray(periods)) return false;
  return periods.some((p) => Boolean((p.start ?? '').trim()) && Boolean((p.end ?? '').trim()));
}

function subtractRanges(open: MinuteRange[], closed: MinuteRange[]): MinuteRange[] {
  let out = open.filter((r) => r.end > r.start);
  for (const c of closed) {
    const next: MinuteRange[] = [];
    for (const r of out) {
      if (c.end <= r.start || c.start >= r.end) {
        next.push(r);
        continue;
      }
      if (c.start > r.start) next.push({ start: r.start, end: c.start });
      if (c.end < r.end) next.push({ start: c.end, end: r.end });
    }
    out = next;
  }
  return out;
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
  return out;
}

/**
 * Whether one of this venue's own calendars has any bookable minute left on
 * `dateYmd`: its working hours for the date (rota, template, days off, through
 * the same resolver the engines use), minus recorded leave, minus the venue's
 * own closures and opening hours. A full day of leave, a venue closure, or a
 * partial leave that swallows every working minute all answer false.
 *
 * Drives the calendar's "Only calendars working on the selected day" filter,
 * which asks whether the column has hours to show, not whether it is busy, so
 * staff "block time" is deliberately not subtracted.
 */
export function calendarHasAvailableHoursOnDate(params: {
  practitioner: Practitioner;
  dateYmd: string;
  leavePeriods: PractitionerLeavePeriodInput[];
  openingHours: OpeningHours | null | undefined;
  venueWideBlocks: AvailabilityBlock[];
}): boolean {
  const { practitioner, dateYmd, leavePeriods, openingHours, venueWideBlocks } = params;
  let open: MinuteRange[] = getWorkingRanges(practitioner, dateYmd);
  if (open.length === 0) return false;

  const leave = leaveForPractitionerOnDate(practitioner.id, dateYmd, leavePeriods);
  if (leave.fullDay) return false;
  open = subtractRanges(open, leave.partial);

  const venue = resolveVenueWideAllowedMinuteRanges(openingHours, dateYmd, venueWideBlocks);
  if (venue.kind === 'closed') return false;
  open = venue.kind === 'allowed' ? intersectRanges(open, venue.ranges) : subtractRanges(open, venue.closures);

  return open.some((r) => r.end > r.start);
}
