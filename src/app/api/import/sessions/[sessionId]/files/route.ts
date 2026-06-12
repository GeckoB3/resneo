import { NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';
import { requireImportAdmin } from '@/lib/import/auth';
import { detectPlatform, platformTemplateKey, FIELD_ALIASES, PLATFORM_MAPPINGS } from '@/lib/import/constants';
import { syncImportSessionBookingFlags } from '@/lib/import/sync-booking-session-flags';
import {
  IMPORT_MAX_FILE_BYTES,
  importFileExtensionAllowed,
  ingestUploadedFile,
  type IngestedDataset,
} from '@/lib/import/ingest-file';
import { inferDateFormatFromProfiles, profileColumns } from '@/lib/import/column-profile';
import { detectFileKind } from '@/lib/import/detect-file-kind';
import { detectIrregularGrid } from '@/lib/import/detect-irregular';
import { importAiAvailable } from '@/lib/import/openai-client';
import { autoSplitCombinedNames } from '@/lib/import/auto-split-names';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const ctx = await requireImportAdmin();
  if ('response' in ctx) return ctx.response;
  const { staff } = ctx;
  const { sessionId } = await params;

  try {
    const { data: session } = await staff.db
      .from('import_sessions')
      .select('id, session_settings')
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
    if (!importFileExtensionAllowed(name)) {
      return NextResponse.json(
        { error: 'Upload a CSV or Excel file (.csv, .xlsx, .xls, .tsv, .txt).' },
        { status: 400 },
      );
    }
    if (file.size > IMPORT_MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `This file is too large — the limit is ${Math.round(IMPORT_MAX_FILE_BYTES / (1024 * 1024))} MB. Split the export and upload the parts separately.` },
        { status: 400 },
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());

    let datasets: IngestedDataset[];
    let warnings: string[];
    try {
      const ingested = ingestUploadedFile(name, buf);
      datasets = ingested.datasets;
      warnings = ingested.warnings;
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Could not read this file.' },
        { status: 400 },
      );
    }

    const requestedType = (form.get('file_type') as string) || 'unknown';
    const fileType =
      requestedType === 'clients' || requestedType === 'bookings' || requestedType === 'staff'
        ? requestedType
        : 'unknown';

    const createdFiles: unknown[] = [];
    const kindDetections: Array<{
      file_id: string;
      filename: string;
      detected_kind: string;
      confidence: string;
      applied: boolean;
      reason: string;
    }> = [];
    let detectedPlatformOverall: string | null = null;
    let anyTemplateApplied = false;
    let anyBookingsDataset = false;
    let anyReshapePending = false;
    const allProfiles: ReturnType<typeof profileColumns> = [];

    for (const ds of datasets) {
      const { platform } = detectPlatform(ds.headers, ds.label);
      if (platform !== 'unknown' && !detectedPlatformOverall) {
        detectedPlatformOverall = platform;
      }

      const profile = profileColumns(ds.headers, ds.rows);
      allProfiles.push(...profile);

      // Auto-classify unlabelled files so the user confirms a pre-filled label
      // instead of working it out themselves. Only one-sided evidence is
      // applied; ambiguous files stay 'unknown' with the guess surfaced in the UI.
      let dsFileType = fileType;
      const detection = detectFileKind({
        filename: ds.label,
        headers: ds.headers,
        rowCount: ds.rowCount,
        columnProfiles: profile,
      });
      if (fileType === 'unknown' && detection.kind !== 'unknown' && detection.confidence === 'high') {
        dsFileType = detection.kind;
      }

      // Report-shaped files (date headers + times beneath, page noise, repeated
      // headers) can't be mapped as-is: they need AI reshaping into a clean
      // table first. Detect that here; the actual reshape runs in a polled
      // endpoint so this upload request stays fast.
      const irregular = detectIrregularGrid(ds.rawGrid, {
        fileTypeHint: dsFileType as 'clients' | 'bookings' | 'staff' | 'unknown',
      });
      const willReshape = irregular.isIrregular && importAiAvailable();

      const safeName = ds.label.replace(/[^a-zA-Z0-9._-]+/g, '_');
      const stamp = Date.now();
      const storagePath = `${staff.venue_id}/${sessionId}/${stamp}_${safeName}.csv`;

      const { error: upErr } = await staff.db.storage
        .from('imports')
        .upload(storagePath, Buffer.from(ds.csvText, 'utf-8'), {
          contentType: 'text/csv',
          upsert: false,
        });
      if (upErr) {
        console.error('[import upload]', upErr);
        return NextResponse.json({ error: 'Failed to store file' }, { status: 500 });
      }

      // Preserve the FULL original grid (all section-header/page/noise rows) so
      // the reshape has the faithful source and the user can undo to it. The
      // collapsed `csvText` above drops rows above the detected header, which
      // would lose the first section's date/staff.
      let storagePathOriginal: string | null = null;
      if (willReshape) {
        storagePathOriginal = `${staff.venue_id}/${sessionId}/${stamp}_${safeName}.original.csv`;
        const rawCsv = Papa.unparse(ds.rawGrid, { newline: '\n' });
        const { error: origErr } = await staff.db.storage
          .from('imports')
          .upload(storagePathOriginal, Buffer.from(rawCsv, 'utf-8'), {
            contentType: 'text/csv',
            upsert: false,
          });
        if (origErr) {
          console.error('[import upload original]', origErr);
          storagePathOriginal = null;
        }
      }

      const baseWarnings = warnings.filter((w) => w.startsWith(ds.label));
      if (willReshape) {
        baseWarnings.push(
          `${ds.label}: this looks like a report (${irregular.reasons.join('; ')}). We'll reorganise it into a table automatically — you can review and undo it.`,
        );
      }

      const { data: fileRow, error: insErr } = await staff.db
        .from('import_files')
        .insert({
          session_id: sessionId,
          venue_id: staff.venue_id,
          filename: ds.label,
          file_type: dsFileType,
          storage_path: storagePath,
          row_count: ds.rowCount,
          column_count: ds.headers.length,
          headers: ds.headers,
          sample_rows: ds.rows.slice(0, 5),
          column_profile: profile,
          header_row_index: ds.headerRowIndex,
          source_sheet_name: ds.sheetName,
          ingest_warnings: baseWarnings,
          reshape_status: willReshape ? 'pending' : null,
          storage_path_original: storagePathOriginal,
        })
        .select('*')
        .single();

      if (insErr || !fileRow) {
        console.error('[import_files insert]', insErr);
        return NextResponse.json({ error: 'Failed to save file metadata' }, { status: 500 });
      }
      createdFiles.push(fileRow);
      if (willReshape) anyReshapePending = true;
      kindDetections.push({
        file_id: (fileRow as { id: string }).id,
        filename: ds.label,
        detected_kind: detection.kind,
        confidence: detection.confidence,
        applied: dsFileType !== fileType,
        reason: detection.reason,
      });
      if (dsFileType === 'bookings') anyBookingsDataset = true;

      // Skip platform templates for files we're about to reshape — their current
      // (messy) headers aren't the real columns; mapping happens post-reshape.
      const tplKey = willReshape ? null : platformTemplateKey(platform, dsFileType as 'clients' | 'bookings');
      const template = tplKey ? PLATFORM_MAPPINGS[tplKey] : null;

      if (template && Object.keys(template).length) {
        let sortOrder = 0;
        const aliasMap = tplKey ? FIELD_ALIASES[tplKey] ?? {} : {};
        const templateRows = Object.entries(template).flatMap(([source_column, target_field]) => {
          if (!ds.headers.includes(source_column)) return [];
          const canonical = aliasMap[source_column];
          if (canonical && ds.headers.includes(canonical)) return [];
          return [
            {
              file_id: (fileRow as { id: string }).id,
              session_id: sessionId,
              source_column,
              target_field: target_field as string | null,
              action: 'map',
              split_config: null as { separator?: string; parts?: Array<{ field: string }> } | null,
              ai_suggested: false,
              sort_order: sortOrder++,
            },
          ];
        });
        // Combined name columns (e.g. Booksy "Customer Name") become a first/last
        // split up front so the user just confirms.
        const mappingRows = autoSplitCombinedNames(templateRows);
        if (mappingRows.length > 0) {
          await staff.db.from('import_column_mappings').insert(mappingRows);
          anyTemplateApplied = true;
        }
      }
    }

    const { data: allFiles } = await staff.db
      .from('import_files')
      .select('row_count')
      .eq('session_id', sessionId);

    const totalRows = (allFiles ?? []).reduce(
      (acc, f) => acc + ((f as { row_count?: number }).row_count ?? 0),
      0,
    );

    // Resolve DD/MM vs MM/DD automatically when the file itself proves the
    // order (any date with a component > 12). Mixed/no evidence keeps the
    // existing "ask the user" behaviour at validation.
    const inferredDateFormat = inferDateFormatFromProfiles(allProfiles);
    const prevSettings =
      (session as { session_settings?: Record<string, unknown> | null }).session_settings ?? {};
    const nextSettings: Record<string, unknown> = { ...prevSettings };
    if (inferredDateFormat && !nextSettings.ambiguous_date_format) {
      nextSettings.ambiguous_date_format = inferredDateFormat;
      nextSettings.ambiguous_date_format_source = 'inferred_from_data';
    }

    await staff.db
      .from('import_sessions')
      .update({
        status: 'mapping',
        detected_platform: detectedPlatformOverall,
        total_rows: totalRows,
        session_settings: nextSettings,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId);

    await syncImportSessionBookingFlags(staff.db, sessionId, staff.venue_id, {
      invalidateReferences: anyBookingsDataset,
    });

    return NextResponse.json({
      files: createdFiles,
      file: createdFiles[0] ?? null,
      detected_platform: detectedPlatformOverall ?? 'unknown',
      template_applied: anyTemplateApplied,
      warnings,
      inferred_date_format: inferredDateFormat,
      kind_detections: kindDetections,
      reshape_pending: anyReshapePending,
    });
  } catch (e) {
    console.error('[import files POST]', e);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
