/**
 * Advice when calendar hours and business hours disagree.
 *
 * Guests can only book where a calendar's hours fall INSIDE the venue's, so
 * a calendar set to work past closing, or a venue narrowed under a calendar,
 * produces hours that exist but never sell. Neither save is refused (the
 * venue layer already decides what is bookable, and clamping would throw
 * away a setting the owner may want back); instead every save that creates
 * the gap says so and points at the other screen.
 *
 * Two shapes of comparison:
 *  - weekly: a calendar's `working_hours` template against the venue's weekly
 *    `opening_hours`, day by day (the Availability tab, the Weekly opening
 *    hours card);
 *  - dated: what a calendar actually works on given dates (rota, schedule
 *    periods and amended hours resolved by `getWorkingRanges`) against the
 *    venue's resolved hours for those dates (closures and amended hours).
 */

import { getWorkingRanges } from '@/lib/availability/appointment-engine';
import { resolveVenueWideAllowedMinuteRanges } from '@/lib/availability/venue-wide-business-hours';
import { calendarHoursOutsideVenue, venueDayContext, describeVenueDay } from '@/lib/calendar/venue-hours-context';
import { addCalendarDays } from '@/lib/calendar/schedule-blocks-grouping';
import type { AvailabilityBlock, OpeningHours } from '@/types/availability';
import type { Practitioner, WorkingHours } from '@/types/booking-models';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_KEYS = ['0', '1', '2', '3', '4', '5', '6'] as const;
const LEGACY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function weeklyPeriods(wh: WorkingHours | null | undefined, dow: number): Array<{ open: string; close: string }> {
  if (!wh) return [];
  const numeric = wh[DAY_KEYS[dow]!];
  const legacy = wh[LEGACY_KEYS[dow]!];
  const list = Array.isArray(numeric) && numeric.length > 0 ? numeric : Array.isArray(legacy) ? legacy : [];
  return list
    .map((p) => ({ open: (p.start ?? '').slice(0, 5), close: (p.end ?? '').slice(0, 5) }))
    .filter((p) => p.open && p.close);
}

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

function describeCalendarPeriods(periods: Array<{ open: string; close: string }>): string {
  return periods.map((p) => `${p.open} to ${p.close}`).join(', ');
}

function dateLabel(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export interface WeeklyHoursMismatch {
  dayKey: string;
  dayName: string;
  calendarHours: string;
  venueHours: string;
}

/**
 * Weekdays on which a calendar's weekly hours run outside the venue's weekly
 * hours. Empty when the venue has no opening hours at all (no constraint).
 */
export function weeklyCalendarHoursOutsideVenue(
  workingHours: WorkingHours | null | undefined,
  openingHours: OpeningHours | null | undefined,
): WeeklyHoursMismatch[] {
  const out: WeeklyHoursMismatch[] = [];
  for (let dow = 0; dow < 7; dow++) {
    const periods = weeklyPeriods(workingHours, dow);
    if (periods.length === 0) continue;
    const ctx = venueDayContext(openingHours, DAY_KEYS[dow]!);
    if (!calendarHoursOutsideVenue(periods, ctx)) continue;
    out.push({
      dayKey: DAY_KEYS[dow]!,
      dayName: DAY_NAMES[dow]!,
      calendarHours: describeCalendarPeriods(periods),
      venueHours: describeVenueDay(ctx),
    });
  }
  return out;
}

/** Sentence for the calendar side: this calendar's weekly hours vs the venue's. */
export function describeCalendarWeeklyMismatch(calendarName: string, mismatches: WeeklyHoursMismatch[]): string | null {
  if (mismatches.length === 0) return null;
  const first = mismatches[0]!;
  const days =
    mismatches.length === 1
      ? first.dayName
      : mismatches.length === 2
        ? `${first.dayName} and ${mismatches[1]!.dayName}`
        : `${mismatches.length} days (${mismatches.map((m) => m.dayName.slice(0, 3)).join(', ')})`;
  return (
    `${calendarName}'s hours on ${days} run outside your business hours ` +
    `(${first.dayName}: calendar ${first.calendarHours}, business ${first.venueHours}). ` +
    `Guests can only book within business hours, so widen your business hours for ${mismatches.length === 1 ? 'that day' : 'those days'} too.`
  );
}

export interface CalendarLike {
  id: string;
  name: string;
  is_active?: boolean;
  calendar_type?: string | null;
  working_hours?: WorkingHours | null;
}

/** Sentence for the venue side: which calendars the new weekly hours leave outside. */
export function describeVenueWeeklyMismatch(
  calendars: CalendarLike[],
  openingHours: OpeningHours | null | undefined,
): string | null {
  const hits: string[] = [];
  for (const c of calendars) {
    if (c.is_active === false || c.calendar_type === 'resource') continue;
    const m = weeklyCalendarHoursOutsideVenue(c.working_hours, openingHours);
    if (m.length === 0) continue;
    const first = m[0]!;
    hits.push(`${c.name} (${first.dayName} ${first.calendarHours}${m.length > 1 ? `, and ${m.length - 1} more day${m.length > 2 ? 's' : ''}` : ''})`);
  }
  if (hits.length === 0) return null;
  const list = hits.length <= 3 ? hits.join('; ') : `${hits.slice(0, 3).join('; ')}; and ${hits.length - 3} more`;
  return (
    `These business hours are narrower than the calendar hours of ${list}. ` +
    `Guests can only book within business hours. Widen the business hours, or adjust those calendars' hours to match.`
  );
}

function enumerateDates(from: string, to: string, cap = 62): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to && out.length < cap) {
    out.push(cur);
    if (cur === to) break;
    cur = addCalendarDays(cur, 1);
  }
  return out;
}

export interface DatedHoursMismatch {
  calendarName: string;
  date: string;
  calendarHours: string;
  venueHours: string;
}

/**
 * Dates on which a calendar is scheduled to work outside the venue's resolved
 * hours (closures and amended hours applied). Used after a venue closure or
 * amended-hours save, for the dates it covers.
 */
export function datedCalendarHoursOutsideVenue(
  calendars: CalendarLike[],
  openingHours: OpeningHours | null | undefined,
  venueWideBlocks: AvailabilityBlock[],
  fromDate: string,
  toDate: string,
): DatedHoursMismatch[] {
  const out: DatedHoursMismatch[] = [];
  for (const c of calendars) {
    if (c.is_active === false || c.calendar_type === 'resource') continue;
    for (const date of enumerateDates(fromDate, toDate)) {
      const working = getWorkingRanges(c as unknown as Practitioner, date);
      if (working.length === 0) continue;
      const venue = resolveVenueWideAllowedMinuteRanges(openingHours, date, venueWideBlocks);
      if (venue.kind === 'unrestricted') continue;
      const fits =
        venue.kind === 'allowed' &&
        working.every((w) => venue.ranges.some((v) => w.start >= v.start && w.end <= v.end));
      if (fits) continue;
      out.push({
        calendarName: c.name,
        date,
        calendarHours: working.map((w) => `${hhmm(w.start)} to ${hhmm(w.end)}`).join(', '),
        venueHours: venue.kind === 'closed' ? 'closed' : venue.ranges.map((v) => `${hhmm(v.start)} to ${hhmm(v.end)}`).join(', '),
      });
    }
  }
  return out;
}

/** Sentence for the venue side after a closure or amended-hours save. */
export function describeDatedMismatch(mismatches: DatedHoursMismatch[]): string | null {
  if (mismatches.length === 0) return null;
  const first = mismatches[0]!;
  const names = Array.from(new Set(mismatches.map((m) => m.calendarName)));
  const who = names.length === 1 ? names[0]! : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]}, ${names[1]} and ${names.length - 2} more`;
  const where =
    first.venueHours === 'closed'
      ? `the venue is closed on ${dateLabel(first.date)}`
      : `business hours on ${dateLabel(first.date)} are ${first.venueHours}`;
  return (
    `${who} ${names.length === 1 ? 'is' : 'are'} still scheduled to work outside these hours ` +
    `(${first.calendarName} works ${first.calendarHours} but ${where}` +
    `${mismatches.length > 1 ? `, and ${mismatches.length - 1} more date${mismatches.length > 2 ? 's' : ''}` : ''}). ` +
    `Guests can only book within business hours. Adjust those calendars' hours or closures to match.`
  );
}
