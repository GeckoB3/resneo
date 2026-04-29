/** Status values treated as non-upcoming for account list filtering (case-sensitive as stored in DB). */
const CANCELLED = new Set(['Cancelled', 'Canceled', 'NoShow', 'No Show']);

export function isPastBooking(bookingDate: string, status: string, todayUtcDate: string): boolean {
  if (bookingDate < todayUtcDate) return true;
  if (bookingDate === todayUtcDate && CANCELLED.has(status)) return true;
  return CANCELLED.has(status);
}

export function isUpcomingBooking(bookingDate: string, status: string, todayUtcDate: string): boolean {
  if (bookingDate < todayUtcDate) return false;
  return !CANCELLED.has(status);
}

export type AccountBookingFilter = 'all' | 'upcoming' | 'past';

export function parseAccountBookingFilter(raw: string | undefined): AccountBookingFilter {
  const v = (raw ?? 'all').toLowerCase();
  if (v === 'upcoming' || v === 'past') return v;
  return 'all';
}

export function filterAccountBookings<T extends { booking_date: string; status: string }>(
  bookings: T[],
  filter: AccountBookingFilter,
  todayUtcDate: string,
): T[] {
  if (filter === 'upcoming') {
    return bookings.filter((b) => isUpcomingBooking(b.booking_date, b.status, todayUtcDate));
  }
  if (filter === 'past') {
    return bookings.filter((b) => isPastBooking(b.booking_date, b.status, todayUtcDate));
  }
  return bookings;
}
