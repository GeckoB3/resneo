import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { requireCompliancePlan } from '@/lib/compliance/auth';
import { duplicateComplianceType, getComplianceTypeWithVersion } from '@/lib/compliance/types-service';

interface RouteCtx {
  params: { id: string } | Promise<{ id: string }>;
}

/** POST /api/venue/compliance/types/[id]/duplicate — copy a type into a new "{name} (copy)" (admin). */
export async function POST(request: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Admin role required.' }, { status: 403 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const { id } = await Promise.resolve(ctx.params);
    const result = await duplicateComplianceType(staff.db, {
      venueId: staff.venue_id,
      staffId: staff.id,
      typeId: id,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    const withVersion = await getComplianceTypeWithVersion(staff.db, staff.venue_id, result.value.type.id);
    return NextResponse.json(withVersion.ok ? withVersion.value : { type: result.value.type }, { status: 201 });
  } catch (err) {
    console.error('POST /api/venue/compliance/types/[id]/duplicate failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
