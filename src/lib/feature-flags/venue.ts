import type { SupabaseClient } from '@supabase/supabase-js';
import { parseVenueFeatureFlags, resolveAppointmentsFeatureFlags } from '@/lib/feature-flags/resolve';
import type { ResolvedAppointmentsFeatureFlags, VenueFeatureFlags } from '@/lib/feature-flags/types';

export async function loadVenueFeatureFlags(
  db: SupabaseClient,
  venueId: string,
): Promise<{ raw: VenueFeatureFlags; resolved: ResolvedAppointmentsFeatureFlags }> {
  const { data, error } = await db.from('venues').select('feature_flags').eq('id', venueId).maybeSingle();
  if (error) {
    console.error('loadVenueFeatureFlags failed:', { venueId, message: error.message });
    return { raw: {}, resolved: resolveAppointmentsFeatureFlags({}) };
  }
  const raw = parseVenueFeatureFlags((data as { feature_flags?: unknown } | null)?.feature_flags);
  return { raw, resolved: resolveAppointmentsFeatureFlags(raw) };
}
