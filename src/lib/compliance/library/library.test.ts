import { describe, expect, it } from 'vitest';
import { allTemplates, getTemplateBySlug, templateSummaries } from '@/lib/compliance/library';
import { validateFormSchemaForType } from '@/lib/compliance/form-schema';
import { complianceTypeSlugBase, ensureUniqueComplianceSlug } from '@/lib/compliance/slug';

describe('library templates', () => {
  it('ships the 10 v1 templates with unique slugs', () => {
    const templates = allTemplates();
    expect(templates.length).toBe(10);
    const slugs = new Set(templates.map((t) => t.slug));
    expect(slugs.size).toBe(10);
  });

  it('every template passes its own result_type validation', () => {
    for (const t of allTemplates()) {
      const result = validateFormSchemaForType(t.form_schema, t.result_type);
      expect(result, `${t.slug}: ${result.errors.join('; ')}`).toEqual({ ok: true, errors: [] });
    }
  });

  it('every template title matches its name', () => {
    for (const t of allTemplates()) {
      expect(t.form_schema.title).toBe(t.name);
    }
  });

  it('getTemplateBySlug resolves and rejects unknowns', () => {
    expect(getTemplateBySlug('lib-ppd-patch-test-v1')?.name).toBe('PPD Patch Test');
    expect(getTemplateBySlug('nope')).toBeNull();
  });

  it('summaries expose field counts', () => {
    const summary = templateSummaries().find((s) => s.slug === 'lib-ppd-patch-test-v1');
    expect(summary?.field_count).toBe(5);
  });
});

describe('slug helpers', () => {
  it('slugifies a name', () => {
    expect(complianceTypeSlugBase('PPD Patch Test')).toBe('ppd-patch-test');
    expect(complianceTypeSlugBase("Andrew's Consent")).toBe('andrews-consent');
    expect(complianceTypeSlugBase('!!!')).toBe('compliance-type');
  });

  it('appends a numeric suffix on collision', async () => {
    const taken = new Set(['ppd-patch-test', 'ppd-patch-test-2']);
    const slug = await ensureUniqueComplianceSlug('ppd-patch-test', async (c) => taken.has(c));
    expect(slug).toBe('ppd-patch-test-3');
  });

  it('returns the base when free', async () => {
    expect(await ensureUniqueComplianceSlug('free-slug', async () => false)).toBe('free-slug');
  });
});
