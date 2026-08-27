import { describe, it, expect } from 'vitest';
import {
  accountBookingTimeZone,
  formatAccountBookingDateTime,
} from '@/lib/account/account-bookings';

/**
 * P0-2: `formatAccountBookingDateTime` did two different things with the same
 * pair of stored strings, and got both wrong in a way its `timeZone` argument
 * could not fix.
 *
 * The DATE was anchored to noon UTC and then formatted in `timeZone`. For any
 * zone more than twelve hours from UTC that lands on the wrong calendar day,
 * taking the weekday label with it. The TIME was returned as a raw
 * `slice(0, 5)` of the stored string, so `timeZone` did not affect it at all:
 * asking for a booking in Los Angeles gave you the London time beside a Los
 * Angeles date.
 */

describe('formatAccountBookingDateTime', () => {
  it('renders the venue wall-clock date and time when they agree', () => {
    expect(formatAccountBookingDateTime('2026-09-01', '18:00:00', 'Europe/London')).toEqual({
      date: '1 September 2026',
      time: '18:00',
    });
  });

  it('adds the weekday on the right day', () => {
    const { date } = formatAccountBookingDateTime('2026-09-01', '18:00:00', 'Europe/London', {
      withWeekday: true,
    });
    expect(date).toBe('Tuesday, 1 September 2026');
  });

  it('SHIFTS THE TIME when asked for a different zone, not just the date', () => {
    // The old version returned '18:00' here, beside a Sydney date. A customer
    // travelling, or one whose profile zone differs from the venue's, was told
    // the wrong time of day.
    const out = formatAccountBookingDateTime('2026-09-01', '18:00:00', 'Australia/Sydney', {
      sourceTimeZone: 'Europe/London',
    });
    expect(out).toEqual({ date: '2 September 2026', time: '03:00' });
  });

  it('does not land on the wrong calendar day far from UTC', () => {
    // Noon UTC formatted in Pacific/Kiritimati (UTC+14) is the NEXT day, so the
    // old anchor moved the label a day forward for every booking in that zone.
    const { date } = formatAccountBookingDateTime('2026-09-01', '09:00:00', 'Pacific/Kiritimati', {
      withWeekday: true,
    });
    expect(date).toBe('Tuesday, 1 September 2026');

    // And the same the other way, west of UTC.
    const west = formatAccountBookingDateTime('2026-09-01', '23:00:00', 'Pacific/Midway', {
      withWeekday: true,
    });
    expect(west.date).toBe('Tuesday, 1 September 2026');
  });

  it('keeps midnight as 00:00 rather than rendering it as 12 am or blank', () => {
    expect(formatAccountBookingDateTime('2026-09-01', '00:00:00', 'Europe/London').time).toBe(
      '00:00',
    );
  });

  it('shows no time when there is none, rather than the noon anchor', () => {
    expect(formatAccountBookingDateTime('2026-09-01', null, 'Europe/London')).toEqual({
      date: '1 September 2026',
      time: null,
    });
  });

  it('passes an unparseable date straight through', () => {
    expect(formatAccountBookingDateTime('not-a-date', '18:00:00', 'Europe/London')).toEqual({
      date: 'not-a-date',
      time: '18:00',
    });
  });

  it('DEGRADES on a stored zone Intl cannot use (G23)', () => {
    // Before this, a customer with 'GMT+1' saved on their profile crashed the
    // server render of every page that showed a booking date.
    expect(() => formatAccountBookingDateTime('2026-09-01', '18:00:00', 'GMT+1')).not.toThrow();
    expect(formatAccountBookingDateTime('2026-09-01', '18:00:00', 'GMT+1')).toEqual({
      date: '1 September 2026',
      time: '18:00',
    });
  });
});

describe('accountBookingTimeZone', () => {
  it('prefers the venue zone, then the caller fallback, then London', () => {
    expect(accountBookingTimeZone({ venue: { timezone: 'Australia/Sydney' } } as never)).toBe(
      'Australia/Sydney',
    );
    expect(accountBookingTimeZone({ venue: null } as never, 'America/Los_Angeles')).toBe(
      'America/Los_Angeles',
    );
    expect(accountBookingTimeZone({ venue: null } as never)).toBe('Europe/London');
  });

  it('ignores an unusable stored value on either side', () => {
    expect(accountBookingTimeZone({ venue: { timezone: 'GMT+1' } } as never, 'Asia/Tokyo')).toBe(
      'Asia/Tokyo',
    );
    expect(accountBookingTimeZone({ venue: { timezone: 'GMT+1' } } as never, 'also/bad')).toBe(
      'Europe/London',
    );
  });
});
