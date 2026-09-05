import { describe, expect, it } from 'vitest';
import {
  pruneEndedSchedulePeriods,
  addDaysYmd,
  effectiveWorkingHoursForDate,
  insertSchedulePeriod,
  isMondayYmd,
  legacyRotaToSchedule,
  mondayOnOrBefore,
  parseCalendarSchedule,
  parseWorkingHoursRota,
  periodCyclesForEnd,
  periodEndForCycles,
  removeSchedulePeriod,
  resolveScheduleForDate,
  scheduleForRow,
  sundayOnOrAfter,
  validateCalendarSchedule,
  weekIndexInPeriod,
  type CalendarSchedule,
  type SchedulePeriod,
} from './working-hours-rota';

/** Monday 7 September 2026. */
const START = '2026-09-07';
const WEEK_A = { '1': [{ start: '09:00', end: '17:00' }], '2': [{ start: '09:00', end: '17:00' }], '6': [{ start: '09:00', end: '13:00' }] };
const WEEK_B = { '2': [{ start: '09:00', end: '21:00' }], '3': [{ start: '09:00', end: '21:00' }], '4': [{ start: '09:00', end: '21:00' }], '5': [{ start: '09:00', end: '21:00' }] };
const WEEK_C = { '1': [{ start: '10:00', end: '14:00' }] };

const period = (over: Partial<SchedulePeriod> = {}): SchedulePeriod => ({
  id: 'p1',
  from: START,
  until: null,
  cycle_start: START,
  weeks: [WEEK_A, WEEK_B],
  ...over,
});
const schedule = (...periods: SchedulePeriod[]): CalendarSchedule => ({ version: 1, periods });
let counter = 0;
const newId = () => `new-${++counter}`;

describe('date helpers', () => {
  it('finds week boundaries without a timezone', () => {
    expect(isMondayYmd('2026-09-07')).toBe(true);
    expect(mondayOnOrBefore('2026-09-13')).toBe('2026-09-07');
    expect(sundayOnOrAfter('2026-09-07')).toBe('2026-09-13');
    expect(sundayOnOrAfter('2026-09-13')).toBe('2026-09-13');
    expect(addDaysYmd('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('validateCalendarSchedule', () => {
  it('accepts a sorted, non-overlapping timeline and defaults cycle_start', () => {
    const out = validateCalendarSchedule({
      version: 1,
      periods: [
        { id: 'b', from: '2026-10-05', until: null, weeks: [WEEK_C] },
        { id: 'a', from: START, until: '2026-10-04', weeks: [WEEK_A, WEEK_B] },
      ],
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.schedule.periods.map((p) => p.id)).toEqual(['a', 'b']);
      expect(out.schedule.periods[1]!.cycle_start).toBe('2026-10-05');
    }
  });

  it('names what is wrong', () => {
    const bad = (p: Record<string, unknown>) => validateCalendarSchedule({ version: 1, periods: [p] });
    expect(bad({ id: 'x', from: '2026-09-08', until: null, weeks: [WEEK_A] })).toMatchObject({ ok: false, error: /start on a Monday/ });
    expect(bad({ id: 'x', from: START, until: '2026-09-12', weeks: [WEEK_A] })).toMatchObject({ ok: false, error: /end on a Sunday/ });
    expect(bad({ id: 'x', from: START, until: '2026-08-30', weeks: [WEEK_A] })).toMatchObject({ ok: false, error: /end on or after/ });
    expect(bad({ id: 'x', from: START, until: null, weeks: [] })).toMatchObject({ ok: false, error: /1 to 6 weeks/ });
    expect(bad({ id: 'x', from: START, until: null, cycle_start: '2026-09-14', weeks: [WEEK_A] })).toMatchObject({ ok: false, error: /cycle start/ });
    expect(
      validateCalendarSchedule({
        version: 1,
        periods: [
          { id: 'a', from: START, until: null, weeks: [WEEK_A] },
          { id: 'b', from: '2026-10-05', until: null, weeks: [WEEK_C] },
        ],
      }),
    ).toMatchObject({ ok: false, error: /must not overlap/ });
    expect(validateCalendarSchedule({ version: 2, periods: [] })).toMatchObject({ ok: false });
    expect(parseCalendarSchedule('garbage')).toBeNull();
  });
});

describe('resolution', () => {
  const row = {
    working_hours: { '1': [{ start: '10:00', end: '12:00' }] },
    schedule_periods: schedule(
      period({ id: 'rota', until: '2026-10-04' }),
      period({ id: 'later', from: '2026-11-02', cycle_start: '2026-11-02', weeks: [WEEK_C] }),
    ),
  };

  it('uses the covering period and its week, and the base hours in the gaps', () => {
    expect(resolveScheduleForDate(row, '2026-09-08')).toMatchObject({ hours: WEEK_A, source: { kind: 'period', periodIndex: 0, weekIndex: 0 } });
    expect(resolveScheduleForDate(row, '2026-09-15')).toMatchObject({ hours: WEEK_B, source: { weekIndex: 1 } });
    expect(resolveScheduleForDate(row, '2026-10-04')).toMatchObject({ hours: WEEK_B });
    expect(resolveScheduleForDate(row, '2026-10-05')).toMatchObject({ hours: row.working_hours, source: { kind: 'base' } });
    expect(resolveScheduleForDate(row, '2026-11-02')).toMatchObject({ hours: WEEK_C, source: { periodIndex: 1, weekIndex: 0 } });
    expect(effectiveWorkingHoursForDate(row, '2026-09-01')).toEqual(row.working_hours);
  });

  it('keeps a rota\'s rhythm after a split through cycle_start', () => {
    const right = period({ id: 'right', from: '2026-09-21', cycle_start: START });
    expect(weekIndexInPeriod(right, '2026-09-21')).toBe(0);
    expect(weekIndexInPeriod(right, '2026-09-28')).toBe(1);
  });

  it('falls back to the older single rota only while schedule_periods is null', () => {
    const rota = { version: 1, cycle_start: START, weeks: [WEEK_A, WEEK_B], repeat_until: '2026-09-30' };
    expect(parseWorkingHoursRota(rota)).not.toBeNull();
    expect(legacyRotaToSchedule(parseWorkingHoursRota(rota)!).periods[0]!.until).toBe('2026-10-04');
    expect(scheduleForRow({ working_hours_rota: rota })?.periods[0]!.weeks).toEqual([WEEK_A, WEEK_B]);
    expect(scheduleForRow({ schedule_periods: schedule(period({ weeks: [WEEK_C] })), working_hours_rota: rota })?.periods[0]!.weeks).toEqual([WEEK_C]);
    expect(scheduleForRow({ schedule_periods: 'garbage', working_hours_rota: rota })).toBeNull();
  });
});

describe('insertSchedulePeriod', () => {
  it('removes a period the new one swallows, and keeps the rest', () => {
    const existing = schedule(period({ id: 'inner', from: '2026-09-14', until: '2026-09-27', weeks: [WEEK_C] }), period({ id: 'far', from: '2027-01-04', until: null, weeks: [WEEK_C] }));
    const { schedule: out, trims } = insertSchedulePeriod(existing, period({ id: 'new', until: '2026-10-04' }), newId);
    expect(trims).toEqual([{ id: 'inner', kind: 'removed' }]);
    expect(out.periods.map((p) => p.id)).toEqual(['new', 'far']);
  });

  it('shortens a period that starts before, and starts later a period that ends after', () => {
    const existing = schedule(
      period({ id: 'before', from: '2026-08-31', cycle_start: '2026-08-31', until: '2026-09-20', weeks: [WEEK_C] }),
      period({ id: 'after', from: '2026-09-28', cycle_start: '2026-09-28', until: null, weeks: [WEEK_C] }),
    );
    const { schedule: out, trims } = insertSchedulePeriod(existing, period({ id: 'new', from: '2026-09-14', until: '2026-10-04', cycle_start: '2026-09-14' }), newId);
    expect(trims).toEqual([
      { id: 'before', kind: 'shortened', until: '2026-09-13' },
      { id: 'after', kind: 'starts_later', from: '2026-10-05' },
    ]);
    expect(out.periods.map((p) => [p.id, p.from, p.until])).toEqual([
      ['before', '2026-08-31', '2026-09-13'],
      ['new', '2026-09-14', '2026-10-04'],
      ['after', '2026-10-05', null],
    ]);
    expect(validateCalendarSchedule(out).ok).toBe(true);
  });

  it('splits an open-ended rota around the new period without changing its rhythm', () => {
    const existing = schedule(period({ id: 'rota' }));
    const { schedule: out, trims } = insertSchedulePeriod(existing, period({ id: 'new', from: '2026-09-21', until: '2026-10-04', cycle_start: '2026-09-21', weeks: [WEEK_C] }), newId);
    expect(trims).toHaveLength(1);
    expect(trims[0]).toMatchObject({ id: 'rota', kind: 'split', until: '2026-09-20', resumesFrom: '2026-10-05' });
    const right = out.periods[2]!;
    expect(right.cycle_start).toBe(START);
    expect(right.from).toBe('2026-10-05');
    // 2026-10-05 is four weeks after the cycle start: week index 0, exactly as before the split.
    expect(weekIndexInPeriod(right, '2026-10-05')).toBe(0);
    expect(validateCalendarSchedule(out).ok).toBe(true);
  });

  it('replaces a period being edited rather than overlapping itself', () => {
    const existing = schedule(period({ id: 'p1', until: '2026-10-04' }));
    const { schedule: out, trims } = insertSchedulePeriod(existing, period({ id: 'p1', until: '2026-10-18' }), newId);
    expect(trims).toEqual([]);
    expect(out.periods).toHaveLength(1);
    expect(out.periods[0]!.until).toBe('2026-10-18');
  });

  it('removes a period and returns null when none remain', () => {
    expect(removeSchedulePeriod(schedule(period()), 'p1')).toBeNull();
    expect(removeSchedulePeriod(schedule(period(), period({ id: 'p2', from: '2027-01-04', cycle_start: '2027-01-04' })), 'p1')?.periods.map((p) => p.id)).toEqual(['p2']);
  });
});

describe('cycle arithmetic', () => {
  it('turns "for N cycles" into an inclusive Sunday and back', () => {
    expect(periodEndForCycles(START, 2, 1)).toBe('2026-09-20');
    expect(periodEndForCycles(START, 2, 6)).toBe('2026-11-29');
    expect(periodEndForCycles(START, 1, 3)).toBe('2026-09-27');
    expect(periodCyclesForEnd({ from: START, until: '2026-11-29', weeks: [WEEK_A, WEEK_B] })).toBe(6);
    expect(periodCyclesForEnd({ from: START, until: '2026-12-06', weeks: [WEEK_A, WEEK_B] })).toBeNull();
    expect(periodCyclesForEnd({ from: START, until: null, weeks: [WEEK_A] })).toBeNull();
    expect(periodEndForCycles(START, 2, 10_000)).toBe(periodEndForCycles(START, 2, 52));
  });
});

describe('pruneEndedSchedulePeriods', () => {
  const week = (from: string, id: string): SchedulePeriod => ({ id, from, until: addDaysYmd(from, 6), cycle_start: from, weeks: [{}] });
  const today = '2026-09-04';

  it('leaves a timeline within the cap alone', () => {
    const schedule: CalendarSchedule = { version: 1, periods: [week('2026-08-03', 'a'), week('2026-09-07', 'b')] };
    expect(pruneEndedSchedulePeriods(schedule, today, 2)).toEqual({ schedule, removed: [] });
  });

  it('drops the changes that ended longest ago first, and never a current or upcoming one', () => {
    const schedule: CalendarSchedule = {
      version: 1,
      periods: [week('2026-08-03', 'oldest'), week('2026-08-17', 'older'), week('2026-08-31', 'current'), week('2026-09-14', 'next')],
    };
    const out = pruneEndedSchedulePeriods(schedule, today, 3);
    expect(out.removed.map((p) => p.id)).toEqual(['oldest']);
    expect(out.schedule.periods.map((p) => p.id)).toEqual(['older', 'current', 'next']);
    // Only ended changes can go: a cap below the number of live ones is left for the validator.
    const tight = pruneEndedSchedulePeriods(schedule, today, 1);
    expect(tight.schedule.periods.map((p) => p.id)).toEqual(['current', 'next']);
  });
});
