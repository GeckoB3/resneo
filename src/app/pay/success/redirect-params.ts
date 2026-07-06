/**
 * Pure helpers for reading Stripe's /pay/success redirect params
 * (spec CARD_HOLD_DEPOSITS_DESIGN_AND_IMPLEMENTATION section 7.7).
 *
 * Stripe appends `payment_intent`/`payment_intent_client_secret` after
 * confirmPayment and `setup_intent`/`setup_intent_client_secret` after
 * confirmSetup, plus `redirect_status` in both cases. The /pay page also puts
 * `booking_id` into the return_url so the success page can run the best-effort
 * confirm call that the redirect skipped.
 */

export type PayRedirectStatus = 'succeeded' | 'failed' | 'pending';

export type PayRedirectMode = 'payment' | 'setup';

/** Minimal read interface satisfied by both URLSearchParams and Next's ReadonlyURLSearchParams. */
export interface PayRedirectParamsLike {
  get(name: string): string | null;
}

export function redirectStatusFromParams(redirectStatus: string | null): PayRedirectStatus {
  if (redirectStatus === 'succeeded') return 'succeeded';
  if (redirectStatus === 'failed') return 'failed';
  if (redirectStatus === 'processing') return 'pending';
  // No (or unrecognised) Stripe redirect params: a direct or bookmarked visit,
  // or params stripped by a mail scanner. The page only reaches success copy
  // via Stripe's own redirect_status, so claim nothing without evidence.
  return 'pending';
}

/** Setup mode when Stripe's SetupIntent redirect params are present instead of a PaymentIntent's. */
export function redirectModeFromParams(params: PayRedirectParamsLike): PayRedirectMode {
  if (params.get('setup_intent') || params.get('setup_intent_client_secret')) return 'setup';
  return 'payment';
}

/** The booking_id the /pay page embedded in the return_url, if any. */
export function bookingIdFromParams(params: PayRedirectParamsLike): string | null {
  const bookingId = params.get('booking_id')?.trim();
  return bookingId ? bookingId : null;
}

/**
 * Stripe's own `setup_intent` redirect param, if any. Fallback identifier for the
 * best-effort confirm call when the return_url carried no booking_id: the confirm
 * route accepts `setup_intent_id` and resolves the hold's bookings from it.
 */
export function setupIntentIdFromParams(params: PayRedirectParamsLike): string | null {
  const setupIntentId = params.get('setup_intent')?.trim();
  return setupIntentId ? setupIntentId : null;
}
