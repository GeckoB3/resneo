import { describe, it, expect } from 'vitest';
import {
  bookingEndFieldsForStorage,
  bookingEndTimeForStorage,
  estimatedEndTimeForStorage,
} from './booking-end-time';
import { resolveBookingCoreDurationMinutes } from './booking-core-duration';

describe('booking-end-time', () => {
  it('writes the venue-local wall clock for booking_end_time', () => {
    expect(bookingEndTimeForStorage('10:00', 90)).toBe('11:30:00');
    expect(bookingEndTimeForStorage('10:00:00', 45)).toBe('10:45:00');
  });

  it('wraps booking_end_time past midnight, since the date lives on its own column', () => {
    expect(bookingEndTimeForStorage('23:30', 60)).toBe('00:30:00');
  });

  it('encodes estimated_end_time as the wall clock in UTC', () => {
    expect(estimatedEndTimeForStorage('2026-08-12', '10:00', 90)).toBe('2026-08-12T11:30:00.000Z');
  });

  it('rolls estimated_end_time into the next day when the segment crosses midnight', () => {
    expect(estimatedEndTimeForStorage('2026-08-12', '23:30', 60)).toBe('2026-08-13T00:30:00.000Z');
  });

  it('keeps the two columns describing the same instant', () => {
    for (const [start, duration] of [
      ['09:00', 30],
      ['10:15', 150],
      ['23:45', 30],
      ['00:00', 15],
    ] as const) {
      const f = bookingEndFieldsForStorage({ dateYmd: '2026-08-12', startHHmm: start, durationMinutes: duration });
      expect(f.estimated_end_time.slice(11, 16)).toBe(f.booking_end_time.slice(0, 5));
    }
  });

  /** The write side and the read side must agree, or the engine and the UI diverge. */
  it('round-trips through the canonical duration reader', () => {
    for (const [start, duration] of [
      ['09:00', 30],
      ['10:15', 150],
      ['08:00', 480],
    ] as const) {
      const fields = bookingEndFieldsForStorage({
        dateYmd: '2026-08-12',
        startHHmm: start,
        durationMinutes: duration,
      });
      expect(
        resolveBookingCoreDurationMinutes({
          booking_time: `${start}:00`,
          booking_end_time: fields.booking_end_time,
        }),
      ).toBe(duration);
      // And identically when only the ISO column survives.
      expect(
        resolveBookingCoreDurationMinutes({
          booking_time: `${start}:00`,
          estimated_end_time: fields.estimated_end_time,
        }),
      ).toBe(duration);
    }
  });

  it('treats a negative duration as zero rather than writing a time before the start', () => {
    expect(bookingEndTimeForStorage('10:00', -30)).toBe('10:00:00');
  });
});
