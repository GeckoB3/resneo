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
