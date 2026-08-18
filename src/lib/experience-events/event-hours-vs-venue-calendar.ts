/**
 * Validates that an experience event's [start, end) lies within venue opening hours (when configured)
 * and the assigned team calendar's working hours, excluding breaks.
 */

import type { AvailabilityBlock, OpeningHours } from '@/types/availability';
import type { VenueOpeningException } from '@/types/venue-opening-exceptions';
import { getOpeningPeriodsForDay, getDayOfWeek, timeToMinutes } from '@/lib/availability';
import { unifiedCalendarRowToPractitioner } from '@/lib/availability/unified-calendar-mapper';
import {
  resolveVenueWideAllowedMinuteRanges,
  venueWideResolutionToNullableRanges,
} from '@/lib/availability/venue-wide-business-hours';
import {
  calendarBookableSegments,
  type CalendarScheduleRow,
} from '@/lib/availability/calendar-hours';



function isVenueOpeningHoursConfigured(openingHours: OpeningHours | null | undefined): boolean {
  return openingHours != null && typeof openingHours === 'object' && Object.keys(openingHours).length > 0;
}

function findApplicableVenueOpeningException(
  exceptions: VenueOpeningException[] | null | undefined,
  dateStr: string,
): VenueOpeningException | null {
  if (!exceptions?.length) return null;
  for (const ex of exceptions) {
    if (ex.date_start <= dateStr && dateStr <= ex.date_end) return ex;
  }
  return null;
}

/** Venue open minute ranges for this date (exceptions override weekly hours). */
function venueMinuteRangesForDate(
  venueOpeningHours: OpeningHours | null | undefined,
  dateStr: string,
  exceptions: VenueOpeningException[] | null | undefined,
): Array<{ start: number; end: number }> | null {
  const ex = findApplicableVenueOpeningException(exceptions, dateStr);
  if (ex) {
    if (ex.closed) return [];
    if (ex.periods?.length) {
      return ex.periods.map((p) => ({
        start: timeToMinutes(p.open.slice(0, 5)),
        end: timeToMinutes(p.close.slice(0, 5)),
      }));
    }
  }
  if (isVenueOpeningHoursConfigured(venueOpeningHours)) {
    const day = getDayOfWeek(dateStr);
    const periods = getOpeningPeriodsForDay(venueOpeningHours, day);
    return periods.map((p) => ({ start: timeToMinutes(p.open), end: timeToMinutes(p.close) }));
  }
  return null;
}



function intersectMinuteRanges(
  a: Array<{ start: number; end: number }>,
  b: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (const ra of a) {
    for (const rb of b) {
      const s = Math.max(ra.start, rb.start);
      const e = Math.min(ra.end, rb.end);
      if (s < e) out.push({ start: s, end: e });
    }
  }
  return out.sort((x, y) => x.start - y.start);
}

/**
 * Calendar bookable segments (working hours minus breaks) for this date.
 */
export function calendarSegmentsForDate(ucRow: Record<string, unknown>, dateStr: string): Array<{ start: number; end: number }> {
  /**
   * `calendarBookableSegments`, NOT `calendarHours`.
   *
   * This is a CONTAINMENT question -- does the event window fit inside a working period
   * that is not a break? -- and the break subtraction IS the enforcement behind decision
   * (D)'s "it cannot overlap a break" error. Repointing this at `calendarHours` would drop
   * that clause silently and make the decision half vacuous, which is the trap the plan
   * flags at §2.4.
   *
   * Containment is also the one case where subtracting and vetoing are equivalent, so
   * using the split set here is safe. Slot generation must not: see §2.7.
   */
  const p = unifiedCalendarRowToPractitioner(ucRow);
  return calendarBookableSegments(p as CalendarScheduleRow, dateStr);
}

export type VenueHoursInput = {
  opening_hours: OpeningHours | null | undefined;
  venue_opening_exceptions: VenueOpeningException[] | null | undefined;
  /**
   * When defined (including []), venue-wide `availability_blocks` drive closures/amended hours.
   * When undefined, legacy `venue_opening_exceptions` JSONB is used.
   */
  availability_blocks?: AvailabilityBlock[] | null;
};

/**
 * Returns null if the event window is valid; otherwise a user-facing error message.
 * When venue has no opening-hours config and no applicable exception, only the calendar column is enforced.
 */
export function validateExperienceEventWindowAgainstVenueAndCalendar(
  eventDate: string,
  startTimeHhMm: string,
  endTimeHhMm: string,
  venue: VenueHoursInput,
  unifiedCalendarRow: Record<string, unknown>,
): string | null {
  const start = timeToMinutes(startTimeHhMm.slice(0, 5));
  const end = timeToMinutes(endTimeHhMm.slice(0, 5));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 'End time must be after start time.';
  }

  const calSegments = calendarSegmentsForDate(unifiedCalendarRow, eventDate);
  if (calSegments.length === 0) {
    return 'This calendar has no working hours on that date (or the team is marked off). Choose another date or time.';
  }

  const venueRanges =
    venue.availability_blocks !== undefined
      ? venueWideResolutionToNullableRanges(
          resolveVenueWideAllowedMinuteRanges(
            venue.opening_hours,
            eventDate,
            venue.availability_blocks ?? [],
          ),
        )
      : venueMinuteRangesForDate(venue.opening_hours, eventDate, venue.venue_opening_exceptions ?? null);

  let allowed: Array<{ start: number; end: number }>;
  if (venueRanges === null) {
    allowed = calSegments;
  } else if (venueRanges.length === 0) {
    return 'The venue is closed on this date. Choose another date or time.';
  } else {
    allowed = intersectMinuteRanges(calSegments, venueRanges);
  }

  if (allowed.length === 0) {
    return 'Event time is outside venue opening hours or this calendar’s working hours on that date.';
  }

  const fits = allowed.some((seg) => start >= seg.start && end <= seg.end);
  if (!fits) {
    return 'Event time must fall fully within venue opening hours and this calendar’s working hours (it cannot overlap a break).';
  }

  return null;
}
