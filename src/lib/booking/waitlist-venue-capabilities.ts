import type { BookingModel } from '@/types/booking-models';
import {
  activeModelsToLegacyEnabledModels,
  appointmentPlanDefaultModels,
  getDefaultBookingModelFromActive,
  resolveActiveBookingModels,
} from '@/lib/booking/active-models';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import { isAppointmentPlanTier, isRestaurantTableProductTier } from '@/lib/tier-enforcement';

export type WaitlistKindFilter = 'all' | 'table' | 'appointment';

export interface WaitlistVenueCapabilities {
  showTableWaitlist: boolean;
  showAppointmentWaitlist: boolean;
  /** True when both table and appointment waitlists are available (hybrid restaurant). */
  showKindTabs: boolean;
  defaultKindFilter: WaitlistKindFilter;
}

export interface ResolveWaitlistVenueCapabilitiesInput {
  pricingTier?: string | null;
  bookingModel?: BookingModel | string | null;
  enabledModels?: unknown;
  activeBookingModels?: unknown;
  /** When true, empty `active_booking_models` on Appointments tier defaults to USE. */
  onboardingCompleted?: boolean;
}

function venueHasUnifiedAppointments(
  primary: BookingModel,
  enabledModels: readonly BookingModel[],
): boolean {
  if (isUnifiedSchedulingVenue(primary)) return true;
  return enabledModels.includes('unified_scheduling');
}

/**
 * Which waitlist kinds a venue may view and manage on `/dashboard/waitlist`.
 *
 * - Appointments plan: appointment waitlist only (no table/dining).
 * - Restaurant plan, table only: table waitlist only.
 * - Restaurant + unified scheduling secondary: both, with kind tabs.
 */
export function resolveWaitlistVenueCapabilities(
  input: ResolveWaitlistVenueCapabilitiesInput,
): WaitlistVenueCapabilities {
  let activeModels = resolveActiveBookingModels({
    pricingTier: input.pricingTier,
    bookingModel: input.bookingModel,
    enabledModels: input.enabledModels,
    activeBookingModels: input.activeBookingModels,
  });

  if (
    isAppointmentPlanTier(input.pricingTier) &&
    activeModels.length === 0 &&
    input.onboardingCompleted !== false
  ) {
    activeModels = appointmentPlanDefaultModels();
  }

  const primary = getDefaultBookingModelFromActive(
    activeModels,
    (input.bookingModel as BookingModel) ?? 'table_reservation',
  );
  const enabledModels = activeModelsToLegacyEnabledModels(activeModels, primary);

  const isRestaurantProduct = isRestaurantTableProductTier(input.pricingTier);
  const isAppointmentsProduct = isAppointmentPlanTier(input.pricingTier);

  const showTableWaitlist =
    isRestaurantProduct &&
    (primary === 'table_reservation' || activeModels.includes('table_reservation'));

  const showAppointmentWaitlist = isAppointmentsProduct
    ? true
    : isRestaurantProduct && venueHasUnifiedAppointments(primary, enabledModels);

  const showKindTabs = showTableWaitlist && showAppointmentWaitlist;

  let defaultKindFilter: WaitlistKindFilter = 'all';
  if (showTableWaitlist && !showAppointmentWaitlist) {
    defaultKindFilter = 'table';
  } else if (showAppointmentWaitlist && !showTableWaitlist) {
    defaultKindFilter = 'appointment';
  }

  return {
    showTableWaitlist,
    showAppointmentWaitlist,
    showKindTabs,
    defaultKindFilter,
  };
}

export function isWaitlistKindAllowed(
  capabilities: WaitlistVenueCapabilities,
  kind: 'table' | 'appointment',
): boolean {
  return kind === 'table' ? capabilities.showTableWaitlist : capabilities.showAppointmentWaitlist;
}

export function normalizeWaitlistKindQuery(
  capabilities: WaitlistVenueCapabilities,
  kindParam: string | null,
): 'table' | 'appointment' | null {
  if (kindParam === 'table' || kindParam === 'appointment') {
    if (!isWaitlistKindAllowed(capabilities, kindParam)) {
      return null;
    }
    return kindParam;
  }

  if (!capabilities.showKindTabs) {
    if (capabilities.showTableWaitlist && !capabilities.showAppointmentWaitlist) {
      return 'table';
    }
    if (capabilities.showAppointmentWaitlist && !capabilities.showTableWaitlist) {
      return 'appointment';
    }
  }

  return null;
}
