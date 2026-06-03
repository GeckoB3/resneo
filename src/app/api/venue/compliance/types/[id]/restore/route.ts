import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { requireCompliancePlan } from '@/lib/compliance/auth';
import { writeComplianceAuditEvent } from '@/lib/compliance/audit';

interface RouteCtx {
  params: { id: string } | Promise<{ id: string }>;
}

/** POST /api/venue/compliance/types/[id]/restore — restore an archived type (admin). */
export async function POST(_request: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Admin role required.' }, { status: 403 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const { id } = await Promise.resolve(ctx.params);
    const { data: existing } = await staff.db
      .from('compliance_types')
      .select('id')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: 'Compliance type not found.' }, { status: 404 });

    const { data: updated, error } = await staff.db
      .from('compliance_types')
      .update({ is_active: true, archived_at: null, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .select()
      .single();
    if (error) {
      console.error('restore compliance type failed:', error.message);
      return NextResponse.json({ error: 'Failed to restore type.' }, { status: 500 });
    }

    await writeComplianceAuditEvent(staff.db, {
      venueId: staff.venue_id,
      eventType: 'type.restored',
      actorType: 'staff',
      actorStaffId: staff.id,
      complianceTypeId: id,
    });
    return NextResponse.json({ type: updated });
  } catch (err) {
    console.error('POST /api/venue/compliance/types/[id]/restore failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
