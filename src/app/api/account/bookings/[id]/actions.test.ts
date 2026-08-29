import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { makeRecordingDb, type RecordedCall } from '@/lib/testing/recording-supabase';
import { RESCHEDULE_MODIFIABLE_STATUSES } from '@/lib/booking/guest-actions/reschedule';

/**
 * P2-1's acceptance: the four session-authenticated booking action routes.
 *
 * **The headline is 404, not 403.** A route that answered 403 for someone
 * else's booking would confirm to anyone walking booking ids that the id is
 * real, and the customer-visible difference between the two answers is nil.
 * `loadAndAuthoriseGuestBooking` is where that decision lives, and these tests
 * go through it for real rather than mocking the services, because the property
 * being asserted is precisely that the routes do not undo it.
 *
 * The second thing asserted is the one eight hand-written adapters would have
 * got wrong: deferred comms. `GuestActionResult` hands the closure back for the
 * route to schedule, and a route that forgets `after(...)` silently stops
 * sending a cancellation email while every other test still passes.
 */

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

const hoisted = vi.hoisted(() => ({
  admin: null as ReturnType<typeof makeRecordingDb> | null,
  session: null as ReturnType<typeof makeRecordingDb> | null,
  user: { id: 'user-1' } as { id: string } | null,
  /** Whether `bookings_account_safe` says the booking is the caller's. */
  owns: true,
  /** Closures handed to `after()`, so a route that forgets one is visible. */
  deferred: [] as Array<() => Promise<void>>,
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    // Recorded rather than run: these tests assert that the route SCHEDULED the
    // work, and running a cancellation email inside an auth test would be
    // asserting something else entirely.
    after: (cb: () => Promise<void>) => {
      hoisted.deferred.push(cb);
    },
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: hoisted.user }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
    },
    from: (table: string) => hoisted.session!.db.from(table),
    rpc: (fn: string, args?: unknown) => hoisted.session!.db.rpc(fn, args),
  }),
}));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: () => hoisted.admin!.db }));
vi.mock('@/lib/stripe', () => ({ stripe: { refunds: { create: vi.fn() } } }));

function baseBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING_ID,
    venue_id: 'venue-1',
    guest_id: 'guest-1',
    booking_date: '2026-09-04',
    booking_time: '09:00:00',
    booking_end_time: '09:30:00',
    party_size: 1,
    status: 'Booked',
    deposit_status: null,
    deposit_amount_pence: null,
    stripe_payment_intent_id: null,
    cancellation_deadline: '2026-09-03T09:00:00+00:00',
    confirm_token_hash: 'hashed',
    confirm_token_used_at: null,
    calendar_id: 'cal-1',
    service_item_id: 'svc-1',
    practitioner_id: null,
    appointment_service_id: null,
    class_instance_id: null,
    resource_id: null,
    experience_event_id: null,
    event_session_id: null,
    updated_at: '2026-08-01T10:00:00+00:00',
    guest_attendance_confirmed_at: null,
    ...overrides,
  };
}

/**
 * The venue row both surfaces read.
 *
 * `name` is not decoration: `cancelBookingForGuest` only builds a cancellation
 * email when it has both a guest and a named venue, so a venue fixture without
 * one produces a cancel that succeeds and schedules nothing. That is exactly
 * what the deferred-work test is looking for, and without the name it would
 * have reported a missing `after(...)` in a route that had one.
 */
const VENUE_ROW = {
  id: 'venue-1',
  name: 'E2E Salon',
  address: '1 High Street',
  phone: null,
  email: null,
  reply_to_email: null,
  feature_flags: {},
  timezone: 'Europe/London',
};

const GUEST_ROW = { id: 'guest-1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.test', phone: null };

/**
 * @param booking the row the ADMIN read returns, or null for "no such booking"
 * @param venue the venue row, whose `feature_flags` gate self-reschedule
 */
function setup(
  booking: Record<string, unknown> | null = baseBooking(),
  venue: Record<string, unknown> = VENUE_ROW,
) {
  hoisted.deferred = [];
  hoisted.user = { id: 'user-1' };
  hoisted.owns = true;

  hoisted.admin = makeRecordingDb((call: RecordedCall) => {
    if (call.table === 'bookings' && call.op === 'select') return { data: booking };
    if (call.table === 'venues' && call.op === 'select') return { data: venue };
    if (call.table === 'guests' && call.op === 'select') return { data: GUEST_ROW };
    return undefined;
  });

  hoisted.session = makeRecordingDb((call: RecordedCall) => {
    if (call.table === 'guests_account_safe') return { data: [{ id: 'guest-1', venue_id: 'venue-1' }] };
    if (call.table === 'bookings_account_safe') {
      return { data: hoisted.owns ? { id: BOOKING_ID } : null };
    }
    return undefined;
  });
}

const ROUTES = ['cancel', 'confirm', 'reschedule', 'reschedule-options'] as const;
type RouteName = (typeof ROUTES)[number];

/** The handler each route exports, and the method it answers on. */
const HANDLERS: Record<RouteName, { method: 'GET' | 'POST' }> = {
  cancel: { method: 'POST' },
  confirm: { method: 'POST' },
  reschedule: { method: 'POST' },
  'reschedule-options': { method: 'GET' },
};

async function callRoute(name: RouteName, body?: Record<string, unknown>, id = BOOKING_ID) {
  const mod = (await import(`./${name}/route`)) as Record<string, unknown>;
  const { method } = HANDLERS[name];
  const handler = mod[method] as (
    req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
  ) => Promise<Response>;

  const req = new NextRequest(`http://localhost:3000/api/account/bookings/${id}/${name}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  const res = await handler(req, { params: Promise.resolve({ id }) });
  return { res, json: (await res.json()) as Record<string, unknown> };
}

// The cancel service graph is large, and the first test to import it would
// otherwise be charged for the whole load and time out. Same reason as
// `account-routes-auth.test.ts` and the confirm characterisation suite.
beforeAll(async () => {
  await Promise.all(ROUTES.map((name) => import(`./${name}/route`)));
}, 120_000);

beforeEach(() => setup());

describe("someone else's booking is indistinguishable from one that does not exist", () => {
  for (const name of ROUTES) {
    it(`${name} returns 404, not 403, for a booking the caller does not own`, async () => {
      setup(baseBooking({ guest_id: 'someone-elses-guest' }));
      hoisted.owns = false;

      const { res, json } = await callRoute(name);
      expect(res.status, `${name} leaked existence with a ${res.status}`).toBe(404);
      expect(json.code).toBe('NOT_FOUND');
    });

    it(`${name} returns the same 404 for a booking that does not exist`, async () => {
      // The two answers must be identical, or the difference between them is
      // itself the existence check.
      setup(null);
      const { res, json } = await callRoute(name, {}, OTHER_ID);
      expect(res.status).toBe(404);
      expect(json.code).toBe('NOT_FOUND');
    });

    it(`${name} refuses an anonymous caller with 401`, async () => {
      setup();
      hoisted.user = null;
      const { res, json } = await callRoute(name);
      expect(res.status).toBe(401);
      expect(json.code).toBe('UNAUTHENTICATED');
      expect(json.error, 'P0-11 converged the customer API on one 401 literal').toBe('Unauthorised');
    });

    it(`${name} writes nothing when it refuses`, async () => {
      setup(baseBooking({ guest_id: 'someone-elses-guest' }));
      hoisted.owns = false;
      await callRoute(name);
      const writes = hoisted.admin!.calls.filter((c) => c.op !== 'select');
      expect(writes, `${name} wrote to the database for a booking it refused`).toEqual([]);
    });
  }

  it('the 404 is reached through the ownership read, not by accident', async () => {
    // Without this, a route that returned 404 because the whole fixture was
    // broken would look identical to one that authorised correctly.
    setup(baseBooking());
    hoisted.owns = false;
    await callRoute('confirm');

    const ownershipReads = hoisted.session!.calls.filter(
      (c) => c.table === 'bookings_account_safe',
    );
    expect(ownershipReads.length, 'the session client was never asked about ownership').toBe(1);
  });
});

describe('the routes carry the service result out intact', () => {
  it('confirm succeeds for the owner and schedules nothing it should not', async () => {
    setup(baseBooking({ status: 'Booked' }));
    const { res, json } = await callRoute('confirm');
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });

  it('cancel schedules the deferred notification rather than dropping it', async () => {
    // The failure this catches is silent: a route that omits `after(...)` still
    // returns 200 and still cancels the booking. Only the email disappears.
    setup(baseBooking({ status: 'Booked' }));
    const { res } = await callRoute('cancel');
    expect(res.status).toBe(200);
    expect(hoisted.deferred.length, 'cancel scheduled no deferred work').toBeGreaterThan(0);
  });

  it('sends no-store on every response, so a cancel is never read from cache', async () => {
    setup();
    for (const name of ROUTES) {
      const { res } = await callRoute(name);
      expect(res.headers.get('Cache-Control'), name).toBe('no-store');
    }
  });
});

describe('reschedule-options answers what a move would need', () => {
  it('says an appointment can be moved, and what the POST requires', async () => {
    setup(baseBooking({ calendar_id: 'cal-1', service_item_id: 'svc-1' }));
    const { res, json } = await callRoute('reschedule-options');

    expect(res.status).toBe(200);
    expect(json.can_reschedule).toBe(true);
    expect(json.blocked_reason).toBeNull();
    expect(json.required_fields).toEqual([
      'booking_date',
      'booking_time',
      'practitioner_id',
      'appointment_service_id',
    ]);
  });

  it('refuses a cancelled booking on its status, not on the venue setting', async () => {
    // Order matters: answering "the venue has turned changes off" would be a
    // wrong explanation of a right refusal.
    setup(baseBooking({ status: 'Cancelled' }));
    const { json } = await callRoute('reschedule-options');
    expect(json.can_reschedule).toBe(false);
    expect(json.blocked_reason).toBe('booking_status');
  });

  it('reports a venue that has turned self-service changes off', async () => {
    setup(baseBooking(), { feature_flags: { guest_self_reschedule: false }, timezone: 'Europe/London' });
    const { json } = await callRoute('reschedule-options');
    expect(json.can_reschedule).toBe(false);
    expect(json.blocked_reason).toBe('venue_disabled');
    expect(String(json.message)).toContain('not available for this venue');
  });

  it('says an event ticket cannot be moved at all', async () => {
    // The reschedule service handles resource and class bookings in its CDE
    // branch and appointments in its own; an event ticket matches neither and
    // would fall through to the table-reservation path. Offering the move
    // would be offering something that cannot work.
    setup(
      baseBooking({
        experience_event_id: 'event-1',
        calendar_id: null,
        service_item_id: null,
      }),
    );
    const { json } = await callRoute('reschedule-options');
    expect(json.booking_model).toBe('event_ticket');
    expect(json.can_reschedule).toBe(false);
    expect(json.blocked_reason).toBe('not_movable');
  });

  it('offers a move for exactly the statuses the reschedule action accepts', async () => {
    // Pinned to the shared constant, not to a list retyped here. The drift this
    // guards is an options endpoint that offers a move the POST then refuses,
    // or hides one it would have allowed.
    for (const status of RESCHEDULE_MODIFIABLE_STATUSES) {
      setup(baseBooking({ status }));
      const { json } = await callRoute('reschedule-options');
      expect(json.can_reschedule, `${status} should be movable`).toBe(true);
    }
    for (const status of ['Cancelled', 'Completed', 'No-Show']) {
      setup(baseBooking({ status }));
      const { json } = await callRoute('reschedule-options');
      expect(json.can_reschedule, `${status} should not be movable`).toBe(false);
      expect(json.blocked_reason).toBe('booking_status');
    }
  });

  it('returns no slots, because the booking flow owns availability', async () => {
    setup();
    const { json } = await callRoute('reschedule-options');
    expect(Object.keys(json)).not.toContain('slots');
    expect(Object.keys(json)).not.toContain('availability');
  });
});

describe('exactly one detail endpoint exists (P2-1 acceptance)', () => {
  it('no second booking detail route was added under /api/account', () => {
    // The plan called for `GET /api/account/bookings/[id]` before noticing that
    // `GET /api/v1/me/bookings/[id]` already existed. Two detail endpoints is
    // two shapes to keep in step and two places for AD9's DTO to drift.
    const accountDetail = path.join(
      process.cwd(),
      'src/app/api/account/bookings/[id]/route.ts',
    );
    const v1Detail = path.join(process.cwd(), 'src/app/api/v1/me/bookings/[id]/route.ts');
    expect(fs.existsSync(v1Detail), 'the v1 detail route should exist').toBe(true);
    expect(
      fs.existsSync(accountDetail),
      'a second detail endpoint was added; extend the v1 one instead',
    ).toBe(false);
  });

  it('the action routes are the four the plan names, and no more', () => {
    const dir = path.join(process.cwd(), 'src/app/api/account/bookings/[id]');
    const subroutes = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    // P0-3's `manage-link` was a fifth until P2-5 deleted it: once the portal
    // cancels and reschedules in place, nothing called it, and an
    // authenticated route minting a cancel-without-login token with no
    // consumer is a liability.
    expect(subroutes).toEqual(['cancel', 'confirm', 'reschedule', 'reschedule-options']);
  });
});
