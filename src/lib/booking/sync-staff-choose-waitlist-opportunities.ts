/**
 * Server-side sync for staff_choose waitlist opportunities (replaces per-request scan on GET /waitlist/alerts).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parseVenueFeatureFlags,
  resolveAppointmentsFeatureFlag,
} from '@/lib/feature-flags';
import { parseWaitlistConfig } from '@/lib/booking/waitlist-config';
import { loadWaitlistVenueCapabilities } from '@/lib/booking/load-waitlist-venue-capabilities';
import { ensureStaffChooseOpportunitiesFromWaitlist } from '@/lib/booking/waitlist-slot-opportunity-service';

export async function syncStaffChooseWaitlistOpportunitiesCron(
  admin: SupabaseClient,
): Promise<{ venues_scanned: number; venues_synced: number; errors: number }> {
  const { data: waitingRows, error } = await admin
    .from('waitlist_entries')
    .select('venue_id')
    .eq('waitlist_kind', 'appointment')
    .eq('status', 'waiting');

  if (error) {
    console.error('[syncStaffChooseWaitlistOpportunitiesCron] waitlist_entries query failed:', error);
    return { venues_scanned: 0, venues_synced: 0, errors: 1 };
  }

  const venueIds = [
    ...new Set(
      (waitingRows ?? [])
        .map((row) => (row as { venue_id?: string }).venue_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];

  let venuesSynced = 0;
  let errors = 0;

  for (const venueId of venueIds) {
    try {
      const capabilities = await loadWaitlistVenueCapabilities(admin, venueId);
      if (!capabilities?.showAppointmentWaitlist) continue;

      const { data: venueRow } = await admin
        .from('venues')
        .select('feature_flags')
        .eq('id', venueId)
        .maybeSingle();
      const flags = parseVenueFeatureFlags(
        (venueRow as { feature_flags?: unknown } | null)?.feature_flags,
      );
      if (!resolveAppointmentsFeatureFlag('waitlist_v2', flags)) continue;
      if (parseWaitlistConfig(flags).mode !== 'staff_choose') continue;

      await ensureStaffChooseOpportunitiesFromWaitlist(admin, venueId);
      venuesSynced += 1;
    } catch (err) {
      errors += 1;
      console.error('[syncStaffChooseWaitlistOpportunitiesCron] venue sync failed:', err, { venueId });
    }
  }

  return { venues_scanned: venueIds.length, venues_synced: venuesSynced, errors };
}
