import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parseFormSchema,
  type ComplianceFormSchema,
  type ComplianceResultType,
} from '@/lib/compliance/form-schema';
import { captureComplianceRecord } from '@/lib/compliance/records-service';
import { writeComplianceAuditEvent } from '@/lib/compliance/audit';
import {
  bookingDatetime,
  resolveRequirements,
  type ResolverRecord,
  type ResolverRequirement,
} from '@/lib/compliance/resolve-requirements';
import { resolveServiceFkColumn } from '@/lib/compliance/requirements-service';
import { complianceEnabledForVenue } from '@/lib/compliance/venue-enabled';
import { findGuestByEmail } from '@/lib/guests';
import type {
  ComplianceCaptureChannel,
  ComplianceEnforcement,
  ComplianceOnlineCollection,
  ComplianceRequirementScope,
} from '@/lib/compliance/constants';

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

// ─── Booking requirements (booking page, plan §3) ───────────────────────────────

export type PreCheckState = 'SATISFIED' | 'MISSING' | 'EXPIRED' | 'LOCK_PASSED';

export interface BookingRequirement {
  compliance_type_id: string;
  compliance_type_name: string;
  enforcement: ComplianceEnforcement;
  lock_period_hours: number | null;
  online_collection: ComplianceOnlineCollection;
  /** Whether a client can complete this form online at all (drives inline vs "contact venue"). */
  client_online: boolean;
  /** Venue's guidance shown when a booking is blocked by this unmet requirement. */
  online_unmet_message: string | null;
  /** `venue` when the venue asks for this on every booking (plan §4); `service` otherwise. */
  scope: ComplianceRequirementScope;
  /** Resolved against the identified guest; null when no identity was supplied. */
  state: PreCheckState | null;
  /** The form to complete inline: present only when this guest still needs it and can do it here. */
  form: { version_id: string; form_schema: ComplianceFormSchema } | null;
}

export interface BookingRequirementsResult {
  /** True when a well-formed email was supplied, so `state` is meaningful. */
  identity_known: boolean;
  requirements: BookingRequirement[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Worst wins when a type is required by more than one service. LOCK_PASSED outranks the
 *  other unmet states because it also means "cannot be fixed online now". */
const STATE_RANK: Record<PreCheckState, number> = { SATISFIED: 0, EXPIRED: 1, MISSING: 2, LOCK_PASSED: 3 };
const ENFORCEMENT_RANK: Record<ComplianceEnforcement, number> = {
  warn_staff: 0,
  warn_client: 1,
  block_online: 2,
  block_all: 3,
};
const MS_PER_HOUR = 60 * 60 * 1000;

function toDate(value: unknown): Date | null {
  if (value == null) return null;
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

type BookingTypeRow = {
  id: string;
  name?: string | null;
  is_active?: boolean | null;
  capture_methods?: string[] | null;
  online_unmet_message?: string | null;
  current_version_id?: string | null;
  validity_period_days?: number | null;
  result_type?: string | null;
};

type BookingRequirementRow = {
  id: string;
  compliance_type_id: string;
  enforcement: ComplianceEnforcement;
  lock_period_hours: number | null;
  online_collection: ComplianceOnlineCollection | null;
  scope?: ComplianceRequirementScope | null;
};

/**
 * Everything the public details step needs in one answer (plan §3.2): the compliance
 * requirements of the chosen service(s), each resolved against the guest the typed
 * email identifies (when there is one), with the inline form attached for the ones
 * this guest still has to complete here.
 *
 * Identity follows booking creation exactly: email only, normalised, exact match
 * ({@link findGuestByEmail}). The reference time is the chosen slot when given, so lock
 * periods and expiry are judged against the actual booking. Fail-quiet: any lookup
 * error yields no requirements, because the create routes re-check regardless.
 */
export async function publicBookingRequirements(
  admin: SupabaseClient,
  params: {
    venueId: string;
    serviceIds: string[];
    email?: string | null;
    bookingDate?: string | null;
    bookingTime?: string | null;
    now?: Date;
  },
): Promise<BookingRequirementsResult> {
  const serviceIds = [...new Set(params.serviceIds.filter(Boolean))];
  const email = (params.email ?? '').trim();
  const identityKnown = EMAIL_RE.test(email);
  const empty: BookingRequirementsResult = { identity_known: identityKnown, requirements: [] };
  if (serviceIds.length === 0) return empty;
  if (!(await complianceEnabledForVenue(admin, params.venueId))) return empty;

  const column = await resolveServiceFkColumn(admin, params.venueId);
  const REQ_SELECT = 'id, compliance_type_id, enforcement, lock_period_hours, online_collection, scope';
  const [{ data: serviceReqRows, error: reqErr }, { data: venueReqRows, error: venueErr }] = await Promise.all([
    admin.from('service_compliance_requirements').select(REQ_SELECT).eq('venue_id', params.venueId).in(column, serviceIds),
    admin.from('service_compliance_requirements').select(REQ_SELECT).eq('venue_id', params.venueId).eq('scope', 'venue'),
  ]);
  if (reqErr) {
    console.error('[publicBookingRequirements] requirement load failed:', reqErr.message, { venueId: params.venueId });
    return empty;
  }
  if (venueErr) {
    console.error('[publicBookingRequirements] venue-wide load failed:', venueErr.message, { venueId: params.venueId });
  }
  // Venue-wide rows apply to every booking (plan §4); a service row for the same type wins,
  // so only venue rows for types no chosen service names are kept.
  const serviceRows = ((serviceReqRows ?? []) as BookingRequirementRow[]).map((r) => ({ ...r, scope: 'service' as const }));
  const coveredTypes = new Set(serviceRows.map((r) => r.compliance_type_id));
  const venueRows = ((venueReqRows ?? []) as BookingRequirementRow[])
    .filter((r) => !coveredTypes.has(r.compliance_type_id))
    .map((r) => ({ ...r, scope: 'venue' as const }));
  const rows: BookingRequirementRow[] = [...serviceRows, ...venueRows];
  if (rows.length === 0) return empty;

  const typeIds = [...new Set(rows.map((r) => r.compliance_type_id))];
  const { data: typeRows } = await admin
    .from('compliance_types')
    .select('id, name, is_active, capture_methods, online_unmet_message, current_version_id, validity_period_days, result_type')
    .eq('venue_id', params.venueId)
    .in('id', typeIds);
  const typeById = new Map<string, BookingTypeRow>();
  for (const t of (typeRows ?? []) as BookingTypeRow[]) typeById.set(t.id, t);

  const guest = identityKnown ? await findGuestByEmail(admin, params.venueId, email) : null;

  const now = params.now ?? new Date();
  const at = params.bookingDate ? bookingDatetime(params.bookingDate, params.bookingTime ?? null) : now;

  let records: ResolverRecord[] = [];
  if (guest) {
    const { data: recRows } = await admin
      .from('compliance_records')
      .select('id, compliance_type_id, status, expires_at, voided_at, captured_at, result, captured_by_staff_id')
      .eq('venue_id', params.venueId)
      .eq('guest_id', guest.id)
      .in('compliance_type_id', typeIds);
    records = ((recRows ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      compliance_type_id: r.compliance_type_id as string,
      status: r.status as ResolverRecord['status'],
      expires_at: toDate(r.expires_at),
      voided_at: toDate(r.voided_at),
      captured_at: toDate(r.captured_at) ?? new Date(0),
      result: (r.result as string | null) ?? null,
      captured_by_staff_id: (r.captured_by_staff_id as string | null) ?? null,
      result_type: (typeById.get(r.compliance_type_id as string)?.result_type as ComplianceResultType) ?? 'completed',
    }));
  }

  // Merge per type across services: the strictest enforcement, the longest lock period and
  // the worst state win, so a type required by two segments is asked for once and never
  // under-reported.
  const merged = new Map<string, BookingRequirement>();
  for (const row of rows) {
    const t = typeById.get(row.compliance_type_id);
    const onlineCollection: ComplianceOnlineCollection = row.online_collection ?? 'confirmation_link';
    const requirement: ResolverRequirement = {
      id: row.id,
      compliance_type_id: row.compliance_type_id,
      compliance_type_name: t?.name ?? 'Compliance record',
      enforcement: row.enforcement,
      lock_period_hours: row.lock_period_hours,
      type_is_active: t?.is_active ?? true,
      validity_period_days: t?.validity_period_days ?? null,
      online_collection: onlineCollection,
    };
    let state: PreCheckState | null = null;
    if (identityKnown) {
      const [resolved] = resolveRequirements([requirement], records, at, now);
      if (resolved.state === 'satisfied' || resolved.state === 'expiring_soon') state = 'SATISFIED';
      else if (resolved.lockBlocked) state = 'LOCK_PASSED';
      else state = resolved.state === 'expired' ? 'EXPIRED' : 'MISSING';
      // Unmet with the online window already closed: a form completed now could not satisfy
      // the lock period, so do not offer one; the notice says to contact the venue instead.
      if (
        state !== 'SATISFIED' &&
        row.lock_period_hours !== null &&
        at.getTime() - now.getTime() < row.lock_period_hours * MS_PER_HOUR
      ) {
        state = 'LOCK_PASSED';
      }
    }
    const entry: BookingRequirement = {
      compliance_type_id: row.compliance_type_id,
      compliance_type_name: requirement.compliance_type_name,
      enforcement: row.enforcement,
      lock_period_hours: row.lock_period_hours,
      online_collection: onlineCollection,
      client_online: (t?.capture_methods ?? []).includes('client_online'),
      online_unmet_message: t?.online_unmet_message ?? null,
      scope: row.scope ?? 'service',
      state,
      form: null,
    };
    const prev = merged.get(row.compliance_type_id);
    if (!prev) {
      merged.set(row.compliance_type_id, entry);
      continue;
    }
    merged.set(row.compliance_type_id, {
      ...prev,
      enforcement: ENFORCEMENT_RANK[entry.enforcement] > ENFORCEMENT_RANK[prev.enforcement] ? entry.enforcement : prev.enforcement,
      lock_period_hours:
        prev.lock_period_hours === null || entry.lock_period_hours === null
          ? (prev.lock_period_hours ?? entry.lock_period_hours)
          : Math.max(prev.lock_period_hours, entry.lock_period_hours),
      // `inline` on any row means the form can be collected here.
      online_collection: prev.online_collection === 'inline' || entry.online_collection === 'inline' ? 'inline' : prev.online_collection,
      state:
        prev.state === null || entry.state === null
          ? (prev.state ?? entry.state)
          : STATE_RANK[entry.state] > STATE_RANK[prev.state]
            ? entry.state
            : prev.state,
    });
  }

  // Attach the form only for what this guest still needs and can complete here.
  const needForm = [...merged.values()].filter((r) => {
    if (r.state !== 'MISSING' && r.state !== 'EXPIRED') return false;
    if (r.online_collection !== 'inline' || !r.client_online) return false;
    const t = typeById.get(r.compliance_type_id);
    return (t?.is_active ?? true) && Boolean(t?.current_version_id);
  });
  if (needForm.length > 0) {
    const versionIds = [...new Set(needForm.map((r) => typeById.get(r.compliance_type_id)!.current_version_id as string))];
    const { data: versions } = await admin
      .from('compliance_type_versions')
      .select('id, form_schema')
      .eq('venue_id', params.venueId)
      .in('id', versionIds);
    const schemaByVersion = new Map<string, ComplianceFormSchema>();
    for (const v of (versions ?? []) as Array<{ id: string; form_schema: unknown }>) {
      const parsed = parseFormSchema(v.form_schema);
      if (parsed.ok) schemaByVersion.set(v.id, stripStaffOnlyFields(parsed.schema));
    }
    for (const r of needForm) {
      const versionId = typeById.get(r.compliance_type_id)!.current_version_id as string;
      const schema = schemaByVersion.get(versionId);
      if (schema) merged.set(r.compliance_type_id, { ...r, form: { version_id: versionId, form_schema: schema } });
    }
  }

  return { identity_known: identityKnown, requirements: [...merged.values()] };
}

/** Re-exported for callers building booking datetimes (kept local to avoid deep imports). */
export { bookingDatetime };
