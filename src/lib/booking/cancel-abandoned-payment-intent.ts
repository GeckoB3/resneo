import { stripe } from '@/lib/stripe';

/**
 * Best-effort cancel of a deposit PaymentIntent the platform is abandoning
 * (design doc deposit-payment-robustness-plan D7 / 8.1).
 *
 * Called wherever a booking that still owes its deposit stops being payable:
 * the abandonment sweeps, cleanup catches that delete the booking after the PI
 * was created, and linkage-write failures. Cancelling closes the window where
 * a guest holding the client secret can still pay money against a booking that
 * no longer exists or was cancelled.
 *
 * Never throws: the caller is already on a cleanup path and a failed cancel
 * must not mask the original error. Stripe rejects cancels of `succeeded` /
 * fully `processing` intents; that error is logged and swallowed too (the
 * webhook / reconciliation own that money from then on).
 */
export async function cancelAbandonedPaymentIntent(
  paymentIntentId: string | null | undefined,
  stripeAccountId: string | null | undefined,
  logContext: Record<string, unknown> = {},
): Promise<void> {
  if (!paymentIntentId || !stripeAccountId) return;
  try {
    await stripe.paymentIntents.cancel(paymentIntentId, undefined, {
      stripeAccount: stripeAccountId,
    });
  } catch (err) {
    console.error('[cancelAbandonedPaymentIntent] cancel failed:', err, {
      paymentIntentId,
      ...logContext,
    });
  }
}
