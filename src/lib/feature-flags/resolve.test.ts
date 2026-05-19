import { afterEach, describe, expect, it } from 'vitest';
import {
  mergeVenueFeatureFlagsPatch,
  parseVenueFeatureFlags,
  resolveAppointmentsFeatureFlag,
  resolveAppointmentsFeatureFlags,
  venueFeatureFlagsForStorage,
} from '@/lib/feature-flags/resolve';

const ENV_KEYS = {
  waitlist_v2: 'FEATURE_FLAG_WAITLIST_V2',
  guest_self_reschedule: 'FEATURE_FLAG_GUEST_SELF_RESCHEDULE',
  any_available_practitioner: 'FEATURE_FLAG_ANY_AVAILABLE_PRACTITIONER',
} as const;

describe('parseVenueFeatureFlags', () => {
  it('returns empty object for null', () => {
    expect(parseVenueFeatureFlags(null)).toEqual({});
  });

  it('drops unknown keys', () => {
    expect(parseVenueFeatureFlags({ waitlist_v2: true, foo: true })).toEqual({ waitlist_v2: true });
  });
});

describe('resolveAppointmentsFeatureFlag', () => {
  afterEach(() => {
    for (const key of Object.values(ENV_KEYS)) {
      delete process.env[key];
    }
  });

  it('defaults to false when unset', () => {
    expect(resolveAppointmentsFeatureFlag('waitlist_v2', {})).toBe(false);
    expect(resolveAppointmentsFeatureFlag('waitlist_v2', { waitlist_v2: true })).toBe(true);
  });

  it('env true forces on regardless of venue', () => {
    process.env.FEATURE_FLAG_WAITLIST_V2 = 'true';
    expect(resolveAppointmentsFeatureFlag('waitlist_v2', {})).toBe(true);
  });

  it('env false forces off regardless of venue', () => {
    process.env.FEATURE_FLAG_WAITLIST_V2 = 'false';
    expect(resolveAppointmentsFeatureFlag('waitlist_v2', { waitlist_v2: true })).toBe(false);
  });
});

describe('mergeVenueFeatureFlagsPatch', () => {
  it('removes key when set to false', () => {
    const next = mergeVenueFeatureFlagsPatch({ waitlist_v2: true }, { waitlist_v2: false });
    expect(next.waitlist_v2).toBeUndefined();
  });
});

describe('venueFeatureFlagsForStorage', () => {
  it('only persists true keys', () => {
    expect(venueFeatureFlagsForStorage({ waitlist_v2: true, guest_self_reschedule: false })).toEqual({
      waitlist_v2: true,
    });
  });
});

describe('resolveAppointmentsFeatureFlags', () => {
  it('returns all keys', () => {
    const flags = resolveAppointmentsFeatureFlags({ guest_self_reschedule: true });
    expect(flags).toMatchObject({
      waitlist_v2: false,
      guest_self_reschedule: true,
      any_available_practitioner: false,
    });
  });
});
