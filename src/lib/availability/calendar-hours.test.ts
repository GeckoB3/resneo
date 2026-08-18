import { describe, it, expect } from 'vitest';
import { getDayOfWeek } from '@/lib/availability/engine';
import {
  calendarBookableSegments,
  calendarBreaks,
  calendarDayOff,
  calendarHours,
  type CalendarScheduleRow,
} from '@/lib/availability/calendar-hours';

/**
 * Stage 5: the calendar layer, replacing six working-hours implementations and four break
 * implementations that agreed by coincidence rather than construction.
 *
 * The behaviours pinned here are the ones the old copies disagreed about or that a rewrite
 * could silently change: the `break_times_by_day` fallback, the two `days_off` semantics,
 * per-date overrides replacing rather than intersecting, and the containment-only nature of
 * `calendarBookableSegments`.
 */

/** A Wednesday. */
const DATE = '2030-06-05';
const DK = String(getDayOfWeek(DATE));
const DAY_NAME = 'wed';

const NINE_TO_FIVE: CalendarScheduleRow = {
  working_hours: { [DK]: [{ start: '09:00', end: '17:00' }] },
};

describe('calendarHours', () => {
  it('reads the weekly shape by numeric key', () => {
    expect(calendarHours(NINE_TO_FIVE, DATE)).toEqual([{ start: 540, end: 1020 }]);
  });

  it('also accepts the lowercase weekday name as a key', () => {
    expect(calendarHours({ working_hours: { [DAY_NAME]: [{ start: '10:00', end: '12:00' }] } }, DATE)).toEqual([
      { start: 600, end: 720 },
    ]);
  });

  it('returns nothing when the weekday has no entry', () => {
    expect(calendarHours({ working_hours: { '0': [{ start: '09:00', end: '17:00' }] } }, DATE)).toEqual([]);
    expect(calendarHours({}, DATE)).toEqual([]);
  });

  it('merges overlapping weekly ranges rather than emitting both', () => {
    const row: CalendarScheduleRow = {
      working_hours: {
        [DK]: [
          { start: '09:00', end: '13:00' },
          { start: '12:00', end: '17:00' },
        ],
      },
    };

    expect(calendarHours(row, DATE)).toEqual([{ start: 540, end: 1020 }]);
  });

  it('drops an inverted weekly range instead of resolving it as a full day', () => {
    expect(calendarHours({ working_hours: { [DK]: [{ start: '17:00', end: '09:00' }] } }, DATE)).toEqual([]);
  });

  describe('days_off', () => {
    it('closes the day for an exact ISO date', () => {
      expect(calendarHours({ ...NINE_TO_FIVE, days_off: [DATE] }, DATE)).toEqual([]);
      expect(calendarDayOff({ days_off: [DATE] }, DATE)).toBe(true);
    });

    /**
     * A lowercase weekday name is a PERMANENT recurring closure, live on the appointment
     * and resource paths. The target model cannot express it; Stage 1 item 8 closed the
     * write surface, and the engines keep honouring stored values until Stage 6b.
     */
    it('closes every occurrence of a recurring weekday name', () => {
      expect(calendarHours({ ...NINE_TO_FIVE, days_off: [DAY_NAME] }, DATE)).toEqual([]);
      expect(calendarDayOff({ days_off: [DAY_NAME] }, DATE)).toBe(true);
    });

    it('ignores an entry that is neither a date nor a weekday name', () => {
      expect(calendarHours({ ...NINE_TO_FIVE, days_off: ['Wednesday'] }, DATE)).toEqual([
        { start: 540, end: 1020 },
      ]);
    });
  });

  describe('per-date overrides', () => {
    it('REPLACES the weekly shape rather than narrowing it', () => {
      const row: CalendarScheduleRow = {
        ...NINE_TO_FIVE,
        availability_exceptions: { [DATE]: { periods: [{ start: '08:00', end: '20:00' }] } },
      };

      // 08:00-20:00 is wider than the weekly 09:00-17:00, so an intersect would clip it.
      expect(calendarHours(row, DATE)).toEqual([{ start: 480, end: 1200 }]);
    });

    it('closes the day for a { closed: true } override', () => {
      const row: CalendarScheduleRow = {
        ...NINE_TO_FIVE,
        availability_exceptions: { [DATE]: { closed: true } },
      };

      expect(calendarHours(row, DATE)).toEqual([]);
    });

    /** §2.2: an override with nothing valid in it is invalid data, not an intent to shut. */
    it('IGNORES an override with no valid periods, keeping the weekly shape', () => {
      const row: CalendarScheduleRow = {
        ...NINE_TO_FIVE,
        availability_exceptions: { [DATE]: { periods: [] } },
      };

      expect(calendarHours(row, DATE)).toEqual([{ start: 540, end: 1020 }]);
    });

    it('beats days_off, because it is the more specific statement about the date', () => {
      const row: CalendarScheduleRow = {
        ...NINE_TO_FIVE,
        days_off: [DATE],
        availability_exceptions: { [DATE]: { periods: [{ start: '10:00', end: '12:00' }] } },
      };

      expect(calendarHours(row, DATE)).toEqual([{ start: 600, end: 720 }]);
    });

    it('applies only to its own date', () => {
      const row: CalendarScheduleRow = {
        ...NINE_TO_FIVE,
        availability_exceptions: { '2030-06-06': { closed: true } },
      };

      expect(calendarHours(row, DATE)).toEqual([{ start: 540, end: 1020 }]);
    });
  });
});

describe('calendarBreaks', () => {
  it('prefers break_times_by_day when it has entries', () => {
    const row: CalendarScheduleRow = {
      break_times: [{ start: '08:00', end: '08:30' }],
      break_times_by_day: { [DK]: [{ start: '12:00', end: '12:45' }] },
    };

    expect(calendarBreaks(row, DATE)).toEqual([{ start: 720, end: 765 }]);
  });

  /**
   * The flat list is the live fallback whenever `break_times_by_day` is null or empty, on
   * four engines. §1.3 tier 2 refuses to call the column dead for exactly this reason.
   */
  it('falls back to the flat list when break_times_by_day is absent or empty', () => {
    const flat = [{ start: '13:00', end: '14:00' }];

    expect(calendarBreaks({ break_times: flat, break_times_by_day: null }, DATE)).toEqual([
      { start: 780, end: 840 },
    ]);
    expect(calendarBreaks({ break_times: flat, break_times_by_day: {} }, DATE)).toEqual([
      { start: 780, end: 840 },
    ]);
  });

  it('returns nothing when by-day is configured but this weekday has none', () => {
    const row: CalendarScheduleRow = {
      break_times: [{ start: '08:00', end: '08:30' }],
      break_times_by_day: { '0': [{ start: '12:00', end: '12:45' }] },
    };

    // by-day is present, so the flat list must NOT come back for an unlisted weekday.
    expect(calendarBreaks(row, DATE)).toEqual([]);
  });

  it('merges overlapping breaks', () => {
    const row: CalendarScheduleRow = {
      break_times: [
        { start: '12:00', end: '13:00' },
        { start: '12:30', end: '14:00' },
      ],
    };

    expect(calendarBreaks(row, DATE)).toEqual([{ start: 720, end: 840 }]);
  });
});

describe('calendarBookableSegments', () => {
  it('splits the working day around a break', () => {
    const row: CalendarScheduleRow = { ...NINE_TO_FIVE, break_times: [{ start: '12:00', end: '13:00' }] };

    expect(calendarBookableSegments(row, DATE)).toEqual([
      { start: 540, end: 720 },
      { start: 780, end: 1020 },
    ]);
  });

  it('is the hours themselves when there are no breaks', () => {
    expect(calendarBookableSegments(NINE_TO_FIVE, DATE)).toEqual([{ start: 540, end: 1020 }]);
  });

  it('is empty when a break covers the whole working day', () => {
    const row: CalendarScheduleRow = { ...NINE_TO_FIVE, break_times: [{ start: '08:00', end: '18:00' }] };

    expect(calendarBookableSegments(row, DATE)).toEqual([]);
  });

  /**
   * The distinction this function exists to make. Subtracting a break SPLITS the range, so
   * anchoring a grid to the result moves every slot after the break. Containment consumers
   * want the split; slot generation must not have it. Same inputs, different questions.
   */
  it('differs from calendarHours precisely by the breaks, which is why grids use hours', () => {
    const row: CalendarScheduleRow = { ...NINE_TO_FIVE, break_times: [{ start: '12:00', end: '12:45' }] };

    expect(calendarHours(row, DATE)).toEqual([{ start: 540, end: 1020 }]);
    expect(calendarBookableSegments(row, DATE)).toEqual([
      { start: 540, end: 720 },
      { start: 765, end: 1020 },
    ]);
  });
});

describe('unified mapper carries per-date overrides (§1.2 item 21)', () => {
  /**
   * The resource's own per-date override used to be honoured on the `/book` path, which
   * maps the resource row directly, and silently ignored on the unified path, which routes
   * resource calendars through the appointment engine via `unifiedCalendarRowToPractitioner`
   * -- and that mapper dropped the column. Same stored setting, two different answers
   * depending on which URL the guest arrived through.
   */
  it('resolves a mapped calendar row identically to the raw row', async () => {
    const { unifiedCalendarRowToPractitioner } = await import('@/lib/availability/unified-calendar-mapper');

    const raw = {
      id: 'cal-1',
      venue_id: 'v1',
      name: 'Room 2',
      is_active: true,
      working_hours: { [DK]: [{ start: '09:00', end: '17:00' }] },
      break_times: [],
      break_times_by_day: null,
      days_off: [],
      availability_exceptions: { [DATE]: { periods: [{ start: '10:00', end: '12:00' }] } },
    };

    const mapped = unifiedCalendarRowToPractitioner(raw);

    expect(calendarHours(raw as CalendarScheduleRow, DATE)).toEqual([{ start: 600, end: 720 }]);
    expect(calendarHours(mapped as CalendarScheduleRow, DATE)).toEqual([{ start: 600, end: 720 }]);
  });

  it('carries a { closed: true } override through the mapper too', async () => {
    const { unifiedCalendarRowToPractitioner } = await import('@/lib/availability/unified-calendar-mapper');

    const mapped = unifiedCalendarRowToPractitioner({
      id: 'cal-1',
      venue_id: 'v1',
      name: 'Room 2',
      is_active: true,
      working_hours: { [DK]: [{ start: '09:00', end: '17:00' }] },
      break_times: [],
      break_times_by_day: null,
      days_off: [],
      availability_exceptions: { [DATE]: { closed: true } },
    });

    expect(calendarHours(mapped as CalendarScheduleRow, DATE)).toEqual([]);
  });
});
