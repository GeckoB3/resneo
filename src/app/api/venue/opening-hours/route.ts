import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { openingHoursSchema } from '@/types/config-schemas';

/** PATCH /api/venue/opening-hours - update opening_hours (admin only). */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = openingHoursSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const opening_hours = parsed.data ?? undefined;

    const { data: venue, error } = await staff.db
      .from('venues')
      .update({ opening_hours, updated_at: new Date().toISOString() })
      .eq('id', staff.venue_id)
      .select('opening_hours')
      .single();

    if (error) {
      console.error('PATCH /api/venue/opening-hours failed:', error);
      return NextResponse.json({ error: 'Failed to update opening hours' }, { status: 500 });
    }

    return NextResponse.json({ opening_hours: venue.opening_hours });
  } catch (err) {
    console.error('PATCH /api/venue/opening-hours failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
