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
  staff_first_booking_flow: 'FEATURE_FLAG_STAFF_FIRST_BOOKING_FLOW',
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

  it('defaults card_hold_deposits to false when unset (not in FLAG_DEFAULT_ON)', () => {
    expect(resolveAppointmentsFeatureFlag('card_hold_deposits', {})).toBe(false);
    expect(resolveAppointmentsFeatureFlag('card_hold_deposits', { card_hold_deposits: true })).toBe(true);
  });

  it('defaults guest_self_reschedule to true when unset', () => {
    expect(resolveAppointmentsFeatureFlag('guest_self_reschedule', {})).toBe(true);
    expect(resolveAppointmentsFeatureFlag('guest_self_reschedule', { guest_self_reschedule: false })).toBe(
      false,
    );
  });

  it('defaults staff_first_booking_flow to false when unset (service-first stays the default)', () => {
    expect(resolveAppointmentsFeatureFlag('staff_first_booking_flow', {})).toBe(false);
    expect(
      resolveAppointmentsFeatureFlag('staff_first_booking_flow', { staff_first_booking_flow: true }),
    ).toBe(true);
  });

  it('env override wins both ways for staff_first_booking_flow', () => {
    process.env.FEATURE_FLAG_STAFF_FIRST_BOOKING_FLOW = 'true';
    expect(resolveAppointmentsFeatureFlag('staff_first_booking_flow', {})).toBe(true);
    process.env.FEATURE_FLAG_STAFF_FIRST_BOOKING_FLOW = 'false';
    expect(
      resolveAppointmentsFeatureFlag('staff_first_booking_flow', { staff_first_booking_flow: true }),
    ).toBe(false);
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

  it('persists guest_self_reschedule false when turned off', () => {
    const next = mergeVenueFeatureFlagsPatch({}, { guest_self_reschedule: false });
    expect(next.guest_self_reschedule).toBe(false);
  });

  it('clears guest_self_reschedule override when turned on', () => {
    const next = mergeVenueFeatureFlagsPatch(
      { guest_self_reschedule: false },
      { guest_self_reschedule: true },
    );
    expect(next.guest_self_reschedule).toBeUndefined();
  });

  it('leaves flag on when patch omits the key', () => {
    const next = mergeVenueFeatureFlagsPatch(
      { any_available_practitioner: true },
      { any_available_practitioner_config: { mode: 'priority', calendar_order: [] } },
    );
    expect(next.any_available_practitioner).toBe(true);
  });

  it('clears any-available config when the flag is turned off', () => {
    const next = mergeVenueFeatureFlagsPatch(
      {
        any_available_practitioner: true,
        any_available_practitioner_config: { mode: 'random', calendar_order: [] },
      },
      { any_available_practitioner: false },
    );
    expect(next.any_available_practitioner).toBeUndefined();
    expect(next.any_available_practitioner_config).toBeUndefined();
  });
});

describe('venueFeatureFlagsForStorage', () => {
  it('only persists true keys', () => {
    expect(venueFeatureFlagsForStorage({ waitlist_v2: true, guest_self_reschedule: false })).toEqual({
      waitlist_v2: true,
      guest_self_reschedule: false,
    });
  });

  it('omits guest_self_reschedule when on by default', () => {
    expect(venueFeatureFlagsForStorage({ guest_self_reschedule: true })).toEqual({});
  });

  it('round-trips staff_first_booking_flow: true stored, false dropped', () => {
    expect(venueFeatureFlagsForStorage({ staff_first_booking_flow: true })).toEqual({
      staff_first_booking_flow: true,
    });
    const off = mergeVenueFeatureFlagsPatch(
      { staff_first_booking_flow: true },
      { staff_first_booking_flow: false },
    );
    expect(off.staff_first_booking_flow).toBeUndefined();
    expect(venueFeatureFlagsForStorage(off)).toEqual({});
  });

  it('does not persist any-available config when the flag is off', () => {
    expect(
      venueFeatureFlagsForStorage({
        any_available_practitioner_config: { mode: 'priority', calendar_order: [] },
      }),
    ).toEqual({});
  });
});

describe('resolveAppointmentsFeatureFlags', () => {
  it('returns all keys', () => {
    const flags = resolveAppointmentsFeatureFlags({ guest_self_reschedule: true });
    expect(flags).toMatchObject({
      waitlist_v2: false,
      guest_self_reschedule: true,
      any_available_practitioner: false,
      card_hold_deposits: false,
      staff_first_booking_flow: false,
    });
  });
});
