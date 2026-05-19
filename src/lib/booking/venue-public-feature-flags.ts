import {
  parseVenueFeatureFlags,
  resolveAppointmentsFeatureFlags,
} from '@/lib/feature-flags';
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
    },
  };
}
