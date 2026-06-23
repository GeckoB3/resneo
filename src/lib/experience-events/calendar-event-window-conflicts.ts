/**
 * Ensure an experience event time window does not overlap other bookings on the same calendar column.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { timeToMinutes } from '@/lib/availability';
import {
  classBlockEndTime,
  resolveInstructorCalendarIdForClass,
} from '@/lib/class-instances/instructor-calendar-block';
import { BOOKING_ACTIVE_STATUSES } from '@/lib/table-management/constants';
import {
  findClassScheduleWindowAvailabilityConflict,
  withScheduleDateContext,
} from '@/lib/calendar/class-schedule-availability-conflicts';

function hhmmToMinutes(t: string): number {
  const s = String(t).trim();
  return timeToMinutes(s.length >= 5 ? s.slice(0, 5) : s);
}

function intervalsOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

/** Parse `estimated_end_time` saved as Postgres `time`, ISO local, or ISO with zone. */
export function estimatedEndMinutesFromDb(value: string): number {
  const s = String(value).trim();
  const tIdx = s.indexOf('T');
  if (tIdx !== -1) {
    const afterT = s.slice(tIdx + 1);
    const timePart = afterT.split(/[Z+-]/)[0]?.trim() ?? afterT;
    return hhmmToMinutes(timePart);
  }
  return hhmmToMinutes(s);
}

function bookingWindowEnd(row: {
  booking_time: string;
  booking_end_time?: string | null;
  estimated_end_time?: string | null;
}): number {
  const start = hhmmToMinutes(row.booking_time);
  if (row.booking_end_time) return hhmmToMinutes(String(row.booking_end_time));
  if (row.estimated_end_time) return estimatedEndMinutesFromDb(String(row.estimated_end_time));
  return start + 60;
}

function bookingStatusIsActive(status: string): status is (typeof BOOKING_ACTIVE_STATUSES)[number] {
  const s = status.trim();
  return (BOOKING_ACTIVE_STATUSES as readonly string[]).includes(s);
}

/**
 * Returns an error message if the window conflicts, otherwise null.
 */
export async function assertExperienceEventWindowFreeOnCalendar(
  admin: SupabaseClient,
  venueId: string,
  calendarId: string,
  eventDate: string,
  startTime: string,
  endTime: string,
  options?: { excludeExperienceEventId?: string; excludeClassInstanceIds?: string[] },
): Promise<string | null> {
  const { data: cal, error: calErr } = await admin
    .from('unified_calendars')
    .select('id, calendar_type, venue_id')
    .eq('id', calendarId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (calErr || !cal) {
    return 'Calendar not found.';
  }
  if ((cal as { calendar_type: string }).calendar_type === 'resource') {
    return 'Choose a team calendar column, not a resource row.';
  }

  const w0 = hhmmToMinutes(startTime);
  const w1 = hhmmToMinutes(endTime);
  if (w1 <= w0) {
    return 'End time must be after start time.';
  }

  const excludeEv = options?.excludeExperienceEventId;
  const excludeClassIds = options?.excludeClassInstanceIds?.filter(Boolean) ?? [];

  const { data: otherEvents, error: evErr } = await admin
    .from('experience_events')
    .select('id, start_time, end_time')
    .eq('venue_id', venueId)
    .eq('calendar_id', calendarId)
    .eq('event_date', eventDate)
    .eq('is_active', true);

  if (evErr) {
    console.error('[assertExperienceEventWindowFreeOnCalendar] experience_events', evErr.message);
    return 'Could not verify calendar availability.';
  } else {
    const overlappingEventIds: string[] = [];
    for (const ev of otherEvents ?? []) {
      const row = ev as { id: string; start_time: string; end_time: string };
      if (excludeEv && row.id === excludeEv) continue;
      const e0 = hhmmToMinutes(row.start_time);
      const e1 = hhmmToMinutes(row.end_time);
      if (intervalsOverlap(w0, w1, e0, e1)) overlappingEventIds.push(row.id);
    }

    /**
     * An `experience_events` row still occupies the column when tickets may be sold—
     * but if every linked booking for this date is no longer active (e.g. only Cancelled
     * rows remain), the slot should behave like freed time for scheduling (e.g. a class).
     * When no bookings exist yet, the hosted event continues to reserve the window.
     */
    if (overlappingEventIds.length > 0) {
      const { data: evBookingRows, error: evBkErr } = await admin
        .from('bookings')
        .select('experience_event_id, status')
        .eq('venue_id', venueId)
        .eq('booking_date', eventDate)
        .in('experience_event_id', overlappingEventIds);

      if (evBkErr) {
        console.error('[assertExperienceEventWindowFreeOnCalendar] experience_event bookings', evBkErr.message);
        return 'Could not verify calendar availability.';
      }

      const statsByEventId = new Map<string, { hasAny: boolean; hasActive: boolean }>();
      for (const evId of overlappingEventIds) {
        statsByEventId.set(evId, { hasAny: false, hasActive: false });
      }
      for (const raw of evBookingRows ?? []) {
        const r = raw as { experience_event_id: string | null; status?: string | null };
        const eid = r.experience_event_id;
        if (!eid) continue;
        const agg = statsByEventId.get(eid);
        if (!agg) continue;
        agg.hasAny = true;
        const st = String(r.status ?? '').trim();
        if (bookingStatusIsActive(st)) agg.hasActive = true;
      }

      for (const evId of overlappingEventIds) {
        const agg = statsByEventId.get(evId)!;
        if (!agg.hasAny || agg.hasActive) {
          return 'Another event on this calendar overlaps this time.';
        }
      }
    }
  }

  const { data: blocks, error: blErr } = await admin
    .from('calendar_blocks')
    .select('start_time, end_time')
    .eq('venue_id', venueId)
    .eq('calendar_id', calendarId)
    .eq('block_date', eventDate);

  if (blErr) {
    console.error('[assertExperienceEventWindowFreeOnCalendar] calendar_blocks', blErr.message);
  } else {
    for (const bl of blocks ?? []) {
      const b = bl as { start_time: string; end_time: string };
      const b0 = hhmmToMinutes(b.start_time);
      const b1 = hhmmToMinutes(b.end_time);
      if (intervalsOverlap(w0, w1, b0, b1)) {
        return 'This time overlaps blocked time on this calendar.';
      }
    }
  }

  const { data: resourceRows } = await admin
    .from('unified_calendars')
    .select('id')
    .eq('venue_id', venueId)
    .eq('calendar_type', 'resource')
    .eq('display_on_calendar_id', calendarId);

  const resourceIds = (resourceRows ?? []).map((r: { id: string }) => r.id);

  const { data: bookings, error: bkErr } = await admin
    .from('bookings')
    .select(
      'id, booking_time, booking_end_time, estimated_end_time, status, calendar_id, practitioner_id, resource_id, class_instance_id, experience_event_id',
    )
    .eq('venue_id', venueId)
    .eq('booking_date', eventDate)
    .in('status', [...BOOKING_ACTIVE_STATUSES]);

  if (bkErr) {
    console.error('[assertExperienceEventWindowFreeOnCalendar] bookings', bkErr.message);
    return 'Could not verify calendar availability.';
  }

  for (const raw of bookings ?? []) {
    const r = raw as Record<string, unknown>;
    const status = String(r.status ?? '').trim();
    if (!bookingStatusIsActive(status)) continue;

    const expEvId = r.experience_event_id as string | null | undefined;
    if (excludeEv && typeof expEvId === 'string' && expEvId === excludeEv) continue;

    const classInstId = r.class_instance_id as string | null | undefined;
    if (
      excludeClassIds.length > 0 &&
      typeof classInstId === 'string' &&
      excludeClassIds.includes(classInstId)
    ) {
      continue;
    }

    const onColumn =
      r.calendar_id === calendarId ||
      r.practitioner_id === calendarId ||
      (typeof r.resource_id === 'string' && resourceIds.includes(r.resource_id));

    if (!onColumn) continue;

    const b0 = hhmmToMinutes(String(r.booking_time));
    const b1 = bookingWindowEnd({
      booking_time: String(r.booking_time),
      booking_end_time: r.booking_end_time as string | null | undefined,
      estimated_end_time: r.estimated_end_time as string | null | undefined,
    });

    if (intervalsOverlap(w0, w1, b0, b1)) {
      if (r.class_instance_id) {
        return 'This time overlaps a class session on this calendar.';
      }
      if (r.experience_event_id) {
        return 'This time overlaps an event booking on this calendar.';
      }
      if (r.resource_id) {
        return 'This time overlaps a resource booking on this calendar.';
      }
      return 'This time overlaps an existing appointment on this calendar.';
    }
  }

  const { data: venueTypeRows } = await admin.from('class_types').select('id').eq('venue_id', venueId).eq('is_active', true);
  const venueTypeIds = (venueTypeRows ?? []).map((r: { id: string }) => r.id);
  if (venueTypeIds.length > 0) {
    const { data: ciRows, error: ciErr } = await admin
      .from('class_instances')
      .select('id, start_time, class_type_id')
      .eq('instance_date', eventDate)
      .eq('is_cancelled', false)
      .in('class_type_id', venueTypeIds);

    if (ciErr) {
      console.error('[assertExperienceEventWindowFreeOnCalendar] class_instances', ciErr.message);
    } else {
      const needCt = [...new Set((ciRows ?? []).map((r: { class_type_id: string }) => r.class_type_id))];
      const typeMeta = new Map<string, { duration_minutes: number; instructor_id: string | null }>();
      if (needCt.length > 0) {
        const { data: types } = await admin
          .from('class_types')
          .select('id, duration_minutes, instructor_id')
          .in('id', needCt)
          .eq('venue_id', venueId);
        for (const t of types ?? []) {
          const row = t as { id: string; duration_minutes: number; instructor_id: string | null };
          typeMeta.set(row.id, { duration_minutes: row.duration_minutes, instructor_id: row.instructor_id });
        }
      }
      for (const raw of ciRows ?? []) {
        const row = raw as { id: string; start_time: string; class_type_id: string };
        if (excludeClassIds.includes(row.id)) continue;
        const meta = typeMeta.get(row.class_type_id);
        if (!meta) continue;
        const calForClass = await resolveInstructorCalendarIdForClass(admin, venueId, meta.instructor_id);
        if (calForClass !== calendarId) continue;
        const c0 = hhmmToMinutes(row.start_time);
        const c1 = c0 + (meta.duration_minutes > 0 ? meta.duration_minutes : 60);
        if (intervalsOverlap(w0, w1, c0, c1)) {
          return 'This time overlaps a class session on this calendar.';
        }
      }
    }
  }

  return null;
}

/**
 * Ensures a class session window does not overlap other uses of the same team calendar column
 * (events, blocks, bookings, other class sessions). Excludes one instance when re-validating
 * that session’s own time (e.g. instructor or duration change).
 */
export async function assertClassSessionWindowFreeOnCalendar(
  admin: SupabaseClient,
  venueId: string,
  params: {
    instructorId: string | null;
    durationMinutes: number;
    instanceDate: string;
    startTime: string;
    excludeClassInstanceId?: string;
  },
): Promise<string | null> {
  const { instructorId, durationMinutes, instanceDate, startTime, excludeClassInstanceId } = params;
  const calendarId = await resolveInstructorCalendarIdForClass(admin, venueId, instructorId);
  if (!calendarId) {
    return 'This class is not linked to a calendar column. Edit the class and choose which column it appears on, then try again.';
  }

  const startNorm = String(startTime).trim();
  const startHhmm = startNorm.length >= 5 ? startNorm.slice(0, 5) : startNorm;
  const dur = durationMinutes > 0 ? durationMinutes : 60;
  const endHhmm = classBlockEndTime(startHhmm, dur).slice(0, 5);

  // Closures (business + calendar), staff leave, days-off and breaks — sources the
  // overlap check below does not cover. A class must never sit on top of any of these.
  const availabilityConflict = await findClassScheduleWindowAvailabilityConflict(admin, {
    venueId,
    calendarId,
    date: instanceDate,
    startHHmm: startHhmm,
    endHHmm: endHhmm,
  });
  if (availabilityConflict) return availabilityConflict;

  // Existing bookings, events, other class sessions and unified calendar blocks.
  const overlapConflict = await assertExperienceEventWindowFreeOnCalendar(
    admin,
    venueId,
    calendarId,
    instanceDate,
    startHhmm,
    endHhmm,
    excludeClassInstanceId
      ? { excludeClassInstanceIds: [excludeClassInstanceId] }
      : undefined,
  );
  if (!overlapConflict) return null;
  // Stamp the offending date/time so bulk scheduling errors name the clashing session.
  return withScheduleDateContext(overlapConflict, instanceDate, startHhmm);
}
