/**
 * Guest-facing card-hold copy for the online booking client
 * (docs: CARD_HOLD_DEPOSITS_DESIGN_AND_IMPLEMENTATION §7.3).
 *
 * All strings that mention the fee build on `formatCardHoldFeePence` from
 * `card-hold-terms.ts` (the same module the server snapshot uses) so the
 * displayed amounts cannot drift from the stored consent evidence.
 * No em-dashes anywhere in this copy.
 */

import { formatCardHoldFeePence } from '@/lib/booking/card-hold-terms';

/** How the payment step captures the card (mirrors the create/checkout responses). */
export type CardHoldPaymentMode = 'payment' | 'setup' | 'payment_with_setup';

/** True when the mode stores a card for a possible no-show charge. */
export function isCardHoldPaymentMode(
  mode: CardHoldPaymentMode | null | undefined,
): mode is 'setup' | 'payment_with_setup' {
  return mode === 'setup' || mode === 'payment_with_setup';
}

/** Setup mode heading on the payment step (§7.3). */
export const CARD_HOLD_SETUP_HEADING = 'Secure your booking';

/** Setup mode sub-heading on the payment step (§7.3). */
export const CARD_HOLD_SETUP_SUBHEADING = 'No payment is taken today.';

/** Submit button label in setup mode (§7.3). */
export const CARD_HOLD_SETUP_SUBMIT_LABEL = 'Save card and book';

/** Confirmation screen line after a successful card save in setup mode (§7.3). */
export const CARD_HOLD_SETUP_CONFIRMATION_LINE = 'Card saved. No payment has been taken.';

/** Confirmation screen line when a payment also stored the card (§7.3). */
export const CARD_HOLD_PAYMENT_WITH_SETUP_CONFIRMATION_LINE =
  'Your card has been stored securely for this booking.';

/** Setup mode body text on the payment step (§7.3, exact string). */
export function cardHoldSetupBodyText(venueName: string, feePence: number): string {
  return (
    'Your card details are stored securely by our payment provider, Stripe. ' +
    `${venueName} may charge a no-show fee of up to ${formatCardHoldFeePence(feePence)} ` +
    'if you miss your booking.'
  );
}

/** Extra body line in payment_with_setup mode, shown with the amount display (§7.3). */
export function cardHoldPaymentWithSetupBodyText(venueName: string, feePence: number): string {
  return (
    'Your card will also be stored securely. ' +
    `${venueName} may charge a no-show fee of up to ${formatCardHoldFeePence(feePence)} ` +
    'if you miss your booking.'
  );
}

/**
 * Catalog / service-card hint for card-hold entities (§7.3 last paragraph).
 * `perPerson` for per-person fees (classes, events, table rules).
 */
export function cardHoldCatalogNoticeLine(
  feePence: number,
  opts?: { perPerson?: boolean },
): string {
  return (
    `No-show fee of ${formatCardHoldFeePence(feePence)}${opts?.perPerson ? ' per person' : ''} applies. ` +
    'No payment is taken when you book.'
  );
}

/**
 * Booking-step banner replacing the legacy deposit copy in hold contexts (§7.3
 * suppression paragraph). `feePence` is the capture-unit total shown to the guest.
 */
export function cardHoldBookingNoticeLine(feePence: number): string {
  if (feePence > 0) {
    return (
      'No payment is taken when you book. ' +
      `A no-show fee of up to ${formatCardHoldFeePence(feePence)} may apply if you do not attend.`
    );
  }
  return 'No payment is taken when you book. A no-show fee may apply if you do not attend.';
}

/** Post-booking confirmation line for the mode, or null when nothing extra applies. */
export function cardHoldConfirmationLine(
  mode: CardHoldPaymentMode | null | undefined,
): string | null {
  if (mode === 'setup') return CARD_HOLD_SETUP_CONFIRMATION_LINE;
  if (mode === 'payment_with_setup') return CARD_HOLD_PAYMENT_WITH_SETUP_CONFIRMATION_LINE;
  return null;
}
