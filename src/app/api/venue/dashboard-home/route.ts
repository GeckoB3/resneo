import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { buildDashboardHomePayload } from '@/lib/dashboard/dashboard-home-payload';
import { logApiPerfIfEnabled, perfApiStart } from '@/lib/perf/api-route-timing';

/** GET /api/venue/dashboard-home - summary data for the dashboard home page */
export async function GET(request: NextRequest) {
  const t0 = perfApiStart();
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const payload = await buildDashboardHomePayload(admin, staff);
    logApiPerfIfEnabled('GET /api/venue/dashboard-home', t0);
    return NextResponse.json(payload);
  } catch (err) {
    if ((err as Error).message === 'Venue not found') {
      return NextResponse.json({ error: 'Venue not found' }, { status: 500 });
    }
    console.error('GET /api/venue/dashboard-home failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
