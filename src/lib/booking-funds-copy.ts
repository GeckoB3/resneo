/**
 * Standard wording for how booking funds are handled (Stripe Connect / direct charges).
 * Use {@link RESERVENI_DOES_NOT_HOLD_BOOKING_MONEY} in legal/policy copy;
 * use {@link RESERVENI_MARKETING_PAYMENTS_AND_NO_HOLD} in marketing/FAQ/UX where a short payout explanation helps.
 */
export const RESERVENI_DOES_NOT_HOLD_BOOKING_MONEY = 'ReserveNI does not hold booking money.';

/** First sentence of marketing pair — funds route to the venue’s Stripe-connected account. */
export const RESERVENI_PAYMENTS_TO_CONNECTED_PAYMENT_ACCOUNT =
  'Payments go directly to your connected payment account.';

/** Full marketing block: payout routing + legal line (both sentences). */
export const RESERVENI_MARKETING_PAYMENTS_AND_NO_HOLD = `${RESERVENI_PAYMENTS_TO_CONNECTED_PAYMENT_ACCOUNT} ${RESERVENI_DOES_NOT_HOLD_BOOKING_MONEY}`;

/** Lowercase continuation after e.g. “When a client pays a deposit, …” */
export const RESERVENI_DEPOSIT_FLOWS_MARKETING_FOLLOW_ON =
  'payments go directly to your connected payment account. ReserveNI does not hold booking money.';
