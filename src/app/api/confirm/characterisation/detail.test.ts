import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import {
  FIXED_NOW,
  IDS,
  baseBooking,
  freeze,
  makeAdminDb,
  makeCallLog,
  makeGetRequest,
  expectFrozen,
  type RunOptions,
} from './harness';

/**
 * `GET /api/confirm`, frozen as it is (P2-4's gate).
 *
 * P0-9 characterised the POST only, deliberately: P0-4 was extracting the
 * actions, and the plan records that the GET's ~270-line presentation payload
 * stayed in the route because nothing could prove a move left it unchanged.
 *
 * P2-4 is that move. AD9 makes this payload the shared booking DTO that both
 * the token surface and the portal render, so it has to come out of the route,
 * and it has to come out without changing a field. This file is what makes
 * that checkable: the gate is that the extraction lands with ZERO modified
 * snapshot files, exactly as P0-4's gate worked.
 *
 * The rows cover one per booking model plus the auth and card-hold branches,
 * because the payload's shape genuinely differs across them: an appointment
 * carries `venue_public` and a practitioner, a class carries a summary and a
 * type id, a resource carries a name, and everything else carries nulls.
 */

const hoisted = vi.hoisted(() => ({
  db: null as ReturnType<typeof makeAdminDb> | null,
  log: null as ReturnType<typeof makeCallLog> | null,
  tokenValid: true,
  hmacValid: true,
}));

vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: () => hoisted.db!.db }));
vi.mock('@/lib/confirm-token', () => ({
  verifyConfirmToken: (...args: unknown[]) => {
    hoisted.log!.record('confirm-token', 'verifyConfirmToken')(...args);
    return hoisted.tokenValid;
  },
}));
vi.mock('@/lib/short-manage-link', () => ({
  verifyBookingHmac: (...args: unknown[]) => {
    hoisted.log!.record('short-manage-link', 'verifyBookingHmac')(...args);
    return hoisted.hmacValid;
  },
}));

/**
 * The four collaborators that reach outside the database.
 *
 * Stubbed to fixed values rather than left real: two mint short links (which
 * write rows and produce a random code, so a snapshot would churn every run),
 * one builds the public venue payload from half a dozen further tables, and one
 * reads compliance forms. What matters to this gate is that the payload carries
 * their output in the right field under the right condition, which a fixed
 * value pins exactly as well as a real one would.
 */
vi.mock('@/lib/booking-short-links', () => ({
  createOrGetBookingShortLink: (...args: unknown[]) => {
    hoisted.log!.record('booking-short-links', 'createOrGetBookingShortLink')(...args);
    return Promise.resolve('https://rsn.test/b/ABC123');
  },
  createOrGetPaymentShortLink: (...args: unknown[]) => {
    hoisted.log!.record('booking-short-links', 'createOrGetPaymentShortLink')(...args);
    return Promise.resolve('https://rsn.test/p/PAY123');
  },
}));
vi.mock('@/lib/booking/build-venue-public', () => ({
  buildVenuePublicForBookingById: (...args: unknown[]) => {
    hoisted.log!.record('build-venue-public', 'buildVenuePublicForBookingById')(...args);
    return Promise.resolve({ id: IDS.venue, name: 'Frozen Venue', slug: 'frozen-venue' });
  },
}));
vi.mock('@/lib/compliance/form-links-service', () => ({
  loadOutstandingBookingFormLinks: (...args: unknown[]) => {
    // The first arg is the supabase client, which is not stable across runs and
    // would churn every snapshot; only the ids are recorded.
    hoisted.log!.record('form-links-service', 'loadOutstandingBookingFormLinks')(args[1], args[2]);
    return Promise.resolve([{ name: 'Consultation form', url: 'https://forms.test/1' }]);
  },
}));

/** The venue row the payload reads name, address, rules and flags from. */
const VENUE = {
  name: 'Frozen Venue',
  address: '1 Frozen Street',
  phone: '+44 20 7946 0000',
  booking_model: 'unified_scheduling',
  booking_rules: { cancellation_notice_hours: 24 },
  email: 'venue@frozen.test',
  reply_to_email: null,
  feature_flags: {},
};

beforeAll(async () => {
  // Same reason as the sibling suites: the first dynamic import pays for the
  // whole route graph and would otherwise land on row 1 past the 5s default.
  await import('../route');
}, 60_000);

async function run(opts: Omit<RunOptions, 'action'> & { tables?: Record<string, unknown> }) {
  hoisted.db = makeAdminDb({
    ...opts,
    action: 'detail',
    tables: { venues: VENUE, ...(opts.tables ?? {}) },
  });
  hoisted.log = makeCallLog();
  const { GET } = await import('../route');
  const res = await GET(makeGetRequest({ ...opts, action: 'detail' }));
  return freeze(res, hoisted.db, hoisted.log);
}

describe('GET /api/confirm - the booking detail payload (P2-4 gate)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    hoisted.tokenValid = true;
    hoisted.hmacValid = true;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('row 1: a unified-scheduling appointment', async () => {
    const frozen = await run({
      booking: baseBooking(),
      tables: {
        unified_calendars: { name: 'Alex Practitioner' },
        service_items: { name: 'Consultation' },
      },
    });
    expectFrozen(frozen, { status: 200 });
    const body = frozen.body as Record<string, unknown>;
    // The fields the manage view keys its whole appointment branch off.
    expect(body.is_appointment).toBe(true);
    expect(body.booking_model).toBe('unified_scheduling');
    expect(body.venue_public).toBeTruthy();
    expect(frozen).toMatchSnapshot();
  });

  it('row 2: a legacy practitioner appointment', async () => {
    const frozen = await run({
      booking: baseBooking({
        calendar_id: null,
        service_item_id: null,
        practitioner_id: '66666666-6666-4666-8666-666666666666',
        appointment_service_id: '77777777-7777-4777-8777-777777777777',
      }),
      tables: {
        venues: { ...VENUE, booking_model: 'appointments' },
        practitioners: { name: 'Legacy Practitioner' },
        appointment_services: { name: 'Legacy Service' },
      },
    });
    expectFrozen(frozen, { status: 200 });
    expect((frozen.body as Record<string, unknown>).booking_model).toBe('practitioner_appointment');
    expect(frozen).toMatchSnapshot();
  });

  it('row 3: a service variant is appended to the service name', async () => {
    const frozen = await run({
      booking: baseBooking({ service_variant_id: '88888888-8888-4888-8888-888888888888' }),
      tables: {
        unified_calendars: { name: 'Alex Practitioner' },
        service_items: { name: 'Consultation' },
        service_variants: { name: 'Long' },
      },
    });
    expectFrozen(frozen, { status: 200 });
    expect((frozen.body as Record<string, unknown>).appointment_service_name).toBe(
      'Consultation - Long',
    );
    expect(frozen).toMatchSnapshot();
  });

  it('row 4: a table reservation carries no appointment fields', async () => {
    const frozen = await run({
      booking: baseBooking({ calendar_id: null, service_item_id: null }),
      tables: { venues: { ...VENUE, booking_model: 'restaurant' } },
    });
    expectFrozen(frozen, { status: 200 });
    const body = frozen.body as Record<string, unknown>;
    expect(body.booking_model).toBe('table_reservation');
    expect(body.is_appointment).toBe(false);
    expect(body.venue_public).toBeNull();
    expect(frozen).toMatchSnapshot();
  });

  it('row 5: a class session carries its summary and type id', async () => {
    const frozen = await run({
      booking: baseBooking({
        calendar_id: null,
        service_item_id: null,
        class_instance_id: '99999999-9999-4999-8999-999999999999',
      }),
      tables: {
        class_instances: {
          instance_date: '2026-06-10',
          start_time: '18:30:00',
          class_type_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
        class_types: { name: 'Reformer Pilates' },
      },
    });
    expectFrozen(frozen, { status: 200 });
    const body = frozen.body as Record<string, unknown>;
    expect(body.booking_model).toBe('class_session');
    expect(body.class_summary).toBe('Reformer Pilates · 2026-06-10 18:30');
    expect(frozen).toMatchSnapshot();
  });

  it('row 6: an event ticket carries the event name', async () => {
    const frozen = await run({
      booking: baseBooking({
        calendar_id: null,
        service_item_id: null,
        experience_event_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
      tables: { experience_events: { name: 'Wine Tasting' } },
    });
    expectFrozen(frozen, { status: 200 });
    const body = frozen.body as Record<string, unknown>;
    expect(body.booking_model).toBe('event_ticket');
    expect(body.event_name).toBe('Wine Tasting');
    expect(frozen).toMatchSnapshot();
  });

  it('row 7: a resource booking carries its name and identity', async () => {
    const frozen = await run({
      booking: baseBooking({
        calendar_id: null,
        service_item_id: null,
        resource_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      }),
      tables: { unified_calendars: { name: 'Court 1' } },
    });
    expectFrozen(frozen, { status: 200 });
    const body = frozen.body as Record<string, unknown>;
    expect(body.booking_model).toBe('resource_booking');
    expect(body.resource_id).toBe('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    expect(frozen).toMatchSnapshot();
  });

  it('row 8: a held card hold reaches the guest as fee and state only', async () => {
    const frozen = await run({
      booking: baseBooking({ deposit_status: 'Card Held' }),
      tables: {
        unified_calendars: { name: 'Alex Practitioner' },
        service_items: { name: 'Consultation' },
        booking_card_holds: {
          fee_pence: 1500,
          released_at: null,
          charged_pence: null,
          charged_at: null,
          stripe_payment_method_id: 'pm_secret',
        },
      },
    });
    expectFrozen(frozen, { status: 200 });
    const hold = (frozen.body as Record<string, unknown>).card_hold as Record<string, unknown>;
    expect(hold.state).toBe('held');
    expect(hold.fee_pence).toBe(1500);
    // The Stripe id must never reach a guest.
    expect(JSON.stringify(frozen.body)).not.toContain('pm_secret');
    expect(frozen).toMatchSnapshot();
  });

  it('row 9: a hold awaiting a card carries a payment link', async () => {
    const frozen = await run({
      booking: baseBooking({ deposit_status: 'Pending' }),
      tables: {
        unified_calendars: { name: 'Alex Practitioner' },
        service_items: { name: 'Consultation' },
        booking_card_holds: {
          fee_pence: 1500,
          released_at: null,
          charged_pence: null,
          charged_at: null,
          stripe_payment_method_id: null,
        },
      },
    });
    expectFrozen(frozen, { status: 200 });
    const hold = (frozen.body as Record<string, unknown>).card_hold as Record<string, unknown>;
    expect(hold.state).toBe('awaiting_card');
    expect(hold.payment_link).toBe('https://rsn.test/p/PAY123');
    expect(frozen).toMatchSnapshot();
  });

  it('row 10: a venue with self-reschedule off says so in the flags', async () => {
    const frozen = await run({
      booking: baseBooking(),
      tables: {
        venues: { ...VENUE, feature_flags: { guest_self_reschedule: false } },
        unified_calendars: { name: 'Alex Practitioner' },
        service_items: { name: 'Consultation' },
      },
    });
    expectFrozen(frozen, { status: 200 });
    const flags = (frozen.body as Record<string, unknown>).feature_flags as {
      resolved: Record<string, unknown>;
    };
    expect(flags.resolved.guest_self_reschedule).toBe(false);
    expect(frozen).toMatchSnapshot();
  });

  it('row 11: an HMAC link is accepted and does not check the token', async () => {
    const frozen = await run({
      booking: baseBooking(),
      auth: { hmac: 'valid-hmac' },
      tables: {
        unified_calendars: { name: 'Alex Practitioner' },
        service_items: { name: 'Consultation' },
      },
    });
    expectFrozen(frozen, { status: 200 });
    expect(frozen.externalCalls.map((c) => c.fn)).toContain('verifyBookingHmac');
    expect(frozen.externalCalls.map((c) => c.fn)).not.toContain('verifyConfirmToken');
    expect(frozen).toMatchSnapshot();
  });

  it('row 12: a used token is 410, and says so before checking the signature', async () => {
    const frozen = await run({
      booking: baseBooking({ confirm_token_used_at: '2026-05-31T08:00:00+00:00' }),
    });
    expectFrozen(frozen, { status: 410 });
    expect(frozen.externalCalls.map((c) => c.fn)).not.toContain('verifyConfirmToken');
    expect(frozen).toMatchSnapshot();
  });

  it('row 13: an invalid token is 400', async () => {
    hoisted.tokenValid = false;
    const frozen = await run({ booking: baseBooking() });
    expectFrozen(frozen, { status: 400 });
    expect(frozen).toMatchSnapshot();
  });

  it('row 14: a missing booking is 404, decided before any proof is checked', async () => {
    const frozen = await run({ booking: null });
    expectFrozen(frozen, { status: 404 });
    // The order matters and P0-4's authorise module records why: a bad token on
    // a booking that does not exist is a 404, not a 400, so what an id-prober
    // can distinguish does not change.
    expect(frozen.externalCalls).toEqual([]);
    expect(frozen).toMatchSnapshot();
  });

  it('never carries an internal identifier out to a guest', async () => {
    // A property of the payload rather than of one row, and the reason it is
    // here: the extraction moves 270 lines that read `bookings` with a wide
    // SELECT, and the easiest mistake to make while moving them is to spread
    // the row instead of naming fields. Every value below is on that row.
    const frozen = await run({
      booking: baseBooking({ deposit_status: 'Card Held' }),
      tables: {
        unified_calendars: { name: 'Alex Practitioner' },
        service_items: { name: 'Consultation' },
        booking_card_holds: {
          fee_pence: 1500,
          released_at: null,
          charged_pence: null,
          charged_at: null,
          stripe_payment_method_id: 'pm_secret',
        },
      },
    });
    expectFrozen(frozen, { status: 200 });

    const serialised = JSON.stringify(frozen.body);
    for (const secret of [
      'hashed-confirm-token', // confirm_token_hash
      'pm_secret', // the hold's payment method
      IDS.guest, // guest_id: the payload is for one guest, and names nobody
      'venue@frozen.test', // the venue's internal contact address
    ]) {
      expect(serialised, `the payload leaked ${secret}`).not.toContain(secret);
    }
  });
});
