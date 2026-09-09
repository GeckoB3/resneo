import { describe, expect, it } from 'vitest';
import { isServiceVisit, resolveAppointmentVisit, type VisitServiceRow } from './appointment-visit';

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
