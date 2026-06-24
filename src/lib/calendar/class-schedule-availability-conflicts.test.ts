import { describe, expect, it } from 'vitest';
import type { AvailabilityBlock, OpeningHours } from '@/types/availability';
import { getDayOfWeek } from '@/lib/availability';
import {
  evaluateClassWindowAvailabilityConflict,
  classCalendarBreakRanges,
  formatScheduleDate,
  withScheduleDateContext,
  type ClassWindowAvailabilityData,
} from '@/lib/calendar/class-schedule-availability-conflicts';

const DATE = '2026-07-06'; // a Monday

function mins(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
}

function baseData(overrides: Partial<ClassWindowAvailabilityData> = {}): ClassWindowAvailabilityData {
  return {
    date: DATE,
    startMin: mins('19:00'),
    endMin: mins('20:00'),
    calendarName: 'Studio A',
    openingHours: null,
    venueWideBlocks: [],
    leavePeriods: [],
    daysOff: [],
    breakTimes: null,
    breakTimesByDay: null,
    blockedRanges: [],
    ...overrides,
  };
}

function block(partial: Partial<AvailabilityBlock>): AvailabilityBlock {
  return {
    id: 'b1',
    venue_id: 'v1',
    service_id: null,
    block_type: 'closed',
    date_start: DATE,
    date_end: DATE,
    time_start: null,
    time_end: null,
    override_max_covers: null,
    reason: null,
    yield_overrides: null,
    override_periods: null,
    ...partial,
  } as AvailabilityBlock;
}

describe('formatScheduleDate', () => {
  it('formats YYYY-MM-DD as "Wkd D Mon YYYY"', () => {
    expect(formatScheduleDate('2026-07-06')).toBe('Mon 6 Jul 2026');
    expect(formatScheduleDate('2026-12-25')).toBe('Fri 25 Dec 2026');
  });
  it('returns the raw value when not a date', () => {
    expect(formatScheduleDate('nonsense')).toBe('nonsense');
  });
});

describe('withScheduleDateContext', () => {
  it('appends date and time, stripping a trailing period', () => {
    expect(
      withScheduleDateContext('This time overlaps a class session on this calendar.', DATE, '09:00'),
    ).toBe('This time overlaps a class session on this calendar (Mon 6 Jul 2026 at 09:00).');
  });
});

describe('classCalendarBreakRanges', () => {
  it('reads the by-day map keyed by weekday name', () => {
    const dayName = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][getDayOfWeek(DATE)]!;
    const ranges = classCalendarBreakRanges(null, { [dayName]: [{ start: '12:00', end: '13:00' }] }, DATE);
    expect(ranges).toEqual([{ start: 720, end: 780 }]);
  });
  it('falls back to the flat break_times list', () => {
    const ranges = classCalendarBreakRanges([{ start: '13:00', end: '13:30' }], null, DATE);
    expect(ranges).toEqual([{ start: 780, end: 810 }]);
  });
});

describe('evaluateClassWindowAvailabilityConflict', () => {
  it('allows an evening class on an open day with no closures (classes are not bound by weekly hours)', () => {
    const data = baseData({
      // Weekly hours 09:00–17:00 but a 19:00 class is still allowed because there is no date-specific block.
      openingHours: { '1': [{ open: '09:00', close: '17:00' }], mon: [{ open: '09:00', close: '17:00' }] } as unknown as OpeningHours,
    });
    expect(evaluateClassWindowAvailabilityConflict(data)).toBeNull();
  });

  it('rejects an end time at or before the start', () => {
    expect(
      evaluateClassWindowAvailabilityConflict(baseData({ startMin: mins('19:00'), endMin: mins('19:00') })),
    ).toMatch(/after start/i);
  });

  // --- Venue-wide business closure ---
  it('blocks a full-day venue closure', () => {
    const data = baseData({ venueWideBlocks: [block({ block_type: 'closed' })] });
    expect(evaluateClassWindowAvailabilityConflict(data)).toMatch(/venue is closed/i);
  });

  it('blocks when amended venue hours do not cover the class window', () => {
    const data = baseData({
      startMin: mins('09:00'),
      endMin: mins('10:00'),
      venueWideBlocks: [block({ block_type: 'amended_hours', override_periods: [{ open: '11:00', close: '14:00' }] })],
    });
    expect(evaluateClassWindowAvailabilityConflict(data)).toMatch(/venue closure|amended hours/i);
  });

  it('allows when amended venue hours cover the class window', () => {
    const data = baseData({
      startMin: mins('11:30'),
      endMin: mins('12:30'),
      venueWideBlocks: [block({ block_type: 'amended_hours', override_periods: [{ open: '11:00', close: '14:00' }] })],
    });
    expect(evaluateClassWindowAvailabilityConflict(data)).toBeNull();
  });

  // --- Calendar closure (leave) ---
  it('blocks a full-day staff leave', () => {
    const data = baseData({ leavePeriods: [{ unavailable_start_time: null, unavailable_end_time: null }] });
    expect(evaluateClassWindowAvailabilityConflict(data)).toMatch(/on leave .*all day/i);
  });

  it('blocks a partial leave window that overlaps', () => {
    const data = baseData({
      startMin: mins('12:30'),
      endMin: mins('13:30'),
      leavePeriods: [{ unavailable_start_time: '12:00:00', unavailable_end_time: '13:00:00' }],
    });
    expect(evaluateClassWindowAvailabilityConflict(data)).toMatch(/on leave from 12:00 to 13:00/i);
  });

  it('allows when a partial leave window does not overlap', () => {
    const data = baseData({
      startMin: mins('15:00'),
      endMin: mins('16:00'),
      leavePeriods: [{ unavailable_start_time: '12:00:00', unavailable_end_time: '13:00:00' }],
    });
    expect(evaluateClassWindowAvailabilityConflict(data)).toBeNull();
  });

  // --- Calendar closure (days_off) ---
  it('blocks when the exact date is listed in days_off', () => {
    expect(evaluateClassWindowAvailabilityConflict(baseData({ daysOff: [DATE] }))).toMatch(/day off/i);
  });

  it('ignores recurring weekday-name days_off (classes are explicitly scheduled)', () => {
    expect(evaluateClassWindowAvailabilityConflict(baseData({ daysOff: ['mon'] }))).toBeNull();
  });

  // --- Break ---
  it('blocks a class window that overlaps a break', () => {
    const data = baseData({
      startMin: mins('13:30'),
      endMin: mins('14:30'),
      breakTimes: [{ start: '13:00', end: '14:00' }],
    });
    expect(evaluateClassWindowAvailabilityConflict(data)).toMatch(/overlaps a break \(13:00–14:00\)/);
  });

  // --- Legacy blocked time ---
  it('blocks a class window that overlaps a calendar block, naming the reason', () => {
    const data = baseData({
      startMin: mins('15:30'),
      endMin: mins('16:00'),
      blockedRanges: [{ start_time: '15:00:00', end_time: '16:00:00', reason: 'Maintenance' }],
    });
    expect(evaluateClassWindowAvailabilityConflict(data)).toMatch(/blocked time \(Maintenance\)/);
  });

  it('reports the calendar name and date in the message', () => {
    const msg = evaluateClassWindowAvailabilityConflict(baseData({ daysOff: [DATE], calendarName: 'Otto' }));
    expect(msg).toContain('Otto');
    expect(msg).toContain('Mon 6 Jul 2026');
  });
});
