import type { SupabaseClient } from '@supabase/supabase-js';
import { recomputeBookingPaymentSummary } from '@/lib/booking/payment-summary';

/**
 * §6.4 — webhook-side completion for in-person balance PaymentIntents
 * (purpose `appointment_balance`). The webhook is the source of truth: the
 * mobile confirm result never writes paid state. Idempotent via the
 * `webhook_events` claim AND the booking_payments PI-unique index.
 */

export interface ConfirmBalancePaymentResult {
  /** False when the ledger row was already succeeded/refunded (replay). */
  applied: boolean;
  bookingId: string;
  venueId: string;
  amountPence: number;
}

type BalanceLedgerRow = {
  id: string;
  booking_id: string;
  venue_id: string;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  amount_pence: number;
};

const BALANCE_ROW_COLUMNS = 'id, booking_id, venue_id, status, amount_pence';

/** Postgres unique violation — a concurrent insert of the same PI's row. */
const PG_UNIQUE_VIOLATION = '23505';

async function loadRowByPaymentIntent(
  admin: SupabaseClient,
  paymentIntentId: string,
): Promise<BalanceLedgerRow | null> {
  const { data, error } = await admin
    .from('booking_payments')
    .select(BALANCE_ROW_COLUMNS)
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();
  if (error) {
    console.error('[confirm-balance] ledger lookup failed:', error.message, { paymentIntentId });
    throw error;
  }
  return (data ?? null) as BalanceLedgerRow | null;
}

/**
 * Flip the ledger row to `succeeded` and recompute the booking summary.
 * When no row exists (the event beat the charge route's insert), insert one
 * from the PI metadata — but only after verifying the metadata's venue really
 * owns the connected account the event arrived on (metadata is
 * client-influenced; the account the event was delivered on is not).
 */
export async function confirmBalancePaymentFromPaymentIntent(
  admin: SupabaseClient,
  params: {
    paymentIntentId: string;
    bookingId?: string | null;
    venueId?: string | null;
    amountReceivedPence: number;
    /** The connected account the event arrived on (null = unknown). */
    connectedAccountId?: string | null;
  },
): Promise<ConfirmBalancePaymentResult | null> {
  const { paymentIntentId, bookingId, venueId, amountReceivedPence, connectedAccountId } = params;

  let row = await loadRowByPaymentIntent(admin, paymentIntentId);

  if (!row) {
    // Metadata fallback. Refuse without the account check: a foreign account's
    // event must not be able to stamp an arbitrary booking paid.
    if (!bookingId || !venueId || !connectedAccountId) {
      console.warn('[confirm-balance] no ledger row and metadata/account insufficient, skipping', {
        paymentIntentId,
        bookingId,
        venueId,
        connectedAccountId,
      });
      return null;
    }
    const { data: venueRow, error: venueErr } = await admin
      .from('venues')
      .select('stripe_connected_account_id')
      .eq('id', venueId)
      .maybeSingle();
    if (venueErr) {
      console.error('[confirm-balance] venue load failed:', venueErr.message, { venueId });
      throw venueErr;
    }
    const venueAccount = (venueRow as { stripe_connected_account_id: string | null } | null)
      ?.stripe_connected_account_id;
    if (!venueAccount || venueAccount !== connectedAccountId) {
      console.warn('[confirm-balance] event account does not match the metadata venue, skipping', {
        paymentIntentId,
        venueId,
        eventAccount: connectedAccountId,
        venueAccount,
      });
      return null;
    }
    const { data: bookingRow, error: bookingErr } = await admin
      .from('bookings')
      .select('id, venue_id')
      .eq('id', bookingId)
      .maybeSingle();
    if (bookingErr) {
      console.error('[confirm-balance] booking load failed:', bookingErr.message, { bookingId });
      throw bookingErr;
    }
    if (!bookingRow || (bookingRow as { venue_id: string }).venue_id !== venueId) {
      console.warn('[confirm-balance] metadata booking does not belong to the venue, skipping', {
        paymentIntentId,
        bookingId,
        venueId,
      });
      return null;
    }

    const { error: insertErr } = await admin.from('booking_payments').insert({
      booking_id: bookingId,
      venue_id: venueId,
      stripe_connected_account_id: connectedAccountId,
      stripe_payment_intent_id: paymentIntentId,
      method: 'card_present',
      status: 'pending', // flipped below via the common path
      amount_pence: Math.max(0, amountReceivedPence),
    });
    if (insertErr && insertErr.code !== PG_UNIQUE_VIOLATION) {
      console.error('[confirm-balance] fallback insert failed:', insertErr.message, {
        paymentIntentId,
      });
      throw insertErr;
    }
    row = await loadRowByPaymentIntent(admin, paymentIntentId);
    if (!row) {
      console.error('[confirm-balance] row still missing after fallback insert', { paymentIntentId });
      return null;
    }
  }

  // Replays and out-of-order delivery: a succeeded row is done; a refunded row
  // must never flip back (charge.refunded can land before this event on retry).
  if (row.status === 'succeeded' || row.status === 'refunded') {
    return {
      applied: false,
      bookingId: row.booking_id,
      venueId: row.venue_id,
      amountPence: row.amount_pence,
    };
  }

  // The money truth is what Stripe captured; correct the row if they differ
  // (they should not for automatic-capture card_present, so warn loudly).
  const capturedPence = amountReceivedPence > 0 ? amountReceivedPence : row.amount_pence;
  if (capturedPence !== row.amount_pence) {
    console.warn('[confirm-balance] captured amount differs from ledger row, using captured', {
      paymentIntentId,
      rowAmountPence: row.amount_pence,
      capturedPence,
    });
  }

  const { error: flipErr } = await admin
    .from('booking_payments')
    .update({
      status: 'succeeded',
      amount_pence: capturedPence,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .in('status', ['pending', 'failed']);
  if (flipErr) {
    console.error('[confirm-balance] succeeded flip failed:', flipErr.message, { paymentIntentId });
    throw flipErr;
  }

  await recomputeBookingPaymentSummary(admin, row.booking_id);

  // Timeline entry — the staff detail screen already renders `events` rows.
  // Non-fatal: the ledger + summary are the record; the event is presentation.
  const { error: eventErr } = await admin.from('events').insert({
    venue_id: row.venue_id,
    booking_id: row.booking_id,
    event_type: 'balance_payment_taken',
    payload: {
      amount_pence: capturedPence,
      payment_intent_id: paymentIntentId,
      method: 'card_present',
    },
  });
  if (eventErr) {
    console.error('[confirm-balance] event insert failed:', eventErr.message, { paymentIntentId });
  }

  return {
    applied: true,
    bookingId: row.booking_id,
    venueId: row.venue_id,
    amountPence: capturedPence,
  };
}

/**
 * §6.4 hygiene — flip an abandoned/declined balance PI's `pending` ledger row
 * to `failed` (from `payment_intent.canceled` / `payment_intent.payment_failed`).
 * Only pending rows move: a succeeded PI never regresses, and a retried collect
 * on the same PI can still flip failed → succeeded later. No recompute needed:
 * nothing succeeded.
 */
export async function markBalancePaymentFailedForPaymentIntent(
  admin: SupabaseClient,
  paymentIntentId: string,
): Promise<void> {
  const { error } = await admin
    .from('booking_payments')
    .update({ status: 'failed', updated_at: new Date().toISOString() })
    .eq('stripe_payment_intent_id', paymentIntentId)
    .eq('status', 'pending');
  if (error) {
    console.error('[confirm-balance] failed flip failed:', error.message, { paymentIntentId });
    throw error;
  }
}

/**
 * §6.4 refund branch — flip the ledger row to `refunded` and recompute. Called
 * from `charge.refunded` when the charge is FULLY refunded (v1 refunds are
 * full-per-payment; a partial refund arriving from the Stripe dashboard leaves
 * the row untouched and is logged by the caller). Idempotent.
 */
export async function applyBalancePaymentRefundFromWebhook(
  admin: SupabaseClient,
  paymentIntentId: string,
): Promise<{ applied: boolean; bookingId: string; venueId: string } | null> {
  const row = await loadRowByPaymentIntent(admin, paymentIntentId);
  if (!row) return null;
  if (row.status === 'refunded') {
    return { applied: false, bookingId: row.booking_id, venueId: row.venue_id };
  }

  const { error: flipErr } = await admin
    .from('booking_payments')
    .update({ status: 'refunded', updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .neq('status', 'refunded');
  if (flipErr) {
    console.error('[confirm-balance] refunded flip failed:', flipErr.message, { paymentIntentId });
    throw flipErr;
  }

  await recomputeBookingPaymentSummary(admin, row.booking_id);

  const { error: eventErr } = await admin.from('events').insert({
    venue_id: row.venue_id,
    booking_id: row.booking_id,
    event_type: 'balance_payment_refunded',
    payload: { amount_pence: row.amount_pence, payment_intent_id: paymentIntentId },
  });
  if (eventErr) {
    console.error('[confirm-balance] refund event insert failed:', eventErr.message, {
      paymentIntentId,
    });
  }

  return { applied: true, bookingId: row.booking_id, venueId: row.venue_id };
}
