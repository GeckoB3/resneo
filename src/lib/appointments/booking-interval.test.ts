import { describe, it, expect } from 'vitest';
import {
  bookingIntervalGrid,
  describeBookingStartOffsets,
  effectiveBookingStartOffsets,
  normalizeBookingIntervalMinutes,
  normalizeBookingStartForStorage,
  sanitizeBookingMinuteMarks,
} from './booking-interval';

describe('normalizeBookingIntervalMinutes', () => {
  it('floors and clamps to 1-60, falling back to 15 on garbage', () => {
    expect(normalizeBookingIntervalMinutes(5)).toBe(5);
    expect(normalizeBookingIntervalMinutes(5.9)).toBe(5);
    expect(normalizeBookingIntervalMinutes(0)).toBe(1);
    expect(normalizeBookingIntervalMinutes(120)).toBe(60);
    expect(normalizeBookingIntervalMinutes(undefined)).toBe(15);
    expect(normalizeBookingIntervalMinutes('nope')).toBe(15);
  });
});

describe('bookingIntervalGrid', () => {
  it('produces hour-anchored marks for the interval', () => {
    expect(bookingIntervalGrid(15)).toEqual([0, 15, 30, 45]);
    expect(bookingIntervalGrid(5)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
    expect(bookingIntervalGrid(60)).toEqual([0]);
  });

  it('handles intervals that do not divide 60 evenly', () => {
    expect(bookingIntervalGrid(7)).toEqual([0, 7, 14, 21, 28, 35, 42, 49, 56]);
  });
});

describe('sanitizeBookingMinuteMarks', () => {
  it('keeps only unique, in-range, on-grid offsets, sorted', () => {
    expect(sanitizeBookingMinuteMarks([25, 0, 5, 5, 99, -1, 30], 5)).toEqual([0, 5, 25, 30]);
  });

  it('drops marks that no longer land on a changed grid', () => {
    // [0,5,10,15,20,25] re-anchored to a 15-minute grid keeps only [0,15].
    expect(sanitizeBookingMinuteMarks([0, 5, 10, 15, 20, 25], 15)).toEqual([0, 15]);
  });

  it('returns [] for non-arrays', () => {
    expect(sanitizeBookingMinuteMarks(null, 5)).toEqual([]);
  });
});

describe('effectiveBookingStartOffsets', () => {
  it('uses the full grid when no marks restrict it', () => {
    expect(effectiveBookingStartOffsets({ interval_minutes: 15, minute_marks: null }).offsets).toEqual([
      0, 15, 30, 45,
    ]);
  });

  it('example 1: every 5 minutes for the first half of the hour', () => {
    const { offsets } = effectiveBookingStartOffsets({
      interval_minutes: 5,
      minute_marks: [0, 5, 10, 15, 20, 25],
    });
    expect(offsets).toEqual([0, 5, 10, 15, 20, 25]);
  });

  it('example 2: on the hour and quarter past only', () => {
    const { offsets } = effectiveBookingStartOffsets({
      interval_minutes: 15,
      minute_marks: [0, 15],
    });
    expect(offsets).toEqual([0, 15]);
  });

  it('falls back to the grid when marks cover everything or nothing', () => {
    expect(effectiveBookingStartOffsets({ interval_minutes: 15, minute_marks: [0, 15, 30, 45] }).offsets).toEqual(
      [0, 15, 30, 45],
    );
    expect(effectiveBookingStartOffsets({ interval_minutes: 15, minute_marks: [] }).offsets).toEqual([
      0, 15, 30, 45,
    ]);
  });

  it('defaults to a 15-minute grid for legacy rows with no settings', () => {
    expect(effectiveBookingStartOffsets({}).offsets).toEqual([0, 15, 30, 45]);
  });
});

describe('normalizeBookingStartForStorage', () => {
  it('collapses a full-grid or empty selection to null (no restriction)', () => {
    expect(normalizeBookingStartForStorage(15, [0, 15, 30, 45])).toEqual({
      booking_interval_minutes: 15,
      booking_minute_marks: null,
    });
    expect(normalizeBookingStartForStorage(15, [])).toEqual({
      booking_interval_minutes: 15,
      booking_minute_marks: null,
    });
    expect(normalizeBookingStartForStorage(15, null)).toEqual({
      booking_interval_minutes: 15,
      booking_minute_marks: null,
    });
  });

  it('persists a genuine restriction, cleaned to the grid', () => {
    expect(normalizeBookingStartForStorage(5, [0, 5, 10, 15, 20, 25, 999])).toEqual({
      booking_interval_minutes: 5,
      booking_minute_marks: [0, 5, 10, 15, 20, 25],
    });
  });
});

describe('describeBookingStartOffsets', () => {
  it('formats minute offsets as :MM', () => {
    expect(describeBookingStartOffsets([0, 5, 15])).toBe(':00, :05, :15');
  });
});
