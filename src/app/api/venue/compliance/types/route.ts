import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { requireCompliancePlan } from '@/lib/compliance/auth';
import { complianceTypeCreateSchema } from '@/lib/compliance/zod-schemas';
import {
  createComplianceType,
  listComplianceTypesWithCounts,
  getComplianceTypeWithVersion,
} from '@/lib/compliance/types-service';

/** GET /api/venue/compliance/types — list types for the venue (?include_archived=true). */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const includeArchived = request.nextUrl.searchParams.get('include_archived') === 'true';
    const types = await listComplianceTypesWithCounts(staff.db, staff.venue_id, { includeArchived });
    return NextResponse.json({ types });
  } catch (err) {
    console.error('GET /api/venue/compliance/types failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/venue/compliance/types — create a custom type (admin). */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Admin role required.' }, { status: 403 });

    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const body = await request.json().catch(() => null);
    const parsed = complianceTypeCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const result = await createComplianceType(staff.db, {
      venueId: staff.venue_id,
      staffId: staff.id,
      name: parsed.data.name,
      category: parsed.data.category,
      resultType: parsed.data.result_type,
      validityPeriodDays: parsed.data.validity_period_days,
      captureMethods: parsed.data.capture_methods,
      description: parsed.data.description ?? null,
      formLinkExpiryDays: parsed.data.form_link_expiry_days ?? null,
      formSchema: parsed.data.form_schema,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    const withVersion = await getComplianceTypeWithVersion(staff.db, staff.venue_id, result.value.type.id);
    return NextResponse.json(withVersion.ok ? withVersion.value : { type: result.value.type }, { status: 201 });
  } catch (err) {
    console.error('POST /api/venue/compliance/types failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
