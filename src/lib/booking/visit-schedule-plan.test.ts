import { describe, expect, it } from 'vitest';
import { planVisitSchedule, type VisitScheduleRow } from './visit-schedule-plan';

/**
 * A three-service visit on David (calendar `cal-d`): Cut 10:00-11:00, a ten
 * minute gap, Olaplex 11:10-11:40, Toner 11:40-12:10. The gap is the kind an
 * earlier per-service edit or a buffer leaves behind, and every edit keeps it.
 */
const ROWS: VisitScheduleRow[] = [
  {
    id: 'a',
    booking_date: '2026-09-09',
    booking_time: '10:00:00',
    booking_end_time: '11:00:00',
    calendar_id: 'cal-d',
    group_booking_id: 'g1',
    booking_item_name: 'Cut & Blow Dry',
  },
  {
    id: 'b',
    booking_date: '2026-09-09',
    booking_time: '11:10:00',
    booking_end_time: '11:40:00',
    calendar_id: 'cal-d',
    group_booking_id: 'g1',
    booking_item_name: 'Olaplex Treatment',
  },
  {
    id: 'c',
    booking_date: '2026-09-09',
    booking_time: '11:40:00',
    booking_end_time: '12:10:00',
    calendar_id: 'cal-d',
    group_booking_id: 'g1',
    booking_item_name: 'Toner / Gloss',
  },
];

/** The same visit with Toner booked for the next morning. */
const CROSS_DAY: VisitScheduleRow[] = [
  ROWS[0]!,
  ROWS[1]!,
  { ...ROWS[2]!, booking_date: '2026-09-10', booking_time: '09:00:00', booking_end_time: '09:30:00' },
];

function plan(params: Parameters<typeof planVisitSchedule>[0]) {
  const result = planVisitSchedule(params);
  if (!result.ok) throw new Error(`expected a plan, got: ${result.reason}`);
  return result.plan;
}

const slots = (p: ReturnType<typeof plan>) =>
  p.services.map((s) => [s.id, s.dateYmd, s.startHm, s.endHm, s.calendarId]);

describe('planVisitSchedule: shift', () => {
  it('moves every service by the same delta, keeping each length and the gap between them', () => {
    const p = plan({ rows: ROWS, shift: { booking_time: '14:00' } });
    expect(slots(p)).toEqual([
      ['a', '2026-09-09', '14:00', '15:00', 'cal-d'],
      ['b', '2026-09-09', '15:10', '15:40', 'cal-d'],
      ['c', '2026-09-09', '15:40', '16:10', 'cal-d'],
    ]);
    expect(p.startHm).toBe('14:00');
    expect(p.endHm).toBe('16:10');
    expect(p.totalMinutes).toBe(130);
    expect(p.changed).toBe(true);
    expect(p.startChanged).toBe(true);
    expect(p.visitStartChanged).toBe(true);
    expect(p.services.every((s) => s.moved && !s.durationChanged && !s.calendarChanged)).toBe(true);
  });

  it('keeps a cross-day offset when the visit moves to another day', () => {
    const p = plan({ rows: CROSS_DAY, shift: { booking_date: '2026-09-16' } });
    expect(slots(p)).toEqual([
      ['a', '2026-09-16', '10:00', '11:00', 'cal-d'],
      ['b', '2026-09-16', '11:10', '11:40', 'cal-d'],
      ['c', '2026-09-17', '09:00', '09:30', 'cal-d'],
    ]);
    expect(p.endDateYmd).toBe('2026-09-17');
    expect(p.totalMinutes).toBe(23 * 60 + 30);
  });

  it('applies a calendar to every service, and that alone counts as a change', () => {
    const p = plan({ rows: ROWS, shift: { practitioner_id: 'cal-j' } });
    expect(p.services.map((s) => s.calendarId)).toEqual(['cal-j', 'cal-j', 'cal-j']);
    expect(p.changed).toBe(true);
    expect(p.startChanged).toBe(false);
    expect(p.visitStartChanged).toBe(false);
    expect(p.services.every((s) => s.calendarChanged && !s.moved)).toBe(true);
  });

  it('carries a visit across midnight when the shift runs it late', () => {
    const p = plan({ rows: ROWS, shift: { booking_time: '22:30' } });
    expect(slots(p)).toEqual([
      ['a', '2026-09-09', '22:30', '23:30', 'cal-d'],
      ['b', '2026-09-09', '23:40', '00:10', 'cal-d'],
      ['c', '2026-09-10', '00:10', '00:40', 'cal-d'],
    ]);
  });

  it('reports no change when asked for the slot the visit already has', () => {
    const p = plan({ rows: ROWS, shift: { booking_date: '2026-09-09', booking_time: '10:00' } });
    expect(p.changed).toBe(false);
    expect(p.services.every((s) => !s.changed)).toBe(true);
  });

  it('an empty shift describes the visit as it stands', () => {
    const p = plan({ rows: CROSS_DAY, shift: {} });
    expect(p.changed).toBe(false);
    expect(p.startDateYmd).toBe('2026-09-09');
    expect(p.endDateYmd).toBe('2026-09-10');
  });

  it('anchors the delta on the earliest service whatever order the rows arrive in', () => {
    const p = plan({ rows: [ROWS[2]!, ROWS[0]!, ROWS[1]!], shift: { booking_time: '09:00' } });
    expect(p.services.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(p.services[0]!.startHm).toBe('09:00');
  });
});

describe('planVisitSchedule: per service', () => {
  it('changes only the services named and leaves the rest where they are', () => {
    const p = plan({
      rows: ROWS,
      services: [{ booking_id: 'b', booking_time: '15:00', practitioner_id: 'cal-j', duration_minutes: 45 }],
    });
    const b = p.services.find((s) => s.id === 'b')!;
    expect([b.dateYmd, b.startHm, b.endHm, b.durationMinutes, b.calendarId]).toEqual([
      '2026-09-09',
      '15:00',
      '15:45',
      45,
      'cal-j',
    ]);
    expect(b.moved && b.calendarChanged && b.durationChanged).toBe(true);
    expect(b.previous).toEqual({
      dateYmd: '2026-09-09',
      startHm: '11:10',
      endHm: '11:40',
      durationMinutes: 30,
      calendarId: 'cal-d',
    });
    for (const id of ['a', 'c']) {
      const s = p.services.find((x) => x.id === id)!;
      expect(s.changed).toBe(false);
    }
    // Olaplex now ends the visit, so the plan's end follows it.
    expect(p.endHm).toBe('15:45');
    expect(p.services.map((s) => s.id)).toEqual(['a', 'c', 'b']);
    expect(p.visitStartChanged).toBe(false);
    expect(p.startChanged).toBe(true);
  });

  it('a duration change alone does not move the service or the ones after it', () => {
    const p = plan({ rows: ROWS, services: [{ booking_id: 'a', duration_minutes: 30 }] });
    expect(slots(p)).toEqual([
      ['a', '2026-09-09', '10:00', '10:30', 'cal-d'],
      ['b', '2026-09-09', '11:10', '11:40', 'cal-d'],
      ['c', '2026-09-09', '11:40', '12:10', 'cal-d'],
    ]);
    expect(p.startChanged).toBe(false);
  });

  it('moves one service to another day, and the visit then spans both', () => {
    const p = plan({
      rows: ROWS,
      services: [{ booking_id: 'c', booking_date: '2026-09-10', booking_time: '09:00' }],
    });
    expect(p.endDateYmd).toBe('2026-09-10');
    expect(p.endHm).toBe('09:30');
    expect(p.totalMinutes).toBe(23 * 60 + 30);
  });

  it('never takes a service below the engine floor', () => {
    const p = plan({ rows: ROWS, services: [{ booking_id: 'a', duration_minutes: 1 }] });
    expect(p.services.find((s) => s.id === 'a')!.durationMinutes).toBeGreaterThanOrEqual(5);
  });

  it('refuses a booking id that is not on the visit', () => {
    const r = planVisitSchedule({ rows: ROWS, services: [{ booking_id: 'zz', booking_time: '15:00' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unknown_service');
  });

  it('refuses a service named twice', () => {
    const r = planVisitSchedule({
      rows: ROWS,
      services: [
        { booking_id: 'a', booking_time: '15:00' },
        { booking_id: 'a', booking_time: '16:00' },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('duplicate_service');
  });

  it('refuses an empty list rather than answering it as a no-op', () => {
    const r = planVisitSchedule({ rows: ROWS, services: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('nothing_to_change');
  });
});

describe('planVisitSchedule: guards', () => {
  it('rejects a stale view of the visit when known ids disagree', () => {
    const r = planVisitSchedule({
      rows: ROWS,
      shift: { booking_time: '14:00' },
      knownBookingIds: ['a', 'b'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('stale_visit');
    const extra = planVisitSchedule({
      rows: ROWS,
      shift: { booking_time: '14:00' },
      knownBookingIds: ['a', 'b', 'c', 'd'],
    });
    expect(extra.ok).toBe(false);
    const fine = planVisitSchedule({
      rows: ROWS,
      shift: { booking_time: '14:00' },
      knownBookingIds: ['c', 'a', 'b'],
    });
    expect(fine.ok).toBe(true);
  });

  it('refuses a multi-person party', () => {
    const r = planVisitSchedule({
      rows: ROWS.map((row, i) => ({ ...row, person_label: `Guest ${i + 1}` })),
      shift: { booking_time: '14:00' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_a_visit');
  });

  it('refuses rows from different groups', () => {
    const r = planVisitSchedule({
      rows: [ROWS[0]!, { ...ROWS[1]!, group_booking_id: 'g2' }],
      shift: { booking_time: '14:00' },
    });
    expect(r.ok).toBe(false);
  });

  it('refuses an empty visit', () => {
    const r = planVisitSchedule({ rows: [], shift: { booking_time: '14:00' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('empty');
  });

  it('refuses a request with neither mode', () => {
    const r = planVisitSchedule({ rows: ROWS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('nothing_to_change');
  });

  it('plans a single-service visit like any other', () => {
    const p = plan({ rows: [ROWS[0]!], shift: { booking_time: '08:00' } });
    expect(slots(p)).toEqual([['a', '2026-09-09', '08:00', '09:00', 'cal-d']]);
  });

  it('uses add-on minutes for a row with no end time', () => {
    const p = plan({
      rows: [{ ...ROWS[0]!, booking_end_time: null, addons_total_duration_minutes: 20 }],
      shift: { booking_time: '08:00' },
    });
    expect(p.services[0]!.durationMinutes).toBe(20);
    expect(p.services[0]!.endHm).toBe('08:20');
  });
});
