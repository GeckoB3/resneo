import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Build a CSV report for a completed (or in-progress) import session:
 * summary row, then import_records, then validation issues.
 */
export async function buildImportReportCsv(
  admin: SupabaseClient,
  sessionId: string,
  venueId: string,
): Promise<string> {
  const { data: session } = await admin
    .from('import_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('venue_id', venueId)
    .single();

  if (!session) throw new Error('Session not found');

  const [{ data: records }, { data: issues }, { data: bookingRefs }] = await Promise.all([
    admin.from('import_records').select('*').eq('session_id', sessionId).order('created_at'),
    admin.from('import_validation_issues').select('*').eq('session_id', sessionId).order('row_number'),
    admin.from('import_booking_references').select('*').eq('session_id', sessionId).order('reference_type'),
  ]);

  const s = session as Record<string, unknown>;
  const lines: string[][] = [];

  lines.push(['Resneo Import Report']);
  lines.push([]);
  lines.push(['Session ID', String(s.id ?? '')]);
  lines.push(['Status', String(s.status ?? '')]);
  lines.push(['Created', String(s.created_at ?? '')]);
  lines.push(['Completed', String(s.completed_at ?? '')]);
  lines.push(['Total rows (files)', String(s.total_rows ?? '')]);
  lines.push(['Imported clients', String(s.imported_clients ?? '')]);
  lines.push(['Imported bookings', String(s.imported_bookings ?? '')]);
  lines.push(['Skipped rows', String(s.skipped_rows ?? '')]);
  lines.push(['Updated existing', String(s.updated_existing ?? '')]);
  lines.push(['Undo until', String(s.undo_available_until ?? '')]);
  lines.push(['Has booking file', String(s.has_booking_file ?? '')]);
  lines.push(['References resolved', String(s.references_resolved ?? '')]);
  lines.push([]);

  lines.push(['— Booking references (Step 3b) —']);
  lines.push([
    'reference_type',
    'raw_value',
    'booking_count',
    'resolution_action',
    'resolved_entity_type',
    'resolved_entity_id',
    'is_resolved',
  ]);
  for (const r of bookingRefs ?? []) {
    const row = r as Record<string, unknown>;
    lines.push([
      String(row.reference_type ?? ''),
      String(row.raw_value ?? ''),
      String(row.booking_count ?? ''),
      String(row.resolution_action ?? ''),
      String(row.resolved_entity_type ?? ''),
      String(row.resolved_entity_id ?? ''),
      String(row.is_resolved ?? ''),
    ]);
  }
  lines.push([]);

  lines.push(['— Import records —']);
  lines.push(['record_type', 'record_id', 'action', 'previous_data_json']);
  for (const r of records ?? []) {
    const row = r as Record<string, unknown>;
    lines.push([
      String(row.record_type ?? ''),
      String(row.record_id ?? ''),
      String(row.action ?? ''),
      row.previous_data ? JSON.stringify(row.previous_data) : '',
    ]);
  }
  lines.push([]);

  lines.push(['— Validation issues —']);
  lines.push(['row_number', 'severity', 'issue_type', 'column_name', 'message', 'user_decision']);
  for (const i of issues ?? []) {
    const row = i as Record<string, unknown>;
    lines.push([
      String(row.row_number ?? ''),
      String(row.severity ?? ''),
      String(row.issue_type ?? ''),
      String(row.column_name ?? ''),
      String(row.message ?? ''),
      String(row.user_decision ?? ''),
    ]);
  }

  return lines.map((row) => row.map(csvEscape).join(',')).join('\r\n');
}

function csvEscape(cell: string): string {
  if (cell.includes(',') || cell.includes('"') || cell.includes('\n') || cell.includes('\r')) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}
