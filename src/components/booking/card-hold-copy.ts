/**
 * Card-hold copy for the online booking client (§7.3) and the staff booking
 * detail surfaces (§9.1/§9.2)
 * (docs: CARD_HOLD_DEPOSITS_DESIGN_AND_IMPLEMENTATION).
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

/* ------------------------------------------------------------------ */
/* Staff booking-detail surfaces (§9.1 pill table + §9.2 charge UI)    */
/* ------------------------------------------------------------------ */

/** Pill labels from the §9.1 state table (exact strings). */
export const CARD_HOLD_PILL_REQUEST_SENT = 'Card request sent';
export const CARD_HOLD_PILL_HELD = 'Card held';
export const CARD_HOLD_PILL_ENDED = 'Card hold ended';
export const CARD_HOLD_PILL_CHARGED = 'No-show fee charged';
export const CARD_HOLD_PILL_REFUNDED = 'No-show fee refunded';

/** Staff action labels (§9.1/§9.2). */
export const CARD_HOLD_RESEND_LINK_LABEL = 'Resend link';
export const CARD_HOLD_WAIVE_LABEL = 'Waive';
export const CARD_HOLD_CHARGE_ACTION_LABEL = 'Charge no-show fee';
export const CARD_HOLD_REFUND_ACTION_LABEL = 'Refund no-show fee';

/** Short date used in staff hold detail lines, e.g. "3 Jul 2026". */
export function formatCardHoldDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** `'Pending'` + open unsaved hold detail line (§9.1). */
export function cardHoldAwaitingCardLine(feePence: number): string {
  return `Waiting for the guest to add card details. No-show fee up to ${formatCardHoldFeePence(feePence)}.`;
}

/** `'Pending'` + released hold (booking cancelled before the card was saved) (§9.1). */
export const CARD_HOLD_REQUEST_CANCELLED_LINE = 'The card request was cancelled with the booking.';

/** `'Card Held'`, not released (§9.1). Fee-less fallback for payloads without the hold row. */
export function cardHoldHeldLine(feePence: number | null): string {
  if (feePence != null && feePence > 0) {
    return `No-show fee up to ${formatCardHoldFeePence(feePence)}. No payment taken.`;
  }
  return 'Card securely on file. No payment taken.';
}

/** `'Card Held'`, released (§9.1). */
export function cardHoldEndedLine(releasedAtIso: string | null): string {
  if (releasedAtIso) {
    return `The card hold was released on ${formatCardHoldDate(releasedAtIso)}.`;
  }
  return 'The card hold has ended.';
}

/** `'Waived'` deposit_status: the card request was waived before any card was saved (§9.1). */
export const CARD_HOLD_WAIVED_LINE = 'The card request was waived. No card is on file.';

/**
 * Appended to the held line when the 14-day charge window has passed, so staff
 * understand why the Charge button is no longer offered (mirrors the server's
 * `hold_expired` 409).
 */
export const CARD_HOLD_WINDOW_EXPIRED_LINE =
  'The charge window has ended, so the no-show fee can no longer be charged.';

/** `'Charged'` (§9.1). Degrades gracefully when amount or date is unknown. */
export function cardHoldChargedLine(
  chargedPence: number | null,
  chargedAtIso: string | null,
): string {
  if (chargedPence != null && chargedPence > 0) {
    const amount = formatCardHoldFeePence(chargedPence);
    return chargedAtIso
      ? `${amount} charged on ${formatCardHoldDate(chargedAtIso)}.`
      : `${amount} charged.`;
  }
  return 'A no-show fee was charged.';
}

/** `'Refunded'` after a charge (§9.1). */
export function cardHoldRefundedLine(chargedPence: number | null): string {
  if (chargedPence != null && chargedPence > 0) {
    return `${formatCardHoldFeePence(chargedPence)} refunded.`;
  }
  return 'The no-show fee was refunded.';
}

/**
 * Plain-words mapping of Stripe charge failure codes (§8.5/§9.1). Unknown codes
 * degrade to a generic phrase rather than leaking raw codes to staff.
 */
export function cardHoldChargeFailurePlainReason(code: string): string {
  switch (code) {
    case 'card_declined':
      return 'the card was declined';
    case 'authentication_required':
      return 'the card issuer requires the client to authorise the payment';
    case 'expired_card':
      return 'the card has expired';
    case 'insufficient_funds':
      return 'the card has insufficient funds';
    default:
      return 'the payment did not go through';
  }
}

/** Appended detail line when the last charge attempt failed (§9.1). */
export function cardHoldChargeFailureLine(code: string): string {
  return `Last charge attempt failed: ${cardHoldChargeFailurePlainReason(code)}.`;
}

/** Charge dialog title (§9.2, exact string). */
export const CARD_HOLD_CHARGE_DIALOG_TITLE = 'Charge no-show fee';

/** Charge dialog body (§9.2, exact string). */
export function cardHoldChargeDialogBody(guestName: string, feePence: number): string {
  return (
    `Charge ${guestName}'s saved card for missing this booking. ` +
    `The maximum you can charge is ${formatCardHoldFeePence(feePence)}.`
  );
}

/** Charge dialog confirm button, live-updating with the entered amount (§9.2). */
export function cardHoldChargeConfirmLabel(amountPence: number): string {
  return `Charge ${formatCardHoldFeePence(amountPence)}`;
}
