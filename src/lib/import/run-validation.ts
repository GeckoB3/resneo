import type { SupabaseClient } from '@supabase/supabase-js';
import { downloadAndParseCsv } from '@/lib/import/parse-storage-csv';
import { applyMappingsToDataRow, type DbMappingRow } from '@/lib/import/apply-mappings';
import { IMPORT_REF_PROVIDER_PHOREST } from '@/lib/import/external-refs';
import {
  normaliseEmail,
  normalisePhoneUk,
  parseDateString,
  parseTimeString,
} from '@/lib/import/normalize';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export async function runImportValidation(
  admin: SupabaseClient,
  sessionId: string,
  venueId: string,
): Promise<{ errorCount: number; warningCount: number }> {
  await admin.from('import_validation_issues').delete().eq('session_id', sessionId);

  const { data: session } = await admin
    .from('import_sessions')
    .select('id, session_settings, detected_platform')
    .eq('id', sessionId)
    .eq('venue_id', venueId)
    .single();

  if (!session) throw new Error('Session not found');

  const detectedPlatform = (session as { detected_platform?: string | null }).detected_platform ?? null;
  const usePhorestRefs = detectedPlatform === 'phorest';

  let existingPhorestBookingIds = new Set<string>();
  let existingPhorestGuestIds = new Set<string>();
  if (usePhorestRefs) {
    const { data: brefs } = await admin
      .from('external_record_refs')
      .select('external_id')
      .eq('venue_id', venueId)
      .eq('provider', IMPORT_REF_PROVIDER_PHOREST)
      .eq('entity_type', 'booking');
    existingPhorestBookingIds = new Set(
      (brefs ?? []).map((r) => (r as { external_id: string }).external_id),
    );
    const { data: grefs } = await admin
      .from('external_record_refs')
      .select('external_id')
      .eq('venue_id', venueId)
      .eq('provider', IMPORT_REF_PROVIDER_PHOREST)
      .eq('entity_type', 'guest');
    existingPhorestGuestIds = new Set(
      (grefs ?? []).map((r) => (r as { external_id: string }).external_id),
    );
  }

  const settings = (session.session_settings ?? {}) as {
    ambiguous_date_format?: 'dd/MM/yyyy' | 'MM/dd/yyyy' | null;
  };
  const datePref = settings.ambiguous_date_format ?? null;

  const { data: files } = await admin
    .from('import_files')
    .select('id, file_type, storage_path, row_count')
    .eq('session_id', sessionId)
    .order('created_at');

  const { data: mappingRows } = await admin
    .from('import_column_mappings')
    .select('*')
    .eq('session_id', sessionId);

  const byFile = new Map<string, DbMappingRow[]>();
  for (const m of mappingRows ?? []) {
    const fid = (m as { file_id: string }).file_id;
    const list = byFile.get(fid) ?? [];
    list.push(m as DbMappingRow);
    byFile.set(fid, list);
  }

  const { data: existingGuests } = await admin
    .from('guests')
    .select('email, phone')
    .eq('venue_id', venueId);

  const existingEmails = new Set(
    (existingGuests ?? [])
      .map((g) => (g as { email?: string | null }).email)
      .filter(Boolean)
      .map((e) => String(e).toLowerCase()),
  );
  const existingPhones = new Set(
    (existingGuests ?? [])
      .map((g) => (g as { phone?: string | null }).phone)
      .filter(Boolean)
      .map((p) => String(p)),
  );

  let errorCount = 0;
  let warningCount = 0;
  const blockingErrorRowKeys = new Set<string>();
  const existingClientRowKeys = new Set<string>();

  function rowKey(fileId: string, rowNum: number) {
    return `${fileId}:${rowNum}`;
  }

  let totalDataRows = 0;
  for (const file of files ?? []) {
    const meta = file as { file_type: string; row_count?: number | null };
    if (meta.file_type === 'staff') continue;
    totalDataRows += meta.row_count ?? 0;
  }

  for (const file of files ?? []) {
    const f = file as { id: string; file_type: string; storage_path: string };
    if (f.file_type === 'staff') continue;
    const maps = byFile.get(f.id) ?? [];
    const parsed = await downloadAndParseCsv(admin, f.storage_path);
    const seenEmails = new Map<string, number>();
    const seenPhones = new Map<string, number>();
    const seenExternalClientIds = new Map<string, number>();
    const seenAppointmentIds = new Map<string, number>();

    for (let i = 0; i < parsed.rows.length; i++) {
      const rowNum = i + 1;
      const row = parsed.rows[i]!;
      const { targets } = applyMappingsToDataRow(row, maps);

      if (f.file_type === 'clients' || f.file_type === 'unknown') {
        const fn = targets.first_name?.trim() ?? '';
        const ln = targets.last_name?.trim() ?? '';
        if (!fn || !ln) {
          blockingErrorRowKeys.add(rowKey(f.id, rowNum));
          await insertIssue(admin, sessionId, f.id, rowNum, 'error', 'missing_required', 'first_name', fn, 'First and last name are required (or map a full name column).');
          errorCount += 1;
        }

        const em = normaliseEmail(targets.email ?? null);
        if (targets.email?.trim() && !em) {
          blockingErrorRowKeys.add(rowKey(f.id, rowNum));
          await insertIssue(admin, sessionId, f.id, rowNum, 'error', 'email_invalid', 'email', targets.email, 'Invalid email format');
          errorCount += 1;
        } else if (em) {
          if (seenEmails.has(em)) {
            blockingErrorRowKeys.add(rowKey(f.id, rowNum));
            await insertIssue(admin, sessionId, f.id, rowNum, 'error', 'duplicate_email', 'email', em, 'Duplicate email in this file');
            errorCount += 1;
          }
          seenEmails.set(em, rowNum);
          if (existingEmails.has(em)) {
            existingClientRowKeys.add(rowKey(f.id, rowNum));
            await insertIssue(admin, sessionId, f.id, rowNum, 'warning', 'existing_client', 'email', em, 'This email already exists in ReserveNI');
            warningCount += 1;
          }
        }

        const ph = normalisePhoneUk(targets.phone ?? null);
        if (ph.e164 && seenPhones.has(ph.e164)) {
          blockingErrorRowKeys.add(rowKey(f.id, rowNum));
          await insertIssue(admin, sessionId, f.id, rowNum, 'error', 'duplicate_phone', 'phone', ph.e164, 'Duplicate phone in this file');
          errorCount += 1;
        }
        if (ph.e164) seenPhones.set(ph.e164, rowNum);
        if (ph.warning && targets.phone?.trim()) {
          await insertIssue(admin, sessionId, f.id, rowNum, 'warning', 'phone_invalid', 'phone', targets.phone, 'Phone could not be normalised to UK E.164; stored as entered');
          warningCount += 1;
        }
        if (existingPhones.has(ph.e164 ?? '') && ph.e164) {
          existingClientRowKeys.add(rowKey(f.id, rowNum));
          await insertIssue(admin, sessionId, f.id, rowNum, 'warning', 'existing_client', 'phone', ph.e164, 'This phone already exists in ReserveNI');
          warningCount += 1;
        }

        const extCl = targets.external_client_id?.trim();
        if (extCl) {
          if (seenExternalClientIds.has(extCl)) {
            blockingErrorRowKeys.add(rowKey(f.id, rowNum));
            await insertIssue(
              admin,
              sessionId,
              f.id,
              rowNum,
              'error',
              'duplicate_external_client_id',
              'external_client_id',
              extCl,
              'Duplicate external client ID in this file',
            );
            errorCount += 1;
          }
          seenExternalClientIds.set(extCl, rowNum);
          if (usePhorestRefs && existingPhorestGuestIds.has(extCl)) {
            existingClientRowKeys.add(rowKey(f.id, rowNum));
            await insertIssue(
              admin,
              sessionId,
              f.id,
              rowNum,
              'warning',
              'existing_client',
              'external_client_id',
              extCl,
              'This Phorest client ID already exists in ReserveNI',
            );
            warningCount += 1;
          }
        }

        for (const key of ['first_visit_date', 'last_visit_date', 'date_of_birth'] as const) {
          const raw = targets[key];
          if (!raw?.trim()) continue;
          const { iso, ambiguous } = parseDateString(raw, datePref ?? undefined);
          if (!iso) {
            await insertIssue(admin, sessionId, f.id, rowNum, 'warning', 'invalid_format', key, raw, 'Could not parse date');
            warningCount += 1;
          } else if (ambiguous && !datePref) {
            await insertIssue(admin, sessionId, f.id, rowNum, 'warning', 'date_format_ambiguous', key, raw, 'Date format is ambiguous (DD/MM vs MM/DD). Choose a format below.');
            warningCount += 1;
          }
        }
      }

      if (f.file_type === 'bookings') {
        const em = normaliseEmail(targets.client_email ?? null);
        const ph = normalisePhoneUk(targets.client_phone ?? null);
        const extClient = targets.client_external_id?.trim() ?? '';
        if (!em && !ph.e164 && !extClient) {
          blockingErrorRowKeys.add(rowKey(f.id, rowNum));
          await insertIssue(
            admin,
            sessionId,
            f.id,
            rowNum,
            'error',
            'missing_required',
            'client_email',
            '',
            'Client email, phone, or external client ID is required',
          );
          errorCount += 1;
        }
        if (em && !EMAIL_RE.test(em)) {
          blockingErrorRowKeys.add(rowKey(f.id, rowNum));
          await insertIssue(admin, sessionId, f.id, rowNum, 'error', 'email_invalid', 'client_email', targets.client_email ?? '', 'Invalid email');
          errorCount += 1;
        }

        const bdRaw = targets.booking_date?.trim() ?? '';
        if (!bdRaw) {
          blockingErrorRowKeys.add(rowKey(f.id, rowNum));
          await insertIssue(admin, sessionId, f.id, rowNum, 'error', 'missing_required', 'booking_date', '', 'Booking date is required');
          errorCount += 1;
        } else {
          const { iso, ambiguous } = parseDateString(bdRaw, datePref ?? undefined);
          if (!iso) {
            blockingErrorRowKeys.add(rowKey(f.id, rowNum));
            await insertIssue(admin, sessionId, f.id, rowNum, 'error', 'invalid_format', 'booking_date', bdRaw, 'Could not parse booking date');
            errorCount += 1;
          } else if (ambiguous && !datePref) {
            await insertIssue(admin, sessionId, f.id, rowNum, 'warning', 'date_format_ambiguous', 'booking_date', bdRaw, 'Ambiguous date — pick DD/MM or MM/DD in session settings.');
            warningCount += 1;
          }
        }

        const bt = parseTimeString(targets.booking_time ?? null);
        if (!targets.booking_time?.trim() || !bt) {
          blockingErrorRowKeys.add(rowKey(f.id, rowNum));
          await insertIssue(admin, sessionId, f.id, rowNum, 'error', 'missing_required', 'booking_time', targets.booking_time ?? '', 'Booking time is required');
          errorCount += 1;
        }

        const apptId = targets.external_appointment_id?.trim();
        if (apptId) {
          if (seenAppointmentIds.has(apptId)) {
            blockingErrorRowKeys.add(rowKey(f.id, rowNum));
            await insertIssue(
              admin,
              sessionId,
              f.id,
              rowNum,
              'error',
              'duplicate_external_appointment_id',
              'external_appointment_id',
              apptId,
              'Duplicate appointment ID in this file',
            );
            errorCount += 1;
          }
          seenAppointmentIds.set(apptId, rowNum);
          if (usePhorestRefs && existingPhorestBookingIds.has(apptId)) {
            blockingErrorRowKeys.add(rowKey(f.id, rowNum));
            await insertIssue(
              admin,
              sessionId,
              f.id,
              rowNum,
              'error',
              'duplicate_external_appointment_id',
              'external_appointment_id',
              apptId,
              'This appointment was already imported from Phorest',
            );
            errorCount += 1;
          }
        }
      }
    }
  }

  const rowsWithBlockingErrors = blockingErrorRowKeys.size;
  const rowsReady = Math.max(0, totalDataRows - rowsWithBlockingErrors);

  const { data: skippedRefs } = await admin
    .from('import_booking_references')
    .select('file_id, raw_value, reference_type')
    .eq('session_id', sessionId)
    .eq('resolution_action', 'skip');

  const skippedList = skippedRefs ?? [];
  for (let idx = 0; idx < skippedList.length; idx++) {
    const f = skippedList[idx] as { file_id: string; raw_value: string; reference_type: string };
    /** Sentinel row numbers so the UI does not collide with real CSV line numbers (see ValidateStepClient). */
    const syntheticRow = 900_000 + idx;
    await insertIssue(
      admin,
      sessionId,
      f.file_id,
      syntheticRow,
      'warning',
      'reference_skipped',
      f.reference_type,
      f.raw_value,
      `Reference skipped (${f.reference_type}): rows using "${f.raw_value}" may be omitted at import.`,
    );
    warningCount += 1;
  }

  const prevSettings = (session.session_settings ?? {}) as Record<string, unknown>;
  const nextSettings = {
    ...prevSettings,
    validation_summary: {
      total_data_rows: totalDataRows,
      rows_with_blocking_errors: rowsWithBlockingErrors,
      rows_ready: rowsReady,
      rows_with_existing_client_warning: existingClientRowKeys.size,
      error_issue_count: errorCount,
      warning_issue_count: warningCount,
      staff_files_skipped: (files ?? []).filter((x) => (x as { file_type: string }).file_type === 'staff').length,
    },
  };

  await admin
    .from('import_sessions')
    .update({
      status: 'ready',
      validation_job_status: 'complete',
      validation_job_error: null,
      session_settings: nextSettings,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  return { errorCount, warningCount };
}

async function insertIssue(
  admin: SupabaseClient,
  sessionId: string,
  fileId: string,
  rowNumber: number,
  severity: 'error' | 'warning',
  issueType: string,
  columnName: string | null,
  rawValue: string | null,
  message: string,
) {
  await admin.from('import_validation_issues').insert({
    session_id: sessionId,
    file_id: fileId,
    row_number: rowNumber,
    severity,
    issue_type: issueType,
    column_name: columnName,
    raw_value: rawValue,
    message,
  });
}
