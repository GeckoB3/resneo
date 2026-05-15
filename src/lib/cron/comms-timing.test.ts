import { describe, it, expect } from 'vitest';
import {
  bookingCivilDatesForReminderWindow,
  msUntilBookingStartUtc,
} from './comms-timing';
import { venueLocalDateTimeToUtcMs } from '@/lib/venue/venue-local-clock';

describe('comms-timing', () => {
  it('msUntilBookingStartUtc matches venueLocalDateTimeToUtcMs minus now (Europe/London summer)', () => {
    const tz = 'Europe/London';
    const nowMs = Date.parse('2026-06-15T12:00:00.000Z');
    const bookingDate = '2026-06-16';
    const bookingTime = '14:30:00';
    const startMs = venueLocalDateTimeToUtcMs(bookingDate, bookingTime, tz);
    expect(msUntilBookingStartUtc(bookingDate, bookingTime, tz, nowMs)).toBe(startMs - nowMs);
  });

  it('bookingCivilDatesForReminderWindow returns one or two civil dates in venue TZ', () => {
    const dates = bookingCivilDatesForReminderWindow({
      venueTimeZone: 'Europe/London',
      hoursBefore: 24,
      toleranceMs: 22 * 60 * 1000,
      nowMs: Date.parse('2026-01-10T12:00:00.000Z'),
    });
    expect(dates.length).toBeGreaterThanOrEqual(1);
    expect(dates.length).toBeLessThanOrEqual(2);
    expect(dates[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
