/**
 * Staff-leave guard for placing an experience event on a calendar column.
 *
 * §1.2 item 24 of the resolver plan. Class creation has always refused a session that lands
 * on a staff member's leave (`class-schedule-availability-conflicts.ts` step 2); event
 * creation never checked at all, so the same venue answered the same question two different
 * ways depending on which thing was being scheduled.
 *
 * v3.0 of the plan predicted Stage 5 would close this as a side effect of making leave a
 * calendar closure. It did not, and could not: Stage 5 deliberately kept leave OUTSIDE the
 * calendar-hours module, because folding it in would have made it `hard` and stopped staff
 * booking a walk-in on a day off. Leave is checked separately, above the hours gate, which
 * is exactly what this module does for events.
 *
 * WHY THIS IS NOT IN `event-hours-vs-venue-calendar.ts`: that module answers "is this window
 * inside the working hours, outside the breaks", all of which staff may deliberately
 * override. Leave is `hard` and nothing skips it. Keeping the two apart is what stops a
 * later refactor quietly turning leave into something skippable.
 *
 * Fail-open on a read error, matching the class path exactly. That is the SA-C3 posture the
 * whole codebase currently takes, and changing it for one write path would make events and
 * classes disagree again in a new way. The failure is reported rather than swallowed.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { formatScheduleDate } from '@/lib/calendar/class-schedule-availability-conflicts';
import { reportAvailabilityReadFailure } from '@/lib/availability/availability-read-failure';

export interface LeaveWindow {
  unavailable_start_time: string | null;
  unavailable_end_time: string | null;
}

function toMinutes(value: string): number {
  const [h, m] = String(value).slice(0, 5).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function hhmm(value: string): string {
  return String(value).slice(0, 5);
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Refusal message when leave covers the window, or null when it is clear.
 *
 * Pure, so the message wording and the overlap arithmetic are testable without a database.
 * Mirrors `evaluateClassWindowAvailabilityConflict` step 2 deliberately, including its
 * treatment of a null time pair as a whole-day closure.
 */
export function evaluateEventLeaveConflict(params: {
  date: string;
  startHHmm: string;
  endHHmm: string;
  calendarName: string | null;
  leavePeriods: readonly LeaveWindow[];
}): string | null {
  const { date, startHHmm, endHHmm, calendarName, leavePeriods } = params;
  const who = calendarName?.trim() ? calendarName.trim() : 'This calendar';
  const dateLabel = formatScheduleDate(date);
  const startMin = toMinutes(startHHmm);
  const endMin = toMinutes(endHHmm);

  for (const leave of leavePeriods) {
    const st = leave.unavailable_start_time;
    const en = leave.unavailable_end_time;

    if (st == null && en == null) {
      return `${who} is on leave (marked unavailable all day) on ${dateLabel}. Choose another day or remove the leave.`;
    }
    if (st != null && en != null) {
      const ls = toMinutes(st);
      const le = toMinutes(en);
      if (le > ls && overlaps(startMin, endMin, ls, le)) {
        return `${who} is on leave from ${hhmm(st)} to ${hhmm(en)} on ${dateLabel}, which clashes with this event time.`;
      }
    }
  }

  return null;
}

/** Loads leave overlapping `date` for one calendar and evaluates it. Null when clear. */
export async function findEventLeaveConflict(
  admin: SupabaseClient,
  params: {
    venueId: string;
    calendarId: string;
    date: string;
    startHHmm: string;
    endHHmm: string;
    calendarName: string | null;
  },
): Promise<string | null> {
  const { venueId, calendarId, date, startHHmm, endHHmm, calendarName } = params;

  const { data, error } = await admin
    .from('practitioner_leave_periods')
    .select('unavailable_start_time, unavailable_end_time')
    .eq('venue_id', venueId)
    .eq('practitioner_id', calendarId)
    .lte('start_date', date)
    .gte('end_date', date);

  if (error) {
    reportAvailabilityReadFailure(
      {
        source: 'findEventLeaveConflict',
        table: 'practitioner_leave_periods',
        assumed: 'nobody is on leave, so this event placement is allowed',
        venueId,
        calendarId,
        date,
      },
      error,
    );
  }

  return evaluateEventLeaveConflict({
    date,
    startHHmm,
    endHHmm,
    calendarName,
    leavePeriods: (data ?? []) as LeaveWindow[],
  });
}
