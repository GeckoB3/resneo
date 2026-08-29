import { venueLocalWallTimeToUtcMs } from '@/lib/venue/venue-local-clock';

/**
 * Generate an .ics file content for a booking (Add to Calendar).
 * Format: one VEVENT with start/end, summary, location optional.
 *
 * **`timeZone` matters and its absence is a real defect.** Without it the
 * booking's wall-clock time is treated as UTC, so an appointment at 14:00 in
 * London lands in the guest's calendar at 15:00 during British Summer Time.
 * `buildGoogleCalendarAddUrlForBooking` has always resolved the venue zone
 * properly (`calendar-links.ts:90`), so the two "add to calendar" affordances
 * disagreed. New callers pass the zone; the parameter is optional only so the
 * existing confirmation-step caller keeps its current behaviour until it is
 * given one.
 */
export function buildIcsContent(params: {
  venueName: string;
  venueAddress?: string | null;
  bookingDate: string;
  bookingTime: string;
  partySize: number;
  /** IANA zone the wall-clock date and time are expressed in. */
  timeZone?: string | null;
  /** Real length when it is known; 90 minutes is only a fallback. */
  durationMinutes?: number | null;
}): string {
  const { venueName, venueAddress, bookingDate, bookingTime, partySize } = params;
  const [y, m, d] = bookingDate.split('-').map(Number);
  const [hh, mm] = bookingTime.slice(0, 5).split(':').map(Number);
  const startMs = params.timeZone
    ? venueLocalWallTimeToUtcMs(bookingDate, `${bookingTime.slice(0, 5)}:00`, params.timeZone)
    : Date.UTC(y!, m! - 1, d!, hh ?? 0, mm ?? 0, 0);
  const start = new Date(startMs);
  const minutes =
    typeof params.durationMinutes === 'number' && params.durationMinutes > 0
      ? params.durationMinutes
      : 90;
  const end = new Date(start.getTime() + minutes * 60 * 1000);

  const formatUtc = (date: Date) =>
    date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ResNeo//Booking//EN',
    'BEGIN:VEVENT',
    `DTSTART:${formatUtc(start)}`,
    `DTEND:${formatUtc(end)}`,
    `SUMMARY:Reservation at ${escapeIcs(venueName)}`,
    ...(venueAddress ? [`LOCATION:${escapeIcs(venueAddress)}`] : []),
    `DESCRIPTION:Party of ${partySize}. Booked via ResNeo.`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
