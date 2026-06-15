/**
 * Guard: a calendar closure (full-day unavailability / leave, or a partial blocked-time
 * window) must not be inserted over existing active bookings on that calendar column.
 *
 * This is the mirror of `assertExperienceEventWindowFreeOnCalendar`
 * (`src/lib/experience-events/calendar-event-window-conflicts.ts`), which stops an
 * event/class being *scheduled* over a booking. Here we stop the calendar being *closed*
 * over a booking. A booking is "on the column" when its `calendar_id` or `practitioner_id`
 * is the column, or it is for a resource that displays on the column.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { timeToMinutes } from '@/lib/availability';
import { BOOKING_ACTIVE_STATUSES } from '@/lib/table-management/constants';

function hhmmToMinutes(t: string): number {
  const s = String(t).trim();
  return timeToMinutes(s.length >= 5 ? s.slice(0, 5) : s);
}

/** Parse `estimated_end_time` saved as Postgres `time`, ISO local, or ISO with zone. */
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

interface BookingTimeRow {
  booking_time: string;
  booking_end_time?: string | null;
  estimated_end_time?: string | null;
}

/** Best-known wall-clock end of a booking: explicit end, else estimated end, else +60 min. */
function bookingWindowEndMinutes(row: BookingTimeRow): number {
  const start = hhmmToMinutes(row.booking_time);
  if (row.booking_end_time) return hhmmToMinutes(String(row.booking_end_time));
  if (row.estimated_end_time) return estimatedEndMinutesFromDb(String(row.estimated_end_time));
  return start + 60;
}

/**
 * Does a booking conflict with a proposed closure? A full-day closure
 * (`startMinute === null`) conflicts with any booking; a partial closure conflicts when
 * the booking's `[start, end)` overlaps the `[startMinute, endMinute)` window.
 * Pure — exported for unit testing.
 */
export function bookingConflictsWithClosure(
  booking: BookingTimeRow,
  closure: { startMinute: number | null; endMinute: number | null },
): boolean {
  if (closure.startMinute === null || closure.endMinute === null) return true;
  const b0 = hhmmToMinutes(booking.booking_time);
  const b1 = bookingWindowEndMinutes(booking);
  return b0 < closure.endMinute && closure.startMinute < b1;
}

export interface ClosureBookingConflict {
  /** Calendar column the conflicting booking sits on. */
  calendarColumnId: string;
  /** Date of the earliest conflicting booking (YYYY-MM-DD). */
  bookingDate: string;
  /** Start time of the earliest conflicting booking (HH:mm). */
  bookingTime: string;
  /** Total conflicting bookings across every column/date checked. */
  totalConflicts: number;
}

/**
 * Earliest active booking that a proposed closure would sit on top of, or null when the
 * closure can be inserted freely. `startTime`/`endTime` omitted (or null) = a full-day
 * closure; otherwise the `[startTime, endTime)` window applies to every date in the range.
 *
 * Throws if the bookings lookup fails, so callers fail closed (never silently allow a
 * closure over bookings).
 */
export async function findClosureBookingConflicts(
  admin: SupabaseClient,
  params: {
    venueId: string;
    calendarColumnIds: string[];
    startDate: string;
    endDate: string;
    startTime?: string | null;
    endTime?: string | null;
  },
): Promise<ClosureBookingConflict | null> {
  const { venueId, calendarColumnIds, startDate, endDate, startTime, endTime } = params;
  const columnSet = new Set(calendarColumnIds.filter(Boolean));
  if (columnSet.size === 0) return null;

  const isPartial = Boolean(startTime && endTime);
  const closure = isPartial
    ? { startMinute: hhmmToMinutes(startTime!), endMinute: hhmmToMinutes(endTime!) }
    : { startMinute: null, endMinute: null };

  // Resource rows that render on any of these columns occupy them too.
  const { data: resourceRows } = await admin
    .from('unified_calendars')
    .select('id, display_on_calendar_id')
    .eq('venue_id', venueId)
    .eq('calendar_type', 'resource')
    .in('display_on_calendar_id', [...columnSet]);
  const resourceHostByResourceId = new Map<string, string>();
  for (const r of resourceRows ?? []) {
    const row = r as { id: string; display_on_calendar_id: string };
    resourceHostByResourceId.set(row.id, row.display_on_calendar_id);
  }

  const { data: bookings, error } = await admin
    .from('bookings')
    .select(
      'id, booking_date, booking_time, booking_end_time, estimated_end_time, status, calendar_id, practitioner_id, resource_id',
    )
    .eq('venue_id', venueId)
    .gte('booking_date', startDate)
    .lte('booking_date', endDate)
    .in('status', [...BOOKING_ACTIVE_STATUSES]);

  if (error) {
    throw new Error(`Could not verify existing bookings: ${error.message}`);
  }

  const conflicts: Array<{ calendarColumnId: string; bookingDate: string; bookingTime: string }> = [];
  for (const raw of bookings ?? []) {
    const r = raw as Record<string, unknown>;
    const bookingTime = typeof r.booking_time === 'string' ? r.booking_time : null;
    if (!bookingTime) continue;

    const calId = typeof r.calendar_id === 'string' ? r.calendar_id : null;
    const pracId = typeof r.practitioner_id === 'string' ? r.practitioner_id : null;
    const resId = typeof r.resource_id === 'string' ? r.resource_id : null;
    const column =
      (calId && columnSet.has(calId) ? calId : null) ??
      (pracId && columnSet.has(pracId) ? pracId : null) ??
      (resId ? resourceHostByResourceId.get(resId) ?? null : null);
    if (!column) continue;

    const conflicts2 = bookingConflictsWithClosure(
      {
        booking_time: bookingTime,
        booking_end_time: r.booking_end_time as string | null | undefined,
        estimated_end_time: r.estimated_end_time as string | null | undefined,
      },
      closure,
    );
    if (!conflicts2) continue;

    conflicts.push({
      calendarColumnId: column,
      bookingDate: String(r.booking_date),
      bookingTime: bookingTime.slice(0, 5),
    });
  }

  if (conflicts.length === 0) return null;
  conflicts.sort((a, b) =>
    a.bookingDate === b.bookingDate
      ? a.bookingTime.localeCompare(b.bookingTime)
      : a.bookingDate.localeCompare(b.bookingDate),
  );
  const first = conflicts[0]!;
  return { ...first, totalConflicts: conflicts.length };
}

/** Human-facing 409 message explaining why a closure cannot be inserted. */
export function describeClosureBookingConflict(
  conflict: ClosureBookingConflict,
  opts: { scope: 'time' | 'day'; calendarName?: string | null },
): string {
  const { totalConflicts: n, bookingTime, bookingDate } = conflict;
  const who = opts.calendarName?.trim() ? opts.calendarName.trim() : 'This calendar';
  const countPhrase = n === 1 ? 'a booking' : `${n} bookings`;
  const them = n === 1 ? 'it' : 'them';
  if (opts.scope === 'time') {
    return `${who} already has ${countPhrase} in that time on ${bookingDate} (the earliest starts at ${bookingTime}). Move or cancel ${them} before blocking this time.`;
  }
  return `${who} already has ${countPhrase} on ${bookingDate} (the earliest starts at ${bookingTime}). Move or cancel ${them} before marking the calendar unavailable.`;
}
