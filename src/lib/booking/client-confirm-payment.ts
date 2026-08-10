import { bookingConfirmPaymentUrl } from '@/lib/booking/booking-flow-api';

/**
 * Client-side wrapper for POST /api/booking/confirm-payment
 * (deposit-payment-robustness-plan Phase 5). Every guest flow used to fire
 * this call and show the success screen regardless of the answer; the outcome
 * lets them tell the truth instead:
 *
 * - 'confirmed': the server verified the intent with Stripe and flipped the
 *   unit (or it was already flipped). Safe to claim success.
 * - 'processing': the payment method is still settling. Show "almost done"
 *   copy; the webhook completes it.
 * - 'cancelled': the abandonment sweep cancelled the unit while the guest was
 *   paying (J2). NEVER claim success; any charge will be refunded.
 * - 'unconfirmed': the confirm could not be reached or did not verify. The
 *   webhook remains the backstop; show the processing copy, not a hard claim.
 */
export type ConfirmOutcome = 'confirmed' | 'processing' | 'cancelled' | 'unconfirmed';

const RETRY_DELAYS_MS = [1500, 3000];

export async function confirmBookingPaymentWithServer(body: {
  booking_id?: string;
  payment_intent_id?: string;
  setup_intent_id?: string;
  guest_email?: string;
}): Promise<ConfirmOutcome> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(bookingConfirmPaymentUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        confirmed?: boolean;
        code?: string;
        payment_status?: string;
        setup_status?: string;
      };
      if (data.code === 'BOOKING_CANCELLED') return 'cancelled';
      if (res.ok && data.confirmed) return 'confirmed';
      if (res.ok && (data.payment_status === 'processing' || data.setup_status === 'processing')) {
        return 'processing';
      }
      // Not confirmed and not definitively processing/cancelled: retry, the
      // webhook may land between attempts.
    } catch {
      // Network error: retry.
    }
    if (attempt < RETRY_DELAYS_MS.length) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
  return 'unconfirmed';
}

/** Guest copy for the not-yet-verified outcomes. No em-dashes (house rule). */
export const PAYMENT_PROCESSING_HEADING = 'Almost done';
export const PAYMENT_PROCESSING_BODY =
  'Your payment is being processed. You will get your confirmation by email or text as soon as it clears.';
export const BOOKING_CANCELLED_MESSAGE =
  'This booking was cancelled because it was not completed in time. Please make a new booking. If you were charged, the venue will arrange a refund.';
/** The abandonment sweep cancelled the intent before the guest pressed Pay: no money moved. */
export const BOOKING_TIMED_OUT_MESSAGE =
  'This booking timed out and the slot was released. No payment was taken. Please start a new booking.';

/**
 * True when a Stripe confirm error means the intent was CANCELLED underneath
 * the open payment form: the abandonment sweep (or a staff cancel) got there
 * first. The raw Stripe message is jargon; show BOOKING_TIMED_OUT_MESSAGE.
 */
export function isCanceledIntentConfirmError(error: {
  payment_intent?: { status?: string } | null;
  setup_intent?: { status?: string } | null;
}): boolean {
  return error.payment_intent?.status === 'canceled' || error.setup_intent?.status === 'canceled';
}
