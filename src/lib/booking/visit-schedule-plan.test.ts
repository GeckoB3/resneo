import { describe, expect, it } from 'vitest';
import { planVisitSchedule } from './visit-schedule-plan';
import type { VisitServiceRow } from './appointment-visit';

/**
 * The reported booking: dev, plus1@reserveni.com, Fri 14 Aug 2026, David.
 * Cut & Blow Dry 10:00-11:00, Olaplex 11:00-11:30, Toner 11:45-12:15.
 * The 11:30-11:45 hole came from shortening Olaplex without re-sequencing.
 */
const VISIT_ROWS: VisitServiceRow[] = [
  {
    id: 'a',
    booking_time: '10:00:00',
    booking_end_time: '11:00:00',
    group_booking_id: 'g1',
    booking_item_name: 'Cut & Blow Dry',
    buffer_minutes: 0,
  },
  {
    id: 'b',
    booking_time: '11:00:00',
    booking_end_time: '11:30:00',
    group_booking_id: 'g1',
    booking_item_name: 'Olaplex Treatment',
    buffer_minutes: 0,
  },
  {
    id: 'c',
    booking_time: '11:45:00',
    booking_end_time: '12:15:00',
    group_booking_id: 'g1',
    booking_item_name: 'Toner / Gloss',
    buffer_minutes: 0,
  },
];

function plan(params: Parameters<typeof planVisitSchedule>[0]) {
  const result = planVisitSchedule(params);
  if (!result.ok) throw new Error(`expected a plan, got: ${result.reason}`);
  return result.plan;
}

describe('planVisitSchedule', () => {
  it('moves every service by the same delta, keeping each duration', () => {
    const p = plan({ rows: VISIT_ROWS, startHm: '14:00' });
    expect(p.services.map((s) => [s.startHm, s.endHm])).toEqual([
      ['14:00', '15:00'],
      ['15:00', '15:30'],
      ['15:30', '16:00'],
    ]);
    expect(p.startHm).toBe('14:00');
    expect(p.endHm).toBe('16:00');
  });

  it('closes dead time an earlier per-service edit left behind', () => {
    // The hole is 11:30 to 11:45. Re-laying at the same start removes it, so the
    // visit is 15 minutes shorter than the rows say without any service changing
    // length.
    const p = plan({ rows: VISIT_ROWS });
    expect(p.services.map((s) => s.startHm)).toEqual(['10:00', '11:00', '11:30']);
    expect(p.totalMinutes).toBe(120);
    expect(p.changed).toBe(true);
    expect(p.services.map((s) => s.durationMinutes)).toEqual([60, 30, 30]);
  });

  it('preserves a service’s configured buffer as a gap', () => {
    const rows: VisitServiceRow[] = [
      { ...VISIT_ROWS[0]!, buffer_minutes: 10 },
      { ...VISIT_ROWS[1]!, buffer_minutes: 0 },
      { ...VISIT_ROWS[2]!, buffer_minutes: 0 },
    ];
    const p = plan({ rows, startHm: '09:00' });
    expect(p.services.map((s) => [s.startHm, s.endHm])).toEqual([
      ['09:00', '10:00'],
      ['10:10', '10:40'],
      ['10:40', '11:10'],
    ]);
  });

  it('grows the visit by extending the tail service', () => {
    const p = plan({ rows: VISIT_ROWS, totalDurationMinutes: 150 });
    expect(p.services.map((s) => s.durationMinutes)).toEqual([60, 30, 60]);
    expect(p.totalMinutes).toBe(150);
  });

  it('shrinks from the tail and cascades backwards', () => {
    const p = plan({ rows: VISIT_ROWS, totalDurationMinutes: 70 });
    // Tail to its 5 minute floor first, then the middle service gives the rest.
    expect(p.services.map((s) => s.durationMinutes)).toEqual([60, 5, 5]);
    expect(p.totalMinutes).toBe(70);
  });

  it('refuses a span shorter than the services can fit, naming the floor', () => {
    const result = planVisitSchedule({ rows: VISIT_ROWS, totalDurationMinutes: 5 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('15 minutes');
  });

  it('counts a configured gap in the floor it refuses below', () => {
    const rows: VisitServiceRow[] = [
      { ...VISIT_ROWS[0]!, buffer_minutes: 10 },
      { ...VISIT_ROWS[1]!, buffer_minutes: 0 },
      { ...VISIT_ROWS[2]!, buffer_minutes: 0 },
    ];
    const result = planVisitSchedule({ rows, totalDurationMinutes: 20 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('25 minutes');
  });

  it('reports the previous slot alongside the new one', () => {
    const p = plan({ rows: VISIT_ROWS, startHm: '14:00' });
    expect(p.services[2]!.previous).toEqual({
      startHm: '11:45',
      endHm: '12:15',
      durationMinutes: 30,
    });
    expect(p.services.every((s) => s.changed)).toBe(true);
  });

  it('reports no change when the rows already have the asked-for shape', () => {
    const contiguous: VisitServiceRow[] = [
      VISIT_ROWS[0]!,
      VISIT_ROWS[1]!,
      { ...VISIT_ROWS[2]!, booking_time: '11:30:00', booking_end_time: '12:00:00' },
    ];
    const p = plan({ rows: contiguous, startHm: '10:00' });
    expect(p.changed).toBe(false);
    expect(p.services.every((s) => !s.changed)).toBe(true);
  });

  it('refuses a multi-person party, which shares the same group id', () => {
    const party: VisitServiceRow[] = VISIT_ROWS.map((r, i) => ({
      ...r,
      booking_time: '10:00:00',
      booking_end_time: '11:00:00',
      person_label: `Guest ${i + 1}`,
    }));
    const result = planVisitSchedule({ rows: party, startHm: '14:00' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('not a single visit');
  });

  it('refuses rows that do not share one group booking', () => {
    const mixed: VisitServiceRow[] = [
      VISIT_ROWS[0]!,
      { ...VISIT_ROWS[1]!, group_booking_id: 'g2' },
    ];
    expect(planVisitSchedule({ rows: mixed, startHm: '14:00' }).ok).toBe(false);
  });

  it('refuses an empty visit', () => {
    expect(planVisitSchedule({ rows: [], startHm: '14:00' }).ok).toBe(false);
  });

  it('plans a single-service visit like any other', () => {
    const p = plan({ rows: [VISIT_ROWS[0]!], startHm: '16:30', totalDurationMinutes: 45 });
    expect(p.services).toHaveLength(1);
    expect(p.services[0]!.startHm).toBe('16:30');
    expect(p.services[0]!.endHm).toBe('17:15');
  });

  it('wraps a visit that runs past midnight', () => {
    const p = plan({ rows: VISIT_ROWS, startHm: '23:00' });
    expect(p.services.map((s) => s.startHm)).toEqual(['23:00', '00:00', '00:30']);
    expect(p.totalMinutes).toBe(120);
  });
});
