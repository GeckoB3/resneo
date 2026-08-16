import { describe, expect, it } from 'vitest';
import {
  buildLinkedColumnClosureBlocks,
  buildPractitionerScheduleClosureBlocks,
  buildVenueScheduleClosureBlocks,
  closedRangesFromOpenWindows,
} from '@/lib/calendar/schedule-closure-blocks';
import type { AvailabilityBlock, OpeningHours } from '@/types/availability';
import type { WorkingHours } from '@/types/booking-models';

describe('buildLinkedColumnClosureBlocks', () => {
  // Same 10:00–18:00 window on every weekday, so the test is weekday-agnostic.
  const open10to18: WorkingHours = Object.fromEntries(
    ['0', '1', '2', '3', '4', '5', '6'].map((d) => [d, [{ start: '10:00', end: '18:00' }]]),
  ) as WorkingHours;

  it('shades a linked venue’s closed hours within the grid (opens later than this venue)', () => {
    const blocks = buildLinkedColumnClosureBlocks({
      columnId: 'linked:v1:p1',
      workingHours: open10to18,
      dateYmd: '2030-06-03',
      timeZone: 'Europe/London',
      gridStartHour: 9,
      gridEndHour: 22,
    });
    expect(blocks.map((b) => [b.start_time.slice(0, 5), b.end_time.slice(0, 5)])).toEqual([
      ['09:00', '10:00'],
      ['18:00', '22:00'],
    ]);
    // `linked_venue_closed`, not `practitioner_closed`: staff may book past
    // their own venue's closing time, but a partner's closed hours stay a hard
    // conflict. See `isOccupyingBlock`.
    expect(
      blocks.every(
        (b) => b.calendar_id === 'linked:v1:p1' && b.block_type === 'linked_venue_closed',
      ),
    ).toBe(true);
  });

  it('treats a day with no working hours as fully closed across the grid', () => {
    const blocks = buildLinkedColumnClosureBlocks({
      columnId: 'c',
      workingHours: {},
      dateYmd: '2030-06-03',
      timeZone: 'Europe/London',
      gridStartHour: 9,
      gridEndHour: 22,
    });
    expect(blocks).toHaveLength(1);
    expect([blocks[0]!.start_time.slice(0, 5), blocks[0]!.end_time.slice(0, 5)]).toEqual([
      '09:00',
      '22:00',
    ]);
  });
});

describe('closedRangesFromOpenWindows', () => {
  it('returns gaps before and after open window', () => {
    expect(closedRangesFromOpenWindows([{ start: 540, end: 1020 }], 480, 1200)).toEqual([
      { start: 480, end: 540 },
      { start: 1020, end: 1200 },
    ]);
  });
});

describe('buildVenueScheduleClosureBlocks', () => {
  const openingHours: OpeningHours = {
    '1': { periods: [{ open: '09:00', close: '17:00' }] },
  };

  it('emits full-day venue_closed when resolution is closed', () => {
    const blocks = buildVenueScheduleClosureBlocks({
      openingHours: { '1': { closed: true } },
      venueWideBlocks: [],
      fromDate: '2030-06-03',
      toDate: '2030-06-03',
      columnIds: ['col-1'],
    });
    const closed = blocks.filter((b) => b.block_type === 'venue_closed');
    expect(closed.length).toBeGreaterThanOrEqual(1);
    expect(closed[0]?.block_date).toBe('2030-06-03');
  });

  it('emits venue_amended_hours only for amended periods', () => {
    const venueWideBlocks: AvailabilityBlock[] = [
      {
        id: 'b1',
        venue_id: 'v1',
        service_id: null,
        block_type: 'amended_hours',
        date_start: '2030-06-03',
        date_end: '2030-06-03',
        time_start: null,
        time_end: null,
        override_periods: [{ open: '10:00', close: '14:00' }],
      } as AvailabilityBlock,
    ];
    const blocks = buildVenueScheduleClosureBlocks({
      openingHours,
      venueWideBlocks,
      fromDate: '2030-06-03',
      toDate: '2030-06-03',
      columnIds: ['col-1'],
    });
    const amended = blocks.filter((b) => b.block_type === 'venue_amended_hours');
    expect(amended).toHaveLength(1);
    expect(amended[0]).toMatchObject({
      start_time: '10:00',
      end_time: '14:00',
    });
    const closed = blocks.filter((b) => b.block_type === 'venue_closed');
    expect(closed.some((b) => b.start_time === '09:00' && b.end_time === '10:00')).toBe(true);
    expect(closed.some((b) => b.start_time === '14:00' && b.end_time === '17:00')).toBe(true);
  });
});

describe('buildPractitionerScheduleClosureBlocks', () => {
  it('emits full-day practitioner_closed when not working', () => {
    const blocks = buildPractitionerScheduleClosureBlocks({
      practitioners: [
        {
          id: 'p1',
          is_active: true,
          working_hours: {},
          days_off: [],
          break_times: [],
          break_times_by_day: null,
        },
      ],
      leavePeriods: [],
      fromDate: '2030-06-03',
      toDate: '2030-06-03',
      openingHours: null,
    });
    expect(blocks.filter((b) => b.block_type === 'practitioner_closed').length).toBeGreaterThanOrEqual(1);
  });

  it('emits timed leave as practitioner_leave, not practitioner_closed', () => {
    const blocks = buildPractitionerScheduleClosureBlocks({
      practitioners: [
        {
          id: 'p1',
          is_active: true,
          working_hours: { '1': [{ start: '09:00', end: '17:00' }] },
          days_off: [],
          break_times: [],
          break_times_by_day: null,
        },
      ],
      leavePeriods: [
        {
          practitioner_id: 'p1',
          start_date: '2030-06-03',
          end_date: '2030-06-03',
          unavailable_start_time: '12:00',
          unavailable_end_time: '13:00',
        },
      ],
      fromDate: '2030-06-03',
      toDate: '2030-06-03',
      openingHours: null,
    });
    expect(
      blocks.some(
        (b) =>
          b.block_type === 'practitioner_leave' &&
          b.start_time === '12:00' &&
          b.end_time === '13:00',
      ),
    ).toBe(true);
    // The whole point of SA-M28: it must not come back as an ordinary closure.
    expect(
      blocks.some(
        (b) =>
          b.block_type === 'practitioner_closed' &&
          b.start_time === '12:00' &&
          b.end_time === '13:00',
      ),
    ).toBe(false);
  });

  it('does not fuse leave abutting the end of the working day into one block', () => {
    // The reported shape: 16:00-17:00 leave against a 17:00 close. These used to
    // merge into a single grey range, so "on annual leave" and "does not work
    // that afternoon" were the same block.
    const blocks = buildPractitionerScheduleClosureBlocks({
      practitioners: [
        {
          id: 'p1',
          is_active: true,
          working_hours: { '1': [{ start: '09:00', end: '17:00' }] },
          days_off: [],
          break_times: [],
          break_times_by_day: null,
        },
      ],
      leavePeriods: [
        {
          practitioner_id: 'p1',
          start_date: '2030-06-03',
          end_date: '2030-06-03',
          unavailable_start_time: '16:00',
          unavailable_end_time: '17:00',
        },
      ],
      fromDate: '2030-06-03',
      toDate: '2030-06-03',
      openingHours: null,
    });

    const leave = blocks.filter((b) => b.block_type === 'practitioner_leave');
    expect(leave).toHaveLength(1);
    expect(leave[0]!.start_time).toBe('16:00');
    expect(leave[0]!.end_time).toBe('17:00');

    // The after-hours closure still starts at 17:00 and did not swallow the leave.
    const closed = blocks.filter((b) => b.block_type === 'practitioner_closed');
    expect(closed.some((b) => b.start_time === '17:00')).toBe(true);
    expect(closed.some((b) => b.start_time === '16:00')).toBe(false);
  });

  it('emits full-day leave as practitioner_leave rather than an ordinary day off', () => {
    const blocks = buildPractitionerScheduleClosureBlocks({
      practitioners: [
        {
          id: 'p1',
          is_active: true,
          working_hours: { '1': [{ start: '09:00', end: '17:00' }] },
          days_off: [],
          break_times: [],
          break_times_by_day: null,
        },
      ],
      leavePeriods: [
        {
          practitioner_id: 'p1',
          start_date: '2030-06-03',
          end_date: '2030-06-03',
          unavailable_start_time: null,
          unavailable_end_time: null,
        },
      ],
      fromDate: '2030-06-03',
      toDate: '2030-06-03',
      openingHours: null,
    });
    expect(blocks.every((b) => b.block_type === 'practitioner_leave')).toBe(true);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
  });

  it('covers exactly the same minutes as before the leave split', () => {
    // Guards the one property that must not change: nothing that was greyed on
    // the diary stops being greyed. Only the type it carries is new.
    const params = {
      practitioners: [
        {
          id: 'p1',
          is_active: true,
          working_hours: { '1': [{ start: '09:00', end: '17:00' }] },
          days_off: [],
          break_times: [],
          break_times_by_day: null,
        },
      ],
      fromDate: '2030-06-03',
      toDate: '2030-06-03',
      openingHours: null,
    };
    const withoutLeave = buildPractitionerScheduleClosureBlocks({ ...params, leavePeriods: [] });
    const withLeave = buildPractitionerScheduleClosureBlocks({
      ...params,
      leavePeriods: [
        {
          practitioner_id: 'p1',
          start_date: '2030-06-03',
          end_date: '2030-06-03',
          unavailable_start_time: '12:00',
          unavailable_end_time: '13:00',
        },
      ],
    });

    const minutesCovered = (bs: { start_time: string; end_time: string }[]): Set<number> => {
      const set = new Set<number>();
      for (const b of bs) {
        const start = Number(b.start_time.slice(0, 2)) * 60 + Number(b.start_time.slice(3, 5));
        const end = Number(b.end_time.slice(0, 2)) * 60 + Number(b.end_time.slice(3, 5));
        for (let m = start; m < end; m++) set.add(m);
      }
      return set;
    };

    const before = minutesCovered(withoutLeave);
    const after = minutesCovered(withLeave);
    // Leave adds its own hour and takes nothing away.
    for (const m of before) expect(after.has(m)).toBe(true);
    expect(after.size).toBe(before.size + 60);
  });
});
