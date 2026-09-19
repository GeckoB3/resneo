import { describe, expect, it } from 'vitest';
import {
  countNoShowOutcomes,
  loadNoShowSeries,
  noShowSeriesByDay,
  type NoShowRow,
} from './no-show-series';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';

function row(id: string, over: Partial<NoShowRow> = {}): NoShowRow {
  return {
    id,
    status: 'Completed',
    source: 'booking_page',
    booking_date: '2026-09-14',
    group_booking_id: null,
    person_label: null,
    class_instance_id: null,
    ...over,
  };
}

describe('countNoShowOutcomes', () => {
  it('counts only bookings with an outcome, and leaves walk-ins out', () => {
    expect(
      countNoShowOutcomes([
        row('done'),
        row('started', { status: 'Seated' }),
        row('missed', { status: 'No-Show' }),
        row('still-booked', { status: 'Booked' }),
        row('cancelled', { status: 'Cancelled' }),
        row('walk-in', { status: 'No-Show', source: 'walk-in' }),
      ]),
    ).toEqual({ no_show_count: 1, eligible_count: 3 });
  });

  it('counts a multi-service visit once a day, attended if any service that day was', () => {
    expect(
      countNoShowOutcomes([
        // Missed both services.
        row('a1', { group_booking_id: 'a', status: 'No-Show' }),
        row('a2', { group_booking_id: 'a', status: 'No-Show' }),
        // Came for one, missed the other: attended.
        row('b1', { group_booking_id: 'b', status: 'Completed' }),
        row('b2', { group_booking_id: 'b', status: 'No-Show' }),
        // One visit over two days: each day on its own.
        row('c1', { group_booking_id: 'c', status: 'Completed', booking_date: '2026-09-14' }),
        row('c2', { group_booking_id: 'c', status: 'No-Show', booking_date: '2026-09-15' }),
      ]),
    ).toEqual({ no_show_count: 2, eligible_count: 4 });
  });

  it('counts each person in a party and each class in a cart on their own', () => {
    expect(
      countNoShowOutcomes([
        row('p1', { group_booking_id: 'party', person_label: 'Guest 1', status: 'No-Show' }),
        row('p2', { group_booking_id: 'party', person_label: 'Guest 2' }),
        row('k1', { group_booking_id: 'cart', class_instance_id: 'ci-1', status: 'No-Show' }),
        row('k2', { group_booking_id: 'cart', class_instance_id: 'ci-2', status: 'No-Show' }),
      ]),
    ).toEqual({ no_show_count: 3, eligible_count: 4 });
  });
});

describe('noShowSeriesByDay', () => {
  it('gives one row per appointment date with an outcome, oldest first, to 2 dp', () => {
    expect(
      noShowSeriesByDay([
        row('x1', { booking_date: '2026-09-16', status: 'No-Show' }),
        row('x2', { booking_date: '2026-09-16' }),
        row('x3', { booking_date: '2026-09-16' }),
        row('y1', { booking_date: '2026-09-14' }),
        // Nothing due yet on the 17th, so no point is drawn for it.
        row('z1', { booking_date: '2026-09-17', status: 'Booked' }),
      ]),
    ).toEqual([
      { period_start: '2026-09-14', no_show_count: 0, confirmed_at_time_count: 1, rate_pct: 0 },
      { period_start: '2026-09-16', no_show_count: 1, confirmed_at_time_count: 3, rate_pct: 33.33 },
    ]);
  });
});

describe('loadNoShowSeries', () => {
  it('reads the appointment dates in range, outcome statuses only, every page', async () => {
    const page = (start: number, n: number) =>
      Array.from({ length: n }, (_, i) => row(`b${start + i}`, { status: i === 0 ? 'No-Show' : 'Completed' }));
    const { db, calls } = makeRecordingDb((call) => {
      if (call.table !== 'bookings') return undefined;
      const range = call.filters.find((f) => f[0] === 'range') as [string, number, number];
      return { data: range[1] === 0 ? page(0, 1000) : page(1000, 10) };
    });

    const series = await loadNoShowSeries(db, { venueId: 'v1', from: '2026-09-01', to: '2026-09-30' });

    expect(series).toEqual([
      { period_start: '2026-09-14', no_show_count: 2, confirmed_at_time_count: 1010, rate_pct: 0.2 },
    ]);
    const first = calls[0]!;
    expect(first.filters).toContainEqual(['eq', 'venue_id', 'v1']);
    expect(first.filters).toContainEqual(['gte', 'booking_date', '2026-09-01']);
    expect(first.filters).toContainEqual(['lte', 'booking_date', '2026-09-30']);
    expect(first.filters).toContainEqual(['in', 'status', ['Seated', 'Completed', 'No-Show']]);
    expect(calls).toHaveLength(2);
  });

  it('throws when the read fails, so the route can answer 500', async () => {
    const { db } = makeRecordingDb((call) => (call.table === 'bookings' ? { error: { message: 'boom' } } : undefined));
    await expect(loadNoShowSeries(db, { venueId: 'v1', from: '2026-09-01', to: '2026-09-30' })).rejects.toThrow(
      'boom',
    );
  });
});
