/**
 * Canonical public booking tab slugs (?tab=) - Docs/Resneo_Unified_Booking_Functionality.md Appendix A.
 * Used by /book/[slug], embed iframe, and support links; keep in sync everywhere.
 */

import type { BookingModel } from '@/types/booking-models';
import {
  getDefaultBookingModelFromActive,
  resolveActiveBookingModels,
  VENUE_ACTIVE_MODEL_ORDER,
} from '@/lib/booking/active-models';
import type { VenueTerminology } from '@/types/booking-models';
import { DEFAULT_TERMINOLOGY } from '@/types/booking-models';

export const PUBLIC_BOOK_TAB_SLUGS = [
  'tables',
  'appointments',
  'events',
  'classes',
  'resources',
] as const;

export type PublicBookTabSlug = (typeof PUBLIC_BOOK_TAB_SLUGS)[number];

const SLUG_SET = new Set<string>(PUBLIC_BOOK_TAB_SLUGS);

export function isPublicBookTabSlug(s: string | null | undefined): s is PublicBookTabSlug {
  return s != null && s !== '' && SLUG_SET.has(s);
}

/** Maps booking model to URL tab slug (one canonical slug per model). */
export const BOOKING_MODEL_TO_PUBLIC_TAB: Record<BookingModel, PublicBookTabSlug> = {
  table_reservation: 'tables',
  practitioner_appointment: 'appointments',
  unified_scheduling: 'appointments',
  event_ticket: 'events',
  class_session: 'classes',
  resource_booking: 'resources',
};

export interface PublicBookTabDef {
  slug: PublicBookTabSlug;
  /** Short label for tab UI */
  label: string;
  bookingModel: BookingModel;
}

function labelForModel(m: BookingModel, terminology: Partial<VenueTerminology> | null | undefined): string {
  /**
   * Merge venue overrides with the defaults for the model being labelled (not the venue primary).
   * Do not apply venue-wide `terminology.booking` to appointment surfaces: many venues set `booking` to
   * "Reservation" for the table tab, which must not relabel the Appointments tab.
   */
  const defaults = DEFAULT_TERMINOLOGY[m];
  const venue = terminology && typeof terminology === 'object' ? terminology : undefined;
  const t: VenueTerminology =
    m === 'table_reservation'
      ? { ...defaults, ...venue }
      : {
          ...defaults,
          ...(venue
            ? {
                client: venue.client ?? defaults.client,
                staff: venue.staff ?? defaults.staff,
              }
            : {}),
          booking: defaults.booking,
        };
  switch (m) {
    case 'table_reservation':
      return t.booking === 'Reservation' ? 'Tables' : t.booking;
    case 'practitioner_appointment':
    case 'unified_scheduling':
      return t.booking === 'Appointment' ? 'Appointment' : t.booking;
    case 'event_ticket':
      return 'Events';
    case 'class_session':
      return 'Classes';
    case 'resource_booking':
      return 'Resources';
    default:
      return m;
  }
}

/**
 * Ordered tab definitions for a venue. Stable order follows the canonical active-model order.
 */
export function publicBookTabsForVenue(
  activeModels: BookingModel[],
  terminology?: Partial<VenueTerminology> | null
): PublicBookTabDef[] {
  const venueTermOverrides =
    terminology && typeof terminology === 'object' ? terminology : undefined;
  const models = new Set<BookingModel>(activeModels);
  const ordered = VENUE_ACTIVE_MODEL_ORDER.filter((m) => models.has(m));
  const out: PublicBookTabDef[] = [];
  for (const m of ordered) {
    out.push({
      slug: BOOKING_MODEL_TO_PUBLIC_TAB[m],
      label: labelForModel(m, venueTermOverrides),
      bookingModel: m,
    });
  }
  return out;
}

/** Default tab slug for a venue (first active model in canonical order). */
export function defaultPublicBookTabSlug(activeModels: BookingModel[]): PublicBookTabSlug {
  const model = getDefaultBookingModelFromActive(activeModels);
  return BOOKING_MODEL_TO_PUBLIC_TAB[model] ?? 'tables';
}

/**
 * Validates `?tab=` against exposed models; falls back to the venue default.
 */
export function resolvePublicBookTabFromQuery(
  tabParam: string | null | undefined,
  activeModels: BookingModel[],
  terminology?: Partial<VenueTerminology> | null
): PublicBookTabSlug {
  const tabs = publicBookTabsForVenue(activeModels, terminology);
  if (tabs.length <= 1) {
    return defaultPublicBookTabSlug(activeModels);
  }
  if (tabParam && tabs.some((t) => t.slug === tabParam) && isPublicBookTabSlug(tabParam)) {
    return tabParam;
  }
  return defaultPublicBookTabSlug(activeModels);
}

export function publicBookTabsFromVenueShape(venue: {
  booking_model?: string | null;
  enabled_models?: unknown;
  active_booking_models?: unknown;
  pricing_tier?: string | null;
  terminology?: Partial<VenueTerminology> | null;
}): PublicBookTabDef[] {
  const activeModels = resolveActiveBookingModels({
    pricingTier: venue.pricing_tier,
    bookingModel: venue.booking_model,
    enabledModels: venue.enabled_models,
    activeBookingModels: venue.active_booking_models,
  });
  return publicBookTabsForVenue(activeModels, venue.terminology);
}
