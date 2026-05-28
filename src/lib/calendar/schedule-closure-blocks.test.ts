import { describe, expect, it } from 'vitest';
import {
  buildPractitionerScheduleClosureBlocks,
  buildVenueScheduleClosureBlocks,
  closedRangesFromOpenWindows,
} from '@/lib/calendar/schedule-closure-blocks';
import type { AvailabilityBlock, OpeningHours } from '@/types/availability';

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

  it('emits partial practitioner_closed for timed leave', () => {
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
          b.block_type === 'practitioner_closed' &&
          b.start_time === '12:00' &&
          b.end_time === '13:00',
      ),
    ).toBe(true);
  });
});
