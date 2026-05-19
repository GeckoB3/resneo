import { describe, expect, it } from 'vitest';
import { mapVenueFeatureFlagsForPublic } from '@/lib/booking/venue-public-feature-flags';

describe('mapVenueFeatureFlagsForPublic', () => {
  it('passes through GET /api/venue resolved payload', () => {
    const result = mapVenueFeatureFlagsForPublic({
      raw: { waitlist_v2: true },
      resolved: {
        any_available_practitioner: true,
        guest_self_reschedule: false,
        waitlist_v2: true,
      },
    });
    expect(result).toEqual({
      resolved: {
        any_available_practitioner: true,
        guest_self_reschedule: false,
        waitlist_v2: true,
      },
    });
  });

  it('resolves from DB JSON storage', () => {
    const result = mapVenueFeatureFlagsForPublic({ any_available_practitioner: true });
    expect(result?.resolved?.any_available_practitioner).toBe(true);
    expect(result?.resolved?.waitlist_v2).toBe(false);
  });

  it('returns undefined for null', () => {
    expect(mapVenueFeatureFlagsForPublic(null)).toBeUndefined();
  });
});
