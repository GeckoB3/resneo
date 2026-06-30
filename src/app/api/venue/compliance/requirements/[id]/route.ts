import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { requireCompliancePlan } from '@/lib/compliance/auth';
import { complianceRequirementPatchSchema } from '@/lib/compliance/zod-schemas';
import { removeRequirement, updateRequirement } from '@/lib/compliance/requirements-service';

interface RouteCtx {
  params: { id: string } | Promise<{ id: string }>;
}

/** PATCH /api/venue/compliance/requirements/[id] — update enforcement / lock period (admin). */
export async function PATCH(request: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Admin role required.' }, { status: 403 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const { id } = await Promise.resolve(ctx.params);
    const body = await request.json().catch(() => null);
    const parsed = complianceRequirementPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const result = await updateRequirement(staff.db, {
      venueId: staff.venue_id,
      staffId: staff.id,
      requirementId: id,
      enforcement: parsed.data.enforcement,
      lockPeriodHours: parsed.data.lock_period_hours,
      onlineCollection: parsed.data.online_collection,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ requirement: result.value });
  } catch (err) {
    console.error('PATCH /api/venue/compliance/requirements/[id] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE /api/venue/compliance/requirements/[id] — remove a requirement (admin). */
export async function DELETE(request: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Admin role required.' }, { status: 403 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const { id } = await Promise.resolve(ctx.params);
    const result = await removeRequirement(staff.db, {
      venueId: staff.venue_id,
      staffId: staff.id,
      requirementId: id,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/venue/compliance/requirements/[id] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
