import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookingModel } from '@/types/booking-models';
import { applyMappingsToDataRow, type DbMappingRow } from '@/lib/import/apply-mappings';
import { resolveVenueMode } from '@/lib/venue-mode';
import { downloadAndParseCsv } from '@/lib/import/parse-storage-csv';
import {
  durationMinutesBetweenTimes,
  parseDateString,
  parseIntSafe,
  parseTimeString,
  splitFullName,
  todayIsoLocal,
} from '@/lib/import/normalize';

const INSERT_CHUNK_SIZE = 200;

function isFutureBookingDate(iso: string, today: string): boolean {
  return iso >= today;
}

export type ExtractBookingReferencesResult = {
  referencesResolved: boolean;
  futureRowCount: number;
  extractedReferenceCount: number;
  insertedBookingRowCount: number;
  requiresTableConfirmation: boolean;
  bookingModel: BookingModel;
  mode:
    | 'no_booking_file'
    | 'no_booking_date_mapping'
    | 'no_future_rows'
    | 'table_pending'
    | 'unified_refs_pending'
    | 'ready';
};

/**
 * Deletes staged rows/refs, re-parses booking CSVs, inserts `import_booking_rows` for future rows
 * and `import_booking_references` for service/staff (non–table-reservation) where needed.
 * Updates `import_sessions.references_resolved`.
 */
export async function runExtractBookingReferences(
  admin: SupabaseClient,
  sessionId: string,
  venueId: string,
): Promise<ExtractBookingReferencesResult> {
  const today = todayIsoLocal();

  const venueMode = await resolveVenueMode(admin, venueId);
  const bookingModel = venueMode.bookingModel;

  const { data: session } = await admin
    .from('import_sessions')
    .select('id, session_settings, has_booking_file')
    .eq('id', sessionId)
    .eq('venue_id', venueId)
    .single();

  if (!session) throw new Error('Session not found');

  const settings = (session as { session_settings?: Record<string, unknown> }).session_settings ?? {};
  const datePref = settings.ambiguous_date_format as 'dd/MM/yyyy' | 'MM/dd/yyyy' | null | undefined;

  const hasBookingFile = Boolean((session as { has_booking_file?: boolean }).has_booking_file);

  if (!hasBookingFile) {
    await admin
      .from('import_sessions')
      .update({ references_resolved: true, updated_at: new Date().toISOString() })
      .eq('id', sessionId);
    return {
      referencesResolved: true,
      futureRowCount: 0,
      extractedReferenceCount: 0,
      insertedBookingRowCount: 0,
      requiresTableConfirmation: false,
      bookingModel,
      mode: 'no_booking_file',
    };
  }

  await admin.from('import_booking_rows').delete().eq('session_id', sessionId);
  await admin.from('import_booking_references').delete().eq('session_id', sessionId);

  const { data: files } = await admin
    .from('import_files')
    .select('id, storage_path, file_type')
    .eq('session_id', sessionId)
    .order('created_at');

  const bookingFiles = (files ?? []).filter((f) => (f as { file_type: string }).file_type === 'bookings');
  if (!bookingFiles.length) {
    await admin
      .from('import_sessions')
      .update({ references_resolved: true, updated_at: new Date().toISOString() })
      .eq('id', sessionId);
    return {
      referencesResolved: true,
      futureRowCount: 0,
      extractedReferenceCount: 0,
      insertedBookingRowCount: 0,
      requiresTableConfirmation: false,
      bookingModel,
      mode: 'no_booking_file',
    };
  }

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

  let anyBookingDateMapping = false;
  for (const f of bookingFiles) {
    const maps = byFile.get((f as { id: string }).id) ?? [];
    if (maps.some((m) => m.action === 'map' && m.target_field === 'booking_date')) {
      anyBookingDateMapping = true;
      break;
    }
  }

  if (!anyBookingDateMapping) {
    await admin
      .from('import_sessions')
      .update({ references_resolved: true, updated_at: new Date().toISOString() })
      .eq('id', sessionId);
    return {
      referencesResolved: true,
      futureRowCount: 0,
      extractedReferenceCount: 0,
      insertedBookingRowCount: 0,
      requiresTableConfirmation: false,
      bookingModel,
      mode: 'no_booking_date_mapping',
    };
  }

  type StagedRow = {
    file_id: string;
    row_number: number;
    booking_date: string;
    booking_time: string;
    booking_end_time: string | null;
    duration_minutes: number | null;
    party_size: number | null;
    raw_service_name: string | null;
    raw_staff_name: string | null;
    raw_table_ref: string | null;
    raw_event_name: string | null;
    raw_class_name: string | null;
    raw_resource_name: string | null;
    raw_status: string | null;
    raw_price: string | null;
    raw_deposit_amount: string | null;
    raw_deposit_paid: string | null;
    raw_deposit_status: string | null;
    raw_notes: string | null;
    raw_client_email: string | null;
    raw_client_phone: string | null;
    raw_guest_first_name: string | null;
    raw_guest_last_name: string | null;
    raw_external_appointment_id: string | null;
    raw_external_booking_id: string | null;
    raw_external_client_id: string | null;
    raw_group_booking_id: string | null;
    raw_booking_end_time: string | null;
    raw_import_metadata: Record<string, unknown>;
    is_future_booking: boolean;
  };

  function buildBookingImportMetadata(targets: Record<string, string>): Record<string, unknown> {
    const meta: Record<string, unknown> = {};
    const keys = [
      'activation_state',
      'appointment_source',
      'room_id',
      'machine_id',
      'course_name',
      'confirmed',
      'deleted',
    ] as const;
    for (const k of keys) {
      const v = targets[k]?.trim();
      if (v) meta[k] = v;
    }
    return meta;
  }

  function combineBookingNotes(targets: Record<string, string>): string | null {
    const parts = [targets.notes, targets.colour_notes, targets.service_notes]
      .map((s) => s?.trim())
      .filter(Boolean) as string[];
    return parts.length ? parts.join('\n') : null;
  }

  const staged: StagedRow[] = [];

  for (const file of bookingFiles) {
    const f = file as { id: string; storage_path: string };
    const maps = byFile.get(f.id) ?? [];
    const parsed = await downloadAndParseCsv(admin, f.storage_path);

    for (let i = 0; i < parsed.rows.length; i++) {
      const rowNum = i + 1;
      const row = parsed.rows[i]!;
      const { targets } = applyMappingsToDataRow(row, maps);
      const bdRaw = targets.booking_date?.trim() ?? '';
      const btRaw = targets.booking_time?.trim() ?? '';
      const { iso: dateIso } = parseDateString(bdRaw, datePref ?? undefined);
      const bt = parseTimeString(btRaw);
      if (!dateIso || !bt) continue;

      const timeForDb = bt.length === 5 ? `${bt}:00` : bt;
      const endBt = parseTimeString(targets.booking_end_time ?? null);
      const endTimeForDb = endBt ? (endBt.length === 5 ? `${endBt}:00` : endBt) : null;

      let duration = parseIntSafe(targets.duration_minutes);
      let bookingEndTime: string;

      if (endTimeForDb) {
        const dm = durationMinutesBetweenTimes(timeForDb, endTimeForDb);
        if (dm != null && dm > 0) {
          duration = dm;
        }
        bookingEndTime = endTimeForDb;
      } else {
        const dur = duration ?? 60;
        const endParts = timeForDb.slice(0, 5).split(':').map(Number);
        const endMins = (endParts[0] ?? 0) * 60 + (endParts[1] ?? 0) + dur;
        const eh = Math.floor(endMins / 60) % 24;
        const emin = endMins % 60;
        bookingEndTime = `${String(eh).padStart(2, '0')}:${String(emin).padStart(2, '0')}:00`;
        duration = dur;
      }

      const partySize =
        parseIntSafe(targets.party_size) ?? (bookingModel === 'table_reservation' ? 2 : 1);

      const meta = buildBookingImportMetadata(targets);
      const extAppt = targets.external_appointment_id?.trim();
      const extBook = targets.external_booking_id?.trim();
      const extClient = targets.client_external_id?.trim();
      const grp = targets.group_booking_id?.trim();
      if (extAppt) meta.external_appointment_id = extAppt;
      if (extBook) meta.external_booking_id = extBook;
      if (extClient) meta.client_external_id = extClient;
      if (grp) meta.group_booking_id = grp;

      const isFuture = isFutureBookingDate(dateIso, today);

      const clientBlob = targets.guest_full_name?.trim();
      const nameParts = clientBlob ? splitFullName(clientBlob) : { first: '', last: '' };
      const guestFirst = targets.guest_first_name?.trim() || nameParts.first;
      const guestLast = targets.guest_last_name?.trim() || nameParts.last;

      staged.push({
        file_id: f.id,
        row_number: rowNum,
        booking_date: dateIso,
        booking_time: timeForDb,
        booking_end_time: bookingEndTime,
        duration_minutes: duration,
        party_size: partySize,
        raw_service_name: targets.service_name?.trim() || null,
        raw_staff_name: targets.staff_name?.trim() || null,
        raw_table_ref: targets.table_ref?.trim() || null,
        raw_event_name: targets.event_name?.trim() || null,
        raw_class_name: targets.class_name?.trim() || null,
        raw_resource_name: targets.resource_name?.trim() || null,
        raw_status: targets.status?.trim() || null,
        raw_price: targets.price?.trim() || null,
        raw_deposit_amount: targets.deposit_amount?.trim() || null,
        raw_deposit_paid: targets.deposit_paid?.trim() || null,
        raw_deposit_status: targets.deposit_status?.trim() || null,
        raw_notes: combineBookingNotes(targets),
        raw_client_email: targets.client_email?.trim() || null,
        raw_client_phone: targets.client_phone?.trim() || null,
        raw_guest_first_name: guestFirst?.trim() || null,
        raw_guest_last_name: guestLast?.trim() || null,
        raw_external_appointment_id: extAppt ?? null,
        raw_external_booking_id: extBook ?? null,
        raw_external_client_id: extClient ?? null,
        raw_group_booking_id: grp ?? null,
        raw_booking_end_time: targets.booking_end_time?.trim() || null,
        raw_import_metadata: meta,
        is_future_booking: isFuture,
      });
    }
  }

  const futureRows = staged.filter((r) => r.is_future_booking);
  const futureRowCount = futureRows.length;

  if (futureRowCount === 0) {
    await admin
      .from('import_sessions')
      .update({ references_resolved: true, updated_at: new Date().toISOString() })
      .eq('id', sessionId);
    return {
      referencesResolved: true,
      futureRowCount: 0,
      extractedReferenceCount: 0,
      insertedBookingRowCount: 0,
      requiresTableConfirmation: false,
      bookingModel,
      mode: 'no_future_rows',
    };
  }

  const rowInserts = futureRows.map((r) => ({
    session_id: sessionId,
    file_id: r.file_id,
    venue_id: venueId,
    row_number: r.row_number,
    booking_date: r.booking_date,
    booking_time: r.booking_time,
    booking_end_time: r.booking_end_time,
    duration_minutes: r.duration_minutes,
    party_size: r.party_size,
    raw_service_name: r.raw_service_name,
    raw_staff_name: r.raw_staff_name,
    raw_event_name: r.raw_event_name,
    raw_class_name: r.raw_class_name,
    raw_resource_name: r.raw_resource_name,
    raw_table_ref: r.raw_table_ref,
    raw_status: r.raw_status,
    raw_price: r.raw_price,
    raw_deposit_amount: r.raw_deposit_amount,
    raw_deposit_paid: r.raw_deposit_paid,
    raw_deposit_status: r.raw_deposit_status,
    raw_notes: r.raw_notes,
    raw_client_email: r.raw_client_email,
    raw_client_phone: r.raw_client_phone,
    raw_guest_first_name: r.raw_guest_first_name,
    raw_guest_last_name: r.raw_guest_last_name,
    raw_external_appointment_id: r.raw_external_appointment_id,
    raw_external_booking_id: r.raw_external_booking_id,
    raw_external_client_id: r.raw_external_client_id,
    raw_group_booking_id: r.raw_group_booking_id,
    raw_booking_end_time: r.raw_booking_end_time,
    raw_import_metadata: r.raw_import_metadata,
    import_status: 'pending' as const,
    is_future_booking: true,
  }));

  for (let start = 0; start < rowInserts.length; start += INSERT_CHUNK_SIZE) {
    const chunk = rowInserts.slice(start, start + INSERT_CHUNK_SIZE);
    const { error: insRowErr } = await admin.from('import_booking_rows').insert(chunk);
    if (insRowErr) {
      console.error('[extract-booking-references] row insert', {
        error: insRowErr,
        chunkStart: start,
        chunkSize: chunk.length,
        totalRows: rowInserts.length,
      });
      throw new Error('Failed to stage booking rows');
    }
  }

  /** Restaurant flow: acknowledge unassigned tables only (slice 2). */
  if (bookingModel === 'table_reservation') {
    await admin
      .from('import_sessions')
      .update({ references_resolved: false, updated_at: new Date().toISOString() })
      .eq('id', sessionId);
    return {
      referencesResolved: false,
      futureRowCount,
      extractedReferenceCount: 0,
      insertedBookingRowCount: rowInserts.length,
      requiresTableConfirmation: true,
      bookingModel,
      mode: 'table_pending',
    };
  }

  /** Non-table models: extract reference rows for resolution (Slice 3+). */
  type Agg = { type: string; raw: string; count: number; fileId: string };
  const aggregates: Agg[] = [];
  const aggKey = (t: string, raw: string) => `${t}:::${raw.toLowerCase()}`;

  const aggMap = new Map<string, Agg>();
  for (const r of futureRows) {
    const push = (type: string, raw: string | null, fileId: string) => {
      if (!raw?.trim()) return;
      const trimmed = raw.trim();
      const k = aggKey(type, trimmed);
      const ex = aggMap.get(k);
      if (ex) ex.count += 1;
      else {
        const a: Agg = { type, raw: trimmed, count: 1, fileId };
        aggMap.set(k, a);
        aggregates.push(a);
      }
    };

    if (bookingModel === 'unified_scheduling' || bookingModel === 'practitioner_appointment') {
      push('service', r.raw_service_name, r.file_id);
      push('staff', r.raw_staff_name, r.file_id);
    } else if (bookingModel === 'event_ticket') {
      push('event', r.raw_event_name, r.file_id);
    } else if (bookingModel === 'class_session') {
      push('class', r.raw_class_name, r.file_id);
    } else if (bookingModel === 'resource_booking') {
      push('resource', r.raw_resource_name, r.file_id);
    }
  }

  const refRows = aggregates.map((a) => ({
    session_id: sessionId,
    file_id: a.fileId,
    venue_id: venueId,
    reference_type: a.type,
    raw_value: a.raw,
    booking_count: a.count,
    is_resolved: false,
  }));

  if (refRows.length) {
    for (let start = 0; start < refRows.length; start += INSERT_CHUNK_SIZE) {
      const chunk = refRows.slice(start, start + INSERT_CHUNK_SIZE);
      const { error: refErr } = await admin.from('import_booking_references').insert(chunk);
      if (refErr) {
        console.error('[extract-booking-references] refs insert', {
          error: refErr,
          chunkStart: start,
          chunkSize: chunk.length,
          totalRows: refRows.length,
        });
        throw new Error('Failed to stage booking references');
      }
    }
  }

  const referencesResolved = refRows.length === 0;

  await admin
    .from('import_sessions')
    .update({
      references_resolved: referencesResolved,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  return {
    referencesResolved,
    futureRowCount,
    extractedReferenceCount: refRows.length,
    insertedBookingRowCount: rowInserts.length,
    requiresTableConfirmation: false,
    bookingModel,
    mode: referencesResolved ? 'ready' : 'unified_refs_pending',
  };
}
