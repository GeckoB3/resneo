import { describe, expect, it } from 'vitest';
import {
  bookingListRowDurationBarLabel,
  bookingListRowDurationDetailLabel,
  bookingListRowDurationMinutes,
  bookingListRowTimeRangeLabel,
  collapseMultiServiceVisits,
  multiServiceVisitWallClockSchedule,
  resolveBookingListBarSchedule,
} from '@/lib/booking/booking-list-row-schedule';

describe('bookingListRowSchedule', () => {
  it('uses booking_end_time for wall-clock duration including extras', () => {
    const row = {
      booking_time: '10:00',
      booking_end_time: '10:45',
      addons_total_duration_minutes: 15,
    };
    expect(bookingListRowDurationMinutes(row)).toBe(45);
    expect(bookingListRowTimeRangeLabel(row)).toBe('10:00–10:45');
    expect(bookingListRowDurationBarLabel(row)).toBe('45 min');
    expect(bookingListRowDurationDetailLabel(row)).toBe('45 min (30 min service + 15 min extras)');
  });

  it('falls back to catalogue default plus add-on minutes', () => {
    expect(
      bookingListRowDurationMinutes(
        { booking_time: '10:00', addons_total_duration_minutes: 10 },
        30,
      ),
    ).toBe(40);
  });

  it('uses first start and last end for multi-service visits', () => {
    const segments = [
      {
        booking_time: '10:00',
        booking_end_time: '10:30',
        addons_total_duration_minutes: 5,
        group_booking_id: 'g1',
      },
      {
        booking_time: '10:30',
        booking_end_time: '11:15',
        addons_total_duration_minutes: 10,
        group_booking_id: 'g1',
      },
    ];
    expect(multiServiceVisitWallClockSchedule(segments)).toEqual({
      timeRangeLabel: '10:00–11:15',
      durationMinutes: 75,
      addonsTotalMinutes: 15,
    });

    const bar = resolveBookingListBarSchedule(segments[0]!, segments);
    expect(bar.timeRangeLabel).toBe('10:00–11:15');
    expect(bar.durationBarLabel).toBe('1 hr 15 min');
    expect(bar.durationDetailLabel).toBe('1 hr 15 min (1 hr service + 15 min extras)');
  });
});

describe('collapseMultiServiceVisits', () => {
  it('collapses a multi-service visit (shared group, no person labels) to one earliest row', () => {
    const rows = [
      { id: 'a', booking_time: '10:30', group_booking_id: 'g1', person_label: null },
      { id: 'b', booking_time: '10:00', group_booking_id: 'g1', person_label: null },
    ];
    const out = collapseMultiServiceVisits(rows);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('b'); // earliest start kept
  });

  it('keeps group bookings (distinct person labels) as separate rows', () => {
    const rows = [
      { id: 'a', booking_time: '10:00', group_booking_id: 'g1', person_label: 'Alex' },
      { id: 'b', booking_time: '10:00', group_booking_id: 'g1', person_label: 'Sam' },
    ];
    const out = collapseMultiServiceVisits(rows);
    expect(out.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('leaves standalone bookings untouched and preserves order', () => {
    const rows = [
      { id: 'solo1', booking_time: '09:00', group_booking_id: null, person_label: null },
      { id: 'a', booking_time: '10:00', group_booking_id: 'g1', person_label: null },
      { id: 'b', booking_time: '10:30', group_booking_id: 'g1', person_label: null },
      { id: 'solo2', booking_time: '11:00', group_booking_id: null, person_label: null },
    ];
    const out = collapseMultiServiceVisits(rows);
    expect(out.map((r) => r.id)).toEqual(['solo1', 'a', 'solo2']);
  });
});

describe('collapseMultiServiceVisits across days', () => {
  it('collapses per day, so a visit split across two days is one line on each', () => {
    const rows = [
      { id: 'a', booking_date: '2026-09-09', booking_time: '10:00', group_booking_id: 'g1', status: 'Completed' },
      { id: 'b', booking_date: '2026-09-09', booking_time: '11:00', group_booking_id: 'g1', status: 'Booked' },
      { id: 'c', booking_date: '2026-09-10', booking_time: '09:00', group_booking_id: 'g1', status: 'Booked' },
      { id: 'd', booking_date: '2026-09-10', booking_time: '09:30', group_booking_id: 'g1', status: 'Booked' },
    ];
    const out = collapseMultiServiceVisits(rows);
    // Each day's line carries that day's derived status: a finished service does not
    // hold the day back, so the unstarted one sets it.
    expect(out.map((r) => [r.id, r.status, r.visit_spans_days ?? false])).toEqual([
      ['a', 'Booked', true],
      ['c', 'Booked', true],
    ]);
  });

  it('marks a lone service whose visit is out of view, without claiming another day', () => {
    // The day view of the 10th holds only Toner; the rest of its visit is not in view
    // (another day, cancelled, or a hidden calendar), so the line says only that much.
    const rows = [
      { id: 'solo', booking_date: '2026-09-10', booking_time: '08:00', group_booking_id: null, status: 'Booked' },
      { id: 'c', booking_date: '2026-09-10', booking_time: '09:00', group_booking_id: 'g1', status: 'Booked' },
    ];
    const out = collapseMultiServiceVisits(rows);
    expect(out.map((r) => [r.id, r.visit_spans_days ?? false, r.visit_rest_hidden ?? false])).toEqual([
      ['solo', false, false],
      ['c', false, true],
    ]);
  });

  it('marks a lone service as spanning days when the rest of its visit is in view on another day', () => {
    const rows = [
      { id: 'a', booking_date: '2026-09-09', booking_time: '09:00', group_booking_id: 'g1', status: 'Booked' },
      { id: 'c', booking_date: '2026-09-10', booking_time: '09:00', group_booking_id: 'g1', status: 'Booked' },
    ];
    const out = collapseMultiServiceVisits(rows);
    expect(out.map((r) => [r.id, r.visit_spans_days ?? false, r.visit_rest_hidden ?? false])).toEqual([
      ['a', true, false],
      ['c', true, false],
    ]);
  });

  it('never marks a party row or a class cart row', () => {
    const rows = [
      { id: 'p', booking_date: '2026-09-10', booking_time: '09:00', group_booking_id: 'party', person_label: 'Ann' },
      { id: 'k', booking_date: '2026-09-10', booking_time: '09:00', group_booking_id: 'cart', class_instance_id: 'ci' },
    ];
    const out = collapseMultiServiceVisits(rows);
    expect(out.map((r) => [r.id, r.visit_spans_days ?? false])).toEqual([
      ['p', false],
      ['k', false],
    ]);
  });

  it('a single-day visit is not marked', () => {
    const rows = [
      { id: 'a', booking_date: '2026-09-09', booking_time: '10:00', group_booking_id: 'g1', status: 'Booked' },
      { id: 'b', booking_date: '2026-09-09', booking_time: '11:00', group_booking_id: 'g1', status: 'Booked' },
    ];
    expect(collapseMultiServiceVisits(rows).map((r) => r.visit_spans_days ?? false)).toEqual([false]);
  });
});

describe('collapseMultiServiceVisits status', () => {
  it('gives the representative the visit’s derived status', () => {
    const rows = [
      { id: 'a', booking_time: '10:00', group_booking_id: 'g', status: 'Completed' },
      { id: 'b', booking_time: '11:00', group_booking_id: 'g', status: 'Seated' },
      { id: 'c', booking_time: '12:00', group_booking_id: null, status: 'Booked' },
    ];
    const out = collapseMultiServiceVisits(rows);
    expect(out.map((r) => [r.id, r.status])).toEqual([
      ['a', 'Seated'],
      ['c', 'Booked'],
    ]);
  });
});
