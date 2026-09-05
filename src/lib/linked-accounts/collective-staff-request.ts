import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { resolveStaffCollectiveScope, type StaffCollectiveScope } from './collective-staff-scope';

/**
 * The live collective `collectiveId` that the REQUEST's staff session belongs to,
 * or null for the public, another venue's staff, or a dead collective.
 *
 * The public booking routes serve the combined page and the staff form alike
 * (the staff flow reads day slots, validates visit segments and creates visits
 * and groups through them). A member's staff get a wider catalogue there, the
 * members' own services as well as the combined offerings, so those routes ask
 * this question, but only when the caller says it is staff: a guest never pays
 * for the session lookup, and a caller cannot claim staff rights it lacks.
 */
export async function resolveStaffCollectiveScopeFromRequest(
  admin: SupabaseClient,
  request: NextRequest,
  collectiveId: string,
): Promise<StaffCollectiveScope | null> {
  try {
    const authClient = await createVenueRouteClient(request);
    const staff = await getVenueStaff(authClient);
    if (!staff) return null;
    return await resolveStaffCollectiveScope(admin, staff.venue_id, collectiveId);
  } catch {
    return null;
  }
}
