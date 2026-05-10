import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveVenueMode } from '@/lib/venue-mode';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import { downloadAndParseCsv } from '@/lib/import/parse-storage-csv';
import { applyMappingsToDataRow, slugCustomFieldKey, type DbMappingRow } from '@/lib/import/apply-mappings';
import {
  durationMinutesBetweenTimes,
  mapImportBookingStatus,
  normaliseBoolean,
  normaliseEmail,
  normalisePhoneUk,
  parseDateString,
  parseTimeString,
  parseCurrencyPence,
  parseIntSafe,
  resolveDepositFromImport,
  splitFullName,
  todayIsoLocal,
} from '@/lib/import/normalize';
import {
  findBookingIdByExternalRef,
  findGuestIdByExternalRef,
  IMPORT_REF_PROVIDER_PHOREST,
  insertBookingExternalRef,
  upsertGuestExternalRef,
} from '@/lib/import/external-refs';
import { normaliseGuestTagsInput } from '@/lib/guests/tags';
import { getDefaultAreaIdForVenue } from '@/lib/areas/resolve-default-area';
import type { BookingModel } from '@/types/booking-models';

function hashGuest(email: string | null, phone: string | null): string | null {
  if (!email && !phone) return null;
  return createHash('sha256').update(`${email ?? ''}|${phone ?? ''}`).digest('hex');
}

type IssueRow = {
  id: string;
  file_id: string;
  row_number: number;
  severity: string;
  issue_type: string;
  user_decision: string | null;
};

function issueKey(fileId: string, row: number) {
  return `${fileId}:${row}`;
}

function buildIssueMap(issues: IssueRow[]): Map<string, IssueRow[]> {
  const m = new Map<string, IssueRow[]>();
  for (const i of issues) {
    const k = issueKey(i.file_id, i.row_number);
    const list = m.get(k) ?? [];
    list.push(i);
    m.set(k, list);
  }
  return m;
}

function rowShouldSkip(list: IssueRow[] | undefined): boolean {
  if (!list?.length) return false;
  for (const iss of list) {
    if (iss.severity === 'error') {
      if (
        [
          'duplicate_email',
          'duplicate_phone',
          'missing_required',
          'duplicate_external_client_id',
          'duplicate_external_appointment_id',
        ].includes(iss.issue_type)
      )
        return true;
      if (iss.issue_type === 'email_invalid' && iss.user_decision !== 'import_anyway') return true;
    }
    if (iss.severity === 'warning' && iss.issue_type === 'existing_client') {
      if (iss.user_decision === 'update_existing') continue;
      if (!iss.user_decision || iss.user_decision === 'skip') return true;
    }
  }
  return false;
}

function shouldUpdateExisting(list: IssueRow[] | undefined): boolean {
  return Boolean(list?.some((i) => i.issue_type === 'existing_client' && i.user_decision === 'update_existing'));
}

/** Suppress duplicate confirmations; sentinel reminder timestamps when inside reminder windows. */
function bookingImportCommsFields(dateIso: string, timeForDb: string): Record<string, unknown> {
  const t = timeForDb.length >= 8 ? timeForDb : `${timeForDb.slice(0, 5)}:00`;
  const start = new Date(`${dateIso}T${t}`);
  if (Number.isNaN(start.getTime())) {
    return { suppress_import_comms: true };
  }
  const hours = (start.getTime() - Date.now()) / 3_600_000;
  const o: Record<string, unknown> = { suppress_import_comms: true };
  if (hours <= 24) {
    o.reminder_sent_at = new Date().toISOString();
    o.final_reminder_sent_at = new Date().toISOString();
  } else if (hours <= 48) {
    o.reminder_sent_at = new Date().toISOString();
  }
  return o;
}

async function ensureCustomClientFieldDefinitions(
  admin: SupabaseClient,
  venueId: string,
  maps: DbMappingRow[],
) {
  const seen = new Set<string>();
  for (const m of maps) {
    if (m.action !== 'custom' || !m.custom_field_name?.trim()) continue;
    const key = slugCustomFieldKey(m.custom_field_name);
    if (seen.has(key)) continue;
    seen.add(key);
    const ft = (m.custom_field_type ?? 'text') as string;
    if (!['text', 'number', 'date', 'boolean'].includes(ft)) continue;
    const { error } = await admin.from('custom_client_fields').upsert(
      {
        venue_id: venueId,
        field_name: m.custom_field_name.trim(),
        field_key: key,
        field_type: ft,
        is_active: true,
      },
      { onConflict: 'venue_id,field_key' },
    );
    if (error) console.error('[import execute] custom_client_fields', error);
  }
}

export async function runImportExecute(
  admin: SupabaseClient,
  sessionId: string,
  venueId: string,
  staffId: string,
): Promise<void> {
  const { data: session } = await admin
    .from('import_sessions')
    .select('id, session_settings, total_rows, detected_platform')
    .eq('id', sessionId)
    .eq('venue_id', venueId)
    .single();

  if (!session) throw new Error('Session not found');

  const refProvider =
    (session as { detected_platform?: string | null }).detected_platform === 'phorest'
      ? IMPORT_REF_PROVIDER_PHOREST
      : null;

  const settings = (session.session_settings ?? {}) as {
    ambiguous_date_format?: 'dd/MM/yyyy' | 'MM/dd/yyyy' | null;
  };
  const datePref = settings.ambiguous_date_format ?? null;

  const venueMode = await resolveVenueMode(admin, venueId);
  const bookingModel = venueMode.bookingModel;
  const unified = isUnifiedSchedulingVenue(bookingModel);

  const { data: files } = await admin
    .from('import_files')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at');

  const { data: mappingRows } = await admin
    .from('import_column_mappings')
    .select('*')
    .eq('session_id', sessionId);

  const { data: issueRows } = await admin
    .from('import_validation_issues')
    .select('id, file_id, row_number, severity, issue_type, user_decision')
    .eq('session_id', sessionId);

  const issueMap = buildIssueMap((issueRows ?? []) as IssueRow[]);

  const byFile = new Map<string, DbMappingRow[]>();
  for (const m of mappingRows ?? []) {
    const fid = (m as { file_id: string }).file_id;
    const list = byFile.get(fid) ?? [];
    list.push(m as DbMappingRow);
    byFile.set(fid, list);
  }

  let importedClients = 0;
  let importedBookings = 0;
  let skipped = 0;
  let updatedExisting = 0;
  let processed = 0;

  const totalRows =
    (files ?? []).reduce((acc, f) => {
      const ft = (f as { file_type?: string }).file_type;
      if (ft === 'staff') return acc;
      return acc + ((f as { row_count?: number }).row_count ?? 0);
    }, 0) ||
    (session as { total_rows?: number }).total_rows ||
    0;

  await admin
    .from('import_sessions')
    .update({
      status: 'importing',
      started_at: new Date().toISOString(),
      progress_total: totalRows,
      progress_processed: 0,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  const clientFiles = (files ?? []).filter((f) => {
    const t = (f as { file_type: string }).file_type;
    return t === 'clients' || t === 'unknown';
  });
  const bookingFiles = (files ?? []).filter((f) => (f as { file_type: string }).file_type === 'bookings');

  async function bumpProgress() {
    processed += 1;
    await admin
      .from('import_sessions')
      .update({ progress_processed: processed, updated_at: new Date().toISOString() })
      .eq('id', sessionId);
  }

  for (const file of clientFiles) {
    const f = file as { id: string; storage_path: string };
    const maps = byFile.get(f.id) ?? [];
    await ensureCustomClientFieldDefinitions(admin, venueId, maps);
    const parsed = await downloadAndParseCsv(admin, f.storage_path);

    for (let i = 0; i < parsed.rows.length; i++) {
      const rowNum = i + 1;
      const row = parsed.rows[i]!;
      const issues = issueMap.get(issueKey(f.id, rowNum));

      if (rowShouldSkip(issues)) {
        skipped += 1;
        await bumpProgress();
        continue;
      }

      const { targets, custom } = applyMappingsToDataRow(row, maps);
      let fn = targets.first_name?.trim() ?? '';
      let ln = targets.last_name?.trim() ?? '';
      if ((!fn || !ln) && targets.full_name?.trim()) {
        const sp = splitFullName(targets.full_name);
        fn = fn || sp.first;
        ln = ln || sp.last;
      }
      if (!fn || !ln) {
        skipped += 1;
        await bumpProgress();
        continue;
      }

      const email = normaliseEmail(targets.email ?? null);
      const ph = normalisePhoneUk(targets.phone ?? null);

      const tagsRaw = targets.tags?.split(/[,;]/).map((t) => t.trim()).filter(Boolean) ?? [];
      const tags = normaliseGuestTagsInput(tagsRaw);

      const marketing = targets.marketing_consent?.trim();
      let marketingOptOut: boolean | null = null;
      if (marketing) {
        const x = marketing.toLowerCase();
        if (['yes', 'true', '1', 'y'].includes(x)) marketingOptOut = false;
        else if (['no', 'false', '0', 'n'].includes(x)) marketingOptOut = true;
      }
      if (marketingOptOut === null && targets.email_marketing_consent?.trim()) {
        const emOpt = normaliseBoolean(targets.email_marketing_consent);
        if (emOpt === true) marketingOptOut = false;
        if (emOpt === false) marketingOptOut = true;
      }

      const customFields: Record<string, unknown> = { ...custom };
      if (targets.notes?.trim()) customFields.import_client_notes = targets.notes.trim();
      if (targets.gender?.trim()) customFields.gender = targets.gender.trim();
      if (targets.address?.trim()) customFields.address = targets.address.trim();
      if (targets.postcode?.trim()) customFields.postcode = targets.postcode.trim();
      const landPh = normalisePhoneUk(targets.landline ?? null);
      if (landPh.e164) customFields.landline_phone = landPh.e164;
      else if (targets.landline?.trim()) customFields.landline_phone_raw = targets.landline.trim();
      for (const key of ['sms_marketing_consent', 'email_marketing_consent', 'sms_reminder_consent', 'email_reminder_consent'] as const) {
        const b = normaliseBoolean(targets[key]);
        if (b !== null) customFields[key] = b;
      }
      if (targets.preferred_staff?.trim()) customFields.preferred_staff = targets.preferred_staff.trim();
      const cs = targets.client_since?.trim();
      if (cs) {
        const { iso } = parseDateString(cs, datePref ?? undefined);
        if (iso) customFields.client_since = iso;
      }
      for (const key of ['archived', 'banned'] as const) {
        const b = normaliseBoolean(targets[key]);
        if (b !== null) customFields[key] = b;
      }
      const loyaltyPts = parseIntSafe(targets.loyalty_points);
      if (loyaltyPts != null) customFields.loyalty_points = loyaltyPts;
      const creditPence = parseCurrencyPence(targets.credit_balance);
      if (creditPence != null) customFields.credit_balance_pence = creditPence;
      for (const dk of ['date_of_birth', 'first_visit_date'] as const) {
        const raw = targets[dk];
        if (!raw?.trim()) continue;
        const { iso } = parseDateString(raw, datePref ?? undefined);
        if (iso) customFields[dk] = iso;
      }
      const lv = targets.last_visit_date?.trim();
      if (lv) {
        const { iso } = parseDateString(lv, datePref ?? undefined);
        if (iso) {
          /* stored on guest column */
        }
      }

      const visitCount = parseIntSafe(targets.total_visits) ?? undefined;
      let lastVisitDate: string | null = null;
      if (targets.last_visit_date?.trim()) {
        lastVisitDate = parseDateString(targets.last_visit_date, datePref ?? undefined).iso;
      }

      const existingByEmail =
        email ?
          (
            await admin
              .from('guests')
              .select('id, first_name, last_name, email, phone, visit_count, tags, marketing_opt_out, custom_fields, last_visit_date')
              .eq('venue_id', venueId)
              .eq('email', email)
              .maybeSingle()
          ).data
        : null;

      const existingByPhone =
        !existingByEmail && ph.e164 ?
          (
            await admin
              .from('guests')
              .select('id, first_name, last_name, email, phone, visit_count, tags, marketing_opt_out, custom_fields, last_visit_date')
              .eq('venue_id', venueId)
              .eq('phone', ph.e164)
              .maybeSingle()
          ).data
        : null;

      let existingByExternal: (typeof existingByEmail) | null = null;
      if (!existingByEmail && !existingByPhone && refProvider && targets.external_client_id?.trim()) {
        const gid = await findGuestIdByExternalRef(
          admin,
          venueId,
          refProvider,
          targets.external_client_id.trim(),
        );
        if (gid) {
          const { data: g } = await admin
            .from('guests')
            .select('id, first_name, last_name, email, phone, visit_count, tags, marketing_opt_out, custom_fields, last_visit_date')
            .eq('venue_id', venueId)
            .eq('id', gid)
            .maybeSingle();
          existingByExternal = g ?? null;
        }
      }

      const existing = existingByEmail ?? existingByPhone ?? existingByExternal;

      if (existing && shouldUpdateExisting(issues)) {
        const prev = existing as Record<string, unknown>;
        await admin.from('import_records').insert({
          session_id: sessionId,
          venue_id: venueId,
          record_type: 'guest',
          record_id: existing.id,
          action: 'updated',
          previous_data: prev,
        });

        const mergedCustom = {
          ...((prev.custom_fields as Record<string, unknown>) ?? {}),
          ...customFields,
        };

        await admin
          .from('guests')
          .update({
            first_name: fn,
            last_name: ln,
            email: email ?? (prev.email as string | null),
            phone: ph.e164 ?? (prev.phone as string | null),
            tags: tags.length ? tags : (prev.tags as string[] | undefined),
            marketing_opt_out: marketingOptOut ?? (prev.marketing_opt_out as boolean | null),
            visit_count: visitCount ?? (prev.visit_count as number),
            last_visit_date: lastVisitDate ?? (prev.last_visit_date as string | null),
            custom_fields: mergedCustom,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);

        if (refProvider && targets.external_client_id?.trim()) {
          await upsertGuestExternalRef(
            admin,
            venueId,
            existing.id as string,
            refProvider,
            targets.external_client_id.trim(),
          );
        }
        if (refProvider && targets.external_system_id?.trim()) {
          await upsertGuestExternalRef(
            admin,
            venueId,
            existing.id as string,
            refProvider,
            targets.external_system_id.trim(),
            { source: 'external_system_id' },
          );
        }

        updatedExisting += 1;
        importedClients += 1;
        await bumpProgress();
        continue;
      }

      if (existing && !shouldUpdateExisting(issues)) {
        skipped += 1;
        await bumpProgress();
        continue;
      }

      const { data: inserted, error: insErr } = await admin
        .from('guests')
        .insert({
          venue_id: venueId,
          first_name: fn,
          last_name: ln,
          email,
          phone: ph.e164,
          global_guest_hash: hashGuest(email, ph.e164),
          visit_count: visitCount ?? 0,
          last_visit_date: lastVisitDate,
          tags,
          marketing_opt_out: marketingOptOut ?? false,
          custom_fields: customFields,
        })
        .select('id')
        .single();

      if (insErr || !inserted) {
        console.error('[import execute] guest insert', insErr);
        skipped += 1;
        await bumpProgress();
        continue;
      }

      await admin.from('import_records').insert({
        session_id: sessionId,
        venue_id: venueId,
        record_type: 'guest',
        record_id: inserted.id,
        action: 'created',
        previous_data: null,
      });

      if (refProvider && targets.external_client_id?.trim()) {
        await upsertGuestExternalRef(
          admin,
          venueId,
          inserted.id,
          refProvider,
          targets.external_client_id.trim(),
        );
      }
      if (refProvider && targets.external_system_id?.trim()) {
        await upsertGuestExternalRef(
          admin,
          venueId,
          inserted.id,
          refProvider,
          targets.external_system_id.trim(),
          { source: 'external_system_id' },
        );
      }

      importedClients += 1;
      await bumpProgress();
    }
  }

  let defaultAreaId: string | null = null;
  if (bookingModel === 'table_reservation') {
    defaultAreaId = await getDefaultAreaIdForVenue(admin, venueId);
  }

  let defaultCalendarId: string | null = null;
  let defaultServiceItemId: string | null = null;
  let defaultPractitionerId: string | null = null;
  let defaultAppointmentServiceId: string | null = null;

  if (unified) {
    const { data: cal } = await admin
      .from('unified_calendars')
      .select('id')
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .order('sort_order')
      .limit(1)
      .maybeSingle();
    defaultCalendarId = (cal as { id: string } | null)?.id ?? null;
    if (defaultCalendarId) {
      const { data: csa } = await admin
        .from('calendar_service_assignments')
        .select('service_item_id')
        .eq('calendar_id', defaultCalendarId)
        .limit(1)
        .maybeSingle();
      defaultServiceItemId = (csa as { service_item_id: string } | null)?.service_item_id ?? null;
    }
    if (!defaultServiceItemId) {
      const { data: si } = await admin
        .from('service_items')
        .select('id')
        .eq('venue_id', venueId)
        .eq('is_active', true)
        .order('sort_order')
        .limit(1)
        .maybeSingle();
      defaultServiceItemId = (si as { id: string } | null)?.id ?? null;
    }
  } else if (bookingModel === 'practitioner_appointment') {
    const { data: p } = await admin
      .from('practitioners')
      .select('id')
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .order('sort_order')
      .limit(1)
      .maybeSingle();
    const { data: s } = await admin
      .from('appointment_services')
      .select('id')
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .order('sort_order')
      .limit(1)
      .maybeSingle();
    defaultPractitionerId = (p as { id: string } | null)?.id ?? null;
    defaultAppointmentServiceId = (s as { id: string } | null)?.id ?? null;
  }

  async function findGuestForBooking(
    email: string | null,
    phone: string | null,
    rawFirst: string | null,
    rawLast: string | null,
    externalClientId: string | null,
  ) {
    if (refProvider && externalClientId?.trim()) {
      const byExt = await findGuestIdByExternalRef(admin, venueId, refProvider, externalClientId.trim());
      if (byExt) return byExt;
    }
    if (email) {
      const { data } = await admin
        .from('guests')
        .select('id')
        .eq('venue_id', venueId)
        .eq('email', email)
        .maybeSingle();
      if (data) return data.id as string;
    }
    if (phone) {
      const { data } = await admin
        .from('guests')
        .select('id')
        .eq('venue_id', venueId)
        .eq('phone', phone)
        .maybeSingle();
      if (data) return data.id as string;
    }
    const fn = rawFirst?.trim() ? rawFirst.trim() : null;
    const ln = rawLast?.trim() ? rawLast.trim() : null;
    if (fn && ln) {
      const { data } = await admin
        .from('guests')
        .select('id')
        .eq('venue_id', venueId)
        .eq('first_name', fn)
        .eq('last_name', ln)
        .maybeSingle();
      if (data) return data.id as string;
    }
    if (fn && !ln) {
      const { data } = await admin
        .from('guests')
        .select('id')
        .eq('venue_id', venueId)
        .eq('first_name', fn)
        .is('last_name', null)
        .maybeSingle();
      if (data) return data.id as string;
    }
    if (!fn && ln) {
      const { data } = await admin
        .from('guests')
        .select('id')
        .eq('venue_id', venueId)
        .is('first_name', null)
        .eq('last_name', ln)
        .maybeSingle();
      if (data) return data.id as string;
    }
    return null;
  }

  const { data: stagedBookingRows } = await admin
    .from('import_booking_rows')
    .select('*')
    .eq('session_id', sessionId)
    .eq('is_future_booking', true);

  const hasStagedFutureBookings = (stagedBookingRows ?? []).length > 0;
  const todayStr = todayIsoLocal();

  if (hasStagedFutureBookings) {
    for (const sr of stagedBookingRows ?? []) {
      const row = sr as {
        file_id: string;
        row_number: number;
        booking_date: string;
        booking_time: string;
        booking_end_time: string | null;
        duration_minutes: number | null;
        party_size: number | null;
        raw_client_email: string | null;
        raw_client_phone: string | null;
        raw_guest_first_name: string | null;
        raw_guest_last_name: string | null;
        raw_external_appointment_id: string | null;
        raw_external_booking_id: string | null;
        raw_external_client_id: string | null;
        raw_group_booking_id: string | null;
        raw_import_metadata: Record<string, unknown> | null;
        raw_status: string | null;
        raw_price: string | null;
        raw_deposit_amount: string | null;
        raw_deposit_paid: string | null;
        raw_deposit_status: string | null;
        raw_notes: string | null;
        resolved_service_id: string | null;
        resolved_calendar_id: string | null;
        resolved_practitioner_id: string | null;
        resolved_appointment_service_id: string | null;
        resolved_event_session_id: string | null;
        resolved_class_instance_id: string | null;
        resolved_resource_id: string | null;
      };

      const issues = issueMap.get(issueKey(row.file_id, row.row_number));
      if (rowShouldSkip(issues)) {
        skipped += 1;
        await bumpProgress();
        continue;
      }

      if (refProvider && row.raw_external_appointment_id?.trim()) {
        const dupAppt = await findBookingIdByExternalRef(
          admin,
          venueId,
          refProvider,
          row.raw_external_appointment_id.trim(),
        );
        if (dupAppt) {
          skipped += 1;
          await bumpProgress();
          continue;
        }
      }

      const em = normaliseEmail(row.raw_client_email ?? null);
      const ph = normalisePhoneUk(row.raw_client_phone ?? null);
      const guestId = await findGuestForBooking(
        em,
        ph.e164,
        row.raw_guest_first_name ?? null,
        row.raw_guest_last_name ?? null,
        row.raw_external_client_id ?? null,
      );
      if (!guestId) {
        skipped += 1;
        await bumpProgress();
        continue;
      }

      const duration = row.duration_minutes ?? 60;
      const partySize =
        row.party_size ?? (bookingModel === 'table_reservation' ? 2 : 1);
      const meta = row.raw_import_metadata ?? {};
      const status = mapImportBookingStatus({
        rawStatus: row.raw_status,
        activationState: typeof meta.activation_state === 'string' ? meta.activation_state : null,
        deletedFlag:
          typeof meta.deleted === 'string'
            ? meta.deleted
            : typeof meta.deleted === 'boolean'
              ? String(meta.deleted)
              : null,
      }) as 'Pending' | 'Confirmed' | 'Cancelled' | 'No-Show' | 'Completed' | 'Seated' | 'Booked';

      const pricePence = parseCurrencyPence(row.raw_price);
      const notes = row.raw_notes?.trim() ?? null;
      let specialRequests = notes;
      if (pricePence != null) {
        const priceLabel = `Imported price £${(pricePence / 100).toFixed(2)}`;
        specialRequests = specialRequests ? `${specialRequests} — ${priceLabel}` : priceLabel;
      }

      const metaNotes: string[] = [];
      if (typeof meta.course_name === 'string' && meta.course_name.trim()) {
        metaNotes.push(`Course: ${meta.course_name.trim()}`);
      }
      if (typeof meta.appointment_source === 'string' && meta.appointment_source.trim()) {
        metaNotes.push(`Source: ${meta.appointment_source.trim()}`);
      }
      if (typeof meta.room_id === 'string' && meta.room_id.trim()) {
        metaNotes.push(`Room: ${meta.room_id.trim()}`);
      }
      if (typeof meta.machine_id === 'string' && meta.machine_id.trim()) {
        metaNotes.push(`Machine: ${meta.machine_id.trim()}`);
      }
      if (metaNotes.length) {
        const block = metaNotes.join('\n');
        specialRequests = specialRequests ? `${specialRequests}\n${block}` : block;
      }

      const depositFields = resolveDepositFromImport({
        amountRaw: row.raw_deposit_amount,
        paidRaw: row.raw_deposit_paid,
        statusRaw: row.raw_deposit_status,
      });

      const timeForDb =
        row.booking_time.length === 5 ? `${row.booking_time}:00` : row.booking_time;
      const bookingEndTime =
        row.booking_end_time ??
        (() => {
          const endParts = timeForDb.slice(0, 5).split(':').map(Number);
          const endMins = (endParts[0] ?? 0) * 60 + (endParts[1] ?? 0) + duration;
          const eh = Math.floor(endMins / 60) % 24;
          const emin = endMins % 60;
          return `${String(eh).padStart(2, '0')}:${String(emin).padStart(2, '0')}:00`;
        })();

      const insert: Record<string, unknown> = {
        venue_id: venueId,
        guest_id: guestId,
        booking_date: row.booking_date,
        booking_time: timeForDb,
        booking_end_time: bookingEndTime,
        party_size: partySize,
        status,
        source: 'import',
        deposit_status: depositFields.deposit_status,
        deposit_amount_pence: depositFields.deposit_amount_pence,
        guest_email: em,
        guest_first_name: row.raw_guest_first_name?.trim() || null,
        guest_last_name: row.raw_guest_last_name?.trim() || null,
        guest_phone: ph.e164,
        special_requests: specialRequests,
        booking_model: bookingModel as BookingModel,
      };

      if (bookingModel === 'table_reservation') {
        /* restaurant imports: area only; no catalogue linkage */
      } else if (unified && row.resolved_calendar_id && row.resolved_service_id) {
        insert.calendar_id = row.resolved_calendar_id;
        insert.service_item_id = row.resolved_service_id;
        insert.practitioner_id = null;
        insert.appointment_service_id = null;
        insert.capacity_used = partySize;
      } else if (
        bookingModel === 'practitioner_appointment' &&
        row.resolved_practitioner_id &&
        row.resolved_appointment_service_id
      ) {
        insert.practitioner_id = row.resolved_practitioner_id;
        insert.appointment_service_id = row.resolved_appointment_service_id;
        insert.calendar_id = null;
        insert.service_item_id = null;
      } else if (bookingModel === 'event_ticket' && row.resolved_event_session_id) {
        insert.event_session_id = row.resolved_event_session_id;
      } else if (bookingModel === 'class_session' && row.resolved_class_instance_id) {
        insert.class_instance_id = row.resolved_class_instance_id;
      } else if (bookingModel === 'resource_booking' && row.resolved_resource_id) {
        insert.resource_id = row.resolved_resource_id;
      } else if (unified) {
        skipped += 1;
        await bumpProgress();
        continue;
      } else if (bookingModel === 'practitioner_appointment') {
        skipped += 1;
        await bumpProgress();
        continue;
      } else if (bookingModel === 'event_ticket' || bookingModel === 'class_session' || bookingModel === 'resource_booking') {
        skipped += 1;
        await bumpProgress();
        continue;
      }

      if (bookingModel === 'table_reservation') {
        if (!defaultAreaId) {
          skipped += 1;
          await bumpProgress();
          continue;
        }
        insert.area_id = defaultAreaId;
      }

      Object.assign(insert, bookingImportCommsFields(row.booking_date, timeForDb));

      const { data: booking, error: bErr } = await admin.from('bookings').insert(insert).select('id').single();
      if (bErr || !booking) {
        console.error('[import execute] staged booking insert', bErr);
        skipped += 1;
        await bumpProgress();
        continue;
      }

      const { error: recErr } = await admin.from('import_records').insert({
        session_id: sessionId,
        venue_id: venueId,
        record_type: 'booking',
        record_id: booking.id,
        action: 'created',
        previous_data: null,
      });
      if (recErr) {
        console.error('[import execute] import_records after staged booking', recErr);
        await admin.from('bookings').delete().eq('id', booking.id);
        skipped += 1;
        await bumpProgress();
        continue;
      }

      const refPayload = {
        ...meta,
        group_booking_id: row.raw_group_booking_id,
        external_client_id: row.raw_external_client_id,
      };
      if (refProvider && row.raw_external_appointment_id?.trim()) {
        await insertBookingExternalRef(
          admin,
          venueId,
          booking.id as string,
          refProvider,
          row.raw_external_appointment_id.trim(),
          { kind: 'appointment', ...refPayload },
        );
      }
      if (refProvider && row.raw_external_booking_id?.trim()) {
        await insertBookingExternalRef(
          admin,
          venueId,
          booking.id as string,
          refProvider,
          row.raw_external_booking_id.trim(),
          { kind: 'booking', ...refPayload },
        );
      }

      importedBookings += 1;
      await bumpProgress();
    }
  }

  for (const file of bookingFiles) {
    const f = file as { id: string; storage_path: string };
    const maps = byFile.get(f.id) ?? [];
    const parsed = await downloadAndParseCsv(admin, f.storage_path);

    for (let i = 0; i < parsed.rows.length; i++) {
      const rowNum = i + 1;
      const row = parsed.rows[i]!;
      const issues = issueMap.get(issueKey(f.id, rowNum));

      if (rowShouldSkip(issues)) {
        skipped += 1;
        await bumpProgress();
        continue;
      }

      const { targets } = applyMappingsToDataRow(row, maps);
      const em = normaliseEmail(targets.client_email ?? null);
      const ph = normalisePhoneUk(targets.client_phone ?? null);
      const bdRaw = targets.booking_date?.trim() ?? '';
      const btRaw = targets.booking_time?.trim() ?? '';
      const { iso: dateIso } = parseDateString(bdRaw, datePref ?? undefined);
      const bt = parseTimeString(btRaw);
      if (!dateIso || !bt) {
        skipped += 1;
        await bumpProgress();
        continue;
      }

      if (hasStagedFutureBookings && dateIso >= todayStr) {
        skipped += 1;
        await bumpProgress();
        continue;
      }

      if (refProvider && targets.external_appointment_id?.trim()) {
        const dupAppt = await findBookingIdByExternalRef(
          admin,
          venueId,
          refProvider,
          targets.external_appointment_id.trim(),
        );
        if (dupAppt) {
          skipped += 1;
          await bumpProgress();
          continue;
        }
      }

      const legacyClientName = targets.guest_full_name?.trim();
      const legacyNameParts = legacyClientName ? splitFullName(legacyClientName) : { first: '', last: '' };
      const guestFirstName = targets.guest_first_name?.trim() || legacyNameParts.first;
      const guestLastName = targets.guest_last_name?.trim() || legacyNameParts.last;

      const guestId = await findGuestForBooking(
        em,
        ph.e164,
        guestFirstName || null,
        guestLastName || null,
        targets.client_external_id ?? null,
      );
      if (!guestId) {
        skipped += 1;
        await bumpProgress();
        continue;
      }

      let duration = parseIntSafe(targets.duration_minutes);
      const partySize =
        parseIntSafe(targets.party_size) ??
        (bookingModel === 'table_reservation' ? 2 : 1);

      const status = mapImportBookingStatus({
        rawStatus: targets.status,
        activationState: targets.activation_state ?? null,
        deletedFlag: targets.deleted ?? null,
      }) as 'Pending' | 'Confirmed' | 'Cancelled' | 'No-Show' | 'Completed' | 'Seated' | 'Booked';

      const pricePence = parseCurrencyPence(targets.price);
      const notes = targets.notes?.trim() ?? null;
      let specialRequests = notes;
      if (pricePence != null) {
        const priceLabel = `Imported price £${(pricePence / 100).toFixed(2)}`;
        specialRequests = specialRequests ? `${specialRequests} — ${priceLabel}` : priceLabel;
      }

      const csvMetaNotes: string[] = [];
      if (targets.course_name?.trim()) csvMetaNotes.push(`Course: ${targets.course_name.trim()}`);
      if (targets.appointment_source?.trim()) csvMetaNotes.push(`Source: ${targets.appointment_source.trim()}`);
      if (targets.room_id?.trim()) csvMetaNotes.push(`Room: ${targets.room_id.trim()}`);
      if (targets.machine_id?.trim()) csvMetaNotes.push(`Machine: ${targets.machine_id.trim()}`);
      if (csvMetaNotes.length) {
        const block = csvMetaNotes.join('\n');
        specialRequests = specialRequests ? `${specialRequests}\n${block}` : block;
      }

      const depositFields = resolveDepositFromImport({
        amountRaw: targets.deposit_amount,
        paidRaw: targets.deposit_paid,
        statusRaw: targets.deposit_status,
      });

      let calendarId = defaultCalendarId;
      let serviceItemId = defaultServiceItemId;

      if (unified && (targets.staff_name?.trim() || targets.service_name?.trim())) {
        if (targets.staff_name?.trim()) {
          const { data: calMatch } = await admin
            .from('unified_calendars')
            .select('id')
            .eq('venue_id', venueId)
            .ilike('name', `%${targets.staff_name.trim()}%`)
            .eq('is_active', true)
            .limit(1)
            .maybeSingle();
          if (calMatch) calendarId = (calMatch as { id: string }).id;
        }
        if (targets.service_name?.trim()) {
          const { data: svcMatch } = await admin
            .from('service_items')
            .select('id')
            .eq('venue_id', venueId)
            .ilike('name', `%${targets.service_name.trim()}%`)
            .eq('is_active', true)
            .limit(1)
            .maybeSingle();
          if (svcMatch) serviceItemId = (svcMatch as { id: string }).id;
        }
      }

      const timeForDb = bt.length === 5 ? `${bt}:00` : bt;
      const endBt = parseTimeString(targets.booking_end_time ?? null);
      const endTimeForDb = endBt ? (endBt.length === 5 ? `${endBt}:00` : endBt) : null;

      let bookingEndTime: string;
      if (endTimeForDb) {
        const dm = durationMinutesBetweenTimes(timeForDb, endTimeForDb);
        if (dm != null && dm > 0) duration = dm;
        bookingEndTime = endTimeForDb;
      } else {
        const dur = duration ?? 60;
        const endParts = timeForDb.slice(0, 5).split(':').map(Number);
        const endMins = (endParts[0] ?? 0) * 60 + (endParts[1] ?? 0) + dur;
        const eh = Math.floor(endMins / 60) % 24;
        const emin = endMins % 60;
        bookingEndTime = `${String(eh).padStart(2, '0')}:${String(emin).padStart(2, '0')}:00`;
      }

      const insert: Record<string, unknown> = {
        venue_id: venueId,
        guest_id: guestId,
        booking_date: dateIso,
        booking_time: timeForDb,
        booking_end_time: bookingEndTime,
        party_size: partySize,
        status,
        source: 'import',
        deposit_status: depositFields.deposit_status,
        deposit_amount_pence: depositFields.deposit_amount_pence,
        guest_email: em,
        guest_first_name: guestFirstName?.trim() || null,
        guest_last_name: guestLastName?.trim() || null,
        guest_phone: ph.e164,
        special_requests: specialRequests,
        booking_model: bookingModel as BookingModel,
      };

      if (unified && calendarId && serviceItemId) {
        insert.calendar_id = calendarId;
        insert.service_item_id = serviceItemId;
        insert.practitioner_id = null;
        insert.appointment_service_id = null;
        insert.capacity_used = partySize;
      } else if (bookingModel === 'practitioner_appointment' && defaultPractitionerId && defaultAppointmentServiceId) {
        insert.practitioner_id = defaultPractitionerId;
        insert.appointment_service_id = defaultAppointmentServiceId;
        insert.calendar_id = null;
        insert.service_item_id = null;
      } else if (unified) {
        skipped += 1;
        await bumpProgress();
        continue;
      }

      if (bookingModel === 'table_reservation') {
        if (!defaultAreaId) {
          skipped += 1;
          await bumpProgress();
          continue;
        }
        insert.area_id = defaultAreaId;
      }

      Object.assign(insert, bookingImportCommsFields(dateIso, timeForDb));

      const { data: booking, error: bErr } = await admin.from('bookings').insert(insert).select('id').single();
      if (bErr || !booking) {
        console.error('[import execute] booking insert', bErr);
        skipped += 1;
        await bumpProgress();
        continue;
      }

      const { error: recErr } = await admin.from('import_records').insert({
        session_id: sessionId,
        venue_id: venueId,
        record_type: 'booking',
        record_id: booking.id,
        action: 'created',
        previous_data: null,
      });
      if (recErr) {
        console.error('[import execute] import_records after booking', recErr);
        await admin.from('bookings').delete().eq('id', booking.id);
        skipped += 1;
        await bumpProgress();
        continue;
      }

      const csvRefPayload = {
        course_name: targets.course_name?.trim(),
        appointment_source: targets.appointment_source?.trim(),
        room_id: targets.room_id?.trim(),
        machine_id: targets.machine_id?.trim(),
        client_external_id: targets.client_external_id?.trim(),
        group_booking_id: targets.group_booking_id?.trim(),
      };
      if (refProvider && targets.external_appointment_id?.trim()) {
        await insertBookingExternalRef(
          admin,
          venueId,
          booking.id as string,
          refProvider,
          targets.external_appointment_id.trim(),
          { kind: 'appointment', ...csvRefPayload },
        );
      }
      if (refProvider && targets.external_booking_id?.trim()) {
        await insertBookingExternalRef(
          admin,
          venueId,
          booking.id as string,
          refProvider,
          targets.external_booking_id.trim(),
          { kind: 'booking', ...csvRefPayload },
        );
      }

      importedBookings += 1;
      await bumpProgress();
    }
  }

  const undoUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await admin
    .from('import_sessions')
    .update({
      status: 'complete',
      completed_at: new Date().toISOString(),
      imported_clients: importedClients,
      imported_bookings: importedBookings,
      skipped_rows: skipped,
      updated_existing: updatedExisting,
      undo_available_until: undoUntil,
      progress_processed: totalRows,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  await sendImportCompleteEmail(admin, venueId, staffId, {
    importedClients,
    importedBookings,
    skipped,
    updatedExisting,
    undoUntil,
  });
}

async function sendImportCompleteEmail(
  admin: SupabaseClient,
  venueId: string,
  staffId: string,
  summary: {
    importedClients: number;
    importedBookings: number;
    skipped: number;
    updatedExisting: number;
    undoUntil: string;
  },
) {
  const { sendEmail } = await import('@/lib/emails/send-email');
  const { data: staff } = await admin.from('staff').select('email, name').eq('id', staffId).maybeSingle();
  const { data: venue } = await admin.from('venues').select('name, email').eq('id', venueId).maybeSingle();
  const to = (staff as { email?: string } | null)?.email ?? (venue as { email?: string | null })?.email;
  if (!to?.trim()) return;

  const name = (staff as { name?: string } | null)?.name ?? 'there';
  const vname = (venue as { name?: string } | null)?.name ?? 'ReserveNI';
  const subject = 'Your data import to ReserveNI is complete';
  const undoDate = new Date(summary.undoUntil).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Your data import has finished. Here's what was imported:</p>
    <ul>
      <li>${summary.importedClients} client records processed (including updates)</li>
      <li>${summary.importedBookings} bookings imported</li>
      <li>${summary.skipped} rows skipped</li>
      <li>${summary.updatedExisting} existing clients updated</li>
    </ul>
    <p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? ''}/dashboard/guests">View your clients</a></p>
    <p>If you notice anything wrong, you can undo this import until ${escapeHtml(undoDate)} from Settings → Data Import.</p>
    <p>${escapeHtml(vname)}</p>
  `;
  const text = `Hi ${name},\n\nYour import completed.\nClients processed: ${summary.importedClients}\nBookings: ${summary.importedBookings}\nSkipped: ${summary.skipped}\n\nUndo available until ${undoDate}.\n`;

  await sendEmail({
    to,
    subject,
    html,
    text,
    fromDisplayName: vname,
  });
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
