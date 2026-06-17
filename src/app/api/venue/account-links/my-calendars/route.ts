import { NextResponse } from 'next/server';
import { createRouteHandlerClientFromHeaders } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { venueUsesUnifiedCalendarList } from '@/lib/booking/unified-calendar-list';

/**
 * GET /api/venue/account-links/my-calendars — the current venue's bookable
 * calendar columns (id + name) for the §18 calendar-scope picker. Mirrors the
 * id space the linked-calendar read route filters on: `unified_calendars`
 * (non-resource) for appointments-family venues, `practitioners` for legacy.
 */
export async function GET() {
  const supabase = await createRouteHandlerClientFromHeaders();
  const staff = await getVenueStaff(supabase);
  if (!staff) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  try {
    const admin = staff.db;
    const usesUnified = await venueUsesUnifiedCalendarList(admin, staff.venue_id);
    let calendars: { id: string; name: string }[] = [];
    if (usesUnified) {
      const { data } = await admin
        .from('unified_calendars')
        .select('id, name, is_active, calendar_type, sort_order')
        .eq('venue_id', staff.venue_id)
        .order('sort_order', { ascending: true });
      calendars = (data ?? [])
        .filter(
          (c) => (c.calendar_type as string | null) !== 'resource' && (c.is_active as boolean) !== false,
        )
        .map((c) => ({ id: c.id as string, name: (c.name as string) ?? 'Calendar' }));
    } else {
      const { data } = await admin
        .from('practitioners')
        .select('id, name, is_active, sort_order')
        .eq('venue_id', staff.venue_id)
        .order('sort_order', { ascending: true });
      calendars = (data ?? [])
        .filter((p) => (p.is_active as boolean) !== false)
        .map((p) => ({ id: p.id as string, name: (p.name as string) ?? 'Calendar' }));
    }
    return NextResponse.json({ calendars });
  } catch (err) {
    console.error('GET /api/venue/account-links/my-calendars failed:', err);
    return NextResponse.json({ error: 'Could not load calendars' }, { status: 500 });
  }
}
