import { NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';

/** GET /api/venue/staff - list staff for the venue (admin only). Includes linked practitioner for Model B. */
export async function GET(request: Request) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const { data: rows, error } = await staff.db
      .from('staff')
      .select('id, email, name, phone, role, created_at')
      .eq('venue_id', staff.venue_id)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('GET /api/venue/staff failed:', error);
      return NextResponse.json({ error: 'Failed to load staff' }, { status: 500 });
    }

    const { data: venueRow } = await staff.db
      .from('venues')
      .select('booking_model')
      .eq('id', staff.venue_id)
      .maybeSingle();
    const bookingModel = (venueRow as { booking_model?: string } | null)?.booking_model ?? '';

    if (isUnifiedSchedulingVenue(bookingModel)) {
      const { data: assignRows } = await staff.db
        .from('staff_calendar_assignments')
        .select('staff_id, calendar_id')
        .eq('venue_id', staff.venue_id);

      const { data: ucRows } = await staff.db
        .from('unified_calendars')
        .select('id, name')
        .eq('venue_id', staff.venue_id);

      const validCalendarIds = new Set((ucRows ?? []).map((r) => r.id as string));

      const idToName = new Map(
        (ucRows ?? []).map((r) => [r.id as string, ((r.name as string) ?? '').trim() || 'Calendar']),
      );

      const byStaff = new Map<string, string[]>();
      for (const r of assignRows ?? []) {
        const sid = r.staff_id as string;
        const cid = r.calendar_id as string;
        if (!validCalendarIds.has(cid)) {
          continue;
        }
        const cur = byStaff.get(sid);
        if (cur) cur.push(cid);
        else byStaff.set(sid, [cid]);
      }

      const list = (rows ?? []).map((row) => {
        const ids = byStaff.get(row.id) ?? [];
        const names = ids.map((id) => idToName.get(id) ?? id);
        const summary = names.length === 0 ? null : names.join(', ');
        return {
          ...row,
          linked_calendar_ids: ids,
          linked_practitioner_id: ids[0] ?? null,
          linked_practitioner_name: summary,
        };
      });
      return NextResponse.json({ staff: list });
    }

    const { data: pracs } = await staff.db
      .from('practitioners')
      .select('id, name, staff_id')
      .eq('venue_id', staff.venue_id);

    const list = (rows ?? []).map((row) => {
      const p = pracs?.find((pr) => pr.staff_id === row.id);
      return {
        ...row,
        linked_practitioner_id: p?.id ?? null,
        linked_practitioner_name: p?.name ?? null,
      };
    });

    return NextResponse.json({ staff: list });
  } catch (err) {
    console.error('GET /api/venue/staff failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
