import { isSuperuserFreeBillingAccess } from '@/lib/billing/billing-access-source';

export interface VenueBillingFields {
  plan_status?: string | null;
  subscription_current_period_end?: string | null;
  billing_access_source?: string | null;
  pricing_tier?: string | null;
}

/**
 * High-level subscription access for dashboard middleware and public booking.
 *
 * - `free_access`: complimentary venue (`billing_access_source === superuser_free`) — full dashboard access.
 * - `active_like`: paying subscription access — active, trialing, scheduled cancellation still in paid window,
 *   or cancelled but paid-through period not ended yet.
 * - `past_due`: invoice payment failed — dashboard mutations blocked; Light public booking paused.
 * - `expired_cancelled`: subscription ended or cancelled with no remaining paid period — dashboard mutations
 *   blocked; public booking paused for all tiers.
 */
export type SubscriptionEntitlementKind =
  | 'free_access'
  | 'active_like'
  | 'past_due'
  | 'expired_cancelled';

export interface SubscriptionEntitlement {
  kind: SubscriptionEntitlementKind;
}

function normalizePlanStatus(raw: string | null | undefined): string {
  return (raw ?? '').toLowerCase().trim();
}

/** Parses ISO period end; returns null if missing or invalid. */
export function parseSubscriptionPeriodEndMs(iso: string | null | undefined): number | null {
  if (!iso || typeof iso !== 'string' || iso.trim() === '') return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * True when the venue still has paid-through access after a cancellation request or Stripe `canceled`
 * object whose period end is still in the future.
 */
export function hasPaidAccessUntilPeriodEnd(
  planStatusRaw: string | null | undefined,
  subscriptionCurrentPeriodEnd: string | null | undefined,
  nowMs: number,
): boolean {
  const planStatus = normalizePlanStatus(planStatusRaw);
  const endMs = parseSubscriptionPeriodEndMs(subscriptionCurrentPeriodEnd);
  if (endMs === null) return false;
  if (endMs <= nowMs) return false;
  return planStatus === 'cancelled' || planStatus === 'cancelling';
}

/**
 * True when subscription billing access has fully ended (must block unpaid dashboard mutations).
 * Does not include `past_due` — that is handled separately.
 */
export function isExpiredCancelledAccess(
  planStatusRaw: string | null | undefined,
  subscriptionCurrentPeriodEnd: string | null | undefined,
  nowMs: number,
): boolean {
  const planStatus = normalizePlanStatus(planStatusRaw);
  if (planStatus !== 'cancelled') return false;
  if (hasPaidAccessUntilPeriodEnd(planStatusRaw, subscriptionCurrentPeriodEnd, nowMs)) return false;
  return true;
}

/**
 * Resolves subscription entitlement from venue billing columns. Use the same `nowMs` in tests.
 */
export function resolveVenueSubscriptionEntitlement(
  fields: VenueBillingFields,
  nowMs: number = Date.now(),
): SubscriptionEntitlement {
  if (isSuperuserFreeBillingAccess(fields.billing_access_source)) {
    return { kind: 'free_access' };
  }

  const planStatus = normalizePlanStatus(fields.plan_status);
  if (planStatus === 'past_due') {
    return { kind: 'past_due' };
  }

  if (planStatus === 'active' || planStatus === 'trialing') {
    return { kind: 'active_like' };
  }

  if (planStatus === 'cancelling') {
    return { kind: 'active_like' };
  }

  if (planStatus === 'cancelled') {
    if (hasPaidAccessUntilPeriodEnd(fields.plan_status, fields.subscription_current_period_end, nowMs)) {
      return { kind: 'active_like' };
    }
    return { kind: 'expired_cancelled' };
  }

  // Unknown legacy labels: avoid blocking paid features (defensive).
  return { kind: 'active_like' };
}

/** Block POST/PUT/PATCH/DELETE on /api/venue/* (except billing-exempt paths) for past_due and expired_cancelled. */
export function areVenueSubscriptionMutationsBlocked(
  fields: VenueBillingFields,
  nowMs: number = Date.now(),
): boolean {
  const e = resolveVenueSubscriptionEntitlement(fields, nowMs);
  if (e.kind === 'free_access') return false;
  if (e.kind === 'past_due') return true;
  if (e.kind === 'expired_cancelled') return true;
  return false;
}

/**
 * Public online booking: Light + past_due (existing), or any tier when subscription access has fully expired.
 * Superuser-complimentary venues are never blocked here.
 */
export function isPublicOnlineBookingBlocked(
  fields: VenueBillingFields,
  nowMs: number = Date.now(),
): boolean {
  if (isSuperuserFreeBillingAccess(fields.billing_access_source)) {
    return false;
  }
  const tier = (fields.pricing_tier ?? '').toLowerCase();
  const plan = normalizePlanStatus(fields.plan_status);
  if (tier === 'light' && plan === 'past_due') {
    return true;
  }
  if (isExpiredCancelledAccess(fields.plan_status, fields.subscription_current_period_end, nowMs)) {
    return true;
  }
  return false;
}

/** UI / dashboard: true when the venue must resubscribe to regain paid access. */
export function isVenueSubscriptionExpiredCancelled(
  fields: VenueBillingFields,
  nowMs: number = Date.now(),
): boolean {
  return resolveVenueSubscriptionEntitlement(fields, nowMs).kind === 'expired_cancelled';
}
