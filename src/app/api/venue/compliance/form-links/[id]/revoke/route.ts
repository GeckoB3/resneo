import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { requireCompliancePlan } from '@/lib/compliance/auth';
import { revokeFormLink } from '@/lib/compliance/form-links-service';

interface RouteCtx {
  params: { id: string } | Promise<{ id: string }>;
}

/** POST /api/venue/compliance/form-links/[id]/revoke — revoke an unconsumed link. */
export async function POST(_request: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const { id } = await Promise.resolve(ctx.params);
    const result = await revokeFormLink(staff.db, { venueId: staff.venue_id, staffId: staff.id, linkId: id });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ link: result.value });
  } catch (err) {
    console.error('POST /api/venue/compliance/form-links/[id]/revoke failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
