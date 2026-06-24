import { NextRequest, NextResponse } from 'next/server';
import { requireImportAdmin } from '@/lib/import/auth';
import { targetFieldsForFileType } from '@/lib/import/constants';
import { runAiColumnMapping, type AiMappingRow } from '@/lib/import/ai-map-columns';
import { aliasMapColumns } from '@/lib/import/header-aliases';
import { autoSplitCombinedNames } from '@/lib/import/auto-split-names';
import { getCachedMappings, storeCachedMappings } from '@/lib/import/mapping-cache';
import { sanitiseValueMap } from '@/lib/import/value-map';
import { getSupabaseAdminClient } from '@/lib/supabase';

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

  if (!fileRow) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const f = fileRow as {
    headers: string[];
    sample_rows: Record<string, string>[];
    file_type: string;
    column_profile?: unknown;
  };

  const ft = f.file_type === 'bookings' ? 'bookings' : f.file_type === 'staff' ? 'staff' : 'clients';
  const targetFields = targetFieldsForFileType(ft);
  const headers = f.headers ?? [];

  // Deterministic name-based mappings: instant, exact, and stored as confirmed.
  // They win over any AI guess for the same column or target field.
  const aliasMappings = aliasMapColumns(headers, ft);
  const aliasByColumn = new Map(aliasMappings.map((a) => [a.source_column, a.target_field]));
  const aliasFields = new Set(aliasMappings.map((a) => a.target_field));

  const { data: session } = await staff.db
    .from('import_sessions')
    .select('detected_platform, session_settings')
    .eq('id', sessionId)
    .single();

  const detected = (session as { detected_platform?: string | null } | null)?.detected_platform;
  const settings =
    ((session as { session_settings?: Record<string, unknown> | null } | null)?.session_settings ??
      {}) as Record<string, unknown>;
  const userInstructions =
    typeof settings.ai_instructions === 'string' && settings.ai_instructions.trim()
      ? settings.ai_instructions.trim()
      : null;

  // Cache first: the same export format (exact header list) recurs across
  // venues, so most runs need no AI call at all. User-written instructions are
  // session-specific, so they bypass the shared cache entirely (read & write).
  const cacheAdmin = getSupabaseAdminClient();
  const cached = userInstructions ? null : await getCachedMappings(cacheAdmin, headers, ft);

  let ai: { mappings: AiMappingRow[]; model: string } | null = null;
  let fromCache = false;
  if (cached) {
    ai = { mappings: cached.mappings, model: cached.model ?? 'cache' };
    fromCache = true;
  } else {
    ai = await runAiColumnMapping({
      headers,
      sampleRows: Array.isArray(f.sample_rows) ? f.sample_rows : [],
      fileType: ft,
      detectedPlatform: detected,
      targetFields,
      columnProfiles: Array.isArray(f.column_profile)
        ? (f.column_profile as import('@/lib/import/column-profile').ColumnProfile[])
        : null,
      userInstructions,
      knownMappings: aliasMappings,
    });
    if (ai?.mappings?.length && !userInstructions) {
      await storeCachedMappings(cacheAdmin, headers, ft, ai.mappings, ai.model);
    }
  }

  const modelUsed = ai?.model ?? (aliasMappings.length ? 'alias' : null);

  // Merge deterministic alias mappings with the AI result. Aliases override the
  // AI for the same column, and any AI mapping that targets an alias-claimed
  // field is dropped (a field can only have one source column).
  const aiMappings = ai?.mappings ?? [];
  const merged: AiMappingRow[] = [];
  const seenColumns = new Set<string>();
  for (const m of aiMappings) {
    seenColumns.add(m.source_column);
    if (aliasByColumn.has(m.source_column)) continue; // alias added below
    if (m.action === 'map' && m.target_field && aliasFields.has(m.target_field)) {
      merged.push({ ...m, action: 'ignore', target_field: null, split_config: null });
    } else {
      merged.push(m);
    }
  }
  // Alias rows: confirmed mappings (ai_suggested=false + high confidence → the
  // map UI renders these as confirmed rather than a suggestion to review).
  const aliasRows: AiMappingRow[] = aliasMappings.map((a) => ({
    source_column: a.source_column,
    action: 'map',
    target_field: a.target_field,
    confidence: 'high',
    reasoning: 'Matched by column name.',
    split_config: null,
  }));

  // No AI and no aliases: keep whatever mappings the user already has
  // (platform-template prefills or manual work) instead of wiping them.
  if (merged.length === 0 && aliasRows.length === 0) {
    return NextResponse.json({
      ok: false,
      mappings: [],
      message: 'AI mapping is unavailable right now. Your existing column mappings are unchanged.',
    });
  }

  const { error: delErr } = await staff.db.from('import_column_mappings').delete().eq('file_id', fileId);
  if (delErr) {
    console.error('[ai-map] delete mappings', delErr);
    return NextResponse.json({ error: 'Could not replace existing mappings' }, { status: 500 });
  }

  let sortOrder = 0;
  const toRow = (m: AiMappingRow, isAlias: boolean) => ({
    file_id: fileId,
    session_id: sessionId,
    source_column: m.source_column,
    target_field: m.action === 'map' ? m.target_field : null,
    action: m.action === 'split' ? 'split' : m.action === 'ignore' ? 'ignore' : 'map',
    split_config: m.action === 'split' ? m.split_config ?? null : null,
    // Reviewed raw->canonical enum lookup, validated against the target's vocabulary.
    value_map: m.action === 'map' ? sanitiseValueMap(m.target_field, m.value_map ?? null) : null,
    // Alias matches are confirmed (not a suggestion the user must vet).
    ai_suggested: !isAlias,
    ai_confidence: m.confidence,
    ai_reasoning: m.reasoning,
    sort_order: sortOrder++,
  });
  const rows = autoSplitCombinedNames([
    ...aliasRows.map((m) => toRow(m, true)),
    ...merged.map((m) => toRow(m, false)),
  ]);

  await staff.db.from('import_column_mappings').insert(rows);

  await staff.db
    .from('import_sessions')
    .update({
      ai_mapping_used: true,
      ai_model_used: modelUsed,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  return NextResponse.json({ ok: true, mappings: rows, model: modelUsed, from_cache: fromCache });
}
