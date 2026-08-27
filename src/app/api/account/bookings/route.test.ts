import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRecordingDb, type RecordedCall } from '@/lib/testing/recording-supabase';

/**
 * The acceptance test for P0-3: the booking list must be bounded and read-only.
 *
 * Before this task, `hydrateAccountBookingRow` ran per row. Each row resolved
 * its CDE context with one to three reads AND minted a `booking_short_links`
 * row, so a hundred bookings meant several hundred queries and a hundred writes
 * on a GET. Worse, that write could throw: a concurrent insert violated the
 * partial unique index on (booking_id, purpose), the retry loop generated a
 * fresh `code` and collided identically twelve times, and the unguarded throw
 * inside `Promise.all` cost the customer their whole booking history.
 *
 * The repo had no query-count assertion before this file, which is why the
 * regression was invisible. It uses P0-0's recorder rather than
 * `supabase-fake.ts`, which is read-only and so cannot see the writes this
 * task removes.
 *
 * One recorder serves both the session client and the admin client on purpose:
 * the number that matters to a customer waiting for the page is the total.
 */

const hoisted = vi.hoisted(() => ({
  db: null as ReturnType<typeof makeRecordingDb> | null,
  user: { id: 'user-1' } as { id: string } | null,
}));

vi.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClient: async () => ({
    from: (table: string) => hoisted.db!.db.from(table),
    auth: { getUser: async () => ({ data: { user: hoisted.user }, error: null }) },
  }),
}));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: () => hoisted.db!.db }));

import { GET } from './route';

// ── Fixtures: 100 bookings over a deliberately small set of foreign keys, so
//    that a per-row loader and a batched one differ by two orders of magnitude.
const GUESTS = [
  { id: 'g1', venue_id: 'v1' },
  { id: 'g2', venue_id: 'v2' },
];

const VENUES = [
  { id: 'v1', name: 'The Wharf', slug: 'the-wharf', timezone: 'Europe/London' },
  // Deliberately a different zone: it is what makes the starts_at assertions
  // below able to fail if the instant were built in the server's zone (P0-2).
  { id: 'v2', name: 'Northside Studio', slug: 'northside', timezone: 'Australia/Sydney' },
  { id: 'v3', name: 'Zoneless Rooms', slug: 'zoneless', timezone: null },
];

/** 40 event rows on 2 events, 30 class rows on 3 instances, 20 resource rows on 2 resources, 10 tables. */
function makeBookings() {
  const rows: Record<string, unknown>[] = [];
  const base = (i: number) => ({
    id: `b${i}`,
    venue_id: i % 2 === 0 ? 'v1' : 'v2',
    guest_id: i % 2 === 0 ? 'g1' : 'g2',
    booking_date: '2026-09-01',
    booking_time: '18:00:00',
    booking_end_time: '19:30:00',
    party_size: 2,
    status: 'Confirmed',
    booking_model: 'table_reservation',
    class_instance_id: null,
    experience_event_id: null,
    resource_id: null,
    group_booking_id: null,
  });
  for (let i = 0; i < 40; i++) {
    rows.push({ ...base(i), booking_model: 'event_ticket', experience_event_id: `e${i % 2}` });
  }
  for (let i = 40; i < 70; i++) {
    rows.push({ ...base(i), booking_model: 'class_session', class_instance_id: `ci${i % 3}` });
  }
  for (let i = 70; i < 90; i++) {
    rows.push({ ...base(i), booking_model: 'resource_booking', resource_id: `r${i % 2}` });
  }
  for (let i = 90; i < 100; i++) rows.push(base(i));
  return rows;
}

const BOOKINGS = makeBookings();

const EVENTS = [
  { id: 'e0', name: 'Wine Tasting', end_time: '21:00:00' },
  { id: 'e1', name: 'Supper Club', end_time: null },
];

const TICKET_LINES = [
  { booking_id: 'b0', label: 'Adult', quantity: 2, unit_price_pence: 3500 },
  { booking_id: 'b0', label: 'Child', quantity: 1, unit_price_pence: 1500 },
  // A cancelled tier: dropped, as the per-row builder dropped it.
  { booking_id: 'b0', label: 'Standing', quantity: 0, unit_price_pence: 2000 },
];

const INSTANCES = [
  { id: 'ci0', start_time: '09:30:00', class_type_id: 'ct0', capacity_override: null },
  { id: 'ci1', start_time: '18:15:00', class_type_id: 'ct1', capacity_override: 8 },
  { id: 'ci2', start_time: null, class_type_id: 'ct0', capacity_override: null },
];

const CLASS_TYPES = [
  { id: 'ct0', name: 'Reformer Pilates', capacity: 12 },
  { id: 'ct1', name: 'Barre', capacity: 20 },
];

/** r0 and r1 are the booked resources; cal9 is a host calendar nothing books directly. */
const CALENDARS = [
  { id: 'r0', name: 'Treatment Room 1', display_on_calendar_id: 'cal9' },
  { id: 'r1', name: 'Treatment Room 2', display_on_calendar_id: 'r0' },
  { id: 'cal9', name: 'Main Diary', display_on_calendar_id: null },
];

function inFilter(call: RecordedCall, column: string): string[] | null {
  const f = call.filters.find((x) => x[0] === 'in' && x[1] === column);
  return f ? (f[2] as string[]) : null;
}

function responder(call: RecordedCall) {
  switch (call.table) {
    case 'guests_account_safe':
      return { data: GUESTS };
    case 'bookings_account_safe':
      return { data: BOOKINGS };
    case 'venues':
      return { data: VENUES };
    case 'experience_events':
      return { data: EVENTS };
    case 'booking_ticket_lines':
      return { data: TICKET_LINES };
    case 'class_instances':
      return { data: INSTANCES };
    case 'class_types':
      return { data: CLASS_TYPES };
    case 'unified_calendars': {
      const ids = inFilter(call, 'id') ?? [];
      return { data: CALENDARS.filter((c) => ids.includes(c.id)) };
    }
    default:
      return undefined;
  }
}

async function listBookings() {
  const res = await GET(new Request('http://localhost:3000/api/account/bookings'));
  return { res, body: (await res.json()) as { bookings?: Record<string, unknown>[]; error?: string } };
}

describe('GET /api/account/bookings', () => {
  beforeEach(() => {
    hoisted.user = { id: 'user-1' };
    hoisted.db = makeRecordingDb(responder);
  });

  it('loads 100 bookings in under 10 queries', async () => {
    const { res, body } = await listBookings();
    expect(res.status).toBe(200);
    expect(body.bookings).toHaveLength(100);

    // Nine: guests, bookings, venues, events, ticket lines, class instances,
    // resources, class types, host calendars. It does not grow with row count.
    const total = hoisted.db!.queryCount();
    expect(
      total,
      `100 bookings issued ${total} queries. Tables hit: ` +
        `${hoisted.db!.calls.map((c) => c.table).join(', ')}`,
    ).toBeLessThan(10);

    // And each lookup is issued exactly once, rather than once per row.
    for (const table of [
      'experience_events',
      'booking_ticket_lines',
      'class_instances',
      'class_types',
    ]) {
      expect(hoisted.db!.queryCount({ table }), `${table} should be read once`).toBe(1);
    }
  });

  it('scales: 400 bookings cost the same as 100', async () => {
    // The point of the bound. If a per-row read came back, this doubles.
    const many = [0, 1, 2, 3].flatMap((n) =>
      BOOKINGS.map((b, i) => ({ ...b, id: `x${n}-${i}` })),
    );
    hoisted.db = makeRecordingDb((call) =>
      call.table === 'bookings_account_safe' ? { data: many } : responder(call),
    );
    const { res, body } = await listBookings();
    expect(res.status).toBe(200);
    expect(body.bookings).toHaveLength(400);
    expect(hoisted.db!.queryCount()).toBeLessThan(10);
  });

  it('WRITES NOTHING: a GET issues no insert, update, upsert or delete', async () => {
    // The specific regression: a short-link row was minted per booking on every
    // list render. Asserted over every write verb rather than just insert,
    // because the renew path in createOrGetBookingShortLink was an update.
    await listBookings();
    for (const op of ['insert', 'update', 'upsert', 'delete'] as const) {
      expect(
        hoisted.db!.calls.filter((c) => c.op === op),
        `a read path performed a ${op}`,
      ).toEqual([]);
    }
    expect(hoisted.db!.calls.some((c) => c.table === 'booking_short_links')).toBe(false);
  });

  it('drops manage_booking_link from the row', async () => {
    // The one sanctioned C13 exception, taken before the rule binds: the link
    // is minted on intent by POST /api/account/bookings/[id]/manage-link. Safe
    // because the shipped app never calls GET /api/v1/me/bookings.
    const { body } = await listBookings();
    expect(body.bookings!.every((b) => !('manage_booking_link' in b))).toBe(true);
  });

  it('builds the same CDE context the per-row resolver built', async () => {
    const { body } = await listBookings();
    const byId = new Map(body.bookings!.map((b) => [b.id as string, b]));

    // Event: title, "Ends HH:MM", and only the non-zero ticket tiers.
    expect(byId.get('b0')!.cde_context).toEqual({
      inferred_model: 'event_ticket',
      title: 'Wine Tasting',
      subtitle: 'Ends 21:00',
      ticket_lines: [
        { label: 'Adult', quantity: 2, unit_price_pence: 3500 },
        { label: 'Child', quantity: 1, unit_price_pence: 1500 },
      ],
    });
    // An event with no end time gets a null subtitle, not "Ends null".
    expect(byId.get('b1')!.cde_context).toMatchObject({ title: 'Supper Club', subtitle: null });
    // And a row with no ticket lines simply omits them.
    expect(byId.get('b2')!.cde_context).not.toHaveProperty('ticket_lines');

    // Class: the type's name, the instance's start, and NO spots on the list
    // path (that read belongs to the detail page).
    // b40 -> ci1 -> ct1, b41 -> ci2 -> ct0 (no start time), b42 -> ci0 -> ct0.
    expect(byId.get('b40')!.cde_context).toEqual({
      inferred_model: 'class_session',
      title: 'Barre',
      subtitle: 'Starts 18:15',
    });
    expect(byId.get('b42')!.cde_context).toMatchObject({
      title: 'Reformer Pilates',
      subtitle: 'Starts 09:30',
    });
    // An instance with no start time gets a null subtitle, not "Starts null".
    expect(byId.get('b41')!.cde_context).toMatchObject({ subtitle: null });

    // Resource: name, host calendar name, duration from start/end.
    expect(byId.get('b70')!.cde_context).toEqual({
      inferred_model: 'resource_booking',
      title: 'Treatment Room 1',
      subtitle: 'Main Diary',
      duration_minutes: 90,
    });
    // r1's host is r0, already fetched: resolved without a third lookup.
    expect(byId.get('b71')!.cde_context).toMatchObject({
      title: 'Treatment Room 2',
      subtitle: 'Treatment Room 1',
    });

    // Table rows have no CDE context at all.
    expect(byId.get('b90')!.cde_context).toBeNull();
    expect(byId.get('b90')!.venue).toMatchObject({ name: 'The Wharf' });
  });

  it('DEGRADES a failed lookup instead of failing the list (G4a)', async () => {
    // A class type that cannot be read costs those rows their title. It must
    // not cost the customer the ability to see and cancel their bookings.
    hoisted.db = makeRecordingDb(responder);
    hoisted.db.inject((c) => c.table === 'class_types', { message: 'boom' });

    const { res, body } = await listBookings();
    expect(res.status).toBe(200);
    expect(body.bookings).toHaveLength(100);

    const byId = new Map(body.bookings!.map((b) => [b.id as string, b]));
    expect(byId.get('b40')!.cde_context).toMatchObject({ title: 'Class' });
    // Everything not behind that lookup is untouched.
    expect(byId.get('b0')!.cde_context).toMatchObject({ title: 'Wine Tasting' });
    expect(byId.get('b70')!.cde_context).toMatchObject({ title: 'Treatment Room 1' });
  });

  it('still fails loudly when the OWNERSHIP read fails', async () => {
    // The opposite policy, deliberately. Degrading here would show a customer
    // an empty list and let them believe they have no bookings.
    hoisted.db = makeRecordingDb(responder);
    hoisted.db.inject((c) => c.table === 'bookings_account_safe', { message: 'denied' });
    const { res } = await listBookings();
    expect(res.status).toBe(500);
  });

  it('carries the booking instant, not just wall-clock strings (P0-2, C10)', async () => {
    // booking_date + booking_time have no zone in them, so every client that
    // gets only those has to know the venue's timezone and apply the DST rule
    // itself. That is how the web surface got it wrong for two years; shipping
    // the same two strings to the mobile app would invite it again.
    const { body } = await listBookings();
    const byId = new Map(body.bookings!.map((b) => [b.id as string, b]));

    // b0 is on v1 (London, BST in September): 18:00 local is 17:00 UTC.
    expect(byId.get('b0')).toMatchObject({
      time_zone: 'Europe/London',
      starts_at: '2026-09-01T18:00:00+01:00',
      ends_at: '2026-09-01T19:30:00+01:00',
    });
    // b1 is on v2 (Sydney, AEST in September): the same wall time, ten hours
    // earlier in UTC. Identical booking_date and booking_time, different
    // instant, which is precisely the information the wall-clock pair loses.
    expect(byId.get('b1')).toMatchObject({
      time_zone: 'Australia/Sydney',
      starts_at: '2026-09-01T18:00:00+10:00',
    });
    expect(Date.parse(byId.get('b1')!.starts_at as string)).toBeLessThan(
      Date.parse(byId.get('b0')!.starts_at as string),
    );

    // Every row carries them, and they round-trip to a real instant.
    for (const b of body.bookings!) {
      expect(typeof b.starts_at).toBe('string');
      expect(Number.isNaN(Date.parse(b.starts_at as string)), b.id as string).toBe(false);
    }
  });

  it('falls back to London for a venue with no timezone', async () => {
    hoisted.db = makeRecordingDb((call) =>
      call.table === 'bookings_account_safe'
        ? { data: [{ ...BOOKINGS[90], id: 'z1', venue_id: 'v3' }] }
        : responder(call),
    );
    const { body } = await listBookings();
    expect(body.bookings![0]).toMatchObject({
      time_zone: 'Europe/London',
      starts_at: '2026-09-01T18:00:00+01:00',
    });
  });

  it('rejects an anonymous caller before reading anything', async () => {
    hoisted.user = null;
    const { res, body } = await listBookings();
    expect(res.status).toBe(401);
    expect(body).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(hoisted.db!.calls).toEqual([]);
  });
});
