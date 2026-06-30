import type { SupabaseClient } from '@supabase/supabase-js';
import { getComplianceTypeWithVersion } from '@/lib/compliance/types-service';
import { parseFormSchema, type ComplianceFormSchema, type ComplianceResultType } from '@/lib/compliance/form-schema';
import { captureComplianceRecord } from '@/lib/compliance/records-service';

/**
 * Capture of compliance forms a guest completes inline DURING online booking
 * (spec §9.3, Phase 2b). One guest, captured before the booking row exists so the
 * just-created records satisfy the booking gate; `booking_id` is backfilled after the
 * insert via {@link linkBookingComplianceRecords}.
 *
 * Each submission is validated against its type's current version in PUBLIC mode (so
 * staff_only fields are stripped, exactly like the public form link), the type must be
 * client-completable, and any `file` response must live under this draft's upload prefix
 * so a submitter cannot point a record at an arbitrary stored object.
 */

export interface BookingComplianceSubmission {
  compliance_type_id: string;
  responses: Record<string, unknown>;
}

export type CaptureSubmissionsResult =
  | { ok: true; recordIds: string[] }
  | { ok: false; recordIds: string[]; error: string; status: number; typeId: string; fieldErrors?: Record<string, string> };

/**
 * A submitted `file` response must reference this draft's upload prefix; a `signature`
 * response must never carry a pre-set storage path (it carries drawn data / typed text,
 * uploaded server-side at capture). `allowedFilePrefix` null => no file uploads permitted.
 */
export function submissionStoragePathsAreSafe(
  schema: ComplianceFormSchema,
  responses: Record<string, unknown>,
  allowedFilePrefix: string | null,
): { ok: true } | { ok: false; field: string } {
  for (const field of schema.fields) {
    const v = responses[field.id];
    if (!v || typeof v !== 'object') continue;
    const sp = (v as { storage_path?: unknown }).storage_path;
    if (typeof sp !== 'string' || sp.length === 0) continue;
    if (field.type === 'file') {
      if (allowedFilePrefix === null || !sp.startsWith(allowedFilePrefix)) {
        return { ok: false, field: field.label };
      }
    } else if (field.type === 'signature') {
      return { ok: false, field: field.label };
    }
  }
  return { ok: true };
}

export async function captureBookingComplianceSubmissions(
  admin: SupabaseClient,
  params: {
    venueId: string;
    guestId: string;
    /** Client draft id used for any pre-booking file uploads; null when no files were uploaded. */
    draftId: string | null;
    submissions: BookingComplianceSubmission[];
    captureIp?: string | null;
    captureUserAgent?: string | null;
  },
): Promise<CaptureSubmissionsResult> {
  const recordIds: string[] = [];
  const allowedFilePrefix = params.draftId
    ? `venues/${params.venueId}/uploads/booking-draft/${params.draftId}/`
    : null;

  for (const sub of params.submissions) {
    const typeRes = await getComplianceTypeWithVersion(admin, params.venueId, sub.compliance_type_id);
    if (!typeRes.ok || !typeRes.value.version) {
      return { ok: false, recordIds, error: 'Compliance form not found.', status: 400, typeId: sub.compliance_type_id };
    }
    const type = typeRes.value.type as unknown as {
      result_type: ComplianceResultType;
      validity_period_days: number | null;
      capture_methods?: string[];
    };

    // A guest can only complete a form the venue lets clients complete online — never a
    // staff-only record like a patch test (which they cannot self-certify).
    if (!(type.capture_methods ?? []).includes('client_online')) {
      return {
        ok: false,
        recordIds,
        error: 'This form can only be completed in venue.',
        status: 400,
        typeId: sub.compliance_type_id,
      };
    }

    const parsed = parseFormSchema(typeRes.value.version.form_schema);
    if (!parsed.ok) {
      return { ok: false, recordIds, error: 'Compliance form is misconfigured.', status: 500, typeId: sub.compliance_type_id };
    }

    const safe = submissionStoragePathsAreSafe(parsed.schema, sub.responses, allowedFilePrefix);
    if (!safe.ok) {
      return {
        ok: false,
        recordIds,
        error: `Unexpected file for "${safe.field}". Please re-upload it.`,
        status: 400,
        typeId: sub.compliance_type_id,
      };
    }

    const captured = await captureComplianceRecord(
      admin,
      {
        venueId: params.venueId,
        guestId: params.guestId,
        complianceTypeId: sub.compliance_type_id,
        complianceTypeVersionId: typeRes.value.version.id,
        resultType: type.result_type,
        validityPeriodDays: type.validity_period_days,
        formSchema: parsed.schema,
        bookingId: null,
        captureChannel: 'client_booking',
        capturedByStaffId: null,
        captureIp: params.captureIp ?? null,
        captureUserAgent: params.captureUserAgent ?? null,
        mode: 'public',
        actorType: 'client',
      },
      sub.responses,
    );
    if (!captured.ok) {
      return {
        ok: false,
        recordIds,
        error: captured.error,
        status: captured.status,
        fieldErrors: captured.fieldErrors,
        typeId: sub.compliance_type_id,
      };
    }
    recordIds.push((captured.record as { id: string }).id);
  }

  return { ok: true, recordIds };
}

/** Backfill `booking_id` on records captured during booking (best-effort, never throws). */
export async function linkBookingComplianceRecords(
  admin: SupabaseClient,
  params: { venueId: string; recordIds: string[]; bookingId: string },
): Promise<void> {
  if (params.recordIds.length === 0) return;
  const { error } = await admin
    .from('compliance_records')
    .update({ booking_id: params.bookingId, updated_at: new Date().toISOString() })
    .eq('venue_id', params.venueId)
    .in('id', params.recordIds);
  if (error) console.error('[linkBookingComplianceRecords] failed:', error.message);
}
