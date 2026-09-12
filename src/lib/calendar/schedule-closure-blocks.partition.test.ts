import { describe, expect, it } from 'vitest';
import {
  calendarWorkingBoundsForDates,
  partitionScheduleClosureBlocks,
  scheduleClosureBlockLabel,
  type ScheduleClosureCalendarBlock,
} from '@/lib/calendar/schedule-closure-blocks';
import type { WorkingHours } from '@/types/booking-models';

function block(type: ScheduleClosureCalendarBlock['block_type'], start: string, end: string, col = 'c1'): ScheduleClosureCalendarBlock {
  return {
    id: `${type}:${start}`,
    practitioner_id: col,
    calendar_id: col,
    block_date: '2030-06-03',
    start_time: `${start}:00`,
    end_time: `${end}:00`,
    reason: null,
    block_type: type,
  };
}

describe('partitionScheduleClosureBlocks', () => {
  it('gives every minute exactly one explanation', () => {
    // Grid 07:00-21:00. Venue open 09:00-18:00, calendar works 08:00-20:00.
    const out = partitionScheduleClosureBlocks([
      block('venue_closed', '07:00', '09:00'),
      block('venue_closed', '18:00', '21:00'),
      block('practitioner_closed', '07:00', '08:00'),
      block('practitioner_closed', '20:00', '21:00'),
    ]);
    const rows = out.map((b) => [b.block_type, b.start_time.slice(0, 5), b.end_time.slice(0, 5)]).sort((a, b) => a[1]!.localeCompare(b[1]!));
    expect(rows).toEqual([
      ['venue_and_calendar_closed', '07:00', '08:00'],
      ['venue_closed', '08:00', '09:00'],
      ['venue_closed', '18:00', '20:00'],
      ['venue_and_calendar_closed', '20:00', '21:00'],
    ]);
  });
  it('keeps a calendar-only closure inside venue hours, and passes leave through', () => {
    const leave = block('practitioner_leave', '10:00', '11:00');
    const out = partitionScheduleClosureBlocks([
      block('practitioner_closed', '12:00', '13:00'),
      leave,
    ]);
    expect(out.map((b) => b.block_type).sort()).toEqual(['practitioner_closed', 'practitioner_leave']);
    expect(out.find((b) => b.block_type === 'practitioner_leave')).toBe(leave);
  });
  it('keeps columns apart', () => {
    const out = partitionScheduleClosureBlocks([
      block('venue_closed', '07:00', '09:00', 'a'),
      block('practitioner_closed', '07:00', '09:00', 'b'),
    ]);
    expect(out.map((b) => [b.calendar_id, b.block_type]).sort()).toEqual([
      ['a', 'venue_closed'],
      ['b', 'practitioner_closed'],
    ]);
  });
});

describe('scheduleClosureBlockLabel', () => {
  it('names the cause and the minutes', () => {
    expect(scheduleClosureBlockLabel('venue_closed', { startTime: '18:00:00', endTime: '20:00:00' })).toBe('Venue closed 18:00 to 20:00');
    expect(scheduleClosureBlockLabel('practitioner_closed', { columnName: 'Hannah', startTime: '08:00', endTime: '09:00' })).toBe('Hannah unavailable 08:00 to 09:00');
    expect(scheduleClosureBlockLabel('venue_and_calendar_closed', { columnName: 'Hannah', startTime: '07:00', endTime: '08:00' })).toBe('Hannah closed 07:00 to 08:00');
    expect(scheduleClosureBlockLabel('venue_and_calendar_closed', { startTime: '07:00', endTime: '08:00' })).toBe('Calendar closed 07:00 to 08:00');
    expect(scheduleClosureBlockLabel('practitioner_leave')).toBe('On leave');
    expect(scheduleClosureBlockLabel('practitioner_closed')).toBe('Calendar unavailable');
  });

  it("reads a calendar closure's Label (R36: it used to say On leave whatever was chosen)", () => {
    const leave = (leaveType: string | null) =>
      scheduleClosureBlockLabel('practitioner_leave', { startTime: '09:00', endTime: '22:00', leaveType });
    expect(leave('annual')).toBe('Closed 09:00 to 22:00');
    expect(leave('sick')).toBe('Unavailable 09:00 to 22:00');
    expect(leave('other')).toBe('On leave 09:00 to 22:00');
    expect(leave(null)).toBe('On leave 09:00 to 22:00');
    // The Label belongs to closures only.
    expect(scheduleClosureBlockLabel('venue_closed', { startTime: '09:00', endTime: '10:00', leaveType: 'annual' })).toBe(
      'Venue closed 09:00 to 10:00',
    );
  });
});

describe('calendarWorkingBoundsForDates', () => {
  const wh = (start: string, end: string): WorkingHours =>
    Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map((d) => [d, [{ start, end }]])) as WorkingHours;
  it('unions the widest hours across active calendars', () => {
    const bounds = calendarWorkingBoundsForDates(
      [
        { id: 'a', is_active: true, working_hours: wh('08:00', '17:00') },
        { id: 'b', is_active: true, working_hours: wh('10:00', '20:00') },
        { id: 'c', is_active: false, working_hours: wh('06:00', '23:00') },
      ],
      '2030-06-03',
      '2030-06-03',
    );
    expect(bounds).toEqual({ start: 8 * 60, end: 20 * 60 });
  });
  it('returns null when nobody works', () => {
    expect(calendarWorkingBoundsForDates([{ id: 'a', is_active: true, working_hours: {} as WorkingHours }], '2030-06-03', '2030-06-03')).toBeNull();
  });
});
