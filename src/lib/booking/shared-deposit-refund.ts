import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * C11 — one PaymentIntent, many bookings.
 *
 * A group booking creates a SINGLE PaymentIntent for the whole party
 * (`create-group/route.ts:728`, `amount: totalDepositPence`) and links it to
 * every member row (`:749`). Multi-service visits and class carts do the same.
 * So `stripe.refunds.create({ payment_intent })` with no `amount` refunds
 * EVERY member's deposit, no matter how many of them are actually being
 * cancelled. Cancelling one attendee returned the whole party's money.
 *
 * This resolves how much of a shared PI a given set of bookings is entitled to
 * refund, and the idempotency key that makes the refund safe to retry.
 *
 * WHY NOT ALWAYS PASS AN AMOUNT. The invariant that
 * `Σ deposit_amount_pence === PI amount` holds at creation, but it is written
 * once and never reconciled: a later edit to `deposit_amount_pence`, or a
 * refund issued from the Stripe dashboard, breaks it silently. Always passing a
 * computed amount would therefore change the wire behaviour of every refund in
 * the system, including the many that are correct today, and a mismatch turns a
 * working refund into a Stripe error — which at these call sites means a 502
 * and a booking left uncancelled. So the amount is passed ONLY when this is a
 * genuine partial settlement of the PI. When every still-Paid row on the PI is
 * being settled, we refund amount-less exactly as before and let Stripe return
 * the full remaining balance, which is both correct and unchanged.
 */
export interface SharedDepositRefundPlan {
  /** Pence to refund, or null to refund the PI's whole remaining balance. */
  amountPence: number | null;
  /** The booking ids whose deposits this refund actually covers. */
  refundedBookingIds: string[];
  /** True when this settles every still-Paid row on the PI. */
  coversWholeIntent: boolean;
  /**
   * Deterministic Stripe idempotency key. Namespaced `deposit_refund:` so it can
   * never collide with the card-hold FEE refund on the same booking, which is a
   * different PaymentIntent (`deposit/route.ts:298`), nor with the balance
   * refund's `refund:${pi}` (`charge/route.ts:331`) or `course_refund:${id}`.
   */
  idempotencyKey: string;
}

interface PiRow {
  id: string;
  deposit_status: string | null;
  deposit_amount_pence: number | null;
}

/**
 * Reads every booking sharing `paymentIntentId` and works out what portion of it
 * `settlingBookingIds` may reclaim.
 *
 * Throws if the rows cannot be read. That is deliberate: without them we cannot
 * tell a partial settlement from a whole one, and guessing in either direction
 * moves real money. Call this inside the caller's existing refund try/catch so a
 * read failure is treated as a refund failure, which leaves the booking
 * uncancelled rather than over-refunding it.
 */
export async function planSharedDepositRefund(
  db: SupabaseClient,
  params: { paymentIntentId: string; settlingBookingIds: string[] },
): Promise<SharedDepositRefundPlan> {
  const { data, error } = await db
    .from('bookings')
    .select('id, deposit_status, deposit_amount_pence')
    .eq('stripe_payment_intent_id', params.paymentIntentId)
    .limit(200);

  if (error) {
    throw new Error(`[shared-deposit-refund] could not read rows on the intent: ${error.message}`);
  }

  const rows = (data ?? []) as PiRow[];
  const paidOnIntent = rows.filter((r) => r.deposit_status === 'Paid');
  const settling = new Set(params.settlingBookingIds);
  const covered = paidOnIntent.filter((r) => settling.has(r.id));
  const refundedBookingIds = covered.map((r) => r.id);

  const idempotencyKey = buildRefundIdempotencyKey(params.paymentIntentId, refundedBookingIds);

  // Nothing on this intent is still Paid, or none of the settling rows are.
  // The caller has already decided a refund is due (it gates on its own
  // paid-deposit check), so honour that and refund the remaining balance, but
  // say so loudly: it means the caller's view of the group and this intent's
  // rows disagree.
  if (covered.length === 0) {
    console.warn('[shared-deposit-refund] no settling row is Paid on this intent; refunding the balance', {
      paymentIntentId: params.paymentIntentId,
      settlingBookingIds: params.settlingBookingIds,
      paidOnIntent: paidOnIntent.length,
    });
    return { amountPence: null, refundedBookingIds: [], coversWholeIntent: true, idempotencyKey };
  }

  if (covered.length === paidOnIntent.length) {
    // Everything still owed on this intent is being settled now. Refund
    // amount-less so Stripe returns whatever remains, which is exactly today's
    // behaviour and is immune to `deposit_amount_pence` having drifted.
    return { amountPence: null, refundedBookingIds, coversWholeIntent: true, idempotencyKey };
  }

  const missingAmount = covered.filter((r) => !r.deposit_amount_pence);
  if (missingAmount.length > 0) {
    // A Paid row with no recorded amount cannot be priced. Counting it as zero
    // under-refunds, which is recoverable by hand; the alternative of falling
    // back to a full refund would hand the whole party's money back and is the
    // exact defect this function exists to prevent.
    console.error('[shared-deposit-refund] Paid rows carry no deposit_amount_pence; they are refunded as 0', {
      paymentIntentId: params.paymentIntentId,
      bookingIds: missingAmount.map((r) => r.id),
    });
  }

  const amountPence = covered.reduce((sum, r) => sum + (r.deposit_amount_pence ?? 0), 0);
  return { amountPence, refundedBookingIds, coversWholeIntent: false, idempotencyKey };
}

/**
 * Stable across retries and unique per (intent, set of rows). Keyed on the SET
 * rather than a single booking id because a crash-retry can re-enter through a
 * different member of the same visit, and because partial refunds no longer
 * self-block via `charge_already_refunded` the way a full refund did.
 */
export function buildRefundIdempotencyKey(paymentIntentId: string, bookingIds: string[]): string {
  const digest = createHash('sha256').update([...bookingIds].sort().join(',')).digest('hex').slice(0, 16);
  return `deposit_refund:${paymentIntentId}:${digest}`;
}
