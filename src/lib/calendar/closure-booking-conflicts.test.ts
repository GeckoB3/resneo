import { describe, expect, it } from 'vitest';
import {
  bookingConflictsWithClosure,
  describeClosureBookingConflict,
  describeVenueClosureConflicts,
  findVenueClosureBookingConflicts,
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

/**
 * Venue-wide closures: warned about, not blocked. Regression cover for closures
 * being created silently over bookings that nobody is told about.
 */
function stubAdmin(rows: Array<Record<string, unknown>>, error: { message: string } | null = null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    lte: () => chain,
    in: async () => ({ data: rows, error }),
  };
  return { from: () => chain } as never;
}

describe('findVenueClosureBookingConflicts', () => {
  const rows = [
    { id: 'b2', booking_date: '2026-12-24', booking_time: '15:30', booking_end_time: '16:00', status: 'Booked' },
    { id: 'b1', booking_date: '2026-12-24', booking_time: '09:00', booking_end_time: '09:45', status: 'Confirmed' },
  ];

  it('reports every booking in the range and the earliest one', async () => {
    const out = await findVenueClosureBookingConflicts(stubAdmin(rows), {
      venueId: 'v1',
      startDate: '2026-12-24',
      endDate: '2026-12-24',
    });
    expect(out).not.toBeNull();
    expect(out!.totalConflicts).toBe(2);
    expect(out!.earliestTime).toBe('09:00');
    expect(out!.earliestDate).toBe('2026-12-24');
  });

  it('counts only bookings overlapping a part-day window', async () => {
    const out = await findVenueClosureBookingConflicts(stubAdmin(rows), {
      venueId: 'v1',
      startDate: '2026-12-24',
      endDate: '2026-12-24',
      startTime: '15:00',
      endTime: '18:00',
    });
    expect(out!.totalConflicts).toBe(1);
    expect(out!.earliestTime).toBe('15:30');
  });

  it('returns null when nothing is booked, so the closure saves without a prompt', async () => {
    const out = await findVenueClosureBookingConflicts(stubAdmin([]), {
      venueId: 'v1',
      startDate: '2026-12-24',
      endDate: '2026-12-24',
    });
    expect(out).toBeNull();
  });

  it('throws rather than reporting a false all-clear when the lookup fails', async () => {
    await expect(
      findVenueClosureBookingConflicts(stubAdmin([], { message: 'boom' }), {
        venueId: 'v1',
        startDate: '2026-12-24',
        endDate: '2026-12-24',
      }),
    ).rejects.toThrow(/Could not verify existing bookings/);
  });
});

describe('describeVenueClosureConflicts', () => {
  it('says nothing is cancelled and nobody is told', () => {
    const msg = describeVenueClosureConflicts({
      totalConflicts: 3,
      earliestDate: '2026-12-24',
      earliestTime: '09:00',
    });
    expect(msg).toContain('3 bookings');
    expect(msg).toContain('2026-12-24');
    expect(msg.toLowerCase()).toContain('does not cancel');
    expect(msg.toLowerCase()).toContain('nobody is told');
  });

  it('uses the singular for one booking', () => {
    const msg = describeVenueClosureConflicts({
      totalConflicts: 1,
      earliestDate: '2026-12-24',
      earliestTime: '09:00',
    });
    expect(msg).toContain('1 booking ');
    expect(msg).not.toContain('1 bookings');
  });
});
