import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRecordingDb, type RecordedCall } from '@/lib/testing/recording-supabase';
import { loadAccountHome, emptyAccountHome } from './account-home';

/**
 * P1-1 acceptance: the hub costs a bounded number of queries.
 *
 * A hub that costs one query per booking, or per venue, gets slower for
 * exactly the customers who use the product most, and it is the surface every
 * customer lands on. The fixture is the one the plan names: 100 bookings
 * across 4 venues.
 *
 * The other two acceptance points are here as well: an unauthenticated caller
 * is refused by the route (see `route.test.ts`), and a customer with nothing
 * gets a well-formed empty payload rather than a null, so the page branches on
 * counts rather than defending against null at every field.
 */

const USER = { id: 'user-1' };

function makeBookings(count: number, venueCount: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `b${i}`,
    venue_id: `v${i % venueCount}`,
    guest_id: `g${i % venueCount}`,
    // Half in the past, half in the future, so "next" is a real choice.
    booking_date: i % 2 === 0 ? '2026-09-10' : '2026-05-10',
    booking_time: `${String(8 + (i % 10)).padStart(2, '0')}:00:00`,
    booking_end_time: `${String(9 + (i % 10)).padStart(2, '0')}:00:00`,
    party_size: 2,
    status: 'Confirmed',
    booking_model: 'table_reservation',
    class_instance_id: null,
    experience_event_id: null,
    resource_id: null,
    group_booking_id: null,
  }));
}

const VENUES = Array.from({ length: 4 }, (_, i) => ({
  id: `v${i}`,
  name: `Venue ${i}`,
  slug: `venue-${i}`,
  timezone: 'Europe/London',
}));

const GUESTS = Array.from({ length: 4 }, (_, i) => ({ id: `g${i}`, venue_id: `v${i}` }));

function setup(opts: { bookings?: unknown[]; credits?: unknown[]; memberships?: unknown[] } = {}) {
  const responder = (call: RecordedCall) => {
    switch (call.table) {
      case 'guests_account_safe':
        return { data: GUESTS };
      case 'bookings_account_safe':
        return { data: opts.bookings ?? makeBookings(100, 4) };
      case 'venues':
        return { data: VENUES };
      case 'user_class_credit_balances':
        return { data: opts.credits ?? [] };
      case 'class_memberships':
        return { data: opts.memberships ?? [] };
      default:
        return undefined;
    }
  };
  const db = makeRecordingDb(responder);
  const session = {
    from: (t: string) => db.db.from(t),
    auth: { getUser: async () => ({ data: { user: USER }, error: null }) },
  } as never;
  return { db, session, admin: db.db };
}

/** 2026-06-01 12:00 UTC: after the May bookings, before the September ones. */
const NOW = Date.parse('2026-06-01T12:00:00Z');

describe('loadAccountHome query budget', () => {
  it('costs a bounded number of queries for 100 bookings across 4 venues', async () => {
    const { db, session, admin } = setup();
    await loadAccountHome(session, admin, NOW);

    const total = db.queryCount();
    expect(
      total,
      `100 bookings cost ${total} queries. Tables hit: ${db.calls.map((c) => c.table).join(', ')}`,
    ).toBeLessThan(12);
  });

  it('does not grow with the number of bookings', async () => {
    // The property that matters. If a per-row read came back, this quadruples.
    const small = setup({ bookings: makeBookings(4, 4) });
    await loadAccountHome(small.session, small.admin, NOW);
    const smallCount = small.db.queryCount();

    const large = setup({ bookings: makeBookings(400, 4) });
    await loadAccountHome(large.session, large.admin, NOW);

    expect(large.db.queryCount()).toBe(smallCount);
  });

  it('loads form links for the NEXT booking only, not for all of them', async () => {
    // Loading them for 100 bookings to render one would be the N+1 this
    // loader exists to avoid.
    const { db, session, admin } = setup();
    await loadAccountHome(session, admin, NOW);
    const formReads = db.calls.filter((c) => c.table === 'booking_form_links');
    expect(formReads.length).toBeLessThanOrEqual(1);
  });

  it('reads bookings through the account-safe view, never the base table', async () => {
    // P0-6: ownership is the database's business. A base-table read here would
    // quietly reintroduce an application-only filter.
    const { db, session, admin } = setup();
    await loadAccountHome(session, admin, NOW);
    expect(db.calls.some((c) => c.table === 'bookings_account_safe')).toBe(true);
    expect(db.calls.some((c) => c.table === 'bookings' && c.op === 'select')).toBe(false);
  });
});

describe('what the hub returns', () => {
  it('picks the next booking by INSTANT, not by date string', async () => {
    // Sorting on booking_date alone puts a 09:00 booking after an 18:00 one on
    // the same day, which is the class of bug P0-2 closed.
    const bookings = [
      { ...makeBookings(1, 1)[0], id: 'later', booking_date: '2026-09-10', booking_time: '18:00:00' },
      { ...makeBookings(1, 1)[0], id: 'sooner', booking_date: '2026-09-10', booking_time: '09:00:00' },
    ];
    const { session, admin } = setup({ bookings });
    const home = await loadAccountHome(session, admin, NOW);
    expect(home.next_booking?.id).toBe('sooner');
  });

  it('ignores bookings that have already finished', async () => {
    const past = makeBookings(4, 1).map((b) => ({ ...b, booking_date: '2026-05-10' }));
    const { session, admin } = setup({ bookings: past });
    const home = await loadAccountHome(session, admin, NOW);
    expect(home.next_booking).toBeNull();
    expect(home.upcoming_count).toBe(0);
  });

  it('counts upcoming bookings and lists each venue once', async () => {
    const { session, admin } = setup();
    const home = await loadAccountHome(session, admin, NOW);
    expect(home.upcoming_count).toBe(50);
    expect(home.venues.map((v) => v.name)).toEqual([
      'Venue 0',
      'Venue 1',
      'Venue 2',
      'Venue 3',
    ]);
  });

  it('summarises credits: total, venues, soonest expiry', async () => {
    const { session, admin } = setup({
      credits: [
        { venue_id: 'v0', credits_remaining: 5, expires_at: '2026-12-01T00:00:00Z' },
        { venue_id: 'v1', credits_remaining: 3, expires_at: '2026-07-01T00:00:00Z' },
        // Spent balances must not inflate the venue count.
        { venue_id: 'v2', credits_remaining: 0, expires_at: '2026-06-05T00:00:00Z' },
      ],
    });
    const home = await loadAccountHome(session, admin, NOW);
    expect(home.credits).toEqual({
      total_remaining: 8,
      venue_count: 2,
      next_expiry: '2026-07-01T00:00:00Z',
    });
  });

  it('counts only live memberships, and flags the ones cancelling', async () => {
    const { session, admin } = setup({
      memberships: [
        { status: 'active', cancel_at_period_end: false },
        { status: 'active', cancel_at_period_end: true },
        { status: 'trialing', cancel_at_period_end: false },
        { status: 'canceled', cancel_at_period_end: false },
      ],
    });
    const home = await loadAccountHome(session, admin, NOW);
    expect(home.memberships).toEqual({ active_count: 3, cancelling_count: 1 });
  });

  it('returns a well-formed EMPTY payload, never a null', async () => {
    // So the page branches on counts rather than defending against null at
    // every field.
    const { session, admin } = setup({ bookings: [], credits: [], memberships: [] });
    const home = await loadAccountHome(session, admin, NOW);
    expect(home).toEqual(emptyAccountHome());
    expect(home.next_booking).toBeNull();
    expect(home.venues).toEqual([]);
  });

  it('DEGRADES a failed credit read rather than failing the whole hub', async () => {
    // A customer's next appointment matters more than their credit total, and
    // one should not be able to hide the other.
    const { db, session, admin } = setup();
    db.inject((c) => c.table === 'user_class_credit_balances', { message: 'boom' });
    const home = await loadAccountHome(session, admin, NOW);
    expect(home.credits).toEqual({ total_remaining: 0, venue_count: 0, next_expiry: null });
    expect(home.next_booking).not.toBeNull();
  });
});
