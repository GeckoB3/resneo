/**
 * Staff-surface card-hold toggle helpers
 * (docs: CARD_HOLD_DEPOSITS_DESIGN_AND_IMPLEMENTATION §7.6, D5, D6).
 *
 * The five staff booking surfaces (tables, appointments, classes, events,
 * resources) share these strings and the "does this booking take a card hold?"
 * resolution so the toggle copy, the fee shown, and the request payload cannot
 * drift between forms. No em-dashes anywhere in this copy.
 */

import { CARD_HOLD_LINK_TIMEOUT_HOURS } from '@/lib/booking/card-hold-terms';

/** Switch label (§7.6, exact string). */
export const STAFF_CARD_HOLD_TOGGLE_LABEL = 'Card hold';

/** Sublabel while the switch is ON: what the guest gets and when the card is charged. */
export const STAFF_CARD_HOLD_TOGGLE_SUBLABEL_ON = `On: the guest gets a link to add their card, charged only if they do not show. The booking is cancelled if no card is added within ${CARD_HOLD_LINK_TIMEOUT_HOURS} hours.`;
/** Sublabel while the switch is OFF (the default): what leaving it off means. */
export const STAFF_CARD_HOLD_TOGGLE_SUBLABEL_OFF =
  'Off: no card is taken, so a no-show cannot be charged.';
/** The sublabel for the switch's current state, so staff can see what each position does. */
export function staffCardHoldToggleSublabel(checked: boolean): string {
  return checked ? STAFF_CARD_HOLD_TOGGLE_SUBLABEL_ON : STAFF_CARD_HOLD_TOGGLE_SUBLABEL_OFF;
}

/** Success toast when the booking was created with a hold requested (§7.6, ASCII hyphen). */
export const STAFF_CARD_HOLD_CREATED_TOAST = 'Booking created - card request link sent';

/** Confirmation-screen line for flows that show an inline panel instead of a toast. */
export const STAFF_CARD_HOLD_LINK_SENT_LINE = 'A card request link was sent to the guest.';


/** The selected entity takes a card hold; `feePence` is the fee for the whole booking. */
export interface StaffCardHoldContext {
  feePence: number;
}

/**
 * Tables (§6.3 / D5 staff semantics: the party-size threshold is NOT applied,
 * the toggle is the gate). Reads the slot's ALWAYS-populated configured fields,
 * not the threshold-gated `deposit_required` / `deposit_amount` pair.
 *
 * The availability engine has already applied the zero-fee safety rule: a
 * `card_hold` rule with no positive per-person amount reaches the client as
 * `deposit_type: 'charge'`.
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
 * Appointments, classes, events, resources. These entity payloads carry the raw
 * configured `payment_requirement`; a `card_hold` entity takes a hold whenever
 * its fee is positive.
 *
 * `feePerUnitPence` is the per-unit no-show fee (per person for classes and
 * events, per booking for appointments and resources); `units` multiplies it
 * (spots / tickets; defaults to 1).
 */
export function resolveStaffEntityCardHold(args: {
  paymentRequirement: string | null | undefined;
  feePerUnitPence: number | null | undefined;
  units?: number;
}): StaffCardHoldContext | null {
  if (args.paymentRequirement !== 'card_hold') return null;
  const perUnit = args.feePerUnitPence;
  if (typeof perUnit !== 'number' || !Number.isFinite(perUnit) || perUnit <= 0) return null;
  const units =
    typeof args.units === 'number' && Number.isFinite(args.units) && args.units >= 1
      ? Math.floor(args.units)
      : 1;
  return { feePence: perUnit * units };
}
