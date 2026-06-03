import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { requireCompliancePlan } from '@/lib/compliance/auth';
import { complianceRecordNotesPatchSchema } from '@/lib/compliance/zod-schemas';
import { writeComplianceAuditEvent } from '@/lib/compliance/audit';

interface RouteCtx {
  params: { id: string } | Promise<{ id: string }>;
}

/** GET /api/venue/compliance/records/[id] — record + version snapshot; writes record.viewed audit (§13.1). */
export async function GET(_request: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const { id } = await Promise.resolve(ctx.params);
    const { data: record } = await staff.db
      .from('compliance_records')
      .select('*, compliance_types!inner(name, category, result_type)')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();
    if (!record) return NextResponse.json({ error: 'Record not found.' }, { status: 404 });

    const versionId = (record as { compliance_type_version_id: string }).compliance_type_version_id;
    const { data: version } = await staff.db
      .from('compliance_type_versions')
      .select('id, version_number, form_schema')
      .eq('id', versionId)
      .maybeSingle();

    await writeComplianceAuditEvent(staff.db, {
      venueId: staff.venue_id,
      eventType: 'record.viewed',
      actorType: 'staff',
      actorStaffId: staff.id,
      guestId: (record as { guest_id: string }).guest_id,
      complianceRecordId: id,
      complianceTypeId: (record as { compliance_type_id: string }).compliance_type_id,
    });

    return NextResponse.json({ record, version: version ?? null });
  } catch (err) {
    console.error('GET /api/venue/compliance/records/[id] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH /api/venue/compliance/records/[id] — edit notes only (responses are immutable). */
export async function PATCH(request: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const { id } = await Promise.resolve(ctx.params);
    const body = await request.json().catch(() => null);
    const parsed = complianceRecordNotesPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const { data: existing } = await staff.db
      .from('compliance_records')
      .select('id, guest_id, compliance_type_id')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: 'Record not found.' }, { status: 404 });

    const { data: updated, error } = await staff.db
      .from('compliance_records')
      .update({ notes: parsed.data.notes, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .select()
      .single();
    if (error) {
      console.error('PATCH compliance record notes failed:', error.message);
      return NextResponse.json({ error: 'Failed to update notes.' }, { status: 500 });
    }

    await writeComplianceAuditEvent(staff.db, {
      venueId: staff.venue_id,
      eventType: 'record.updated',
      actorType: 'staff',
      actorStaffId: staff.id,
      guestId: (existing as { guest_id: string }).guest_id,
      complianceRecordId: id,
      complianceTypeId: (existing as { compliance_type_id: string }).compliance_type_id,
      metadata: { fields: ['notes'] },
    });

    return NextResponse.json({ record: updated });
  } catch (err) {
    console.error('PATCH /api/venue/compliance/records/[id] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
