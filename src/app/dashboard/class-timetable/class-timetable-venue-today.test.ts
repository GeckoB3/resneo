import { describe, it, expect } from 'vitest';
import { formatYmdInTimezone, addDaysToYmd } from '@/lib/venue/venue-local-clock';

/**
 * Locks in the Task-2 fix for the UTC-vs-local "today" mixing in the class timetable
 * (stats row, agenda and the read-only calendar). The view now derives a single
 * `venueToday = formatYmdInTimezone(Date.now(), venueTimeZone)` and builds the 7-day
 * stats window with `addDaysToYmd`, so a guest/staff browser in another timezone — and
 * server UTC — can no longer push "today" off by a day.
 */
describe('class timetable venue-local "today"', () => {
  // 2026-06-22T23:30:00Z: still the 22nd in UTC, but already the 23rd in Sydney
  // and still the 22nd in Los Angeles — the cases that used to drift.
  const instant = Date.parse('2026-06-22T23:30:00Z');

  it('uses the venue timezone, not UTC, for the calendar date', () => {
    expect(formatYmdInTimezone(instant, 'Australia/Sydney')).toBe('2026-06-23');
    expect(formatYmdInTimezone(instant, 'America/Los_Angeles')).toBe('2026-06-22');
    expect(formatYmdInTimezone(instant, 'Europe/London')).toBe('2026-06-23'); // BST = UTC+1
  });

  it('builds the inclusive 7-day stats window from venue-local today', () => {
    const venueToday = formatYmdInTimezone(instant, 'Australia/Sydney');
    const weekEnd = addDaysToYmd(venueToday, 6);
    expect(venueToday).toBe('2026-06-23');
    expect(weekEnd).toBe('2026-06-29');
  });

  it('crosses month boundaries correctly in the window helper', () => {
    expect(addDaysToYmd('2026-06-28', 6)).toBe('2026-07-04');
    expect(addDaysToYmd('2026-12-31', 1)).toBe('2027-01-01');
  });
});
