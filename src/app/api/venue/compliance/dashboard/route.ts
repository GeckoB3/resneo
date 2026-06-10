import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { requireCompliancePlan } from '@/lib/compliance/auth';
import { loadComplianceDashboard, type ComplianceDashboardData } from '@/lib/compliance/dashboard-service';

// Short-lived per-venue cache (spec §3.5 — the missing-for-bookings query is the
// expensive one; 5 minutes is fine for a reception "morning sweep" view).
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { data: ComplianceDashboardData; expires: number }>();

/** GET /api/venue/compliance/dashboard — aggregated compliance dashboard data. */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const fresh = request.nextUrl.searchParams.get('refresh') === '1';
    const cached = cache.get(staff.venue_id);
    if (!fresh && cached && cached.expires > Date.now()) {
      return NextResponse.json(cached.data);
    }

    const data = await loadComplianceDashboard(staff.db, staff.venue_id);
    cache.set(staff.venue_id, { data, expires: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(data);
  } catch (err) {
    console.error('GET /api/venue/compliance/dashboard failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
