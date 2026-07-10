/**
 * Guest-safe card-hold summary for the manage/confirm surfaces
 * (docs: CARD_HOLD_DEPOSITS_DESIGN_AND_IMPLEMENTATION §10.1).
 *
 * `GET /api/confirm` exposes the booking's hold to the guest as a small,
 * PII-free shape: the consented fee, a derived lifecycle state, and (when
 * charged) the charged amount and timestamp. Stripe ids, staff ids and the
 * terms snapshot never leave the server.
 */

import { formatRefundDeadlineIso } from '@/lib/booking/cancellation-deadline';

export type GuestCardHoldState =
  | 'awaiting_card'
  | 'held'
  | 'released'
  | 'charged'
  | 'refunded';

export interface GuestCardHoldSummary {
  fee_pence: number;
  state: GuestCardHoldState;
  charged_pence: number | null;
  charged_at: string | null;
}

export interface GuestCardHoldBookingInput {
  deposit_status?: string | null;
}

export interface GuestCardHoldRowInput {
  fee_pence: number;
  released_at: string | null;
  charged_pence?: number | null;
  charged_at?: string | null;
  stripe_payment_method_id?: string | null;
}

/**
 * Derive the guest-visible hold state from `deposit_status` + the hold row (§10.1, §14):
 * - `Charged`                          -> `charged` (with amount + date)
 * - `Refunded` + hold row              -> `refunded`
 * - hold released (any other status)   -> `released` (cancel / expiry / waive)
 * - `Card Held` + open                 -> `held`
 * - `Pending` + open + card not saved  -> `awaiting_card` (staff link flow, pre-save)
 * - `Pending` + open + card saved      -> `held` (webhook/confirm race; card is on file)
 *
 * Returns null when there is no hold row, or when the status combination is not
 * a guest-meaningful hold state (e.g. a paid deposit booking with no hold).
 */
/**
 * The guest-facing "card held" line for the manage page and the signed-in
 * booking detail page (§10.1). Deadline-aware (§9.3 amended): with a
 * cancellation deadline the guest must cancel before that instant to avoid the
 * fee; without one, cancelling any time before the start is enough.
 * No em-dashes.
 */
export function guestCardHoldHeldLine(
  venueName: string,
  feePence: number,
  cancellationDeadlineIso?: string | null,
): string {
  const fee = `£${(Number(feePence) / 100).toFixed(2)}`;
  const deadlineMs = cancellationDeadlineIso ? Date.parse(cancellationDeadlineIso) : Number.NaN;
  const cancelClause = Number.isFinite(deadlineMs)
    ? `Cancel before ${formatRefundDeadlineIso(cancellationDeadlineIso!)} to avoid any charge.`
    : 'Cancel before it starts to avoid any charge.';
  return (
    `Your card is securely on file. ${venueName} may charge a no-show fee of up to ${fee} ` +
    `if you miss this booking or cancel late. ${cancelClause}`
  );
}

/**
 * Warning shown before the guest confirms a cancellation once the deadline has
 * passed and a saved hold is open (§9.3 amended). No em-dashes.
 */
export function guestCardHoldLateCancelWarning(venueName: string, feePence: number): string {
  const fee = `£${(Number(feePence) / 100).toFixed(2)}`;
  return (
    `The free cancellation deadline for this booking has passed. ` +
    `If you cancel now, ${venueName} may still charge a no-show fee of up to ${fee}.`
  );
}

export function deriveGuestCardHoldSummary(
  booking: GuestCardHoldBookingInput,
  hold: GuestCardHoldRowInput | null | undefined,
): GuestCardHoldSummary | null {
  if (!hold) return null;

  const base: Omit<GuestCardHoldSummary, 'state'> = {
    fee_pence: hold.fee_pence,
    charged_pence: hold.charged_pence ?? null,
    charged_at: hold.charged_at ?? null,
  };
  const ds = (booking.deposit_status ?? '').toLowerCase();

  if (ds === 'charged') return { ...base, state: 'charged' };
  if (ds === 'refunded') return { ...base, state: 'refunded' };
  if (hold.released_at) return { ...base, state: 'released' };
  if (ds === 'card held') return { ...base, state: 'held' };
  if (ds === 'pending') {
    return hold.stripe_payment_method_id
      ? { ...base, state: 'held' }
      : { ...base, state: 'awaiting_card' };
  }
  return null;
}
