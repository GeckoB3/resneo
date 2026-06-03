import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { requireCompliancePlan } from '@/lib/compliance/auth';
import { complianceRecordVoidSchema } from '@/lib/compliance/zod-schemas';
import { voidComplianceRecord } from '@/lib/compliance/records-service';

interface RouteCtx {
  params: { id: string } | Promise<{ id: string }>;
}

/** POST /api/venue/compliance/records/[id]/void — void a record (reason required). */
export async function POST(request: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const { id } = await Promise.resolve(ctx.params);
    const body = await request.json().catch(() => null);
    const parsed = complianceRecordVoidSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'A reason is required to void a record.' }, { status: 400 });
    }

    const result = await voidComplianceRecord(staff.db, {
      venueId: staff.venue_id,
      staffId: staff.id,
      recordId: id,
      reason: parsed.data.reason,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ record: result.value });
  } catch (err) {
    console.error('POST /api/venue/compliance/records/[id]/void failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
