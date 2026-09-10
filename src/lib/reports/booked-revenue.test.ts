import { describe, expect, it } from 'vitest';
import {
  aggregateBookedRevenue,
  grantAllowsRevenueReporting,
  periodStartFor,
  periodStartsBetween,
  resolvePresetRange,
  type BookedRevenueColumn,
} from './booked-revenue';

const own: BookedRevenueColumn = {
  key: 'cal-a',
  calendar_id: 'cal-a',
  name: 'Anna',
  venue_id: 'v1',
  venue_name: 'Studio',
  linked: false,
  colour: '#111',
};
const partner: BookedRevenueColumn = {
  key: 'cal-p',
  calendar_id: 'cal-p',
  name: 'Pat',
  venue_id: 'v2',
  venue_name: 'Partner',
  linked: true,
  colour: null,
};
const unassigned: BookedRevenueColumn = {
  key: 'unassigned',
  calendar_id: null,
  name: 'No calendar',
  venue_id: 'v1',
  venue_name: 'Studio',
  linked: false,
  colour: null,
};

describe('periodStartFor', () => {
  it('starts weeks on Monday and months on the 1st', () => {
    expect(periodStartFor('2026-09-10', 'day')).toBe('2026-09-10'); // Thursday
    expect(periodStartFor('2026-09-10', 'week')).toBe('2026-09-07');
    expect(periodStartFor('2026-09-06', 'week')).toBe('2026-08-31'); // Sunday belongs to the week before
    expect(periodStartFor('2026-09-07', 'week')).toBe('2026-09-07');
    expect(periodStartFor('2026-09-10', 'month')).toBe('2026-09-01');
  });
});

describe('periodStartsBetween', () => {
  it('lists every period touching the range, including quiet ones', () => {
    expect(periodStartsBetween('2026-09-01', '2026-09-03', 'day')).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
    ]);
    expect(periodStartsBetween('2026-09-05', '2026-09-15', 'week')).toEqual([
      '2026-08-31',
      '2026-09-07',
      '2026-09-14',
    ]);
    expect(periodStartsBetween('2026-01-15', '2026-03-02', 'month')).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ]);
  });
});

describe('resolvePresetRange', () => {
  it('resolves each preset from the venue today', () => {
    const today = '2026-09-10'; // Thursday
    expect(resolvePresetRange('today', today)).toEqual({ from: today, to: today });
    expect(resolvePresetRange('this_week', today)).toEqual({ from: '2026-09-07', to: '2026-09-13' });
    expect(resolvePresetRange('this_month', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(resolvePresetRange('last_30', today)).toEqual({ from: '2026-08-12', to: today });
    expect(resolvePresetRange('next_30', today)).toEqual({ from: today, to: '2026-10-09' });
  });
});

describe('grantAllowsRevenueReporting', () => {
  it('needs full calendar detail and create/edit/cancel rights', () => {
    expect(grantAllowsRevenueReporting({ calendar: 'full_details', pii: false, act: 'create_edit_cancel' })).toBe(true);
    expect(grantAllowsRevenueReporting({ calendar: 'full_details', pii: true, act: 'edit_existing' })).toBe(false);
    expect(grantAllowsRevenueReporting({ calendar: 'time_only', pii: true, act: 'create_edit_cancel' })).toBe(false);
  });
});

describe('aggregateBookedRevenue', () => {
  const base = { from: '2026-09-08', to: '2026-09-10', grain: 'day' as const, today: '2026-09-09' };

  it('sums booked rows per day and per calendar, keeping no-shows separate', () => {
    const report = aggregateBookedRevenue({
      ...base,
      columns: [own, partner],
      rows: [
        { booking_date: '2026-09-08', status: 'Completed', calendar_id: 'cal-a', venue_id: 'v1', pence: 3000 },
        { booking_date: '2026-09-08', status: 'No-Show', calendar_id: 'cal-a', venue_id: 'v1', pence: 2000 },
        { booking_date: '2026-09-08', status: 'Booked', calendar_id: 'cal-p', venue_id: 'v2', pence: 5000 },
        { booking_date: '2026-09-10', status: 'Booked', calendar_id: 'cal-a', venue_id: 'v1', pence: 4500 },
        { booking_date: '2026-09-10', status: 'Cancelled', calendar_id: 'cal-a', venue_id: 'v1', pence: 9999 },
      ],
    });
    expect(report.periods.map((p) => [p.period_start, p.booked_pence, p.no_show_pence])).toEqual([
      ['2026-09-08', 8000, 2000],
      ['2026-09-09', 0, 0],
      ['2026-09-10', 4500, 0],
    ]);
    expect(report.periods[0]!.by_calendar['cal-a']).toEqual({
      booked_pence: 3000,
      no_show_pence: 2000,
      booked_count: 1,
      no_show_count: 1,
      unpriced_count: 0,
    });
    expect(report.periods[0]!.by_calendar['cal-p']?.booked_pence).toBe(5000);
    expect(report.totals.booked_pence).toBe(12500);
    expect(report.totals.no_show_pence).toBe(2000);
    expect(report.totals.by_calendar['cal-a']?.booked_pence).toBe(7500);
  });

  it('counts unpriced rows without adding to revenue', () => {
    const report = aggregateBookedRevenue({
      ...base,
      columns: [own],
      rows: [{ booking_date: '2026-09-09', status: 'Booked', calendar_id: 'cal-a', venue_id: 'v1', pence: null }],
    });
    expect(report.totals).toMatchObject({ booked_pence: 0, booked_count: 1, unpriced_count: 1 });
  });

  it('puts own bookings with no known calendar under the unassigned column and drops out-of-scope partner rows', () => {
    const report = aggregateBookedRevenue({
      ...base,
      columns: [own, unassigned, partner],
      rows: [
        { booking_date: '2026-09-09', status: 'Booked', calendar_id: null, venue_id: 'v1', pence: 1000 },
        { booking_date: '2026-09-09', status: 'Booked', calendar_id: 'cal-deleted', venue_id: 'v1', pence: 200 },
        { booking_date: '2026-09-09', status: 'Booked', calendar_id: 'cal-hidden', venue_id: 'v2', pence: 7000 },
      ],
    });
    expect(report.totals.by_calendar['unassigned']?.booked_pence).toBe(1200);
    expect(report.totals.booked_pence).toBe(1200);
  });

  it('clamps week periods to the requested range and buckets by the booking date', () => {
    const report = aggregateBookedRevenue({
      from: '2026-09-09',
      to: '2026-09-16',
      grain: 'week',
      today: '2026-09-09',
      columns: [own],
      rows: [
        { booking_date: '2026-09-13', status: 'Booked', calendar_id: 'cal-a', venue_id: 'v1', pence: 100 },
        { booking_date: '2026-09-14', status: 'Booked', calendar_id: 'cal-a', venue_id: 'v1', pence: 250 },
      ],
    });
    expect(report.periods.map((p) => [p.period_start, p.period_end, p.booked_pence])).toEqual([
      ['2026-09-09', '2026-09-13', 100],
      ['2026-09-14', '2026-09-16', 250],
    ]);
  });
});
