/**
 * Generate an .ics file content for a booking (Add to Calendar).
 * Format: one VEVENT with start/end (1.5h default duration), summary, location optional.
 */
export function buildIcsContent(params: {
  venueName: string;
  venueAddress?: string | null;
  bookingDate: string;
  bookingTime: string;
  partySize: number;
}): string {
  const { venueName, venueAddress, bookingDate, bookingTime, partySize } = params;
  const [y, m, d] = bookingDate.split('-').map(Number);
  const [hh, mm] = bookingTime.slice(0, 5).split(':').map(Number);
  const start = new Date(Date.UTC(y!, m! - 1, d!, hh ?? 0, mm ?? 0, 0));
  const end = new Date(start.getTime() + 90 * 60 * 1000);

  const formatUtc = (date: Date) =>
    date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ReserveNI//Booking//EN',
    'BEGIN:VEVENT',
    `DTSTART:${formatUtc(start)}`,
    `DTEND:${formatUtc(end)}`,
    `SUMMARY:Reservation at ${escapeIcs(venueName)}`,
    ...(venueAddress ? [`LOCATION:${escapeIcs(venueAddress)}`] : []),
    `DESCRIPTION:Party of ${partySize}. Booked via ReserveNI.`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
