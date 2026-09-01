import type { SupabaseClient } from '@supabase/supabase-js';
import { getComplianceTypeWithVersion } from '@/lib/compliance/types-service';
import { parseFormSchema, type ComplianceFormSchema, type ComplianceResultType } from '@/lib/compliance/form-schema';
import { captureComplianceRecord } from '@/lib/compliance/records-service';
import { resolveServiceFkColumn } from '@/lib/compliance/requirements-service';

/**
 * Capture of compliance forms a guest completes inline DURING online booking
 * (spec §9.3, Phase 2b). One guest, captured before the booking row exists so the
 * just-created records satisfy the booking gate; `booking_id` is backfilled after the
 * insert via {@link linkBookingComplianceRecords}.
 *
 * Each submission is validated against its type's current version in PUBLIC mode (so
 * staff_only fields are stripped, exactly like the public form link), the type must be an
 * `inline` requirement of a booked service and client-completable, the version the guest
 * saw must still be current, and any `file` response must live under this draft's upload
 * prefix so a submitter cannot point a record at an arbitrary stored object.
 */

export interface BookingComplianceSubmission {
  compliance_type_id: string;
  /** The form version the guest was shown; rejected if the venue has published a newer one since. */
  version_id?: string;
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
    /** Catalog service id(s) being booked: only their `inline` requirements may be captured. */
    serviceIds: string[];
    submissions: BookingComplianceSubmission[];
    /**
     * Per-visit types only (validity 0): the appointment date these forms are being
     * completed for, as YYYY-MM-DD in venue local time. The booking row does not exist yet
     * at capture time, so the date is passed in rather than read back from `booking_id`.
     * For a multi-segment booking pass the LAST date, so one record covers every segment.
     */
    visitDate?: string | null;
    captureIp?: string | null;
    captureUserAgent?: string | null;
  },
): Promise<CaptureSubmissionsResult> {
  const recordIds: string[] = [];
  const allowedFilePrefix = params.draftId
    ? `venues/${params.venueId}/uploads/booking-draft/${params.draftId}/`
    : null;
  if (params.submissions.length === 0) return { ok: true, recordIds };

  // Only a type the booked service(s) collect inline may be captured this way (plan §3.5):
  // otherwise a crafted request could create records of any client-completable type.
  const allowedTypeIds = new Set<string>();
  const serviceIds = [...new Set(params.serviceIds.filter(Boolean))];
  if (serviceIds.length > 0) {
    const column = await resolveServiceFkColumn(admin, params.venueId);
    // Service rows plus the venue-wide rows that apply to every booking (plan §4).
    const [{ data: serviceReqRows }, { data: venueReqRows }] = await Promise.all([
      admin
        .from('service_compliance_requirements')
        .select('compliance_type_id, online_collection')
        .eq('venue_id', params.venueId)
        .in(column, serviceIds),
      admin
        .from('service_compliance_requirements')
        .select('compliance_type_id, online_collection')
        .eq('venue_id', params.venueId)
        .eq('scope', 'venue'),
    ]);
    type ReqRow = { compliance_type_id: string; online_collection?: string | null };
    for (const r of [...((serviceReqRows ?? []) as ReqRow[]), ...((venueReqRows ?? []) as ReqRow[])]) {
      if ((r.online_collection ?? 'confirmation_link') === 'inline') allowedTypeIds.add(r.compliance_type_id);
    }
  }

  for (const sub of params.submissions) {
    if (!allowedTypeIds.has(sub.compliance_type_id)) {
      return {
        ok: false,
        recordIds,
        error: 'This form is not part of this booking.',
        status: 400,
        typeId: sub.compliance_type_id,
      };
    }
    const typeRes = await getComplianceTypeWithVersion(admin, params.venueId, sub.compliance_type_id);
    if (!typeRes.ok || !typeRes.value.version) {
      return { ok: false, recordIds, error: 'Compliance form not found.', status: 400, typeId: sub.compliance_type_id };
    }
    // The guest answered the version they were shown; if the venue published a newer one
    // meanwhile, validating their answers against it could fail on a field they never saw.
    if (sub.version_id && sub.version_id !== typeRes.value.version.id) {
      return {
        ok: false,
        recordIds,
        error: 'This form was updated while you were booking. Please review and complete it again.',
        status: 409,
        typeId: sub.compliance_type_id,
      };
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
        visitDate: params.visitDate ?? null,
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
