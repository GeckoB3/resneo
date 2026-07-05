import { describe, expect, it } from 'vitest';
import {
  cardHoldChargeWindowEndsAtForBooking,
  resolveCardHoldBookingEndIso,
} from './card-hold-window';

describe('resolveCardHoldBookingEndIso', () => {
  it('uses booking_end_time on the booking date when present', () => {
    expect(
      resolveCardHoldBookingEndIso({
        booking_date: '2026-07-01',
        booking_time: '18:00:00',
        booking_end_time: '20:30:00',
      }),
    ).toBe('2026-07-01T20:30:00.000Z');
  });

  it('rolls an end before the start onto the next day (overnight booking)', () => {
    expect(
      resolveCardHoldBookingEndIso({
        booking_date: '2026-07-01',
        booking_time: '22:00:00',
        booking_end_time: '01:00:00',
      }),
    ).toBe('2026-07-02T01:00:00.000Z');
  });

  it('falls back to estimated_end_time when booking_end_time is missing', () => {
    expect(
      resolveCardHoldBookingEndIso({
        booking_date: '2026-07-01',
        booking_time: '18:00:00',
        booking_end_time: null,
        estimated_end_time: '2026-07-01T19:45:00.000Z',
      }),
    ).toBe('2026-07-01T19:45:00.000Z');
  });

  it('prefers booking_end_time over estimated_end_time', () => {
    expect(
      resolveCardHoldBookingEndIso({
        booking_date: '2026-07-01',
        booking_time: '18:00:00',
        booking_end_time: '19:00',
        estimated_end_time: '2026-07-01T23:00:00.000Z',
      }),
    ).toBe('2026-07-01T19:00:00.000Z');
  });

  it('falls back to the start when no end field resolves', () => {
    expect(
      resolveCardHoldBookingEndIso({
        booking_date: '2026-07-01',
        booking_time: '18:00:00',
        booking_end_time: null,
        estimated_end_time: null,
      }),
    ).toBe('2026-07-01T18:00:00.000Z');
  });

  it('ignores an unparseable estimated_end_time and falls back to the start', () => {
    expect(
      resolveCardHoldBookingEndIso({
        booking_date: '2026-07-01',
        booking_time: '18:00:00',
        estimated_end_time: 'not-a-date',
      }),
    ).toBe('2026-07-01T18:00:00.000Z');
  });

  it('returns null when the start itself cannot be parsed', () => {
    expect(
      resolveCardHoldBookingEndIso({ booking_date: '', booking_time: '18:00' }),
    ).toBeNull();
    expect(
      resolveCardHoldBookingEndIso({ booking_date: '2026-07-01', booking_time: 'nope' }),
    ).toBeNull();
  });
});

describe('cardHoldChargeWindowEndsAtForBooking', () => {
  it('adds CARD_HOLD_CHARGE_WINDOW_DAYS (14) to the booking end', () => {
    expect(
      cardHoldChargeWindowEndsAtForBooking({
        booking_date: '2026-07-01',
        booking_time: '18:00:00',
        booking_end_time: '20:00:00',
      }),
    ).toBe('2026-07-15T20:00:00.000Z');
  });

  it('derives from the start when no end resolves', () => {
    expect(
      cardHoldChargeWindowEndsAtForBooking({
        booking_date: '2026-07-01',
        booking_time: '18:00:00',
      }),
    ).toBe('2026-07-15T18:00:00.000Z');
  });

  it('returns null when the schedule cannot be parsed', () => {
    expect(
      cardHoldChargeWindowEndsAtForBooking({ booking_date: 'bad', booking_time: 'bad' }),
    ).toBeNull();
  });
});
