import type { SupabaseClient } from '@supabase/supabase-js';
import { isAppointmentPlanTier } from '@/lib/tier-enforcement';
import { parseVenueFeatureFlags, resolveAppointmentsFeatureFlag } from '@/lib/feature-flags/resolve';

/**
 * Compliance is live for a venue when it is on an Appointments tier AND the
 * `compliance_records_enabled` flag resolves on (spec §8, §14.2). Shared by the
 * booking gate and the public booking-requirements endpoint so the two can never
 * disagree about whether a form should be asked for.
 */
export async function complianceEnabledForVenue(admin: SupabaseClient, venueId: string): Promise<boolean> {
  const { data: venue } = await admin
    .from('venues')
    .select('pricing_tier, feature_flags')
    .eq('id', venueId)
    .maybeSingle();
  if (!venue) return false;
  const tier = (venue as { pricing_tier?: string | null }).pricing_tier ?? null;
  if (!isAppointmentPlanTier(tier)) return false;
  const flags = parseVenueFeatureFlags((venue as { feature_flags?: unknown }).feature_flags);
  return resolveAppointmentsFeatureFlag('compliance_records_enabled', flags);
}
