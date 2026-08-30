/**
 * P0-9 characterisation: POST /api/confirm, action=modify (19 rows) plus the
 * 2 cross-cutting rows. Completes the 41-row matrix.
 *
 * Describes the route AS IT IS. Two rows deliberately freeze behaviour the
 * plan calls wrong rather than fixing it here: row 17 (an event ticket falls
 * through to the table branch) and row 12 (the token is NOT consumed on
 * modify, which is correct and must stay that way). Characterisation records
 * what is; P0-4 preserves it; changing it needs its own reviewed commit.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import {
  FIXED_NOW,
  IDS,
  baseBooking,
  freeze,
  makeAdminDb,
  makeCallLog,
  makeRequest,
  expectFrozen,
  type Frozen,
  type RunOptions,
} from './harness';
import { makeRecordingDb, PG_ERRORS } from '@/lib/testing/recording-supabase';
import { SLOT_TAKEN_RESPONSE } from '@/lib/booking/revalidate-appointment-slot';

const hoisted = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('@/lib/testing/recording-supabase').makeRecordingDb> | null,
  log: null as ReturnType<typeof import('./harness').makeCallLog> | null,
  /** guest_self_reschedule on the venue. */
  rescheduleEnabled: true,
  /** Availability engine the venue resolves to ('service' is required by tables). */
  availabilityEngine: 'service' as string,
  /** Appointment engine: does the requested slot exist? */
  apptSlotAvailable: true,
  /** Optimistic-lock outcome: false makes the guarded UPDATE match no row. */
  updateMatches: true,
  /** Postgres error to raise from the guarded UPDATE, if any. */
  updateError: null as { code: string; message: string } | null,
  compliance: { blocked: false, body: {} as Record<string, unknown> },
  /** CDE validation for the class branch. */
  classValidation: { ok: true, reason: '' },
  largeParty: false,
  tableSlotFound: true,
  /**
   * Collects the promises deferred work returns. The route calls `after(cb)`
   * WITHOUT awaiting it, so a callback's promise floats: freezing the response
   * immediately would race the comms it triggered, and the assertion would
   * flap rather than fail honestly. `run()` awaits these before freezing.
   */
  afterPromises: [] as Promise<unknown>[],
  afterStub: vi.fn((cb: () => unknown) => {
    const p = Promise.resolve(cb());
    return p;
  }),
}));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (cb: () => unknown) => {
    const p = Promise.resolve(cb());
    hoisted.afterPromises.push(p);
    return p;
  },
}));

vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: () => hoisted.db!.db }));
vi.mock('@/lib/confirm-token', () => ({ verifyConfirmToken: () => true }));
vi.mock('@/lib/short-manage-link', () => ({ verifyBookingHmac: () => true }));
vi.mock('@/lib/observability/booking-ops-log', () => ({
  logBookingOp: (...args: unknown[]) => hoisted.log!.record('booking-ops-log', 'logBookingOp')(...args),
}));

vi.mock('@/lib/venue-mode', () => ({
  resolveVenueMode: () =>
    Promise.resolve({ availabilityEngine: hoisted.availabilityEngine, bookingModel: 'unified_scheduling', enabledModels: [] }),
}));

// The feature gate: the route calls assertAppointmentsFeatureEnabled and turns
// a throw into 403 feature_disabled, with DIFFERENT copy per model.
vi.mock('@/lib/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    parseVenueFeatureFlags: () => ({ guest_self_reschedule: hoisted.rescheduleEnabled }),
    assertAppointmentsFeatureEnabled: (feature: string) => {
      hoisted.log!.record('feature-flags', 'assertAppointmentsFeatureEnabled')(feature);
      if (!hoisted.rescheduleEnabled) throw new Error('feature disabled');
    },
  };
});

vi.mock('@/lib/compliance/enforce-booking', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>().catch(() => ({}));
  return {
    ...actual,
    enforceBookingCompliance: (...args: unknown[]) => {
      hoisted.log!.record('compliance', 'enforceBookingCompliance')(args[1]);
      return Promise.resolve(hoisted.compliance);
    },
  };
});

// Appointment engine.
vi.mock('@/lib/availability/appointment-engine', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchAppointmentInput: () =>
      Promise.resolve({
        services: [{ id: 'svc-new', duration_minutes: 30, buffer_minutes: 0, name: 'New Service' }],
        practitionerServices: [],
        practitioners: [],
        // The route filters the booking under change out of this list before
        // recomputing, so it must be a real array.
        existingBookings: [],
        bookings: [],
      }),
    computeAppointmentAvailability: () => ({
      practitioners: hoisted.apptSlotAvailable
        ? [{ id: 'cal-new', slots: [{ start_time: '11:00', service_id: 'svc-new' }] }]
        : [{ id: 'cal-new', slots: [] }],
    }),
    attachVenueClockToAppointmentInput: () => undefined,
  };
});

vi.mock('@/lib/appointments/merge-service-with-overrides', () => ({
  mergeAppointmentServiceWithPractitionerLink: (base: unknown) => base,
}));

// Table engine.
vi.mock('@/lib/availability', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchEngineInput: () => Promise.resolve({ bookings: [] }),
    computeAvailability: () => [
      {
        slots: hoisted.tableSlotFound ? [{ time: '11:00', available: true }] : [],
        large_party_redirect: hoisted.largeParty,
        large_party_message: hoisted.largeParty ? 'Please call us for a party this size.' : null,
      },
    ],
  };
});

// Dynamic imports on every modify success path.
vi.mock('@/lib/booking/log-booking-modified-event', () => ({
  logBookingModifiedEvent: (...args: unknown[]) =>
    hoisted.log!.record('booking-modified-event', 'logBookingModifiedEvent')(args[1]),
}));
vi.mock('@/lib/booking/send-booking-modification-guest-notification', () => ({
  executeBookingModificationGuestNotification: (...args: unknown[]) =>
    hoisted.log!.record('modification-comms', 'executeBookingModificationGuestNotification')(args[1]),
}));

const VENUE_ROW = {
  name: 'Char Venue',
  timezone: 'Europe/London',
  feature_flags: { guest_self_reschedule: true },
  booking_rules: { cancellation_notice_hours: 48 },
  address: null,
  phone: null,
  email: null,
  reply_to_email: null,
};

/**
 * Compile the route's module graph before any row runs.
 *
 * `run()` dynamically imports the route, and the FIRST import pays for the
 * whole graph: the three guest-action services and everything they pull in.
 * That landed on row 1 and pushed it past vitest's 5s default under a loaded
 * full-suite run, so these files failed intermittently while passing on their
 * own. Warming it here costs the same time in a hook with its own budget and
 * attributes it honestly, rather than hiding it behind a larger per-test
 * timeout.
 */
beforeAll(async () => {
  await import('../route');
}, 60_000);

async function run(opts: Omit<RunOptions, 'action'>) {
  const tables: Record<string, unknown> = { venues: VENUE_ROW, guests: {}, ...(opts.tables ?? {}) };
  hoisted.db = makeRecordingDb((call) => {
    if (call.table === 'bookings' && call.op === 'select') {
      return opts.booking
        ? { data: opts.booking }
        : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    }
    // The guarded UPDATE is `.eq('updated_at', prev).select('id').maybeSingle()`:
    // it returns the row when the lock held and NOTHING when someone else wrote
    // first, which is how the route reaches 412. Returning null unconditionally
    // would make every success path look like a lost update.
    if (call.table === 'bookings' && call.op === 'update') {
      return hoisted.updateMatches ? { data: { id: IDS.booking } } : { data: null };
    }
    /*
      P2-3a moved the APPOINTMENT branch's guarded UPDATE into
      `claim_appointment_slot`, so that the advisory lock, the capacity count
      and the write share one transaction. The optimistic lock moved with it,
      from `.eq('updated_at', prev)` into `p_expected_updated_at`, so
      `updateMatches` still means the same thing: did the guarded write find
      its row. The CDE branches above still use `.update()` and are unchanged.

      A SETOF function returns an ARRAY, where maybeSingle() returned an
      object. Returning an object here would let the route's Array.isArray
      unwrapping be wrong and this suite still pass.
    */
    if (call.table === 'rpc:claim_appointment_slot') {
      if (hoisted.updateError) return { data: null, error: hoisted.updateError };
      return hoisted.updateMatches ? { data: [{ id: IDS.booking }] } : { data: [] };
    }
    if (call.op !== 'select') return { data: null, error: null };
    const row = tables[call.table];
    return row === undefined ? undefined : { data: row };
  });
  hoisted.log = makeCallLog();
  const { POST } = await import('../route');
  const res = await POST(makeRequest({ ...opts, action: 'modify' }));
  // Deferred work must finish before we freeze what it caused.
  await Promise.allSettled(hoisted.afterPromises);
  return freeze(res, hoisted.db, hoisted.log);
}

/**
 * The appointment branch's write, expressed as COLUMNS.
 *
 * P2-3a moved that write from a PostgREST `.update()` into
 * `claim_appointment_slot`, so the columns are now split across the function's
 * routing arguments and its `p_patch`. The rows below assert WHICH COLUMNS GET
 * WHICH VALUES, which is behaviour and unchanged; reading the raw payload
 * would couple them to the transport, which is the reviewed change.
 */
function apptWrite(frozen: Frozen): Record<string, unknown> {
  const claim = frozen.dbWrites.find((w) => w.table === 'rpc:claim_appointment_slot');
  const args = (claim?.payload ?? {}) as Record<string, unknown>;
  return {
    booking_date: args.p_booking_date,
    booking_time: args.p_booking_time,
    calendar_id: args.p_calendar_id,
    practitioner_id: args.p_practitioner_id,
    ...((args.p_patch ?? {}) as Record<string, unknown>),
  };
}

/** The body a valid appointment reschedule sends. */
const APPT_BODY = {
  booking_date: '2026-06-12',
  booking_time: '11:00',
  practitioner_id: 'cal-new',
  appointment_service_id: 'svc-new',
  party_size: 1,
};

/**
 * Every flag back to the happy path, and the clock pinned. Shared so the P2-3a
 * describe at the foot of this file starts from the same known state: a row
 * that inherited a leftover flag would pass or fail for the wrong reason.
 */
function resetToHappyPath() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_NOW));
  hoisted.rescheduleEnabled = true;
  hoisted.availabilityEngine = 'service';
  hoisted.apptSlotAvailable = true;
  hoisted.updateMatches = true;
  hoisted.updateError = null;
  hoisted.compliance = { blocked: false, body: {} };
  hoisted.classValidation = { ok: true, reason: '' };
  hoisted.largeParty = false;
  hoisted.tableSlotFound = true;
  hoisted.afterPromises = [];
}

describe('POST /api/confirm - action=modify + cross-cutting (P0-9, 21 rows)', () => {
  beforeEach(resetToHappyPath);
  afterEach(() => vi.useRealTimers());

  // ── Guards shared by every model ────────────────────────────────────────
  it('row 1: a status outside Booked|Confirmed|Pending is refused', async () => {
    const frozen = await run({ booking: baseBooking({ status: 'Cancelled' }), body: APPT_BODY });
    expectFrozen(frozen, { status: 400 });
    expect(frozen.dbWrites).toEqual([]);
    expect(frozen).toMatchSnapshot();
  });

  it('row 2: appointment with the flag off is 403 with APPOINTMENT copy', async () => {
    hoisted.rescheduleEnabled = false;
    const frozen = await run({ booking: baseBooking(), body: APPT_BODY });
    expectFrozen(frozen, { status: 403 });
    const body = frozen.body as { error: string; code: string; feature: string };
    expect(body.code).toBe('feature_disabled');
    expect(body.error).toContain('appointment changes');
    expect(frozen).toMatchSnapshot();
  });

  it('row 3: resource with the flag off is 403 with RESOURCE copy', async () => {
    // Same code, different sentence. A refactor that unified the copy would be
    // a user-visible change, so both are frozen.
    hoisted.rescheduleEnabled = false;
    const frozen = await run({
      booking: baseBooking({ resource_id: 'res-1', calendar_id: null, service_item_id: null }),
      body: { booking_date: '2026-06-12', booking_time: '11:00' },
    });
    expectFrozen(frozen, { status: 403 });
    const body = frozen.body as { error: string };
    expect(body.error).toContain('Online booking changes');
    expect(body.error).not.toContain('appointment');
    expect(frozen).toMatchSnapshot();
  });

  // ── Appointment: unified and legacy write the mirror image of each other ──
  it('row 4: unified appointment writes calendar/service_item and NULLS the legacy pair', async () => {
    const frozen = await run({ booking: baseBooking(), body: APPT_BODY });
    expectFrozen(frozen, { status: 200 });
    const p = apptWrite(frozen);
    expect(p).toMatchObject({
      calendar_id: 'cal-new',
      service_item_id: 'svc-new',
      practitioner_id: null,
      appointment_service_id: null,
    });
    expect(frozen).toMatchSnapshot();
  });

  it('row 5: legacy appointment writes the practitioner pair and NULLS the unified pair', async () => {
    const frozen = await run({
      booking: baseBooking({
        calendar_id: null,
        service_item_id: null,
        practitioner_id: 'prac-old',
        appointment_service_id: 'svc-old',
      }),
      body: APPT_BODY,
    });
    expectFrozen(frozen, { status: 200 });
    const p = apptWrite(frozen);
    expect(p).toMatchObject({
      practitioner_id: 'cal-new',
      appointment_service_id: 'svc-new',
      calendar_id: null,
      service_item_id: null,
    });
    expect(frozen).toMatchSnapshot();
  });

  it('row 6: an unavailable slot is 409 and writes nothing', async () => {
    hoisted.apptSlotAvailable = false;
    const frozen = await run({ booking: baseBooking(), body: APPT_BODY });
    expectFrozen(frozen, { status: 409 });
    expect(frozen.dbWrites).toEqual([]);
    expect(frozen).toMatchSnapshot();
  });

  it('row 7: unmet compliance is 409 and carries the enforcement body', async () => {
    hoisted.compliance = { blocked: true, body: { error: 'Form required', code: 'compliance_required' } };
    const frozen = await run({ booking: baseBooking(), body: APPT_BODY });
    expectFrozen(frozen, { status: 409 });
    expect(frozen.body).toMatchObject({ code: 'compliance_required' });
    expect(frozen.dbWrites).toEqual([]);
    expect(frozen).toMatchSnapshot();
  });

  it('row 8: a stale updated_at is 412, not a silent overwrite', async () => {
    // The guarded UPDATE matches no row when someone else wrote first. Losing
    // this during P0-4 would silently clobber a concurrent change.
    hoisted.updateMatches = false;
    const frozen = await run({ booking: baseBooking(), body: APPT_BODY });
    expectFrozen(frozen, { status: 412 });
    expect((frozen.body as { error: string }).error).toContain('updated elsewhere');
    expect(frozen).toMatchSnapshot();
  });

  it('row 9: the guarded UPDATE carries the updated_at predicate', async () => {
    const frozen = await run({ booking: baseBooking(), body: APPT_BODY });
    expectFrozen(frozen, { status: 200 });
    // P2-3a: still both halves, the id AND the optimistic lock, but they are
    // now arguments to `claim_appointment_slot` rather than PostgREST filters.
    // The behaviour this row exists to pin is that the lock TRAVELS; where it
    // travels is the reviewed change.
    const claim = frozen.dbWrites.find((w) => w.table === 'rpc:claim_appointment_slot');
    expect(claim?.payload).toMatchObject({
      p_booking_id: IDS.booking,
      p_expected_updated_at: '2026-05-30T10:00:00+00:00',
    });
    expect(frozen).toMatchSnapshot();
  });

  it('row 10: a changed date recomputes the cancellation deadline', async () => {
    const frozen = await run({ booking: baseBooking(), body: APPT_BODY });
    expectFrozen(frozen, { status: 200 });
    const p = apptWrite(frozen);
    expect(p).toHaveProperty('cancellation_deadline');
    expect(frozen).toMatchSnapshot();
  });

  it('row 11: compliance is re-checked against the NEW date and service', async () => {
    // block_online is trivially evadable otherwise: book a no-requirement slot,
    // then move it onto a regulated one.
    const frozen = await run({ booking: baseBooking(), body: APPT_BODY });
    expectFrozen(frozen, { status: 200 });
    const call = frozen.externalCalls.find((c) => c.fn === 'enforceBookingCompliance');
    expect(call?.args[0]).toMatchObject({
      bookingDate: '2026-06-12',
      context: 'online',
      serviceItemId: 'svc-new',
    });
    expect(frozen).toMatchSnapshot();
  });

  it('row 12: modify does NOT consume the confirm token', async () => {
    // Deliberate and load-bearing: a customer may act on the same booking twice
    // from the portal, and reschedule-cancellation-deadline.ts:14 records why.
    const frozen = await run({ booking: baseBooking(), body: APPT_BODY });
    expectFrozen(frozen, { status: 200 });
    const p = apptWrite(frozen);
    expect(p).not.toHaveProperty('confirm_token_used_at');
    expect(frozen).toMatchSnapshot();
  });

  it('row 13: a successful modify logs the event and notifies the guest', async () => {
    const frozen = await run({ booking: baseBooking(), body: APPT_BODY });
    expectFrozen(frozen, { status: 200 });
    // Outcome, not stub shape: the modify comms entry point is DIFFERENT from
    // cancel's, and mocking only the cancel one leaves modify uncovered.
    expect(frozen.externalCalls.some((c) => c.fn === 'logBookingModifiedEvent')).toBe(true);
    expect(
      frozen.externalCalls.some((c) => c.fn === 'executeBookingModificationGuestNotification'),
    ).toBe(true);
    expect(frozen).toMatchSnapshot();
  });

  it('row 14: a missing date or time is 400 before any engine call', async () => {
    const frozen = await run({ booking: baseBooking(), body: { practitioner_id: 'cal-new' } });
    expectFrozen(frozen, { status: 400 });
    expect(frozen.dbWrites).toEqual([]);
    expect(frozen).toMatchSnapshot();
  });

  // ── Resource ─────────────────────────────────────────────────────────────
  it('row 15: a resource booking missing its resource id is 400', async () => {
    const frozen = await run({
      booking: baseBooking({ resource_id: null, calendar_id: null, service_item_id: null, class_instance_id: null }),
      body: { booking_date: '2026-06-12', booking_time: '11:00' },
    });
    // Falls through to the table branch when no model is inferable; either way
    // it must not write. Frozen as-is.
    expect(frozen.dbWrites.filter((w) => w.table === 'bookings' && w.op === 'update')).toEqual([]);
    expect(frozen).toMatchSnapshot();
  });

  it('row 16: a resource reschedule missing date/time is 400', async () => {
    const frozen = await run({
      booking: baseBooking({ resource_id: 'res-1', calendar_id: null, service_item_id: null }),
      body: {},
    });
    expectFrozen(frozen, { status: 400 });
    expect((frozen.body as { error: string }).error).toContain('required');
    expect(frozen).toMatchSnapshot();
  });

  // ── Table / event ────────────────────────────────────────────────────────
  it('row 17: an event ticket falls through to the TABLE branch (characterised, not fixed)', async () => {
    // The plan flags this as wrong. It is frozen here rather than fixed so
    // P0-4 cannot change it by accident; fixing it is a separate, reviewed
    // decision with its own commit.
    const frozen = await run({
      booking: baseBooking({
        experience_event_id: 'ev-1',
        calendar_id: null,
        service_item_id: null,
      }),
      body: { booking_date: '2026-06-12', booking_time: '11:00', party_size: 2 },
    });
    // The tell, pinned precisely rather than loosely: it returns the TABLE
    // engine's party-size message, which no event-ticket path would produce.
    // A vague assertion here would let P0-4 silently reroute events elsewhere.
    expectFrozen(frozen, { status: 409 });
    expect((frozen.body as { error: string }).error).toContain('party size');
    expect(frozen.dbWrites).toEqual([]);
    expect(frozen).toMatchSnapshot();
  });

  it('row 18: a non-service availability engine is 503', async () => {
    hoisted.availabilityEngine = 'resource';
    const frozen = await run({
      booking: baseBooking({ calendar_id: null, service_item_id: null }),
      body: { booking_date: '2026-06-12', booking_time: '11:00', party_size: 2 },
    });
    expectFrozen(frozen, { status: 503 });
    expect(frozen.dbWrites).toEqual([]);
    expect(frozen).toMatchSnapshot();
  });

  it('row 19: a large party is redirected with 400 and the venue message', async () => {
    hoisted.largeParty = true;
    const frozen = await run({
      booking: baseBooking({ calendar_id: null, service_item_id: null }),
      body: { booking_date: '2026-06-12', booking_time: '11:00', party_size: 20 },
    });
    expectFrozen(frozen, { status: 400 });
    expect((frozen.body as { error: string }).error).toContain('call us');
    expect(frozen).toMatchSnapshot();
  });

  // ── Cross-cutting ────────────────────────────────────────────────────────
  it('row 20: an unknown action is 400', async () => {
    hoisted.db = makeAdminDb({ booking: baseBooking(), action: 'explode' });
    hoisted.log = makeCallLog();
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ booking: baseBooking(), action: 'explode' }));
    const frozen = await freeze(res, hoisted.db, hoisted.log);
    expectFrozen(frozen, { status: 400 });
    expect(frozen.dbWrites).toEqual([]);
    expect(frozen).toMatchSnapshot();
  });

  it('row 21: a missing booking is 404, and the row loads BEFORE auth', async () => {
    // Worth stating: the booking is fetched before the signature is checked, so
    // a bad id 404s regardless of whether the credential was valid. That is an
    // enumeration surface, and freezing it means P0-4 cannot change it silently.
    const frozen = await run({ booking: null, body: APPT_BODY });
    expectFrozen(frozen, { status: 404 });
    expect(frozen.dbWrites).toEqual([]);
    expect(frozen).toMatchSnapshot();
  });
});

/**
 * P2-3a. NOT characterisation: this describes behaviour that did not exist
 * before, so it lives outside the 21-row matrix rather than renumbering it.
 *
 * `enforce_cde_capacity` guards class, event and resource bookings and
 * explicitly excludes appointments, so until now two guests could both pass
 * the availability recheck and both write the same slot. `claim_appointment_slot`
 * closes that by holding an advisory lock across the count and the write, and
 * raises 23P01 when the slot is full. These rows prove the route TRANSLATES
 * that refusal, which is the half that lives in TypeScript and can be wrong.
 */
describe('POST /api/confirm - action=modify, appointment slot guard (P2-3a)', () => {
  beforeEach(resetToHappyPath);
  afterEach(() => vi.useRealTimers());

  it('a 23P01 from the slot guard is INDISTINGUISHABLE from the existing 409', async () => {
    // Asserted against the SHARED CONSTANT the pre-guard recheck already
    // returns, not against a literal. Losing a slot to the advisory lock and
    // losing it to the recheck milliseconds earlier are the same event to the
    // guest, and a copied string here would let the two drift apart with
    // nothing to notice. A 500 would tell a guest whose only mistake was being
    // second that the site is broken.
    hoisted.updateError = PG_ERRORS.exclusionViolation;
    const frozen = await run({ booking: baseBooking(), body: APPT_BODY });
    expectFrozen(frozen, { status: 409 });
    expect(frozen.body).toEqual(SLOT_TAKEN_RESPONSE);
  });

  it('any OTHER Postgres error is still a 500, so the mapping stays narrow', async () => {
    // The vacuity guard on the row above. If the route mapped every RPC error
    // to 409, that test would pass while the route silently swallowed real
    // failures and told the guest to pick another time.
    hoisted.updateError = PG_ERRORS.uniqueViolation;
    const frozen = await run({ booking: baseBooking(), body: APPT_BODY });
    expectFrozen(frozen, { status: 500 });
  });

  it('the claim carries the calendar, the slot and the optimistic lock', async () => {
    // The guard can only count the right rows if it is told which slot to lock.
    // A claim missing its calendar would fall back to the practitioner branch
    // and silently guard nothing on a unified venue, which is every venue.
    const frozen = await run({ booking: baseBooking(), body: APPT_BODY });
    expectFrozen(frozen, { status: 200 });
    const claim = frozen.dbWrites.find((w) => w.table === 'rpc:claim_appointment_slot');
    expect(claim?.payload).toMatchObject({
      p_booking_id: IDS.booking,
      p_calendar_id: 'cal-new',
      p_practitioner_id: null,
      p_booking_date: '2026-06-12',
      p_booking_time: '11:00:00',
      p_expected_updated_at: '2026-05-30T10:00:00+00:00',
    });
  });
});
