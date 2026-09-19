import { describe, expect, it } from 'vitest';
import { computeVenueBaselineMetrics } from './compute-venue-baseline-metrics';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';

function appointment(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    guest_id: null,
    status: 'Completed',
    source: 'booking_page',
    booking_date: '2026-09-14',
    booking_model: 'unified_scheduling',
    experience_event_id: null,
    class_instance_id: null,
    resource_id: null,
    event_session_id: null,
    calendar_id: 'cal-1',
    service_item_id: 'svc-1',
    practitioner_id: null,
    appointment_service_id: null,
    group_booking_id: null,
    person_label: null,
    created_at: '2026-09-01T09:00:00.000Z',
    updated_at: '2026-09-01T09:00:00.000Z',
    ...over,
  };
}

describe('computeVenueBaselineMetrics no-show figure', () => {
  it('counts as the No-show rate card does: a visit once a day, every page read', async () => {
    const firstPage = [
      // A two-service visit the client missed: one no-show, not two.
      appointment('v1', { group_booking_id: 'visit', status: 'No-Show' }),
      appointment('v2', { group_booking_id: 'visit', status: 'No-Show' }),
      appointment('walk-in', { source: 'walk-in', status: 'No-Show' }),
      ...Array.from({ length: 997 }, (_, i) => appointment(`done-${i}`)),
    ];
    const secondPage = [appointment('late', { status: 'No-Show' }), appointment('booked', { status: 'Booked' })];
    const { db, calls } = makeRecordingDb((call) => {
      if (call.table !== 'bookings') return undefined;
      const range = call.filters.find((f) => f[0] === 'range') as [string, number, number];
      return { data: range[1] === 0 ? firstPage : secondPage };
    });

    const metrics = await computeVenueBaselineMetrics(db, 'venue-1', '2026-09-01', '2026-09-30');

    expect(metrics.no_show).toEqual({ no_show_count: 2, eligible_count: 999, rate_pct: 0.2 });
    expect(calls.filter((c) => c.table === 'bookings')).toHaveLength(2);
  });
});
