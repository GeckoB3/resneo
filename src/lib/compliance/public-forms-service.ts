import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parseFormSchema,
  type ComplianceFormSchema,
  type ComplianceResultType,
} from '@/lib/compliance/form-schema';
import { captureComplianceRecord } from '@/lib/compliance/records-service';
import { writeComplianceAuditEvent } from '@/lib/compliance/audit';
import {
  loadAndResolveServiceRequirements,
  bookingDatetime,
} from '@/lib/compliance/resolve-requirements';
import { resolveServiceFkColumn } from '@/lib/compliance/requirements-service';
import type { ComplianceCaptureChannel } from '@/lib/compliance/constants';

/**
 * Public (unauthenticated) compliance flows: form fetch, single-use submit, and
 * the booking-page pre-check (spec §5.3, §9.2). All use the admin client and
 * enforce every guard in code — these tables have no anon RLS access.
 */

/** Remove staff_only fields so they are never exposed on the public form. */
export function stripStaffOnlyFields(schema: ComplianceFormSchema): ComplianceFormSchema {
  return { ...schema, fields: schema.fields.filter((f) => !f.staff_only) };
}

type LinkRow = {
  id: string;
  venue_id: string;
  guest_id: string;
  compliance_type_id: string;
  compliance_type_version_id: string;
  booking_id: string | null;
  status: string;
  sent_via: string | null;
  expires_at: string;
  prefill: Record<string, unknown> | null;
};

const LINK_COLUMNS =
  'id, venue_id, guest_id, compliance_type_id, compliance_type_version_id, booking_id, status, sent_via, expires_at, prefill';

export type PublicFormUnavailableReason = 'not_found' | 'consumed' | 'revoked' | 'expired';

export interface PublicFormView {
  code: string;
  schema: ComplianceFormSchema;
  prefill: Record<string, unknown>;
  type_name: string;
  venue_name: string;
  expires_at: string;
}

/** Fetch the form schema bound to a link (the issued version, not the current one). */
export async function loadPublicFormByCode(
  admin: SupabaseClient,
  code: string,
): Promise<{ ok: true; value: PublicFormView } | { ok: false; reason: PublicFormUnavailableReason }> {
  const { data: linkData } = await admin
    .from('compliance_form_links')
    .select(LINK_COLUMNS)
    .eq('code', code)
    .maybeSingle();
  if (!linkData) return { ok: false, reason: 'not_found' };
  const link = linkData as LinkRow;

  if (link.status === 'consumed') return { ok: false, reason: 'consumed' };
  if (link.status === 'revoked') return { ok: false, reason: 'revoked' };
  if (link.status === 'expired' || new Date(link.expires_at).getTime() <= Date.now()) {
    if (link.status === 'pending') await expireLink(admin, link);
    return { ok: false, reason: 'expired' };
  }

  const [{ data: version }, { data: type }, { data: venue }] = await Promise.all([
    admin.from('compliance_type_versions').select('form_schema').eq('id', link.compliance_type_version_id).maybeSingle(),
    admin.from('compliance_types').select('name').eq('id', link.compliance_type_id).maybeSingle(),
    admin.from('venues').select('name').eq('id', link.venue_id).maybeSingle(),
  ]);

  const parsed = parseFormSchema((version as { form_schema?: unknown } | null)?.form_schema);
  if (!parsed.ok) return { ok: false, reason: 'not_found' };

  // Track access (best-effort).
  await bumpAccessCount(admin, link.id);

  return {
    ok: true,
    value: {
      code,
      schema: stripStaffOnlyFields(parsed.schema),
      prefill: (link.prefill ?? {}) as Record<string, unknown>,
      type_name: (type as { name?: string } | null)?.name ?? 'Form',
      venue_name: (venue as { name?: string } | null)?.name ?? 'the venue',
      expires_at: link.expires_at,
    },
  };
}

async function bumpAccessCount(admin: SupabaseClient, linkId: string): Promise<void> {
  const { data } = await admin
    .from('compliance_form_links')
    .select('access_count')
    .eq('id', linkId)
    .maybeSingle();
  const current = (data as { access_count?: number } | null)?.access_count ?? 0;
  await admin
    .from('compliance_form_links')
    .update({ access_count: current + 1, last_accessed_at: new Date().toISOString() })
    .eq('id', linkId);
}

async function expireLink(admin: SupabaseClient, link: LinkRow): Promise<void> {
  await admin.from('compliance_form_links').update({ status: 'expired' }).eq('id', link.id).eq('status', 'pending');
  await writeComplianceAuditEvent(admin, {
    venueId: link.venue_id,
    eventType: 'link.expired',
    actorType: 'system',
    guestId: link.guest_id,
    complianceFormLinkId: link.id,
    complianceTypeId: link.compliance_type_id,
  });
}

export interface PublicSubmitResult {
  ok: boolean;
  status: number;
  recordId?: string;
  typeName?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  reason?: PublicFormUnavailableReason | 'already_consumed';
}

/**
 * Guard against client-supplied storage paths that don't belong to this link.
 * `file` fields must reference an object the per-link upload endpoint created
 * (`venues/{venueId}/uploads/{code}/…`); `signature` fields must never carry a
 * path on submit (drawn signatures are uploaded server-side, typed ones have none).
 */
function publicStoragePathsAreSafe(
  schema: ComplianceFormSchema,
  responses: unknown,
  venueId: string,
  code: string,
): { ok: true } | { ok: false; field: string } {
  if (!responses || typeof responses !== 'object') return { ok: true };
  const r = responses as Record<string, unknown>;
  const filePrefix = `venues/${venueId}/uploads/${code}/`;
  for (const field of schema.fields) {
    const v = r[field.id];
    if (!v || typeof v !== 'object') continue;
    const sp = (v as { storage_path?: unknown }).storage_path;
    if (typeof sp !== 'string' || sp.length === 0) continue;
    if (field.type === 'file') {
      if (!sp.startsWith(filePrefix)) return { ok: false, field: field.label };
    } else if (field.type === 'signature') {
      // A submitted signature should never specify its own stored path.
      return { ok: false, field: field.label };
    }
  }
  return { ok: true };
}

/** Submit a public form: validate → atomically claim the link → capture the record. */
export async function submitPublicForm(
  admin: SupabaseClient,
  params: { code: string; responses: unknown; ip: string | null; userAgent: string | null },
): Promise<PublicSubmitResult> {
  const { data: linkData } = await admin
    .from('compliance_form_links')
    .select(LINK_COLUMNS)
    .eq('code', params.code)
    .maybeSingle();
  if (!linkData) return { ok: false, status: 404, reason: 'not_found', error: 'This form link is not valid.' };
  const link = linkData as LinkRow;

  if (link.status !== 'pending') {
    return { ok: false, status: 409, reason: link.status as PublicFormUnavailableReason, error: 'This form is no longer available.' };
  }
  if (new Date(link.expires_at).getTime() <= Date.now()) {
    await expireLink(admin, link);
    return { ok: false, status: 410, reason: 'expired', error: 'This form link has expired.' };
  }

  // Load the bound version + type (result semantics).
  const [{ data: version }, { data: type }] = await Promise.all([
    admin.from('compliance_type_versions').select('id, form_schema').eq('id', link.compliance_type_version_id).maybeSingle(),
    admin
      .from('compliance_types')
      .select('id, name, result_type, validity_period_days')
      .eq('id', link.compliance_type_id)
      .maybeSingle(),
  ]);
  const parsed = parseFormSchema((version as { form_schema?: unknown } | null)?.form_schema);
  if (!parsed.ok || !type) {
    return { ok: false, status: 500, error: 'This form could not be loaded. Please contact the venue.' };
  }
  const typeRow = type as { name: string; result_type: ComplianceResultType; validity_period_days: number | null };

  // Security (§13.3): a public submitter must not be able to reference an arbitrary
  // storage object. File uploads have to live under THIS link's venue+code prefix
  // (the upload endpoint writes there); signatures must arrive as drawn data or typed
  // text (server uploads drawn data) — never a client-set path. Reject otherwise so a
  // record can't be made to point at another venue's/record's special-category file.
  const pathCheck = publicStoragePathsAreSafe(parsed.schema, params.responses, link.venue_id, params.code);
  if (!pathCheck.ok) {
    return {
      ok: false,
      status: 400,
      error: `Please re-attach the upload for “${pathCheck.field}” and try again.`,
    };
  }

  // Atomically claim the link (pending → consumed). A concurrent submit loses here.
  const { data: claimed } = await admin
    .from('compliance_form_links')
    .update({ status: 'consumed', consumed_at: new Date().toISOString() })
    .eq('id', link.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (!claimed) {
    return { ok: false, status: 409, reason: 'already_consumed', error: 'This form has already been submitted.' };
  }

  const channel: ComplianceCaptureChannel = link.sent_via === 'sms' ? 'client_sms' : 'client_email';

  const captured = await captureComplianceRecord(
    admin,
    {
      venueId: link.venue_id,
      guestId: link.guest_id,
      complianceTypeId: link.compliance_type_id,
      complianceTypeVersionId: link.compliance_type_version_id,
      resultType: typeRow.result_type,
      validityPeriodDays: typeRow.validity_period_days,
      formSchema: parsed.schema,
      bookingId: link.booking_id,
      captureChannel: channel,
      capturedByStaffId: null,
      captureIp: params.ip,
      captureUserAgent: params.userAgent,
      mode: 'public',
      actorType: 'client',
    },
    params.responses,
  );

  if (!captured.ok) {
    // Release the claim so the guest can correct and resubmit — but only un-claim the
    // row THIS request claimed (status guard), so we never resurrect a link that a
    // concurrent path expired/revoked in the meantime.
    await admin
      .from('compliance_form_links')
      .update({ status: 'pending', consumed_at: null })
      .eq('id', link.id)
      .eq('status', 'consumed');
    return { ok: false, status: captured.status, error: captured.error, fieldErrors: captured.fieldErrors };
  }

  const recordId = captured.record.id as string;
  await admin.from('compliance_form_links').update({ consumed_record_id: recordId }).eq('id', link.id);
  await writeComplianceAuditEvent(admin, {
    venueId: link.venue_id,
    eventType: 'link.consumed',
    actorType: 'client',
    guestId: link.guest_id,
    complianceFormLinkId: link.id,
    complianceTypeId: link.compliance_type_id,
    complianceRecordId: recordId,
  });

  return { ok: true, status: 201, recordId, typeName: typeRow.name };
}

// ─── Pre-check (booking page, §5.1.1 / §9.2) ────────────────────────────────────

export interface PreCheckRequirement {
  compliance_type_id: string;
  compliance_type_name: string;
  enforcement: string;
  lock_period_hours: number | null;
  /** Whether a client can complete this form online at all (drives inline vs "contact venue"). */
  client_online: boolean;
  online_collection: string;
  /** Venue's guidance shown when a booking is blocked by this unmet requirement. */
  online_unmet_message: string | null;
}

type PreCheckTypeJoin = {
  name?: string;
  is_active?: boolean;
  capture_methods?: string[];
  online_unmet_message?: string | null;
};

/** GET pre-check: a service's requirements + enforcement, with no guest identity. */
export async function publicServiceRequirements(
  admin: SupabaseClient,
  venueId: string,
  serviceId: string,
): Promise<PreCheckRequirement[]> {
  const column = await resolveServiceFkColumn(admin, venueId);
  const { data, error } = await admin
    .from('service_compliance_requirements')
    .select(
      'compliance_type_id, enforcement, lock_period_hours, online_collection, compliance_types!inner(name, is_active, capture_methods, online_unmet_message)',
    )
    .eq('venue_id', venueId)
    .eq(column, serviceId);
  if (error) {
    console.error('[publicServiceRequirements] failed:', error.message);
    return [];
  }
  return (data ?? [])
    .map((row) => {
      const r = row as {
        compliance_type_id: string;
        enforcement: string;
        lock_period_hours: number | null;
        online_collection: string | null;
        compliance_types: PreCheckTypeJoin | PreCheckTypeJoin[] | null;
      };
      const t = Array.isArray(r.compliance_types) ? r.compliance_types[0] : r.compliance_types;
      return {
        compliance_type_id: r.compliance_type_id,
        compliance_type_name: t?.name ?? 'Compliance record',
        enforcement: r.enforcement,
        lock_period_hours: r.lock_period_hours,
        client_online: (t?.capture_methods ?? []).includes('client_online'),
        online_collection: r.online_collection ?? 'confirmation_link',
        online_unmet_message: t?.online_unmet_message ?? null,
      };
    });
  // audit M6: do NOT filter out archived types here. The booking-create gate still enforces an
  // archived-type requirement (the requirement row persists when only the type is archived), so
  // hiding it from the pre-check produced a surprise 409. Surfacing it keeps the two consistent.
}

export interface InlineFormRequirement {
  compliance_type_id: string;
  compliance_type_name: string;
  enforcement: string;
  lock_period_hours: number | null;
  version_id: string;
  /** Current version's form schema with staff_only fields removed (never exposed online). */
  form_schema: ComplianceFormSchema;
}

/**
 * GET inline-forms (§9.3, Phase 2b): a service's requirements that are client-completable
 * AND set to `online_collection = 'inline'`, each with its current-version form schema
 * (staff_only stripped) so the booking flow can render the form. Archived types and
 * staff-only / email-link / none requirements are excluded.
 */
export async function publicInlineFormsForService(
  admin: SupabaseClient,
  venueId: string,
  serviceId: string,
): Promise<InlineFormRequirement[]> {
  const column = await resolveServiceFkColumn(admin, venueId);
  const { data, error } = await admin
    .from('service_compliance_requirements')
    .select(
      'compliance_type_id, enforcement, lock_period_hours, online_collection, compliance_types!inner(name, is_active, capture_methods, current_version_id)',
    )
    .eq('venue_id', venueId)
    .eq(column, serviceId);
  if (error) {
    console.error('[publicInlineFormsForService] failed:', error.message);
    return [];
  }

  type TypeJoin = {
    name?: string;
    is_active?: boolean;
    capture_methods?: string[];
    current_version_id?: string | null;
  };
  const eligible = (data ?? [])
    .map((row) => {
      const r = row as {
        compliance_type_id: string;
        enforcement: string;
        lock_period_hours: number | null;
        online_collection: string | null;
        compliance_types: TypeJoin | TypeJoin[] | null;
      };
      const t = Array.isArray(r.compliance_types) ? r.compliance_types[0] : r.compliance_types;
      return {
        compliance_type_id: r.compliance_type_id,
        compliance_type_name: t?.name ?? 'Compliance record',
        enforcement: r.enforcement,
        lock_period_hours: r.lock_period_hours,
        online_collection: r.online_collection ?? 'confirmation_link',
        is_active: t?.is_active ?? true,
        capture_methods: t?.capture_methods ?? [],
        current_version_id: t?.current_version_id ?? null,
      };
    })
    .filter(
      (r) =>
        r.is_active &&
        r.online_collection === 'inline' &&
        r.capture_methods.includes('client_online') &&
        Boolean(r.current_version_id),
    );
  if (eligible.length === 0) return [];

  const versionIds = [...new Set(eligible.map((r) => r.current_version_id as string))];
  const { data: versions } = await admin
    .from('compliance_type_versions')
    .select('id, form_schema')
    .eq('venue_id', venueId)
    .in('id', versionIds);
  const schemaByVersion = new Map<string, ComplianceFormSchema>();
  for (const v of (versions ?? []) as Array<{ id: string; form_schema: unknown }>) {
    const parsed = parseFormSchema(v.form_schema);
    if (parsed.ok) schemaByVersion.set(v.id, stripStaffOnlyFields(parsed.schema));
  }

  const out: InlineFormRequirement[] = [];
  for (const r of eligible) {
    const schema = schemaByVersion.get(r.current_version_id as string);
    if (!schema) continue;
    out.push({
      compliance_type_id: r.compliance_type_id,
      compliance_type_name: r.compliance_type_name,
      enforcement: r.enforcement,
      lock_period_hours: r.lock_period_hours,
      version_id: r.current_version_id as string,
      form_schema: schema,
    });
  }
  return out;
}

export type PreCheckState = 'SATISFIED' | 'MISSING' | 'EXPIRED' | 'LOCK_PASSED';

export interface PreCheckResolved {
  compliance_type_id: string;
  compliance_type_name: string;
  enforcement: string;
  state: PreCheckState;
}

/**
 * POST pre-check: resolve whether the guest identified by email already has
 * valid records. Without a chosen slot we resolve against "now" as the booking
 * reference (sufficient for SATISFIED/MISSING/EXPIRED; LOCK_PASSED is surfaced
 * when an otherwise-valid record fell inside the lock window).
 */
export async function publicPreCheckForGuest(
  admin: SupabaseClient,
  params: { venueId: string; serviceId: string; email: string },
): Promise<PreCheckResolved[]> {
  const { data: guest } = await admin
    .from('guests')
    .select('id')
    .eq('venue_id', params.venueId)
    .ilike('email', params.email.trim())
    .maybeSingle();

  const column = await resolveServiceFkColumn(admin, params.venueId);
  const resolution = await loadAndResolveServiceRequirements(admin, {
    venueId: params.venueId,
    guestId: (guest as { id?: string } | null)?.id ?? null,
    appointmentServiceId: column === 'appointment_service_id' ? params.serviceId : null,
    serviceItemId: column === 'service_item_id' ? params.serviceId : null,
    bookingDatetime: new Date(),
  });

  return resolution.resolved.map((r) => {
    let state: PreCheckState;
    if (r.state === 'satisfied' || r.state === 'expiring_soon') state = 'SATISFIED';
    else if (r.state === 'missing') state = 'MISSING';
    else state = r.lockBlocked ? 'LOCK_PASSED' : 'EXPIRED';
    return {
      compliance_type_id: r.requirement.compliance_type_id,
      compliance_type_name: r.requirement.compliance_type_name,
      enforcement: r.requirement.enforcement,
      state,
    };
  });
}

/** Re-exported for callers building booking datetimes (kept local to avoid deep imports). */
export { bookingDatetime };
