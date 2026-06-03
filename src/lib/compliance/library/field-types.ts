import { z } from 'zod';
import { COMPLIANCE_CATEGORIES, COMPLIANCE_CAPTURE_METHODS } from '@/lib/compliance/constants';
import { COMPLIANCE_RESULT_TYPES, formSchemaSchema } from '@/lib/compliance/form-schema';

/**
 * A pre-built compliance template shipped with the platform (spec §6). Library
 * templates are TypeScript constants — NOT venue database rows. "Add from
 * library" clones one into `compliance_types` + `compliance_type_versions`.
 */
export const libraryTemplateSchema = z.object({
  /** Stable library slug, e.g. 'lib-ppd-patch-test-v1'. Written to compliance_types.library_template_slug. */
  slug: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(COMPLIANCE_CATEGORIES),
  result_type: z.enum(COMPLIANCE_RESULT_TYPES),
  /** null = lifetime, 0 = per-visit, >0 = days. */
  validity_period_days: z.number().int().min(0).nullable(),
  capture_methods: z.array(z.enum(COMPLIANCE_CAPTURE_METHODS)).min(1),
  description: z.string().optional(),
  form_schema: formSchemaSchema,
});

export type LibraryTemplate = z.infer<typeof libraryTemplateSchema>;

/**
 * Helper for template files: accepts the schema *input* shape (so per-field
 * `required` / `staff_only` and `schema_version` may be omitted) and returns the
 * fully-parsed template, validating at module load.
 */
export function defineTemplate(t: z.input<typeof libraryTemplateSchema>): LibraryTemplate {
  return libraryTemplateSchema.parse(t);
}
