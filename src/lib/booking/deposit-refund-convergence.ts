import { stripe } from '@/lib/stripe';

/**
 * PM-1 (August 2026 codebase audit).
 *
 * What a failed `stripe.refunds.create` on a deposit PaymentIntent actually means.
 *
 * Every deposit refund site treats "booking is Paid and carries a
 * `stripe_payment_intent_id`" as "this deposit is refundable at Stripe". That
 * inference breaks for a deposit settled in CASH: `record_cash` cancels the open
 * PaymentIntent (so a guest holding the client secret cannot pay a second time)
 * and flips the row to Paid, historically leaving the dead PI id on the row. The
 * refund then throws, no caller converged on it, and the booking became
 * permanently uncancellable in-product: guest cancel returned a 502 reading
 * "Your booking has not been cancelled", and staff cancel, refund and waive were
 * blocked the same way.
 *
 * `record_cash` now clears the PI id when it cancels the intent
 * (`deposit/route.ts`), so new cash settlements never reach this state. This
 * classifier is the other half: it lets rows ALREADY in that state cancel, and
 * covers any other route to a cancelled intent on a Paid row.
 *
 * Deliberately narrow. Only two outcomes short-circuit a refund failure:
 *
 * - `charge_already_refunded`: the money is back with the guest (a prior attempt,
 *   or the Stripe dashboard), so the booking should converge on cancelled.
 * - PaymentIntent status `canceled`: the intent is dead and never took money, so
 *   there is nothing to refund and the deposit was settled some other way.
 *
 * Everything else is a failure. In particular `processing` may still succeed and
 * `requires_payment_method` on a row claiming Paid is a real inconsistency, not
 * something to paper over. A PI that cannot be READ is also a failure: we never
 * converge on an unknown, because converging means cancelling a booking whose
 * money we have not accounted for.
 */
export type DepositRefundConvergence =
  /** The money is already back with the guest. Treat as a successful refund. */
  | 'refunded'
  /** No live intent, so no money to return. Cancel, but do NOT stamp 'Refunded'. */
  | 'nothing_to_refund'
  /** Unknown or retryable. Leave the booking uncancelled. */
  | 'failed';

export async function classifyDepositRefundFailure(
  refundErr: unknown,
  params: { paymentIntentId: string; stripeAccountId: string },
): Promise<DepositRefundConvergence> {
  const code = (refundErr as { code?: string } | null)?.code;

  // Stripe raises this only when the CHARGE is fully refunded. The charge total
  // is the sum of every row's deposit on a shared intent, so a fully-refunded
  // charge means this row's share is necessarily back too.
  if (code === 'charge_already_refunded') return 'refunded';

  let status: string | null = null;
  try {
    const pi = await stripe.paymentIntents.retrieve(params.paymentIntentId, {
      stripeAccount: params.stripeAccountId,
    });
    status = pi.status ?? null;
  } catch (retrieveErr) {
    console.error('[deposit-refund-convergence] PI retrieve failed; treating as a refund failure', retrieveErr, {
      paymentIntentId: params.paymentIntentId,
    });
    return 'failed';
  }

  if (status === 'canceled') {
    console.warn('[deposit-refund-convergence] intent is cancelled; nothing to refund', {
      paymentIntentId: params.paymentIntentId,
    });
    return 'nothing_to_refund';
  }

  return 'failed';
}
