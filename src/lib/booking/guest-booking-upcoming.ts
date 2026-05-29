import { calendarDateInTimeZone } from '@/lib/guests/guest-contacts-list';
import { bookingScheduleWallEndHm } from '@/lib/booking/staff-rebook-from-booking-source';

export interface GuestBookingUpcomingRow {
  booking_date: string;
  booking_time: string;
  estimated_end_time: string | null;
  booking_end_time?: string | null;
}

function wallClockHHMMInVenue(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hh}:${mm}`;
}

function isBookingUpcomingInVenue(
  bookingDate: string,
  bookingTimeHm: string,
  now: Date,
  venueTimeZone: string,
): boolean {
  const today = calendarDateInTimeZone(now, venueTimeZone);
  if (bookingDate > today) return true;
  if (bookingDate < today) return false;
  const nowHm = wallClockHHMMInVenue(now, venueTimeZone);
  return bookingTimeHm >= nowHm;
}

function parseEstimatedEndInstantMs(iso: string | null | undefined): number | null {
  if (!iso?.trim()) return null;
  const ms = new Date(iso.trim()).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Upcoming = scheduled end time is still in the future (same instant/wall rules as dashboard).
 * When no end boundary exists, falls back to start-time-based “today / future”.
 */
export function isBookingUpcomingBeforeScheduledEnd(
  row: GuestBookingUpcomingRow,
  now: Date,
  venueTimeZone: string,
): boolean {
  const endInstant = parseEstimatedEndInstantMs(row.estimated_end_time);
  if (endInstant !== null) {
    return now.getTime() < endInstant;
  }

  const endHm = bookingScheduleWallEndHm(row);
  const todayVenue = calendarDateInTimeZone(now, venueTimeZone);
  const startHm =
    typeof row.booking_time === 'string' && row.booking_time.length >= 5 ? row.booking_time.slice(0, 5) : '00:00';

  if (row.booking_date > todayVenue) return true;
  if (row.booking_date < todayVenue) return false;

  if (endHm) {
    const nowHm = wallClockHHMMInVenue(now, venueTimeZone);
    return nowHm < endHm;
  }

  return isBookingUpcomingInVenue(row.booking_date, startHm, now, venueTimeZone);
}

/** Date picker default for staff rebook: upcoming → source booking date; previous → today (venue). */
export function staffRebookInitialDate(
  row: GuestBookingUpcomingRow,
  venueTimeZone: string,
  now: Date = new Date(),
): string {
  if (isBookingUpcomingBeforeScheduledEnd(row, now, venueTimeZone)) {
    return row.booking_date;
  }
  return calendarDateInTimeZone(now, venueTimeZone);
}
