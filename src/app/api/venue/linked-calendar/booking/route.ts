import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveCallerGrantOverVenue } from '@/lib/linked-accounts/queries';
import { linkedBookingChangeSchema } from '@/lib/linked-accounts/validation';

/**
 * PATCH /api/venue/linked-calendar/booking — edit (or cancel, via status) a
 * booking in a linked venue. Requires `edit_existing` action on the link. The
 * write goes through the linked_apply_booking_update RPC so the cross-venue
 * audit trigger captures the acting venue, user and link in one transaction.
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const staff = await getVenueStaff(supabase);
  if (!staff) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const parsed = linkedBookingChangeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const admin = getSupabaseAdminClient();
    const { data: booking } = await admin
      .from('bookings')
      .select('id, venue_id')
      .eq('id', parsed.data.bookingId)
      .maybeSingle();
    if (!booking) {
      return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
    }
    const ownerVenueId = booking.venue_id as string;

    if (ownerVenueId === staff.venue_id) {
      return NextResponse.json(
        { error: 'Use the normal booking tools for your own venue.' },
        { status: 400 },
      );
    }

    const access = await resolveCallerGrantOverVenue(admin, staff.venue_id, ownerVenueId);
    if (!access) {
      return NextResponse.json(
        { error: 'You do not have an active link with that venue.' },
        { status: 403 },
      );
    }
    if (access.grant.act === 'none') {
      return NextResponse.json(
        { error: 'This link does not allow editing the other venue’s bookings.' },
        { status: 403 },
      );
    }

    const { data: updated, error: rpcError } = await admin.rpc('linked_apply_booking_update', {
      p_actor_user_id: user?.id ?? null,
      p_acting_venue_id: staff.venue_id,
      p_link_id: access.linkId,
      p_booking_id: parsed.data.bookingId,
      p_changes: parsed.data.changes,
    });
    if (rpcError) {
      console.error('linked_apply_booking_update RPC failed:', rpcError.message);
      return NextResponse.json({ error: 'Failed to update the booking.' }, { status: 500 });
    }

    return NextResponse.json({ booking: updated });
  } catch (err) {
    console.error('PATCH /api/venue/linked-calendar/booking failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
