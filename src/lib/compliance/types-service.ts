import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parseFormSchema,
  validateFormSchemaForType,
  type ComplianceResultType,
} from '@/lib/compliance/form-schema';
import { complianceTypeSlugBase, ensureUniqueComplianceSlug } from '@/lib/compliance/slug';
import { writeComplianceAuditEvent } from '@/lib/compliance/audit';
import type { ComplianceCategory, ComplianceCaptureMethod } from '@/lib/compliance/constants';

/**
 * Service layer for compliance types. Keeps the route handlers thin and centralises
 * the multi-step "create type + first version" and "new version" flows.
 */

export interface CreateTypeParams {
  venueId: string;
  staffId: string;
  name: string;
  category: ComplianceCategory;
  resultType: ComplianceResultType;
  validityPeriodDays: number | null;
  captureMethods: ComplianceCaptureMethod[];
  description?: string | null;
  formLinkExpiryDays?: number | null;
  onlineUnmetMessage?: string | null;
  formSchema: unknown;
  libraryTemplateSlug?: string | null;
}

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

/** Order-insensitive JSON, for comparing two stored form schemas for equality. */
function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = sort((v as Record<string, unknown>)[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

interface TypeRow {
  id: string;
  [key: string]: unknown;
}

async function slugIsTaken(
  admin: SupabaseClient,
  venueId: string,
  candidate: string,
): Promise<boolean> {
  const { data } = await admin
    .from('compliance_types')
    .select('id')
    .eq('venue_id', venueId)
    .eq('slug', candidate)
    .maybeSingle();
  return Boolean(data);
}

/**
 * Create a compliance type and its first immutable version, then point
 * `current_version_id` at it. Validates the form schema against the result type.
 */
export async function createComplianceType(
  admin: SupabaseClient,
  params: CreateTypeParams,
): Promise<ServiceResult<{ type: TypeRow; versionId: string }>> {
  const parsedSchema = parseFormSchema(params.formSchema);
  if (!parsedSchema.ok) {
    return { ok: false, error: parsedSchema.error, status: 400 };
  }
  const schemaValidation = validateFormSchemaForType(parsedSchema.schema, params.resultType);
  if (!schemaValidation.ok) {
    return { ok: false, error: schemaValidation.errors.join(' '), status: 400 };
  }

  const base = complianceTypeSlugBase(params.name);
  const slug = await ensureUniqueComplianceSlug(base, (c) => slugIsTaken(admin, params.venueId, c));

  const { data: typeRow, error: typeErr } = await admin
    .from('compliance_types')
    .insert({
      venue_id: params.venueId,
      name: params.name,
      slug,
      category: params.category,
      description: params.description ?? null,
      result_type: params.resultType,
      validity_period_days: params.validityPeriodDays,
      capture_methods: params.captureMethods,
      form_link_expiry_days: params.formLinkExpiryDays ?? null,
      online_unmet_message: params.onlineUnmetMessage ?? null,
      library_template_slug: params.libraryTemplateSlug ?? null,
      is_active: true,
    })
    .select()
    .single();

  if (typeErr || !typeRow) {
    console.error('[createComplianceType] insert type failed:', typeErr?.message);
    return { ok: false, error: 'Failed to create compliance type.', status: 500 };
  }

  const typeId = (typeRow as TypeRow).id;

  const { data: versionRow, error: versionErr } = await admin
    .from('compliance_type_versions')
    .insert({
      venue_id: params.venueId,
      compliance_type_id: typeId,
      version_number: 1,
      form_schema: parsedSchema.schema,
      created_by_staff_id: params.staffId,
    })
    .select('id')
    .single();

  if (versionErr || !versionRow) {
    console.error('[createComplianceType] insert version failed:', versionErr?.message);
    // Roll back the orphan type so we don't leave a versionless type behind.
    await admin.from('compliance_types').delete().eq('id', typeId).eq('venue_id', params.venueId);
    return { ok: false, error: 'Failed to create compliance type version.', status: 500 };
  }

  const versionId = (versionRow as { id: string }).id;

  const { error: linkErr } = await admin
    .from('compliance_types')
    .update({ current_version_id: versionId, updated_at: new Date().toISOString() })
    .eq('id', typeId)
    .eq('venue_id', params.venueId);
  if (linkErr) {
    console.error('[createComplianceType] link current_version failed:', linkErr.message);
    return { ok: false, error: 'Failed to finalise compliance type.', status: 500 };
  }

  await writeComplianceAuditEvent(admin, {
    venueId: params.venueId,
    eventType: 'type.created',
    actorType: 'staff',
    actorStaffId: params.staffId,
    complianceTypeId: typeId,
    metadata: { name: params.name, library_template_slug: params.libraryTemplateSlug ?? null },
  });
  await writeComplianceAuditEvent(admin, {
    venueId: params.venueId,
    eventType: 'version.created',
    actorType: 'staff',
    actorStaffId: params.staffId,
    complianceTypeId: typeId,
    metadata: { version_number: 1 },
  });

  return { ok: true, value: { type: { ...(typeRow as TypeRow), current_version_id: versionId }, versionId } };
}

/**
 * Create a new immutable version of a type's form schema and update
 * `current_version_id`. Retries on the (type, version_number) unique collision.
 */
export async function createComplianceTypeVersion(
  admin: SupabaseClient,
  params: { venueId: string; staffId: string; typeId: string; formSchema: unknown; changelog?: string | null },
): Promise<ServiceResult<{ versionId: string; versionNumber: number }>> {
  const { data: typeRow, error: typeErr } = await admin
    .from('compliance_types')
    .select('id, result_type, current_version_id')
    .eq('id', params.typeId)
    .eq('venue_id', params.venueId)
    .maybeSingle();
  if (typeErr || !typeRow) {
    return { ok: false, error: 'Compliance type not found.', status: 404 };
  }

  const resultType = (typeRow as { result_type: ComplianceResultType }).result_type;
  const parsedSchema = parseFormSchema(params.formSchema);
  if (!parsedSchema.ok) return { ok: false, error: parsedSchema.error, status: 400 };
  const schemaValidation = validateFormSchemaForType(parsedSchema.schema, resultType);
  if (!schemaValidation.ok) {
    return { ok: false, error: schemaValidation.errors.join(' '), status: 400 };
  }

  // Idempotency / no churn (review #1): if the submitted schema is byte-identical to the
  // current version, don't publish a duplicate. This makes the single-request PATCH save's
  // retries safe (a retry after a metadata failure won't spam versions) and avoids creating
  // a new identical version for a metadata-only edit.
  const currentVersionId = (typeRow as { current_version_id?: string | null }).current_version_id ?? null;
  if (currentVersionId) {
    const { data: cur } = await admin
      .from('compliance_type_versions')
      .select('id, version_number, form_schema')
      .eq('id', currentVersionId)
      .eq('venue_id', params.venueId)
      .maybeSingle();
    const curRow = cur as { id: string; version_number: number; form_schema: unknown } | null;
    if (curRow && canonicalJson(curRow.form_schema) === canonicalJson(parsedSchema.schema)) {
      return { ok: true, value: { versionId: curRow.id, versionNumber: curRow.version_number } };
    }
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: maxRow } = await admin
      .from('compliance_type_versions')
      .select('version_number')
      .eq('compliance_type_id', params.typeId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextNumber = ((maxRow as { version_number?: number } | null)?.version_number ?? 0) + 1;

    const { data: versionRow, error: versionErr } = await admin
      .from('compliance_type_versions')
      .insert({
        venue_id: params.venueId,
        compliance_type_id: params.typeId,
        version_number: nextNumber,
        form_schema: parsedSchema.schema,
        changelog: params.changelog ?? null,
        created_by_staff_id: params.staffId,
      })
      .select('id')
      .single();

    if (versionErr) {
      if (versionErr.code === '23505') continue; // raced another save; recompute and retry
      console.error('[createComplianceTypeVersion] insert failed:', versionErr.message);
      return { ok: false, error: 'Failed to create version.', status: 500 };
    }

    const versionId = (versionRow as { id: string }).id;
    await admin
      .from('compliance_types')
      .update({ current_version_id: versionId, updated_at: new Date().toISOString() })
      .eq('id', params.typeId)
      .eq('venue_id', params.venueId);

    await writeComplianceAuditEvent(admin, {
      venueId: params.venueId,
      eventType: 'version.created',
      actorType: 'staff',
      actorStaffId: params.staffId,
      complianceTypeId: params.typeId,
      metadata: { version_number: nextNumber },
    });

    return { ok: true, value: { versionId, versionNumber: nextNumber } };
  }

  return { ok: false, error: 'Could not allocate a new version number. Please retry.', status: 409 };
}

export interface ComplianceTypeWithCounts extends TypeRow {
  current_version_number: number | null;
  service_requirement_count: number;
  record_count: number;
}

/** List a venue's types (optionally including archived) with usage counts for the settings UI. */
export async function listComplianceTypesWithCounts(
  admin: SupabaseClient,
  venueId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<ComplianceTypeWithCounts[]> {
  let query = admin
    .from('compliance_types')
    .select('*')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: true });
  if (!opts.includeArchived) query = query.eq('is_active', true);

  const { data: types, error } = await query;
  if (error || !types) {
    if (error) console.error('[listComplianceTypesWithCounts] failed:', error.message);
    return [];
  }
  const typeIds = (types as TypeRow[]).map((t) => t.id);
  if (typeIds.length === 0) return [];

  const [versionsRes, reqRes, recRes] = await Promise.all([
    admin
      .from('compliance_type_versions')
      .select('compliance_type_id, version_number')
      .in('compliance_type_id', typeIds),
    admin
      .from('service_compliance_requirements')
      .select('compliance_type_id')
      .eq('venue_id', venueId)
      .in('compliance_type_id', typeIds),
    admin
      .from('compliance_records')
      .select('compliance_type_id')
      .eq('venue_id', venueId)
      .in('compliance_type_id', typeIds),
  ]);

  const maxVersionByType = new Map<string, number>();
  for (const v of (versionsRes.data ?? []) as Array<{ compliance_type_id: string; version_number: number }>) {
    maxVersionByType.set(
      v.compliance_type_id,
      Math.max(maxVersionByType.get(v.compliance_type_id) ?? 0, v.version_number),
    );
  }
  const reqCountByType = new Map<string, number>();
  for (const r of (reqRes.data ?? []) as Array<{ compliance_type_id: string }>) {
    reqCountByType.set(r.compliance_type_id, (reqCountByType.get(r.compliance_type_id) ?? 0) + 1);
  }
  const recCountByType = new Map<string, number>();
  for (const r of (recRes.data ?? []) as Array<{ compliance_type_id: string }>) {
    recCountByType.set(r.compliance_type_id, (recCountByType.get(r.compliance_type_id) ?? 0) + 1);
  }

  return (types as TypeRow[]).map((t) => ({
    ...t,
    current_version_number: maxVersionByType.get(t.id) ?? null,
    service_requirement_count: reqCountByType.get(t.id) ?? 0,
    record_count: recCountByType.get(t.id) ?? 0,
  }));
}

/**
 * Restore a prior version by creating a NEW version that copies its schema (keeps
 * version numbers monotonic and the audit trail intact, rather than pointing
 * `current_version_id` backwards). Reuses {@link createComplianceTypeVersion}.
 */
export async function restoreComplianceTypeVersion(
  admin: SupabaseClient,
  params: { venueId: string; staffId: string; typeId: string; versionId: string },
): Promise<ServiceResult<{ versionId: string; versionNumber: number }>> {
  const { data: src } = await admin
    .from('compliance_type_versions')
    .select('form_schema, version_number')
    .eq('id', params.versionId)
    .eq('compliance_type_id', params.typeId)
    .eq('venue_id', params.venueId)
    .maybeSingle();
  if (!src) return { ok: false, error: 'Version not found.', status: 404 };
  const source = src as { form_schema: unknown; version_number: number };
  return createComplianceTypeVersion(admin, {
    venueId: params.venueId,
    staffId: params.staffId,
    typeId: params.typeId,
    formSchema: source.form_schema,
    changelog: `Restored from v${source.version_number}`,
  });
}

/**
 * Duplicate a type into a new, independent type ("{name} (copy)") carrying the same
 * settings and current form schema. Reuses {@link createComplianceType}, so the copy
 * gets a fresh slug, its own first version, and audit events.
 */
export async function duplicateComplianceType(
  admin: SupabaseClient,
  params: { venueId: string; staffId: string; typeId: string },
): Promise<ServiceResult<{ type: TypeRow; versionId: string }>> {
  const existing = await getComplianceTypeWithVersion(admin, params.venueId, params.typeId);
  if (!existing.ok) return existing;
  const t = existing.value.type;
  const schema = existing.value.version?.form_schema;
  if (!schema) return { ok: false, error: 'This type has no form to duplicate.', status: 400 };
  return createComplianceType(admin, {
    venueId: params.venueId,
    staffId: params.staffId,
    name: `${(t.name as string | null) ?? 'Compliance type'} (copy)`,
    category: t.category as ComplianceCategory,
    resultType: t.result_type as ComplianceResultType,
    validityPeriodDays: (t.validity_period_days as number | null) ?? null,
    captureMethods: (t.capture_methods as ComplianceCaptureMethod[] | null) ?? [],
    description: (t.description as string | null) ?? null,
    formLinkExpiryDays: (t.form_link_expiry_days as number | null) ?? null,
    onlineUnmetMessage: (t.online_unmet_message as string | null) ?? null,
    formSchema: schema,
    libraryTemplateSlug: null,
  });
}

/** Fetch a single type with its current (or latest) version's form schema. */
export async function getComplianceTypeWithVersion(
  admin: SupabaseClient,
  venueId: string,
  typeId: string,
): Promise<ServiceResult<{ type: TypeRow; version: { id: string; version_number: number; form_schema: unknown } | null }>> {
  const { data: typeRow, error } = await admin
    .from('compliance_types')
    .select('*')
    .eq('id', typeId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (error || !typeRow) {
    return { ok: false, error: 'Compliance type not found.', status: 404 };
  }
  const type = typeRow as TypeRow;
  const currentVersionId = (type.current_version_id as string | null) ?? null;

  let versionQuery = admin
    .from('compliance_type_versions')
    .select('id, version_number, form_schema')
    .eq('compliance_type_id', typeId);
  versionQuery = currentVersionId
    ? versionQuery.eq('id', currentVersionId)
    : versionQuery.order('version_number', { ascending: false }).limit(1);

  const { data: versionRow } = await versionQuery.maybeSingle();
  return {
    ok: true,
    value: {
      type,
      version: (versionRow as { id: string; version_number: number; form_schema: unknown } | null) ?? null,
    },
  };
}
