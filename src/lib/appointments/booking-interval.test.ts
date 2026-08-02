import { describe, it, expect } from 'vitest';
import {
  bookingIntervalGrid,
  bookingStartTimesToMinutes,
  candidateStartMinutes,
  describeBookingStartOffsets,
  describeBookingStartTimes,
  effectiveBookingStartOffsets,
  normalizeBookingIntervalMinutes,
  normalizeBookingStartForStorage,
  sanitizeBookingMinuteMarks,
  sanitizeBookingStartTimes,
  usesFixedStartTimes,
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
      booking_start_times: null,
    });
    expect(normalizeBookingStartForStorage(15, [])).toEqual({
      booking_interval_minutes: 15,
      booking_minute_marks: null,
      booking_start_times: null,
    });
    expect(normalizeBookingStartForStorage(15, null)).toEqual({
      booking_interval_minutes: 15,
      booking_minute_marks: null,
      booking_start_times: null,
    });
  });

  it('persists a genuine restriction, cleaned to the grid', () => {
    expect(normalizeBookingStartForStorage(5, [0, 5, 10, 15, 20, 25, 999])).toEqual({
      booking_interval_minutes: 5,
      booking_minute_marks: [0, 5, 10, 15, 20, 25],
      booking_start_times: null,
    });
  });

  it('stores fixed times cleaned and sorted, keeping the interval for a later switch back', () => {
    expect(
      normalizeBookingStartForStorage(15, [0, 15], ['15:30', '09:20', 'nonsense', '09:20', '11:30']),
    ).toEqual({
      booking_interval_minutes: 15,
      booking_minute_marks: [0, 15],
      booking_start_times: ['09:20', '11:30', '15:30'],
    });
  });

  it('collapses an empty or all-invalid fixed-time list to null', () => {
    expect(normalizeBookingStartForStorage(15, null, []).booking_start_times).toBeNull();
    expect(normalizeBookingStartForStorage(15, null, ['25:00', '9:20']).booking_start_times).toBeNull();
  });
});

describe('sanitizeBookingStartTimes', () => {
  it('keeps only unique, valid HH:MM values, sorted chronologically', () => {
    expect(sanitizeBookingStartTimes(['15:30', '09:20', '11:30', '09:20', '13:45'])).toEqual([
      '09:20',
      '11:30',
      '13:45',
      '15:30',
    ]);
  });

  it('rejects out-of-range, unpadded and malformed values', () => {
    expect(sanitizeBookingStartTimes(['24:00', '23:60', '9:20', '0920', '', 'noon', 12, null])).toEqual([]);
  });

  it('accepts midnight and the last minute of the day', () => {
    expect(sanitizeBookingStartTimes(['23:59', '00:00'])).toEqual(['00:00', '23:59']);
  });

  it('trims seconds off HH:MM:SS values from the database', () => {
    expect(sanitizeBookingStartTimes(['09:20:00'])).toEqual(['09:20']);
  });

  it('returns [] for non-arrays', () => {
    expect(sanitizeBookingStartTimes(null)).toEqual([]);
    expect(sanitizeBookingStartTimes('09:20')).toEqual([]);
  });
});

describe('bookingStartTimesToMinutes', () => {
  it('converts HH:MM to minutes since midnight', () => {
    expect(bookingStartTimesToMinutes(['00:00', '09:20', '13:45', '23:59'])).toEqual([0, 560, 825, 1439]);
  });
});

describe('usesFixedStartTimes', () => {
  it('is true only for a non-empty list of valid times', () => {
    expect(usesFixedStartTimes(['09:20'])).toBe(true);
    expect(usesFixedStartTimes([])).toBe(false);
    expect(usesFixedStartTimes(null)).toBe(false);
    expect(usesFixedStartTimes(['nope'])).toBe(false);
  });
});

describe('candidateStartMinutes', () => {
  const nineToFive = [{ start: 9 * 60, end: 17 * 60 }];

  it('steps by the interval from each range start when no fixed times are set', () => {
    const starts = candidateStartMinutes({
      ranges: [{ start: 9 * 60, end: 10 * 60 }],
      totalSpan: 30,
      interval_minutes: 15,
    });
    expect(starts).toEqual([9 * 60, 9 * 60 + 15, 9 * 60 + 30]);
  });

  it('offers exactly the fixed times when they fit', () => {
    const starts = candidateStartMinutes({
      ranges: nineToFive,
      totalSpan: 90,
      start_times: ['09:20', '11:30', '13:45', '15:30'],
    });
    expect(starts).toEqual([560, 690, 825, 930]);
  });

  it('drops a fixed time whose appointment would run past the end of the range', () => {
    // 15:30 + 120 minutes = 17:30, past a 17:00 close.
    const starts = candidateStartMinutes({
      ranges: nineToFive,
      totalSpan: 120,
      start_times: ['09:20', '15:30'],
    });
    expect(starts).toEqual([560]);
  });

  it('drops a fixed time that falls outside every range (e.g. a lunch gap)', () => {
    const starts = candidateStartMinutes({
      ranges: [
        { start: 9 * 60, end: 12 * 60 },
        { start: 14 * 60, end: 17 * 60 },
      ],
      totalSpan: 60,
      start_times: ['09:20', '13:00', '15:30'],
    });
    expect(starts).toEqual([560, 930]);
  });

  it('ignores the interval and minute marks when fixed times are set', () => {
    const starts = candidateStartMinutes({
      ranges: nineToFive,
      totalSpan: 30,
      interval_minutes: 15,
      minute_marks: [0, 15],
      start_times: ['09:20'],
    });
    expect(starts).toEqual([560]);
  });

  it('falls back to the interval grid for an empty or invalid fixed-time list', () => {
    const viaEmpty = candidateStartMinutes({
      ranges: [{ start: 9 * 60, end: 10 * 60 }],
      totalSpan: 30,
      interval_minutes: 30,
      start_times: [],
    });
    expect(viaEmpty).toEqual([9 * 60, 9 * 60 + 30]);
  });

  it('anchors minute marks to the top of the hour', () => {
    const starts = candidateStartMinutes({
      ranges: [{ start: 9 * 60, end: 11 * 60 }],
      totalSpan: 30,
      interval_minutes: 15,
      minute_marks: [0, 15],
    });
    expect(starts).toEqual([9 * 60, 9 * 60 + 15, 10 * 60, 10 * 60 + 15]);
  });
});

describe('describeBookingStartOffsets', () => {
  it('formats minute offsets as :MM', () => {
    expect(describeBookingStartOffsets([0, 5, 15])).toBe(':00, :05, :15');
  });
});

describe('describeBookingStartTimes', () => {
  it('formats fixed times for display', () => {
    expect(describeBookingStartTimes(['09:20', '11:30', '13:45', '15:30'])).toBe(
      '9:20am, 11:30am, 1:45pm, 3:30pm',
    );
  });

  it('handles noon and midnight', () => {
    expect(describeBookingStartTimes(['00:30', '12:00'])).toBe('12:30am, 12:00pm');
  });
});
