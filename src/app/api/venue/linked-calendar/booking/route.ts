import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveCallerGrantOverVenue } from '@/lib/linked-accounts/queries';
import {
  linkedBookingChangeSchema,
  linkedBookingCreateSchema,
} from '@/lib/linked-accounts/validation';
import { venueUsesUnifiedCalendarList } from '@/lib/booking/unified-calendar-list';

/**
 * PATCH /api/venue/linked-calendar/booking — edit (or cancel, via status) a
 * booking in a linked venue. Editing requires the `edit_existing` action;
 * cancelling (status → Cancelled) requires `create_edit_cancel` (§5.3). The
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
    // §5.3 — cancelling a booking requires the full create_edit_cancel level;
    // edit_existing may reschedule and change status but not cancel.
    if (
      parsed.data.changes.status === 'Cancelled' &&
      access.grant.act !== 'create_edit_cancel'
    ) {
      return NextResponse.json(
        { error: 'This link does not allow cancelling the other venue’s bookings.' },
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

/**
 * POST /api/venue/linked-calendar/booking — create a new booking in a linked
 * venue. Requires the `create_edit_cancel` action level (§5.3). The guest,
 * practitioner and service must all belong to the owning venue. The write goes
 * through the linked_apply_booking_insert RPC so the cross-venue audit trigger
 * records it in the same transaction.
 */
export async function POST(request: NextRequest) {
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
  const parsed = linkedBookingCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  if (input.ownerVenueId === staff.venue_id) {
    return NextResponse.json(
      { error: 'Use the normal booking tools for your own venue.' },
      { status: 400 },
    );
  }

  try {
    const admin = getSupabaseAdminClient();

    const access = await resolveCallerGrantOverVenue(admin, staff.venue_id, input.ownerVenueId);
    if (!access) {
      return NextResponse.json(
        { error: 'You do not have an active link with that venue.' },
        { status: 403 },
      );
    }
    if (access.grant.act !== 'create_edit_cancel') {
      return NextResponse.json(
        { error: 'This link does not allow creating bookings in the other venue.' },
        { status: 403 },
      );
    }

    // The guest must belong to the owning venue — never create against a guest
    // from another venue.
    const { data: guest } = await admin
      .from('guests')
      .select('id, venue_id')
      .eq('id', input.guestId)
      .maybeSingle();
    if (!guest || guest.venue_id !== input.ownerVenueId) {
      return NextResponse.json(
        { error: 'That client does not belong to the linked venue.' },
        { status: 400 },
      );
    }

    // The owning venue's column model determines both the table the chosen
    // calendar must exist in and which booking column the row is keyed on.
    const ownerUsesUnified = await venueUsesUnifiedCalendarList(admin, input.ownerVenueId);

    if (input.practitionerId) {
      const calendarTable = ownerUsesUnified ? 'unified_calendars' : 'practitioners';
      const { data: calendar } = await admin
        .from(calendarTable)
        .select('id, venue_id')
        .eq('id', input.practitionerId)
        .maybeSingle();
      if (!calendar || calendar.venue_id !== input.ownerVenueId) {
        return NextResponse.json(
          { error: 'That calendar does not belong to the linked venue.' },
          { status: 400 },
        );
      }
    }

    if (input.appointmentServiceId) {
      const { data: service } = await admin
        .from('appointment_services')
        .select('id, venue_id')
        .eq('id', input.appointmentServiceId)
        .maybeSingle();
      if (!service || service.venue_id !== input.ownerVenueId) {
        return NextResponse.json(
          { error: 'That service does not belong to the linked venue.' },
          { status: 400 },
        );
      }
    }

    const { data: created, error: rpcError } = await admin.rpc('linked_apply_booking_insert', {
      p_actor_user_id: user?.id ?? null,
      p_acting_venue_id: staff.venue_id,
      p_link_id: access.linkId,
      p_row: {
        venue_id: input.ownerVenueId,
        guest_id: input.guestId,
        booking_date: input.bookingDate,
        booking_time: input.bookingTime,
        booking_end_time: input.bookingEndTime ?? '',
        party_size: input.partySize ?? 1,
        practitioner_id: ownerUsesUnified ? '' : input.practitionerId ?? '',
        calendar_id: ownerUsesUnified ? input.practitionerId ?? '' : '',
        appointment_service_id: input.appointmentServiceId ?? '',
        special_requests: input.specialRequests ?? null,
      },
    });
    if (rpcError) {
      console.error('linked_apply_booking_insert RPC failed:', rpcError.message);
      return NextResponse.json({ error: 'Failed to create the booking.' }, { status: 500 });
    }

    return NextResponse.json({ booking: created });
  } catch (err) {
    console.error('POST /api/venue/linked-calendar/booking failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
