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
} from '@/lib/import/normalize';
import {
  findBookingIdByExternalRef,
  findGuestIdByExternalRef,
  IMPORT_REF_PROVIDER_PHOREST,
  insertBookingExternalRef,
  upsertGuestExternalRef,
} from '@/lib/import/external-refs';
import {
  findGuestByEmailCi,
  findGuestByPhone,
  findGuestIdByExactName,
  phoneForMatching,
} from '@/lib/import/guest-lookup';
import { recordExecuteSkip } from '@/lib/import/execute-skip-audit';
import { resolveNamedRowId } from '@/lib/import/name-match';
import { resolveBookingImportDefaults } from '@/lib/import/booking-import-defaults';
import { normaliseGuestTagsInput } from '@/lib/guests/tags';
import type { BookingModel } from '@/types/booking-models';
import {
  fetchPractitionerServiceCommercialDefaults,
  fetchUnifiedServiceCommercialDefaults,
  isBookingImportFieldMapped,
  type ServiceCommercialDefaults,
} from '@/lib/import/booking-service-defaults';
import {
  IMPORT_EXECUTE_STATE_KEY,
  ImportBatchPaused,
  isImportBatchPaused,
  snapshotImportExecuteStateForPause,
  type ImportExecuteStateV1,
} from '@/lib/import/import-execute-state';
import { shouldFlushImportProgressToDb } from '@/lib/import/import-execute-progress';
import { evaluateClientRowNameRule } from '@/lib/import/client-row-name-rule';

function hashGuest(email: string | null, phone: string | null): string | null {
  if (!email && !phone) return null;
  return createHash('sha256').update(`${email ?? ''}|${phone ?? ''}`).digest('hex');
}

function generatedImportClientId(sessionId: string, fileId: string, rowNumber: number): string {
  return `import:${sessionId}:${fileId}:${rowNumber}`;
}

function importOnlyGuestName(
  rawFirst: string | null,
  rawLast: string | null,
  rowNumber: number,
): { firstName: string; lastName: string } {
  const first = rawFirst?.trim();
  const last = rawLast?.trim();
  if (first && last) return { firstName: first, lastName: last };
  if (first) return { firstName: first, lastName: 'Imported guest' };
  if (last) return { firstName: 'Imported guest', lastName: last };
  return { firstName: 'Imported guest', lastName: `#${rowNumber}` };
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

export async function runImportExecuteBatch(
  admin: SupabaseClient,
  sessionId: string,
  venueId: string,
  staffId: string,
  options: { maxRows: number; state: ImportExecuteStateV1 },
): Promise<{ state: ImportExecuteStateV1; finished: boolean }> {
  try {
  const st: ImportExecuteStateV1 = {
    ...options.state,
    defaultsPayload: options.state.defaultsPayload ? { ...options.state.defaultsPayload } : null,
  };
  let budget = options.maxRows;

  const unifiedCommercialsCache = new Map<string, ServiceCommercialDefaults | null>();
  const practitionerCommercialsCache = new Map<string, ServiceCommercialDefaults | null>();

  async function getUnifiedCommercials(calendarId: string, serviceItemId: string) {
    const key = `${calendarId}:${serviceItemId}`;
    if (!unifiedCommercialsCache.has(key)) {
      unifiedCommercialsCache.set(
        key,
        await fetchUnifiedServiceCommercialDefaults(admin, venueId, calendarId, serviceItemId),
      );
    }
    return unifiedCommercialsCache.get(key) ?? null;
  }

  async function getPractitionerCommercials(practitionerId: string, appointmentServiceId: string) {
    const key = `${practitionerId}:${appointmentServiceId}`;
    if (!practitionerCommercialsCache.has(key)) {
      practitionerCommercialsCache.set(
        key,
        await fetchPractitionerServiceCommercialDefaults(
          admin,
          venueId,
          practitionerId,
          appointmentServiceId,
        ),
      );
    }
    return practitionerCommercialsCache.get(key) ?? null;
  }

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

  let importedClients = st.importedClients;
  let importedBookings = st.importedBookings;
  let skipped = st.skipped;
  let updatedExisting = st.updatedExisting;
  let processed = st.processed;

  const totalRows =
    (files ?? []).reduce((acc, f) => {
      const ft = (f as { file_type?: string }).file_type;
      if (ft === 'staff') return acc;
      return acc + ((f as { row_count?: number }).row_count ?? 0);
    }, 0) ||
    (session as { total_rows?: number }).total_rows ||
    0;

  const clientFiles = (files ?? []).filter((f) => {
    const t = (f as { file_type: string }).file_type;
    return t === 'clients' || t === 'unknown';
  });
  const bookingFiles = (files ?? []).filter((f) => (f as { file_type: string }).file_type === 'bookings');

  const { data: stagedBookingRows } = await admin
    .from('import_booking_rows')
    .select('file_id, row_number')
    .eq('session_id', sessionId)
    .eq('is_future_booking', true);

  /**
   * Set of `${file_id}:${row_number}` for rows that were staged via the
   * references step. The CSV booking phase skips a row only when it is in this
   * set, so future-dated CSV rows that *were not* staged still get imported
   * through the CSV path instead of being silently dropped.
   */
  const stagedRowKeys = new Set<string>(
    (stagedBookingRows ?? []).map(
      (r) =>
        `${(r as { file_id: string }).file_id}:${(r as { row_number: number }).row_number}`,
    ),
  );

  async function flushCountersToSession() {
    st.importedClients = importedClients;
    st.importedBookings = importedBookings;
    st.skipped = skipped;
    st.updatedExisting = updatedExisting;
    st.processed = processed;
    await admin
      .from('import_sessions')
      .update({
        progress_processed: processed,
        imported_clients: importedClients,
        imported_bookings: importedBookings,
        skipped_rows: skipped,
        updated_existing: updatedExisting,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId);
  }

  let rowsSinceProgressFlush = 0;

  async function bumpProgress() {
    processed += 1;
    budget -= 1;
    rowsSinceProgressFlush += 1;
    if (shouldFlushImportProgressToDb(rowsSinceProgressFlush, budget)) {
      await flushCountersToSession();
      rowsSinceProgressFlush = 0;
    }
    if (budget <= 0) {
      throw new ImportBatchPaused(snapshotImportExecuteStateForPause(st));
    }
  }

  function bookingDefaultsOrThrow() {
    if (!st.defaultsPayload) {
      throw new Error('[import execute] booking defaults not loaded');
    }
    return st.defaultsPayload;
  }

  async function loadDefaultsIntoState() {
    if (st.defaultsPayload) return;
    const defaults = await resolveBookingImportDefaults(admin, venueId);
    st.defaultsPayload = {
      defaultAreaId: defaults.defaultAreaId,
      defaultCalendarId: defaults.defaultCalendarId,
      defaultServiceItemId: defaults.defaultServiceItemId,
      defaultPractitionerId: defaults.defaultPractitionerId,
      defaultAppointmentServiceId: defaults.defaultAppointmentServiceId,
    };
  }

  while (st.phase === 'clients') {
    if (st.clientFileIndex >= clientFiles.length) {
      st.phase = stagedRowKeys.size > 0 ? 'staged_bookings' : 'csv_bookings';
      break;
    }
    const f = clientFiles[st.clientFileIndex] as { id: string; storage_path: string };
    const maps = byFile.get(f.id) ?? [];
    if (st.clientRowIndex === 0) {
      await ensureCustomClientFieldDefinitions(admin, venueId, maps);
    }
    const parsed = await downloadAndParseCsv(admin, f.storage_path);

    while (st.clientRowIndex < parsed.rows.length) {
      const i = st.clientRowIndex;
      const rowNum = i + 1;
      const row = parsed.rows[i]!;
      const issues = issueMap.get(issueKey(f.id, rowNum));

      if (rowShouldSkip(issues)) {
        skipped += 1;
        st.clientRowIndex += 1;
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

      const email = normaliseEmail(targets.email ?? null);
      const ph = normalisePhoneUk(targets.phone ?? null);

      const nameOutcome = evaluateClientRowNameRule({
        firstName: fn,
        lastName: ln,
        email: email ?? targets.email ?? null,
        phone: ph.e164 ?? targets.phone ?? null,
      });
      if (nameOutcome.kind === 'missing_name' || nameOutcome.kind === 'missing_contact') {
        skipped += 1;
        st.clientRowIndex += 1;
        await bumpProgress();
        continue;
      }
      const firstNameForDb: string | null = fn || null;
      const lastNameForDb: string | null = ln || null;

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

      const guestSelectColumns =
        'id, first_name, last_name, email, phone, visit_count, tags, marketing_opt_out, custom_fields, last_visit_date';
      const existingByEmail = email
        ? await findGuestByEmailCi<Record<string, unknown> & { id: string }>(
            admin,
            venueId,
            email,
            guestSelectColumns,
          )
        : null;

      const phoneMatchKey = phoneForMatching(ph);
      const existingByPhone =
        !existingByEmail && phoneMatchKey
          ? await findGuestByPhone<Record<string, unknown> & { id: string }>(
              admin,
              venueId,
              phoneMatchKey,
              guestSelectColumns,
            )
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
            first_name: firstNameForDb ?? (prev.first_name as string | null),
            last_name: lastNameForDb ?? (prev.last_name as string | null),
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
        st.clientRowIndex += 1;
        await bumpProgress();
        continue;
      }

      if (existing && !shouldUpdateExisting(issues)) {
        const existingDecision = (issues ?? []).find((i) => i.issue_type === 'existing_client');
        if (existingDecision && !existingDecision.user_decision) {
          /** Defensive: the API guard should already block this, but log + audit so the row is not silently dropped. */
          await recordExecuteSkip(admin, sessionId, {
            fileId: f.id,
            rowNumber: rowNum,
            code: 'existing_client_no_decision',
            message:
              'Existing-client warning had no decision when import ran; row was skipped. Choose Update existing or Skip and re-validate.',
          });
        }
        skipped += 1;
        st.clientRowIndex += 1;
        await bumpProgress();
        continue;
      }

      const { data: inserted, error: insErr } = await admin
        .from('guests')
        .insert({
          venue_id: venueId,
          first_name: firstNameForDb,
          last_name: lastNameForDb,
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
        await recordExecuteSkip(admin, sessionId, {
          fileId: f.id,
          rowNumber: rowNum,
          code: 'guest_insert_failed',
          message: `Could not create the guest record: ${insErr?.message ?? 'unknown error'}`,
        });
        skipped += 1;
        st.clientRowIndex += 1;
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
      st.clientRowIndex += 1;
      await bumpProgress();
    }

    st.clientFileIndex += 1;
    st.clientRowIndex = 0;
  }

  await loadDefaultsIntoState();

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
      const byEmail = await findGuestByEmailCi<{ id: string }>(admin, venueId, email, 'id');
      if (byEmail) return byEmail.id;
    }
    if (phone) {
      const byPhone = await findGuestByPhone<{ id: string }>(admin, venueId, phone, 'id');
      if (byPhone) return byPhone.id;
    }
    const hasStrongerIdentifier = Boolean(email || phone || (refProvider && externalClientId?.trim()));
    if (hasStrongerIdentifier) {
      /** With email/phone/external id present we already had stronger signals; do not fall back to name-only matching. */
      return null;
    }
    const fn = rawFirst?.trim() ? rawFirst.trim() : null;
    const ln = rawLast?.trim() ? rawLast.trim() : null;
    const byName = await findGuestIdByExactName(admin, venueId, fn, ln);
    if (byName && !byName.ambiguous) return byName.id;
    if (byName?.ambiguous) {
      console.warn(
        '[import execute] multiple guests share the same name; will create a synthetic import-only guest',
        { venueId, fn, ln },
      );
    }
    return null;
  }

  async function ensureGuestForBooking(input: {
    fileId: string;
    rowNumber: number;
    email: string | null;
    phone: string | null;
    rawFirst: string | null;
    rawLast: string | null;
    externalClientId: string | null;
  }): Promise<string | null> {
    const existing = await findGuestForBooking(
      input.email,
      input.phone,
      input.rawFirst,
      input.rawLast,
      input.externalClientId,
    );
    if (existing) return existing;

    const generatedExternalId =
      input.externalClientId?.trim() || generatedImportClientId(sessionId, input.fileId, input.rowNumber);

    if (refProvider) {
      const byGeneratedRef = await findGuestIdByExternalRef(
        admin,
        venueId,
        refProvider,
        generatedExternalId,
      );
      if (byGeneratedRef) return byGeneratedRef;
    }

    const { firstName, lastName } = importOnlyGuestName(input.rawFirst, input.rawLast, input.rowNumber);
    const customFields: Record<string, unknown> = {
      import_generated_client_id: generatedExternalId,
      import_session_id: sessionId,
      import_file_id: input.fileId,
      import_row_number: input.rowNumber,
    };

    const { data: inserted, error } = await admin
      .from('guests')
      .insert({
        venue_id: venueId,
        first_name: firstName,
        last_name: lastName,
        email: input.email,
        phone: input.phone,
        global_guest_hash: hashGuest(input.email, input.phone),
        visit_count: 0,
        marketing_opt_out: false,
        custom_fields: customFields,
      })
      .select('id')
      .single();

    if (error || !inserted) {
      console.error('[import execute] booking guest insert', error);
      return null;
    }

    await admin.from('import_records').insert({
      session_id: sessionId,
      venue_id: venueId,
      record_type: 'guest',
      record_id: inserted.id,
      action: 'created',
      previous_data: null,
    });

    if (refProvider) {
      await upsertGuestExternalRef(
        admin,
        venueId,
        inserted.id,
        refProvider,
        generatedExternalId,
        { source: input.externalClientId?.trim() ? 'external_client_id' : 'generated_import_client_id' },
      );
    }

    importedClients += 1;
    st.importedClients = importedClients;
    return inserted.id as string;
  }

  while (st.phase === 'staged_bookings') {
    await loadDefaultsIntoState();
    const { defaultAreaId } = bookingDefaultsOrThrow();
    const stagedRows = stagedBookingRows ?? [];

    while (st.stagedRowIndex < stagedRows.length) {
      const row = stagedRows[st.stagedRowIndex]! as {
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
        raw_booking_end_time: string | null;
        raw_duration_minutes: string | null;
      };

      const issues = issueMap.get(issueKey(row.file_id, row.row_number));
      if (rowShouldSkip(issues)) {
        skipped += 1;
        st.stagedRowIndex += 1;
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
          await recordExecuteSkip(admin, sessionId, {
            fileId: row.file_id,
            rowNumber: row.row_number,
            code: 'duplicate_external_appointment_id',
            message: `External appointment ID "${row.raw_external_appointment_id.trim()}" already exists in ReserveNI; the new row was skipped.`,
          });
          skipped += 1;
          st.stagedRowIndex += 1;
          await bumpProgress();
          continue;
        }
      }

      const em = normaliseEmail(row.raw_client_email ?? null);
      const ph = normalisePhoneUk(row.raw_client_phone ?? null);
      const guestId = await ensureGuestForBooking({
        fileId: row.file_id,
        rowNumber: row.row_number,
        email: em,
        phone: phoneForMatching(ph),
        rawFirst: row.raw_guest_first_name ?? null,
        rawLast: row.raw_guest_last_name ?? null,
        externalClientId: row.raw_external_client_id ?? null,
      });
      if (!guestId) {
        await recordExecuteSkip(admin, sessionId, {
          fileId: row.file_id,
          rowNumber: row.row_number,
          code: 'guest_resolution_failed',
          message: 'Could not find or create a guest for this booking row (no email/phone/external id and no unique name match).',
        });
        skipped += 1;
        st.stagedRowIndex += 1;
        await bumpProgress();
        continue;
      }

      let serviceCommercials: ServiceCommercialDefaults | null = null;
      if (unified && row.resolved_calendar_id && row.resolved_service_id) {
        serviceCommercials = await getUnifiedCommercials(row.resolved_calendar_id, row.resolved_service_id);
      } else if (
        bookingModel === 'practitioner_appointment' &&
        row.resolved_practitioner_id &&
        row.resolved_appointment_service_id
      ) {
        serviceCommercials = await getPractitionerCommercials(
          row.resolved_practitioner_id,
          row.resolved_appointment_service_id,
        );
      }

      const rawEnd = row.raw_booking_end_time?.trim();
      const rawDur = row.raw_duration_minutes?.trim();
      const useExtractTiming = Boolean(rawEnd || rawDur);

      const timeForDb =
        row.booking_time.length === 5 ? `${row.booking_time}:00` : row.booking_time;

      let bookingEndTime: string;
      if (useExtractTiming && row.booking_end_time) {
        bookingEndTime = row.booking_end_time;
      } else {
        const durForEnd =
          serviceCommercials && serviceCommercials.durationMinutes > 0 ?
            serviceCommercials.durationMinutes
          : (row.duration_minutes ?? 60);
        const endParts = timeForDb.slice(0, 5).split(':').map(Number);
        const endMins = (endParts[0] ?? 0) * 60 + (endParts[1] ?? 0) + durForEnd;
        const eh = Math.floor(endMins / 60) % 24;
        const emin = endMins % 60;
        bookingEndTime = `${String(eh).padStart(2, '0')}:${String(emin).padStart(2, '0')}:00`;
      }

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

      let pricePence = parseCurrencyPence(row.raw_price);
      if (pricePence == null && serviceCommercials?.pricePence != null) {
        pricePence = serviceCommercials.pricePence;
      }
      const notes = row.raw_notes?.trim() ?? null;
      let specialRequests = notes;
      if (pricePence != null) {
        const priceLabel =
          row.raw_price?.trim() ?
            `Imported price £${(pricePence / 100).toFixed(2)}`
          : `Service price £${(pricePence / 100).toFixed(2)}`;
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

      let depositFields = resolveDepositFromImport({
        amountRaw: row.raw_deposit_amount,
        paidRaw: row.raw_deposit_paid,
        statusRaw: row.raw_deposit_status,
      });
      const depositCsvExplicit = Boolean(
        row.raw_deposit_amount?.trim() ||
          row.raw_deposit_status?.trim() ||
          (row.raw_deposit_paid != null && row.raw_deposit_paid.trim() !== ''),
      );
      if (
        !depositCsvExplicit &&
        serviceCommercials?.depositPence != null &&
        serviceCommercials.depositPence > 0 &&
        depositFields.deposit_status === 'Not Required' &&
        (depositFields.deposit_amount_pence == null || depositFields.deposit_amount_pence === 0)
      ) {
        depositFields = { deposit_status: 'Pending', deposit_amount_pence: serviceCommercials.depositPence };
      }

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
        await recordExecuteSkip(admin, sessionId, {
          fileId: row.file_id,
          rowNumber: row.row_number,
          code: 'unified_resolution_failed',
          message: 'Could not resolve a calendar and service item for this row from the references step.',
        });
        skipped += 1;
        st.stagedRowIndex += 1;
        await bumpProgress();
        continue;
      } else if (bookingModel === 'practitioner_appointment') {
        await recordExecuteSkip(admin, sessionId, {
          fileId: row.file_id,
          rowNumber: row.row_number,
          code: 'practitioner_resolution_failed',
          message: 'Could not resolve a practitioner and service for this row from the references step.',
        });
        skipped += 1;
        st.stagedRowIndex += 1;
        await bumpProgress();
        continue;
      } else if (bookingModel === 'event_ticket' || bookingModel === 'class_session' || bookingModel === 'resource_booking') {
        await recordExecuteSkip(admin, sessionId, {
          fileId: row.file_id,
          rowNumber: row.row_number,
          code: 'unsupported_resolution',
          message: `Could not resolve a ${bookingModel} target for this row.`,
        });
        skipped += 1;
        st.stagedRowIndex += 1;
        await bumpProgress();
        continue;
      }

      if (bookingModel === 'table_reservation') {
        if (!defaultAreaId) {
          await recordExecuteSkip(admin, sessionId, {
            fileId: row.file_id,
            rowNumber: row.row_number,
            code: 'no_default_area',
            message: 'No default seating area is configured for this venue.',
          });
          skipped += 1;
          st.stagedRowIndex += 1;
          await bumpProgress();
          continue;
        }
        insert.area_id = defaultAreaId;
      }

      Object.assign(insert, bookingImportCommsFields(row.booking_date, timeForDb));

      const { data: booking, error: bErr } = await admin.from('bookings').insert(insert).select('id').single();
      if (bErr || !booking) {
        console.error('[import execute] staged booking insert', bErr);
        await recordExecuteSkip(admin, sessionId, {
          fileId: row.file_id,
          rowNumber: row.row_number,
          code: 'booking_insert_failed',
          message: `Could not insert the booking: ${bErr?.message ?? 'unknown error'}`,
        });
        skipped += 1;
        st.stagedRowIndex += 1;
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
        await recordExecuteSkip(admin, sessionId, {
          fileId: row.file_id,
          rowNumber: row.row_number,
          code: 'audit_insert_failed',
          message: `Booking was inserted then rolled back because the audit record could not be written: ${recErr.message}`,
        });
        skipped += 1;
        st.stagedRowIndex += 1;
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
      st.stagedRowIndex += 1;
      await bumpProgress();
    }
    st.phase = 'csv_bookings';
  }

  while (st.phase === 'csv_bookings') {
    await loadDefaultsIntoState();
    const {
      defaultAreaId,
      defaultCalendarId,
      defaultServiceItemId,
      defaultPractitionerId,
      defaultAppointmentServiceId,
    } = bookingDefaultsOrThrow();

    if (st.bookingFileIndex >= bookingFiles.length) {
      break;
    }

    const f = bookingFiles[st.bookingFileIndex] as { id: string; storage_path: string };
    const maps = byFile.get(f.id) ?? [];
    const parsed = await downloadAndParseCsv(admin, f.storage_path);

    while (st.bookingRowIndex < parsed.rows.length) {
      const i = st.bookingRowIndex;
      const rowNum = i + 1;
      const row = parsed.rows[i]!;
      const issues = issueMap.get(issueKey(f.id, rowNum));

      if (rowShouldSkip(issues)) {
        skipped += 1;
        st.bookingRowIndex += 1;
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
        await recordExecuteSkip(admin, sessionId, {
          fileId: f.id,
          rowNumber: rowNum,
          code: 'unparseable_date_or_time',
          message: 'Could not parse booking date or time at execute time.',
        });
        skipped += 1;
        st.bookingRowIndex += 1;
        await bumpProgress();
        continue;
      }

      if (stagedRowKeys.has(`${f.id}:${rowNum}`)) {
        /** Already imported via the staged-bookings phase; do not double-import. */
        st.bookingRowIndex += 1;
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
          await recordExecuteSkip(admin, sessionId, {
            fileId: f.id,
            rowNumber: rowNum,
            code: 'duplicate_external_appointment_id',
            message: `External appointment ID "${targets.external_appointment_id.trim()}" already exists in ReserveNI; the new row was skipped.`,
          });
          skipped += 1;
          st.bookingRowIndex += 1;
          await bumpProgress();
          continue;
        }
      }

      const legacyClientName = targets.guest_full_name?.trim();
      const legacyNameParts = legacyClientName ? splitFullName(legacyClientName) : { first: '', last: '' };
      const guestFirstName = targets.guest_first_name?.trim() || legacyNameParts.first;
      const guestLastName = targets.guest_last_name?.trim() || legacyNameParts.last;

      const guestId = await ensureGuestForBooking({
        fileId: f.id,
        rowNumber: rowNum,
        email: em,
        phone: phoneForMatching(ph),
        rawFirst: guestFirstName || null,
        rawLast: guestLastName || null,
        externalClientId: targets.client_external_id ?? null,
      });
      if (!guestId) {
        await recordExecuteSkip(admin, sessionId, {
          fileId: f.id,
          rowNumber: rowNum,
          code: 'guest_resolution_failed',
          message: 'Could not find or create a guest for this booking row (no email/phone/external id and no unique name match).',
        });
        skipped += 1;
        st.bookingRowIndex += 1;
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

      const durMapped =
        isBookingImportFieldMapped(maps, 'duration_minutes') && Boolean(targets.duration_minutes?.trim());

      let calendarId = defaultCalendarId;
      let serviceItemId = defaultServiceItemId;

      if (unified && (targets.staff_name?.trim() || targets.service_name?.trim())) {
        if (targets.staff_name?.trim()) {
          const calMatch = await resolveNamedRowId(admin, {
            table: 'unified_calendars',
            venueId,
            name: targets.staff_name,
            isActiveOnly: true,
          });
          if (calMatch.id) calendarId = calMatch.id;
          if (calMatch.ambiguous) {
            await recordExecuteSkip(admin, sessionId, {
              fileId: f.id,
              rowNumber: rowNum,
              code: 'ambiguous_calendar_match',
              message: `Multiple calendars matched "${targets.staff_name.trim()}"; using the first deterministically. Rename calendars or map columns to avoid ambiguity.`,
            });
          }
        }
        if (targets.service_name?.trim()) {
          const svcMatch = await resolveNamedRowId(admin, {
            table: 'service_items',
            venueId,
            name: targets.service_name,
            isActiveOnly: true,
          });
          if (svcMatch.id) serviceItemId = svcMatch.id;
          if (svcMatch.ambiguous) {
            await recordExecuteSkip(admin, sessionId, {
              fileId: f.id,
              rowNumber: rowNum,
              code: 'ambiguous_service_match',
              message: `Multiple services matched "${targets.service_name.trim()}"; using the first deterministically. Rename services or map columns to avoid ambiguity.`,
            });
          }
        }
      }

      let serviceCommercials: ServiceCommercialDefaults | null = null;
      if (unified && calendarId && serviceItemId) {
        serviceCommercials = await getUnifiedCommercials(calendarId, serviceItemId);
      } else if (bookingModel === 'practitioner_appointment' && defaultPractitionerId && defaultAppointmentServiceId) {
        serviceCommercials = await getPractitionerCommercials(
          defaultPractitionerId,
          defaultAppointmentServiceId,
        );
      }

      const timeForDb = bt.length === 5 ? `${bt}:00` : bt;
      const endBt = parseTimeString(targets.booking_end_time ?? null);
      const endTimeForDb = endBt ? (endBt.length === 5 ? `${endBt}:00` : endBt) : null;

      let bookingEndTime: string;
      if (endTimeForDb) {
        const dm = durationMinutesBetweenTimes(timeForDb, endTimeForDb);
        if (dm != null && dm > 0) {
          duration = dm;
        } else {
          duration =
            serviceCommercials?.durationMinutes ?? duration ?? 60;
        }
        bookingEndTime = endTimeForDb;
      } else {
        if (durMapped) {
          duration = parseIntSafe(targets.duration_minutes) ?? serviceCommercials?.durationMinutes ?? 60;
        } else {
          duration = serviceCommercials?.durationMinutes ?? duration ?? 60;
        }
        const dur = duration ?? 60;
        const endParts = timeForDb.slice(0, 5).split(':').map(Number);
        const endMins = (endParts[0] ?? 0) * 60 + (endParts[1] ?? 0) + dur;
        const eh = Math.floor(endMins / 60) % 24;
        const emin = endMins % 60;
        bookingEndTime = `${String(eh).padStart(2, '0')}:${String(emin).padStart(2, '0')}:00`;
      }

      const priceMapped = isBookingImportFieldMapped(maps, 'price');
      let pricePence: number | null = null;
      if (priceMapped && targets.price?.trim()) {
        pricePence = parseCurrencyPence(targets.price);
      } else if ((!priceMapped || !targets.price?.trim()) && serviceCommercials?.pricePence != null) {
        pricePence = serviceCommercials.pricePence;
      }

      const notes = targets.notes?.trim() ?? null;
      let specialRequests = notes;
      if (pricePence != null) {
        const priceLabel =
          priceMapped && targets.price?.trim() ?
            `Imported price £${(pricePence / 100).toFixed(2)}`
          : `Service price £${(pricePence / 100).toFixed(2)}`;
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

      let depositFields = resolveDepositFromImport({
        amountRaw: targets.deposit_amount,
        paidRaw: targets.deposit_paid,
        statusRaw: targets.deposit_status,
      });
      const depositCsvExplicit = Boolean(
        (isBookingImportFieldMapped(maps, 'deposit_amount') && targets.deposit_amount?.trim()) ||
          (isBookingImportFieldMapped(maps, 'deposit_status') && targets.deposit_status?.trim()) ||
          (isBookingImportFieldMapped(maps, 'deposit_paid') &&
            targets.deposit_paid != null &&
            targets.deposit_paid.trim() !== ''),
      );
      if (
        !depositCsvExplicit &&
        serviceCommercials?.depositPence != null &&
        serviceCommercials.depositPence > 0 &&
        depositFields.deposit_status === 'Not Required' &&
        (depositFields.deposit_amount_pence == null || depositFields.deposit_amount_pence === 0)
      ) {
        depositFields = { deposit_status: 'Pending', deposit_amount_pence: serviceCommercials.depositPence };
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
        await recordExecuteSkip(admin, sessionId, {
          fileId: f.id,
          rowNumber: rowNum,
          code: 'unified_no_default_calendar_or_service',
          message: 'No default calendar or service item is configured; this booking row was skipped.',
        });
        skipped += 1;
        st.bookingRowIndex += 1;
        await bumpProgress();
        continue;
      }

      if (bookingModel === 'table_reservation') {
        if (!defaultAreaId) {
          await recordExecuteSkip(admin, sessionId, {
            fileId: f.id,
            rowNumber: rowNum,
            code: 'no_default_area',
            message: 'No default seating area is configured for this venue.',
          });
          skipped += 1;
          st.bookingRowIndex += 1;
          await bumpProgress();
          continue;
        }
        insert.area_id = defaultAreaId;
      }

      Object.assign(insert, bookingImportCommsFields(dateIso, timeForDb));

      const { data: booking, error: bErr } = await admin.from('bookings').insert(insert).select('id').single();
      if (bErr || !booking) {
        console.error('[import execute] booking insert', bErr);
        await recordExecuteSkip(admin, sessionId, {
          fileId: f.id,
          rowNumber: rowNum,
          code: 'booking_insert_failed',
          message: `Could not insert the booking: ${bErr?.message ?? 'unknown error'}`,
        });
        skipped += 1;
        st.bookingRowIndex += 1;
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
        await recordExecuteSkip(admin, sessionId, {
          fileId: f.id,
          rowNumber: rowNum,
          code: 'audit_insert_failed',
          message: `Booking was inserted then rolled back because the audit record could not be written: ${recErr.message}`,
        });
        skipped += 1;
        st.bookingRowIndex += 1;
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
      st.bookingRowIndex += 1;
      await bumpProgress();
    }

    st.bookingFileIndex += 1;
    st.bookingRowIndex = 0;
  }

  if (rowsSinceProgressFlush > 0) {
    await flushCountersToSession();
    rowsSinceProgressFlush = 0;
  }

  const undoUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: settingsRow } = await admin
    .from('import_sessions')
    .select('session_settings')
    .eq('id', sessionId)
    .single();
  const prevSettings = (settingsRow?.session_settings ?? {}) as Record<string, unknown>;
  const { [IMPORT_EXECUTE_STATE_KEY]: _removed, ...sessionSettingsRest } = prevSettings;

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
      session_settings: sessionSettingsRest,
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

  st.importedClients = importedClients;
  st.importedBookings = importedBookings;
  st.skipped = skipped;
  st.updatedExisting = updatedExisting;
  st.processed = processed;
  return { state: st, finished: true };
  } catch (e) {
    if (isImportBatchPaused(e)) {
      return { state: e.checkpoint, finished: false };
    }
    throw e;
  }
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
