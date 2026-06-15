'use client';

import { useSyncExternalStore } from 'react';
import { loadSalesCodeFromCookieOrUrl } from '@/lib/sales/client';

// The sales cookie is set once upstream and does not change while these interstitials are
// mounted, so there is nothing to subscribe to — the no-op returns an empty unsubscribe.
const subscribe = () => () => {};
const getSnapshot = () => Boolean(loadSalesCodeFromCookieOrUrl(null));
const getServerSnapshot = () => false;

/**
 * True when a validated commissioned-sales code is present (persisted as a cookie upstream by
 * /signup/choose-plan or /signup), which earns the signup 1 month free. Drives the trial copy
 * on the signup interstitials.
 *
 * useSyncExternalStore reads the cookie only on the client: SSR and the first client render use
 * the `false` server snapshot, then React re-renders with the real value after hydration. That
 * avoids both a hydration mismatch and the setState-in-effect the lint rules forbid. The
 * authoritative offer is still re-validated at the payment step and enforced by Stripe.
 */
export function useSalesTrial(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
