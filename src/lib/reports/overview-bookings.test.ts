import { describe, expect, it } from 'vitest';
import { classifyNewBookings, countNewBookings, type NewBookingRow } from './new-bookings';
import {
  bookingHeadcount,
  bookingStatusForReport,
  buildOverviewBookingReports,
  summariseBookingActivity,
  summariseCancellations,
} from './overview-bookings';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';

const TZ = 'Europe/London';
const DAY = '2026-09-19';

function row(id: string, over: Partial<NewBookingRow> = {}): NewBookingRow {
  return {
    id,
    // 10:00 BST on Saturday 19 September 2026.
    created_at: '2026-09-19T09:00:00.000Z',
    status: 'Booked',
    source: 'booking_page',
    cancellation_actor_type: null,
    created_by_staff_id: null,
    created_by_linked_venue_id: null,
    group_booking_id: null,
    person_label: null,
    class_instance_id: null,
    class_recurring_reservation_id: null,
    party_size: 1,
    client_arrived_at: null,
    ...over,
  };
}

const classify = (rows: NewBookingRow[]) => classifyNewBookings(rows, { timeZone: TZ });
const visit = (group: string, statuses: string[], over: Partial<NewBookingRow> = {}) =>
  statuses.map((status, i) => row(`${group}-${i}`, { group_booking_id: group, status, ...over }));

describe('summariseBookingActivity', () => {
  it('counts exactly what the New bookings tab counts, a visit once', () => {
    const units = classify([
      // A three-service visit the team added by phone, all finished.
      ...visit('v1', ['Completed', 'Completed', 'Completed'], { source: 'phone', created_by_staff_id: 's1' }),
      row('solo'),
      // A party of three: one row per person.
      row('p1', { group_booking_id: 'party', person_label: 'Guest 1' }),
      row('p2', { group_booking_id: 'party', person_label: 'Guest 2' }),
      row('p3', { group_booking_id: 'party', person_label: 'Guest 3' }),
      // One class booking for four people.
      row('class', { class_instance_id: 'ci-1', party_size: 4 }),
      row('walk-in', { source: 'walk-in', status: 'Seated' }),
      row('linked', { source: 'phone', created_by_linked_venue_id: 'v2' }),
      row('pending', { status: 'Pending' }),
      row('lapsed', { status: 'Cancelled', cancellation_actor_type: 'system' }),
    ]);
    const summary = summariseBookingActivity(units, DAY, DAY);

    expect(summary.total_bookings_created).toBe(countNewBookings(units, DAY, DAY).total);
    expect(summary.total_bookings_created).toBe(8);
    expect(summary.by_channel).toEqual({ online: 5, team: 1, walk_in: 1, linked_venue: 1 });
    expect(summary.by_source).toEqual({ phone: 2, booking_page: 5, 'walk-in': 1 });
    // One place for the visit, three for the party, four for the class.
    expect(summary.covers_booked).toBe(1 + 1 + 3 + 4 + 1 + 1);
    // The visit (one person) and the walk-in.
    expect(summary.covers_seated).toBe(2);
    // One bar per booking; the booking still waiting for payment shows as Pending, the lapse nowhere.
    expect(summary.by_status).toEqual({ Completed: 1, Booked: 6, Seated: 1, Pending: 1 });
  });

  it('counts a place as seen once the client arrives, but never from a cancelled service', () => {
    const units = classify([
      row('arrived', { status: 'Confirmed', client_arrived_at: '2026-09-19T10:00:00.000Z' }),
      row('cancelled-after-arriving', {
        status: 'Cancelled',
        cancellation_actor_type: 'staff',
        client_arrived_at: '2026-09-19T10:00:00.000Z',
      }),
      ...visit('v1', ['Cancelled', 'Seated'], { cancellation_actor_type: 'staff' }),
    ]);
    const summary = summariseBookingActivity(units, DAY, DAY);
    expect(summary.total_bookings_created).toBe(3);
    expect(summary.covers_seated).toBe(2);
  });

  it('counts only bookings made on the venue days in range', () => {
    const units = classify([
      // 23:30 BST on the 18th.
      row('late-on-18th', { created_at: '2026-09-18T22:30:00.000Z' }),
      // 00:30 BST on the 19th, still the 18th in UTC.
      row('early-on-19th', { created_at: '2026-09-18T23:30:00.000Z' }),
    ]);
    expect(summariseBookingActivity(units, DAY, DAY).total_bookings_created).toBe(1);
    expect(summariseBookingActivity(units, '2026-09-18', DAY).total_bookings_created).toBe(2);
  });

  it('gives every channel a zero on a quiet range', () => {
    expect(summariseBookingActivity([], DAY, DAY)).toEqual({
      total_bookings_created: 0,
      by_source: {},
      by_channel: { online: 0, team: 0, walk_in: 0, linked_venue: 0 },
      by_status: {},
      covers_booked: 0,
      covers_seated: 0,
    });
  });
});

describe('bookingStatusForReport', () => {
  const statusOf = (rows: NewBookingRow[]) => bookingStatusForReport(classify(rows)[0]!);

  it('reads a visit as the lists show it', () => {
    expect(statusOf(visit('a', ['Completed', 'Booked']))).toBe('Booked');
    expect(statusOf(visit('b', ['Completed', 'Cancelled'], { cancellation_actor_type: 'customer' }))).toBe(
      'Completed',
    );
    expect(statusOf(visit('c', ['Seated', 'Booked']))).toBe('Seated');
    expect(statusOf(visit('d', ['No-Show', 'No-Show']))).toBe('No-Show');
    expect(statusOf(visit('e', ['No-Show', 'Cancelled'], { cancellation_actor_type: 'staff' }))).toBe('No-Show');
  });

  it('does not let a service waiting for payment hold back a booking on the books', () => {
    expect(statusOf(visit('a', ['Booked', 'Pending']))).toBe('Booked');
    expect(statusOf(visit('b', ['Pending', 'Pending']))).toBe('Pending');
    expect(statusOf([row('solo', { status: 'Confirmed' })])).toBe('Confirmed');
  });
});

describe('bookingHeadcount', () => {
  it('counts a visit or standing reservation once, and a lone booking by its party size', () => {
    const [v] = classify(visit('v', ['Booked', 'Booked', 'Booked']));
    expect(bookingHeadcount(v!)).toBe(1);
    const [standing] = classify([
      row('s1', { class_instance_id: 'ci-1', class_recurring_reservation_id: 'r', party_size: 2 }),
      row('s2', { class_instance_id: 'ci-2', class_recurring_reservation_id: 'r', party_size: 2 }),
    ]);
    expect(bookingHeadcount(standing!)).toBe(2);
    const [table] = classify([row('t', { party_size: 6 })]);
    expect(bookingHeadcount(table!)).toBe(6);
  });
});

describe('summariseCancellations', () => {
  it('rates the bookings made in range by who cancelled them, with lapses beside the rate', () => {
    const units = classify([
      ...['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((id) => row(id)),
      row('by-client', { status: 'Cancelled', cancellation_actor_type: 'customer' }),
      row('by-team-1', { status: 'Cancelled', cancellation_actor_type: 'staff' }),
      // No recorded actor: the client did not cancel it themselves.
      row('by-team-2', { status: 'Cancelled', cancellation_actor_type: null }),
      // The client cancelled one service, the team the rest: the client's cancellation.
      row('v1-a', { group_booking_id: 'v1', status: 'Cancelled', cancellation_actor_type: 'customer' }),
      row('v1-b', { group_booking_id: 'v1', status: 'Cancelled', cancellation_actor_type: 'staff' }),
      // One service cancelled, one still booked: the visit is still on the books.
      row('v2-a', { group_booking_id: 'v2', status: 'Cancelled', cancellation_actor_type: 'customer' }),
      row('v2-b', { group_booking_id: 'v2', status: 'Booked' }),
      row('lapsed', { status: 'Cancelled', cancellation_actor_type: 'system' }),
      row('pending', { status: 'Pending' }),
    ]);
    const counts = countNewBookings(units, DAY, DAY);
    const summary = summariseCancellations(units, DAY, DAY);

    expect(summary).toEqual({
      total_bookings_created: 11,
      cancelled_guest_initiated: 2,
      cancelled_team_initiated: 2,
      cancelled_auto: 1,
      cancellation_rate_pct: 36.36,
    });
    // The same bookings, and the same cancellations, as the New bookings tab.
    expect(summary.total_bookings_created).toBe(counts.total);
    expect(summary.cancelled_guest_initiated + summary.cancelled_team_initiated).toBe(counts.cancelled);
  });

  it('is zero, not a division by zero, on a quiet range', () => {
    expect(summariseCancellations([], DAY, DAY)).toEqual({
      total_bookings_created: 0,
      cancelled_guest_initiated: 0,
      cancelled_team_initiated: 0,
      cancelled_auto: 0,
      cancellation_rate_pct: 0,
    });
  });
});

describe('buildOverviewBookingReports', () => {
  it('builds both cards from one read of the venue-local window', async () => {
    const created = [
      row('solo'),
      row('cancelled', { status: 'Cancelled', cancellation_actor_type: 'customer' }),
      ...visit('v1', ['Booked', 'Booked']),
    ];
    const { db, calls } = makeRecordingDb((call) => {
      if (call.table === 'bookings' && call.columns?.startsWith('id, created_at')) return { data: created };
      return undefined;
    });

    const { activity, cancellation } = await buildOverviewBookingReports(db, {
      venueId: 'v1',
      timeZone: TZ,
      from: DAY,
      to: DAY,
    });

    expect(activity.total_bookings_created).toBe(3);
    expect(cancellation).toMatchObject({ total_bookings_created: 3, cancelled_guest_initiated: 1 });
    const reads = calls.filter((c) => c.table === 'bookings' && c.columns?.startsWith('id, created_at'));
    expect(reads).toHaveLength(1);
    expect(reads[0]!.columns).toContain('party_size');
    expect(reads[0]!.columns).toContain('client_arrived_at');
    expect(reads[0]!.filters).toContainEqual(['gte', 'created_at', '2026-09-18T23:00:00.000Z']);
  });
});
