import type { SupabaseClient } from '@supabase/supabase-js';

export interface MergeGuestsInput {
  venueId: string;
  targetGuestId: string;
  sourceGuestIds: string[];
}

export async function runMergeGuestsTransaction(
  db: SupabaseClient,
  input: MergeGuestsInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const uniqueSources = [...new Set(input.sourceGuestIds)].filter((id) => id !== input.targetGuestId);
  if (uniqueSources.length === 0) {
    return { ok: false, error: 'No source guests to merge' };
  }

  const { error } = await db.rpc('merge_guests_into', {
    p_venue_id: input.venueId,
    p_target: input.targetGuestId,
    p_sources: uniqueSources,
  });

  if (error) {
    console.error('[runMergeGuestsTransaction] rpc failed:', error.message, input);
    return { ok: false, error: error.message || 'Merge failed' };
  }

  return { ok: true };
}
