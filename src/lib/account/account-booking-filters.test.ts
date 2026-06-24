import { describe, it, expect } from 'vitest';
import {
  filterAccountBookings,
  isPastBooking,
  isUpcomingBooking,
  parseAccountBookingFilter,
} from '@/lib/account/account-booking-filters';

describe('account-booking-filters', () => {
  const today = '2026-06-15';

  it('parseAccountBookingFilter', () => {
    expect(parseAccountBookingFilter(undefined)).toBe('all');
    expect(parseAccountBookingFilter('UPCOMING')).toBe('upcoming');
    expect(parseAccountBookingFilter('past')).toBe('past');
    expect(parseAccountBookingFilter('nope')).toBe('all');
  });

  it('isUpcomingBooking excludes past dates and cancelled same-day', () => {
    expect(isUpcomingBooking('2026-06-20', 'Confirmed', today)).toBe(true);
    expect(isUpcomingBooking('2026-06-10', 'Confirmed', today)).toBe(false);
    expect(isUpcomingBooking('2026-06-15', 'Cancelled', today)).toBe(false);
  });

  it('isPastBooking includes past dates and cancelled', () => {
    expect(isPastBooking('2026-06-10', 'Confirmed', today)).toBe(true);
    expect(isPastBooking('2026-06-15', 'NoShow', today)).toBe(true);
    expect(isPastBooking('2026-06-20', 'Confirmed', today)).toBe(false);
  });

  it('treats the hyphenated No-Show enum value as past, never upcoming', () => {
    // 'No-Show' is the actual booking_status enum value (see BOOKING_STATUSES),
    // not 'NoShow' or 'No Show'. A same-day or future no-show belongs in Past.
    expect(isPastBooking('2026-06-15', 'No-Show', today)).toBe(true); // today
    expect(isPastBooking('2026-06-20', 'No-Show', today)).toBe(true); // future
    expect(isUpcomingBooking('2026-06-15', 'No-Show', today)).toBe(false); // today
    expect(isUpcomingBooking('2026-06-20', 'No-Show', today)).toBe(false); // future
  });

  it('filterAccountBookings', () => {
    const rows = [
      { booking_date: '2026-06-20', status: 'Confirmed', id: '1' },
      { booking_date: '2026-06-10', status: 'Confirmed', id: '2' },
      { booking_date: '2026-06-15', status: 'Cancelled', id: '3' },
    ];
    expect(filterAccountBookings(rows, 'all', today)).toHaveLength(3);
    expect(filterAccountBookings(rows, 'upcoming', today).map((r) => r.id)).toEqual(['1']);
    expect(filterAccountBookings(rows, 'past', today).map((r) => r.id)).toEqual(['2', '3']);
  });
});
