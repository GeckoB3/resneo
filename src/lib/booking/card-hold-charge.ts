import type { SupabaseClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/stripe';
import { RESERVE_NI_PI_PURPOSE } from '@/types/class-commerce';
import { logBookingOp } from '@/lib/observability/booking-ops-log';
import { formatCardHoldFeePence } from '@/lib/booking/card-hold-terms';
import { cardHoldChargeWindowEndsAtForBooking } from '@/lib/booking/card-hold-window';
import { releaseCardHoldsForBookings } from '@/lib/booking/card-hold-release';
import { sendCardHoldChargedReceipt } from '@/lib/communications/send-templated';

/**
 * Card-hold no-show fee charge engine (docs:
 * CARD_HOLD_DEPOSITS_DESIGN_AND_IMPLEMENTATION §8.3, §8.5, §9.2a).
 *
 * One charge per hold, enforced by the atomic claim + conditional persist
 * scheme in §8.3, not by the unique index:
 *  1. claim the attempt (compare-and-swap increment of charge_attempt_count,
 *     valid only while charge_payment_intent_id IS NULL AND released_at IS NULL);
 *  2. create the off-session PaymentIntent with the claimed attempt in the
 *     idempotency key;
 *  3. conditionally persist the PI id WHERE charge_payment_intent_id IS NULL;
 *     zero rows means a concurrent request won between steps 1 and 3: cancel
 *     our own just-created PI (best effort) and return invalid_state;
 *  4. a failed attempt (§8.5) clears charge_payment_intent_id so the claim
 *     reopens for a retry with a fresh attempt number.
 */

export type ChargeCardHoldNoShowFeeErrorCode =
  | 'no_card_hold'
  | 'not_no_show'
  | 'invalid_state'
  | 'hold_released'
  | 'hold_expired'
  | 'no_saved_card'
  | 'invalid_amount'
  | 'card_declined'
  | 'authentication_required'
  | 'charge_failed';

export type ChargeCardHoldNoShowFeeResult =
  | {
      ok: true;
      chargedPence: number;
      paymentIntentId: string;
      /** True when the PI did not reach `succeeded` synchronously; the webhook completes the state. */
      pending: boolean;
    }
  | { ok: false; code: ChargeCardHoldNoShowFeeErrorCode; message: string };

type ChargeableHoldRow = {
  id: string;
  booking_id: string;
  venue_id: string;
  stripe_connected_account_id: string;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  fee_pence: number;
  charge_payment_intent_id: string | null;
  charged_at: string | null;
  charge_attempt_count: number;
  released_at: string | null;
};

const HOLD_CHARGE_COLUMNS =
  'id, booking_id, venue_id, stripe_connected_account_id, stripe_customer_id, stripe_payment_method_id, fee_pence, charge_payment_intent_id, charged_at, charge_attempt_count, released_at';

/** Booking ref shown on the Stripe charge, matching the email footer derivation. */
function bookingRefForCharge(bookingId: string): string {
  return bookingId.replace(/-/g, '').slice(0, 8).toUpperCase();
}

type StripeCardErrorLike = {
  type?: string;
  code?: string | null;
  decline_code?: string | null;
  message?: string;
  payment_intent?: { id?: string } | null;
  raw?: { payment_intent?: { id?: string } | null } | null;
};

function asStripeCardError(err: unknown): StripeCardErrorLike | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as StripeCardErrorLike;
  return e.type === 'StripeCardError' ? e : null;
}

/** §8.5: "The card was declined (insufficient funds)." style plain reason. */
function plainDeclineReason(err: StripeCardErrorLike): string {
  const raw = err.decline_code ?? err.code ?? 'declined';
  return String(raw).replace(/_/g, ' ');
}

const AUTHENTICATION_REQUIRED_MESSAGE =
  'The card issuer requires the client to authorise this payment in person. Off-session charging is not possible for this card.';

/**
 * Step 1 of §8.3: atomically claim the next charge attempt. Implemented as a
 * compare-and-swap loop (supabase-js cannot express `SET x = x + 1`): each
 * concurrent caller ends up with its own distinct attempt number, or null when
 * the claim is closed (a PI id is persisted or the hold is released).
 */
async function claimChargeAttempt(
  admin: SupabaseClient,
  holdId: string,
  firstRead: { charge_attempt_count: number; charge_payment_intent_id: string | null; released_at: string | null },
): Promise<number | null> {
  let snapshot = firstRead;
  for (let tries = 0; tries < 6; tries += 1) {
    if (snapshot.charge_payment_intent_id != null || snapshot.released_at != null) return null;
    const next = (snapshot.charge_attempt_count ?? 0) + 1;
    const { data: claimed, error } = await admin
      .from('booking_card_holds')
      .update({ charge_attempt_count: next, updated_at: new Date().toISOString() })
      .eq('id', holdId)
      .eq('charge_attempt_count', snapshot.charge_attempt_count ?? 0)
      .is('charge_payment_intent_id', null)
      .is('released_at', null)
      .is('charged_at', null) // defence in depth: never reopen after a capture
      .select('charge_attempt_count');
    if (error) {
      console.error('[card-hold-charge] claim update failed', error, { holdId });
      return null;
    }
    if ((claimed ?? []).length > 0) return next;

    // Lost the CAS: another request moved the counter (or persisted a PI). Re-read and retry.
    const { data: reread, error: rereadErr } = await admin
      .from('booking_card_holds')
      .select('charge_attempt_count, charge_payment_intent_id, released_at')
      .eq('id', holdId)
      .maybeSingle();
    if (rereadErr || !reread) {
      console.error('[card-hold-charge] claim re-read failed', rereadErr, { holdId });
      return null;
    }
    snapshot = reread as typeof snapshot;
  }
  return null;
}

export interface CardHoldChargedStateInput {
  holdId: string;
  bookingId: string;
  venueId: string;
  paymentIntentId: string;
  amountReceivedPence: number;
  chargedByStaffId?: string | null;
}

/**
 * Webhook-equivalent completion state (§8.3 step 4 / §8.6.1), idempotent:
 * stamp the hold's charged fields (only once, keyed on charged_at IS NULL),
 * flip the booking to 'Charged', and insert the card_hold_charged events row
 * on first application only. Both the synchronous route path and the webhook
 * run this; whichever arrives second is a no-op.
 */
export async function applyCardHoldChargedState(
  admin: SupabaseClient,
  input: CardHoldChargedStateInput,
): Promise<{ applied: boolean }> {
  const nowIso = new Date().toISOString();
  const { data: stamped, error: stampErr } = await admin
    .from('booking_card_holds')
    .update({
      charged_pence: input.amountReceivedPence,
      charged_at: nowIso,
      charged_by_staff_id: input.chargedByStaffId ?? null,
      charge_failure_code: null,
      charge_failure_at: null,
      updated_at: nowIso,
    })
    .eq('id', input.holdId)
    .is('charged_at', null)
    // A released hold must never be stamped: Stripe does not order events, so
    // charge.refunded can land before payment_intent.succeeded (route crash
    // between PI persist and stamp). Once the refund has released the hold and
    // flipped the booking to 'Refunded', the late succeeded event must be a
    // no-op (applied=false), not a resurrection to 'Charged' plus a receipt.
    .is('released_at', null)
    .select('id');
  if (stampErr) {
    console.error('[card-hold-charge] charged stamp failed', stampErr, { holdId: input.holdId });
    throw new Error('Failed to record the charge on the card hold');
  }
  const applied = (stamped ?? []).length > 0;

  // Flip the booking to 'Charged'. When THIS call applied the stamp, converge
  // from any state; on a replay (applied=false) converge only from
  // 'Card Held', so a crash between stamp and flip still heals on retry but a
  // late payment_intent.succeeded replay can never resurrect a fee that has
  // since been refunded (review finding).
  const flip = admin
    .from('bookings')
    .update({ deposit_status: 'Charged', updated_at: nowIso })
    .eq('id', input.bookingId);
  const { error: bookingErr } = applied
    ? await flip.neq('deposit_status', 'Charged')
    : await flip.eq('deposit_status', 'Card Held');
  if (bookingErr) {
    console.error('[card-hold-charge] booking Charged flip failed', bookingErr, {
      bookingId: input.bookingId,
    });
    throw new Error('Failed to mark the booking as charged');
  }

  if (applied) {
    const { error: evErr } = await admin.from('events').insert({
      venue_id: input.venueId,
      booking_id: input.bookingId,
      event_type: 'card_hold_charged',
      payload: { booking_id: input.bookingId, charged_pence: input.amountReceivedPence },
    });
    if (evErr) {
      // Non-fatal: the charge state is the source of truth (§11 observability).
      console.error('[card-hold-charge] card_hold_charged event insert failed', evErr, {
        bookingId: input.bookingId,
      });
    }
  } else {
    // applied=false with money genuinely taken on THIS PI can mean the hold was
    // released (expiry cron) in the tiny window between the PI-id persist and
    // this stamp: the charge stands but there is no receipt or charged event.
    // Surface it for the operator rather than leaving a silent stuck charge
    // (concurrency review F3 residual). Keyed on this PI + released + uncharged.
    const { data: anomaly } = await admin
      .from('booking_card_holds')
      .select('id')
      .eq('id', input.holdId)
      .eq('charge_payment_intent_id', input.paymentIntentId)
      .is('charged_at', null)
      .not('released_at', 'is', null)
      .maybeSingle();
    if (anomaly) {
      const { error: alertErr } = await admin.from('reconciliation_alerts').insert({
        booking_id: input.bookingId,
        expected_status: 'Charged',
        actual_stripe_status: `charged_on_released_hold:${input.paymentIntentId}`,
      });
      if (alertErr) {
        console.error('[card-hold-charge] released-hold charge alert insert failed', alertErr, {
          bookingId: input.bookingId,
        });
      }
    }
  }

  return { applied };
}

/**
 * §8.6.1: complete a fee PI from `payment_intent.succeeded`. Finds the hold by
 * `charge_payment_intent_id`, falling back to `metadata.booking_id` (then sets
 * the PI id onto the hold). Returns the completion facts for the receipt email,
 * or null when no hold matches / the hold already carries a different PI.
 */
export async function completeCardHoldChargeFromWebhook(
  admin: SupabaseClient,
  params: {
    paymentIntentId: string;
    bookingId?: string | null;
    amountReceivedPence: number;
    /**
     * The connected account the event arrived on. When resolving a hold via
     * the attacker-controllable metadata.booking_id fallback, the hold's
     * snapshotted account MUST match this or the write is refused: a fee PI is
     * always created on the hold's own account, so a mismatch means a
     * different account's event is pointing at this booking (cross-tenant hold
     * poisoning). Null (unknown account) skips the fallback for safety.
     */
    connectedAccountId?: string | null;
  },
): Promise<{ applied: boolean; bookingId: string; venueId: string; chargedPence: number } | null> {
  const { paymentIntentId, bookingId, amountReceivedPence, connectedAccountId } = params;

  const { data: byPi, error: byPiErr } = await admin
    .from('booking_card_holds')
    .select(HOLD_CHARGE_COLUMNS)
    .eq('charge_payment_intent_id', paymentIntentId)
    .maybeSingle();
  if (byPiErr) {
    console.error('[card-hold-charge] webhook hold lookup by PI failed', byPiErr, { paymentIntentId });
    throw byPiErr;
  }

  let hold = (byPi ?? null) as ChargeableHoldRow | null;

  if (!hold && bookingId) {
    const { data: byBooking, error: byBookingErr } = await admin
      .from('booking_card_holds')
      .select(HOLD_CHARGE_COLUMNS)
      .eq('booking_id', bookingId)
      .maybeSingle();
    if (byBookingErr) {
      console.error('[card-hold-charge] webhook hold lookup by booking failed', byBookingErr, {
        bookingId,
      });
      throw byBookingErr;
    }
    const candidate = (byBooking ?? null) as ChargeableHoldRow | null;
    if (candidate && candidate.stripe_connected_account_id !== connectedAccountId) {
      // The fee PI lives on a different account than the hold snapshotted:
      // a genuine fee PI would be on the hold's own account. Refuse to
      // backfill or apply from a foreign account's event.
      console.warn('[card-hold-charge] webhook fee PI account does not match the hold account, skipping', {
        paymentIntentId,
        bookingId,
        eventAccount: connectedAccountId,
        holdAccount: candidate.stripe_connected_account_id,
      });
      return null;
    }
    if (candidate) {
      if (candidate.charge_payment_intent_id == null) {
        const { error: setErr } = await admin
          .from('booking_card_holds')
          .update({ charge_payment_intent_id: paymentIntentId, updated_at: new Date().toISOString() })
          .eq('id', candidate.id)
          .is('charge_payment_intent_id', null);
        if (setErr) {
          console.error('[card-hold-charge] webhook PI backfill failed', setErr, { holdId: candidate.id });
          throw setErr;
        }
        hold = { ...candidate, charge_payment_intent_id: paymentIntentId };
      } else if (candidate.charge_payment_intent_id === paymentIntentId) {
        hold = candidate;
      } else {
        console.warn('[card-hold-charge] webhook fee PI does not match the hold on file, skipping', {
          paymentIntentId,
          holdPaymentIntentId: candidate.charge_payment_intent_id,
          bookingId,
        });
        return null;
      }
    }
  }

  if (!hold) {
    console.warn('[card-hold-charge] webhook found no hold for fee PI, skipping', { paymentIntentId });
    return null;
  }

  const { applied } = await applyCardHoldChargedState(admin, {
    holdId: hold.id,
    bookingId: hold.booking_id,
    venueId: hold.venue_id,
    paymentIntentId,
    amountReceivedPence,
  });

  return {
    applied,
    bookingId: hold.booking_id,
    venueId: hold.venue_id,
    chargedPence: amountReceivedPence,
  };
}

/**
 * §8.6.3: record fee-charge failure fields from `payment_intent.payment_failed`.
 * Never touches booking status, never clears a PI id (a newer attempt may own
 * it), and only writes when the hold is uncharged and the incoming failure is
 * not older than what is already recorded.
 */
export async function recordCardHoldChargeFailure(
  admin: SupabaseClient,
  params: {
    paymentIntentId?: string | null;
    bookingId?: string | null;
    failureCode: string;
    failureAtIso: string;
    /** Event account; the booking_id fallback requires a matching hold account (see completeCardHoldChargeFromWebhook). */
    connectedAccountId?: string | null;
  },
): Promise<void> {
  const { paymentIntentId, bookingId, failureCode, failureAtIso, connectedAccountId } = params;

  let hold: ChargeableHoldRow | null = null;
  if (paymentIntentId) {
    const { data } = await admin
      .from('booking_card_holds')
      .select(HOLD_CHARGE_COLUMNS + ', charge_failure_at')
      .eq('charge_payment_intent_id', paymentIntentId)
      .maybeSingle();
    hold = (data ?? null) as ChargeableHoldRow | null;
  }
  if (!hold && bookingId) {
    const { data } = await admin
      .from('booking_card_holds')
      .select(HOLD_CHARGE_COLUMNS + ', charge_failure_at')
      .eq('booking_id', bookingId)
      .maybeSingle();
    const candidate = (data ?? null) as ChargeableHoldRow | null;
    // Same cross-tenant guard as the success path: only accept a booking_id
    // fallback when the hold's snapshot account matches the event's account.
    if (candidate && candidate.stripe_connected_account_id !== connectedAccountId) {
      console.warn('[card-hold-charge] payment_failed fallback account mismatch, skipping', {
        paymentIntentId,
        bookingId,
        eventAccount: connectedAccountId,
        holdAccount: candidate.stripe_connected_account_id,
      });
      return;
    }
    hold = candidate;
  }
  if (!hold) {
    console.warn('[card-hold-charge] payment_failed webhook found no hold, skipping', {
      paymentIntentId,
      bookingId,
    });
    return;
  }
  if (hold.charged_at != null) return; // already charged: a stale failure must not overwrite success

  const existingFailureAt = (hold as ChargeableHoldRow & { charge_failure_at?: string | null })
    .charge_failure_at;
  if (existingFailureAt && existingFailureAt >= failureAtIso) return; // only record if newer

  const { error } = await admin
    .from('booking_card_holds')
    .update({
      charge_failure_code: failureCode,
      charge_failure_at: failureAtIso,
      updated_at: new Date().toISOString(),
    })
    .eq('id', hold.id)
    .is('charged_at', null);
  if (error) {
    // Throw so the webhook 500s and Stripe redelivers: swallowing this would
    // ack the event and lose the failure record, leaving the claim closed and
    // every retry blocked until the window expires (concurrency review F4).
    console.error('[card-hold-charge] failure record failed', error, { holdId: hold.id });
    throw new Error('Failed to record the card-hold charge failure');
  }

  // When the PERSISTED PI is the one that failed asynchronously, the claim
  // would otherwise stay closed forever and every retry would 409 until the
  // window expired (review finding). Clearing only when the persisted id
  // matches this failed PI cannot collide with a newer attempt: a newer
  // attempt cannot exist while the id is set.
  if (paymentIntentId && hold.charge_payment_intent_id === paymentIntentId) {
    const { error: reopenErr } = await admin
      .from('booking_card_holds')
      .update({ charge_payment_intent_id: null, updated_at: new Date().toISOString() })
      .eq('id', hold.id)
      .eq('charge_payment_intent_id', paymentIntentId)
      .is('charged_at', null);
    if (reopenErr) {
      // Same reasoning: a swallowed reopen failure leaves the claim closed and
      // blocks all retries. Throw to force a Stripe redelivery.
      console.error('[card-hold-charge] failed-PI claim reopen failed', reopenErr, {
        holdId: hold.id,
      });
      throw new Error('Failed to reopen the card-hold charge claim');
    }
  }
}

/**
 * §8.6.6 / §9.2e: a refunded fee PI flips the booking to 'Refunded', inserts
 * the card_hold_charge_refunded events row (first application only), and
 * releases the hold (release_reason 'refunded'). Idempotent: called by both
 * the route refund action and the charge.refunded webhook.
 */
export async function applyCardHoldChargeRefund(
  admin: SupabaseClient,
  params: { bookingId: string; venueId: string; chargedPence: number | null },
): Promise<{ applied: boolean }> {
  const nowIso = new Date().toISOString();
  const { data: flipped, error: flipErr } = await admin
    .from('bookings')
    .update({ deposit_status: 'Refunded', updated_at: nowIso })
    .eq('id', params.bookingId)
    .neq('deposit_status', 'Refunded')
    .select('id');
  if (flipErr) {
    console.error('[card-hold-charge] refund flip failed', flipErr, { bookingId: params.bookingId });
    throw new Error('Failed to mark the booking as refunded');
  }
  const applied = (flipped ?? []).length > 0;

  if (applied) {
    const { error: evErr } = await admin.from('events').insert({
      venue_id: params.venueId,
      booking_id: params.bookingId,
      event_type: 'card_hold_charge_refunded',
      payload: { booking_id: params.bookingId, charged_pence: params.chargedPence },
    });
    if (evErr) {
      console.error('[card-hold-charge] card_hold_charge_refunded event insert failed', evErr, {
        bookingId: params.bookingId,
      });
    }
  }

  // Idempotent no-op when the hold is already released.
  await releaseCardHoldsForBookings(admin, [params.bookingId], 'refunded');

  return { applied };
}

export interface ChargeCardHoldNoShowFeeParams {
  bookingId: string;
  venueId: string;
  /** Defaults to the hold's full fee_pence; clamped server-side to [1, fee_pence]. */
  amountPence?: number | null;
  staffId: string;
}

/**
 * Undo an orphan fee PaymentIntent (a concurrent-charge loser, or a charge on
 * a hold that was released between the guards and the persist). Cancel it if it
 * is still cancellable; if it has already succeeded, REFUND it so no money
 * stands (concurrency review F2: cancelling a succeeded PI always throws, so
 * the pre-fix path left the guest double-charged with only a log line). A
 * reconciliation alert is inserted only when neither cancel nor refund lands.
 */
async function disposeOrphanFeePaymentIntent(
  admin: SupabaseClient,
  params: {
    pi: { id: string; status: string };
    bookingId: string;
    stripeConnectedAccountId: string;
  },
): Promise<void> {
  const { pi, bookingId, stripeConnectedAccountId } = params;
  const account = { stripeAccount: stripeConnectedAccountId };

  // A synchronously-succeeded off-session PI cannot be cancelled; refund it.
  if (pi.status === 'succeeded') {
    try {
      await stripe.refunds.create({ payment_intent: pi.id }, account);
      return;
    } catch (refundErr) {
      console.error('[card-hold-charge] orphan PI refund failed', refundErr, { pi: pi.id });
    }
  } else {
    try {
      await stripe.paymentIntents.cancel(pi.id, account);
      return;
    } catch (cancelErr) {
      // It may have moved to succeeded between our read and the cancel: refund.
      console.error('[card-hold-charge] orphan PI cancel failed, attempting refund', cancelErr, {
        pi: pi.id,
      });
      try {
        await stripe.refunds.create({ payment_intent: pi.id }, account);
        return;
      } catch (refundErr) {
        console.error('[card-hold-charge] orphan PI refund also failed', refundErr, { pi: pi.id });
      }
    }
  }

  // Neither disposal landed: surface the uncancelled PI for the operator.
  const { error: alertErr } = await admin.from('reconciliation_alerts').insert({
    booking_id: bookingId,
    expected_status: 'single_charge',
    actual_stripe_status: `duplicate_pi_uncancelled:${pi.id}`,
  });
  if (alertErr) {
    console.error('[card-hold-charge] duplicate-PI alert insert failed', alertErr, { pi: pi.id });
  }
}

/**
 * Charge the no-show fee for a booking's card hold (§8.3 + §8.5 + §9.2a).
 * The route enforces admin; everything else (guards 2-7, the atomic claim,
 * the Stripe call, and the webhook-equivalent success state) lives here.
 */
export async function chargeCardHoldNoShowFee(
  admin: SupabaseClient,
  params: ChargeCardHoldNoShowFeeParams,
): Promise<ChargeCardHoldNoShowFeeResult> {
  const { bookingId, venueId, staffId } = params;

  // Guard 2: the hold row exists.
  const { data: holdData, error: holdErr } = await admin
    .from('booking_card_holds')
    .select(HOLD_CHARGE_COLUMNS)
    .eq('booking_id', bookingId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (holdErr) {
    console.error('[card-hold-charge] hold load failed', holdErr, { bookingId });
    return { ok: false, code: 'charge_failed', message: 'The card hold could not be loaded. Please try again.' };
  }
  const hold = (holdData ?? null) as ChargeableHoldRow | null;
  if (!hold) {
    return { ok: false, code: 'no_card_hold', message: 'This booking does not have a card on hold.' };
  }

  const { data: bookingData, error: bookingErr } = await admin
    .from('bookings')
    .select('id, venue_id, status, deposit_status, booking_date, booking_time, booking_end_time, estimated_end_time')
    .eq('id', bookingId)
    .maybeSingle();
  if (bookingErr || !bookingData) {
    console.error('[card-hold-charge] booking load failed', bookingErr, { bookingId });
    return { ok: false, code: 'charge_failed', message: 'The booking could not be loaded. Please try again.' };
  }
  const booking = bookingData as {
    status: string;
    deposit_status: string | null;
    booking_date: string;
    booking_time: string;
    booking_end_time?: string | null;
    estimated_end_time?: string | null;
  };

  // Guard 3: charge is gated strictly on booking status = 'No-Show' (D3).
  if (booking.status !== 'No-Show') {
    return { ok: false, code: 'not_no_show', message: 'Mark the booking as a no-show before charging the fee.' };
  }

  // Guard 4: deposit_status must be 'Card Held'.
  if (booking.deposit_status !== 'Card Held') {
    return {
      ok: false,
      code: 'invalid_state',
      message:
        booking.deposit_status === 'Charged'
          ? 'The no-show fee has already been charged for this booking.'
          : 'This booking is not in a chargeable card-hold state.',
    };
  }

  // Guard 5: released / charge window.
  if (hold.released_at != null) {
    return {
      ok: false,
      code: 'hold_released',
      message: 'The card hold has been released, so the fee can no longer be charged.',
    };
  }
  const windowEndsAt = cardHoldChargeWindowEndsAtForBooking(booking);
  if (windowEndsAt && Date.now() > Date.parse(windowEndsAt)) {
    return {
      ok: false,
      code: 'hold_expired',
      message: 'The charge window for this booking has ended, so the fee can no longer be charged.',
    };
  }

  // Guard 6: a saved card must be present.
  if (!hold.stripe_payment_method_id || !hold.stripe_customer_id) {
    return { ok: false, code: 'no_saved_card', message: 'No saved card is available for this booking.' };
  }

  // Guard 7: amount clamp [1, fee_pence].
  const amountPence = params.amountPence ?? hold.fee_pence;
  if (!Number.isInteger(amountPence) || amountPence < 1 || amountPence > hold.fee_pence) {
    return {
      ok: false,
      code: 'invalid_amount',
      message: `The amount must be between £0.01 and ${formatCardHoldFeePence(hold.fee_pence)}.`,
    };
  }

  // §8.3 step 1: atomic claim.
  const attempt = await claimChargeAttempt(admin, hold.id, {
    charge_attempt_count: hold.charge_attempt_count ?? 0,
    charge_payment_intent_id: hold.charge_payment_intent_id,
    released_at: hold.released_at,
  });
  if (attempt == null) {
    return {
      ok: false,
      code: 'invalid_state',
      message: 'Another charge attempt is already in progress for this booking.',
    };
  }

  // §8.3 step 2: create the off-session, merchant-initiated PaymentIntent.
  let pi: { id: string; status: string; amount_received?: number | null };
  try {
    pi = await stripe.paymentIntents.create(
      {
        amount: amountPence,
        currency: 'gbp',
        customer: hold.stripe_customer_id,
        payment_method: hold.stripe_payment_method_id,
        payment_method_types: ['card'],
        off_session: true,
        confirm: true,
        description: `No-show fee for booking ${bookingRefForCharge(bookingId)}`,
        metadata: {
          reserve_ni_purpose: RESERVE_NI_PI_PURPOSE.CARD_HOLD_NO_SHOW_FEE,
          booking_id: bookingId,
          venue_id: venueId,
        },
      },
      {
        stripeAccount: hold.stripe_connected_account_id,
        idempotencyKey: `card-hold-charge-${hold.id}-${attempt}`,
      },
    );
  } catch (err) {
    const cardError = asStripeCardError(err);
    if (cardError) {
      return handleSynchronousCardError(admin, hold, cardError);
    }
    console.error('[card-hold-charge] PaymentIntent create failed', err, { holdId: hold.id });
    logBookingOp({
      operation: 'card_hold_charge_failed',
      venue_id: venueId,
      booking_id: bookingId,
      error: err instanceof Error ? err.message : 'stripe_error',
    });
    return { ok: false, code: 'charge_failed', message: 'The charge could not be completed. Please try again.' };
  }

  // §8.3 step 3: conditionally persist the PI id. Zero rows means either a
  // concurrent request won the race between steps 1 and 3, OR the hold was
  // released (cancelled/expired) after our guards passed. Both require us to
  // undo our own PI so no orphan charge stands.
  const { data: persisted, error: persistErr } = await admin
    .from('booking_card_holds')
    .update({ charge_payment_intent_id: pi.id, updated_at: new Date().toISOString() })
    .eq('id', hold.id)
    .is('charge_payment_intent_id', null)
    // Do not persist onto a hold released between the guards and here: the
    // expiry cron can release mid-charge, and charging a released hold must
    // never stand (concurrency review F3).
    .is('released_at', null)
    .select('id');
  if (persistErr || (persisted ?? []).length === 0) {
    if (persistErr) {
      console.error('[card-hold-charge] PI persist failed', persistErr, { holdId: hold.id, pi: pi.id });
    }
    await disposeOrphanFeePaymentIntent(admin, {
      pi,
      bookingId,
      stripeConnectedAccountId: hold.stripe_connected_account_id,
    });
    return {
      ok: false,
      code: 'invalid_state',
      message: 'Another charge attempt is already in progress for this booking.',
    };
  }

  // §8.3 step 4: on synchronous success apply the webhook-equivalent state.
  if (pi.status === 'succeeded') {
    const chargedPence = pi.amount_received ?? amountPence;
    const { applied } = await applyCardHoldChargedState(admin, {
      holdId: hold.id,
      bookingId,
      venueId,
      paymentIntentId: pi.id,
      amountReceivedPence: chargedPence,
      chargedByStaffId: staffId,
    });

    logBookingOp({ operation: 'card_hold_charge', venue_id: venueId, booking_id: bookingId });

    if (applied) {
      try {
        await sendCardHoldChargedReceipt({
          bookingId,
          venueId,
          chargedPence,
          chargedAt: new Date().toISOString(),
        });
      } catch (emailErr) {
        console.error('[card-hold-charge] receipt email failed (charge stands)', emailErr, { bookingId });
      }
    }

    return { ok: true, chargedPence, paymentIntentId: pi.id, pending: false };
  }

  // Non-terminal status (rare for off-session cards): the webhook completes state.
  console.warn('[card-hold-charge] PI not synchronously succeeded, deferring to webhook', {
    pi: pi.id,
    status: pi.status,
  });
  return { ok: true, chargedPence: amountPence, paymentIntentId: pi.id, pending: true };
}

/**
 * §8.5 synchronous failure handling: record the failure fields, clear
 * charge_payment_intent_id (reopening the claim for a retry), insert the
 * card_hold_charge_failed events row, log the op, and map the error to its
 * spec message. authentication_required additionally cancels the stray
 * requires_action PI. Never mutates deposit_status.
 */
async function handleSynchronousCardError(
  admin: SupabaseClient,
  hold: ChargeableHoldRow,
  err: StripeCardErrorLike,
): Promise<ChargeCardHoldNoShowFeeResult> {
  const failureCode = err.code ?? 'card_declined';
  const nowIso = new Date().toISOString();

  // A synchronous decline means paymentIntents.create THREW, so this request
  // never persisted a PI id: the claim is already open and there is nothing
  // of ours to clear. Clearing unconditionally could wipe a CONCURRENT
  // winner's persisted PI in the window before it stamps charged_at,
  // breaking the single-charge gate (review finding). Only clear when the
  // persisted id is this attempt's own dead PI.
  const { error: recordErr } = await admin
    .from('booking_card_holds')
    .update({
      charge_failure_code: failureCode,
      charge_failure_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', hold.id)
    .is('charged_at', null);
  if (recordErr) {
    console.error('[card-hold-charge] failure record failed', recordErr, { holdId: hold.id });
  }
  const deadPiId = err.payment_intent?.id ?? err.raw?.payment_intent?.id ?? null;
  if (deadPiId) {
    const { error: clearErr } = await admin
      .from('booking_card_holds')
      .update({ charge_payment_intent_id: null, updated_at: nowIso })
      .eq('id', hold.id)
      .eq('charge_payment_intent_id', deadPiId)
      .is('charged_at', null);
    if (clearErr) {
      console.error('[card-hold-charge] dead PI clear failed', clearErr, { holdId: hold.id });
    }
  }

  const { error: evErr } = await admin.from('events').insert({
    venue_id: hold.venue_id,
    booking_id: hold.booking_id,
    event_type: 'card_hold_charge_failed',
    payload: { booking_id: hold.booking_id, failure_code: failureCode },
  });
  if (evErr) {
    console.error('[card-hold-charge] card_hold_charge_failed event insert failed', evErr, {
      bookingId: hold.booking_id,
    });
  }

  logBookingOp({
    operation: 'card_hold_charge_failed',
    venue_id: hold.venue_id,
    booking_id: hold.booking_id,
    error: failureCode,
  });

  if (failureCode === 'authentication_required') {
    // The decline leaves a stray requires_action PI behind; cancel it (best effort).
    const strayPiId = err.payment_intent?.id ?? err.raw?.payment_intent?.id ?? null;
    if (strayPiId) {
      try {
        await stripe.paymentIntents.cancel(strayPiId, {
          stripeAccount: hold.stripe_connected_account_id,
        });
      } catch (cancelErr) {
        console.error('[card-hold-charge] stray requires_action PI cancel failed', cancelErr, {
          pi: strayPiId,
        });
      }
    }
    return { ok: false, code: 'authentication_required', message: AUTHENTICATION_REQUIRED_MESSAGE };
  }

  return {
    ok: false,
    code: 'card_declined',
    message: `The card was declined (${plainDeclineReason(err)}). You can try again, or contact the client to arrange payment.`,
  };
}
