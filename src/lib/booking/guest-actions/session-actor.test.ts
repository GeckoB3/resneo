import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRecordingDb, type RecordedCall } from '@/lib/testing/recording-supabase';

/**
 * The session actor (AD1, P0-4). This is the only NEW behaviour in the guest
 * action extraction, so it is the only part P0-9's snapshots cannot speak for.
 *
 * What it replaced: `DELETE /api/v1/me/bookings/[id]` authenticated a session,
 * then minted its own HMAC and HTTP-POSTed to `/api/confirm`. Ownership rested
 * on a `loadAccountBookingById` call sitting above the fetch, which the service
 * could not see and could not enforce. The tests below pin the two properties
 * that replaced it: the service does the ownership read ITSELF, as the caller,
 * and it refuses when the row is not there.
 */

const hoisted = vi.hoisted(() => ({
  admin: null as ReturnType<typeof makeRecordingDb> | null,
  session: null as ReturnType<typeof makeRecordingDb> | null,
  /** Guest rows the session client's `guests_account_safe` read returns. */
  guests: [{ id: 'guest-1', venue_id: 'venue-1' }] as Array<Record<string, unknown>>,
  /** Whether the account-safe view says this booking is the caller's. */
  ownsBooking: true,
  hmacValid: true,
  tokenValid: true,
  mintShortLink: vi.fn(async () => 'https://resneo.test/b/abc123'),
}));

vi.mock('@/lib/confirm-token', () => ({ verifyConfirmToken: () => hoisted.tokenValid }));
vi.mock('@/lib/short-manage-link', () => ({ verifyBookingHmac: () => hoisted.hmacValid }));
vi.mock('@/lib/stripe', () => ({ stripe: { refunds: { create: vi.fn() } } }));
vi.mock('@/lib/booking/card-hold-cancellation', () => ({
  settleCardHoldsOnCancellation: async () => ({ releasedBookingIds: [], keptHolds: [] }),
}));
vi.mock('@/lib/booking/cancel-open-deposit-intent', () => ({
  cancelOpenDepositIntentForBookings: async () => undefined,
}));
vi.mock('@/lib/booking/offer-appointment-waitlist-on-cancel', () => ({
  offerAppointmentWaitlistOnCancel: async () => ({ offered: false }),
}));
vi.mock('@/lib/observability/booking-ops-log', () => ({ logBookingOp: vi.fn() }));
/*
  P2-5. Minting a short link is a WRITE through its own admin client, so it is
  mocked both to keep this suite off the database and so that "was one minted"
  becomes something a test can ask.
*/
vi.mock('@/lib/booking-short-links', () => ({
  createOrGetBookingShortLink: hoisted.mintShortLink,
}));
vi.mock('@/lib/communications/send-templated', () => ({
  sendCancellationNotification: vi.fn(async () => undefined),
}));
vi.mock('@/lib/emails/booking-email-enrichment', () => ({
  enrichBookingEmailForComms: async (_db: unknown, _id: string, e: unknown) => e,
}));
vi.mock('@/lib/table-management/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/table-management/lifecycle')>();
  return { ...actual, applyBookingLifecycleStatusEffects: async () => undefined };
});

import { cancelBookingForGuest } from './cancel';
import { confirmAttendanceForGuest } from './confirm-attendance';

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';

function baseBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING_ID,
    venue_id: 'venue-1',
    guest_id: 'guest-1',
    booking_date: '2026-06-10',
    booking_time: '14:00:00',
    booking_end_time: '14:30:00',
    party_size: 1,
    status: 'Booked',
    deposit_status: null,
    deposit_amount_pence: null,
    stripe_payment_intent_id: null,
    cancellation_deadline: '2026-06-08T13:00:00+00:00',
    confirm_token_hash: 'hashed',
    confirm_token_used_at: null,
    calendar_id: 'cal-1',
    service_item_id: 'svc-1',
    updated_at: '2026-05-30T10:00:00+00:00',
    guest_attendance_confirmed_at: null,
    ...overrides,
  };
}

function setup(booking: Record<string, unknown> | null = baseBooking()) {
  hoisted.admin = makeRecordingDb((call) => {
    if (call.table === 'bookings' && call.op === 'select') {
      return booking ? { data: booking } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    }
    if (call.table === 'venues') return { data: { name: 'The Wharf' } };
    if (call.table === 'guests') return { data: { first_name: 'Ada', email: 'a@b.test' } };
    if (call.op !== 'select') return { data: null, error: null };
    return undefined;
  });
  hoisted.session = makeRecordingDb((call) => {
    if (call.table === 'guests_account_safe') return { data: hoisted.guests };
    if (call.table === 'bookings_account_safe') {
      return { data: hoisted.ownsBooking ? { id: BOOKING_ID } : null };
    }
    return undefined;
  });
  return { admin: hoisted.admin.db, session: hoisted.session.db };
}

const sessionActor = { kind: 'session' as const, userId: 'user-1' };

function sessionCalls(table: string): RecordedCall[] {
  return hoisted.session!.calls.filter((c) => c.table === table);
}

describe('session actor ownership (AD8 second layer, enforced by the service)', () => {
  beforeEach(() => {
    hoisted.guests = [{ id: 'guest-1', venue_id: 'venue-1' }];
    hoisted.ownsBooking = true;
  });

  it('reads the account-safe view AS THE CALLER before acting', async () => {
    // The property that replaced "the caller promises it did the ownership
    // read". The read has to happen on the SESSION client: on the admin client
    // the view's own WHERE clause would be evaluated for no particular user.
    const clients = setup();
    const result = await cancelBookingForGuest(clients, {
      bookingId: BOOKING_ID,
      actor: sessionActor,
    });

    expect(result.ok).toBe(true);
    expect(sessionCalls('guests_account_safe').length).toBe(1);
    const ownership = sessionCalls('bookings_account_safe');
    expect(ownership.length, 'ownership must be read on the session client').toBe(1);
    expect(ownership[0].filters).toEqual([
      ['eq', 'id', BOOKING_ID],
      ['in', 'guest_id', ['guest-1']],
    ]);
    // And never on the admin client, which would authorise nobody in particular.
    expect(hoisted.admin!.calls.some((c) => c.table === 'bookings_account_safe')).toBe(false);
  });

  it("REFUSES someone else's booking, and writes nothing", async () => {
    hoisted.ownsBooking = false;
    const clients = setup();
    const result = await cancelBookingForGuest(clients, {
      bookingId: BOOKING_ID,
      actor: sessionActor,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // 404 rather than 403: a 403 confirms the booking exists to anyone
      // enumerating ids, and the customer-visible difference is nil.
      expect(result.status).toBe(404);
      expect(result.code).toBe('NOT_FOUND');
    }
    expect(hoisted.admin!.calls.filter((c) => c.op !== 'select')).toEqual([]);
  });

  it('refuses a caller with no linked guest rows', async () => {
    hoisted.guests = [];
    const clients = setup();
    const result = await cancelBookingForGuest(clients, {
      bookingId: BOOKING_ID,
      actor: sessionActor,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
    expect(sessionCalls('bookings_account_safe')).toEqual([]);
  });

  it('refuses a session actor handed no session client', async () => {
    // A programming error, not a customer one. Falling through to an admin
    // read would authorise nobody in particular, so it fails closed.
    const clients = setup();
    const result = await cancelBookingForGuest(
      { admin: clients.admin, session: null },
      { bookingId: BOOKING_ID, actor: sessionActor },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
    expect(hoisted.admin!.calls.filter((c) => c.op !== 'select')).toEqual([]);
  });

  it('does not consult the session client at all for a token actor', async () => {
    const clients = setup();
    const result = await cancelBookingForGuest(clients, {
      bookingId: BOOKING_ID,
      actor: { kind: 'token', token: 'raw' },
    });
    expect(result.ok).toBe(true);
    expect(hoisted.session!.calls).toEqual([]);
  });
});

describe('the session actor does not consume the confirm token', () => {
  beforeEach(() => {
    hoisted.guests = [{ id: 'guest-1', venue_id: 'venue-1' }];
    hoisted.ownsBooking = true;
  });

  function cancelUpdate() {
    const call = hoisted.admin!.calls.find((c) => c.table === 'bookings' && c.op === 'update');
    return call?.payload as Record<string, unknown> | undefined;
  }

  it('omits confirm_token_used_at on a portal cancel', async () => {
    // A portal session is not the emailed link. Burning it here would silently
    // invalidate an email the customer may still need.
    const clients = setup();
    await cancelBookingForGuest(clients, { bookingId: BOOKING_ID, actor: sessionActor });
    expect(cancelUpdate()).not.toHaveProperty('confirm_token_used_at');
    expect(cancelUpdate()).toMatchObject({ status: 'Cancelled', cancellation_actor_type: 'customer' });
  });

  it('still stamps it for a token actor, which is what makes the link single use', async () => {
    const clients = setup();
    await cancelBookingForGuest(clients, {
      bookingId: BOOKING_ID,
      actor: { kind: 'token', token: 'raw' },
    });
    expect(cancelUpdate()).toHaveProperty('confirm_token_used_at');
  });

  it('applies the same rule to confirming attendance', async () => {
    const clients = setup();
    await confirmAttendanceForGuest(clients, { bookingId: BOOKING_ID, actor: sessionActor });
    const update = hoisted.admin!.calls.find((c) => c.table === 'bookings' && c.op === 'update');
    expect(update?.payload).not.toHaveProperty('confirm_token_used_at');
    expect(update?.payload).toMatchObject({ status: 'Confirmed' });
  });
});

describe('token and HMAC semantics are unchanged', () => {
  beforeEach(() => {
    hoisted.tokenValid = true;
    hoisted.hmacValid = true;
  });

  it('a used token is 410, not 400', async () => {
    // The distinction that tells a guest "you already did this" apart from
    // "this link is wrong". It is the one status the plan calls out by number.
    const clients = setup(baseBooking({ confirm_token_used_at: '2026-06-01T00:00:00Z' }));
    const result = await cancelBookingForGuest(clients, {
      bookingId: BOOKING_ID,
      actor: { kind: 'token', token: 'raw' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(410);
  });

  it('a used token does NOT block an HMAC link, which is reusable by design', async () => {
    // The manage link in a confirmation email has to keep working after the
    // confirm link has been clicked.
    const clients = setup(baseBooking({ confirm_token_used_at: '2026-06-01T00:00:00Z' }));
    const result = await cancelBookingForGuest(clients, {
      bookingId: BOOKING_ID,
      actor: { kind: 'hmac', hmac: 'sig' },
    });
    expect(result.ok).toBe(true);
  });

  it('an invalid signature is refused before anything is written', async () => {
    hoisted.hmacValid = false;
    const clients = setup();
    const result = await cancelBookingForGuest(clients, {
      bookingId: BOOKING_ID,
      actor: { kind: 'hmac', hmac: 'bad' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
    expect(hoisted.admin!.calls.filter((c) => c.op !== 'select')).toEqual([]);
  });

  it('a missing booking is 404 before any proof is checked', async () => {
    const clients = setup(null);
    const result = await cancelBookingForGuest(clients, {
      bookingId: BOOKING_ID,
      actor: { kind: 'hmac', hmac: 'sig' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});


describe('a signed-in customer is not handed a manage link (P2-5)', () => {
  /*
    A `/b/{code}` manage link is a BEARER CREDENTIAL: whoever holds it can
    cancel the booking without logging in. The portal's detail page reuses the
    DTO built for the token surface, so until P2-5 every page view minted one,
    wrote a `booking_short_links` row, and serialised the link into the browser
    of a customer who already had a session and a Cancel button that did not
    need it.

    Asserted on the MINT rather than on the field being null, because the field
    could be nulled after the fact and the write would still happen: it is the
    write, and the credential existing at all, that this is about.
  */
  beforeEach(() => {
    hoisted.mintShortLink.mockClear();
  });

  it('mints nothing when a session actor loads a booking', async () => {
    const clients = setup(baseBooking({ calendar_id: null, service_item_id: null }));
    const { getBookingDetailForGuest } = await import('./booking-detail');
    const result = await getBookingDetailForGuest(clients, {
      bookingId: BOOKING_ID,
      actor: sessionActor,
    });

    expect(result.ok, 'the fixture did not reach the builder, so this asserts nothing').toBe(true);
    expect(hoisted.mintShortLink, 'the portal minted a manage link').not.toHaveBeenCalled();
  });

  it('and carries no manage link in the payload it returns', async () => {
    const clients = setup(baseBooking({ calendar_id: null, service_item_id: null }));
    const { getBookingDetailForGuest } = await import('./booking-detail');
    const result = await getBookingDetailForGuest(clients, {
      bookingId: BOOKING_ID,
      actor: sessionActor,
    });

    expect(result.ok && result.data.manage_booking_url).toBeNull();
  });

  it('but the builder still mints one when its caller asks, so the token surface works', async () => {
    // The vacuity guard. Without it, a build that deleted the minting entirely
    // would pass both rows above while breaking every emailed manage link.
    const clients = setup(baseBooking({ calendar_id: null, service_item_id: null }));
    const { buildBookingDetailDto } = await import('@/lib/booking/booking-detail-dto');
    const dto = await buildBookingDetailDto(
      clients.admin,
      baseBooking({ calendar_id: null, service_item_id: null }) as never,
      { includeManageUrl: true },
    );

    expect(hoisted.mintShortLink).toHaveBeenCalledTimes(1);
    expect(dto.manage_booking_url).toBe('https://resneo.test/b/abc123');
  });
});
