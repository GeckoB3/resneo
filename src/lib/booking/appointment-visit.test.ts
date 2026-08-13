import { describe, expect, it } from 'vitest';
import {
  distributeVisitDuration,
  isServiceVisit,
  minimumVisitMinutes,
  resequenceVisit,
  resolveAppointmentVisit,
  type VisitServiceRow,
} from './appointment-visit';

/**
 * The reported booking: dev, plus1@reserveni.com, Fri 14 Aug 2026, David.
 * Cut & Blow Dry 10:00-11:00, Olaplex 11:00-11:30, Toner 11:45-12:15.
 * The 11:30-11:45 hole came from shortening Olaplex without re-sequencing.
 */
const VISIT_ROWS: VisitServiceRow[] = [
  { id: 'a', booking_time: '10:00:00', booking_end_time: '11:00:00', group_booking_id: 'g1', booking_item_name: 'Cut & Blow Dry' },
  { id: 'b', booking_time: '11:00:00', booking_end_time: '11:30:00', group_booking_id: 'g1', booking_item_name: 'Olaplex Treatment' },
  { id: 'c', booking_time: '11:45:00', booking_end_time: '12:15:00', group_booking_id: 'g1', booking_item_name: 'Toner / Gloss' },
];

/** Contiguous three-service visit, no gaps: 60 + 30 + 30 = 120. */
const CONTIGUOUS: VisitServiceRow[] = [
  { id: 'a', booking_time: '10:00', booking_end_time: '11:00', group_booking_id: 'g1' },
  { id: 'b', booking_time: '11:00', booking_end_time: '11:30', group_booking_id: 'g1' },
  { id: 'c', booking_time: '11:30', booking_end_time: '12:00', group_booking_id: 'g1' },
];

describe('isServiceVisit', () => {
  it('treats rows without a person label as several services for one guest', () => {
    expect(isServiceVisit(VISIT_ROWS)).toBe(true);
  });

  /**
   * A party of several people shares the same `group_booking_id`. Treating one
   * as a visit would merge four bookings into a single appointment.
   */
  it('rejects a multi-person party', () => {
    expect(
      isServiceVisit([
        { ...VISIT_ROWS[0]!, person_label: 'Guest 1' },
        { ...VISIT_ROWS[1]!, person_label: 'Guest 2' },
      ]),
    ).toBe(false);
  });

  it('rejects an empty set', () => {
    expect(isServiceVisit([])).toBe(false);
  });
});

describe('resolveAppointmentVisit', () => {
  it('reports the whole visit, not one service', () => {
    const v = resolveAppointmentVisit(VISIT_ROWS)!;
    expect(v.startHm).toBe('10:00');
    expect(v.endHm).toBe('12:15');
    expect(v.totalMinutes).toBe(135);
    expect(v.serviceMinutes).toBe(120);
    expect(v.services.map((s) => s.name)).toEqual([
      'Cut & Blow Dry',
      'Olaplex Treatment',
      'Toner / Gloss',
    ]);
  });

  it('records the gap between services, and none after the tail', () => {
    const v = resolveAppointmentVisit(VISIT_ROWS)!;
    expect(v.services.map((s) => s.gapAfterMinutes)).toEqual([0, 15, 0]);
  });

  /**
   * A configured buffer and a hole left by an edit look identical in the rows.
   * The catalogue buffer is the only thing that separates them.
   */
  it('treats a gap matching the service buffer as intentional', () => {
    const v = resolveAppointmentVisit(
      VISIT_ROWS.map((r) => (r.id === 'b' ? { ...r, buffer_minutes: 15 } : { ...r, buffer_minutes: 0 })),
    )!;
    expect(v.services[1]!.expectedGapAfterMinutes).toBe(15);
    expect(v.services[1]!.orphanedGapAfterMinutes).toBe(0);
  });

  it('flags a gap wider than the buffer as orphaned', () => {
    const v = resolveAppointmentVisit(
      VISIT_ROWS.map((r) => ({ ...r, buffer_minutes: 0 })),
    )!;
    expect(v.services[1]!.expectedGapAfterMinutes).toBe(0);
    expect(v.services[1]!.orphanedGapAfterMinutes).toBe(15);
  });

  it('preserves an unexplained gap when the buffer is unknown', () => {
    // A failed catalogue lookup must never silently delete a real buffer.
    const v = resolveAppointmentVisit(VISIT_ROWS)!;
    expect(v.services[1]!.expectedGapAfterMinutes).toBe(15);
    expect(v.services[1]!.orphanedGapAfterMinutes).toBe(0);
  });

  it('orders services by start time regardless of row order', () => {
    const shuffled = [VISIT_ROWS[2]!, VISIT_ROWS[0]!, VISIT_ROWS[1]!];
    expect(resolveAppointmentVisit(shuffled)!.services.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('counts add-on minutes toward a service with no end time', () => {
    const v = resolveAppointmentVisit([
      { id: 'a', booking_time: '10:00', group_booking_id: 'g1', addons_total_duration_minutes: 20 },
      { id: 'b', booking_time: '10:20', booking_end_time: '10:50', group_booking_id: 'g1' },
    ])!;
    expect(v.services[0]!.durationMinutes).toBe(20);
    expect(v.totalMinutes).toBe(50);
  });

  it('returns null for a party, an empty set, or rows from different visits', () => {
    expect(resolveAppointmentVisit([{ ...VISIT_ROWS[0]!, person_label: 'Guest 1' }])).toBeNull();
    expect(resolveAppointmentVisit([])).toBeNull();
    expect(
      resolveAppointmentVisit([VISIT_ROWS[0]!, { ...VISIT_ROWS[1]!, group_booking_id: 'g2' }]),
    ).toBeNull();
  });
});

describe('resequenceVisit closes orphaned holes', () => {
  /**
   * The reported booking: shortening Olaplex left 15 minutes of dead time
   * because the services after it stayed put. With the buffers known to be zero,
   * the next edit closes it.
   */
  it('closes the hole once the buffers say it should not be there', () => {
    const rows = VISIT_ROWS.map((r) => ({ ...r, buffer_minutes: 0 }));
    const v = resolveAppointmentVisit(rows)!;
    const laid = resequenceVisit(v, new Map(v.services.map((s) => [s.id, s.durationMinutes])));
    expect(laid.map((s) => `${s.startHm}-${s.endHm}`)).toEqual([
      '10:00-11:00',
      '11:00-11:30',
      '11:30-12:00',
    ]);
  });

  it('keeps a real buffer while closing a hole beside it', () => {
    // Cut & Blow Dry has a 10 minute buffer; Olaplex has none but is followed by
    // the 15 minute hole.
    const rows = [
      { ...VISIT_ROWS[0]!, buffer_minutes: 10 },
      { ...VISIT_ROWS[1]!, booking_time: '11:10:00', booking_end_time: '11:40:00', buffer_minutes: 0 },
      { ...VISIT_ROWS[2]!, booking_time: '11:55:00', booking_end_time: '12:25:00', buffer_minutes: 0 },
    ];
    const v = resolveAppointmentVisit(rows)!;
    const laid = resequenceVisit(v, new Map(v.services.map((s) => [s.id, s.durationMinutes])));
    expect(laid.map((s) => `${s.startHm}-${s.endHm}`)).toEqual([
      '10:00-11:00',
      '11:10-11:40',
      '11:40-12:10',
    ]);
  });
});

describe('resequenceVisit', () => {
  /**
   * With no buffer known, an observed gap is assumed intentional and preserved.
   * The buffer-aware cases that actually close a hole are above.
   */
  it('preserves an unexplained gap when the buffer is unknown', () => {
    const v = resolveAppointmentVisit(VISIT_ROWS)!;
    const durations = new Map(v.services.map((s) => [s.id, s.durationMinutes]));
    const laid = resequenceVisit(v, durations);
    expect(laid.map((s) => `${s.startHm}-${s.endHm}`)).toEqual([
      '10:00-11:00',
      '11:00-11:30',
      '11:45-12:15',
    ]);
  });

  it('preserves a configured gap when a service shrinks', () => {
    const v = resolveAppointmentVisit(VISIT_ROWS)!;
    const durations = new Map(v.services.map((s) => [s.id, s.durationMinutes]));
    durations.set('a', 30);
    const laid = resequenceVisit(v, durations);
    // Everything after the shortened service moves up; the 15 minute gap stays.
    expect(laid.map((s) => `${s.startHm}-${s.endHm}`)).toEqual([
      '10:00-10:30',
      '10:30-11:00',
      '11:15-11:45',
    ]);
  });

  it('moves the whole visit when the start changes', () => {
    const v = resolveAppointmentVisit(CONTIGUOUS)!;
    const durations = new Map(v.services.map((s) => [s.id, s.durationMinutes]));
    const laid = resequenceVisit(v, durations, '14:00');
    expect(laid.map((s) => s.startHm)).toEqual(['14:00', '15:00', '15:30']);
  });
});

describe('distributeVisitDuration', () => {
  it('extends the tail when the visit grows', () => {
    const v = resolveAppointmentVisit(CONTIGUOUS)!;
    const d = distributeVisitDuration(v, 150);
    expect(d.get('a')).toBe(60);
    expect(d.get('b')).toBe(30);
    expect(d.get('c')).toBe(60);
  });

  it('takes shrinkage off the tail first', () => {
    const v = resolveAppointmentVisit(CONTIGUOUS)!;
    const d = distributeVisitDuration(v, 100);
    expect(d.get('a')).toBe(60);
    expect(d.get('b')).toBe(30);
    expect(d.get('c')).toBe(10);
  });

  it('cascades backwards once the tail hits its floor', () => {
    const v = resolveAppointmentVisit(CONTIGUOUS)!;
    // 120 down to 70: tail gives 25 (30 to 5), the next gives 25 (30 to 5).
    const d = distributeVisitDuration(v, 70);
    expect(d.get('c')).toBe(5);
    expect(d.get('b')).toBe(5);
    expect(d.get('a')).toBe(60);
  });

  it('never takes a service below the engine minimum', () => {
    const v = resolveAppointmentVisit(CONTIGUOUS)!;
    for (let total = 0; total <= 200; total += 1) {
      for (const [, mins] of distributeVisitDuration(v, total)) {
        expect(mins).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it('floors at every service on its minimum, gaps included', () => {
    const v = resolveAppointmentVisit(VISIT_ROWS)!;
    expect(minimumVisitMinutes(v)).toBe(30); // 3 x 5 minutes + the 15 minute gap
    const d = distributeVisitDuration(v, 0);
    expect([...d.values()]).toEqual([5, 5, 5]);
  });

  it('never consumes a configured gap to satisfy the request', () => {
    const v = resolveAppointmentVisit(VISIT_ROWS)!;
    // 135 down to 120: the gap is not available, so the tail absorbs all 15.
    const laid = resequenceVisit(v, distributeVisitDuration(v, 120));
    expect(laid.map((s) => `${s.startHm}-${s.endHm}`)).toEqual([
      '10:00-11:00',
      '11:00-11:30',
      '11:45-12:00',
    ]);
    // The gap is still 15 minutes, in the same place the service settings put it.
    expect(v.services[1]!.gapAfterMinutes).toBe(15);
  });

  it('round-trips: the laid-out span matches what was asked for', () => {
    const v = resolveAppointmentVisit(VISIT_ROWS)!;
    for (let total = minimumVisitMinutes(v); total <= 300; total += 5) {
      const laid = resequenceVisit(v, distributeVisitDuration(v, total));
      const first = laid[0]!.startHm;
      const last = laid[laid.length - 1]!.endHm;
      const span =
        (Number(last.slice(0, 2)) * 60 + Number(last.slice(3))) -
        (Number(first.slice(0, 2)) * 60 + Number(first.slice(3)));
      expect(span, `asked for ${total} minutes`).toBe(total);
    }
  });
});
