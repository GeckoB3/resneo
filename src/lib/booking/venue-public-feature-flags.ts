import {
  parseVenueFeatureFlags,
  resolveAppointmentsFeatureFlags,
} from '@/lib/feature-flags';
import { parseAnyAvailablePractitionerConfig } from '@/lib/feature-flags/any-available-practitioner-config';
import type { VenuePublic } from '@/components/booking/types';

/**
 * Maps venue feature flag storage or GET /api/venue payload into {@link VenuePublic.feature_flags}.
 */
export function mapVenueFeatureFlagsForPublic(
  source: unknown,
): VenuePublic['feature_flags'] | undefined {
  if (source == null) {
    return undefined;
  }

  if (typeof source === 'object' && source !== null && 'resolved' in source) {
    const resolved = (
      source as {
        resolved?: NonNullable<VenuePublic['feature_flags']>['resolved'];
      }
    ).resolved;
    if (resolved && typeof resolved === 'object') {
      return { resolved };
    }
  }

  const raw =
    typeof source === 'object' && source !== null && 'raw' in source
      ? parseVenueFeatureFlags((source as { raw: unknown }).raw)
      : parseVenueFeatureFlags(source);

  const resolved = resolveAppointmentsFeatureFlags(raw);
  return {
    resolved: {
      any_available_practitioner: resolved.any_available_practitioner,
      guest_self_reschedule: resolved.guest_self_reschedule,
      waitlist_v2: resolved.waitlist_v2,
      // Staff surfaces gate the "Card hold" toggle on the owner venue's flag
      // (design doc 7.6 / D6). This mapper serves staff venue payloads
      // (GET /api/venue via mapApiVenueToVenuePublic, the linked-calendar
      // venue-profile route, buildVenuePublicForBookingById); the public
      // /api/booking/venue route builds its own resolved object and does not
      // expose this flag.
      card_hold_deposits: resolved.card_hold_deposits,
    },
    any_available_practitioner_config: parseAnyAvailablePractitionerConfig(raw),
  };
}
