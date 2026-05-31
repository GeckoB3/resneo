/** Normal venues: Stripe Billing subscription on file. */
export const BILLING_ACCESS_SOURCE_STRIPE = 'stripe';

/** Comped by platform superuser; no Resneo subscription charges. */
export const BILLING_ACCESS_SOURCE_SUPERUSER_FREE = 'superuser_free';

export type BillingAccessSource = typeof BILLING_ACCESS_SOURCE_STRIPE | typeof BILLING_ACCESS_SOURCE_SUPERUSER_FREE;

export function isSuperuserFreeBillingAccess(source: string | null | undefined): boolean {
  return (source ?? '').toLowerCase().trim() === BILLING_ACCESS_SOURCE_SUPERUSER_FREE;
}
