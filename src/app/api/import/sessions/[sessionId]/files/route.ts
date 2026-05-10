import { NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';
import { requireImportAdmin } from '@/lib/import/auth';
import { detectPlatform, platformTemplateKey, FIELD_ALIASES, PLATFORM_MAPPINGS } from '@/lib/import/constants';
import { syncImportSessionBookingFlags } from '@/lib/import/sync-booking-session-flags';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const ctx = await requireImportAdmin();
  if ('response' in ctx) return ctx.response;
  const { staff } = ctx;
  const { sessionId } = await params;

  const { data: session } = await staff.db
    .from('import_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('venue_id', staff.venue_id)
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  const name = file.name || 'upload.csv';
  if (!name.toLowerCase().endsWith('.csv')) {
    return NextResponse.json({ error: 'Only .csv files are allowed' }, { status: 400 });
  }

  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });
  const headers = parsed.meta.fields?.filter(Boolean) ?? [];
  const rows = (parsed.data ?? []).map((row) => {
    const out: Record<string, string> = {};
    for (const h of headers) {
      out[h] = row[h] != null ? String(row[h]) : '';
    }
    return out;
  });
  const sampleRows = rows.slice(0, 5);
  const rowCount = rows.length;

  const { platform } = detectPlatform(headers, name);
  let fileType = (form.get('file_type') as string) || 'unknown';
  if (fileType !== 'clients' && fileType !== 'bookings' && fileType !== 'staff' && fileType !== 'unknown') {
    fileType = 'unknown';
  }

  const storagePath = `${staff.venue_id}/${sessionId}/${Date.now()}_${name.replace(/[^a-zA-Z0-9._-]+/g, '_')}`;

  const buf = Buffer.from(text, 'utf-8');
  const { error: upErr } = await staff.db.storage.from('imports').upload(storagePath, buf, {
    contentType: 'text/csv',
    upsert: false,
  });
  if (upErr) {
    console.error('[import upload]', upErr);
    return NextResponse.json({ error: 'Failed to store file' }, { status: 500 });
  }

  const { data: fileRow, error: insErr } = await staff.db
    .from('import_files')
    .insert({
      session_id: sessionId,
      venue_id: staff.venue_id,
      filename: name,
      file_type: fileType,
      storage_path: storagePath,
      row_count: rowCount,
      column_count: headers.length,
      headers,
      sample_rows: sampleRows,
    })
    .select('*')
    .single();

  if (insErr || !fileRow) {
    console.error('[import_files insert]', insErr);
    return NextResponse.json({ error: 'Failed to save file metadata' }, { status: 500 });
  }

  const tplKey = platformTemplateKey(platform, fileType as 'clients' | 'bookings');
  const template = tplKey ? PLATFORM_MAPPINGS[tplKey] : null;

  if (template && Object.keys(template).length) {
    let sortOrder = 0;
    const aliasMap = tplKey ? FIELD_ALIASES[tplKey] ?? {} : {};
    const mappingRows = Object.entries(template).flatMap(([source_column, target_field]) => {
      if (!headers.includes(source_column)) return [];
      const canonical = aliasMap[source_column];
      if (canonical && headers.includes(canonical)) return [];
      return [
        {
          file_id: fileRow.id,
          session_id: sessionId,
          source_column,
          target_field,
          action: 'map',
          ai_suggested: false,
          sort_order: sortOrder++,
        },
      ];
    });
    await staff.db.from('import_column_mappings').insert(mappingRows);
  }

  const { data: allFiles } = await staff.db
    .from('import_files')
    .select('row_count')
    .eq('session_id', sessionId);

  const totalRows = (allFiles ?? []).reduce((acc, f) => acc + ((f as { row_count?: number }).row_count ?? 0), 0);

  await staff.db
    .from('import_sessions')
    .update({
      status: 'mapping',
      detected_platform: platform === 'unknown' ? null : platform,
      total_rows: totalRows,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  await syncImportSessionBookingFlags(staff.db, sessionId, staff.venue_id, {
    invalidateReferences: fileType === 'bookings',
  });

  return NextResponse.json({
    file: fileRow,
    detected_platform: platform,
    template_applied: Boolean(template),
  });
}
