import type { SupabaseClient } from '@supabase/supabase-js';

export interface ExecuteSkipReason {
  fileId: string;
  rowNumber: number;
  /** Free-form reason key, kept short and machine-friendly (e.g. `no_default_area`). */
  code: string;
  message: string;
}

/**
 * Inserts an `import_validation_issues` row that documents an execute-time skip.
 * This turns previously silent `skipped += 1; continue` paths into an audit
 * line that appears in the Validate UI grouping and the Report CSV.
 *
 * Failures here are logged but do not throw — we never want the audit recorder
 * to break the import itself.
 */
/**
 * A row that WAS imported but needs the venue's attention (issue type `imported_with_note`), for
 * example a future booking on a service that is parked while the venue is in a collective.
 */
export async function recordExecuteNote(
  admin: SupabaseClient,
  sessionId: string,
  note: ExecuteSkipReason,
): Promise<void> {
  const { error } = await admin.from('import_validation_issues').insert({
    session_id: sessionId,
    file_id: note.fileId,
    row_number: note.rowNumber,
    severity: 'warning',
    issue_type: 'imported_with_note',
    column_name: note.code,
    raw_value: '',
    message: note.message,
  });
  if (error) {
    console.error('[execute-skip-audit] failed to record note', { code: note.code, sessionId, error: error.message });
  }
}

/** The note for a future imported booking on a parked service, or null. */
export function parkedImportNote(
  bookable: Set<string> | null,
  serviceItemId: string | null | undefined,
  bookingDateYmd: string,
  todayYmd: string,
): { code: string; message: string } | null {
  if (!bookable || !serviceItemId || bookable.has(serviceItemId) || bookingDateYmd < todayYmd) return null;
  return {
    code: 'parked_service',
    message:
      'Imported, but this service is parked while your venue is part of a collective, so it cannot take new bookings. This booking is kept and can be managed as usual.',
  };
}

export async function recordExecuteSkip(
  admin: SupabaseClient,
  sessionId: string,
  reason: ExecuteSkipReason,
): Promise<void> {
  const { error } = await admin.from('import_validation_issues').insert({
    session_id: sessionId,
    file_id: reason.fileId,
    row_number: reason.rowNumber,
    severity: 'warning',
    issue_type: 'skipped_at_execute',
    column_name: reason.code,
    raw_value: '',
    message: reason.message,
  });
  if (error) {
    console.error('[execute-skip-audit] failed to record skip', {
      code: reason.code,
      sessionId,
      fileId: reason.fileId,
      rowNumber: reason.rowNumber,
      error: error.message,
    });
  }
}
