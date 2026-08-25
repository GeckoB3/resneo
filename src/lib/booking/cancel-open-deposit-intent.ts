import type { SupabaseClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/stripe';
import { cancelAbandonedPaymentIntent } from '@/lib/booking/cancel-abandoned-payment-intent';
import { DEPOSIT_OWED_STATUSES } from '@/lib/booking/booking-owes-capture';

/**
 * Cancel the deposit PaymentIntent of bookings whose owed capture just ended
 * un-collected (deposit-payment-robustness-plan 8.3 / D7): staff or guest
 * cancellation, `waive`, and `record_cash`. Without this the PI stays
 * confirmable, so a guest with an open payment tab can still pay a cancelled,
 * waived, or cash-settled deposit, landing money the platform never records.
 *
 * Safety rules:
 * - Skips a PI while any LIVE booking row outside `settledBookingIds` still
 *   owes it (group siblings share one PI).
 * - Retrieves the PI first and never cancels `succeeded` or `processing`
 *   (that money belongs to the webhook / reconciliation from then on).
 * - Best-effort throughout: callers are on cancellation/settlement paths and a
 *   failed Stripe cancel must not fail them.
 *
 * Reports the intents that are definitively DEAD afterwards: ones Stripe accepted
 * a cancel for, plus ones already `canceled` when we looked. `record_cash` uses
 * that to clear the dead PI id off the booking row (PM-1); every other caller
 * ignores it.
 *
 * An intent is never listed unless we READ its terminal state, so `succeeded` and
 * `processing` intents (real money, owned by the webhook from then on) and
 * intents we could not retrieve are excluded. A caller must never discard a
 * payment reference for an intent that might still take money.
 */
export async function cancelOpenDepositIntentForBookings(
  admin: SupabaseClient,
  params: {
    /** Rows whose debt just ended (cancelled, waived, or cash-settled). */
    settledBookingIds: string[];
    venueId: string;
  },
): Promise<{ deadPaymentIntentIds: string[] }> {
  const deadPaymentIntentIds: string[] = [];
  const { settledBookingIds, venueId } = params;
  if (settledBookingIds.length === 0) return { deadPaymentIntentIds };

  try {
    const { data: rowData, error: rowErr } = await admin
      .from('bookings')
      .select('id, stripe_payment_intent_id, deposit_status')
      .in('id', settledBookingIds)
      .eq('venue_id', venueId);
    if (rowErr || !rowData?.length) return { deadPaymentIntentIds };

    const piIds = [
      ...new Set(
        (rowData as Array<{ stripe_payment_intent_id: string | null; deposit_status: string | null }>)
          .filter(
            (r) =>
              r.stripe_payment_intent_id &&
              // Paid/Refunded rows keep their PI: refunds run against it.
              (DEPOSIT_OWED_STATUSES as readonly string[]).includes(r.deposit_status ?? '') ,
          )
          .map((r) => r.stripe_payment_intent_id as string),
      ),
    ];
    if (piIds.length === 0) return { deadPaymentIntentIds };

    const { data: venueRow } = await admin
      .from('venues')
      .select('stripe_connected_account_id')
      .eq('id', venueId)
      .maybeSingle();
    const accountId =
      (venueRow as { stripe_connected_account_id?: string | null } | null)
        ?.stripe_connected_account_id ?? null;
    if (!accountId) return { deadPaymentIntentIds };

    for (const piId of piIds) {
      // A live sibling outside the settled set still owes this PI: leave it.
      const { data: liveRows, error: liveErr } = await admin
        .from('bookings')
        .select('id')
        .eq('stripe_payment_intent_id', piId)
        .in('status', ['Pending', 'Booked', 'Confirmed', 'Seated'])
        .in('deposit_status', [...DEPOSIT_OWED_STATUSES]);
      if (liveErr) continue;
      const stillOwing = ((liveRows ?? []) as Array<{ id: string }>).filter(
        (r) => !settledBookingIds.includes(r.id),
      );
      if (stillOwing.length > 0) continue;

      try {
        const pi = await stripe.paymentIntents.retrieve(piId, { stripeAccount: accountId });
        if (pi.status === 'succeeded' || pi.status === 'processing') {
          continue;
        }
        if (pi.status === 'canceled') {
          // Already dead (a retry of this settle, or an earlier sweep). Nothing
          // to cancel, but it still counts as dead for the caller.
          deadPaymentIntentIds.push(piId);
          continue;
        }
      } catch (retrieveErr) {
        console.error('[cancelOpenDepositIntent] PI retrieve failed:', retrieveErr, { piId });
        continue;
      }

      const cancelled = await cancelAbandonedPaymentIntent(piId, accountId, { settledBookingIds });
      if (cancelled) deadPaymentIntentIds.push(piId);
    }
  } catch (err) {
    console.error('[cancelOpenDepositIntent] failed:', err, { settledBookingIds });
  }

  return { deadPaymentIntentIds };
}
