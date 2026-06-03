import {
  APPOINTMENTS_FEATURE_FLAG_KEYS,
  type AppointmentsFeatureFlagKey,
  type ResolvedAppointmentsFeatureFlags,
  type VenueFeatureFlags,
  venueFeatureFlagsSchema,
} from '@/lib/feature-flags/types';

const ENV_BY_FLAG: Record<AppointmentsFeatureFlagKey, string> = {
  waitlist_v2: 'FEATURE_FLAG_WAITLIST_V2',
  guest_self_reschedule: 'FEATURE_FLAG_GUEST_SELF_RESCHEDULE',
  any_available_practitioner: 'FEATURE_FLAG_ANY_AVAILABLE_PRACTITIONER',
  class_commerce_enabled: 'FEATURE_FLAG_CLASS_COMMERCE_ENABLED',
  compliance_records_enabled: 'FEATURE_FLAG_COMPLIANCE_RECORDS_ENABLED',
};

/** Per-flag defaults when venue storage omits the key (env override still wins). */
const FLAG_DEFAULT_ON: Partial<Record<AppointmentsFeatureFlagKey, boolean>> = {
  guest_self_reschedule: true,
};

function defaultAppointmentsFeatureFlagValue(flag: AppointmentsFeatureFlagKey): boolean {
  return FLAG_DEFAULT_ON[flag] ?? false;
}

export const DEFAULT_RESOLVED_APPOINTMENTS_FEATURE_FLAGS: ResolvedAppointmentsFeatureFlags =
  APPOINTMENTS_FEATURE_FLAG_KEYS.reduce((acc, key) => {
    acc[key] = defaultAppointmentsFeatureFlagValue(key);
    return acc;
  }, {} as ResolvedAppointmentsFeatureFlags);

function parseEnvOverride(value: string | undefined): boolean | null {
  if (value === undefined || value.trim() === '') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return null;
}

/** Parse `venues.feature_flags` JSONB; invalid keys are dropped. */
export function parseVenueFeatureFlags(raw: unknown): VenueFeatureFlags {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const parsed = venueFeatureFlagsSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

/**
 * Resolve a single flag: env override wins, then explicit venue value, else per-flag default.
 * Most flags default off; `guest_self_reschedule` defaults on unless explicitly `false`.
 */
export function resolveAppointmentsFeatureFlag(
  flag: AppointmentsFeatureFlagKey,
  venueFlags?: VenueFeatureFlags | null,
): boolean {
  const envOverride = parseEnvOverride(process.env[ENV_BY_FLAG[flag]]);
  if (envOverride !== null) return envOverride;
  const venueValue = venueFlags?.[flag];
  if (venueValue === true || venueValue === false) return venueValue;
  return defaultAppointmentsFeatureFlagValue(flag);
}

export function resolveAppointmentsFeatureFlags(
  venueFlags?: VenueFeatureFlags | null,
): ResolvedAppointmentsFeatureFlags {
  const parsed = venueFlags ?? {};
  return APPOINTMENTS_FEATURE_FLAG_KEYS.reduce((acc, key) => {
    acc[key] = resolveAppointmentsFeatureFlag(key, parsed);
    return acc;
  }, {} as ResolvedAppointmentsFeatureFlags);
}

/** Normalise PATCH body: only known keys; `true` stored, `false` removes key. */
export function mergeVenueFeatureFlagsPatch(
  current: VenueFeatureFlags,
  patch: VenueFeatureFlags,
): VenueFeatureFlags {
  const next: VenueFeatureFlags = { ...current };
  for (const key of APPOINTMENTS_FEATURE_FLAG_KEYS) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value === true) {
      if (key === 'guest_self_reschedule') {
        delete next[key];
      } else {
        next[key] = true;
      }
    } else if (key === 'guest_self_reschedule') {
      next[key] = false;
    } else {
      delete next[key];
    }
  }
  if (patch.any_available_practitioner === false) {
    delete next.any_available_practitioner_config;
  } else if (patch.any_available_practitioner_config !== undefined) {
    next.any_available_practitioner_config = patch.any_available_practitioner_config;
  }
  if (patch.waitlist_config !== undefined) {
    next.waitlist_config = patch.waitlist_config;
  }
  if (patch.waitlist_v2 === false) {
    delete next.waitlist_config;
  }
  // Compliance general settings persist as a nested object independent of the
  // boolean enable flag (so settings survive toggling the feature off and on).
  if (patch.compliance !== undefined) {
    next.compliance = patch.compliance;
  }
  return next;
}

export function venueFeatureFlagsForStorage(flags: VenueFeatureFlags): Record<string, unknown> {
  const stored: Record<string, unknown> = {};
  for (const key of APPOINTMENTS_FEATURE_FLAG_KEYS) {
    if (flags[key] === true) {
      if (key !== 'guest_self_reschedule') stored[key] = true;
    } else if (key === 'guest_self_reschedule' && flags[key] === false) {
      stored[key] = false;
    }
  }
  if (
    flags.any_available_practitioner === true &&
    flags.any_available_practitioner_config
  ) {
    stored.any_available_practitioner_config = flags.any_available_practitioner_config;
  }
  if (flags.waitlist_config) {
    stored.waitlist_config = flags.waitlist_config;
  }
  if (flags.compliance) {
    stored.compliance = flags.compliance;
  }
  return stored;
}
