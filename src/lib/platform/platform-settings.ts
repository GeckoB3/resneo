/**
 * Platform-wide settings (migration 20270218230000). Today there is one: which service model a new
 * venue collective is created with (D37). Existing collectives are never changed by it; they move
 * only through scripts/collective-replicas-migrate.mjs.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const NEW_COLLECTIVE_SERVICE_MODELS = ['legacy_copies', 'replicas'] as const;
export type NewCollectiveServiceModel = (typeof NEW_COLLECTIVE_SERVICE_MODELS)[number];

const KEY = 'new_collective_service_model';

/**
 * The model a new collective starts on. Falls back to the older model when the setting cannot be
 * read (including before the migration is applied), so a read failure never switches anything on.
 */
export async function newCollectiveServiceModel(admin: SupabaseClient): Promise<NewCollectiveServiceModel> {
  try {
    const { data, error } = await admin.from('platform_settings').select('value').eq('key', KEY).maybeSingle();
    if (error || !data) return 'legacy_copies';
    return data.value === 'replicas' ? 'replicas' : 'legacy_copies';
  } catch {
    return 'legacy_copies';
  }
}

export async function setNewCollectiveServiceModel(
  admin: SupabaseClient,
  value: NewCollectiveServiceModel,
  userId: string,
): Promise<{ ok: true; previous: NewCollectiveServiceModel } | { ok: false; error: string }> {
  const previous = await newCollectiveServiceModel(admin);
  const { error } = await admin
    .from('platform_settings')
    .upsert({ key: KEY, value, updated_at: new Date().toISOString(), updated_by: userId }, { onConflict: 'key' });
  if (error) return { ok: false, error: error.message };
  return { ok: true, previous };
}
