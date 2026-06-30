import type { LibraryTemplate } from '@/lib/compliance/library/field-types';
import { ppdPatchTestTemplate } from '@/lib/compliance/library/templates/ppd-patch-test';
import { eyelashPatchTestTemplate } from '@/lib/compliance/library/templates/eyelash-patch-test';
import { eyebrowPatchTestTemplate } from '@/lib/compliance/library/templates/eyebrow-patch-test';
import { newClientIntakeTemplate } from '@/lib/compliance/library/templates/new-client-intake';
import { massageIntakeTemplate } from '@/lib/compliance/library/templates/massage-intake';
import { massageConsentTemplate } from '@/lib/compliance/library/templates/massage-consent';
import { pregnancyDeclarationTemplate } from '@/lib/compliance/library/templates/pregnancy-declaration';
import { dogVaccinationTemplate } from '@/lib/compliance/library/templates/dog-vaccination';
import { dogBehaviourTemplate } from '@/lib/compliance/library/templates/dog-behaviour';
import { photoConsentTemplate } from '@/lib/compliance/library/templates/photo-consent';

export type { LibraryTemplate } from '@/lib/compliance/library/field-types';

const TEMPLATES: readonly LibraryTemplate[] = [
  ppdPatchTestTemplate,
  eyelashPatchTestTemplate,
  eyebrowPatchTestTemplate,
  newClientIntakeTemplate,
  massageIntakeTemplate,
  massageConsentTemplate,
  pregnancyDeclarationTemplate,
  dogVaccinationTemplate,
  dogBehaviourTemplate,
  photoConsentTemplate,
];

/** All v1 library templates. */
export function allTemplates(): readonly LibraryTemplate[] {
  return TEMPLATES;
}

/** Look up a single library template by its `slug` (e.g. 'lib-ppd-patch-test-v1'). */
export function getTemplateBySlug(slug: string): LibraryTemplate | null {
  return TEMPLATES.find((t) => t.slug === slug) ?? null;
}

/** Summary for the "Add from library" picker, including the schema so it can be previewed. */
export interface LibraryTemplateSummary {
  slug: string;
  name: string;
  category: LibraryTemplate['category'];
  result_type: LibraryTemplate['result_type'];
  validity_period_days: number | null;
  capture_methods: LibraryTemplate['capture_methods'];
  description?: string;
  field_count: number;
  form_schema: LibraryTemplate['form_schema'];
}

export function templateSummaries(): LibraryTemplateSummary[] {
  return TEMPLATES.map((t) => ({
    slug: t.slug,
    name: t.name,
    category: t.category,
    result_type: t.result_type,
    validity_period_days: t.validity_period_days,
    capture_methods: t.capture_methods,
    description: t.description,
    field_count: t.form_schema.fields.length,
    form_schema: t.form_schema,
  }));
}
