import type { SupabaseClient } from '@supabase/supabase-js';
import { BOOKING_ACTIVE_STATUSES } from '@/lib/table-management/constants';
import { normalizeTimeForDb, validateMergedEventTimes } from '@/lib/experience-events/experience-event-validation';
import { buildUpcomingBookingsBlockMessage } from '@/lib/venue/entity-delete-booking-guards';

export { normalizeTimeForDb, validateStartEndTimes } from '@/lib/experience-events/experience-event-validation';

/**
 * Counts bookings that should block hard-deleting an experience event or removing it from the calendar:
 * today-or-later session date and a live booking status (Pending / Booked / Confirmed / Seated).
 */
export async function countBookingsBlockingEventDelete(
  admin: SupabaseClient,
  venueId: string,
  experienceEventId: string,
): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const { count, error } = await admin
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId)
    .eq('experience_event_id', experienceEventId)
    .gte('booking_date', today)
    .in('status', [...BOOKING_ACTIVE_STATUSES]);

  if (error) {
    console.error('[countBookingsBlockingEventDelete]', error);
    return -1;
  }
  return count ?? 0;
}

export async function assertExperienceEventDeletable(
  admin: SupabaseClient,
  venueId: string,
  experienceEventId: string,
): Promise<{ ok: true } | { ok: false; error: string; booking_count: number }> {
  const n = await countBookingsBlockingEventDelete(admin, venueId, experienceEventId);
  if (n < 0) {
    return { ok: false, error: 'Could not verify bookings for this event', booking_count: 0 };
  }
  if (n > 0) {
    return {
      ok: false,
      error: buildUpcomingBookingsBlockMessage('event', n),
      booking_count: n,
    };
  }
  return { ok: true };
}

/**
 * Clearing `calendar_id` (removing the event from the staff grid column) is blocked while upcoming active bookings exist.
 */
export async function assertExperienceEventCalendarClearable(
  admin: SupabaseClient,
  venueId: string,
  experienceEventId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const n = await countBookingsBlockingEventDelete(admin, venueId, experienceEventId);
  if (n < 0) {
    return { ok: false, error: 'Could not verify bookings for this event.' };
  }
  if (n > 0) {
    const noun = n === 1 ? 'upcoming active booking' : 'upcoming active bookings';
    return {
      ok: false,
      error: `Can't remove this event from the calendar: there ${n === 1 ? 'is' : 'are'} ${n} ${noun} linked to it. Cancel or resolve ${n === 1 ? 'it' : 'them'} first, then try again.`,
    };
  }
  return { ok: true };
}

export interface ExperienceEventPatchInput {
  name?: string;
  description?: string | null;
  event_date?: string;
  start_time?: string;
  end_time?: string;
  capacity?: number;
  image_url?: string | null;
  is_recurring?: boolean;
  recurrence_rule?: string | null;
  parent_event_id?: string | null;
  is_active?: boolean;
  /** Unified calendar column; null clears assignment. */
  calendar_id?: string | null;
  max_advance_booking_days?: number;
  min_booking_notice_hours?: number;
  cancellation_notice_hours?: number;
  allow_same_day_booking?: boolean;
}

/**
 * Validates merged times when either time changes; normalises start/end to `HH:MM`+`:00` for Postgres.
 */
export async function resolveExperienceEventPatch(
  admin: SupabaseClient,
  venueId: string,
  eventId: string,
  patch: ExperienceEventPatchInput,
): Promise<
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string }
> {
  const hasStart = patch.start_time !== undefined;
  const hasEnd = patch.end_time !== undefined;

  let existingStart: string | null | undefined;
  let existingEnd: string | null | undefined;

  if (hasStart || hasEnd) {
    if (hasStart !== hasEnd) {
      const { data: row, error } = await admin
        .from('experience_events')
        .select('start_time,end_time')
        .eq('id', eventId)
        .eq('venue_id', venueId)
        .maybeSingle();

      if (error || !row) {
        return { ok: false, error: 'Event not found' };
      }
      existingStart = (row as { start_time?: string }).start_time ?? null;
      existingEnd = (row as { end_time?: string }).end_time ?? null;
    }

    const timeErr = validateMergedEventTimes(existingStart, existingEnd, {
      start_time: patch.start_time,
      end_time: patch.end_time,
    });
    if (timeErr) return { ok: false, error: timeErr };
  }

  // EV-9+ / EV-1: both PATCH schemas accept an arbitrary `parent_event_id` uuid
  // and this resolver used to pass it straight through to the UPDATE. Nothing
  // checked that the target belonged to the same venue, so one venue could
  // re-point its event at another venue's, silently coupling the two series in
  // the catalogue (which groups on `parent_event_id ?? id`) and, before
  // 20270117120000 made the FK SET NULL, putting the delete cascade across a
  // venue boundary. Both PATCH routes funnel through here, so scoping it once
  // covers the collection and `[id]` handlers.
  if (typeof patch.parent_event_id === 'string') {
    if (patch.parent_event_id === eventId) {
      return { ok: false, error: 'An event cannot be its own series parent.' };
    }
    const { data: parentRow, error: parentErr } = await admin
      .from('experience_events')
      .select('id')
      .eq('id', patch.parent_event_id)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (parentErr) {
      console.error('[resolveExperienceEventPatch] parent lookup failed:', parentErr, {
        eventId,
        parentEventId: patch.parent_event_id,
      });
      return { ok: false, error: 'Could not verify the series this event belongs to.' };
    }
    if (!parentRow) {
      return { ok: false, error: 'That series does not belong to this venue.' };
    }
  }

  const payload: Record<string, unknown> = { ...patch };
  if (payload.start_time !== undefined) {
    payload.start_time = normalizeTimeForDb(String(payload.start_time));
  }
  if (payload.end_time !== undefined) {
    payload.end_time = normalizeTimeForDb(String(payload.end_time));
  }

  return { ok: true, payload };
}
