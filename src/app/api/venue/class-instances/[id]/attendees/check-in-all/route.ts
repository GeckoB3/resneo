import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { requireClassCommercePlan } from '@/lib/class-commerce/auth';
import {
  applyAttendanceMutation,
  loadStaffClassInstance,
} from '@/lib/class-commerce/class-attendance';

/**
 * POST /api/venue/class-instances/[id]/attendees/check-in-all — bulk check-in
 * for all non-cancelled, not-yet-checked-in bookings on the instance.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }
    const gate = await requireClassCommercePlan(staff.db, staff.venue_id);
    if (!gate.ok) return gate.response;

    const inst = await loadStaffClassInstance(staff.db, staff.venue_id, id);
    if (!inst.ok) return NextResponse.json({ error: inst.error }, { status: inst.status });

    const { data: rows, error } = await staff.db
      .from('bookings')
      .select('id, status, checked_in_at')
      .eq('venue_id', staff.venue_id)
      .eq('class_instance_id', id);
    if (error) {
      console.error('[check-in-all] load', error);
      return NextResponse.json({ error: 'Failed to load roster' }, { status: 500 });
    }
    const eligible = ((rows ?? []) as Array<{ id: string; status: string; checked_in_at: string | null }>)
      .filter((r) => r.status !== 'Cancelled' && r.status !== 'No-Show' && !r.checked_in_at);

    let changed = 0;
    for (const r of eligible) {
      const res = await applyAttendanceMutation({
        admin: staff.db,
        venueId: staff.venue_id,
        classInstanceId: id,
        bookingId: r.id,
        kind: 'check_in',
        actorId: staff.id ?? null,
      });
      if (res.ok && res.changed) changed += 1;
    }
    return NextResponse.json({ ok: true, checked_in: changed, total: eligible.length });
  } catch (e) {
    console.error('[check-in-all] POST', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
