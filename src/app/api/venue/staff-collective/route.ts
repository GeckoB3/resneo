import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { loadStaffCollectiveSummary } from '@/lib/linked-accounts/collective-staff-scope';
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
    // The calendar page resolves the same answer on the server before its first
    // paint; this route serves any surface that mounts without it.
    const summary = await loadStaffCollectiveSummary(admin, staff.venue_id);
    if (!summary) {
      return NextResponse.json({ collective: null }, { headers: { 'Cache-Control': VENUE_CATALOG_CACHE_CONTROL } });
    }
    return NextResponse.json(
      {
        collective: {
          id: summary.id,
          name: summary.name,
          host_venue_id: summary.hostVenueId,
          member_venue_ids: summary.memberVenueIds,
          calendar_ids: summary.calendarIds,
        },
      },
      { headers: { 'Cache-Control': VENUE_CATALOG_CACHE_CONTROL } },
    );
  } catch (err) {
    console.error('GET /api/venue/staff-collective failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
