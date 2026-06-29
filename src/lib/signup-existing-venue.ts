import type { SupabaseClient } from '@supabase/supabase-js';
import { escapeLikePattern } from '@/lib/db/like-escape';

export interface ExistingVenueRow {
  venue_id: string;
  pricing_tier: string | null;
  active_booking_models?: unknown;
  onboarding_completed?: boolean | null;
}

/**
 * Whether the user already OWNS a venue (is an active admin), returning that venue's tier.
 *
 * Scoped to active admin rows: a person who is only non-admin staff at someone else's
 * venue does not own one and must still be able to create their own via /signup. Ordered
 * for a deterministic pick when a user admins more than one venue.
 */
export async function getExistingVenueForUserEmail(
  admin: SupabaseClient,
  email: string | null | undefined,
): Promise<ExistingVenueRow | null> {
  const normalized = (email ?? '').toLowerCase().trim();
  if (!normalized) return null;

  const { data: staffRows, error: staffErr } = await admin
    .from('staff')
    .select('venue_id')
    .ilike('email', escapeLikePattern(normalized))
    .eq('role', 'admin')
    .is('revoked_at', null)
    .order('venue_id', { ascending: true })
    .limit(1);

  if (staffErr || !staffRows?.length) return null;

  const venueId = staffRows[0]!.venue_id as string;
  const { data: venue, error: venueErr } = await admin
    .from('venues')
    .select('pricing_tier, active_booking_models, onboarding_completed')
    .eq('id', venueId)
    .maybeSingle();

  if (venueErr || !venue) return null;

  return {
    venue_id: venueId,
    pricing_tier: (venue as { pricing_tier?: string | null }).pricing_tier ?? null,
    active_booking_models: (venue as { active_booking_models?: unknown }).active_booking_models,
    onboarding_completed: (venue as { onboarding_completed?: boolean | null }).onboarding_completed ?? null,
  };
}
