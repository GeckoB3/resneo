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
};

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
 * Resolve a single flag: env override wins, then per-venue `true`, else default false.
 */
export function resolveAppointmentsFeatureFlag(
  flag: AppointmentsFeatureFlagKey,
  venueFlags?: VenueFeatureFlags | null,
): boolean {
  const envOverride = parseEnvOverride(process.env[ENV_BY_FLAG[flag]]);
  if (envOverride !== null) return envOverride;
  return venueFlags?.[flag] === true;
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
      next[key] = true;
    } else {
      delete next[key];
    }
  }
  return next;
}

export function venueFeatureFlagsForStorage(flags: VenueFeatureFlags): Record<string, boolean> {
  const stored: Record<string, boolean> = {};
  for (const key of APPOINTMENTS_FEATURE_FLAG_KEYS) {
    if (flags[key] === true) stored[key] = true;
  }
  return stored;
}
