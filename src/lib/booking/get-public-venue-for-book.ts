import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveVenueMode } from '@/lib/venue-mode';
import type { VenuePublic } from '@/components/booking/types';
import { listActiveAreasForVenue } from '@/lib/areas/resolve-default-area';
import { isPublicOnlineBookingBlocked } from '@/lib/billing/subscription-entitlement';
import { mergePublicTableBookingRulesFromRestrictions } from '@/lib/booking/public-table-venue-booking-rules';

/** Loads a venue for the public /book/[slug] pages (admin client; slug is public). */
export async function getPublicVenueForBookBySlug(slug: string): Promise<VenuePublic | null> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('venues')
    .select(
      'id, name, slug, cover_photo_url, logo_url, address, phone, website_url, deposit_config, booking_rules, opening_hours, timezone, booking_model, enabled_models, active_booking_models, terminology, currency, public_booking_area_mode, pricing_tier, plan_status, subscription_current_period_end, billing_access_source',
    )
    .eq('slug', slug)
    .single();
  if (error || !data) return null;

  if (
    isPublicOnlineBookingBlocked({
      pricing_tier: (data as { pricing_tier?: string | null }).pricing_tier,
      plan_status: (data as { plan_status?: string | null }).plan_status,
      subscription_current_period_end: (data as { subscription_current_period_end?: string | null })
        .subscription_current_period_end,
      billing_access_source: (data as { billing_access_source?: string | null }).billing_access_source,
    })
  ) {
    (data as { booking_paused?: boolean }).booking_paused = true;
  }

  const venueMode = await resolveVenueMode(supabase, data.id);
  (data as VenuePublic).booking_model = venueMode.bookingModel;
  (data as VenuePublic).active_booking_models = venueMode.activeBookingModels;
  (data as VenuePublic).enabled_models = venueMode.enabledModels;
  (data as VenuePublic).terminology = venueMode.terminology;

  if (venueMode.bookingModel === 'table_reservation') {
    (data as VenuePublic).areas = await listActiveAreasForVenue(supabase, data.id);
    if (venueMode.availabilityEngine === 'service') {
      data.booking_rules = await mergePublicTableBookingRulesFromRestrictions(
        supabase,
        data.id,
        data.booking_rules,
      );
    }
  }

  return data as VenuePublic;
}
