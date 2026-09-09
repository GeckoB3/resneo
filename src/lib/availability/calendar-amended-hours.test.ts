import { describe, expect, it } from 'vitest';
import {
  amendedHoursEntries,
  applyAmendedHours,
  firstFullDayLeaveDate,
  hoursOverrideMirrorRows,
  normaliseHoursPeriods,
  readOverrideMap,
  removeDateOverrides,
} from './calendar-amended-hours';

const NINE_TO_FIVE = [{ start: '09:00', end: '17:00' }];

describe('normaliseHoursPeriods', () => {
  it('sorts, merges and trims to HH:mm', () => {
    const out = normaliseHoursPeriods([
      { start: '15:00:00', end: '18:00:00' },
      { start: '09:00', end: '12:00' },
      { start: '11:30', end: '13:00' },
    ]);
    expect(out).toEqual({ ok: true, periods: [{ start: '09:00', end: '13:00' }, { start: '15:00', end: '18:00' }] });
  });

  it('refuses an empty list, a bad time, and a period that ends before it starts', () => {
    expect(normaliseHoursPeriods([])).toMatchObject({ ok: false });
    expect(normaliseHoursPeriods([{ start: '9am', end: '17:00' }])).toMatchObject({ ok: false });
    // Past-midnight hours are unsupported everywhere in the resolver; refuse rather than store.
    expect(normaliseHoursPeriods([{ start: '20:00', end: '02:00' }])).toMatchObject({ ok: false });
  });
});

describe('applyAmendedHours / removeDateOverrides', () => {
  it('writes one key per date in the range and keeps other keys', () => {
    const map = applyAmendedHours(
      { '2026-09-01': { closed: true } },
      { date_start: '2026-09-16', date_end: '2026-09-18', periods: NINE_TO_FIVE, reason: '  Late opening ' },
    );
    expect(Object.keys(map).sort()).toEqual(['2026-09-01', '2026-09-16', '2026-09-17', '2026-09-18']);
    expect(map['2026-09-17']).toEqual({ periods: NINE_TO_FIVE, reason: 'Late opening' });
    expect(map['2026-09-01']).toEqual({ closed: true });
  });

  it('removes the replaced run first, so shortening a run leaves no stragglers', () => {
    const before = applyAmendedHours({}, { date_start: '2026-09-14', date_end: '2026-09-18', periods: NINE_TO_FIVE });
    const after = applyAmendedHours(before, {
      date_start: '2026-09-14',
      date_end: '2026-09-15',
      periods: NINE_TO_FIVE,
      replace: { date_start: '2026-09-14', date_end: '2026-09-18' },
    });
    expect(Object.keys(after).sort()).toEqual(['2026-09-14', '2026-09-15']);
    expect(before['2026-09-18']).toBeDefined();
  });

  it('removes only the range asked for', () => {
    const map = applyAmendedHours({}, { date_start: '2026-09-14', date_end: '2026-09-18', periods: NINE_TO_FIVE });
    const out = removeDateOverrides(map, '2026-09-15', '2026-09-16');
    expect(Object.keys(out).sort()).toEqual(['2026-09-14', '2026-09-17', '2026-09-18']);
  });
});

describe('amendedHoursEntries', () => {
  it('collapses consecutive identical dates into one run and splits on a change', () => {
    let map = applyAmendedHours({}, { date_start: '2026-09-14', date_end: '2026-09-16', periods: NINE_TO_FIVE });
    map = applyAmendedHours(map, { date_start: '2026-09-17', date_end: '2026-09-17', periods: [{ start: '08:00', end: '20:00' }] });
    map = applyAmendedHours(map, { date_start: '2026-09-21', date_end: '2026-09-21', periods: NINE_TO_FIVE });
    map['2026-09-25'] = { closed: true };
    expect(amendedHoursEntries(map)).toEqual([
      { kind: 'hours', date_start: '2026-09-14', date_end: '2026-09-16', periods: NINE_TO_FIVE, reason: null },
      { kind: 'hours', date_start: '2026-09-17', date_end: '2026-09-17', periods: [{ start: '08:00', end: '20:00' }], reason: null },
      { kind: 'hours', date_start: '2026-09-21', date_end: '2026-09-21', periods: NINE_TO_FIVE, reason: null },
      { kind: 'closed', date_start: '2026-09-25', date_end: '2026-09-25', periods: [], reason: null },
    ]);
  });

  it('keeps a run whole when it straddles the window', () => {
    const map = applyAmendedHours({}, { date_start: '2026-09-28', date_end: '2026-10-02', periods: NINE_TO_FIVE });
    expect(amendedHoursEntries(map, { from: '2026-10-01', to: '2026-10-31' })).toEqual([
      { kind: 'hours', date_start: '2026-09-28', date_end: '2026-10-02', periods: NINE_TO_FIVE, reason: null },
    ]);
    expect(amendedHoursEntries(map, { from: '2026-11-01', to: '2026-11-30' })).toEqual([]);
  });

  it('separates runs whose reasons differ', () => {
    let map = applyAmendedHours({}, { date_start: '2026-09-14', date_end: '2026-09-14', periods: NINE_TO_FIVE, reason: 'A' });
    map = applyAmendedHours(map, { date_start: '2026-09-15', date_end: '2026-09-15', periods: NINE_TO_FIVE, reason: 'B' });
    expect(amendedHoursEntries(map)).toHaveLength(2);
  });
});

describe('readOverrideMap', () => {
  it('drops junk and keeps valid keys of both kinds', () => {
    expect(
      readOverrideMap({
        '2026-09-14': { periods: [{ start: '09:00', end: '17:00' }], reason: 'x' },
        '2026-09-15': { closed: true },
        '2026-09-16': { periods: [] },
        'not-a-date': { closed: true },
        '2026-09-17': 'garbage',
      }),
    ).toEqual({
      '2026-09-14': { periods: NINE_TO_FIVE, reason: 'x' },
      '2026-09-15': { closed: true },
    });
    expect(readOverrideMap(null)).toEqual({});
    expect(readOverrideMap([])).toEqual({});
  });
});

describe('firstFullDayLeaveDate', () => {
  it('names the first date under full-day leave and ignores part-day leave', () => {
    const leave = [
      { start_date: '2026-09-15', end_date: '2026-09-15', unavailable_start_time: '14:00', unavailable_end_time: '15:00' },
      { start_date: '2026-09-17', end_date: '2026-09-19' },
    ];
    expect(firstFullDayLeaveDate('2026-09-14', '2026-09-20', leave)).toBe('2026-09-17');
    expect(firstFullDayLeaveDate('2026-09-14', '2026-09-16', leave)).toBeNull();
  });
});

describe('hoursOverrideMirrorRows', () => {
  it('shapes one hours row per run in the table format and skips closed keys', () => {
    const map = applyAmendedHours({}, { date_start: '2026-09-14', date_end: '2026-09-15', periods: NINE_TO_FIVE, reason: 'Fair' });
    map['2026-09-20'] = { closed: true };
    expect(hoursOverrideMirrorRows('v1', 'c1', map)).toEqual([
      {
        venue_id: 'v1',
        calendar_id: 'c1',
        override_kind: 'hours',
        date_start: '2026-09-14',
        date_end: '2026-09-15',
        time_start: null,
        time_end: null,
        periods: [{ open: '09:00', close: '17:00' }],
        leave_type: null,
        notes: 'Fair',
        source_leave_id: null,
      },
    ]);
  });
});
