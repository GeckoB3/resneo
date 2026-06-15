import { describe, expect, it } from 'vitest';
import {
  bookingConflictsWithClosure,
  describeClosureBookingConflict,
} from '@/lib/calendar/closure-booking-conflicts';

describe('bookingConflictsWithClosure', () => {
  const booking = { booking_time: '13:15', booking_end_time: '14:45' };

  it('a full-day closure conflicts with any booking', () => {
    expect(bookingConflictsWithClosure(booking, { startMinute: null, endMinute: null })).toBe(true);
  });

  it('a partial closure overlapping the booking conflicts', () => {
    expect(bookingConflictsWithClosure(booking, { startMinute: 13 * 60, endMinute: 13 * 60 + 30 })).toBe(true);
  });

  it('a closure ending exactly when the booking starts does not conflict (half-open)', () => {
    expect(bookingConflictsWithClosure(booking, { startMinute: 12 * 60, endMinute: 13 * 60 + 15 })).toBe(false);
  });

  it('a closure starting exactly when the booking ends does not conflict (half-open)', () => {
    expect(bookingConflictsWithClosure(booking, { startMinute: 14 * 60 + 45, endMinute: 15 * 60 + 30 })).toBe(false);
  });

  it('falls back to a 60-minute window when the booking has no known end', () => {
    const noEnd = { booking_time: '13:00' };
    expect(bookingConflictsWithClosure(noEnd, { startMinute: 13 * 60 + 30, endMinute: 14 * 60 })).toBe(true);
    expect(bookingConflictsWithClosure(noEnd, { startMinute: 14 * 60, endMinute: 15 * 60 })).toBe(false);
  });
});

describe('describeClosureBookingConflict', () => {
  it('time-scope message states the time, date and a remedy', () => {
    const msg = describeClosureBookingConflict(
      { calendarColumnId: 'c1', bookingDate: '2026-06-15', bookingTime: '13:15', totalConflicts: 1 },
      { scope: 'time' },
    );
    expect(msg).toContain('13:15');
    expect(msg).toContain('2026-06-15');
    expect(msg.toLowerCase()).toContain('move or cancel');
  });

  it('day-scope message uses the calendar name and a plural count', () => {
    const msg = describeClosureBookingConflict(
      { calendarColumnId: 'c1', bookingDate: '2026-06-15', bookingTime: '10:15', totalConflicts: 3 },
      { scope: 'day', calendarName: 'Andrew' },
    );
    expect(msg).toContain('Andrew');
    expect(msg).toContain('3 bookings');
    expect(msg.toLowerCase()).toContain('unavailable');
  });
});
