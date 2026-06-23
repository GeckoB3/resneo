import { describe, expect, it } from 'vitest';
import { defaultPhoneCountryFromCurrency } from '@/lib/phone/e164';
import {
  classifyBookingInsertSkip,
  eventSeatExceedsCapacity,
  eventStatusConsumesSeat,
} from '@/lib/import/run-execute';

describe('defaultPhoneCountryFromCurrency', () => {
  it('maps common single-country currencies to their region', () => {
    expect(defaultPhoneCountryFromCurrency('GBP')).toBe('GB');
    expect(defaultPhoneCountryFromCurrency('USD')).toBe('US');
    expect(defaultPhoneCountryFromCurrency('AUD')).toBe('AU');
    expect(defaultPhoneCountryFromCurrency('CAD')).toBe('CA');
  });

  it('maps EUR to the primary market (IE)', () => {
    expect(defaultPhoneCountryFromCurrency('EUR')).toBe('IE');
  });

  it('is case-insensitive and trims', () => {
    expect(defaultPhoneCountryFromCurrency('  usd ')).toBe('US');
    expect(defaultPhoneCountryFromCurrency('gbp')).toBe('GB');
  });

  it('falls back to GB for unknown / empty currencies', () => {
    expect(defaultPhoneCountryFromCurrency(null)).toBe('GB');
    expect(defaultPhoneCountryFromCurrency(undefined)).toBe('GB');
    expect(defaultPhoneCountryFromCurrency('')).toBe('GB');
    expect(defaultPhoneCountryFromCurrency('ZZZ')).toBe('GB');
  });
});

describe('classifyBookingInsertSkip', () => {
  it('maps the CDE capacity guard (SQLSTATE 23P01) to a clear capacity reason', () => {
    const out = classifyBookingInsertSkip({ code: '23P01', message: 'CDE_CAPACITY: class is full (10 / 10)' });
    expect(out.code).toBe('capacity_full');
    expect(out.message.toLowerCase()).toContain('capacity');
  });

  it('detects the capacity guard by message even without the SQLSTATE', () => {
    const out = classifyBookingInsertSkip({ code: 'P0001', message: 'CDE_CAPACITY: event is full' });
    expect(out.code).toBe('capacity_full');
  });

  it('falls back to a generic insert-failed reason for other errors', () => {
    const out = classifyBookingInsertSkip({ code: '23505', message: 'duplicate key value' });
    expect(out.code).toBe('booking_insert_failed');
    expect(out.message).toContain('duplicate key value');
  });

  it('handles a null error object', () => {
    const out = classifyBookingInsertSkip(null);
    expect(out.code).toBe('booking_insert_failed');
  });
});

describe('event-session capacity (H2b)', () => {
  it('only capacity-consuming statuses occupy a seat', () => {
    for (const s of ['Pending', 'Booked', 'Confirmed', 'Seated']) {
      expect(eventStatusConsumesSeat(s)).toBe(true);
    }
    for (const s of ['Cancelled', 'No-Show', 'Completed', 'anything-else']) {
      expect(eventStatusConsumesSeat(s)).toBe(false);
    }
  });

  it('exceeds capacity only when a positive cap would be passed', () => {
    expect(eventSeatExceedsCapacity(2, 1, 1)).toBe(false); // 1 + 1 = 2, fits
    expect(eventSeatExceedsCapacity(2, 2, 1)).toBe(true); // 2 + 1 = 3 > 2
    expect(eventSeatExceedsCapacity(10, 4, 3)).toBe(false);
    expect(eventSeatExceedsCapacity(10, 8, 3)).toBe(true);
  });

  it('does not enforce when capacity is unset/zero (not configured)', () => {
    expect(eventSeatExceedsCapacity(0, 99, 5)).toBe(false);
    expect(eventSeatExceedsCapacity(-1, 99, 5)).toBe(false);
  });
});
