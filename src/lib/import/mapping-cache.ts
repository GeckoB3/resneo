/**
 * Cross-venue cache for AI column mappings, keyed by the exact ordered header
 * list + file type. Stores headers and field mappings only — no row data —
 * so it is safe to share across venues, and over time it becomes a learned
 * library of provider export formats that costs nothing to apply.
 */

import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiMappingRow } from '@/lib/import/ai-map-columns';

export function mappingCacheKey(headers: string[]): string {
  return createHash('sha256').update(JSON.stringify(headers)).digest('hex');
}

export async function getCachedMappings(
  admin: SupabaseClient,
  headers: string[],
  fileType: 'clients' | 'bookings' | 'staff',
): Promise<{ mappings: AiMappingRow[]; model: string | null } | null> {
  const hash = mappingCacheKey(headers);
  const { data, error } = await admin
    .from('import_ai_mapping_cache')
    .select('id, mappings, model, hit_count')
    .eq('headers_hash', hash)
    .eq('file_type', fileType)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as { id: string; mappings: unknown; model: string | null; hit_count: number };
  if (!Array.isArray(row.mappings) || row.mappings.length === 0) return null;

  // Best-effort hit counter; never block the mapping on it.
  void admin
    .from('import_ai_mapping_cache')
    .update({ hit_count: row.hit_count + 1, updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .then(({ error: bumpErr }) => {
      if (bumpErr) console.warn('[mapping-cache] hit bump failed', bumpErr.message);
    });

  return { mappings: row.mappings as AiMappingRow[], model: row.model };
}

export async function storeCachedMappings(
  admin: SupabaseClient,
  headers: string[],
  fileType: 'clients' | 'bookings' | 'staff',
  mappings: AiMappingRow[],
  model: string,
): Promise<void> {
  if (!mappings.length) return;
  const hash = mappingCacheKey(headers);
  const { error } = await admin.from('import_ai_mapping_cache').upsert(
    {
      headers_hash: hash,
      file_type: fileType,
      headers,
      mappings,
      model,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'headers_hash,file_type' },
  );
  if (error) console.warn('[mapping-cache] store failed', error.message);
}
