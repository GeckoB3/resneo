import { venueLocalWallTimeToUtcMs } from '@/lib/venue/venue-local-clock';
import { calendarEventDurationMinutes } from '@/lib/emails/calendar-links';
import { resolveDisplayTimeZone } from '@/lib/time/iana-time-zone';

/**
 * Generate an .ics file content for a booking (Add to Calendar).
 * Format: one VEVENT with start/end, summary, location optional.
 *
 * **`timeZone` is REQUIRED, and it was not always.** A booking's date and time
 * are the venue's wall clock. This treated them as UTC, so an appointment at
 * 14:00 in London landed in the guest's calendar at 15:00 through British
 * Summer Time, every year, for every booking made through the confirmation
 * step. `buildGoogleCalendarAddUrlForBooking` resolved the zone correctly all
 * along, so ResNeo's two "add to calendar" affordances disagreed with each
 * other about the same booking.
 *
 * P2-4 added the parameter as optional so the booking detail page could be
 * right without changing the confirmation step in the same commit. It is
 * mandatory now that both callers pass one: an optional correctness argument
 * is a default waiting to be taken again.
 *
 * The LENGTH is shared with the Google link through
 * `calendarEventDurationMinutes` for the same reason. This used a flat 90
 * minutes while that used a per-model rule, so an appointment was an hour in
 * one calendar and ninety minutes in the other.
 */
export function buildIcsContent(params: {
  venueName: string;
  venueAddress?: string | null;
  bookingDate: string;
  bookingTime: string;
  partySize: number;
  /** IANA zone the wall-clock date and time are expressed in. */
  timeZone: string;
  /** The real length when it is known; null falls back to the model default. */
  durationMinutes?: number | null;
  /** Used only to pick that fallback, so both affordances pick the same one. */
  bookingModel?: string | null;
}): string {
  const { venueName, venueAddress, bookingDate, bookingTime, partySize } = params;
  /*
    Resolved, not used raw. `venueLocalWallTimeToUtcMs` builds an
    `Intl.DateTimeFormat` for the zone, which throws `RangeError` on anything
    that is not an IANA identifier, and `venues.timezone` is a free-text column
    a venue can type into (G23 records four portal routes that crashed on
    exactly this). Making the zone required must not turn a wrong time into a
    button that throws when a guest clicks it, so a bad stored value costs the
    right zone and nothing else, the same rule the rest of the codebase applies.
  */
  const zone = resolveDisplayTimeZone(params.timeZone);
  const startMs = venueLocalWallTimeToUtcMs(bookingDate, `${bookingTime.slice(0, 5)}:00`, zone);
  const start = new Date(startMs);
  const minutes = calendarEventDurationMinutes({
    durationMinutes: params.durationMinutes,
    bookingModel: params.bookingModel,
  });
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
