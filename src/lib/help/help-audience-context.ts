import { cache } from 'react';
import type { BookingModel } from '@/types/booking-models';
import {
  activeModelsToLegacyEnabledModels,
  getDefaultBookingModelFromActive,
  resolveActiveBookingModels,
} from '@/lib/booking/active-models';
import { isVenueScheduleCalendarEligible } from '@/lib/booking/schedule-calendar-eligibility';
import { createClient } from '@/lib/supabase/server';
import { getDashboardStaff } from '@/lib/venue-auth';
import { isAppointmentPlanTier, isRestaurantTableProductTier } from '@/lib/tier-enforcement';

/** Signed-out or no venue-linked staff: full help catalogue. */
export type HelpAudienceContext =
  | { mode: 'anonymous' }
  | {
      mode: 'venue';
      venueId: string;
      pricingTier: string | null;
      bookingModel: BookingModel;
      enabledModels: BookingModel[];
      /** Show Restaurant plan help category. */
      showRestaurantHelp: boolean;
      /** Show Appointments plan help category (always for appointment SKU; restaurant only when schedule-backed models are on). */
      showAppointmentsHelp: boolean;
      /** Restaurant tier + schedule add-ons: relabel appointments help in nav. */
      hybridScheduleAddOns: boolean;
    };

function isKnownProductTier(pricingTier: string | null | undefined): boolean {
  return isRestaurantTableProductTier(pricingTier) || isAppointmentPlanTier(pricingTier);
}

/**
 * Resolve who is reading /help: anonymous (full catalogue) vs venue (filtered by tier + models).
 * Use {@link getCachedHelpAudienceContext} in the App Router so layout + pages dedupe per request.
 */
export async function getHelpAudienceContext(): Promise<HelpAudienceContext> {
  const supabase = await createClient();
  const staff = await getDashboardStaff(supabase);
  if (!staff.venue_id) {
    return { mode: 'anonymous' };
  }

  const { data: venue, error } = await staff.db
    .from('venues')
    .select('id, pricing_tier, booking_model, enabled_models, active_booking_models')
    .eq('id', staff.venue_id)
    .maybeSingle();

  if (error) {
    console.error('[getHelpAudienceContext] venue lookup failed:', error.message, { venueId: staff.venue_id });
    return { mode: 'anonymous' };
  }
  if (!venue) {
    return { mode: 'anonymous' };
  }

  const pricingTier = (venue as { pricing_tier?: string | null }).pricing_tier ?? null;
  if (!isKnownProductTier(pricingTier)) {
    return { mode: 'anonymous' };
  }

  const activeModels = resolveActiveBookingModels({
    pricingTier,
    bookingModel: venue.booking_model as BookingModel | undefined,
    enabledModels: (venue as { enabled_models?: unknown }).enabled_models,
    activeBookingModels: (venue as { active_booking_models?: unknown }).active_booking_models,
  });
  const bookingModel = getDefaultBookingModelFromActive(
    activeModels,
    (venue.booking_model as BookingModel) ?? 'table_reservation',
  );
  const enabledModels = activeModelsToLegacyEnabledModels(activeModels, bookingModel);

  const showRestaurantHelp = isRestaurantTableProductTier(pricingTier);
  const showAppointmentsHelp =
    isAppointmentPlanTier(pricingTier) ||
    (isRestaurantTableProductTier(pricingTier) && isVenueScheduleCalendarEligible(bookingModel, enabledModels));

  const hybridScheduleAddOns =
    isRestaurantTableProductTier(pricingTier) &&
    !isAppointmentPlanTier(pricingTier) &&
    isVenueScheduleCalendarEligible(bookingModel, enabledModels);

  return {
    mode: 'venue',
    venueId: staff.venue_id,
    pricingTier,
    bookingModel,
    enabledModels,
    showRestaurantHelp,
    showAppointmentsHelp,
    hybridScheduleAddOns,
  };
}

/** Dedupe `getHelpAudienceContext` within a single request (layout + pages). */
export const getCachedHelpAudienceContext = cache(getHelpAudienceContext);
