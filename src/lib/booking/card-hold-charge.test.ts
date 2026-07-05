import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/stripe', () => ({
  stripe: {
    paymentIntents: {
      create: vi.fn(),
      cancel: vi.fn(),
    },
    refunds: { create: vi.fn() },
  },
}));

vi.mock('@/lib/communications/send-templated', () => ({
  sendCardHoldChargedReceipt: vi.fn().mockResolvedValue({ sent: true }),
}));

vi.mock('@/lib/booking/card-hold-release', () => ({
  releaseCardHoldsForBookings: vi.fn().mockResolvedValue({
    releasedBookingIds: [],
    deletedCustomerIds: [],
  }),
}));

import { stripe } from '@/lib/stripe';
import { sendCardHoldChargedReceipt } from '@/lib/communications/send-templated';
import { releaseCardHoldsForBookings } from '@/lib/booking/card-hold-release';
import {
  applyCardHoldChargeRefund,
  applyCardHoldChargedState,
  chargeCardHoldNoShowFee,
  completeCardHoldChargeFromWebhook,
  recordCardHoldChargeFailure,
} from '@/lib/booking/card-hold-charge';

const mockPiCreate = vi.mocked(stripe.paymentIntents.create);
const mockPiCancel = vi.mocked(stripe.paymentIntents.cancel);
const mockReceipt = vi.mocked(sendCardHoldChargedReceipt);
const mockRelease = vi.mocked(releaseCardHoldsForBookings);

type Row = Record<string, unknown>;
type Filter = [op: string, key: string, value: unknown];

/**
 * Stateful in-memory fake for the two tables the charge engine touches. It
 * applies eq/is/neq/in filter semantics against live rows, so interleaved
 * calls resolve the §8.3 race exactly as Postgres row filters would.
 */
function makeDb(initial: { hold: Row | null; booking: Row | null }) {
  const state = {
    hold: initial.hold,
    booking: initial.booking,
    events: [] as Row[],
  };

  const matches = (row: Row | null, filters: Filter[]): boolean => {
    if (!row) return false;
    return filters.every(([op, key, value]) => {
      if (op === 'eq') return row[key] === value;
      if (op === 'neq') return row[key] !== value;
      if (op === 'is') return row[key] == null;
      if (op === 'in') return Array.isArray(value) && value.includes(row[key]);
      return false;
    });
  };

  const admin = {
    from(table: string) {
      const ctx = {
        op: 'select' as 'select' | 'update' | 'insert',
        payload: undefined as unknown,
        filters: [] as Filter[],
      };
      const exec = (): { data: unknown; error: null } => {
        const target =
          table === 'booking_card_holds' ? 'hold' : table === 'bookings' ? 'booking' : null;
        if (table === 'events' && ctx.op === 'insert') {
          const rows = Array.isArray(ctx.payload) ? ctx.payload : [ctx.payload];
          state.events.push(...(rows as Row[]));
          return { data: null, error: null };
        }
        if (!target) throw new Error(`unexpected table ${table}`);
        const row = state[target];
        if (ctx.op === 'select') {
          return { data: matches(row, ctx.filters) ? [{ ...row }] : [], error: null };
        }
        if (ctx.op === 'update') {
          if (matches(row, ctx.filters)) {
            Object.assign(row as Row, ctx.payload as Row);
            return { data: [{ ...(row as Row) }], error: null };
          }
          return { data: [], error: null };
        }
        throw new Error(`unexpected op ${ctx.op} on ${table}`);
      };

      const builder: Record<string, unknown> = {};
      const chain = (fn: (...args: unknown[]) => void) =>
        (...args: unknown[]) => {
          fn(...args);
          return builder;
        };
      builder.select = chain(() => {});
      builder.update = chain((payload) => {
        ctx.op = 'update';
        ctx.payload = payload;
      });
      builder.insert = chain((payload) => {
        ctx.op = 'insert';
        ctx.payload = payload;
      });
      builder.eq = chain((k, v) => ctx.filters.push(['eq', k as string, v]));
      builder.neq = chain((k, v) => ctx.filters.push(['neq', k as string, v]));
      builder.is = chain((k, v) => ctx.filters.push(['is', k as string, v]));
      builder.in = chain((k, v) => ctx.filters.push(['in', k as string, v]));
      builder.maybeSingle = () => {
        const { data } = exec();
        const rows = data as Row[] | null;
        return Promise.resolve({ data: rows && rows.length > 0 ? rows[0] : null, error: null });
      };
      builder.then = (resolve: (v: unknown) => unknown, reject: (r?: unknown) => unknown) =>
        Promise.resolve(exec()).then(resolve, reject);
      return builder;
    },
  } as unknown as SupabaseClient;

  return { admin, state };
}

const daysAgoDate = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function holdRow(overrides?: Row): Row {
  return {
    id: 'h1',
    booking_id: 'b1',
    venue_id: 'v1',
    stripe_connected_account_id: 'acct_snapshot',
    stripe_customer_id: 'cus_1',
    stripe_payment_method_id: 'pm_1',
    fee_pence: 2500,
    charge_payment_intent_id: null,
    charged_pence: null,
    charged_at: null,
    charge_failure_code: null,
    charge_failure_at: null,
    charge_attempt_count: 0,
    released_at: null,
    ...overrides,
  };
}

function bookingRow(overrides?: Row): Row {
  return {
    id: 'b1',
    venue_id: 'v1',
    status: 'No-Show',
    deposit_status: 'Card Held',
    booking_date: daysAgoDate(3),
    booking_time: '18:00:00',
    booking_end_time: '19:00:00',
    estimated_end_time: null,
    ...overrides,
  };
}

const chargeParams = { bookingId: 'b1', venueId: 'v1', staffId: 'staff-1' };

function succeededPi(id: string, amount: number) {
  return { id, status: 'succeeded', amount, amount_received: amount };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReceipt.mockResolvedValue({ sent: true });
  mockRelease.mockResolvedValue({ releasedBookingIds: [], deletedCustomerIds: [] });
});

describe('chargeCardHoldNoShowFee guards (§9.2a)', () => {
  it('returns no_card_hold when no hold row exists', async () => {
    const { admin } = makeDb({ hold: null, booking: bookingRow() });
    const result = await chargeCardHoldNoShowFee(admin, chargeParams);
    expect(result).toMatchObject({ ok: false, code: 'no_card_hold' });
    expect(mockPiCreate).not.toHaveBeenCalled();
  });

  it('returns not_no_show with the exact spec message when the booking is not a no-show', async () => {
    const { admin } = makeDb({ hold: holdRow(), booking: bookingRow({ status: 'Booked' }) });
    const result = await chargeCardHoldNoShowFee(admin, chargeParams);
    expect(result).toEqual({
      ok: false,
      code: 'not_no_show',
      message: 'Mark the booking as a no-show before charging the fee.',
    });
    expect(mockPiCreate).not.toHaveBeenCalled();
  });

  it('returns invalid_state when deposit_status is not Card Held', async () => {
    const { admin } = makeDb({
      hold: holdRow(),
      booking: bookingRow({ deposit_status: 'Charged' }),
    });
    const result = await chargeCardHoldNoShowFee(admin, chargeParams);
    expect(result).toMatchObject({ ok: false, code: 'invalid_state' });
    expect(mockPiCreate).not.toHaveBeenCalled();
  });

  it('returns hold_released for a released hold', async () => {
    const { admin } = makeDb({
      hold: holdRow({ released_at: '2026-07-01T00:00:00.000Z' }),
      booking: bookingRow(),
    });
    const result = await chargeCardHoldNoShowFee(admin, chargeParams);
    expect(result).toMatchObject({ ok: false, code: 'hold_released' });
    expect(mockPiCreate).not.toHaveBeenCalled();
  });

  it('returns hold_expired when the booking ended more than CARD_HOLD_CHARGE_WINDOW_DAYS ago', async () => {
    const { admin } = makeDb({
      hold: holdRow(),
      booking: bookingRow({ booking_date: daysAgoDate(20) }),
    });
    const result = await chargeCardHoldNoShowFee(admin, chargeParams);
    expect(result).toMatchObject({ ok: false, code: 'hold_expired' });
    expect(mockPiCreate).not.toHaveBeenCalled();
  });

  it('returns no_saved_card when no payment method was saved', async () => {
    const { admin } = makeDb({
      hold: holdRow({ stripe_payment_method_id: null }),
      booking: bookingRow(),
    });
    const result = await chargeCardHoldNoShowFee(admin, chargeParams);
    expect(result).toMatchObject({ ok: false, code: 'no_saved_card' });
    expect(mockPiCreate).not.toHaveBeenCalled();
  });

  it('returns invalid_amount outside [1, fee_pence]', async () => {
    for (const amountPence of [0, -5, 2501]) {
      const { admin } = makeDb({ hold: holdRow(), booking: bookingRow() });
      const result = await chargeCardHoldNoShowFee(admin, { ...chargeParams, amountPence });
      expect(result).toMatchObject({ ok: false, code: 'invalid_amount' });
    }
    expect(mockPiCreate).not.toHaveBeenCalled();
  });

  it('returns invalid_state when the claim is closed by an existing charge PI', async () => {
    const { admin } = makeDb({
      hold: holdRow({ charge_payment_intent_id: 'pi_existing' }),
      booking: bookingRow(),
    });
    const result = await chargeCardHoldNoShowFee(admin, chargeParams);
    expect(result).toMatchObject({ ok: false, code: 'invalid_state' });
    expect(mockPiCreate).not.toHaveBeenCalled();
  });
});

describe('chargeCardHoldNoShowFee success (§8.3)', () => {
  it('creates the PI per §8.3, persists it, applies the charged state, and sends the receipt', async () => {
    const { admin, state } = makeDb({ hold: holdRow(), booking: bookingRow() });
    mockPiCreate.mockResolvedValue(succeededPi('pi_fee_1', 2000) as never);

    const result = await chargeCardHoldNoShowFee(admin, { ...chargeParams, amountPence: 2000 });

    expect(result).toEqual({
      ok: true,
      chargedPence: 2000,
      paymentIntentId: 'pi_fee_1',
      pending: false,
    });

    // §8.3 PI shape: off-session MIT on the snapshotted connected account.
    expect(mockPiCreate).toHaveBeenCalledTimes(1);
    const [payload, options] = mockPiCreate.mock.calls[0] as unknown as [Row, Row];
    expect(payload).toMatchObject({
      amount: 2000,
      currency: 'gbp',
      customer: 'cus_1',
      payment_method: 'pm_1',
      payment_method_types: ['card'],
      off_session: true,
      confirm: true,
      description: 'No-show fee for booking B1',
      metadata: {
        reserve_ni_purpose: 'card_hold_no_show_fee',
        booking_id: 'b1',
        venue_id: 'v1',
      },
    });
    expect(options).toMatchObject({
      stripeAccount: 'acct_snapshot',
      idempotencyKey: 'card-hold-charge-h1-1',
    });

    // Webhook-equivalent state (§8.3 step 4).
    expect(state.hold).toMatchObject({
      charge_payment_intent_id: 'pi_fee_1',
      charged_pence: 2000,
      charged_by_staff_id: 'staff-1',
      charge_attempt_count: 1,
    });
    expect(state.hold?.charged_at).toBeTruthy();
    expect(state.booking?.deposit_status).toBe('Charged');
    expect(state.events).toEqual([
      {
        venue_id: 'v1',
        booking_id: 'b1',
        event_type: 'card_hold_charged',
        payload: { booking_id: 'b1', charged_pence: 2000 },
      },
    ]);
    expect(mockReceipt).toHaveBeenCalledTimes(1);
    expect(mockReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: 'b1', venueId: 'v1', chargedPence: 2000 }),
    );
  });

  it('defaults the amount to the full fee_pence', async () => {
    const { admin } = makeDb({ hold: holdRow(), booking: bookingRow() });
    mockPiCreate.mockResolvedValue(succeededPi('pi_fee_2', 2500) as never);
    const result = await chargeCardHoldNoShowFee(admin, chargeParams);
    expect(result).toMatchObject({ ok: true, chargedPence: 2500 });
    expect((mockPiCreate.mock.calls[0]![0] as unknown as Row).amount).toBe(2500);
  });
});

describe('chargeCardHoldNoShowFee interleaved race (§8.3 steps 1-3)', () => {
  it('lets exactly one of two interleaved requests charge; the loser cancels its own PI and gets invalid_state', async () => {
    const { admin, state } = makeDb({ hold: holdRow(), booking: bookingRow() });

    // Barrier: neither PI create resolves until BOTH requests have created one,
    // i.e. both are past the claim (step 1) before either persists (step 3).
    let created = 0;
    const waiters: Array<() => void> = [];
    mockPiCreate.mockImplementation(((payload: Row, options: Row) => {
      created += 1;
      const pi = succeededPi(`pi_race_${(options as { idempotencyKey: string }).idempotencyKey}`, payload.amount as number);
      return new Promise((resolve) => {
        waiters.push(() => resolve(pi));
        if (created === 2) waiters.forEach((w) => w());
      });
    }) as never);
    mockPiCancel.mockResolvedValue({} as never);

    const [a, b] = await Promise.all([
      chargeCardHoldNoShowFee(admin, chargeParams),
      chargeCardHoldNoShowFee(admin, chargeParams),
    ]);

    const results = [a, b];
    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]).toMatchObject({ ok: false, code: 'invalid_state' });

    // Distinct attempts feed distinct idempotency keys (no cached-decline replay).
    expect(mockPiCreate).toHaveBeenCalledTimes(2);
    const keys = mockPiCreate.mock.calls.map(
      (c) => (c[1] as { idempotencyKey: string }).idempotencyKey,
    );
    expect(new Set(keys).size).toBe(2);
    expect(keys.sort()).toEqual(['card-hold-charge-h1-1', 'card-hold-charge-h1-2']);

    // The loser cancelled its OWN just-created PI, not the winner's.
    const winner = winners[0] as { ok: true; paymentIntentId: string };
    expect(mockPiCancel).toHaveBeenCalledTimes(1);
    const cancelledId = mockPiCancel.mock.calls[0]![0];
    expect(cancelledId).not.toBe(winner.paymentIntentId);
    expect(mockPiCancel.mock.calls[0]![1]).toEqual({ stripeAccount: 'acct_snapshot' });

    // Exactly one charge applied.
    expect(state.hold?.charge_payment_intent_id).toBe(winner.paymentIntentId);
    expect(state.booking?.deposit_status).toBe('Charged');
    expect(state.events.filter((e) => e.event_type === 'card_hold_charged')).toHaveLength(1);
    expect(mockReceipt).toHaveBeenCalledTimes(1);
  });
});

describe('chargeCardHoldNoShowFee failures (§8.5)', () => {
  it('records a decline, reopens the claim, and allows a retry with a fresh idempotency key', async () => {
    const { admin, state } = makeDb({ hold: holdRow(), booking: bookingRow() });
    mockPiCreate.mockRejectedValueOnce({
      type: 'StripeCardError',
      code: 'card_declined',
      decline_code: 'insufficient_funds',
    });

    const first = await chargeCardHoldNoShowFee(admin, chargeParams);
    expect(first).toEqual({
      ok: false,
      code: 'card_declined',
      message:
        'The card was declined (insufficient funds). You can try again, or contact the client to arrange payment.',
    });

    // Failure recorded on the hold; deposit_status untouched; claim reopened.
    expect(state.hold).toMatchObject({
      charge_failure_code: 'card_declined',
      charge_payment_intent_id: null,
      charge_attempt_count: 1,
    });
    expect(state.hold?.charge_failure_at).toBeTruthy();
    expect(state.booking?.deposit_status).toBe('Card Held');
    expect(state.events).toEqual([
      {
        venue_id: 'v1',
        booking_id: 'b1',
        event_type: 'card_hold_charge_failed',
        payload: { booking_id: 'b1', failure_code: 'card_declined' },
      },
    ]);
    expect(mockPiCancel).not.toHaveBeenCalled();
    expect(mockReceipt).not.toHaveBeenCalled();

    // Retry: the reopened claim yields attempt 2 and succeeds.
    mockPiCreate.mockResolvedValueOnce(succeededPi('pi_retry', 2500) as never);
    const second = await chargeCardHoldNoShowFee(admin, chargeParams);
    expect(second).toMatchObject({ ok: true, paymentIntentId: 'pi_retry' });
    expect(
      (mockPiCreate.mock.calls[1]![1] as { idempotencyKey: string }).idempotencyKey,
    ).toBe('card-hold-charge-h1-2');
    expect(state.hold).toMatchObject({
      charged_pence: 2500,
      charge_failure_code: null,
      charge_failure_at: null,
    });
    expect(state.booking?.deposit_status).toBe('Charged');
  });

  it('handles authentication_required: exact message plus stray requires_action PI cancel', async () => {
    const { admin, state } = makeDb({ hold: holdRow(), booking: bookingRow() });
    mockPiCreate.mockRejectedValueOnce({
      type: 'StripeCardError',
      code: 'authentication_required',
      payment_intent: { id: 'pi_stray' },
    });
    mockPiCancel.mockResolvedValue({} as never);

    const result = await chargeCardHoldNoShowFee(admin, chargeParams);
    expect(result).toEqual({
      ok: false,
      code: 'authentication_required',
      message:
        'The card issuer requires the client to authorise this payment in person. Off-session charging is not possible for this card.',
    });
    expect(mockPiCancel).toHaveBeenCalledWith('pi_stray', { stripeAccount: 'acct_snapshot' });
    expect(state.hold).toMatchObject({
      charge_failure_code: 'authentication_required',
      charge_payment_intent_id: null,
    });
    expect(state.booking?.deposit_status).toBe('Card Held');
  });

  it('sync decline never clears a DIFFERENT persisted PI (concurrent winner survives)', async () => {
    // While our create is in flight (post-claim), a concurrent winner persists
    // its PI. Our synchronous decline must not wipe it: only an id equal to the
    // failed attempt's own dead PI may be cleared.
    const { admin, state } = makeDb({ hold: holdRow(), booking: bookingRow() });
    mockPiCreate.mockImplementationOnce((() => {
      (state.hold as Row).charge_payment_intent_id = 'pi_winner';
      return Promise.reject({
        type: 'StripeCardError',
        code: 'card_declined',
        decline_code: 'insufficient_funds',
        payment_intent: { id: 'pi_dead' },
      });
    }) as never);

    const result = await chargeCardHoldNoShowFee(admin, chargeParams);
    expect(result).toMatchObject({ ok: false, code: 'card_declined' });
    expect(state.hold?.charge_payment_intent_id).toBe('pi_winner');
    expect(state.hold?.charge_failure_code).toBe('card_declined');
  });

  it("sync decline clears the persisted id when it IS the failed attempt's own dead PI", async () => {
    const { admin, state } = makeDb({ hold: holdRow(), booking: bookingRow() });
    mockPiCreate.mockImplementationOnce((() => {
      (state.hold as Row).charge_payment_intent_id = 'pi_dead';
      return Promise.reject({
        type: 'StripeCardError',
        code: 'card_declined',
        payment_intent: { id: 'pi_dead' },
      });
    }) as never);

    const result = await chargeCardHoldNoShowFee(admin, chargeParams);
    expect(result).toMatchObject({ ok: false, code: 'card_declined' });
    expect(state.hold?.charge_payment_intent_id).toBeNull(); // claim reopened
  });

  it('returns charge_failed for non-card Stripe errors without touching state', async () => {
    const { admin, state } = makeDb({ hold: holdRow(), booking: bookingRow() });
    mockPiCreate.mockRejectedValueOnce(new Error('stripe unreachable'));
    const result = await chargeCardHoldNoShowFee(admin, chargeParams);
    expect(result).toMatchObject({ ok: false, code: 'charge_failed' });
    expect(state.booking?.deposit_status).toBe('Card Held');
    expect(state.hold?.charge_payment_intent_id).toBeNull();
  });
});

describe('applyCardHoldChargedState / completeCardHoldChargeFromWebhook (§8.6.1)', () => {
  it('is idempotent: the second application is a no-op with no duplicate event', async () => {
    const { admin, state } = makeDb({ hold: holdRow(), booking: bookingRow() });
    const input = {
      holdId: 'h1',
      bookingId: 'b1',
      venueId: 'v1',
      paymentIntentId: 'pi_fee',
      amountReceivedPence: 2500,
    };
    const first = await applyCardHoldChargedState(admin, input);
    const second = await applyCardHoldChargedState(admin, input);
    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(state.events.filter((e) => e.event_type === 'card_hold_charged')).toHaveLength(1);
    expect(state.booking?.deposit_status).toBe('Charged');
  });

  it('completes from the webhook via charge_payment_intent_id', async () => {
    const { admin, state } = makeDb({
      hold: holdRow({ charge_payment_intent_id: 'pi_fee' }),
      booking: bookingRow(),
    });
    const completion = await completeCardHoldChargeFromWebhook(admin, {
      paymentIntentId: 'pi_fee',
      bookingId: null,
      amountReceivedPence: 2500,
    });
    expect(completion).toEqual({ applied: true, bookingId: 'b1', venueId: 'v1', chargedPence: 2500 });
    expect(state.booking?.deposit_status).toBe('Charged');
    expect(state.hold?.charged_pence).toBe(2500);
  });

  it('falls back to metadata.booking_id and backfills the PI id onto the hold', async () => {
    const { admin, state } = makeDb({ hold: holdRow(), booking: bookingRow() });
    const completion = await completeCardHoldChargeFromWebhook(admin, {
      paymentIntentId: 'pi_fee',
      bookingId: 'b1',
      amountReceivedPence: 1500,
    });
    expect(completion).toMatchObject({ applied: true });
    expect(state.hold?.charge_payment_intent_id).toBe('pi_fee');
    expect(state.hold?.charged_pence).toBe(1500);
  });

  it('skips (returns null) when the hold on file carries a different PI', async () => {
    const { admin, state } = makeDb({
      hold: holdRow({ charge_payment_intent_id: 'pi_other' }),
      booking: bookingRow(),
    });
    const completion = await completeCardHoldChargeFromWebhook(admin, {
      paymentIntentId: 'pi_fee',
      bookingId: 'b1',
      amountReceivedPence: 1500,
    });
    expect(completion).toBeNull();
    expect(state.booking?.deposit_status).toBe('Card Held');
  });

  it('replay (applied=false) does NOT resurrect a Refunded booking back to Charged', async () => {
    // A late payment_intent.succeeded replay arrives after the fee was refunded:
    // the hold is already stamped, so the flip converges only from 'Card Held'.
    const { admin, state } = makeDb({
      hold: holdRow({
        charge_payment_intent_id: 'pi_fee',
        charged_at: '2026-07-05T10:00:00.000Z',
        charged_pence: 2500,
      }),
      booking: bookingRow({ deposit_status: 'Refunded' }),
    });
    const result = await applyCardHoldChargedState(admin, {
      holdId: 'h1',
      bookingId: 'b1',
      venueId: 'v1',
      paymentIntentId: 'pi_fee',
      amountReceivedPence: 2500,
    });
    expect(result.applied).toBe(false);
    expect(state.booking?.deposit_status).toBe('Refunded');
    expect(state.events).toHaveLength(0);
  });

  it('replay (applied=false) still converges a Card Held booking to Charged (crash-heal)', async () => {
    // Crash between the stamp and the booking flip: the retry finds the hold
    // stamped (applied=false) but must still heal the booking.
    const { admin, state } = makeDb({
      hold: holdRow({
        charge_payment_intent_id: 'pi_fee',
        charged_at: '2026-07-05T10:00:00.000Z',
        charged_pence: 2500,
      }),
      booking: bookingRow({ deposit_status: 'Card Held' }),
    });
    const result = await applyCardHoldChargedState(admin, {
      holdId: 'h1',
      bookingId: 'b1',
      venueId: 'v1',
      paymentIntentId: 'pi_fee',
      amountReceivedPence: 2500,
    });
    expect(result.applied).toBe(false);
    expect(state.booking?.deposit_status).toBe('Charged');
    expect(state.events).toHaveLength(0); // heal-only: no duplicate event
  });

  it('reports applied=false on a webhook replay after the route already applied the state', async () => {
    const { admin, state } = makeDb({
      hold: holdRow({
        charge_payment_intent_id: 'pi_fee',
        charged_at: '2026-07-05T10:00:00.000Z',
        charged_pence: 2500,
      }),
      booking: bookingRow({ deposit_status: 'Charged' }),
    });
    const completion = await completeCardHoldChargeFromWebhook(admin, {
      paymentIntentId: 'pi_fee',
      bookingId: 'b1',
      amountReceivedPence: 2500,
    });
    expect(completion).toMatchObject({ applied: false });
    expect(state.events).toHaveLength(0);
  });
});

describe('recordCardHoldChargeFailure (§8.6.3)', () => {
  it('records failure fields on an uncharged hold without touching the booking', async () => {
    const { admin, state } = makeDb({ hold: holdRow(), booking: bookingRow() });
    await recordCardHoldChargeFailure(admin, {
      paymentIntentId: null,
      bookingId: 'b1',
      failureCode: 'card_declined',
      failureAtIso: '2026-07-05T10:00:00.000Z',
    });
    expect(state.hold).toMatchObject({
      charge_failure_code: 'card_declined',
      charge_failure_at: '2026-07-05T10:00:00.000Z',
    });
    expect(state.booking?.deposit_status).toBe('Card Held');
  });

  it('reopens the claim when the persisted PI is the one that failed asynchronously', async () => {
    const { admin, state } = makeDb({
      hold: holdRow({ charge_payment_intent_id: 'pi_fail' }),
      booking: bookingRow(),
    });
    await recordCardHoldChargeFailure(admin, {
      paymentIntentId: 'pi_fail',
      bookingId: 'b1',
      failureCode: 'card_declined',
      failureAtIso: '2026-07-05T10:00:00.000Z',
    });
    expect(state.hold).toMatchObject({
      charge_failure_code: 'card_declined',
      charge_payment_intent_id: null, // claim reopened for a retry
    });
    expect(state.booking?.deposit_status).toBe('Card Held');
  });

  it("leaves the persisted PI alone when it differs from the failed PI (a newer attempt owns it)", async () => {
    const { admin, state } = makeDb({
      hold: holdRow({ charge_payment_intent_id: 'pi_other' }),
      booking: bookingRow(),
    });
    await recordCardHoldChargeFailure(admin, {
      paymentIntentId: 'pi_fail',
      bookingId: 'b1',
      failureCode: 'card_declined',
      failureAtIso: '2026-07-05T10:00:00.000Z',
    });
    expect(state.hold).toMatchObject({
      charge_failure_code: 'card_declined',
      charge_payment_intent_id: 'pi_other',
    });
  });

  it('never overwrites a charged hold or an equally-new failure', async () => {
    const { admin, state } = makeDb({
      hold: holdRow({ charged_at: '2026-07-05T09:00:00.000Z' }),
      booking: bookingRow({ deposit_status: 'Charged' }),
    });
    await recordCardHoldChargeFailure(admin, {
      paymentIntentId: null,
      bookingId: 'b1',
      failureCode: 'card_declined',
      failureAtIso: '2026-07-05T10:00:00.000Z',
    });
    expect(state.hold?.charge_failure_code).toBeNull();

    const newer = makeDb({
      hold: holdRow({ charge_failure_code: 'expired_card', charge_failure_at: '2026-07-05T11:00:00.000Z' }),
      booking: bookingRow(),
    });
    await recordCardHoldChargeFailure(newer.admin, {
      paymentIntentId: null,
      bookingId: 'b1',
      failureCode: 'card_declined',
      failureAtIso: '2026-07-05T10:00:00.000Z',
    });
    expect(newer.state.hold?.charge_failure_code).toBe('expired_card');
  });
});

describe('applyCardHoldChargeRefund (§8.6.6 / §9.2e)', () => {
  it('flips the booking to Refunded, inserts the event, and releases the hold with reason refunded', async () => {
    const { admin, state } = makeDb({
      hold: holdRow({ charge_payment_intent_id: 'pi_fee', charged_pence: 2500 }),
      booking: bookingRow({ deposit_status: 'Charged' }),
    });
    const result = await applyCardHoldChargeRefund(admin, {
      bookingId: 'b1',
      venueId: 'v1',
      chargedPence: 2500,
    });
    expect(result.applied).toBe(true);
    expect(state.booking?.deposit_status).toBe('Refunded');
    expect(state.events).toEqual([
      {
        venue_id: 'v1',
        booking_id: 'b1',
        event_type: 'card_hold_charge_refunded',
        payload: { booking_id: 'b1', charged_pence: 2500 },
      },
    ]);
    expect(mockRelease).toHaveBeenCalledWith(admin, ['b1'], 'refunded');
  });

  it('is idempotent: a replay does not duplicate the event', async () => {
    const { admin, state } = makeDb({
      hold: holdRow({ charge_payment_intent_id: 'pi_fee', charged_pence: 2500 }),
      booking: bookingRow({ deposit_status: 'Refunded' }),
    });
    const result = await applyCardHoldChargeRefund(admin, {
      bookingId: 'b1',
      venueId: 'v1',
      chargedPence: 2500,
    });
    expect(result.applied).toBe(false);
    expect(state.events).toHaveLength(0);
    // Release is still ensured (idempotent no-op inside the release helper).
    expect(mockRelease).toHaveBeenCalledWith(admin, ['b1'], 'refunded');
  });
});
