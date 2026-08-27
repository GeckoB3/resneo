/**
 * P0-9 characterisation: POST /api/confirm, action=cancel. 13 rows.
 *
 * Describes the route AS IT IS. See ./harness.ts for the harness decisions;
 * the gate for P0-4 is zero modified snapshot files.
 *
 * The row that matters most is row 3: a retryable refund failure must return
 * 502 and leave the booking NOT cancelled. Getting that backwards during P0-4
 * means a guest whose refund failed loses their booking anyway.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  FIXED_NOW,
  IDS,
  baseBooking,
  freeze,
  makeAdminDb,
  makeCallLog,
  makeRequest,
  expectFrozen,
  type RunOptions,
} from './harness';

const hoisted = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('@/lib/testing/recording-supabase').makeRecordingDb> | null,
  log: null as ReturnType<typeof import('./harness').makeCallLog> | null,
  /** Stripe refunds.create: 'ok' | 'throw'. */
  refund: 'ok' as 'ok' | 'throw',
  /** What classifyDepositRefundFailure returns for a thrown refund. */
  convergence: 'retryable' as 'refunded' | 'nothing_to_refund' | 'retryable',
  cardHoldRow: null as Record<string, unknown> | null,
  settleResult: { releasedBookingIds: [] as string[], keptHolds: [] as Array<{ bookingId: string; feePence: number }> },
  creditPaid: false,
  membershipPaid: false,
  restoredCredits: 0,
  restoredSessions: 0,
  waitlist: { offered: false, mode: 'notify_in_order' as string, waitlistEntryId: 'wl-1' },
  refundPlan: { amountPence: null as number | null, idempotencyKey: 'idem-key-1' },
  // Runs the callback: a bare vi.fn() swallows every deferred comm and the
  // suite would pass while asserting nothing. See harness.ts.
  afterStub: vi.fn((cb: () => unknown) => cb()),
}));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: hoisted.afterStub,
}));

vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: () => hoisted.db!.db }));
vi.mock('@/lib/confirm-token', () => ({ verifyConfirmToken: () => true }));
vi.mock('@/lib/short-manage-link', () => ({ verifyBookingHmac: () => true }));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    refunds: {
      create: (...args: unknown[]) => {
        hoisted.log!.record('stripe', 'refunds.create')(...args);
        if (hoisted.refund === 'throw') throw new Error('card_declined');
        return Promise.resolve({ id: 're_1' });
      },
    },
  },
}));
vi.mock('@/lib/booking/shared-deposit-refund', () => ({
  planSharedDepositRefund: (...args: unknown[]) => {
    hoisted.log!.record('shared-deposit-refund', 'planSharedDepositRefund')(args[1]);
    return Promise.resolve(hoisted.refundPlan);
  },
}));
vi.mock('@/lib/booking/deposit-refund-convergence', () => ({
  classifyDepositRefundFailure: (...args: unknown[]) => {
    hoisted.log!.record('deposit-refund-convergence', 'classifyDepositRefundFailure')(args[1]);
    return Promise.resolve(hoisted.convergence);
  },
}));
vi.mock('@/lib/booking/card-hold-cancellation', () => ({
  settleCardHoldsOnCancellation: (...args: unknown[]) => {
    hoisted.log!.record('card-hold-cancellation', 'settleCardHoldsOnCancellation')(args[1]);
    return Promise.resolve(hoisted.settleResult);
  },
}));
vi.mock('@/lib/booking/cancel-open-deposit-intent', () => ({
  cancelOpenDepositIntentForBookings: (...args: unknown[]) => {
    hoisted.log!.record('cancel-open-deposit-intent', 'cancelOpenDepositIntentForBookings')(args[1]);
    return Promise.resolve();
  },
}));
vi.mock('@/lib/booking/offer-appointment-waitlist-on-cancel', () => ({
  offerAppointmentWaitlistOnCancel: (...args: unknown[]) => {
    hoisted.log!.record('offer-appointment-waitlist-on-cancel', 'offerAppointmentWaitlistOnCancel')(args[1]);
    return Promise.resolve(hoisted.waitlist);
  },
}));
vi.mock('@/lib/table-management/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/table-management/lifecycle')>();
  return {
    ...actual,
    applyBookingLifecycleStatusEffects: (...args: unknown[]) => {
      hoisted.log!.record('lifecycle', 'applyBookingLifecycleStatusEffects')(args[1]);
      return Promise.resolve();
    },
  };
});
vi.mock('@/lib/observability/booking-ops-log', () => ({
  logBookingOp: (...args: unknown[]) => hoisted.log!.record('booking-ops-log', 'logBookingOp')(...args),
}));

// Comms: the OUTCOME is "a cancellation notification was sent, with this
// refund message". Never assert on the after() stub itself (AD1 changes the
// mechanism during P0-4).
vi.mock('@/lib/communications/send-templated', () => ({
  sendCancellationNotification: (...args: unknown[]) =>
    hoisted.log!.record('send-templated', 'sendCancellationNotification')(args[3]),
}));
vi.mock('@/lib/emails/booking-email-enrichment', () => ({
  enrichBookingEmailForComms: (...args: unknown[]) => Promise.resolve(args[2]),
}));

// Dynamic imports on the credit-restore path.
vi.mock('@/lib/class-commerce/booking-was-credit-paid', () => ({
  bookingWasCreditPaid: () => Promise.resolve(hoisted.creditPaid),
  bookingWasMembershipPaid: () => Promise.resolve(hoisted.membershipPaid),
}));
vi.mock('@/lib/class-commerce/restore-class-credits', () => ({
  restoreClassCreditsForBooking: (...args: unknown[]) => {
    hoisted.log!.record('restore-class-credits', 'restoreClassCreditsForBooking')(args[1]);
    return Promise.resolve({ ok: true, restoredCredits: hoisted.restoredCredits });
  },
}));
vi.mock('@/lib/class-commerce/restore-membership-allowance', () => ({
  restoreMembershipAllowanceForBooking: (...args: unknown[]) => {
    hoisted.log!.record('restore-membership-allowance', 'restoreMembershipAllowanceForBooking')(args[0]);
    return Promise.resolve({ restoredSessions: hoisted.restoredSessions });
  },
}));

const VENUE_ROW = {
  name: 'Char Venue',
  address: '1 Test Street',
  phone: '02071234567',
  email: 'venue@char.test',
  reply_to_email: null,
  booking_rules: { cancellation_notice_hours: 48 },
  stripe_connected_account_id: 'acct_char',
};
const GUEST_ROW = { first_name: 'Cara', last_name: 'Char', email: 'cara@char.test', phone: '02071234568' };

async function run(opts: Omit<RunOptions, 'action'> & { tables?: Record<string, unknown> }) {
  hoisted.db = makeAdminDb({
    ...opts,
    action: 'cancel',
    tables: {
      venues: VENUE_ROW,
      guests: GUEST_ROW,
      booking_card_holds: hoisted.cardHoldRow,
      ...(opts.tables ?? {}),
    },
  });
  hoisted.log = makeCallLog();
  const { POST } = await import('../route');
  const res = await POST(makeRequest({ ...opts, action: 'cancel' }));
  return freeze(res, hoisted.db, hoisted.log);
}

/** Paid deposit, deadline in the future: the refundable shape. */
const paidRefundable = (o: Record<string, unknown> = {}) =>
  baseBooking({
    deposit_status: 'Paid',
    deposit_amount_pence: 2500,
    stripe_payment_intent_id: 'pi_char',
    cancellation_deadline: '2026-06-08T13:00:00+00:00',
    ...o,
  });

describe('POST /api/confirm - action=cancel (P0-9, 13 rows)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    hoisted.refund = 'ok';
    hoisted.convergence = 'retryable';
    hoisted.cardHoldRow = null;
    hoisted.settleResult = { releasedBookingIds: [], keptHolds: [] };
    hoisted.creditPaid = false;
    hoisted.membershipPaid = false;
    hoisted.restoredCredits = 0;
    hoisted.restoredSessions = 0;
    hoisted.waitlist = { offered: false, mode: 'notify_in_order', waitlistEntryId: 'wl-1' };
    hoisted.refundPlan = { amountPence: null, idempotencyKey: 'idem-key-1' };
  });
  afterEach(() => vi.useRealTimers());

  it('row 1: plain appointment cancels with no deposit and no refund call', async () => {
    const frozen = await run({ booking: baseBooking() });
    expectFrozen(frozen, { status: 200 });
    expect(frozen.externalCalls.some((c) => c.fn === 'refunds.create')).toBe(false);
    const update = frozen.dbWrites.find((w) => w.op === 'update');
    expect(Object.keys(update?.payload as Record<string, unknown>).sort()).toEqual([
      'cancellation_actor_type',
      'cancelled_by_staff_id',
      'confirm_token_used_at',
      'deposit_status',
      'status',
      'updated_at',
    ]);
    expect(frozen).toMatchSnapshot();
  });

  it('row 2: paid deposit before the deadline refunds with the planned amount and key', async () => {
    hoisted.refundPlan = { amountPence: 1500, idempotencyKey: 'idem-partial' };
    const frozen = await run({ booking: paidRefundable() });
    expectFrozen(frozen, { status: 200 });
    const refund = frozen.externalCalls.find((c) => c.fn === 'refunds.create');
    // C11: the amount and idempotency key are the whole point. Refunding the
    // intent without an amount hands back the whole party's deposits.
    expect(refund?.args[0]).toMatchObject({ payment_intent: 'pi_char', amount: 1500 });
    expect(refund?.args[1]).toMatchObject({ idempotencyKey: 'idem-partial', stripeAccount: 'acct_char' });
    const update = frozen.dbWrites.find((w) => w.op === 'update');
    expect((update?.payload as Record<string, unknown>).deposit_status).toBe('Refunded');
    expect(frozen).toMatchSnapshot();
  });

  it('row 3: a retryable refund failure returns 502 and the booking is NOT cancelled', async () => {
    // THE highest-value row in the suite. If P0-4 inverts this, a guest whose
    // refund failed loses the booking as well as the money.
    hoisted.refund = 'throw';
    hoisted.convergence = 'retryable';
    const frozen = await run({ booking: paidRefundable() });
    expectFrozen(frozen, { status: 502 });
    expect(frozen.dbWrites, 'nothing may be written when the refund is retryable').toEqual([]);
    expect((frozen.body as { code?: string }).code).toBe('REFUND_FAILED');
    // The failure is logged for operators even though the request 502s.
    expect(
      frozen.externalCalls.some(
        (c) => c.fn === 'logBookingOp' && (c.args[0] as { operation?: string }).operation === 'refund_failed',
      ),
    ).toBe(true);
    expect(frozen).toMatchSnapshot();
  });

  it('row 4: nothing-to-refund converges to 200 with variant copy and deposit_status preserved', async () => {
    hoisted.refund = 'throw';
    hoisted.convergence = 'nothing_to_refund';
    const frozen = await run({ booking: paidRefundable() });
    expectFrozen(frozen, { status: 200 });
    const update = frozen.dbWrites.find((w) => w.op === 'update');
    // PM-1: a cash-settled deposit must NOT be stamped 'Refunded'.
    expect((update?.payload as Record<string, unknown>).deposit_status).toBe('Paid');
    expect((frozen.body as { refund_eligible?: boolean }).refund_eligible).toBe(false);
    expect(frozen).toMatchSnapshot();
  });

  it('row 5: an already-refunded intent converges to a successful refund', async () => {
    hoisted.refund = 'throw';
    hoisted.convergence = 'refunded';
    const frozen = await run({ booking: paidRefundable() });
    expectFrozen(frozen, { status: 200 });
    const update = frozen.dbWrites.find((w) => w.op === 'update');
    expect((update?.payload as Record<string, unknown>).deposit_status).toBe('Refunded');
    expect(frozen).toMatchSnapshot();
  });

  it('row 6: a shared deposit refunds only this row share', async () => {
    hoisted.refundPlan = { amountPence: 800, idempotencyKey: 'idem-shared' };
    const frozen = await run({ booking: paidRefundable({ group_booking_id: 'grp-char' }) });
    expectFrozen(frozen, { status: 200 });
    expect(
      (frozen.externalCalls.find((c) => c.fn === 'refunds.create')?.args[0] as { amount?: number }).amount,
    ).toBe(800);
    expect(frozen).toMatchSnapshot();
  });

  it('row 7: a card hold before the deadline is released and the copy says so', async () => {
    hoisted.cardHoldRow = { id: 'hold-1', released_at: null };
    hoisted.settleResult = { releasedBookingIds: [IDS.booking], keptHolds: [] };
    const frozen = await run({ booking: baseBooking({ deposit_status: 'Card Held' }) });
    expectFrozen(frozen, { status: 200 });
    const body = frozen.body as { card_hold_released?: boolean; card_hold_kept?: boolean; card_hold_message?: string };
    expect(body.card_hold_released).toBe(true);
    expect(body.card_hold_kept).toBe(false);
    expect(body.card_hold_message).toContain('will not be charged');
    expect(frozen).toMatchSnapshot();
  });

  it('row 8: a card hold after the deadline is kept, with the fee copy', async () => {
    hoisted.cardHoldRow = { id: 'hold-1', released_at: null };
    hoisted.settleResult = { releasedBookingIds: [], keptHolds: [{ bookingId: IDS.booking, feePence: 1500 }] };
    const frozen = await run({
      booking: baseBooking({
        deposit_status: 'Card Held',
        cancellation_deadline: '2026-05-30T09:00:00+00:00', // passed
      }),
    });
    expectFrozen(frozen, { status: 200 });
    const body = frozen.body as { card_hold_kept?: boolean; card_hold_message?: string };
    expect(body.card_hold_kept).toBe(true);
    expect(body.card_hold_message).toContain('no-show fee');
    expect(frozen).toMatchSnapshot();
  });

  it('row 9: a class paid by credit restores credits and writes class_credit_restored', async () => {
    hoisted.creditPaid = true;
    hoisted.restoredCredits = 2;
    const frozen = await run({
      booking: baseBooking({ class_instance_id: 'ci-char', calendar_id: null, service_item_id: null }),
    });
    expectFrozen(frozen, { status: 200 });
    const evt = frozen.dbWrites.find(
      (w) => w.table === 'events' && (w.payload as { event_type?: string })?.event_type === 'class_credit_restored',
    );
    expect(evt?.payload).toMatchObject({
      event_type: 'class_credit_restored',
      payload: { restored_credits: 2, source: 'guest_self_cancel' },
    });
    expect(frozen).toMatchSnapshot();
  });

  it('row 10: a class paid by membership restores the allowance', async () => {
    hoisted.membershipPaid = true;
    hoisted.restoredSessions = 1;
    const frozen = await run({
      booking: baseBooking({ class_instance_id: 'ci-char', calendar_id: null, service_item_id: null }),
    });
    expectFrozen(frozen, { status: 200 });
    const evt = frozen.dbWrites.find(
      (w) =>
        w.table === 'events' &&
        (w.payload as { event_type?: string })?.event_type === 'class_membership_allowance_restored',
    );
    expect(evt?.payload).toMatchObject({ payload: { restored_sessions: 1, source: 'guest_self_cancel' } });
    expect(frozen).toMatchSnapshot();
  });

  it('row 11: a class cancelled after the deadline restores nothing', async () => {
    hoisted.creditPaid = true;
    hoisted.restoredCredits = 2;
    const frozen = await run({
      booking: baseBooking({
        class_instance_id: 'ci-char',
        calendar_id: null,
        service_item_id: null,
        cancellation_deadline: '2026-05-30T09:00:00+00:00', // passed
      }),
    });
    expectFrozen(frozen, { status: 200 });
    // Eligibility is the deadline, not the payment method: no restore call at all.
    expect(frozen.externalCalls.some((c) => c.fn === 'restoreClassCreditsForBooking')).toBe(false);
    expect(frozen.dbWrites.some((w) => w.table === 'events')).toBe(false);
    expect(frozen).toMatchSnapshot();
  });

  it('row 12: an event ticket carries experience_event_id into the waitlist payload', async () => {
    hoisted.waitlist = { offered: true, mode: 'notify_all', waitlistEntryId: 'wl-1' };
    const frozen = await run({
      booking: baseBooking({
        experience_event_id: 'ev-char',
        calendar_id: null,
        service_item_id: null,
      }),
    });
    expectFrozen(frozen, { status: 200 });
    const wl = frozen.externalCalls.find((c) => c.fn === 'offerAppointmentWaitlistOnCancel');
    expect(wl?.args[0]).toMatchObject({ experience_event_id: 'ev-char', id: IDS.booking });
    // No credit restore for an event ticket.
    expect(frozen.externalCalls.some((c) => c.fn === 'restoreClassCreditsForBooking')).toBe(false);
    expect(frozen).toMatchSnapshot();
  });

  it('row 13: the open deposit intent is cancelled with the booking', async () => {
    const frozen = await run({ booking: paidRefundable() });
    expectFrozen(frozen, { status: 200 });
    // Plan 8.3/D7: a cancelled booking must not leave a payable intent behind.
    const call = frozen.externalCalls.find((c) => c.fn === 'cancelOpenDepositIntentForBookings');
    expect(call?.args[0]).toMatchObject({ settledBookingIds: [IDS.booking], venueId: IDS.venue });
    // And the cancellation comms went out, carrying the refund message.
    expect(frozen.externalCalls.some((c) => c.fn === 'sendCancellationNotification')).toBe(true);
    expect(frozen).toMatchSnapshot();
  });
});
