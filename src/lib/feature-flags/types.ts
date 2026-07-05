import { z } from 'zod';
import { anyAvailablePractitionerConfigSchema } from '@/lib/feature-flags/any-available-practitioner-config';
import { waitlistConfigSchema } from '@/lib/booking/waitlist-config';
import { complianceConfigSchema } from '@/lib/compliance/config';

/**
 * Appointments Phase 0 / 1a rollout flags (P0.3).
 * Keys use snake_case; env vars use SCREAMING_SNAKE (see resolve.ts).
 */
export const APPOINTMENTS_FEATURE_FLAG_KEYS = [
  'waitlist_v2',
  'guest_self_reschedule',
  'any_available_practitioner',
  'class_commerce_enabled',
  'compliance_records_enabled',
  'card_hold_deposits',
] as const;

export type AppointmentsFeatureFlagKey = (typeof APPOINTMENTS_FEATURE_FLAG_KEYS)[number];

/** Stored on `venues.feature_flags` — most flags persist only `true`; omitted = off. `guest_self_reschedule` persists explicit `false`; omitted = on. */
export const venueFeatureFlagsSchema = z
  .object({
    waitlist_v2: z.boolean().optional(),
    waitlist_config: waitlistConfigSchema.optional(),
    guest_self_reschedule: z.boolean().optional(),
    any_available_practitioner: z.boolean().optional(),
    any_available_practitioner_config: anyAvailablePractitionerConfigSchema.optional(),
    class_commerce_enabled: z.boolean().optional(),
    compliance_records_enabled: z.boolean().optional(),
    compliance: complianceConfigSchema.optional(),
    card_hold_deposits: z.boolean().optional(),
  })
  .strip();

export type VenueFeatureFlags = z.infer<typeof venueFeatureFlagsSchema>;

export type ResolvedAppointmentsFeatureFlags = Record<AppointmentsFeatureFlagKey, boolean>;
