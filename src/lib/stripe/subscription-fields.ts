/**
 * Read fields from Stripe Subscription objects safely. Inputs are typed as
 * a structural subset because the Stripe SDK's `Response<T>` wrapper does
 * not always index into resource fields directly (varies by client version).
 */

interface SubscriptionFields {
  current_period_end?: number;
  current_period_start?: number;
  cancel_at?: number | null;
  cancel_at_period_end?: boolean;
  status?: string;
  items?: {
    data?: Array<{
      current_period_end?: number;
      current_period_start?: number;
    }>;
  };
}

function asFields(sub: unknown): SubscriptionFields | null {
  return sub && typeof sub === 'object' ? (sub as SubscriptionFields) : null;
}

export function subscriptionPeriodEndIso(sub: unknown): string | null {
  const f = asFields(sub);
  if (!f) return null;
  const periodEnd =
    typeof f.current_period_end === 'number'
      ? f.current_period_end
      : f.items?.data?.find((item) => typeof item.current_period_end === 'number')?.current_period_end;
  if (typeof periodEnd !== 'number') return null;
  return new Date(periodEnd * 1000).toISOString();
}

export function subscriptionPeriodStartIso(sub: unknown): string | null {
  const f = asFields(sub);
  if (!f) return null;
  const periodStart =
    typeof f.current_period_start === 'number'
      ? f.current_period_start
      : f.items?.data?.find((item) => typeof item.current_period_start === 'number')?.current_period_start;
  if (typeof periodStart !== 'number') return null;
  return new Date(periodStart * 1000).toISOString();
}

export function subscriptionCancelAtPeriodEnd(sub: unknown): boolean {
  const f = asFields(sub);
  return Boolean(f?.cancel_at_period_end);
}

export function subscriptionCancelAtIso(sub: unknown): string | null {
  const f = asFields(sub);
  if (!f || typeof f.cancel_at !== 'number') return null;
  return new Date(f.cancel_at * 1000).toISOString();
}

export function subscriptionHasFutureCancellation(sub: unknown): boolean {
  if (subscriptionCancelAtPeriodEnd(sub)) return true;
  const cancelAt = subscriptionCancelAtIso(sub);
  return Boolean(cancelAt && Date.parse(cancelAt) > Date.now());
}

export function subscriptionStatus(sub: unknown): string | undefined {
  const f = asFields(sub);
  return typeof f?.status === 'string' ? f.status : undefined;
}

export function mapStripeSubscriptionToPlanStatus(
  sub: unknown,
): 'active' | 'trialing' | 'past_due' | 'cancelled' | 'cancelling' {
  if (subscriptionHasFutureCancellation(sub)) return 'cancelling';
  const st = subscriptionStatus(sub);
  if (st === 'trialing') return 'trialing';
  if (st === 'active') return 'active';
  if (st === 'past_due') return 'past_due';
  if (st === 'canceled') {
    const periodEnd = subscriptionPeriodEndIso(sub);
    if (periodEnd && Date.parse(periodEnd) > Date.now()) {
      return 'cancelling';
    }
    return 'cancelled';
  }
  if (st === 'unpaid' || st === 'incomplete_expired' || st === 'paused') {
    return 'cancelled';
  }
  if (st === 'incomplete') return 'past_due';
  return 'past_due';
}
