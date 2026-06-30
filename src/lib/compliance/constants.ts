/**
 * Shared finite-value sets for the compliance domain. Mirrors the CHECK
 * constraints in 20261203120000_compliance_records.sql. Keep in sync with the
 * migration — these are the single TS source for the same values.
 */

export const COMPLIANCE_CATEGORIES = ['test', 'consent', 'intake', 'declaration', 'certificate'] as const;
export type ComplianceCategory = (typeof COMPLIANCE_CATEGORIES)[number];

/** Methods a type can be captured by (stored in `compliance_types.capture_methods`). */
export const COMPLIANCE_CAPTURE_METHODS = ['staff_in_venue', 'client_online'] as const;
export type ComplianceCaptureMethod = (typeof COMPLIANCE_CAPTURE_METHODS)[number];

/** How a single record was captured (`compliance_records.capture_channel`). */
export const COMPLIANCE_CAPTURE_CHANNELS = [
  'staff_web',
  'staff_mobile',
  'client_email',
  'client_sms',
  'client_walkin',
  'client_booking',
  'import',
] as const;
export type ComplianceCaptureChannel = (typeof COMPLIANCE_CAPTURE_CHANNELS)[number];

/**
 * Where a client-online requirement's form is offered during online booking
 * (`service_compliance_requirements.online_collection`, spec §9.3):
 *   inline            — rendered as a step in the booking flow
 *   confirmation_link — link carried in the booking confirmation email
 *   none              — not surfaced to the guest online (staff handle it)
 */
export const COMPLIANCE_ONLINE_COLLECTION_MODES = ['inline', 'confirmation_link', 'none'] as const;
export type ComplianceOnlineCollection = (typeof COMPLIANCE_ONLINE_COLLECTION_MODES)[number];

export const COMPLIANCE_RECORD_STATUSES = ['completed', 'expired', 'voided'] as const;
export type ComplianceRecordStatus = (typeof COMPLIANCE_RECORD_STATUSES)[number];

/** Enforcement levels for a service compliance requirement. */
export const COMPLIANCE_ENFORCEMENT_LEVELS = [
  'warn_staff',
  'warn_client',
  'block_online',
  'block_all',
] as const;
export type ComplianceEnforcement = (typeof COMPLIANCE_ENFORCEMENT_LEVELS)[number];

export const COMPLIANCE_FORM_LINK_STATUSES = ['pending', 'consumed', 'expired', 'revoked'] as const;
export type ComplianceFormLinkStatus = (typeof COMPLIANCE_FORM_LINK_STATUSES)[number];

export const COMPLIANCE_LINK_SENT_VIA = ['email', 'sms', 'manual_copy'] as const;
export type ComplianceLinkSentVia = (typeof COMPLIANCE_LINK_SENT_VIA)[number];

/**
 * Resolved state of a single service requirement against a guest's records
 * (spec §5.1 step 3). `not_applicable` covers non-Model-B bookings.
 */
export const COMPLIANCE_REQUIREMENT_STATES = [
  'satisfied',
  'expiring_soon',
  'expired',
  'missing',
  'not_applicable',
] as const;
export type ComplianceRequirementState = (typeof COMPLIANCE_REQUIREMENT_STATES)[number];

/** Window (days) within which a still-valid record is flagged "expiring soon". */
export const COMPLIANCE_EXPIRING_SOON_DAYS = 30;

/** Structured error code returned when a booking is blocked by an unmet requirement. */
export const COMPLIANCE_REQUIREMENT_UNMET = 'COMPLIANCE_REQUIREMENT_UNMET';
