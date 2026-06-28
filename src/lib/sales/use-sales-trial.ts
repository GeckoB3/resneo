'use client';

import { useSyncExternalStore } from 'react';
import { loadSalesCodeFromCookieOrUrl, readSalesTrialDaysFromCookie } from '@/lib/sales/client';
import { SALES_SIGNUP_TRIAL_DAYS } from '@/lib/sales/constants';

// The sales cookies are set once upstream and do not change while these interstitials are
// mounted, so there is nothing to subscribe to — the no-op returns an empty unsubscribe.
const subscribe = () => () => {};
const getSnapshot = (): number | null => {
  if (!loadSalesCodeFromCookieOrUrl(null)) return null;
  // A code is present but the trial-length cookie may be missing (e.g. an older link, or a
  // direct landing that hasn't re-validated yet) — fall back to the default sales trial.
  return readSalesTrialDaysFromCookie() ?? SALES_SIGNUP_TRIAL_DAYS;
};
const getServerSnapshot = (): number | null => null;

/**
 * Returns the free-trial length (in days) granted by the prospect's validated commissioned-sales
 * code, or `null` when no sales code is present. Drives the trial copy on the signup interstitials
 * (/signup/plan, /signup/appointments-light) that read the cookie rather than re-validating.
 *
 * useSyncExternalStore reads the cookies only on the client: SSR and the first client render use
 * the `null` server snapshot, then React re-renders with the real value after hydration. That
 * avoids both a hydration mismatch and the setState-in-effect the lint rules forbid. The returned
 * value is a primitive, so the snapshot stays referentially stable. The authoritative offer is
 * still re-validated at the payment step and enforced by Stripe.
 */
export function useSalesTrial(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
