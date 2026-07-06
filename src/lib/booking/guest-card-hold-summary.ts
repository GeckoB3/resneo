/**
 * Guest-safe card-hold summary for the manage/confirm surfaces
 * (docs: CARD_HOLD_DEPOSITS_DESIGN_AND_IMPLEMENTATION §10.1).
 *
 * `GET /api/confirm` exposes the booking's hold to the guest as a small,
 * PII-free shape: the consented fee, a derived lifecycle state, and (when
 * charged) the charged amount and timestamp. Stripe ids, staff ids and the
 * terms snapshot never leave the server.
 */

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
