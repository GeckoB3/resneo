import type { SupabaseClient } from '@supabase/supabase-js';
import { isAppointmentPlanTier } from '@/lib/tier-enforcement';
import { parseVenueFeatureFlags, resolveAppointmentsFeatureFlag } from '@/lib/feature-flags/resolve';

/**
 * Server-side gate for the compliance dashboard pages: the venue must be on an
 * Appointments plan AND have the `compliance_records_enabled` flag on.
 */
export async function complianceFeatureEnabledForVenue(
  admin: SupabaseClient,
  venueId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('venues')
    .select('pricing_tier, feature_flags')
    .eq('id', venueId)
    .maybeSingle();
  if (!data) return false;
  const tier = (data as { pricing_tier?: string | null }).pricing_tier ?? null;
  if (!isAppointmentPlanTier(tier)) return false;
  const flags = parseVenueFeatureFlags((data as { feature_flags?: unknown }).feature_flags);
  return resolveAppointmentsFeatureFlag('compliance_records_enabled', flags);
}
