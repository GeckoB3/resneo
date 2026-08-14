import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildRefundIdempotencyKey, planSharedDepositRefund } from './shared-deposit-refund';

type Row = { id: string; deposit_status: string | null; deposit_amount_pence: number | null };

function makeDb(rows: Row[], error: { message: string } | null = null): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          limit: async () => ({ data: error ? null : rows, error }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

const paid = (id: string, pence: number): Row => ({
  id,
  deposit_status: 'Paid',
  deposit_amount_pence: pence,
});

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('planSharedDepositRefund', () => {
  it('refunds one member share when only some of a group is cancelled', async () => {
    // The C11 defect: three attendees on one £30 intent, one cancels.
    const db = makeDb([paid('a', 1000), paid('b', 1000), paid('c', 1000)]);

    const plan = await planSharedDepositRefund(db, {
      paymentIntentId: 'pi_1',
      settlingBookingIds: ['a'],
    });

    expect(plan.amountPence).toBe(1000);
    expect(plan.coversWholeIntent).toBe(false);
    expect(plan.refundedBookingIds).toEqual(['a']);
  });

  it('sums only the settling rows on a multi-row partial cancel', async () => {
    const db = makeDb([paid('a', 1500), paid('b', 2500), paid('c', 1000)]);

    const plan = await planSharedDepositRefund(db, {
      paymentIntentId: 'pi_1',
      settlingBookingIds: ['a', 'c'],
    });

    expect(plan.amountPence).toBe(2500);
    expect(plan.refundedBookingIds.sort()).toEqual(['a', 'c']);
  });

  it('omits the amount when every paid row on the intent is being settled', async () => {
    // Full party cancel: refund amount-less so Stripe returns the whole
    // remaining balance, immune to deposit_amount_pence having drifted.
    const db = makeDb([paid('a', 1000), paid('b', 1000)]);

    const plan = await planSharedDepositRefund(db, {
      paymentIntentId: 'pi_1',
      settlingBookingIds: ['a', 'b'],
    });

    expect(plan.amountPence).toBeNull();
    expect(plan.coversWholeIntent).toBe(true);
  });

  it('omits the amount for an ordinary single booking', async () => {
    const db = makeDb([paid('only', 2000)]);

    const plan = await planSharedDepositRefund(db, {
      paymentIntentId: 'pi_1',
      settlingBookingIds: ['only'],
    });

    expect(plan.amountPence).toBeNull();
  });

  it('ignores siblings that are not Paid', async () => {
    // A 'Card Held' sibling shares the intent but was never charged, and an
    // already-'Refunded' sibling has had its share returned. Settling the one
    // remaining paid row is therefore full coverage of what is still owed.
    const db = makeDb([
      paid('a', 1000),
      { id: 'b', deposit_status: 'Card Held', deposit_amount_pence: null },
      { id: 'c', deposit_status: 'Refunded', deposit_amount_pence: 1000 },
    ]);

    const plan = await planSharedDepositRefund(db, {
      paymentIntentId: 'pi_1',
      settlingBookingIds: ['a'],
    });

    expect(plan.amountPence).toBeNull();
    expect(plan.coversWholeIntent).toBe(true);
    expect(plan.refundedBookingIds).toEqual(['a']);
  });

  it('does not fall back to a full refund when a paid row has no amount', async () => {
    // Under-refunding is recoverable by hand; handing back the whole party's
    // money because one row is unpriced is the defect this exists to prevent.
    const db = makeDb([
      { id: 'a', deposit_status: 'Paid', deposit_amount_pence: null },
      paid('b', 1000),
    ]);

    const plan = await planSharedDepositRefund(db, {
      paymentIntentId: 'pi_1',
      settlingBookingIds: ['a'],
    });

    expect(plan.amountPence).toBe(0);
    expect(plan.coversWholeIntent).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it('throws when the rows cannot be read, rather than guessing', async () => {
    const db = makeDb([], { message: 'boom' });

    await expect(
      planSharedDepositRefund(db, { paymentIntentId: 'pi_1', settlingBookingIds: ['a'] }),
    ).rejects.toThrow(/could not read rows/);
  });

  it('warns and refunds the balance when no settling row is paid on the intent', async () => {
    const db = makeDb([paid('other', 1000)]);

    const plan = await planSharedDepositRefund(db, {
      paymentIntentId: 'pi_1',
      settlingBookingIds: ['a'],
    });

    expect(plan.amountPence).toBeNull();
    expect(plan.refundedBookingIds).toEqual([]);
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('buildRefundIdempotencyKey', () => {
  it('is stable regardless of the order the ids arrive in', () => {
    expect(buildRefundIdempotencyKey('pi_1', ['b', 'a'])).toBe(
      buildRefundIdempotencyKey('pi_1', ['a', 'b']),
    );
  });

  it('differs per set, so cancelling a second member is not deduped away', () => {
    expect(buildRefundIdempotencyKey('pi_1', ['a'])).not.toBe(
      buildRefundIdempotencyKey('pi_1', ['b']),
    );
  });

  it('is namespaced away from the card-hold fee and balance refunds', () => {
    const key = buildRefundIdempotencyKey('pi_1', ['a']);
    expect(key.startsWith('deposit_refund:')).toBe(true);
    // `refund:${pi}` is charge/route.ts, `hold_fee_refund:` is the deposit
    // route's fee branch. Neither may ever collide with this one.
    expect(key).not.toBe('refund:pi_1');
    expect(key.startsWith('hold_fee_refund:')).toBe(false);
  });

  it('stays inside Stripe’s 255-character key limit for a large group', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `booking-${i}`);
    expect(buildRefundIdempotencyKey('pi_123456789', ids).length).toBeLessThanOrEqual(255);
  });
});
