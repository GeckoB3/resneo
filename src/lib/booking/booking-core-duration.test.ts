import { describe, expect, it } from 'vitest';
import { resolveBookingCoreDurationMinutes } from '@/lib/booking/booking-core-duration';

describe('resolveBookingCoreDurationMinutes', () => {
  it('uses the wall-clock end when the row has one', () => {
    expect(
      resolveBookingCoreDurationMinutes({
        booking_time: '11:15:00',
        booking_end_time: '12:35:00',
        estimated_end_time: null,
      }),
    ).toBe(80);
  });

  it('falls back to estimated_end_time, read as the venue-local wall clock', () => {
    expect(
      resolveBookingCoreDurationMinutes({
        booking_time: '11:15',
        booking_end_time: null,
        estimated_end_time: '2026-08-12T12:35:00.000Z',
      }),
    ).toBe(80);
  });

  it('prefers the wall-clock end over estimated_end_time when both exist', () => {
    expect(
      resolveBookingCoreDurationMinutes({
        booking_time: '11:15',
        booking_end_time: '12:00',
        estimated_end_time: '2026-08-12T12:35:00.000Z',
      }),
    ).toBe(45);
  });

  it('handles a booking that runs past midnight', () => {
    expect(
      resolveBookingCoreDurationMinutes({
        booking_time: '23:30',
        booking_end_time: '00:30',
      }),
    ).toBe(60);
  });

  it('never returns less than the engine minimum', () => {
    expect(
      resolveBookingCoreDurationMinutes({
        booking_time: '11:15',
        booking_end_time: '11:20',
      }),
    ).toBe(15);
  });

  it('returns null when the row carries no end time (never a made-up default)', () => {
    expect(
      resolveBookingCoreDurationMinutes({
        booking_time: '11:15',
        booking_end_time: null,
        estimated_end_time: null,
      }),
    ).toBeNull();
    expect(resolveBookingCoreDurationMinutes({ booking_time: '11:15' })).toBeNull();
  });

  it('returns null for an unparseable estimated_end_time', () => {
    expect(
      resolveBookingCoreDurationMinutes({
        booking_time: '11:15',
        estimated_end_time: 'not-a-date',
      }),
    ).toBeNull();
  });
});
