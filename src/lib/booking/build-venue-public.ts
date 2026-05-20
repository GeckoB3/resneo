import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveVenueMode } from '@/lib/venue-mode';
import type { VenuePublic } from '@/components/booking/types';
import {
  maxAdvanceDaysFromVenueBookingRulesJson,
  mergePublicTableBookingRulesFromRestrictions,
} from '@/lib/booking/public-table-venue-booking-rules';
import { mapVenueFeatureFlagsForPublic } from '@/lib/booking/venue-public-feature-flags';

/**
 * Builds the same public booking profile shape as GET /api/booking/venue?slug=…, but by venue id.
 * Used by dashboard server pages that embed public booking flows.
 */
export async function buildVenuePublicForBookingById(venueId: string): Promise<VenuePublic | null> {
  const supabase = getSupabaseAdminClient();
  const { data: venue, error } = await supabase
    .from('venues')
    .select(
      'id, name, slug, cover_photo_url, address, phone, website_url, deposit_config, booking_rules, opening_hours, timezone, booking_model, enabled_models, active_booking_models, terminology, currency, feature_flags, require_account_login_for_bookings',
    )
    .eq('id', venueId)
    .single();

  if (error || !venue) {
    return null;
  }

  const venueMode = await resolveVenueMode(supabase, venue.id);

  let booking_rules = venue.booking_rules as VenuePublic['booking_rules'];
  if (venueMode.bookingModel === 'table_reservation') {
    const usesNewEngine = venueMode.availabilityEngine === 'service';
    if (usesNewEngine) {
      booking_rules = await mergePublicTableBookingRulesFromRestrictions(
        supabase,
        venue.id,
        venue.booking_rules,
      );
    } else {
      const raw = (venue.booking_rules && typeof venue.booking_rules === 'object'
        ? { ...(venue.booking_rules as Record<string, unknown>) }
        : {}) as Record<string, unknown>;
      if (raw.max_advance_booking_days == null || typeof raw.max_advance_booking_days !== 'number') {
        raw.max_advance_booking_days = maxAdvanceDaysFromVenueBookingRulesJson(venue.booking_rules);
      }
      booking_rules = raw as unknown as VenuePublic['booking_rules'];
    }
  }

  return {
    ...(venue as unknown as VenuePublic),
    booking_rules,
    booking_model: venueMode.bookingModel,
    active_booking_models: venueMode.activeBookingModels,
    enabled_models: venueMode.enabledModels,
    terminology: venueMode.terminology,
    feature_flags: mapVenueFeatureFlagsForPublic(
      (venue as { feature_flags?: unknown }).feature_flags,
    ),
  };
}
