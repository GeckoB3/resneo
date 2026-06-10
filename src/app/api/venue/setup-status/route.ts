import { NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { computeSetupStatus, type SetupStatus } from '@/lib/venue/compute-setup-status';

export type { SetupStatus };

export async function GET(request: Request) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const status = await computeSetupStatus(staff);
    return NextResponse.json(status);
  } catch (err) {
    console.error('GET /api/venue/setup-status failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
