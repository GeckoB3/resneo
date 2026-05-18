import type { SupabaseClient } from '@supabase/supabase-js';
import { isAppointmentPlanTier } from '@/lib/tier-enforcement';

/**
 * True when a venue's calendar columns are read from `unified_calendars`
 * rather than the legacy `practitioners` table. Mirrors the discriminator in
 * GET /api/venue/practitioners: appointments-family venues use the unified
 * list; only legacy table-reservation venues still use `practitioners`.
 */
export async function venueUsesUnifiedCalendarList(
  admin: SupabaseClient,
  venueId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('venues')
    .select('booking_model, pricing_tier')
    .eq('id', venueId)
    .maybeSingle();
  const bookingModel = ((data as { booking_model?: string } | null)?.booking_model as string) ?? '';
  const pricingTier =
    ((data as { pricing_tier?: string | null } | null)?.pricing_tier as string | null) ?? null;
  if (bookingModel === 'unified_scheduling') return true;
  if (isAppointmentPlanTier(pricingTier)) return true;
  const { count } = await admin
    .from('unified_calendars')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId);
  return (count ?? 0) > 0;
}
