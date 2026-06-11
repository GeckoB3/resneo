import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { formatGuestDisplayName } from '@/lib/guests/name';

/**
 * GET /api/venue/class-instances/[id]/attendees - roster for this class instance.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const { id: instanceId } = await params;
    const admin = getSupabaseAdminClient();

    const { data: inst, error: instErr } = await admin
      .from('class_instances')
      .select('id, class_type_id')
      .eq('id', instanceId)
      .maybeSingle();

    if (instErr || !inst) {
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    }

    const { data: ct } = await admin
      .from('class_types')
      .select('id')
      .eq('id', inst.class_type_id as string)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (!ct) {
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    }

    const { data: rows, error } = await admin
      .from('bookings')
      .select(
        'id,status,party_size,deposit_amount_pence,deposit_status,booking_date,booking_time,checked_in_at,guest:guests(first_name,last_name,email,phone)',
      )
      .eq('venue_id', staff.venue_id)
      .eq('class_instance_id', instanceId)
      .order('booking_time', { ascending: true });

    if (error) {
      console.error('GET class-instances attendees failed:', error);
      return NextResponse.json({ error: 'Failed to load roster' }, { status: 500 });
    }

    const attendees = (rows ?? []).map((r: Record<string, unknown>) => {
      const g = r.guest as {
        first_name?: string | null;
        last_name?: string | null;
        email?: string | null;
        phone?: string | null;
      } | null;
      return {
        booking_id: r.id,
        status: r.status,
        party_size: r.party_size,
        deposit_amount_pence: r.deposit_amount_pence,
        deposit_status: r.deposit_status,
        booking_date: r.booking_date,
        booking_time: r.booking_time,
        checked_in_at: r.checked_in_at,
        guest_name: formatGuestDisplayName(g?.first_name, g?.last_name),
        guest_email: g?.email ?? null,
        guest_phone: g?.phone ?? null,
      };
    });

    return NextResponse.json({ class_instance_id: instanceId, attendees });
  } catch (err) {
    console.error('GET /api/venue/class-instances/[id]/attendees failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
