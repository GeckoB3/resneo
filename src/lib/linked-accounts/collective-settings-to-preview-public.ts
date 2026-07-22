import type { VenuePublic } from '@/components/booking/types';
import type { BookingPageConfig } from '@/lib/booking/booking-page-theme';

/**
 * Client-side mirror of `loadCollectiveVenuePublic` (server) for the inline live preview:
 * builds a synthetic public venue from the editor's draft branding + the collective's
 * identity, so the shared `<InlineBookingPreview>` renders exactly the combined page.
 * Commercial defaults (deposit/rules/terminology) are omitted — the preview is about look.
 */
export function collectiveSettingsToPreviewPublic(args: {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  coverUrl: string | null;
  timezone: string | null;
  draftConfig: BookingPageConfig;
  /** The host venue's "Any available practitioner" setting, which the combined page follows. */
  anyAvailablePractitioner: boolean;
}): VenuePublic {
  const { id, name, slug, logoUrl, coverUrl, timezone, draftConfig, anyAvailablePractitioner } = args;
  return {
    id,
    name,
    slug,
    cover_photo_url: coverUrl ?? null,
    logo_url: logoUrl ?? null,
    address: null,
    phone: null,
    website_url: null,
    booking_page_config: draftConfig,
    deposit_config: null,
    booking_rules: null,
    opening_hours: null,
    timezone: timezone ?? 'Europe/London',
    booking_model: 'unified_scheduling',
    active_booking_models: ['unified_scheduling'],
    enabled_models: [],
    terminology: undefined,
    currency: 'GBP',
    booking_paused: false,
    is_collective: true,
    feature_flags: { resolved: { any_available_practitioner: anyAvailablePractitioner } },
  };
}
