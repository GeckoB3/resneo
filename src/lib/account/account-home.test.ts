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

describe('the hub LISTS what is coming, not just a count (P1-2)', () => {
  /** Four upcoming, one after another, so order and bounds are both visible. */
  function upcomingRun(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      ...makeBookings(1, 1)[0],
      id: `up-${i}`,
      booking_date: '2026-09-10',
      booking_time: `${String(9 + i).padStart(2, '0')}:00:00`,
      booking_end_time: `${String(10 + i).padStart(2, '0')}:00:00`,
    }));
  }

  it('returns the bookings AFTER the next one, in order', async () => {
    const { session, admin } = setup({ bookings: upcomingRun(4) });
    const home = await loadAccountHome(session, admin, NOW);
    expect(home.next_booking?.id).toBe('up-0');
    expect(home.upcoming_after_next.map((b) => b.id)).toEqual(['up-1', 'up-2', 'up-3']);
  });

  it('does not repeat the booking already on the card', async () => {
    // The card and the list are stacked, so a customer would see the same
    // appointment twice, once in detail and once again underneath it.
    const { session, admin } = setup({ bookings: upcomingRun(3) });
    const home = await loadAccountHome(session, admin, NOW);
    expect(home.upcoming_after_next.map((b) => b.id)).not.toContain(home.next_booking!.id);
  });

  it('bounds the list rather than printing a hundred bookings on the hub', async () => {
    const { session, admin } = setup({ bookings: upcomingRun(40) });
    const home = await loadAccountHome(session, admin, NOW);
    expect(home.upcoming_after_next).toHaveLength(4);
    // And the COUNT still speaks for all of them, which is what the link uses.
    expect(home.upcoming_count).toBe(40);
  });

  it('is empty when the next booking is the only one', async () => {
    const { session, admin } = setup({ bookings: upcomingRun(1) });
    const home = await loadAccountHome(session, admin, NOW);
    expect(home.upcoming_after_next).toEqual([]);
  });

  it('costs no extra queries, being a slice of rows already loaded', async () => {
    // P1-2's own acceptance is that the hub issues ONE round of queries. The
    // list is free because `loadAccountBookings` already returned these rows
    // and the count was computed from the same array; a version that fetched
    // them again would show up as a query count that grows with the bookings.
    const one = setup({ bookings: upcomingRun(1) });
    await loadAccountHome(one.session, one.admin, NOW);
    const many = setup({ bookings: upcomingRun(40) });
    await loadAccountHome(many.session, many.admin, NOW);
    expect(many.db.calls.length).toBe(one.db.calls.length);
  });
});

describe('the hub surfaces an unpaid balance (P1-2)', () => {
  function owing(overrides: Record<string, unknown>) {
    return {
      ...makeBookings(1, 1)[0],
      id: 'owing',
      booking_date: '2026-09-10',
      booking_time: '09:00:00',
      booking_end_time: '10:00:00',
      ...overrides,
    };
  }

  it('lists a booking that is unpaid AND has a balance', async () => {
    const { session, admin } = setup({
      bookings: [owing({ payment_state: 'unpaid', booking_total_price_pence: 4000, amount_paid_pence: 0 })],
    });
    const home = await loadAccountHome(session, admin, NOW);
    expect(home.outstanding_payments.map((b) => b.id)).toEqual(['owing']);
  });

  it('lists one that is part paid, with the remainder still owing', async () => {
    const { session, admin } = setup({
      bookings: [
        owing({ payment_state: 'deposit_paid', booking_total_price_pence: 4000, amount_paid_pence: 1000 }),
      ],
    });
    const home = await loadAccountHome(session, admin, NOW);
    expect(home.outstanding_payments).toHaveLength(1);
  });

  it('does NOT list a free booking, though its state is unpaid', async () => {
    /*
      The column defaults to `unpaid` and a booking with no price never leaves
      it, so keying on the state alone would put every free class on a list
      headed "you still owe money".
    */
    const { session, admin } = setup({
      bookings: [owing({ payment_state: 'unpaid', booking_total_price_pence: 0, amount_paid_pence: 0 })],
    });
    const home = await loadAccountHome(session, admin, NOW);
    expect(home.outstanding_payments).toEqual([]);
  });

  it('does not list one that is paid in full', async () => {
    const { session, admin } = setup({
      bookings: [owing({ payment_state: 'paid', booking_total_price_pence: 4000, amount_paid_pence: 4000 })],
    });
    const home = await loadAccountHome(session, admin, NOW);
    expect(home.outstanding_payments).toEqual([]);
  });

  it('does not list a refunded one, whatever the cached total says', async () => {
    // The other half of the guard: a balance alone would list this.
    const { session, admin } = setup({
      bookings: [owing({ payment_state: 'refunded', booking_total_price_pence: 4000, amount_paid_pence: 0 })],
    });
    const home = await loadAccountHome(session, admin, NOW);
    expect(home.outstanding_payments).toEqual([]);
  });

  it('does not chase a balance on a booking that has already happened', async () => {
    // Settled with the venue, and the portal has no way to pay one, so it
    // would be an anxiety line with nothing a customer could do about it.
    const { session, admin } = setup({
      bookings: [
        owing({
          booking_date: '2026-05-10',
          payment_state: 'unpaid',
          booking_total_price_pence: 4000,
          amount_paid_pence: 0,
        }),
      ],
    });
    const home = await loadAccountHome(session, admin, NOW);
    expect(home.outstanding_payments).toEqual([]);
  });

  it('carries the payment columns through the loader at all', async () => {
    /*
      The trap this repo has hit before: a new field needs the PROJECTION, the
      row type and the mapper. Miss the projection and every row reads
      undefined, which `hasOutstandingBalance` reads as nothing owed, so the
      feature is silently off and every test above still passes on fixtures
      that bypass the projection.
    */
    const { session, admin, db } = setup({ bookings: [owing({ payment_state: 'unpaid' })] });
    await loadAccountHome(session, admin, NOW);
    const read = db.calls.find((c) => c.table === 'bookings_account_safe' && c.op === 'select');
    expect(read?.columns).toContain('payment_state');
    expect(read?.columns).toContain('booking_total_price_pence');
    expect(read?.columns).toContain('amount_paid_pence');
  });
});
