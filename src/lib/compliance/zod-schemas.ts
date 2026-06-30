import { z } from 'zod';
import {
  COMPLIANCE_CATEGORIES,
  COMPLIANCE_CAPTURE_METHODS,
  COMPLIANCE_ENFORCEMENT_LEVELS,
  COMPLIANCE_CAPTURE_CHANNELS,
  COMPLIANCE_ONLINE_COLLECTION_MODES,
} from '@/lib/compliance/constants';
import { COMPLIANCE_RESULT_TYPES } from '@/lib/compliance/form-schema';

/** Validity: null = lifetime, 0 = single-use/per-visit, >0 = days. */
const validityPeriodDaysSchema = z.number().int().min(0).max(36_500).nullable();

const captureMethodsSchema = z.array(z.enum(COMPLIANCE_CAPTURE_METHODS)).min(1).max(2);

/** Create a custom compliance type (form_schema validated separately by the service). */
export const complianceTypeCreateSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.enum(COMPLIANCE_CATEGORIES),
  description: z.string().max(2000).optional(),
  result_type: z.enum(COMPLIANCE_RESULT_TYPES),
  validity_period_days: validityPeriodDaysSchema.default(null),
  capture_methods: captureMethodsSchema,
  form_link_expiry_days: z.number().int().min(1).max(365).nullable().optional(),
  /** Message shown when an online booking is blocked by this requirement and the guest cannot self-complete it. */
  online_unmet_message: z.string().max(500).nullable().optional(),
  /** The full form_schema document; validated against result_type in the service. */
  form_schema: z.unknown(),
});
export type ComplianceTypeCreateInput = z.infer<typeof complianceTypeCreateSchema>;

/**
 * Update a type's non-schema fields. May ALSO carry `form_schema` (+ optional
 * `changelog`) so the form-builder edit can update settings and publish a new
 * immutable version in a single request (the service validates the schema and
 * creates the version). Schema edits without these still go through the new-version route.
 */
export const complianceTypePatchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    category: z.enum(COMPLIANCE_CATEGORIES).optional(),
    description: z.string().max(2000).nullable().optional(),
    validity_period_days: validityPeriodDaysSchema.optional(),
    capture_methods: captureMethodsSchema.optional(),
    form_link_expiry_days: z.number().int().min(1).max(365).nullable().optional(),
    online_unmet_message: z.string().max(500).nullable().optional(),
    is_active: z.boolean().optional(),
    form_schema: z.unknown().optional(),
    changelog: z.string().max(1000).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' });
export type ComplianceTypePatchInput = z.infer<typeof complianceTypePatchSchema>;

/** Form-builder save → new immutable version. */
export const complianceTypeVersionCreateSchema = z.object({
  form_schema: z.unknown(),
  changelog: z.string().max(1000).optional(),
});
export type ComplianceTypeVersionCreateInput = z.infer<typeof complianceTypeVersionCreateSchema>;

// ─── Service compliance requirements ────────────────────────────────────────

const lockPeriodHoursSchema = z.number().int().min(0).max(8760).nullable();

/** `service_id` is the booked-service row id; the API resolves the polymorphic column by venue type. */
export const complianceRequirementCreateSchema = z.object({
  service_id: z.string().uuid(),
  compliance_type_id: z.string().uuid(),
  enforcement: z.enum(COMPLIANCE_ENFORCEMENT_LEVELS),
  lock_period_hours: lockPeriodHoursSchema.optional(),
  online_collection: z.enum(COMPLIANCE_ONLINE_COLLECTION_MODES).optional(),
});
export type ComplianceRequirementCreateInput = z.infer<typeof complianceRequirementCreateSchema>;

export const complianceRequirementPatchSchema = z
  .object({
    enforcement: z.enum(COMPLIANCE_ENFORCEMENT_LEVELS).optional(),
    lock_period_hours: lockPeriodHoursSchema.optional(),
    online_collection: z.enum(COMPLIANCE_ONLINE_COLLECTION_MODES).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' });
export type ComplianceRequirementPatchInput = z.infer<typeof complianceRequirementPatchSchema>;

// ─── In-booking form submissions (captured during online booking) ────────────

/** One compliance form a guest completed inline while booking (spec §9.3, Phase 2b). */
export const complianceBookingSubmissionSchema = z.object({
  compliance_type_id: z.string().uuid(),
  responses: z.record(z.string(), z.unknown()),
});
export type ComplianceBookingSubmissionInput = z.infer<typeof complianceBookingSubmissionSchema>;

export const complianceBookingSubmissionsSchema = z.array(complianceBookingSubmissionSchema).max(20);

// ─── Record capture (staff in venue) ─────────────────────────────────────────

export const complianceRecordCaptureSchema = z.object({
  guest_id: z.string().uuid(),
  compliance_type_id: z.string().uuid(),
  booking_id: z.string().uuid().nullable().optional(),
  responses: z.record(z.string(), z.unknown()),
  capture_channel: z.enum(COMPLIANCE_CAPTURE_CHANNELS).default('staff_web'),
  notes: z.string().max(2000).optional(),
});
export type ComplianceRecordCaptureInput = z.infer<typeof complianceRecordCaptureSchema>;

export const complianceRecordVoidSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const complianceRecordNotesPatchSchema = z
  .object({
    notes: z.string().max(2000).nullable().optional(),
    /** Staff pass/fail decision recorded on a pass_fail record (e.g. a client-submitted patch
     * test that arrived undecided). Only applies to pass_fail types; enforced in the route. */
    result: z.enum(['pass', 'fail', 'inconclusive']).optional(),
  })
  .refine((d) => d.notes !== undefined || d.result !== undefined, { message: 'No fields to update' });

// ─── Form links ──────────────────────────────────────────────────────────────

export const complianceFormLinkCreateSchema = z.object({
  guest_id: z.string().uuid(),
  compliance_type_id: z.string().uuid(),
  booking_id: z.string().uuid().nullable().optional(),
  // Optional: when omitted, the route uses the venue's default form-link channel.
  // Only a real delivery channel can be requested; 'manual_copy' is an internal
  // fallback the route resolves to when the guest has no email/phone, never a caller input.
  send_via: z.enum(['email', 'sms']).optional(),
});
export type ComplianceFormLinkCreateInput = z.infer<typeof complianceFormLinkCreateSchema>;
