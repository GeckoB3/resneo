import { isSuperuserFreeBillingAccess } from '@/lib/billing/billing-access-source';
import { effectivePlanStatus } from '@/lib/billing/subscription-entitlement';
import { isAppointmentPlanTier } from '@/lib/tier-enforcement';

/** The venue columns the platform overview cards are computed from. */
export interface SuperKpiVenueRow {
  id: string;
  pricing_tier?: string | null;
  plan_status?: string | null;
  subscription_current_period_end?: string | null;
  billing_access_source?: string | null;
  is_test?: boolean | null;
}

export interface SuperKpis {
  /** Non-test venues that are still customers: paying, trialing, past due, or on complimentary access. */
  liveVenues: number;
  /** Effective status `active`, and not on complimentary access (those are not paying). */
  paying: number;
  trialing: number;
  pastDue: number;
  /** Effective status `cancelled` or `cancelling` (a `cancelling` row past its period end reads as cancelled). */
  cancelled: number;
  /** Complimentary (superuser-granted) access, whatever the stored plan status says. */
  freeAccess: number;
  /** Live venues on an appointments tier (Light, Plus, Pro). */
  appointmentsPlans: number;
  /** Live venues on the Restaurant or Founding Partner tier. */
  restaurantFounding: number;
  testVenues: number;
  staffLogins: number;
}

function normalizeTier(raw: string | null | undefined): string {
  return (raw ?? '').toLowerCase().trim();
}

/**
 * The platform overview numbers.
 *
 * "Live" used to mean every venue that was not flagged as a test venue, so the
 * twelve cancelled venues were counted as live and the headline drifted from
 * what the operator meant by it. A live venue is one that is still a customer:
 * paying, trialing, past due (a failed payment is not a cancellation), or on
 * complimentary access. Cancelled and cancelling venues are not live.
 *
 * Status is read through `effectivePlanStatus`, so a `cancelling` row whose
 * paid period has already ended (a missed Stripe webhook) counts as cancelled.
 * The plan-tier cards split the live venues, so the two tier numbers add up to
 * the headline; the four status cards split every non-test venue, so with the
 * complimentary venues they add up to the non-test total.
 */
export function computeSuperKpis(
  venues: SuperKpiVenueRow[],
  staffLogins: number,
  nowMs: number = Date.now(),
): SuperKpis {
  const out: SuperKpis = {
    liveVenues: 0,
    paying: 0,
    trialing: 0,
    pastDue: 0,
    cancelled: 0,
    freeAccess: 0,
    appointmentsPlans: 0,
    restaurantFounding: 0,
    testVenues: 0,
    staffLogins,
  };

  for (const v of venues) {
    if (v.is_test) {
      out.testVenues++;
      continue;
    }

    const free = isSuperuserFreeBillingAccess(v.billing_access_source);
    const status = effectivePlanStatus(v.plan_status, v.subscription_current_period_end, nowMs);
    const cancelled = status === 'cancelled' || status === 'cancelling';

    if (free) out.freeAccess++;
    else if (status === 'active') out.paying++;
    else if (status === 'trialing') out.trialing++;
    else if (status === 'past_due') out.pastDue++;
    else if (cancelled) out.cancelled++;

    const live = free || !cancelled;
    if (!live) continue;
    out.liveVenues++;

    const tier = normalizeTier(v.pricing_tier);
    if (isAppointmentPlanTier(tier)) out.appointmentsPlans++;
    else if (tier === 'restaurant' || tier === 'founding') out.restaurantFounding++;
  }

  return out;
}
