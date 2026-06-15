import { describe, expect, it } from 'vitest';
import {
  bookingFitsWithinOpenMinutes,
  calendarWorkingMinutesForDate,
  describeHoursChangeOrphans,
  formatOrphanLabel,
  venueWeeklyMinutesForDate,
} from '@/lib/calendar/hours-change-orphans';

const TUE = '2026-06-16'; // a Tuesday (dow = 2)

describe('calendarWorkingMinutesForDate', () => {
  it('reads {start,end}[] working hours by weekday key', () => {
    expect(calendarWorkingMinutesForDate({ '2': [{ start: '09:00', end: '18:00' }] })(TUE)).toEqual([
      { start: 540, end: 1080 },
    ]);
  });
  it('returns [] when the weekday is not configured', () => {
    expect(calendarWorkingMinutesForDate({ '3': [{ start: '09:00', end: '17:00' }] })(TUE)).toEqual([]);
  });
});

describe('venueWeeklyMinutesForDate', () => {
  it('reads opening_hours {periods} shape by weekday', () => {
    const oh = { '2': { periods: [{ open: '09:00', close: '22:00' }] } } as unknown as Parameters<
      typeof venueWeeklyMinutesForDate
    >[0];
    expect(venueWeeklyMinutesForDate(oh)(TUE)).toEqual([{ start: 540, end: 1320 }]);
  });
});

describe('bookingFitsWithinOpenMinutes', () => {
  const periods = [{ start: 540, end: 1080 }]; // 09:00–18:00
  it('a booking inside the window fits', () => expect(bookingFitsWithinOpenMinutes(13 * 60, 14 * 60, periods)).toBe(true));
  it('a booking past close does not fit', () => expect(bookingFitsWithinOpenMinutes(21 * 60, 22 * 60, periods)).toBe(false));
  it('a booking ending exactly at close fits', () => expect(bookingFitsWithinOpenMinutes(17 * 60, 18 * 60, periods)).toBe(true));
  it('a booking starting exactly at close does not fit', () => expect(bookingFitsWithinOpenMinutes(18 * 60, 19 * 60, periods)).toBe(false));
});

describe('formatOrphanLabel', () => {
  it('formats weekday, date, 12h time and name', () => {
    expect(formatOrphanLabel('2026-06-16', '21:00', 'Jane Doe')).toBe('Tue 16 Jun, 9:00pm — Jane Doe');
    expect(formatOrphanLabel('2026-06-16', '09:30')).toBe('Tue 16 Jun, 9:30am');
  });
});

describe('describeHoursChangeOrphans', () => {
  it('venue scope lists a sample and an overflow line', () => {
    const msg = describeHoursChangeOrphans(
      {
        total: 7,
        sample: [{ bookingId: '1', bookingDate: '2026-06-16', bookingTime: '21:00', label: 'Tue 16 Jun, 9:00pm — A' }],
      },
      { scope: 'venue' },
    );
    expect(msg).toContain('7 upcoming bookings');
    expect(msg).toContain('Tue 16 Jun, 9:00pm — A');
    expect(msg).toContain('and 6 more');
    expect(msg.toLowerCase()).toContain('kept');
  });

  it('calendar scope names the calendar and uses the singular', () => {
    const msg = describeHoursChangeOrphans(
      { total: 1, sample: [{ bookingId: '1', bookingDate: '2026-06-16', bookingTime: '21:00', label: 'Tue 16 Jun, 9:00pm' }] },
      { scope: 'calendar', calendarName: 'Andrew' },
    );
    expect(msg).toContain('Andrew');
    expect(msg).toContain('1 upcoming booking outside');
  });
});
