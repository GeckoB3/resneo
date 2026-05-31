import type { VenuePublic, OpeningHours } from '@/components/booking/types';
import type { BookingPageConfig } from '@/lib/booking/booking-page-theme';
import type { VenueSettings } from '@/app/dashboard/settings/types';
import { mapVenueFeatureFlagsForPublic } from '@/lib/booking/venue-public-feature-flags';

/** Map dashboard venue settings + draft branding into the public booking page shape. */
export function venueSettingsToPreviewPublic(
  venue: VenueSettings,
  bookingPageConfig: BookingPageConfig,
  options?: { slug?: string },
): VenuePublic {
  const deposit = venue.deposit_config;
  const rules = venue.booking_rules;

  return {
    id: venue.id,
    name: venue.name,
    slug: options?.slug?.trim() || venue.slug,
    cover_photo_url: venue.cover_photo_url,
    logo_url: venue.logo_url,
    address: venue.address,
    phone: venue.phone,
    website_url: venue.website_url,
    booking_page_config: bookingPageConfig,
    deposit_config: deposit
      ? {
          enabled: deposit.enabled,
          amount_per_person_gbp: deposit.amount_per_person_gbp,
          online_requires_deposit: deposit.online_requires_deposit,
          min_party_size_for_deposit: deposit.min_party_size_for_deposit,
          weekend_only: deposit.weekend_only,
        }
      : null,
    booking_rules: rules
      ? {
          min_party_size: rules.min_party_size,
          max_party_size: rules.max_party_size,
          max_advance_booking_days: rules.max_advance_booking_days,
          cancellation_notice_hours: rules.cancellation_notice_hours,
          allow_same_day_booking: rules.allow_same_day_booking,
        }
      : null,
    opening_hours: (venue.opening_hours as OpeningHours | null) ?? null,
    timezone: venue.timezone,
    currency: 'GBP',
    booking_model: venue.booking_model,
    active_booking_models: venue.active_booking_models,
    enabled_models: venue.enabled_models,
    public_booking_area_mode: venue.public_booking_area_mode,
    require_account_login_for_bookings: venue.require_account_login_for_bookings,
    feature_flags: mapVenueFeatureFlagsForPublic(
      venue.feature_flags_resolved ?? venue.feature_flags,
    ),
  };
}
