import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/booking/payment-summary', () => ({
  recomputeBookingPaymentSummary: vi.fn().mockResolvedValue(undefined),
}));

import { recomputeBookingPaymentSummary } from '@/lib/booking/payment-summary';
import {
  applyBalancePaymentRefundFromWebhook,
  confirmBalancePaymentFromPaymentIntent,
  markBalancePaymentFailedForPaymentIntent,
} from './confirm-balance-payment';

const mockRecompute = vi.mocked(recomputeBookingPaymentSummary);

type Row = Record<string, unknown>;

/**
 * Stateful fake for the tables the confirm helpers touch: a single
 * booking_payments row, the venue, the booking, and captured events inserts.
 * Filters apply eq/in/neq semantics against the live row so status guards
 * behave exactly as Postgres row filters would.
 */
function makeDb(initial: {
  payment: Row | null;
  venue?: Row | null;
  booking?: Row | null;
  failPaymentInsertWith?: { code: string; message: string } | null;
}) {
  const state = {
    payment: initial.payment,
    venue: initial.venue ?? null,
    booking: initial.booking ?? null,
    events: [] as Row[],
    paymentInserts: [] as Row[],
  };

  const matches = (row: Row | null, filters: Array<[string, string, unknown]>): boolean => {
    if (!row) return false;
    return filters.every(([op, key, value]) => {
      if (op === 'eq') return row[key] === value;
      if (op === 'neq') return row[key] !== value;
      if (op === 'in') return Array.isArray(value) && value.includes(row[key]);
      return false;
    });
  };

  const admin = {
    from(table: string) {
      const ctx = {
        op: 'select' as 'select' | 'update' | 'insert',
        payload: undefined as unknown,
        filters: [] as Array<[string, string, unknown]>,
      };
      const exec = (): { data: unknown; error: unknown } => {
        if (table === 'events' && ctx.op === 'insert') {
          state.events.push(ctx.payload as Row);
          return { data: null, error: null };
        }
        if (table === 'booking_payments' && ctx.op === 'insert') {
          if (initial.failPaymentInsertWith) {
            return { data: null, error: initial.failPaymentInsertWith };
          }
          state.paymentInserts.push(ctx.payload as Row);
          state.payment = { id: 'inserted', ...(ctx.payload as Row) };
          return { data: null, error: null };
        }
        const row =
          table === 'booking_payments'
            ? state.payment
            : table === 'venues'
              ? state.venue
              : table === 'bookings'
                ? state.booking
                : null;
        if (ctx.op === 'select') {
          return { data: matches(row, ctx.filters) ? { ...row } : null, error: null };
        }
        if (ctx.op === 'update') {
          if (matches(row, ctx.filters)) Object.assign(row as Row, ctx.payload as Row);
          return { data: null, error: null };
        }
        throw new Error(`unexpected ${ctx.op} on ${table}`);
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
      builder.in = chain((k, v) => ctx.filters.push(['in', k as string, v]));
      builder.maybeSingle = () => Promise.resolve(exec());
      builder.then = (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) => Promise.resolve(exec()).then(resolve, reject);
      return builder;
    },
  };

  return { admin: admin as unknown as SupabaseClient, state };
}

const pendingRow = (): Row => ({
  id: 'pay-1',
  booking_id: 'b1',
  venue_id: 'v1',
  status: 'pending',
  amount_pence: 3000,
  stripe_payment_intent_id: 'pi_1',
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('confirmBalancePaymentFromPaymentIntent', () => {
  it('flips a pending row to succeeded, recomputes, and writes the timeline event', async () => {
    const { admin, state } = makeDb({ payment: pendingRow() });
    const result = await confirmBalancePaymentFromPaymentIntent(admin, {
      paymentIntentId: 'pi_1',
      amountReceivedPence: 3000,
      connectedAccountId: 'acct_1',
    });
    expect(result).toEqual({ applied: true, bookingId: 'b1', venueId: 'v1', amountPence: 3000 });
    expect(state.payment!.status).toBe('succeeded');
    expect(mockRecompute).toHaveBeenCalledWith(admin, 'b1');
    expect(state.events).toHaveLength(1);
    expect(state.events[0]!.event_type).toBe('balance_payment_taken');
  });

  it('uses the captured amount when it differs from the ledger row', async () => {
    const { admin, state } = makeDb({ payment: pendingRow() });
    const result = await confirmBalancePaymentFromPaymentIntent(admin, {
      paymentIntentId: 'pi_1',
      amountReceivedPence: 2500,
      connectedAccountId: 'acct_1',
    });
    expect(result?.amountPence).toBe(2500);
    expect(state.payment!.amount_pence).toBe(2500);
  });

  it('is a no-op on replay (row already succeeded): no recompute, no second event', async () => {
    const { admin, state } = makeDb({ payment: { ...pendingRow(), status: 'succeeded' } });
    const result = await confirmBalancePaymentFromPaymentIntent(admin, {
      paymentIntentId: 'pi_1',
      amountReceivedPence: 3000,
      connectedAccountId: 'acct_1',
    });
    expect(result?.applied).toBe(false);
    expect(mockRecompute).not.toHaveBeenCalled();
    expect(state.events).toHaveLength(0);
  });

  it('never resurrects a refunded row (out-of-order refund before succeeded)', async () => {
    const { admin, state } = makeDb({ payment: { ...pendingRow(), status: 'refunded' } });
    const result = await confirmBalancePaymentFromPaymentIntent(admin, {
      paymentIntentId: 'pi_1',
      amountReceivedPence: 3000,
      connectedAccountId: 'acct_1',
    });
    expect(result?.applied).toBe(false);
    expect(state.payment!.status).toBe('refunded');
  });

  it('inserts from metadata when the event beat the route insert (account verified)', async () => {
    const { admin, state } = makeDb({
      payment: null,
      venue: { id: 'v1', stripe_connected_account_id: 'acct_1' },
      booking: { id: 'b1', venue_id: 'v1' },
    });
    const result = await confirmBalancePaymentFromPaymentIntent(admin, {
      paymentIntentId: 'pi_1',
      bookingId: 'b1',
      venueId: 'v1',
      amountReceivedPence: 3000,
      connectedAccountId: 'acct_1',
    });
    expect(result?.applied).toBe(true);
    expect(state.paymentInserts).toHaveLength(1);
    expect(state.payment!.status).toBe('succeeded');
    expect(mockRecompute).toHaveBeenCalledWith(admin, 'b1');
  });

  it("refuses the metadata fallback when the event account does not match the venue's", async () => {
    const { admin, state } = makeDb({
      payment: null,
      venue: { id: 'v1', stripe_connected_account_id: 'acct_1' },
      booking: { id: 'b1', venue_id: 'v1' },
    });
    const result = await confirmBalancePaymentFromPaymentIntent(admin, {
      paymentIntentId: 'pi_1',
      bookingId: 'b1',
      venueId: 'v1',
      amountReceivedPence: 3000,
      connectedAccountId: 'acct_EVIL',
    });
    expect(result).toBeNull();
    expect(state.paymentInserts).toHaveLength(0);
    expect(mockRecompute).not.toHaveBeenCalled();
  });

  it('refuses the metadata fallback when the booking is not in the metadata venue', async () => {
    const { admin, state } = makeDb({
      payment: null,
      venue: { id: 'v1', stripe_connected_account_id: 'acct_1' },
      booking: { id: 'b1', venue_id: 'OTHER' },
    });
    const result = await confirmBalancePaymentFromPaymentIntent(admin, {
      paymentIntentId: 'pi_1',
      bookingId: 'b1',
      venueId: 'v1',
      amountReceivedPence: 3000,
      connectedAccountId: 'acct_1',
    });
    expect(result).toBeNull();
    expect(state.paymentInserts).toHaveLength(0);
  });

  it('skips when there is no row and no usable metadata/account', async () => {
    const { admin } = makeDb({ payment: null });
    const result = await confirmBalancePaymentFromPaymentIntent(admin, {
      paymentIntentId: 'pi_1',
      amountReceivedPence: 3000,
      connectedAccountId: null,
    });
    expect(result).toBeNull();
  });
});

describe('markBalancePaymentFailedForPaymentIntent', () => {
  it('flips only a pending row to failed', async () => {
    const { admin, state } = makeDb({ payment: pendingRow() });
    await markBalancePaymentFailedForPaymentIntent(admin, 'pi_1');
    expect(state.payment!.status).toBe('failed');
  });

  it('never regresses a succeeded row', async () => {
    const { admin, state } = makeDb({ payment: { ...pendingRow(), status: 'succeeded' } });
    await markBalancePaymentFailedForPaymentIntent(admin, 'pi_1');
    expect(state.payment!.status).toBe('succeeded');
  });
});

describe('applyBalancePaymentRefundFromWebhook', () => {
  it('flips a succeeded row to refunded, recomputes, and writes the event', async () => {
    const { admin, state } = makeDb({ payment: { ...pendingRow(), status: 'succeeded' } });
    const result = await applyBalancePaymentRefundFromWebhook(admin, 'pi_1');
    expect(result?.applied).toBe(true);
    expect(state.payment!.status).toBe('refunded');
    expect(mockRecompute).toHaveBeenCalledWith(admin, 'b1');
    expect(state.events[0]!.event_type).toBe('balance_payment_refunded');
  });

  it('is idempotent: a second delivery reports applied=false with no extra work', async () => {
    const { admin, state } = makeDb({ payment: { ...pendingRow(), status: 'refunded' } });
    const result = await applyBalancePaymentRefundFromWebhook(admin, 'pi_1');
    expect(result?.applied).toBe(false);
    expect(mockRecompute).not.toHaveBeenCalled();
    expect(state.events).toHaveLength(0);
  });

  it('returns null for an unknown PI (not a balance payment)', async () => {
    const { admin } = makeDb({ payment: null });
    const result = await applyBalancePaymentRefundFromWebhook(admin, 'pi_x');
    expect(result).toBeNull();
  });
});
