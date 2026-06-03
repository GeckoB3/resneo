import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { requireCompliancePlan } from '@/lib/compliance/auth';
import { complianceTypePatchSchema } from '@/lib/compliance/zod-schemas';
import { getComplianceTypeWithVersion } from '@/lib/compliance/types-service';
import { writeComplianceAuditEvent } from '@/lib/compliance/audit';

interface RouteCtx {
  params: { id: string } | Promise<{ id: string }>;
}
async function resolveParams(ctx: RouteCtx): Promise<{ id: string }> {
  return Promise.resolve(ctx.params);
}

/** GET /api/venue/compliance/types/[id] — type + current version schema. */
export async function GET(_request: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const { id } = await resolveParams(ctx);
    const result = await getComplianceTypeWithVersion(staff.db, staff.venue_id, id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.value);
  } catch (err) {
    console.error('GET /api/venue/compliance/types/[id] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH /api/venue/compliance/types/[id] — update non-schema fields (admin). */
export async function PATCH(request: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Admin role required.' }, { status: 403 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const { id } = await resolveParams(ctx);
    const body = await request.json().catch(() => null);
    const parsed = complianceTypePatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const { data: existing } = await staff.db
      .from('compliance_types')
      .select('id')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: 'Compliance type not found.' }, { status: 404 });

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const key of [
      'name',
      'category',
      'description',
      'validity_period_days',
      'capture_methods',
      'form_link_expiry_days',
      'is_active',
    ] as const) {
      if (parsed.data[key] !== undefined) update[key] = parsed.data[key];
    }

    const { data: updated, error } = await staff.db
      .from('compliance_types')
      .update(update)
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .select()
      .single();
    if (error) {
      console.error('PATCH compliance type failed:', error.message);
      return NextResponse.json({ error: 'Failed to update compliance type.' }, { status: 500 });
    }

    await writeComplianceAuditEvent(staff.db, {
      venueId: staff.venue_id,
      eventType: 'type.updated',
      actorType: 'staff',
      actorStaffId: staff.id,
      complianceTypeId: id,
      metadata: { fields: Object.keys(update).filter((k) => k !== 'updated_at') },
    });

    return NextResponse.json({ type: updated });
  } catch (err) {
    console.error('PATCH /api/venue/compliance/types/[id] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
