import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { formatGuestDisplayName } from '@/lib/guests/name';

/**
 * GET /api/venue/experience-events/[id]/attendees - bookings for this event with guest details.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const { id: eventId } = await params;
    const admin = getSupabaseAdminClient();

    const { data: eventRow, error: evErr } = await admin
      .from('experience_events')
      .select('id')
      .eq('id', eventId)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (evErr || !eventRow) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Roster + CSV should show people who are actually attending. Cancelled and
    // No-show bookings previously appeared in both, inflating the list and the
    // export (CDE review §5.3, finding 13). Exclude them at the source so the
    // count, the rendered roster and the CSV all agree.
    const EXCLUDED_ROSTER_STATUSES = ['Cancelled', 'Canceled', 'No-Show', 'NoShow', 'No Show'];

    const { data: rows, error } = await admin
      .from('bookings')
      .select(
        'id,status,party_size,deposit_amount_pence,deposit_status,booking_date,booking_time,client_arrived_at,guest:guests(first_name,last_name,email,phone),ticket_lines:booking_ticket_lines(label,quantity,unit_price_pence)',
      )
      .eq('venue_id', staff.venue_id)
      .eq('experience_event_id', eventId)
      .not('status', 'in', `(${EXCLUDED_ROSTER_STATUSES.map((s) => `"${s}"`).join(',')})`)
      .order('booking_date', { ascending: true })
      .order('booking_time', { ascending: true });

    if (error) {
      console.error('GET /experience-events/[id]/attendees failed:', error);
      return NextResponse.json({ error: 'Failed to load attendees' }, { status: 500 });
    }

    const attendees = (rows ?? []).map((r: Record<string, unknown>) => {
      const g = r.guest as {
        first_name?: string | null;
        last_name?: string | null;
        email?: string | null;
        phone?: string | null;
      } | null;
      const rawLines = r.ticket_lines as
        | Array<{ label?: string; quantity?: number; unit_price_pence?: number }>
        | null
        | undefined;
      const ticket_lines = Array.isArray(rawLines)
        ? rawLines.map((line) => ({
            label: line.label ?? '',
            quantity: line.quantity ?? 0,
            unit_price_pence: line.unit_price_pence ?? 0,
          }))
        : [];
      return {
        booking_id: r.id,
        status: r.status,
        party_size: r.party_size,
        deposit_amount_pence: r.deposit_amount_pence,
        deposit_status: r.deposit_status,
        booking_date: r.booking_date,
        booking_time: r.booking_time,
        client_arrived_at: r.client_arrived_at,
        guest_name: formatGuestDisplayName(g?.first_name, g?.last_name),
        guest_email: g?.email ?? null,
        guest_phone: g?.phone ?? null,
        ticket_lines,
      };
    });

    return NextResponse.json({ event_id: eventId, attendees });
  } catch (err) {
    console.error('GET /api/venue/experience-events/[id]/attendees failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
