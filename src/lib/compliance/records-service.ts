import type { SupabaseClient } from '@supabase/supabase-js';
import {
  computeExpiresAt,
  computeResult,
  parseFormSchema,
  validateResponses,
  type ComplianceFormSchema,
  type ComplianceResultType,
} from '@/lib/compliance/form-schema';
import { processSignatureUploads } from '@/lib/compliance/files';
import { writeComplianceAuditEvent } from '@/lib/compliance/audit';
import type { ComplianceCaptureChannel } from '@/lib/compliance/constants';
import type { ServiceResult } from '@/lib/compliance/types-service';

export interface CaptureContext {
  venueId: string;
  guestId: string;
  complianceTypeId: string;
  complianceTypeVersionId: string;
  resultType: ComplianceResultType;
  validityPeriodDays: number | null;
  formSchema: ComplianceFormSchema;
  bookingId?: string | null;
  captureChannel: ComplianceCaptureChannel;
  capturedByStaffId: string | null;
  captureIp?: string | null;
  captureUserAgent?: string | null;
  notes?: string | null;
  mode: 'staff' | 'public';
  actorType: 'staff' | 'client';
}

export interface CaptureFailure {
  ok: false;
  error: string;
  status: number;
  fieldErrors?: Record<string, string>;
}

/**
 * Core capture used by both staff (`/records`) and public (`/forms/[code]/submit`)
 * flows. Validates responses against the bound version schema, uploads drawn
 * signatures, derives result + expiry, inserts the record, and audits it.
 */
export async function captureComplianceRecord(
  admin: SupabaseClient,
  ctx: CaptureContext,
  responses: unknown,
): Promise<{ ok: true; record: Record<string, unknown> } | CaptureFailure> {
  const validation = validateResponses(ctx.formSchema, responses, ctx.mode);
  if (!validation.ok || !validation.value) {
    return {
      ok: false,
      error: validation.formError ?? 'Some answers need attention.',
      status: 400,
      fieldErrors: validation.errors,
    };
  }

  const recordId = crypto.randomUUID();

  const uploaded = await processSignatureUploads(admin, {
    venueId: ctx.venueId,
    recordId,
    schema: ctx.formSchema,
    responses: validation.value,
  });
  if (!uploaded.ok) return { ok: false, error: uploaded.error, status: 500 };

  const capturedAt = new Date();
  const result = computeResult(ctx.formSchema, uploaded.responses, ctx.resultType);
  const expiresAt = computeExpiresAt(ctx.validityPeriodDays, capturedAt);

  const { data: record, error } = await admin
    .from('compliance_records')
    .insert({
      id: recordId,
      venue_id: ctx.venueId,
      guest_id: ctx.guestId,
      compliance_type_id: ctx.complianceTypeId,
      compliance_type_version_id: ctx.complianceTypeVersionId,
      booking_id: ctx.bookingId ?? null,
      status: 'completed',
      result,
      responses: uploaded.responses,
      captured_by_staff_id: ctx.capturedByStaffId,
      captured_at: capturedAt.toISOString(),
      capture_channel: ctx.captureChannel,
      capture_ip: ctx.captureIp ?? null,
      capture_user_agent: ctx.captureUserAgent ?? null,
      expires_at: expiresAt ? expiresAt.toISOString() : null,
      notes: ctx.notes ?? null,
    })
    .select()
    .single();

  if (error || !record) {
    console.error('[captureComplianceRecord] insert failed:', error?.message);
    return { ok: false, error: 'Failed to save the record.', status: 500 };
  }

  await writeComplianceAuditEvent(admin, {
    venueId: ctx.venueId,
    eventType: 'record.captured',
    actorType: ctx.actorType,
    actorStaffId: ctx.capturedByStaffId,
    guestId: ctx.guestId,
    complianceRecordId: recordId,
    complianceTypeId: ctx.complianceTypeId,
    metadata: { capture_channel: ctx.captureChannel, result },
  });

  return { ok: true, record: record as Record<string, unknown> };
}

/** Load type (result_type, validity) + current version schema for a staff capture. */
export async function loadStaffCaptureContext(
  admin: SupabaseClient,
  venueId: string,
  complianceTypeId: string,
): Promise<
  | { ok: true; value: { resultType: ComplianceResultType; validityPeriodDays: number | null; versionId: string; formSchema: ComplianceFormSchema } }
  | { ok: false; error: string; status: number }
> {
  const { data: type } = await admin
    .from('compliance_types')
    .select('id, result_type, validity_period_days, current_version_id')
    .eq('id', complianceTypeId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!type) return { ok: false, error: 'Compliance type not found.', status: 404 };

  const t = type as {
    result_type: ComplianceResultType;
    validity_period_days: number | null;
    current_version_id: string | null;
  };

  let versionQuery = admin
    .from('compliance_type_versions')
    .select('id, form_schema')
    .eq('compliance_type_id', complianceTypeId);
  versionQuery = t.current_version_id
    ? versionQuery.eq('id', t.current_version_id)
    : versionQuery.order('version_number', { ascending: false }).limit(1);

  const { data: version } = await versionQuery.maybeSingle();
  if (!version) return { ok: false, error: 'Compliance type has no form version.', status: 409 };

  const parsed = parseFormSchema((version as { form_schema: unknown }).form_schema);
  if (!parsed.ok) return { ok: false, error: 'Stored form schema is invalid.', status: 500 };

  return {
    ok: true,
    value: {
      resultType: t.result_type,
      validityPeriodDays: t.validity_period_days,
      versionId: (version as { id: string }).id,
      formSchema: parsed.schema,
    },
  };
}

export interface RecordListFilters {
  guestId?: string | null;
  complianceTypeId?: string | null;
  bookingId?: string | null;
  status?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
}

/** List records with optional filters, newest first, joined to type name/category. */
export async function listComplianceRecords(
  admin: SupabaseClient,
  venueId: string,
  filters: RecordListFilters,
): Promise<Record<string, unknown>[]> {
  let query = admin
    .from('compliance_records')
    .select(
      'id, guest_id, compliance_type_id, compliance_type_version_id, booking_id, status, result, captured_at, capture_channel, captured_by_staff_id, expires_at, voided_at, notes, compliance_types!inner(name, category)',
    )
    .eq('venue_id', venueId)
    .order('captured_at', { ascending: false });

  if (filters.guestId) query = query.eq('guest_id', filters.guestId);
  if (filters.complianceTypeId) query = query.eq('compliance_type_id', filters.complianceTypeId);
  if (filters.bookingId) query = query.eq('booking_id', filters.bookingId);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.fromDate) query = query.gte('captured_at', filters.fromDate);
  if (filters.toDate) query = query.lte('captured_at', filters.toDate);

  const { data, error } = await query;
  if (error) {
    console.error('[listComplianceRecords] failed:', error.message);
    return [];
  }
  return (data ?? []) as Record<string, unknown>[];
}

/** Void a record (irreversible; reason required) — spec §5.4. */
export async function voidComplianceRecord(
  admin: SupabaseClient,
  params: { venueId: string; staffId: string; recordId: string; reason: string },
): Promise<ServiceResult<Record<string, unknown>>> {
  const { data: existing } = await admin
    .from('compliance_records')
    .select('id, guest_id, status, voided_at')
    .eq('id', params.recordId)
    .eq('venue_id', params.venueId)
    .maybeSingle();
  if (!existing) return { ok: false, error: 'Record not found.', status: 404 };
  if ((existing as { voided_at: string | null }).voided_at) {
    return { ok: false, error: 'Record is already voided.', status: 409 };
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await admin
    .from('compliance_records')
    .update({
      status: 'voided',
      voided_at: now,
      voided_reason: params.reason,
      voided_by_staff_id: params.staffId,
      updated_at: now,
    })
    .eq('id', params.recordId)
    .eq('venue_id', params.venueId)
    .is('voided_at', null) // atomic guard: only the request that actually voids wins
    .select()
    .maybeSingle();
  if (error) {
    console.error('[voidComplianceRecord] failed:', error.message);
    return { ok: false, error: 'Failed to void the record.', status: 500 };
  }
  if (!updated) {
    // A concurrent request voided it first; treat as already-voided rather than erroring.
    return { ok: false, error: 'Record is already voided.', status: 409 };
  }

  await writeComplianceAuditEvent(admin, {
    venueId: params.venueId,
    eventType: 'record.voided',
    actorType: 'staff',
    actorStaffId: params.staffId,
    guestId: (existing as { guest_id: string }).guest_id,
    complianceRecordId: params.recordId,
    metadata: { reason: params.reason },
  });

  return { ok: true, value: updated as Record<string, unknown> };
}
