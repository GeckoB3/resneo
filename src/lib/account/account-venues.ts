import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '@/lib/supabase';

/**
 * Venue names by id, for surfaces that hold venue ids and need to say a name.
 *
 * Read as ADMIN and deliberately narrow: `id` and `name` only. A customer is
 * entitled to the name of a venue they have booked with, and to nothing else
 * about it from here; anything richer belongs to the public venue endpoint
 * where it can be reasoned about once.
 *
 * The ids come from rows the caller has ALREADY proved are the customer's, so
 * this widens nothing: it turns ids they can see into names they can read.
 */
export async function loadVenueNames(
  venueIds: string[],
  admin: SupabaseClient = getSupabaseAdminClient(),
): Promise<Map<string, string>> {
  const ids = [...new Set(venueIds)].filter(Boolean);
  if (ids.length === 0) return new Map();
  const { data, error } = await admin.from('venues').select('id, name').in('id', ids);
  if (error) {
    console.error('[loadVenueNames] read failed:', error.message);
    return new Map();
  }
  return new Map(
    ((data ?? []) as Array<{ id: string; name: string }>).map((v) => [v.id, v.name]),
  );
}
