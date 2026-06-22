/**
 * Shared calendar-window + venue-hours re-validation for an experience event's
 * placement on a unified-calendar column.
 *
 * The collection PATCH (`/api/venue/experience-events`) performed this check
 * inline while the `[id]` PATCH skipped it entirely, so an admin editing via the
 * `[id]` path could move/resize an event into a venue-closed window or on top of
 * another event on the same calendar (see the CDE review, finding under §5.3:
 * "the `[id]` path skips calendar-window/hours re-validation"). Both PATCH paths
 * now call this single helper.
 *
 * Returns a structured result so each route can map to the right HTTP status
 * (400 for hours violations, 409 for an overlap conflict).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OpeningHours } from '@/types/availability';
import { parseVenueOpeningExceptions } from '@/types/venue-opening-exceptions';
import { rowsToVenueWideBlocks, venueWideBlocksQueryForDate } from '@/lib/availability/venue-wide-blocks-fetch';
import { assertExperienceEventWindowFreeOnCalendar } from '@/lib/experience-events/calendar-event-window-conflicts';
import { validateExperienceEventWindowAgainstVenueAndCalendar } from '@/lib/experience-events/event-hours-vs-venue-calendar';

function timeHhMm(t: string): string {
  const s = String(t).trim();
  return s.length >= 5 ? s.slice(0, 5) : s;
}

export type EventCalendarPlacementResult =
  | { ok: true }
  | { ok: false; error: string; status: 400 | 409 };

/**
 * Validate a single event occurrence against venue opening hours + the calendar
 * column's working hours, then against existing events on that calendar.
 *
 * @param excludeExperienceEventId omit the event itself from the overlap check (edits).
 */
export async function validateEventCalendarPlacement(
  admin: SupabaseClient,
  params: {
    venueId: string;
    calendarId: string;
    eventDate: string;
    startTime: string;
    endTime: string;
    excludeExperienceEventId?: string;
  },
): Promise<EventCalendarPlacementResult> {
  const { venueId, calendarId, eventDate, startTime, endTime, excludeExperienceEventId } = params;
  const startHm = timeHhMm(startTime);
  const endHm = timeHhMm(endTime);

  const [{ data: venueRow }, { data: blockRows, error: blocksErr }, { data: ucRow, error: ucErr }] =
    await Promise.all([
      admin.from('venues').select('opening_hours, venue_opening_exceptions').eq('id', venueId).single(),
      venueWideBlocksQueryForDate(admin, venueId, eventDate),
      admin
        .from('unified_calendars')
        .select('*')
        .eq('id', calendarId)
        .eq('venue_id', venueId)
        .maybeSingle(),
    ]);

  if (blocksErr) {
    console.warn('[validateEventCalendarPlacement] availability_blocks:', blocksErr.message);
  }
  if (ucErr || !ucRow) {
    return { ok: false, error: 'Calendar column not found for this venue.', status: 400 };
  }

  const hoursErr = validateExperienceEventWindowAgainstVenueAndCalendar(
    eventDate,
    startHm,
    endHm,
    {
      opening_hours: (venueRow?.opening_hours as OpeningHours | null) ?? null,
      venue_opening_exceptions: parseVenueOpeningExceptions(venueRow?.venue_opening_exceptions),
      availability_blocks: rowsToVenueWideBlocks(blockRows),
    },
    ucRow as Record<string, unknown>,
  );
  if (hoursErr) {
    return { ok: false, error: hoursErr, status: 400 };
  }

  const conflict = await assertExperienceEventWindowFreeOnCalendar(
    admin,
    venueId,
    calendarId,
    eventDate,
    startHm,
    endHm,
    excludeExperienceEventId ? { excludeExperienceEventId } : undefined,
  );
  if (conflict) {
    return { ok: false, error: conflict, status: 409 };
  }

  return { ok: true };
}
