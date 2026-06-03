import { z } from 'zod';

/**
 * Venue-level compliance general settings.
 *
 * Persisted in `venues.feature_flags.compliance` (a nested object alongside the
 * boolean `compliance_records_enabled` flag). See spec §3.3 (General settings)
 * and §14.2. All fields carry sensible defaults so an absent/partial object
 * resolves to a complete config.
 */

export const COMPLIANCE_DEFAULT_CAPTURE_METHODS = ['staff_in_venue', 'client_online', 'both'] as const;
export type ComplianceDefaultCaptureMethod = (typeof COMPLIANCE_DEFAULT_CAPTURE_METHODS)[number];

export const COMPLIANCE_FORM_LINK_CHANNELS = ['email', 'sms', 'both'] as const;
export type ComplianceFormLinkChannel = (typeof COMPLIANCE_FORM_LINK_CHANNELS)[number];

/** v1 only supports `warn_only`; `block_check_in` is deferred to v2 (no check-in scan surface yet). */
export const COMPLIANCE_INCOMPLETE_BEHAVIOURS = ['warn_only'] as const;
export type ComplianceIncompleteBehaviour = (typeof COMPLIANCE_INCOMPLETE_BEHAVIOURS)[number];

/** Platform default form-link expiry when neither type nor venue overrides it (spec §4.6). */
export const COMPLIANCE_PLATFORM_DEFAULT_LINK_EXPIRY_DAYS = 14;

export const complianceConfigSchema = z
  .object({
    /** Default capture method pre-selected when creating a new type. */
    default_capture_method: z.enum(COMPLIANCE_DEFAULT_CAPTURE_METHODS).default('both'),
    /** Default channel for sending form links. */
    default_form_link_channel: z.enum(COMPLIANCE_FORM_LINK_CHANNELS).default('email'),
    /** Days before a record's expiry to remind the client (0 = no reminder). */
    reminder_cadence_days: z.number().int().min(0).max(90).default(7),
    /** Hours before a booking the client must complete required forms (default applied to new requirements). */
    lock_period_hours: z.number().int().min(0).max(720).default(0),
    /** Venue-level form-link expiry override (days). Per-type override still wins. */
    form_link_expiry_days: z
      .number()
      .int()
      .min(1)
      .max(90)
      .default(COMPLIANCE_PLATFORM_DEFAULT_LINK_EXPIRY_DAYS),
    /** Auto-send a form link when a booking is created with an unmet online-capturable requirement. */
    auto_send_on_booking: z.boolean().default(false),
    /** Behaviour when a client arrives with an incomplete required form. */
    incomplete_behaviour: z.enum(COMPLIANCE_INCOMPLETE_BEHAVIOURS).default('warn_only'),
  })
  .strip();

export type ComplianceConfig = z.infer<typeof complianceConfigSchema>;

/** Fully-defaulted config (all keys present). */
export const DEFAULT_COMPLIANCE_CONFIG: ComplianceConfig = complianceConfigSchema.parse({});

/**
 * Resolve the venue's compliance config from feature flags, filling defaults for
 * any missing keys. Reads `compliance` defensively as unknown so a partial or
 * malformed stored sub-object yields the full defaults rather than throwing.
 */
export function parseComplianceConfig(
  flags: { compliance?: unknown } | null | undefined,
): ComplianceConfig {
  const raw = flags?.compliance;
  if (raw == null) return { ...DEFAULT_COMPLIANCE_CONFIG };
  const parsed = complianceConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...DEFAULT_COMPLIANCE_CONFIG };
}

/**
 * Resolve the effective form-link expiry in days for a type, in priority order
 * (spec §4.6): per-type override → venue general setting → platform default (14).
 */
export function resolveFormLinkExpiryDays(
  typeOverrideDays: number | null | undefined,
  config: ComplianceConfig,
): number {
  if (typeof typeOverrideDays === 'number' && typeOverrideDays > 0) return typeOverrideDays;
  if (typeof config.form_link_expiry_days === 'number' && config.form_link_expiry_days > 0) {
    return config.form_link_expiry_days;
  }
  return COMPLIANCE_PLATFORM_DEFAULT_LINK_EXPIRY_DAYS;
}
