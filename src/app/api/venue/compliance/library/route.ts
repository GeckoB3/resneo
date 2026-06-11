import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { requireCompliancePlan } from '@/lib/compliance/auth';
import { templateSummaries } from '@/lib/compliance/library';

/** GET /api/venue/compliance/library — list available library templates. */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    return NextResponse.json({ templates: templateSummaries() });
  } catch (err) {
    console.error('GET /api/venue/compliance/library failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
