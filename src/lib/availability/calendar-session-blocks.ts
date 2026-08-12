/**
 * Block ranges contributed by already-scheduled classes and experience events
 * on a team calendar column, used to prevent conflicting appointment bookings.
 *
 * Background: `fetchCalendarAppointmentInput` (appointment engine) derives blocked
 * ranges from `calendar_blocks`, `practitioner_calendar_blocks`, sibling resource
 * windows and practitioner leave. Scheduled class sessions (`class_instances`) and
 * scheduled events (`experience_events`) are rendered on the instructor's calendar
 * column via the schedule feed but NEVER written to `calendar_blocks`. Without the
 * helpers in this file, a scheduled class or event with zero ticket sales leaves the
 * underlying appointment time "bookable" - a guest could book a service during an
 * already-scheduled class/event.
 *
 * The reverse direction (preventing an event/class being scheduled over an existing
 * appointment) is handled by `assertExperienceEventWindowFreeOnCalendar`
 * in `src/lib/experience-events/calendar-event-window-conflicts.ts`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { timeToMinutes } from '@/lib/availability';
import type { ModelOwnedBlockSources } from '@/lib/availability/blocked-range-models';
import { resolveInstructorCalendarIdForClass } from '@/lib/class-instances/instructor-calendar-block';

export interface CalendarSessionBlockRange {
  start: number;
  end: number;
}

function hhmmToMinutes(t: string): number {
  const s = String(t).trim();
  return timeToMinutes(s.length >= 5 ? s.slice(0, 5) : s);
}

/**
 * Ranges occupied by active, non-cancelled experience events scheduled on `calendarId`
 * for `date`. Returned in minutes-since-midnight half-open form `[start, end)`.
 */
export async function fetchExperienceEventBlocksForCalendar(
  admin: SupabaseClient,
  venueId: string,
  calendarId: string,
  date: string,
): Promise<CalendarSessionBlockRange[]> {
  const { data, error } = await admin
    .from('experience_events')
    .select('start_time, end_time')
    .eq('venue_id', venueId)
    .eq('calendar_id', calendarId)
    .eq('event_date', date)
    .eq('is_active', true);

  if (error) {
    console.warn('[calendar-session-blocks] experience_events:', error.message);
    return [];
  }
  if (!data?.length) return [];

  const out: CalendarSessionBlockRange[] = [];
  for (const row of data) {
    const r = row as { start_time: string; end_time: string };
    const start = hhmmToMinutes(r.start_time);
    const end = hhmmToMinutes(r.end_time);
    if (end > start) out.push({ start, end });
  }
  return out;
}

/**
 * Ranges occupied by active, non-cancelled class sessions (`class_instances`) whose
 * instructor resolves (directly, via resource host chain, or via legacy practitioner
 * mirror) to `calendarId` for `date`. Class end times are derived from
 * `class_types.duration_minutes` (60 min fallback).
 *
 * Resolver lookups are memoised per unique instructor id within one call.
 */
export async function fetchClassInstanceBlocksForCalendar(
  admin: SupabaseClient,
  venueId: string,
  calendarId: string,
  date: string,
): Promise<CalendarSessionBlockRange[]> {
  const { data: typeRows, error: typeErr } = await admin
    .from('class_types')
    .select('id, duration_minutes, instructor_id')
    .eq('venue_id', venueId)
    .eq('is_active', true);

  if (typeErr) {
    console.warn('[calendar-session-blocks] class_types:', typeErr.message);
    return [];
  }
  if (!typeRows?.length) return [];

  const typeDuration = new Map<string, number>();
  const matchingTypeIds = new Set<string>();
  const resolvedByInstructor = new Map<string, string | null>();

  for (const raw of typeRows) {
    const row = raw as { id: string; duration_minutes: number | null; instructor_id: string | null };
    typeDuration.set(row.id, row.duration_minutes && row.duration_minutes > 0 ? row.duration_minutes : 60);
    const iid = row.instructor_id;
    if (!iid) continue;
    if (iid === calendarId) {
      matchingTypeIds.add(row.id);
      continue;
    }
    if (!resolvedByInstructor.has(iid)) {
      resolvedByInstructor.set(iid, await resolveInstructorCalendarIdForClass(admin, venueId, iid));
    }
    if (resolvedByInstructor.get(iid) === calendarId) {
      matchingTypeIds.add(row.id);
    }
  }

  if (matchingTypeIds.size === 0) return [];

  const { data: instances, error: instErr } = await admin
    .from('class_instances')
    .select('start_time, class_type_id')
    .eq('instance_date', date)
    .eq('is_cancelled', false)
    .in('class_type_id', [...matchingTypeIds]);

  if (instErr) {
    console.warn('[calendar-session-blocks] class_instances:', instErr.message);
    return [];
  }
  if (!instances?.length) return [];

  const out: CalendarSessionBlockRange[] = [];
  for (const raw of instances) {
    const row = raw as { start_time: string; class_type_id: string };
    const start = hhmmToMinutes(row.start_time);
    const duration = typeDuration.get(row.class_type_id) ?? 60;
    out.push({ start, end: start + duration });
  }
  return out;
}

/**
 * Combined block ranges for scheduled events and classes on a calendar column for one date.
 * Feed these into the appointment engine's `practitionerBlockedRanges` (per calendar id)
 * so both availability listing and slot validation reject conflicting appointment times.
 *
 * `sources` decides which of the two still applies. A venue with the class model off but
 * the event model on blocks for its events and not its classes, so the two are gated
 * separately rather than as one "sessions" switch. The parameter is required on purpose:
 * a default would let a new call site quietly reinstate the unconditional blocking this
 * exists to remove.
 */
export async function fetchScheduledSessionBlocksForCalendar(
  admin: SupabaseClient,
  venueId: string,
  calendarId: string,
  date: string,
  sources: Pick<ModelOwnedBlockSources, 'classes' | 'events'>,
): Promise<CalendarSessionBlockRange[]> {
  const [events, classes] = await Promise.all([
    sources.events
      ? fetchExperienceEventBlocksForCalendar(admin, venueId, calendarId, date)
      : Promise.resolve<CalendarSessionBlockRange[]>([]),
    sources.classes
      ? fetchClassInstanceBlocksForCalendar(admin, venueId, calendarId, date)
      : Promise.resolve<CalendarSessionBlockRange[]>([]),
  ]);
  return [...events, ...classes];
}
