import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { requireCompliancePlan } from '@/lib/compliance/auth';
import { loadComplianceDashboard } from '@/lib/compliance/dashboard-service';

/**
 * GET /api/venue/compliance/dashboard — aggregated compliance dashboard data.
 *
 * Deliberately uncached. Spec §3.5 allowed a 5-minute per-venue cache, and with one a
 * booking made (or a form captured) anywhere but this page stayed off the sweep for up
 * to five minutes, so the page read "nothing outstanding" straight after the booking that
 * needed a form. The cache also lived in one server instance's memory, where the routes
 * that change bookings and records could never clear it. The loader reads the venue's
 * requirements first and only the bookings they apply to, so a fresh read stays cheap.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const data = await loadComplianceDashboard(staff.db, staff.venue_id);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('GET /api/venue/compliance/dashboard failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
