import { z } from 'zod';
import { anyAvailablePractitionerConfigSchema } from '@/lib/feature-flags/any-available-practitioner-config';

/**
 * Appointments Phase 0 / 1a rollout flags (P0.3).
 * Keys use snake_case; env vars use SCREAMING_SNAKE (see resolve.ts).
 */
export const APPOINTMENTS_FEATURE_FLAG_KEYS = [
  'waitlist_v2',
  'guest_self_reschedule',
  'any_available_practitioner',
] as const;

export type AppointmentsFeatureFlagKey = (typeof APPOINTMENTS_FEATURE_FLAG_KEYS)[number];

/** Stored on `venues.feature_flags` — only `true` keys are persisted; omitted = off. */
export const venueFeatureFlagsSchema = z
  .object({
    waitlist_v2: z.boolean().optional(),
    guest_self_reschedule: z.boolean().optional(),
    any_available_practitioner: z.boolean().optional(),
    any_available_practitioner_config: anyAvailablePractitionerConfigSchema.optional(),
  })
  .strip();

export type VenueFeatureFlags = z.infer<typeof venueFeatureFlagsSchema>;

export type ResolvedAppointmentsFeatureFlags = Record<AppointmentsFeatureFlagKey, boolean>;
