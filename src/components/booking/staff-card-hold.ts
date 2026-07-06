/**
 * Staff-surface card-hold toggle helpers
 * (docs: CARD_HOLD_DEPOSITS_DESIGN_AND_IMPLEMENTATION §7.6, D5, D6).
 *
 * The five staff booking surfaces (tables, appointments, classes, events,
 * resources) share these strings and the "does this booking take a card hold?"
 * resolution so the toggle copy, the fee shown, and the request payload cannot
 * drift between forms. No em-dashes anywhere in this copy.
 */

import { formatCardHoldFeePence } from '@/lib/booking/card-hold-terms';

/** Switch label (§7.6, exact string). */
export const STAFF_CARD_HOLD_TOGGLE_LABEL = 'Card hold';

/** Switch sublabel (§7.6, exact string). */
export const STAFF_CARD_HOLD_TOGGLE_SUBLABEL =
  'Send a link to the guest to add their card details';

/** Success toast when the booking was created with a hold requested (§7.6, ASCII hyphen). */
export const STAFF_CARD_HOLD_CREATED_TOAST = 'Booking created - card request link sent';

/** Confirmation-screen line for flows that show an inline panel instead of a toast. */
export const STAFF_CARD_HOLD_LINK_SENT_LINE = 'A card request link was sent to the guest.';

/** Small fee line under the toggle while it is on. */
export function staffCardHoldFeeLine(feePence: number): string {
  return `No-show fee up to ${formatCardHoldFeePence(feePence)}`;
}

/** The selected entity takes a card hold; `feePence` is the fee for the whole booking. */
export interface StaffCardHoldContext {
  feePence: number;
}

/**
 * Tables (§6.3 / D5 staff semantics: the party-size threshold is NOT applied,
 * the toggle is the gate). Reads the slot's ALWAYS-populated configured fields,
 * not the threshold-gated `deposit_required` / `deposit_amount` pair.
 *
 * The availability engine has already applied the owner venue's
 * `card_hold_deposits` flag and the zero-fee safety rule: a `card_hold` rule
 * with the flag off or no positive per-person amount reaches the client as
 * `deposit_type: 'charge'`. So `deposit_type === 'card_hold'` on a slot is
 * itself proof the flag is on; no separate client-side flag check is needed.
 */
export function resolveStaffTableSlotCardHold(
  slot:
    | {
        deposit_type?: 'charge' | 'card_hold';
        configured_deposit_per_person_gbp?: number | null;
      }
    | null
    | undefined,
  partySize: number,
): StaffCardHoldContext | null {
  if (!slot || slot.deposit_type !== 'card_hold') return null;
  const perPersonGbp = slot.configured_deposit_per_person_gbp;
  if (typeof perPersonGbp !== 'number' || !Number.isFinite(perPersonGbp) || perPersonGbp <= 0) {
    return null;
  }
  const covers = Number.isFinite(partySize) && partySize >= 1 ? Math.floor(partySize) : 1;
  // Round after multiplying, matching the server's fee derivation in the
  // staff table branch, so a sub-penny per-person config shows the same total
  // the hold row will store.
  return { feePence: Math.round(perPersonGbp * covers * 100) };
}

/**
 * Appointments, classes, events, resources. Unlike table slots, these entity
 * payloads carry the raw configured `payment_requirement`, flag-independent
 * (the resolver's flag gate lives at the write path), so the owner venue's
 * `card_hold_deposits` flag must be checked client-side here.
 *
 * `feePerUnitPence` is the per-unit no-show fee (per person for classes and
 * events, per booking for appointments and resources); `units` multiplies it
 * (spots / tickets; defaults to 1).
 */
export function resolveStaffEntityCardHold(args: {
  paymentRequirement: string | null | undefined;
  feePerUnitPence: number | null | undefined;
  cardHoldFlagEnabled: boolean;
  units?: number;
}): StaffCardHoldContext | null {
  if (!args.cardHoldFlagEnabled) return null;
  if (args.paymentRequirement !== 'card_hold') return null;
  const perUnit = args.feePerUnitPence;
  if (typeof perUnit !== 'number' || !Number.isFinite(perUnit) || perUnit <= 0) return null;
  const units =
    typeof args.units === 'number' && Number.isFinite(args.units) && args.units >= 1
      ? Math.floor(args.units)
      : 1;
  return { feePence: perUnit * units };
}
