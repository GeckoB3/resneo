import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { requireCompliancePlan } from '@/lib/compliance/auth';
import { complianceRequirementCreateSchema } from '@/lib/compliance/zod-schemas';
import { addRequirement, listRequirementsForService } from '@/lib/compliance/requirements-service';

/** GET /api/venue/compliance/requirements?service_id= (or appointment_service_id / service_item_id). */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const sp = request.nextUrl.searchParams;
    const serviceId =
      sp.get('service_id') ?? sp.get('appointment_service_id') ?? sp.get('service_item_id');
    if (!serviceId) {
      return NextResponse.json({ error: 'A service_id query parameter is required.' }, { status: 400 });
    }

    const requirements = await listRequirementsForService(staff.db, staff.venue_id, serviceId);
    return NextResponse.json({ requirements });
  } catch (err) {
    console.error('GET /api/venue/compliance/requirements failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/venue/compliance/requirements — add a requirement to a service (admin). */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Admin role required.' }, { status: 403 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const body = await request.json().catch(() => null);
    const parsed = complianceRequirementCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const result = await addRequirement(staff.db, {
      venueId: staff.venue_id,
      staffId: staff.id,
      serviceId: parsed.data.service_id,
      complianceTypeId: parsed.data.compliance_type_id,
      enforcement: parsed.data.enforcement,
      lockPeriodHours: parsed.data.lock_period_hours ?? null,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ requirement: result.value }, { status: 201 });
  } catch (err) {
    console.error('POST /api/venue/compliance/requirements failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
