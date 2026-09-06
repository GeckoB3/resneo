import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { collectCalendarColumnConflicts } from '@/lib/calendar/column-assignment-conflicts';

/**
 * GET /api/venue/calendar-column-conflicts
 * Lists scheduling-column conflicts (e.g. bookable resource + classes/events on the same team column).
 * Bearer (mobile app) or cookie session (dashboard), like every other venue route.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const conflicts = await collectCalendarColumnConflicts(admin, staff.venue_id);
    return NextResponse.json({ conflicts });
  } catch (err) {
    console.error('GET /api/venue/calendar-column-conflicts failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
