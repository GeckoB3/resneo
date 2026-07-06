/**
 * Card-hold consent terms (docs: CARD_HOLD_DEPOSITS_DESIGN_AND_IMPLEMENTATION §7.3/§7.5).
 *
 * The exact consent string shown to the guest at save time is rendered here and
 * snapshotted onto `booking_card_holds.terms_snapshot`. The online client copy,
 * the /pay page copy, and the server snapshot all import from this module so the
 * displayed text and the stored dispute evidence cannot drift.
 */

/** Days after the booking ends during which a no-show fee may be charged (§12.3). */
export const CARD_HOLD_CHARGE_WINDOW_DAYS = 14;

/**
 * Consent snapshot stored on `booking_card_holds.terms_snapshot` (§7.5).
 * `fee_pence` is the capture-unit total shown to the guest; `accepted_at` is
 * null at create and stamped at confirm time. Version 2 added the
 * cancellation-notice sentence (late cancellations may be charged); version 1
 * snapshots promised "cancel before it starts" and stay binding as written.
 */
export interface CardHoldTermsSnapshot {
  version: 1 | 2;
  text: string;
  fee_pence: number;
  accepted_at: string | null;
}

/** £X.XX from pence, e.g. 2500 -> "£25.00". */
export function formatCardHoldFeePence(feePence: number): string {
  return `£${(Number(feePence) / 100).toFixed(2)}`;
}

/**
 * The exact consent line shown above the submit button in both hold modes
 * (§7.3) and written verbatim into the terms snapshot (§7.5).
 *
 * With a positive cancellation notice the text also covers late cancellations
 * (§9.3 amended): the fee may be charged when the guest cancels inside the
 * notice window, not only on a no-show. With no notice (0 or unknown) the
 * deadline is the start itself, so the original wording stays accurate.
 */
export function renderCardHoldConsentText(
  venueName: string,
  feePence: number,
  cancellationNoticeHours?: number | null,
): string {
  const fee = formatCardHoldFeePence(feePence);
  const hours = cancellationNoticeHours ?? 0;
  if (hours > 0) {
    const hoursWord = hours === 1 ? 'hour' : 'hours';
    return (
      `By saving your card you authorise ${venueName} to charge up to ${fee} ` +
      `if you do not attend, or if you cancel less than ${hours} ${hoursWord} ` +
      `before your booking starts. If you cancel earlier than that, nothing extra will be charged.`
    );
  }
  return (
    `By saving your card you authorise ${venueName} to charge up to ${fee} if you do not attend. ` +
    `If you cancel the booking before it starts, nothing extra will be charged.`
  );
}

/** Build the §7.5 snapshot written at create time (`accepted_at` stamped at confirm). */
export function buildCardHoldTermsSnapshot(
  venueName: string,
  feePence: number,
  cancellationNoticeHours?: number | null,
): CardHoldTermsSnapshot {
  return {
    version: 2,
    text: renderCardHoldConsentText(venueName, feePence, cancellationNoticeHours),
    fee_pence: feePence,
    accepted_at: null,
  };
}

/** Booking end + CARD_HOLD_CHARGE_WINDOW_DAYS, as an ISO timestamp (§12.3, derived). */
export function cardHoldChargeWindowEndsAt(bookingEndIso: string): string {
  const endMs = new Date(bookingEndIso).getTime();
  return new Date(endMs + CARD_HOLD_CHARGE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}
