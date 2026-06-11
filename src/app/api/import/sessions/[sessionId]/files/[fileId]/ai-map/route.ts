import { NextRequest, NextResponse } from 'next/server';
import { requireImportAdmin } from '@/lib/import/auth';
import { targetFieldsForFileType } from '@/lib/import/constants';
import { runAiColumnMapping } from '@/lib/import/ai-map-columns';
import { getCachedMappings, storeCachedMappings } from '@/lib/import/mapping-cache';
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
  const headers = f.headers ?? [];
  const cached = userInstructions ? null : await getCachedMappings(cacheAdmin, headers, ft);

  let ai: { mappings: import('@/lib/import/ai-map-columns').AiMappingRow[]; model: string } | null = null;
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
    });
    if (ai?.mappings?.length && !userInstructions) {
      await storeCachedMappings(cacheAdmin, headers, ft, ai.mappings, ai.model);
    }
  }

  const modelUsed = ai?.model ?? null;

  // AI failed or returned nothing: keep whatever mappings the user already has
  // (platform-template prefills or manual work) instead of wiping them.
  if (!ai?.mappings?.length) {
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
  const rows = ai.mappings.map((m) => ({
    file_id: fileId,
    session_id: sessionId,
    source_column: m.source_column,
    target_field: m.action === 'map' ? m.target_field : null,
    action: m.action === 'split' ? 'split' : m.action === 'ignore' ? 'ignore' : 'map',
    split_config: m.action === 'split' ? m.split_config ?? null : null,
    ai_suggested: true,
    ai_confidence: m.confidence,
    ai_reasoning: m.reasoning,
    sort_order: sortOrder++,
  }));

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
