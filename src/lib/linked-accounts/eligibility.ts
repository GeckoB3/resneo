/** Venue eligibility checks for Linked Accounts (§3). */

import { isAppointmentPlanTier, isRestaurantTableProductTier } from '@/lib/tier-enforcement';
import { resolveVenueSubscriptionEntitlement } from '@/lib/billing/subscription-entitlement';

export interface LinkEligibilityVenue {
  pricing_tier?: string | null;
  plan_status?: string | null;
  booking_model?: string | null;
  /** Paid-through date, needed to tell an in-window cancellation from an expired one. */
  subscription_current_period_end?: string | null;
  /** `superuser_free` marks a complimentary venue with full access and no Stripe plan. */
  billing_access_source?: string | null;
}

export interface EligibilityResult {
  /** Venue may hold links at all (Appointments family, not restaurant). */
  feature: boolean;
  /**
   * Venue may create new links right now: it also needs paid-through subscription
   * access (active, on a free trial, still inside a cancellation window, or
   * superuser-complimentary). A failed payment or a fully expired plan blocks it.
   */
  canCreate: boolean;
  reason: string | null;
}

/**
 * Linked Accounts is available to Appointments-family venues only (§3). A
 * restaurant / founding (table-product) venue is **never** eligible — even if
 * its `booking_model` happens to be non-table — so we exclude those tiers first,
 * then accept the Appointments tiers (light / plus / appointments). The
 * booking-model fallback only applies once the restaurant tiers are ruled out,
 * for venues whose tier is unset/legacy but clearly not a table product.
 */
export function isLinkFeatureVenue(venue: LinkEligibilityVenue): boolean {
  if (isRestaurantTableProductTier(venue.pricing_tier)) return false;
  if (isAppointmentPlanTier(venue.pricing_tier)) return true;
  const model = (venue.booking_model ?? '').toLowerCase().trim();
  return model !== '' && model !== 'table_reservation';
}

export function evaluateLinkEligibility(
  venue: LinkEligibilityVenue,
  nowMs: number = Date.now(),
): EligibilityResult {
  if (!isLinkFeatureVenue(venue)) {
    return {
      feature: false,
      canCreate: false,
      reason: 'Linked Accounts is available to appointments-family venues only.',
    };
  }
  // Mirror the canonical subscription gate (§ effectivePlanStatus invariant) rather
  // than matching the literal 'active' string: a venue on a free trial, inside its
  // paid-through cancellation window, or comped by a superuser still has access and
  // may create/hold links. Only a failed payment or a fully expired plan blocks it.
  const { kind } = resolveVenueSubscriptionEntitlement(venue, nowMs);
  const planActive = kind === 'active_like' || kind === 'free_access';
  if (!planActive) {
    return {
      feature: true,
      canCreate: false,
      reason: 'New links cannot be created while your subscription is inactive.',
    };
  }
  return { feature: true, canCreate: true, reason: null };
}
