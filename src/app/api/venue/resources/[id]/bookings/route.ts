import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { formatGuestDisplayName } from '@/lib/guests/name';

function hhmm(t: string | null | undefined): string {
  if (!t) return '09:00';
  const s = String(t);
  return s.length >= 5 ? s.slice(0, 5) : s;
}

/**
 * GET /api/venue/resources/[id]/bookings?date=YYYY-MM-DD
 * Bookings for a single resource on one date (venue-scoped).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const { id: resourceId } = await params;
    const date = request.nextUrl.searchParams.get('date');
    const isoRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!date || !isoRe.test(date)) {
      return NextResponse.json({ error: 'Provide date=YYYY-MM-DD' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();

    const { data: resourceRow, error: resourceErr } = await admin
      .from('unified_calendars')
      .select('id, name, display_on_calendar_id')
      .eq('id', resourceId)
      .eq('venue_id', staff.venue_id)
      .eq('calendar_type', 'resource')
      .maybeSingle();

    if (resourceErr) {
      console.error('GET /api/venue/resources/[id]/bookings resource lookup failed:', resourceErr);
      return NextResponse.json({ error: 'Failed to load resource' }, { status: 500 });
    }
    if (!resourceRow) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
    }

    const { data: rows, error } = await staff.db
      .from('bookings')
      .select(
        'id, booking_date, booking_time, booking_end_time, estimated_end_time, status, party_size, deposit_amount_pence, deposit_status, resource_payment_requirement, checked_in_at, guest:guests(first_name, last_name, email, phone)',
      )
      .eq('venue_id', staff.venue_id)
      .eq('booking_date', date)
      .or(`resource_id.eq.${resourceId},calendar_id.eq.${resourceId}`)
      .order('booking_time', { ascending: true });

    if (error) {
      console.error('GET /api/venue/resources/[id]/bookings failed:', error);
      return NextResponse.json({ error: 'Failed to load bookings' }, { status: 500 });
    }

    const bookings = (rows ?? []).map((r: Record<string, unknown>) => {
      const g = r.guest as {
        first_name?: string | null;
        last_name?: string | null;
        email?: string | null;
        phone?: string | null;
      } | null;
      return {
        booking_id: r.id as string,
        status: r.status as string,
        party_size: r.party_size as number,
        deposit_amount_pence: r.deposit_amount_pence as number | null,
        deposit_status: r.deposit_status as string | null,
        resource_payment_requirement: r.resource_payment_requirement as string | null,
        booking_date: r.booking_date as string,
        booking_time: hhmm(r.booking_time as string),
        booking_end_time: r.booking_end_time ? hhmm(r.booking_end_time as string) : null,
        estimated_end_time: r.estimated_end_time ? hhmm(r.estimated_end_time as string) : null,
        checked_in_at: r.checked_in_at as string | null,
        guest_name: formatGuestDisplayName(g?.first_name, g?.last_name),
        guest_email: g?.email ?? null,
        guest_phone: g?.phone ?? null,
      };
    });

    const resource = resourceRow as {
      id: string;
      name: string;
      display_on_calendar_id: string | null;
    };

    return NextResponse.json({
      resource_id: resource.id,
      resource_name: resource.name,
      display_on_calendar_id: resource.display_on_calendar_id ?? null,
      date,
      bookings,
    });
  } catch (err) {
    console.error('GET /api/venue/resources/[id]/bookings failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
