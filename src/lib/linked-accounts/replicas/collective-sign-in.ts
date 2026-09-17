/**
 * Guest sign-in on the collective page (D32, decided 2026-09-14): on shared services the host's
 * "require an account to book" applies to every venue while the collective is live, replacing the
 * older rule that any member's setting turned it on for the whole page. The older model keeps its
 * rule until the collective is migrated: the owning venue's setting at booking time, and any
 * member's on the page.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** The host's setting when the collective runs shared services, or null on the older model. */
export async function hostSignInRequirement(admin: SupabaseClient, collectiveId: string): Promise<boolean | null> {
  const { data: collective } = await admin
    .from('venue_collectives')
    .select('host_venue_id, service_model')
    .eq('id', collectiveId)
    .maybeSingle();
  if (!collective || collective.service_model !== 'replicas') return null;
  const { data: host } = await admin
    .from('venues')
    .select('require_account_login_for_bookings')
    .eq('id', collective.host_venue_id as string)
    .maybeSingle();
  return Boolean((host as { require_account_login_for_bookings?: boolean } | null)?.require_account_login_for_bookings);
}

/**
 * Whether a booking must come from a signed-in guest. `collectiveId` is the collective the server
 * resolved the booking through (never one the client named).
 */
export async function bookingRequiresSignIn(
  admin: SupabaseClient,
  collectiveId: string | null,
  owningVenueRequires: boolean,
): Promise<boolean> {
  if (!collectiveId) return owningVenueRequires;
  return (await hostSignInRequirement(admin, collectiveId)) ?? owningVenueRequires;
}
