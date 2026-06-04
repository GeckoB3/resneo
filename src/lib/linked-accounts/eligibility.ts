/** Venue eligibility checks for Linked Accounts (§3). */

import { isAppointmentPlanTier, isRestaurantTableProductTier } from '@/lib/tier-enforcement';

export interface LinkEligibilityVenue {
  pricing_tier?: string | null;
  plan_status?: string | null;
  booking_model?: string | null;
}

export interface EligibilityResult {
  /** Venue may hold links at all (Appointments family, not restaurant). */
  feature: boolean;
  /** Venue may create new links right now (also requires an active plan). */
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

export function evaluateLinkEligibility(venue: LinkEligibilityVenue): EligibilityResult {
  if (!isLinkFeatureVenue(venue)) {
    return {
      feature: false,
      canCreate: false,
      reason: 'Linked Accounts is available to appointments-family venues only.',
    };
  }
  const planActive = (venue.plan_status ?? 'active').toLowerCase().trim() === 'active';
  if (!planActive) {
    return {
      feature: true,
      canCreate: false,
      reason: 'New links cannot be created while your subscription is inactive.',
    };
  }
  return { feature: true, canCreate: true, reason: null };
}
