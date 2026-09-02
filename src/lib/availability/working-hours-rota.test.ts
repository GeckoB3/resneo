import { describe, expect, it } from 'vitest';
import {
  addDaysYmd,
  effectiveWorkingHoursForDate,
  isMondayYmd,
  mondayOnOrBefore,
  parseWorkingHoursRota,
  rotaCyclesForEndDate,
  rotaEndDateForCycles,
  rotaWeekIndexForDate,
  type WorkingHoursRota,
} from './working-hours-rota';

/** Monday 7 September 2026. */
const START = '2026-09-07';
const WEEK_A = { '1': [{ start: '09:00', end: '17:00' }], '2': [{ start: '09:00', end: '17:00' }], '6': [{ start: '09:00', end: '13:00' }] };
const WEEK_B = { '2': [{ start: '09:00', end: '21:00' }], '3': [{ start: '09:00', end: '21:00' }], '4': [{ start: '09:00', end: '21:00' }], '5': [{ start: '09:00', end: '21:00' }] };

const rota = (over: Partial<WorkingHoursRota> = {}): WorkingHoursRota => ({
  version: 1,
  cycle_start: START,
  weeks: [WEEK_A, WEEK_B],
  repeat_until: null,
  ...over,
});

describe('date helpers', () => {
  it('knows Mondays and finds the Monday of a week without a timezone', () => {
    expect(isMondayYmd('2026-09-07')).toBe(true);
    expect(isMondayYmd('2026-09-08')).toBe(false);
    expect(mondayOnOrBefore('2026-09-07')).toBe('2026-09-07');
    expect(mondayOnOrBefore('2026-09-10')).toBe('2026-09-07');
    expect(mondayOnOrBefore('2026-09-13')).toBe('2026-09-07'); // Sunday belongs to the week before
    expect(addDaysYmd('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('parseWorkingHoursRota', () => {
  it('accepts a valid record and normalises repeat_until to null', () => {
    const parsed = parseWorkingHoursRota({ version: 1, cycle_start: START, weeks: [WEEK_A, WEEK_B] });
    expect(parsed).toEqual(rota());
  });

  it('rejects anything malformed', () => {
    expect(parseWorkingHoursRota(null)).toBeNull();
    expect(parseWorkingHoursRota('x')).toBeNull();
    expect(parseWorkingHoursRota({ version: 2, cycle_start: START, weeks: [WEEK_A, WEEK_B] })).toBeNull();
    expect(parseWorkingHoursRota(rota({ cycle_start: '2026-09-08' }))).toBeNull(); // not a Monday
    expect(parseWorkingHoursRota(rota({ cycle_start: '2026-02-30' }))).toBeNull();
    expect(parseWorkingHoursRota(rota({ weeks: [WEEK_A] }))).toBeNull(); // too short
    expect(parseWorkingHoursRota(rota({ weeks: Array(7).fill(WEEK_A) }))).toBeNull(); // too long
    expect(parseWorkingHoursRota(rota({ weeks: [WEEK_A, { '9': [] }] }))).toBeNull(); // bad day key
    expect(parseWorkingHoursRota(rota({ weeks: [WEEK_A, { '1': [{ start: '9am', end: '17:00' }] }] }))).toBeNull();
    expect(parseWorkingHoursRota(rota({ repeat_until: '2026-09-06' }))).toBeNull(); // ends before it starts
  });
});

describe('rotaWeekIndexForDate', () => {
  it('counts whole weeks since the start, modulo the cycle length', () => {
    const r = rota();
    expect(rotaWeekIndexForDate(r, '2026-09-07')).toBe(0);
    expect(rotaWeekIndexForDate(r, '2026-09-13')).toBe(0); // Sunday of week 1
    expect(rotaWeekIndexForDate(r, '2026-09-14')).toBe(1);
    expect(rotaWeekIndexForDate(r, '2026-09-21')).toBe(0);
    expect(rotaWeekIndexForDate(r, '2026-10-01')).toBe(1);
  });

  it('is null before the start and after the end', () => {
    expect(rotaWeekIndexForDate(rota(), '2026-09-06')).toBeNull();
    const ending = rota({ repeat_until: '2026-09-20' });
    expect(rotaWeekIndexForDate(ending, '2026-09-20')).toBe(1);
    expect(rotaWeekIndexForDate(ending, '2026-09-21')).toBeNull();
  });
});

describe('effectiveWorkingHoursForDate', () => {
  const row = { working_hours: { '1': [{ start: '10:00', end: '12:00' }] }, working_hours_rota: rota({ repeat_until: '2026-09-20' }) };

  it('uses the rota week inside the window and the weekly hours outside it', () => {
    expect(effectiveWorkingHoursForDate(row, '2026-09-08')).toEqual(WEEK_A);
    expect(effectiveWorkingHoursForDate(row, '2026-09-15')).toEqual(WEEK_B);
    expect(effectiveWorkingHoursForDate(row, '2026-09-01')).toBe(row.working_hours);
    expect(effectiveWorkingHoursForDate(row, '2026-09-28')).toBe(row.working_hours);
  });

  it('ignores a malformed rota and an absent one', () => {
    expect(effectiveWorkingHoursForDate({ working_hours: row.working_hours, working_hours_rota: { version: 1 } }, '2026-09-08')).toBe(row.working_hours);
    expect(effectiveWorkingHoursForDate({ working_hours: null }, '2026-09-08')).toEqual({});
  });
});

describe('cycle arithmetic', () => {
  it('turns "for N cycles" into an inclusive end date and back', () => {
    expect(rotaEndDateForCycles(START, 2, 1)).toBe('2026-09-20');
    expect(rotaEndDateForCycles(START, 2, 6)).toBe('2026-11-29');
    expect(rotaCyclesForEndDate(rota({ repeat_until: '2026-11-29' }))).toBe(6);
    expect(rotaCyclesForEndDate(rota({ repeat_until: '2026-11-30' }))).toBeNull(); // mid-cycle
    expect(rotaCyclesForEndDate(rota())).toBeNull(); // until further notice
  });

  it('caps a runaway cycle count', () => {
    expect(rotaEndDateForCycles(START, 2, 10_000)).toBe(rotaEndDateForCycles(START, 2, 52));
  });
});
