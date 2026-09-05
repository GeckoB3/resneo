import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { findStaffCollectiveForVenue } from '@/lib/linked-accounts/collective-staff-scope';
import { loadCollectiveAppointmentCatalog } from '@/lib/linked-accounts/collective-venue';
import { VENUE_CATALOG_CACHE_CONTROL } from '@/lib/realtime/dashboard-sync-constants';

/**
 * GET /api/venue/staff-collective — the live venue collective the caller's venue
 * books for as one business, if any, with the member venues and the calendars
 * its combined catalogue offers.
 *
 * The diary uses this to decide where a "New booking" goes: a click on a column
 * that is one of these calendars opens the staff form for the collective with
 * that calendar preselected; the toolbar's New and Walk-in open it over the whole
 * collective; a column outside the collective keeps the per-venue form.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const scope = await findStaffCollectiveForVenue(admin, staff.venue_id);
    if (!scope) {
      return NextResponse.json({ collective: null }, { headers: { 'Cache-Control': VENUE_CATALOG_CACHE_CONTROL } });
    }
    // Every calendar the staff form can book, own services included, so a
    // column with no combined offering still opens the collective form.
    const { practitioners } = await loadCollectiveAppointmentCatalog(admin, scope.collectiveId, {
      includeMemberOwnServices: true,
    });
    return NextResponse.json(
      {
        collective: {
          id: scope.collectiveId,
          name: scope.name,
          host_venue_id: scope.hostVenueId,
          member_venue_ids: scope.memberVenueIds,
          calendar_ids: [...new Set(practitioners.map((p) => p.id))],
        },
      },
      { headers: { 'Cache-Control': VENUE_CATALOG_CACHE_CONTROL } },
    );
  } catch (err) {
    console.error('GET /api/venue/staff-collective failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
