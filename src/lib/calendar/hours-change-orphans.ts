/**
 * Detect upcoming bookings that an opening/working-hours change would push *outside* the
 * new hours (i.e. bookings that fit the OLD hours but not the NEW ones). Used to warn —
 * not block — when a venue narrows or shifts hours: existing bookings are honoured
 * (grandfathered), but the venue is told which upcoming ones now fall outside hours.
 *
 * Mirror note: closures over bookings are *hard-blocked* (see closure-booking-conflicts.ts)
 * because a closure is a deliberate "not here at this exact time". An hours change is a
 * forward-looking policy, so existing commitments are kept and the venue is merely warned.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getOpeningPeriodsForDay, timeToMinutes } from '@/lib/availability';
import { getDayOfWeek } from '@/lib/availability/engine';
import type { OpeningHours } from '@/types/availability';
import { BOOKING_ACTIVE_STATUSES } from '@/lib/table-management/constants';

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export interface MinuteRange {
  start: number;
  end: number;
}

/** A function returning the open minute-ranges for a given YYYY-MM-DD under some hours set. */
export type PeriodsForDate = (dateStr: string) => MinuteRange[];

function hhmmToMinutes(t: string): number {
  const s = String(t).trim();
  return timeToMinutes(s.length >= 5 ? s.slice(0, 5) : s);
}

function estimatedEndMinutesFromDb(value: string): number {
  const s = String(value).trim();
  const tIdx = s.indexOf('T');
  if (tIdx !== -1) {
    const afterT = s.slice(tIdx + 1);
    const timePart = afterT.split(/[Z+-]/)[0]?.trim() ?? afterT;
    return hhmmToMinutes(timePart);
  }
  return hhmmToMinutes(s);
}

function bookingWindowEndMinutes(row: {
  booking_time: string;
  booking_end_time?: string | null;
  estimated_end_time?: string | null;
}): number {
  const start = hhmmToMinutes(row.booking_time);
  if (row.booking_end_time) return hhmmToMinutes(String(row.booking_end_time));
  if (row.estimated_end_time) return estimatedEndMinutesFromDb(String(row.estimated_end_time));
  return start + 60;
}

/** Open minute-ranges for a date under venue weekly `opening_hours` (`{periods}` shape). */
export function venueWeeklyMinutesForDate(openingHours: OpeningHours | null | undefined): PeriodsForDate {
  return (dateStr: string) =>
    getOpeningPeriodsForDay(openingHours ?? null, getDayOfWeek(dateStr)).map((p) => ({
      start: hhmmToMinutes(p.open),
      end: hhmmToMinutes(p.close),
    }));
}

/** Open minute-ranges for a date under a calendar's `working_hours` (`[{start,end}]` shape). */
export function calendarWorkingMinutesForDate(
  workingHours: Record<string, Array<{ start: string; end: string }>> | null | undefined,
): PeriodsForDate {
  return (dateStr: string) => {
    const hours = workingHours ?? {};
    const dow = getDayOfWeek(dateStr);
    const ranges = hours[String(dow)] ?? hours[DAY_NAMES[dow]!] ?? [];
    if (!Array.isArray(ranges)) return [];
    return ranges.map((r) => ({ start: hhmmToMinutes(r.start), end: hhmmToMinutes(r.end) }));
  };
}

/** True when `[b0, b1)` is fully contained within one of the open periods. */
export function bookingFitsWithinOpenMinutes(b0: number, b1: number, periods: MinuteRange[]): boolean {
  return periods.some((p) => b0 >= p.start && b1 <= p.end);
}

function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const hour = h ?? 0;
  const isAm = hour < 12;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(m ?? 0).padStart(2, '0')}${isAm ? 'am' : 'pm'}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "Tue 23 Jun, 9:00pm — Jane Doe" (name optional). Pure string formatting, no Date.now. */
export function formatOrphanLabel(dateStr: string, hhmm: string, name?: string | null): string {
  const dow = getDayOfWeek(dateStr);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow];
  const month = MONTHS[(Number(dateStr.slice(5, 7)) || 1) - 1];
  const day = Number(dateStr.slice(8, 10)) || Number(dateStr.slice(8));
  const trimmed = name?.trim();
  return `${weekday} ${day} ${month}, ${to12h(hhmm)}${trimmed ? ` — ${trimmed}` : ''}`;
}

export interface OrphanedBooking {
  bookingId: string;
  bookingDate: string;
  bookingTime: string;
  label: string;
}

export interface HoursChangeOrphanResult {
  total: number;
  sample: OrphanedBooking[];
}

const SAMPLE_LIMIT = 5;

/**
 * Upcoming active bookings (on/after `fromDate`) that fit the old hours but not the new ones.
 * `calendarColumnId` restricts to one calendar column (+ resources displayed on it); omit for
 * a venue-wide change. `skipDate` lets a venue change ignore dates governed by a per-date
 * exception (the weekly edit does not change those days). Throws if the bookings lookup fails.
 */
export async function findBookingsOrphanedByHoursChange(
  admin: SupabaseClient,
  params: {
    venueId: string;
    fromDate: string;
    oldPeriodsForDate: PeriodsForDate;
    newPeriodsForDate: PeriodsForDate;
    calendarColumnId?: string;
    skipDate?: (dateStr: string) => boolean;
  },
): Promise<HoursChangeOrphanResult> {
  const { venueId, fromDate, oldPeriodsForDate, newPeriodsForDate, calendarColumnId, skipDate } = params;

  let resourceHostByResourceId = new Map<string, string>();
  if (calendarColumnId) {
    const { data: resourceRows } = await admin
      .from('unified_calendars')
      .select('id, display_on_calendar_id')
      .eq('venue_id', venueId)
      .eq('calendar_type', 'resource')
      .eq('display_on_calendar_id', calendarColumnId);
    resourceHostByResourceId = new Map(
      (resourceRows ?? []).map((r) => {
        const row = r as { id: string; display_on_calendar_id: string };
        return [row.id, row.display_on_calendar_id];
      }),
    );
  }

  const { data: bookings, error } = await admin
    .from('bookings')
    .select(
      'id, booking_date, booking_time, booking_end_time, estimated_end_time, status, calendar_id, practitioner_id, resource_id, guest_first_name, guest_last_name',
    )
    .eq('venue_id', venueId)
    .gte('booking_date', fromDate)
    .in('status', [...BOOKING_ACTIVE_STATUSES]);

  if (error) {
    throw new Error(`Could not verify existing bookings: ${error.message}`);
  }

  const orphans: OrphanedBooking[] = [];
  for (const raw of bookings ?? []) {
    const r = raw as Record<string, unknown>;
    const bookingTime = typeof r.booking_time === 'string' ? r.booking_time : null;
    if (!bookingTime) continue;
    const dateStr = String(r.booking_date);

    if (calendarColumnId) {
      const calId = typeof r.calendar_id === 'string' ? r.calendar_id : null;
      const pracId = typeof r.practitioner_id === 'string' ? r.practitioner_id : null;
      const resId = typeof r.resource_id === 'string' ? r.resource_id : null;
      const onColumn =
        calId === calendarColumnId ||
        pracId === calendarColumnId ||
        (resId != null && resourceHostByResourceId.has(resId));
      if (!onColumn) continue;
    }

    if (skipDate?.(dateStr)) continue;

    const b0 = hhmmToMinutes(bookingTime);
    const b1 = bookingWindowEndMinutes({
      booking_time: bookingTime,
      booking_end_time: r.booking_end_time as string | null | undefined,
      estimated_end_time: r.estimated_end_time as string | null | undefined,
    });

    const fitsOld = bookingFitsWithinOpenMinutes(b0, b1, oldPeriodsForDate(dateStr));
    const fitsNew = bookingFitsWithinOpenMinutes(b0, b1, newPeriodsForDate(dateStr));
    if (fitsOld && !fitsNew) {
      const name = [r.guest_first_name, r.guest_last_name]
        .map((x) => (typeof x === 'string' ? x.trim() : ''))
        .filter(Boolean)
        .join(' ');
      orphans.push({
        bookingId: String(r.id),
        bookingDate: dateStr,
        bookingTime: bookingTime.slice(0, 5),
        label: formatOrphanLabel(dateStr, bookingTime.slice(0, 5), name),
      });
    }
  }

  orphans.sort((a, b) =>
    a.bookingDate === b.bookingDate
      ? a.bookingTime.localeCompare(b.bookingTime)
      : a.bookingDate.localeCompare(b.bookingDate),
  );

  return { total: orphans.length, sample: orphans.slice(0, SAMPLE_LIMIT) };
}

/** Non-blocking warning text listing the orphaned bookings, for the "Save anyway?" prompt. */
export function describeHoursChangeOrphans(
  result: HoursChangeOrphanResult,
  opts: { scope: 'venue' | 'calendar'; calendarName?: string | null },
): string {
  const subject =
    opts.scope === 'calendar'
      ? `${opts.calendarName?.trim() || 'this calendar'}’s new hours`
      : 'your new opening hours';
  const head =
    result.total === 1
      ? `This change leaves 1 upcoming booking outside ${subject}:`
      : `This change leaves ${result.total} upcoming bookings outside ${subject}:`;
  const lines = result.sample.map((b) => `  • ${b.label}`);
  if (result.total > result.sample.length) {
    lines.push(`  • …and ${result.total - result.sample.length} more`);
  }
  const tail =
    'These bookings will be kept and you can still serve them, but no new bookings will be taken outside the new hours.';
  return `${head}\n${lines.join('\n')}\n\n${tail}`;
}
