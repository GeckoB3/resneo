import { describe, expect, it } from 'vitest';
import {
  datedCalendarHoursOutsideVenue,
  describeCalendarWeeklyMismatch,
  describeDatedMismatch,
  describeVenueWeeklyMismatch,
  weeklyCalendarHoursOutsideVenue,
} from './hours-mismatch';
import type { OpeningHours } from '@/types/availability';
import type { WorkingHours } from '@/types/booking-models';

const venue9to18: OpeningHours = Object.fromEntries(
  ['1', '2', '3', '4', '5'].map((d) => [d, { periods: [{ open: '09:00', close: '18:00' }] }]),
);
const wh = (start: string, end: string, days = ['1', '2', '3', '4', '5']): WorkingHours =>
  Object.fromEntries(days.map((d) => [d, [{ start, end }]])) as WorkingHours;

describe('weekly comparison', () => {
  it('finds the days a calendar runs past the venue', () => {
    const m = weeklyCalendarHoursOutsideVenue(wh('08:00', '20:00', ['1', '4']), venue9to18);
    expect(m.map((x) => x.dayName)).toEqual(['Monday', 'Thursday']);
    expect(describeCalendarWeeklyMismatch('Hannah', m)).toContain("Hannah's hours on Monday and Thursday run outside your business hours");
    expect(describeCalendarWeeklyMismatch('Hannah', m)).toContain('widen your business hours for those days too');
  });
  it('is quiet when the calendar fits, or the venue has no hours', () => {
    expect(weeklyCalendarHoursOutsideVenue(wh('10:00', '17:00'), venue9to18)).toEqual([]);
    expect(weeklyCalendarHoursOutsideVenue(wh('06:00', '23:00'), null)).toEqual([]);
    expect(describeCalendarWeeklyMismatch('Hannah', [])).toBeNull();
  });
  it('tells the venue which calendars its new hours leave outside', () => {
    const text = describeVenueWeeklyMismatch(
      [
        { id: 'a', name: 'Hannah', working_hours: wh('08:00', '20:00') },
        { id: 'b', name: 'Room 1', calendar_type: 'resource', working_hours: wh('06:00', '23:00') },
        { id: 'c', name: 'Sam', working_hours: wh('10:00', '16:00') },
      ],
      venue9to18,
    );
    expect(text).toContain('narrower than the calendar hours of Hannah (Monday 08:00 to 20:00, and 4 more days)');
    expect(text).not.toContain('Room 1');
    expect(text).not.toContain('Sam');
  });
});

describe('dated comparison', () => {
  const hannah = { id: 'a', name: 'Hannah', is_active: true, working_hours: wh('08:00', '20:00') };
  it('flags a closure on a day the calendar works', () => {
    const m = datedCalendarHoursOutsideVenue(
      [hannah],
      venue9to18,
      [{ id: 'x', venue_id: 'v', service_id: null, block_type: 'closed', date_start: '2030-06-03', date_end: '2030-06-03', time_start: null, time_end: null, override_max_covers: null, reason: null }],
      '2030-06-03',
      '2030-06-03',
    );
    expect(m).toHaveLength(1);
    expect(m[0]!.venueHours).toBe('closed');
    expect(describeDatedMismatch(m)).toContain('Hannah is still scheduled to work outside these hours');
    expect(describeDatedMismatch(m)).toContain('the venue is closed on Mon 3 Jun');
  });
  it('flags amended hours narrower than the calendar', () => {
    const m = datedCalendarHoursOutsideVenue(
      [hannah],
      venue9to18,
      [{ id: 'x', venue_id: 'v', service_id: null, block_type: 'amended_hours', date_start: '2030-06-04', date_end: '2030-06-04', time_start: null, time_end: null, override_max_covers: null, reason: null, override_periods: [{ open: '10:00', close: '14:00' }] }],
      '2030-06-04',
      '2030-06-04',
    );
    expect(m[0]!.venueHours).toBe('10:00 to 14:00');
    expect(m[0]!.calendarHours).toBe('08:00 to 20:00');
  });
  it('is quiet on a day the calendar does not work', () => {
    const m = datedCalendarHoursOutsideVenue(
      [hannah],
      venue9to18,
      [{ id: 'x', venue_id: 'v', service_id: null, block_type: 'closed', date_start: '2030-06-01', date_end: '2030-06-01', time_start: null, time_end: null, override_max_covers: null, reason: null }],
      '2030-06-01',
      '2030-06-01',
    );
    expect(m).toEqual([]);
  });
});
