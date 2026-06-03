import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { requireCompliancePlan } from '@/lib/compliance/auth';
import { complianceTypeVersionCreateSchema } from '@/lib/compliance/zod-schemas';
import { createComplianceTypeVersion } from '@/lib/compliance/types-service';

interface RouteCtx {
  params: { id: string } | Promise<{ id: string }>;
}
async function resolveParams(ctx: RouteCtx): Promise<{ id: string }> {
  return Promise.resolve(ctx.params);
}

/** GET /api/venue/compliance/types/[id]/versions — list versions (newest first). */
export async function GET(_request: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const { id } = await resolveParams(ctx);
    const { data: typeRow } = await staff.db
      .from('compliance_types')
      .select('id')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();
    if (!typeRow) return NextResponse.json({ error: 'Compliance type not found.' }, { status: 404 });

    const { data: versions, error } = await staff.db
      .from('compliance_type_versions')
      .select('id, version_number, changelog, created_by_staff_id, created_at')
      .eq('compliance_type_id', id)
      .order('version_number', { ascending: false });
    if (error) {
      console.error('GET compliance versions failed:', error.message);
      return NextResponse.json({ error: 'Failed to load versions.' }, { status: 500 });
    }
    return NextResponse.json({ versions: versions ?? [] });
  } catch (err) {
    console.error('GET /api/venue/compliance/types/[id]/versions failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/venue/compliance/types/[id]/versions — form-builder save → new version (admin). */
export async function POST(request: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Admin role required.' }, { status: 403 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const { id } = await resolveParams(ctx);
    const body = await request.json().catch(() => null);
    const parsed = complianceTypeVersionCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const result = await createComplianceTypeVersion(staff.db, {
      venueId: staff.venue_id,
      staffId: staff.id,
      typeId: id,
      formSchema: parsed.data.form_schema,
      changelog: parsed.data.changelog ?? null,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.value, { status: 201 });
  } catch (err) {
    console.error('POST /api/venue/compliance/types/[id]/versions failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
