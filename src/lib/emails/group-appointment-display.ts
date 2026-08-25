import type { BookingEmailData, GroupAppointmentLine } from './types';

/**
 * How to present a booking that has several `group_appointments` lines.
 *
 * The same array carries two different things, told apart by `person_label`:
 *
 *   * a PARTY   — distinct people sharing one booking, each line labelled with a name
 *   * a VISIT   — one guest's several services, no label on any line
 *
 * This mirrors `isServiceVisit` in `lib/booking/appointment-visit`, which is the
 * convention the booking side already uses. Emails need it because a visit must not be
 * labelled per line: the guest is already named in the greeting, so a per-line name is
 * either wrong or invented.
 */

/** True when these lines are one guest's several services rather than a party. */
export function isVisitLines(lines: readonly GroupAppointmentLine[]): boolean {
  return lines.length > 0 && !lines.some((l) => l.person_label?.trim());
}

/** True when every line falls on the same calendar day, so the day needs saying once. */
export function linesShareOneDay(lines: readonly GroupAppointmentLine[]): boolean {
  if (lines.length === 0) return false;
  return new Set(lines.map((l) => l.booking_date)).size === 1;
}

/**
 * When the booking starts, for the hero date/time and the text Date/Time lines.
 *
 * A multi-line booking is anchored on whichever row the email was sent for, which for a
 * reminder is whichever service triggered it. Showing that row's time told a guest with a
 * 9:00am visit that their appointment was at 11:30am, so the earliest line wins.
 */
export function bookingDisplayStart(booking: BookingEmailData): { date: string; time: string } {
  const own = { date: booking.booking_date, time: booking.booking_time };
  const lines = booking.group_appointments;
  if (!lines || lines.length === 0) return own;
  let earliest: GroupAppointmentLine | null = null;
  for (const line of lines) {
    if (!line.booking_date || !line.booking_time) continue;
    if (
      earliest === null ||
      `${line.booking_date}T${line.booking_time}` < `${earliest.booking_date}T${earliest.booking_time}`
    ) {
      earliest = line;
    }
  }
  return earliest ? { date: earliest.booking_date, time: earliest.booking_time } : own;
}

/**
 * Plain-text lines for a multi-line booking, so the text part lists every service the
 * HTML part shows. Without this a two-service reminder named only the service whose row
 * happened to trigger it, and the other one was missing entirely.
 */
export function groupAppointmentTextLines(
  lines: readonly GroupAppointmentLine[],
  formatTime: (time: string) => string,
  formatDate: (date: string) => string,
): string[] {
  if (lines.length === 0) return [];
  const visit = isVisitLines(lines);
  const oneDay = linesShareOneDay(lines);
  const out: string[] = ['Services:'];
  for (const line of lines) {
    const when = oneDay
      ? formatTime(line.booking_time)
      : `${formatDate(line.booking_date)} at ${formatTime(line.booking_time)}`;
    const parts = [
      ...(visit ? [] : [line.person_label.trim()]),
      when,
      `${line.service_name} with ${line.practitioner_name}`,
      ...(line.price_display?.trim() ? [line.price_display.trim()] : []),
    ];
    out.push(`  - ${parts.join(', ')}`);
    for (const addon of line.addon_lines ?? []) out.push(`      + ${addon}`);
    if (line.subtotal_display?.trim()) out.push(`      Subtotal: ${line.subtotal_display.trim()}`);
  }
  return out;
}
