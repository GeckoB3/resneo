import { describe, expect, it } from 'vitest';
import { calendarAvailableRangesOnDate, calendarHasAvailableHoursOnDate, calendarWorksOnDate } from './calendar-works-on-date';
import { buildLinkedColumnClosureBlocks } from './schedule-closure-blocks';
import type { AvailabilityBlock } from '@/types/availability';
import type { Practitioner } from '@/types/booking-models';

const TZ = 'Europe/London';
// 2026-09-10 is a Thursday; 2026-09-13 a Sunday.
const THU = '2026-09-10';
const SUN = '2026-09-13';

describe('calendarWorksOnDate (weekly template only)', () => {
  it('reads numeric and legacy weekday keys', () => {
    expect(calendarWorksOnDate({ working_hours: { '4': [{ start: '09:00', end: '17:00' }] } }, THU, TZ)).toBe(true);
    expect(calendarWorksOnDate({ working_hours: { thu: [{ start: '09:00', end: '17:00' }] } }, THU, TZ)).toBe(true);
    expect(calendarWorksOnDate({ working_hours: { '4': [{ start: '09:00', end: '17:00' }] } }, SUN, TZ)).toBe(false);
  });

  it('treats no hours, an empty list, or blank ranges as not working', () => {
    expect(calendarWorksOnDate({ working_hours: {} }, THU, TZ)).toBe(false);
    expect(calendarWorksOnDate({ working_hours: { '4': [] } }, THU, TZ)).toBe(false);
    expect(calendarWorksOnDate({ working_hours: { '4': [{ start: '', end: '' }] } }, THU, TZ)).toBe(false);
  });

  it('honours a day off on that date', () => {
    const row = { working_hours: { '4': [{ start: '09:00', end: '17:00' }] }, days_off: [THU] };
    expect(calendarWorksOnDate(row, THU, TZ)).toBe(false);
    expect(calendarWorksOnDate({ ...row, days_off: ['2026-09-11'] }, THU, TZ)).toBe(true);
  });

  it('follows a schedule period that covers the date', () => {
    const row = {
      working_hours: { '4': [{ start: '09:00', end: '17:00' }] },
      schedule_periods: {
        version: 1,
        periods: [
          {
            id: 'p1',
            from: '2026-09-07',
            until: null,
            cycle_start: '2026-09-07',
            weeks: [{ '0': [{ start: '10:00', end: '14:00' }] }],
          },
        ],
      },
    };
    // The period's week has Sunday hours only, so Thursday is now off and Sunday on.
    expect(calendarWorksOnDate(row, THU, TZ)).toBe(false);
    expect(calendarWorksOnDate(row, SUN, TZ)).toBe(true);
  });
});

function practitioner(over: Partial<Practitioner> = {}): Practitioner {
  return {
    id: 'cal-1',
    name: 'Sarah',
    is_active: true,
    working_hours: { '4': [{ start: '09:00', end: '17:00' }] },
    days_off: [],
    ...over,
  } as unknown as Practitioner;
}

function closedDay(date: string, times: { start: string; end: string } | null = null): AvailabilityBlock {
  return {
    id: `blk-${date}`,
    venue_id: 'venue-1',
    service_id: null,
    block_type: 'closed',
    date_start: date,
    date_end: date,
    time_start: times?.start ?? null,
    time_end: times?.end ?? null,
    override_max_covers: null,
    reason: null,
  };
}

describe('calendarHasAvailableHoursOnDate (own columns)', () => {
  const base = { dateYmd: THU, leavePeriods: [], openingHours: null, venueWideBlocks: [] };

  it('is true on an ordinary working day and false on a day with no hours', () => {
    expect(calendarHasAvailableHoursOnDate({ ...base, practitioner: practitioner() })).toBe(true);
    expect(calendarHasAvailableHoursOnDate({ ...base, practitioner: practitioner(), dateYmd: SUN })).toBe(false);
    expect(calendarHasAvailableHoursOnDate({ ...base, practitioner: practitioner({ days_off: [THU] }) })).toBe(false);
  });

  /** The reported case: a calendar marked on leave all day still has template hours. */
  it('is false when the calendar is on leave for the whole day', () => {
    const leavePeriods = [{ practitioner_id: 'cal-1', start_date: '2026-09-09', end_date: '2026-09-11' }];
    expect(calendarHasAvailableHoursOnDate({ ...base, practitioner: practitioner(), leavePeriods })).toBe(false);
    // Someone else's leave does not touch this calendar.
    expect(
      calendarHasAvailableHoursOnDate({
        ...base,
        practitioner: practitioner(),
        leavePeriods: [{ ...leavePeriods[0]!, practitioner_id: 'cal-2' }],
      }),
    ).toBe(true);
  });

  it('subtracts partial leave, and is false once leave covers every working minute', () => {
    const morningOff = [
      {
        practitioner_id: 'cal-1',
        start_date: THU,
        end_date: THU,
        unavailable_start_time: '09:00',
        unavailable_end_time: '13:00',
      },
    ];
    expect(calendarHasAvailableHoursOnDate({ ...base, practitioner: practitioner(), leavePeriods: morningOff })).toBe(true);
    const wholeShift = [{ ...morningOff[0]!, unavailable_end_time: '17:00' }];
    expect(calendarHasAvailableHoursOnDate({ ...base, practitioner: practitioner(), leavePeriods: wholeShift })).toBe(false);
  });

  it('is false when the venue is closed all day, and true when a closure leaves some hours', () => {
    expect(
      calendarHasAvailableHoursOnDate({ ...base, practitioner: practitioner(), venueWideBlocks: [closedDay(THU)] }),
    ).toBe(false);
    expect(
      calendarHasAvailableHoursOnDate({
        ...base,
        practitioner: practitioner(),
        venueWideBlocks: [closedDay(THU, { start: '09:00', end: '12:00' })],
      }),
    ).toBe(true);
    expect(
      calendarHasAvailableHoursOnDate({
        ...base,
        practitioner: practitioner(),
        venueWideBlocks: [closedDay(THU, { start: '08:00', end: '18:00' })],
      }),
    ).toBe(false);
  });
});

/**
 * SB-39: a linked column used the owner's weekly template alone, so a host saw a partner calendar
 * open on a day that business was closed, or that person was on leave. The ranges below are what
 * the header line, the closed stripes and the working-hours filter now read.
 */
describe('calendarAvailableRangesOnDate (linked columns)', () => {
  const base = { dateYmd: THU, leavePeriods: [], openingHours: null, venueWideBlocks: [] };
  const H = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

  it('returns the working hours on an ordinary day', () => {
    expect(calendarAvailableRangesOnDate({ ...base, practitioner: practitioner() })).toEqual([
      { start: H('09:00'), end: H('17:00') },
    ]);
  });

  it("is empty on a day the owner venue is closed, though the template has hours", () => {
    expect(
      calendarAvailableRangesOnDate({ ...base, practitioner: practitioner(), venueWideBlocks: [closedDay(THU)] }),
    ).toEqual([]);
  });

  it('removes partial leave and follows a per-date amended hours override', () => {
    const leavePeriods = [
      { practitioner_id: 'cal-1', start_date: THU, end_date: THU, unavailable_start_time: '09:00', unavailable_end_time: '12:00' },
    ];
    expect(calendarAvailableRangesOnDate({ ...base, practitioner: practitioner(), leavePeriods })).toEqual([
      { start: H('12:00'), end: H('17:00') },
    ]);
    const amended = practitioner({
      availability_exceptions: { [THU]: { periods: [{ start: '10:00', end: '14:00' }] } },
    } as unknown as Partial<Practitioner>);
    expect(calendarAvailableRangesOnDate({ ...base, practitioner: amended })).toEqual([
      { start: H('10:00'), end: H('14:00') },
    ]);
  });

  it('draws the whole grid closed for a linked column with no open minutes', () => {
    const blocks = buildLinkedColumnClosureBlocks({
      columnId: 'col',
      workingHours: { '4': [{ start: '09:00', end: '17:00' }] },
      openRanges: [],
      dateYmd: THU,
      timeZone: TZ,
      gridStartHour: 8,
      gridEndHour: 20,
    });
    expect(blocks.map((b) => [b.start_time, b.end_time])).toEqual([['08:00', '20:00']]);
  });
});
