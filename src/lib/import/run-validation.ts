import type { SupabaseClient } from '@supabase/supabase-js';
import { downloadAndParseCsv } from '@/lib/import/parse-storage-csv';
import { applyMappingsToDataRow, type DbMappingRow } from '@/lib/import/apply-mappings';
import { IMPORT_REF_PROVIDER_PHOREST } from '@/lib/import/external-refs';
import { ValidationIssueBuffer } from '@/lib/import/validation-issue-buffer';
import { evaluateClientRowNameRule } from '@/lib/import/client-row-name-rule';
import { loadVenueGuestEmailsAndPhones, phoneForMatching } from '@/lib/import/guest-lookup';
import {
  evaluateBookingDefaultsForImport,
  resolveBookingImportDefaults,
} from '@/lib/import/booking-import-defaults';
import {
  normaliseEmail,
  normalisePhone,
} from '@/lib/import/normalize';
import { defaultPhoneCountryFromCurrency } from '@/lib/phone/e164';
import {
  parseDateWithRepairs,
  parseTimeWithRepairs,
  readValueRepairs,
} from '@/lib/import/value-repair';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

/** How often to persist validation row progress to `import_sessions` (reduces write load). */
const VALIDATION_PROGRESS_FLUSH_EVERY = 400;

export interface ImportValidationResult {
  errorCount: number;
  warningCount: number;
  /** Distinct date strings no parser or existing repair could read (never AI-tried). */
  unparseableDates: string[];
  /** Distinct time strings no parser or existing repair could read (never AI-tried). */
  unparseableTimes: string[];
}

export async function runImportValidation(
  admin: SupabaseClient,
  sessionId: string,
  venueId: string,
): Promise<ImportValidationResult> {
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
  } & Record<string, unknown>;
  const datePref = settings.ambiguous_date_format ?? null;
  const valueRepairs = readValueRepairs(settings);
  /** Values neither the parser nor an existing repair could read; undefined in the map = never AI-tried. */
  const unparseableDates = new Set<string>();
  const unparseableTimes = new Set<string>();

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

  const { data: venueRow } = await admin
    .from('venues')
    .select('currency')
    .eq('id', venueId)
    .maybeSingle();
  const defaultPhoneCountry = defaultPhoneCountryFromCurrency(
    (venueRow as { currency?: string | null } | null)?.currency,
  );

  const { emails: existingEmails, phones: existingPhones } = await loadVenueGuestEmailsAndPhones(
    admin,
    venueId,
    defaultPhoneCountry,
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

  await admin
    .from('import_sessions')
    .update({
      validation_rows_total: totalDataRows,
      validation_rows_processed: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  const issueBuffer = new ValidationIssueBuffer(admin);
  let scannedRows = 0;

  async function maybeFlushValidationProgress() {
    if (scannedRows === 0 || scannedRows % VALIDATION_PROGRESS_FLUSH_EVERY !== 0) return;
    await admin
      .from('import_sessions')
      .update({
        validation_rows_processed: scannedRows,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId);
  }

  for (const file of files ?? []) {
    const f = file as { id: string; file_type: string; storage_path: string };
    if (f.file_type === 'staff') continue;
    const maps = byFile.get(f.id) ?? [];
    const parsed = await downloadAndParseCsv(admin, f.storage_path);
    const seenExternalClientIds = new Map<string, number>();
    const seenAppointmentIds = new Map<string, number>();

    for (let i = 0; i < parsed.rows.length; i++) {
      const rowNum = i + 1;
      const row = parsed.rows[i]!;
      const { targets } = applyMappingsToDataRow(row, maps);

      if (f.file_type === 'clients' || f.file_type === 'unknown') {
        const fn = targets.first_name?.trim() ?? '';
        const ln = targets.last_name?.trim() ?? '';
        const emPreview = normaliseEmail(targets.email ?? null);
        const phPreview = normalisePhone(targets.phone ?? null, defaultPhoneCountry);
        const nameOutcome = evaluateClientRowNameRule({
          firstName: fn,
          lastName: ln,
          email: emPreview ?? targets.email ?? null,
          phone: phPreview.e164 ?? targets.phone ?? null,
        });

        if (nameOutcome.kind === 'missing_name') {
          blockingErrorRowKeys.add(rowKey(f.id, rowNum));
          await issueBuffer.add({
            session_id: sessionId,
            file_id: f.id,
            row_number: rowNum,
            severity: 'error',
            issue_type: 'missing_required',
            column_name: 'first_name',
            raw_value: fn,
            message: 'A first name or last name is required (or map a full name column).',
          });
          errorCount += 1;
        } else if (nameOutcome.kind === 'missing_contact') {
          blockingErrorRowKeys.add(rowKey(f.id, rowNum));
          await issueBuffer.add({
            session_id: sessionId,
            file_id: f.id,
            row_number: rowNum,
            severity: 'error',
            issue_type: 'missing_required',
            column_name: fn ? 'last_name' : 'first_name',
            raw_value: fn || ln,
            message:
              'When only one of first or last name is provided, an email or mobile number is required to identify the client.',
          });
          errorCount += 1;
        } else if (nameOutcome.kind === 'partial_name_ok') {
          await issueBuffer.add({
            session_id: sessionId,
            file_id: f.id,
            row_number: rowNum,
            severity: 'warning',
            issue_type: 'partial_name',
            column_name: fn ? 'last_name' : 'first_name',
            raw_value: fn || ln,
            message: fn ?
              'Only first name provided; importing with surname left blank.'
            : 'Only last name provided; importing with first name left blank.',
          });
          warningCount += 1;
        }

        if (
          nameOutcome.kind === 'ok' &&
          !targets.email?.trim() &&
          !targets.phone?.trim()
        ) {
          /** Full name with no contact details: not blocking, but flag because re-imports cannot dedupe these rows. */
          await issueBuffer.add({
            session_id: sessionId,
            file_id: f.id,
            row_number: rowNum,
            severity: 'warning',
            issue_type: 'no_contact_details',
            column_name: 'email',
            raw_value: '',
            message:
              'No email or phone — this row will be imported but cannot be deduplicated against existing or future imports.',
          });
          warningCount += 1;
        }

        const em = emPreview;
        if (targets.email?.trim() && !em) {
          blockingErrorRowKeys.add(rowKey(f.id, rowNum));
          await issueBuffer.add({
            session_id: sessionId,
            file_id: f.id,
            row_number: rowNum,
            severity: 'error',
            issue_type: 'email_invalid',
            column_name: 'email',
            raw_value: targets.email,
            message: 'Invalid email format',
          });
          errorCount += 1;
        } else if (em) {
          if (existingEmails.has(em)) {
            existingClientRowKeys.add(rowKey(f.id, rowNum));
            await issueBuffer.add({
              session_id: sessionId,
              file_id: f.id,
              row_number: rowNum,
              severity: 'warning',
              issue_type: 'existing_client',
              column_name: 'email',
              raw_value: em,
              message: 'This email already exists in ResNeo',
            });
            warningCount += 1;
          }
        }

        const ph = phPreview;
        if (ph.warning && targets.phone?.trim()) {
          await issueBuffer.add({
            session_id: sessionId,
            file_id: f.id,
            row_number: rowNum,
            severity: 'warning',
            issue_type: 'phone_invalid',
            column_name: 'phone',
            raw_value: targets.phone,
            message: 'Phone could not be normalised to UK E.164; stored as entered',
          });
          warningCount += 1;
        }
        const phMatchKey = phoneForMatching(ph);
        if (phMatchKey && existingPhones.has(phMatchKey)) {
          existingClientRowKeys.add(rowKey(f.id, rowNum));
          await issueBuffer.add({
            session_id: sessionId,
            file_id: f.id,
            row_number: rowNum,
            severity: 'warning',
            issue_type: 'existing_client',
            column_name: 'phone',
            raw_value: phMatchKey,
            message: 'This phone already exists in ResNeo',
          });
          warningCount += 1;
        }

        const extCl = targets.external_client_id?.trim();
        if (extCl) {
          if (seenExternalClientIds.has(extCl)) {
            blockingErrorRowKeys.add(rowKey(f.id, rowNum));
            await issueBuffer.add({
              session_id: sessionId,
              file_id: f.id,
              row_number: rowNum,
              severity: 'error',
              issue_type: 'duplicate_external_client_id',
              column_name: 'external_client_id',
              raw_value: extCl,
              message: 'Duplicate external client ID in this file',
            });
            errorCount += 1;
          }
          seenExternalClientIds.set(extCl, rowNum);
          if (usePhorestRefs && existingPhorestGuestIds.has(extCl)) {
            existingClientRowKeys.add(rowKey(f.id, rowNum));
            await issueBuffer.add({
              session_id: sessionId,
              file_id: f.id,
              row_number: rowNum,
              severity: 'warning',
              issue_type: 'existing_client',
              column_name: 'external_client_id',
              raw_value: extCl,
              message: 'This external client ID has already been imported into ResNeo',
            });
            warningCount += 1;
          }
        }

        for (const key of ['first_visit_date', 'last_visit_date', 'date_of_birth'] as const) {
          const raw = targets[key];
          if (!raw?.trim()) continue;
          const { iso, ambiguous } = parseDateWithRepairs(raw, datePref, valueRepairs);
          if (!iso) {
            if (valueRepairs.dates[raw.trim()] === undefined) unparseableDates.add(raw.trim());
            await issueBuffer.add({
              session_id: sessionId,
              file_id: f.id,
              row_number: rowNum,
              severity: 'warning',
              issue_type: 'invalid_format',
              column_name: key,
              raw_value: raw,
              message: 'Could not parse date',
            });
            warningCount += 1;
          } else if (ambiguous && !datePref) {
            await issueBuffer.add({
              session_id: sessionId,
              file_id: f.id,
              row_number: rowNum,
              severity: 'warning',
              issue_type: 'date_format_ambiguous',
              column_name: key,
              raw_value: raw,
              message: 'Date format is ambiguous (DD/MM vs MM/DD). Choose a format below.',
            });
            warningCount += 1;
          }
        }
      }

      if (f.file_type === 'bookings') {
        const em = normaliseEmail(targets.client_email ?? null);
        if (em && !EMAIL_RE.test(em)) {
          blockingErrorRowKeys.add(rowKey(f.id, rowNum));
          await issueBuffer.add({
            session_id: sessionId,
            file_id: f.id,
            row_number: rowNum,
            severity: 'error',
            issue_type: 'email_invalid',
            column_name: 'client_email',
            raw_value: targets.client_email ?? '',
            message: 'Invalid email',
          });
          errorCount += 1;
        }

        const bdRaw = targets.booking_date?.trim() ?? '';
        if (!bdRaw) {
          blockingErrorRowKeys.add(rowKey(f.id, rowNum));
          await issueBuffer.add({
            session_id: sessionId,
            file_id: f.id,
            row_number: rowNum,
            severity: 'error',
            issue_type: 'missing_required',
            column_name: 'booking_date',
            raw_value: '',
            message: 'Booking date is required',
          });
          errorCount += 1;
        } else {
          const { iso, ambiguous } = parseDateWithRepairs(bdRaw, datePref, valueRepairs);
          if (!iso) {
            if (valueRepairs.dates[bdRaw] === undefined) unparseableDates.add(bdRaw);
            blockingErrorRowKeys.add(rowKey(f.id, rowNum));
            await issueBuffer.add({
              session_id: sessionId,
              file_id: f.id,
              row_number: rowNum,
              severity: 'error',
              issue_type: 'invalid_format',
              column_name: 'booking_date',
              raw_value: bdRaw,
              message: 'Could not parse booking date',
            });
            errorCount += 1;
          } else if (ambiguous && !datePref) {
            await issueBuffer.add({
              session_id: sessionId,
              file_id: f.id,
              row_number: rowNum,
              severity: 'warning',
              issue_type: 'date_format_ambiguous',
              column_name: 'booking_date',
              raw_value: bdRaw,
              message: 'Ambiguous date — pick DD/MM or MM/DD in session settings.',
            });
            warningCount += 1;
          }
        }

        const btRaw = targets.booking_time?.trim() ?? '';
        const { time: bt } = parseTimeWithRepairs(btRaw, valueRepairs);
        if (!btRaw || !bt) {
          if (btRaw && valueRepairs.times[btRaw] === undefined) unparseableTimes.add(btRaw);
          blockingErrorRowKeys.add(rowKey(f.id, rowNum));
          await issueBuffer.add({
            session_id: sessionId,
            file_id: f.id,
            row_number: rowNum,
            severity: 'error',
            issue_type: 'missing_required',
            column_name: 'booking_time',
            raw_value: targets.booking_time ?? '',
            message: 'Booking time is required',
          });
          errorCount += 1;
        }

        const apptId = targets.external_appointment_id?.trim();
        if (apptId) {
          if (seenAppointmentIds.has(apptId)) {
            blockingErrorRowKeys.add(rowKey(f.id, rowNum));
            await issueBuffer.add({
              session_id: sessionId,
              file_id: f.id,
              row_number: rowNum,
              severity: 'error',
              issue_type: 'duplicate_external_appointment_id',
              column_name: 'external_appointment_id',
              raw_value: apptId,
              message: 'Duplicate appointment ID in this file',
            });
            errorCount += 1;
          }
          seenAppointmentIds.set(apptId, rowNum);
          if (usePhorestRefs && existingPhorestBookingIds.has(apptId)) {
            blockingErrorRowKeys.add(rowKey(f.id, rowNum));
            await issueBuffer.add({
              session_id: sessionId,
              file_id: f.id,
              row_number: rowNum,
              severity: 'error',
              issue_type: 'duplicate_external_appointment_id',
              column_name: 'external_appointment_id',
              raw_value: apptId,
              message: 'This appointment ID has already been imported into ResNeo',
            });
            errorCount += 1;
          }
        }
      }

      scannedRows += 1;
      await maybeFlushValidationProgress();
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
    await issueBuffer.add({
      session_id: sessionId,
      file_id: f.file_id,
      row_number: syntheticRow,
      severity: 'warning',
      issue_type: 'reference_skipped',
      column_name: f.reference_type,
      raw_value: f.raw_value,
      message: `Reference skipped (${f.reference_type}): rows using "${f.raw_value}" may be omitted at import.`,
    });
    warningCount += 1;
  }

  let bookingDefaultsBlocked = false;
  const bookingFileForBlocking = (files ?? []).find(
    (x) => (x as { file_type: string }).file_type === 'bookings',
  ) as { id: string } | undefined;
  if (bookingFileForBlocking) {
    const defaults = await resolveBookingImportDefaults(admin, venueId);
    const blocking = evaluateBookingDefaultsForImport(defaults);
    if (blocking) {
      bookingDefaultsBlocked = true;
      /** Sentinel row number distinct from `reference_skipped` (900_000+) so UI groups separately. */
      const syntheticRow = 800_000;
      await issueBuffer.add({
        session_id: sessionId,
        file_id: bookingFileForBlocking.id,
        row_number: syntheticRow,
        severity: 'error',
        issue_type: 'booking_defaults_missing',
        column_name: blocking.bookingModel,
        raw_value: '',
        message: blocking.message,
      });
      errorCount += 1;
    }
  }

  await issueBuffer.flushAll();

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
      booking_defaults_blocked: bookingDefaultsBlocked,
    },
  };

  await admin
    .from('import_sessions')
    .update({
      status: 'ready',
      validation_job_status: 'complete',
      validation_job_error: null,
      validation_rows_processed: totalDataRows,
      validation_rows_total: totalDataRows,
      session_settings: nextSettings,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  return {
    errorCount,
    warningCount,
    unparseableDates: [...unparseableDates],
    unparseableTimes: [...unparseableTimes],
  };
}
