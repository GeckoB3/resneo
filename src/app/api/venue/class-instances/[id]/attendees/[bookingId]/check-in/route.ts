import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { requireClassCommercePlan } from '@/lib/class-commerce/auth';
import {
  applyAttendanceMutation,
  loadStaffClassInstance,
} from '@/lib/class-commerce/class-attendance';

/**
 * POST /api/venue/class-instances/[id]/attendees/[bookingId]/check-in — staff
 * marks the guest as checked in. Idempotent.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; bookingId: string }> },
) {
  try {
    const { id, bookingId } = await ctx.params;
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }
    const gate = await requireClassCommercePlan(staff.db, staff.venue_id);
    if (!gate.ok) return gate.response;

    const inst = await loadStaffClassInstance(staff.db, staff.venue_id, id);
    if (!inst.ok) return NextResponse.json({ error: inst.error }, { status: inst.status });

    const res = await applyAttendanceMutation({
      admin: staff.db,
      venueId: staff.venue_id,
      classInstanceId: id,
      bookingId,
      kind: 'check_in',
      actorId: staff.id ?? null,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ ok: true, changed: res.changed });
  } catch (e) {
    console.error('[class-instances/check-in] POST', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
