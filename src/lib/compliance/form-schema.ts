import { z } from 'zod';

/**
 * Compliance form schema (spec §4.3.1) — the versioned JSONB document stored on
 * `compliance_type_versions.form_schema`. v1 supports a flat list of fields.
 * The shape is deliberately a special case of the planned v2 schema (sections /
 * conditional logic), so v2 can extend without breaking v1 documents.
 *
 * This module is the single source of truth for:
 *   - parsing/validating a stored form_schema (`formSchemaSchema`)
 *   - editor save-time validation (`validateFormSchemaForType`, spec §7.4)
 *   - building a response validator for a given schema (`buildResponseSchema`)
 *   - deriving a record's `result` (`computeResult`) and `expires_at` (`computeExpiresAt`)
 */

// ─── Field types ──────────────────────────────────────────────────────────────

export const COMPLIANCE_FIELD_TYPES = [
  'text',
  'textarea',
  'select',
  'multiselect',
  'date',
  'signature',
  'file',
] as const;
export type ComplianceFieldType = (typeof COMPLIANCE_FIELD_TYPES)[number];

export const COMPLIANCE_RESULT_TYPES = ['pass_fail', 'signed', 'completed', 'file_uploaded'] as const;
export type ComplianceResultType = (typeof COMPLIANCE_RESULT_TYPES)[number];

/** Field id: short, stable, used as the key in `compliance_records.responses`. */
const fieldIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_]+$/, 'Field id may only contain letters, numbers and underscores');

const optionSchema = z.object({
  value: z.string().min(1).max(200),
  label: z.string().min(1).max(300),
});
export type ComplianceFieldOption = z.infer<typeof optionSchema>;

const fieldBase = {
  id: fieldIdSchema,
  label: z.string().min(1).max(300),
  help_text: z.string().max(1000).optional(),
  required: z.boolean().optional().default(false),
  /** Hidden from the public form; only rendered/accepted in staff mode. */
  staff_only: z.boolean().optional().default(false),
};

const textFieldSchema = z.object({
  ...fieldBase,
  type: z.literal('text'),
  max_length: z.number().int().min(1).max(10_000).optional(),
  default_value: z.string().max(10_000).optional(),
});
const textareaFieldSchema = z.object({
  ...fieldBase,
  type: z.literal('textarea'),
  max_length: z.number().int().min(1).max(10_000).optional(),
  default_value: z.string().max(10_000).optional(),
});
const selectFieldSchema = z.object({
  ...fieldBase,
  type: z.literal('select'),
  options: z.array(optionSchema).min(1).max(100),
  default_value: z.string().max(200).optional(),
});
const multiselectFieldSchema = z.object({
  ...fieldBase,
  type: z.literal('multiselect'),
  options: z.array(optionSchema).min(1).max(100),
  default_value: z.array(z.string().max(200)).optional(),
});
const dateFieldSchema = z.object({
  ...fieldBase,
  type: z.literal('date'),
  /** `'today'` resolves to the submission date in the renderer; otherwise an ISO date. */
  default_value: z.union([z.literal('today'), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
});
const signatureFieldSchema = z.object({
  ...fieldBase,
  type: z.literal('signature'),
});
const fileFieldSchema = z.object({
  ...fieldBase,
  type: z.literal('file'),
});

export const complianceFieldSchema = z.discriminatedUnion('type', [
  textFieldSchema,
  textareaFieldSchema,
  selectFieldSchema,
  multiselectFieldSchema,
  dateFieldSchema,
  signatureFieldSchema,
  fileFieldSchema,
]);
export type ComplianceField = z.infer<typeof complianceFieldSchema>;

// ─── result_mapping ───────────────────────────────────────────────────────────

const resultMappingSchema = z.object({
  field: fieldIdSchema,
  pass_values: z.array(z.string().min(1)).min(1),
  fail_values: z.array(z.string().min(1)).min(1),
});
export type ComplianceResultMapping = z.infer<typeof resultMappingSchema>;

// ─── Whole form schema ────────────────────────────────────────────────────────

export const formSchemaSchema = z.object({
  schema_version: z.literal('1.0').default('1.0'),
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  intro_markdown: z.string().max(10_000).optional(),
  fields: z.array(complianceFieldSchema).min(1).max(100),
  result_mapping: resultMappingSchema.optional(),
});
export type ComplianceFormSchema = z.infer<typeof formSchemaSchema>;

/** Parse an unknown value into a validated form schema. */
export function parseFormSchema(
  raw: unknown,
): { ok: true; schema: ComplianceFormSchema } | { ok: false; error: string } {
  const parsed = formSchemaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid form schema' };
  }
  return { ok: true, schema: parsed.data };
}

// ─── Editor save-time validation (spec §7.4) ────────────────────────────────────

export interface FormSchemaValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Cross-field validation that depends on the type's `result_type`.
 * Returns all violations (not just the first) for a helpful editor experience.
 */
export function validateFormSchemaForType(
  schema: ComplianceFormSchema,
  resultType: ComplianceResultType,
): FormSchemaValidationResult {
  const errors: string[] = [];

  // Unique field ids.
  const seen = new Set<string>();
  for (const f of schema.fields) {
    if (seen.has(f.id)) errors.push(`Duplicate field id "${f.id}". Field ids must be unique.`);
    seen.add(f.id);
  }

  // At most one signature field, at most one file field (v1 limitation).
  const signatureFields = schema.fields.filter((f) => f.type === 'signature');
  const fileFields = schema.fields.filter((f) => f.type === 'file');
  if (signatureFields.length > 1) errors.push('A form may contain at most one signature field.');
  if (fileFields.length > 1) errors.push('A form may contain at most one file upload field.');

  // result_type-specific rules.
  if (resultType === 'pass_fail') {
    const mapping = schema.result_mapping;
    if (!mapping) {
      errors.push('Pass/fail types require a result_mapping pointing at a result field.');
    } else {
      const mapped = schema.fields.find((f) => f.id === mapping.field);
      if (!mapped) {
        errors.push(`result_mapping references unknown field "${mapping.field}".`);
      } else if (mapped.type !== 'select') {
        errors.push('The result field referenced by result_mapping must be a select field.');
      } else if (!mapped.staff_only) {
        errors.push('The pass/fail result field must be marked staff_only.');
      } else {
        const optionValues = new Set(mapped.options.map((o) => o.value));
        const declared = [...mapping.pass_values, ...mapping.fail_values];
        const missing = declared.filter((v) => !optionValues.has(v));
        if (missing.length > 0) {
          errors.push(
            `result_mapping values not present in the result field options: ${missing.join(', ')}.`,
          );
        }
        const overlap = mapping.pass_values.filter((v) => mapping.fail_values.includes(v));
        if (overlap.length > 0) {
          errors.push(`A value cannot be both pass and fail: ${overlap.join(', ')}.`);
        }
      }
    }
  }

  if (resultType === 'signed' && signatureFields.length === 0) {
    errors.push('Types with result type "signed" must include a signature field.');
  }
  if (resultType === 'file_uploaded' && fileFields.length === 0) {
    errors.push('Types with result type "file_uploaded" must include a file upload field.');
  }

  return { ok: errors.length === 0, errors };
}

// ─── Response payload validation ────────────────────────────────────────────────

export interface SignatureResponse {
  method: 'drawn' | 'typed';
  /** For typed signatures: the typed name. For drawn (client → server): a data URL pre-upload. */
  data?: string;
  /** Set server-side after a drawn signature is uploaded to the compliance-files bucket. */
  storage_path?: string;
  signed_at: string;
}

export interface FileResponse {
  storage_path: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
}

const signatureResponseSchema = z
  .object({
    method: z.enum(['drawn', 'typed']),
    data: z.string().min(1).optional(),
    storage_path: z.string().min(1).optional(),
    signed_at: z.string().min(1),
  })
  .refine((v) => Boolean(v.data) || Boolean(v.storage_path), {
    message: 'Signature requires either drawn data or an uploaded path.',
  });

const fileResponseSchema = z.object({
  storage_path: z.string().min(1),
  file_name: z.string().min(1).max(500),
  mime_type: z.string().min(1).max(200),
  file_size_bytes: z.number().int().min(0),
});

/**
 * Build a zod schema validating a `responses` payload against a form schema.
 * In `public` mode, `staff_only` fields are excluded — unknown keys are stripped,
 * so a public submitter cannot inject a staff-only field (e.g. the result field).
 */
export function buildResponseSchema(
  schema: ComplianceFormSchema,
  mode: 'staff' | 'public',
): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of schema.fields) {
    if (mode === 'public' && field.staff_only) continue;

    let fieldSchema: z.ZodTypeAny;
    switch (field.type) {
      case 'text':
      case 'textarea': {
        let s = z.string();
        if (field.max_length) s = s.max(field.max_length);
        fieldSchema = field.required ? s.trim().min(1, `${field.label} is required`) : s.optional();
        break;
      }
      case 'select': {
        const values = field.options.map((o) => o.value);
        const base = z.string().refine((v) => values.includes(v), {
          message: `${field.label}: invalid selection`,
        });
        fieldSchema = field.required ? base : base.optional();
        break;
      }
      case 'multiselect': {
        const values = new Set(field.options.map((o) => o.value));
        const base = z
          .array(z.string())
          .refine((arr) => arr.every((v) => values.has(v)), {
            message: `${field.label}: invalid selection`,
          });
        fieldSchema = field.required ? base.min(1, `${field.label} is required`) : base.optional();
        break;
      }
      case 'date': {
        const base = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${field.label}: invalid date`);
        fieldSchema = field.required ? base : base.optional();
        break;
      }
      case 'signature': {
        fieldSchema = field.required ? signatureResponseSchema : signatureResponseSchema.optional();
        break;
      }
      case 'file': {
        fieldSchema = field.required ? fileResponseSchema : fileResponseSchema.optional();
        break;
      }
      default: {
        // Exhaustiveness guard — unreachable given the discriminated union.
        const _never: never = field;
        throw new Error(`Unhandled field type: ${JSON.stringify(_never)}`);
      }
    }
    shape[field.id] = fieldSchema;
  }

  // z.object strips unknown keys by default in zod v4 → drops staff_only fields in public mode.
  return z.object(shape);
}

export interface ResponseValidationResult {
  ok: boolean;
  value?: Record<string, unknown>;
  /** Field-id → first error message. */
  errors?: Record<string, string>;
  formError?: string;
}

/** Validate a responses payload, returning per-field errors keyed by field id. */
export function validateResponses(
  schema: ComplianceFormSchema,
  responses: unknown,
  mode: 'staff' | 'public',
): ResponseValidationResult {
  if (responses == null || typeof responses !== 'object' || Array.isArray(responses)) {
    return { ok: false, formError: 'Responses must be an object.' };
  }
  const responseSchema = buildResponseSchema(schema, mode);
  const parsed = responseSchema.safeParse(responses);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? '_form');
    if (!errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}

// ─── Result derivation (spec §4.4) ──────────────────────────────────────────────

export type ComplianceResultValue = 'pass' | 'fail' | 'inconclusive' | 'completed' | 'signed';

/**
 * Derive the record `result` from responses + the type's result semantics.
 * - pass_fail: uses result_mapping; a mapped value not in pass/fail lists → 'inconclusive';
 *   an absent result field (e.g. staff_only not yet filled) → null.
 * - signed: 'signed'; completed/file_uploaded: 'completed'.
 */
export function computeResult(
  schema: ComplianceFormSchema,
  responses: Record<string, unknown>,
  resultType: ComplianceResultType,
): ComplianceResultValue | null {
  if (resultType === 'pass_fail') {
    const mapping = schema.result_mapping;
    if (!mapping) return null;
    const raw = responses[mapping.field];
    if (typeof raw !== 'string' || raw.length === 0) return null;
    if (mapping.pass_values.includes(raw)) return 'pass';
    if (mapping.fail_values.includes(raw)) return 'fail';
    return 'inconclusive';
  }
  if (resultType === 'signed') return 'signed';
  // completed | file_uploaded
  return 'completed';
}

// ─── Expiry computation (spec §4.4.2) ───────────────────────────────────────────

/**
 * Compute a record's `expires_at` from the type's validity period:
 *   null → lifetime (returns null)
 *   0    → single-use, immediately expired (returns capturedAt)
 *   >0   → capturedAt + N days
 */
export function computeExpiresAt(
  validityPeriodDays: number | null | undefined,
  capturedAt: Date,
): Date | null {
  if (validityPeriodDays == null) return null;
  if (validityPeriodDays === 0) return new Date(capturedAt.getTime());
  return new Date(capturedAt.getTime() + validityPeriodDays * 24 * 60 * 60 * 1000);
}
