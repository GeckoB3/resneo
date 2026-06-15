/**
 * Standard wording for how booking funds are handled (Stripe Connect / direct charges).
 * Use {@link RESNEO_DOES_NOT_HOLD_BOOKING_MONEY} in legal/policy copy;
 * use {@link RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD} in marketing/FAQ/UX where a short payout explanation helps.
 */
export const RESNEO_DOES_NOT_HOLD_BOOKING_MONEY = 'ResNeo does not hold booking money.';

/** First sentence of marketing pair — funds route to the venue’s Stripe-connected account. */
export const RESNEO_PAYMENTS_TO_CONNECTED_PAYMENT_ACCOUNT =
  'Payments go directly to your connected payment account.';

/** Full marketing block: payout routing + legal line (both sentences). */
export const RESNEO_MARKETING_PAYMENTS_AND_NO_HOLD = `${RESNEO_PAYMENTS_TO_CONNECTED_PAYMENT_ACCOUNT} ${RESNEO_DOES_NOT_HOLD_BOOKING_MONEY}`;

/** Lowercase continuation after e.g. “When a client pays a deposit, …” */
export const RESNEO_DEPOSIT_FLOWS_MARKETING_FOLLOW_ON =
  'payments go directly to your connected payment account. ResNeo does not hold booking money.';
