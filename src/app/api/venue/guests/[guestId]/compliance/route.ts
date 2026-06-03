import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { requireCompliancePlan } from '@/lib/compliance/auth';
import { listComplianceRecords } from '@/lib/compliance/records-service';
import { listFormLinks } from '@/lib/compliance/form-links-service';

interface RouteCtx {
  params: { guestId: string } | Promise<{ guestId: string }>;
}

/** GET /api/venue/guests/[guestId]/compliance — all records + pending links + recent audit for a guest. */
export async function GET(_request: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const { guestId } = await Promise.resolve(ctx.params);
    const { data: guest } = await staff.db
      .from('guests')
      .select('id')
      .eq('id', guestId)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();
    if (!guest) return NextResponse.json({ error: 'Guest not found.' }, { status: 404 });

    const [records, links, auditRes] = await Promise.all([
      listComplianceRecords(staff.db, staff.venue_id, { guestId }),
      listFormLinks(staff.db, staff.venue_id, { guestId }),
      staff.db
        .from('compliance_audit_events')
        .select('id, event_type, actor_type, actor_staff_id, compliance_record_id, compliance_type_id, metadata, created_at')
        .eq('venue_id', staff.venue_id)
        .eq('guest_id', guestId)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    return NextResponse.json({
      records,
      form_links: links,
      audit_events: auditRes.data ?? [],
    });
  } catch (err) {
    console.error('GET /api/venue/guests/[guestId]/compliance failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
