import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Reason text written to `bookings.internal_notes` so the venue can see, on the
 * bookings list, why a booking attempt did not complete.
 */
export const PAYMENT_SETUP_FAILED_NOTE =
  'Online booking failed: the deposit could not be set up on this venue’s Stripe account. ' +
  'Check Settings, then Payments, and make sure Stripe shows charges enabled.';

export const CARD_HOLD_SETUP_FAILED_NOTE =
  'Online booking failed: the card could not be saved on this venue’s Stripe account. ' +
  'Check Settings, then Payments, and make sure Stripe shows charges enabled.';

/**
 * Retire a booking whose payment could not be set up.
 *
 * These rows used to be hard-deleted. That freed the slot but left the venue
 * with no trace at all: a connected-but-not-yet-enabled Stripe account turns
 * every paying guest away, the guest sees "Payment setup failed", and nothing
 * reaches the dashboard. Owners could lose bookings for days without knowing.
 *
 * Cancelling achieves the same release of the slot, because `Cancelled` is not
 * in CAPACITY_CONSUMING_STATUSES (see `src/lib/availability/capacity-status.ts`),
 * while leaving a visible row carrying the reason. `deposit_status: 'Failed'`
 * matches how the auto-cancel cron records an abandoned payment, so both arrive
 * in the same place looking the same.
 *
 * Best effort by design: the caller is already returning an error to the guest,
 * so a failure here is logged and swallowed rather than masking the original
 * Stripe error.
 */
export async function cancelBookingAfterPaymentFailure(
  supabase: SupabaseClient,
  bookingId: string,
  note: string,
): Promise<void> {
  try {
    const { error } = await supabase
      .from('bookings')
      .update({
        status: 'Cancelled',
        deposit_status: 'Failed',
        cancellation_actor_type: 'system',
        cancelled_by_staff_id: null,
        internal_notes: note,
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId);
    if (error) {
      console.error('[booking] could not cancel booking after payment failure', error, {
        bookingId,
      });
    }
  } catch (err) {
    console.error('[booking] could not cancel booking after payment failure', err, { bookingId });
  }
}
