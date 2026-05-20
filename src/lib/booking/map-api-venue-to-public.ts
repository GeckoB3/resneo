import type { VenuePublic } from '@/components/booking/types';
import type { BookingModel } from '@/types/booking-models';
import { mapVenueFeatureFlagsForPublic } from '@/lib/booking/venue-public-feature-flags';

/** Maps GET /api/venue JSON to {@link VenuePublic} for embedded booking flows. */
export function mapApiVenueToVenuePublic(data: Record<string, unknown>): VenuePublic {
  return {
    id: data.id as string,
    name: data.name as string,
    slug: data.slug as string,
    cover_photo_url: (data.cover_photo_url as string | null) ?? null,
    logo_url: (data.logo_url as string | null) ?? null,
    address: (data.address as string | null) ?? null,
    phone: (data.phone as string | null) ?? null,
    website_url: (data.website_url as string | null) ?? undefined,
    deposit_config: data.deposit_config as VenuePublic['deposit_config'],
    booking_rules: data.booking_rules as VenuePublic['booking_rules'],
    opening_hours: data.opening_hours as VenuePublic['opening_hours'],
    timezone: typeof data.timezone === 'string' && data.timezone.trim() !== '' ? data.timezone : 'Europe/London',
    booking_model: data.booking_model as string | undefined,
    enabled_models: data.enabled_models as BookingModel[] | undefined,
    terminology: data.terminology as VenuePublic['terminology'],
    currency: data.currency as string | undefined,
    public_booking_area_mode:
      data.public_booking_area_mode === 'manual' ? 'manual' : data.public_booking_area_mode === 'auto' ? 'auto' : undefined,
    feature_flags: mapVenueFeatureFlagsForPublic(data.feature_flags),
    require_account_login_for_bookings:
      data.require_account_login_for_bookings === true ? true : undefined,
  };
}
