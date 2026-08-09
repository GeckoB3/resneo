import type { SupabaseClient } from '@supabase/supabase-js';
import { hasServiceConfig } from '@/lib/availability';
import type { BookingModel, VenueTerminology } from '@/types/booking-models';
import { mergeVenueTerminology } from '@/lib/dashboard/merge-venue-terminology';
import {
  getDefaultBookingModelFromActive,
  resolveActiveBookingModels,
} from '@/lib/booking/active-models';
import { activeModelsToLegacyEnabledModels } from '@/lib/booking/active-models';

export type AvailabilityEngineMode = 'legacy' | 'service';

export interface VenueMode {
  bookingModel: BookingModel;
  activeBookingModels: BookingModel[];
  /** Additional bookable models (C/D/E secondaries); excludes primary and invalid entries. */
  enabledModels: BookingModel[];
  tableManagementEnabled: boolean;
  availabilityEngine: AvailabilityEngineMode;
  terminology: VenueTerminology;
}

const venueModeCache = new Map<string, { t: number; v: VenueMode }>();
const VENUE_MODE_CACHE_TTL_MS = 30_000;

/**
 * Single resolver for venue operation mode.
 * - `activeBookingModels` lists every booking model the venue exposes.
 * - `bookingModel` is the default model used by older consumers that still expect a single value.
 * - `enabledModels` is a compatibility view of `activeBookingModels` with the default removed.
 * - `tableManagementEnabled` controls dashboard/table-management UX mode (Model A only).
 * - `availabilityEngine` controls which availability calculator to use (Model A only).
 * - `terminology` drives label substitution across UI.
 *
 * Results are cached per `venueId` for a short TTL to avoid repeated DB reads on hot API routes.
 */
export async function resolveVenueMode(
  supabase: SupabaseClient,
  venueId: string
): Promise<VenueMode> {
  const now = Date.now();
  const hit = venueModeCache.get(venueId);
  if (hit && now - hit.t < VENUE_MODE_CACHE_TTL_MS) {
    return hit.v;
  }
  const mode = await resolveVenueModeUncached(supabase, venueId);
  venueModeCache.set(venueId, { t: now, v: mode });
  return mode;
}

async function resolveVenueModeUncached(
  supabase: SupabaseClient,
  venueId: string
): Promise<VenueMode> {
  const [{ data: venue }, serviceConfigured] = await Promise.all([
    supabase
      .from('venues')
      .select('table_management_enabled, pricing_tier, booking_model, terminology, enabled_models, active_booking_models')
      .eq('id', venueId)
      .single(),
    hasServiceConfig(supabase, venueId),
  ]);

  const activeBookingModels = resolveActiveBookingModels({
    pricingTier: (venue as { pricing_tier?: string | null } | null)?.pricing_tier,
    bookingModel: (venue?.booking_model as BookingModel | undefined) ?? 'table_reservation',
    enabledModels: (venue as { enabled_models?: unknown } | null)?.enabled_models,
    activeBookingModels: (venue as { active_booking_models?: unknown } | null)?.active_booking_models,
  });
  const bookingModel = getDefaultBookingModelFromActive(
    activeBookingModels,
    ((venue?.booking_model as BookingModel | undefined) ?? 'table_reservation'),
  );
  const enabledModels = activeModelsToLegacyEnabledModels(activeBookingModels, bookingModel);
  const terminology: VenueTerminology = mergeVenueTerminology(bookingModel, venue?.terminology);

  return {
    bookingModel,
    activeBookingModels,
    enabledModels,
    tableManagementEnabled: venue?.table_management_enabled ?? false,
    availabilityEngine: serviceConfigured ? 'service' : 'legacy',
    terminology,
  };
}
