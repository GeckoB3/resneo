import type { SupabaseClient } from '@supabase/supabase-js';
import { releaseCardHoldsForBookings } from '@/lib/booking/card-hold-release';

/**
 * Cancellation-time card-hold settlement (docs:
 * CARD_HOLD_DEPOSITS_DESIGN_AND_IMPLEMENTATION §9.3 as amended by the
 * late-cancellation change; delivers future-work item 2).
 *
 * A cancellation recorded by the guest (manage link) or by staff on the
 * dashboard no longer releases every hold unconditionally. Per booking:
 *
 *  - SAVED hold ('Card Held') + cancellation AFTER the booking's
 *    cancellation_deadline -> the hold is KEPT: late_cancellation_at is
 *    stamped, a card_hold_kept_late_cancellation events row is inserted, and
 *    the no-show fee stays chargeable until the charge window ends (or staff
 *    release the hold without charging).
 *  - Everything else (cancel before the deadline, unsaved hold, no deadline
 *    on the booking) -> released with reason 'cancelled', exactly as before.
 *
 * Venue-initiated cancellations must NOT use this helper: class-instance and
 * event cancel cascades, the auto-cancel crons, payment-failure webhooks and
 * GDPR erasure keep calling releaseCardHoldsForBookings directly, so a guest
 * is never left chargeable for a cancellation the venue made.
 */

export interface KeptCardHold {
  bookingId: string;
  feePence: number;
}

export interface SettleCardHoldsOnCancellationResult {
  /** Holds released with reason 'cancelled' (pre-deadline or unsaved). */
  releasedBookingIds: string[];
  /** Saved holds kept chargeable because the cancellation came after the deadline. */
  keptHolds: KeptCardHold[];
}

type SettleHoldRow = {
  id: string;
  booking_id: string;
  venue_id: string;
  fee_pence: number;
  stripe_payment_method_id: string | null;
  late_cancellation_at: string | null;
  terms_snapshot: { version?: number } | null;
};

/**
 * Only holds consented under terms version 2+ may be kept: version 1 text
 * promised "if you cancel the booking before it starts, nothing extra will be
 * charged", so keeping a v1 hold on a late cancel would charge against the
 * guest's own consented terms (a certain chargeback loss). V1 holds age out
 * within days of this change shipping.
 */
function termsAllowLateCancellationKeep(hold: SettleHoldRow): boolean {
  const version = hold.terms_snapshot?.version;
  return typeof version === 'number' && version >= 2;
}

/**
 * Settle the open holds on just-cancelled bookings: keep saved holds whose
 * cancellation came after the deadline, release the rest. Idempotent: released
 * and charged holds are never touched, and an already-kept hold is reported as
 * kept again without re-stamping or duplicate events.
 */
export async function settleCardHoldsOnCancellation(
  admin: SupabaseClient,
  bookingIds: string[],
  opts?: { now?: Date },
): Promise<SettleCardHoldsOnCancellationResult> {
  const result: SettleCardHoldsOnCancellationResult = { releasedBookingIds: [], keptHolds: [] };
  const ids = bookingIds.filter(Boolean);
  if (ids.length === 0) return result;

  const { data: holdRows, error: holdErr } = await admin
    .from('booking_card_holds')
    .select(
      'id, booking_id, venue_id, fee_pence, stripe_payment_method_id, late_cancellation_at, terms_snapshot',
    )
    .in('booking_id', ids)
    .is('released_at', null)
    .is('charged_at', null);
  if (holdErr) {
    console.error('[card-hold-cancellation] hold load failed', holdErr);
    throw new Error('Failed to load card holds for cancellation');
  }
  const openHolds = (holdRows ?? []) as SettleHoldRow[];
  if (openHolds.length === 0) return result;

  // The keep decision needs each booking's cancellation_deadline. If the read
  // fails, fall back to releasing everything: a wrongly-released hold costs the
  // venue a fee it might have charged, a wrongly-kept hold could charge a guest
  // who cancelled in time.
  const holdBookingIds = openHolds.map((h) => h.booking_id);
  const { data: bookingRows, error: bookingErr } = await admin
    .from('bookings')
    .select('id, cancellation_deadline')
    .in('id', holdBookingIds);
  const deadlines = new Map<string, string | null>();
  if (bookingErr) {
    console.error('[card-hold-cancellation] booking deadline load failed, releasing all holds', bookingErr);
  } else {
    for (const row of (bookingRows ?? []) as Array<{ id: string; cancellation_deadline: string | null }>) {
      deadlines.set(row.id, row.cancellation_deadline);
    }
  }

  const nowMs = (opts?.now ?? new Date()).getTime();
  const kept: SettleHoldRow[] = [];
  const toRelease: string[] = [];
  for (const hold of openHolds) {
    const deadlineIso = deadlines.get(hold.booking_id) ?? null;
    const deadlineMs = deadlineIso ? Date.parse(deadlineIso) : Number.NaN;
    const isLateCancel =
      hold.stripe_payment_method_id != null &&
      Number.isFinite(deadlineMs) &&
      nowMs > deadlineMs &&
      termsAllowLateCancellationKeep(hold);
    if (isLateCancel) kept.push(hold);
    else toRelease.push(hold.booking_id);
  }

  if (toRelease.length > 0) {
    const released = await releaseCardHoldsForBookings(admin, toRelease, 'cancelled');
    result.releasedBookingIds = released.releasedBookingIds;
  }

  if (kept.length > 0) {
    result.keptHolds = kept.map((h) => ({ bookingId: h.booking_id, feePence: h.fee_pence }));

    // Stamp only the not-yet-stamped holds; a re-run must not re-stamp or emit
    // duplicate events. The released/charged guards are re-asserted so a
    // concurrent release or charge is never overwritten.
    const nowIso = new Date(nowMs).toISOString();
    const toStamp = kept.filter((h) => h.late_cancellation_at == null);
    if (toStamp.length > 0) {
      const { data: stamped, error: stampErr } = await admin
        .from('booking_card_holds')
        .update({ late_cancellation_at: nowIso, updated_at: nowIso })
        .in(
          'id',
          toStamp.map((h) => h.id),
        )
        .is('released_at', null)
        .is('charged_at', null)
        .is('late_cancellation_at', null)
        .select('id, booking_id, venue_id, fee_pence');
      if (stampErr) {
        console.error('[card-hold-cancellation] late-cancellation stamp failed', stampErr);
        throw new Error('Failed to keep the card holds after a late cancellation');
      }
      const stampedRows = (stamped ?? []) as Array<
        Pick<SettleHoldRow, 'booking_id' | 'venue_id' | 'fee_pence'>
      >;
      if (stampedRows.length > 0) {
        const eventRows = stampedRows.map((h) => ({
          venue_id: h.venue_id,
          booking_id: h.booking_id,
          event_type: 'card_hold_kept_late_cancellation',
          payload: {
            booking_id: h.booking_id,
            fee_pence: h.fee_pence,
            cancellation_deadline: deadlines.get(h.booking_id) ?? null,
          },
        }));
        const { error: evErr } = await admin.from('events').insert(eventRows);
        if (evErr) {
          // Non-fatal: the stamped hold is the source of truth (§11 observability).
          console.error('[card-hold-cancellation] kept-hold event insert failed', evErr);
        }
      }
    }
  }

  return result;
}
