import { NextRequest, NextResponse } from 'next/server';
import { requireImportAdmin } from '@/lib/import/auth';
import { downloadCsvGrid } from '@/lib/import/parse-storage-csv';
import { aiReshapeDataset } from '@/lib/import/ai-reshape-dataset';
import { profileColumns } from '@/lib/import/column-profile';
import { detectFileKind } from '@/lib/import/detect-file-kind';
import { ingestUploadedFile } from '@/lib/import/ingest-file';
import { syncImportSessionBookingFlags } from '@/lib/import/sync-booking-session-flags';

// Reshaping a large report runs several sequential AI calls; give it room.
export const maxDuration = 300;

const PREVIEW_ROWS = 8;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; fileId: string }> },
) {
  const ctx = await requireImportAdmin();
  if ('response' in ctx) return ctx.response;
  const { staff } = ctx;
  const { sessionId, fileId } = await params;

  const { data: fileRow } = await staff.db
    .from('import_files')
    .select('*')
    .eq('id', fileId)
    .eq('session_id', sessionId)
    .eq('venue_id', staff.venue_id)
    .maybeSingle();

  if (!fileRow) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const f = fileRow as {
    file_type: string;
    storage_path: string;
    storage_path_original: string | null;
    reshape_status: string | null;
    ingest_warnings: string[] | null;
    filename: string;
  };

  // Already reshaped (e.g. the client polled again): return the current state.
  if (f.reshape_status === 'done') {
    return NextResponse.json({ ok: true, status: 'done' });
  }

  const sourcePath = f.storage_path_original ?? f.storage_path;
  let grid: string[][];
  try {
    grid = await downloadCsvGrid(staff.db, sourcePath);
  } catch (e) {
    console.error('[reshape] download', e);
    return NextResponse.json({ error: 'Could not read the uploaded file' }, { status: 500 });
  }

  const originalPreview = grid.slice(0, PREVIEW_ROWS);

  const { data: session } = await staff.db
    .from('import_sessions')
    .select('detected_platform')
    .eq('id', sessionId)
    .maybeSingle();
  const detectedPlatform = (session as { detected_platform?: string | null } | null)?.detected_platform ?? null;

  const fileTypeHint =
    f.file_type === 'bookings' || f.file_type === 'staff' || f.file_type === 'clients' ? f.file_type : 'unknown';

  const reshaped = await aiReshapeDataset({ rawGrid: grid, fileTypeHint, detectedPlatform });

  if (!reshaped) {
    await staff.db
      .from('import_files')
      .update({ reshape_status: 'failed' })
      .eq('id', fileId)
      .eq('session_id', sessionId);
    return NextResponse.json({
      ok: false,
      status: 'failed',
      message:
        'We could not automatically reorganise this file. You can still try to map it as-is, or upload a tidied version.',
    });
  }

  // Overwrite the working file with the clean table; the original is preserved.
  const { error: upErr } = await staff.db.storage
    .from('imports')
    .upload(f.storage_path, Buffer.from(reshaped.csvText, 'utf-8'), {
      contentType: 'text/csv',
      upsert: true,
    });
  if (upErr) {
    console.error('[reshape] upload', upErr);
    return NextResponse.json({ error: 'Failed to store the reorganised file' }, { status: 500 });
  }

  const profile = profileColumns(reshaped.headers, reshaped.rows);
  // The reshaped table has clear columns — re-detect the kind (most reports are bookings).
  const detection = detectFileKind({
    filename: f.filename,
    headers: reshaped.headers,
    rowCount: reshaped.rows.length,
    columnProfiles: profile,
  });
  const nextFileType =
    f.file_type === 'unknown' && detection.kind !== 'unknown' && detection.confidence === 'high'
      ? detection.kind
      : f.file_type;

  const warnings = Array.isArray(f.ingest_warnings) ? [...f.ingest_warnings] : [];
  for (const note of reshaped.notes) warnings.push(`${f.filename}: ${note}`);

  const { error: updErr } = await staff.db
    .from('import_files')
    .update({
      storage_path: f.storage_path,
      file_type: nextFileType,
      row_count: reshaped.rows.length,
      column_count: reshaped.headers.length,
      headers: reshaped.headers,
      sample_rows: reshaped.rows.slice(0, 5),
      column_profile: profile,
      header_row_index: 0,
      ingest_warnings: warnings,
      reshape_status: 'done',
      reshaped: true,
      reshape_model: reshaped.model,
      reshape_notes: reshaped.notes,
    })
    .eq('id', fileId)
    .eq('session_id', sessionId);

  if (updErr) {
    console.error('[reshape] update', updErr);
    return NextResponse.json({ error: 'Failed to save the reorganised file' }, { status: 500 });
  }

  // Booking flags / row totals may change once the real columns exist.
  await syncImportSessionBookingFlags(staff.db, sessionId, staff.venue_id, {
    invalidateReferences: nextFileType === 'bookings',
  });

  return NextResponse.json({
    ok: true,
    status: 'done',
    notes: reshaped.notes,
    file_type: nextFileType,
    preview: {
      original: originalPreview,
      headers: reshaped.headers,
      rows: reshaped.rows.slice(0, PREVIEW_ROWS).map((r) => reshaped.headers.map((h) => r[h] ?? '')),
      total_rows: reshaped.rows.length,
    },
  });
}

/** Undo a reshape: restore the original file and re-ingest it deterministically. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; fileId: string }> },
) {
  const ctx = await requireImportAdmin();
  if ('response' in ctx) return ctx.response;
  const { staff } = ctx;
  const { sessionId, fileId } = await params;

  const { data: fileRow } = await staff.db
    .from('import_files')
    .select('*')
    .eq('id', fileId)
    .eq('session_id', sessionId)
    .eq('venue_id', staff.venue_id)
    .maybeSingle();
  if (!fileRow) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const f = fileRow as { storage_path: string; storage_path_original: string | null; filename: string };
  if (!f.storage_path_original) {
    return NextResponse.json({ error: 'No original to restore' }, { status: 400 });
  }

  const { data: orig, error: dlErr } = await staff.db.storage.from('imports').download(f.storage_path_original);
  if (dlErr || !orig) {
    return NextResponse.json({ error: 'Could not read the original file' }, { status: 500 });
  }
  const originalText = await orig.text();

  // Deterministically re-ingest the original (header detection etc.), exactly as
  // it would have been without reshaping.
  let dataset;
  try {
    dataset = ingestUploadedFile(f.filename, Buffer.from(originalText, 'utf-8')).datasets[0];
  } catch {
    dataset = null;
  }
  if (!dataset) {
    return NextResponse.json({ error: 'Could not restore the original file' }, { status: 500 });
  }

  const { error: upErr } = await staff.db.storage
    .from('imports')
    .upload(f.storage_path, Buffer.from(dataset.csvText, 'utf-8'), { contentType: 'text/csv', upsert: true });
  if (upErr) {
    return NextResponse.json({ error: 'Could not restore the original file' }, { status: 500 });
  }

  // Clear this file's mappings (they referred to reshaped columns).
  await staff.db.from('import_column_mappings').delete().eq('file_id', fileId);

  const profile = profileColumns(dataset.headers, dataset.rows);
  await staff.db
    .from('import_files')
    .update({
      headers: dataset.headers,
      sample_rows: dataset.rows.slice(0, 5),
      column_profile: profile,
      row_count: dataset.rowCount,
      column_count: dataset.headers.length,
      header_row_index: dataset.headerRowIndex,
      reshaped: false,
      reshape_status: 'skipped',
      reshape_notes: null,
      reshape_model: null,
    })
    .eq('id', fileId)
    .eq('session_id', sessionId);

  return NextResponse.json({ ok: true, status: 'skipped' });
}
