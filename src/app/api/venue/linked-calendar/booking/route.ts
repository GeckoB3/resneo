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
import {
  linkedGrantAllowsCalendar,
  linkedGrantAllowsCancel,
  linkedGrantAllowsMutation,
} from '@/lib/booking/staff-booking-access';
import { normalizeLinkedBookingRpcChanges } from '@/lib/linked-accounts/linked-booking-patch';
import { notifyCrossVenueBookingWrite } from '@/lib/linked-accounts/notifications';

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
      .select(
        'id, venue_id, calendar_id, practitioner_id, booking_date, booking_time, booking_end_time',
      )
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
    if (!linkedGrantAllowsMutation(access.grant, false)) {
      return NextResponse.json(
        { error: 'This link does not allow editing the other venue’s bookings.' },
        { status: 403 },
      );
    }
    // §5.3 — cancelling a booking requires the full create_edit_cancel level;
    // edit_existing may reschedule and change status but not cancel.
    if (
      parsed.data.changes.status === 'Cancelled' &&
      !linkedGrantAllowsCancel(access.grant, false)
    ) {
      return NextResponse.json(
        { error: 'This link does not allow cancelling the other venue’s bookings.' },
        { status: 403 },
      );
    }
    // §18 — the booking must be on an in-scope calendar, and a reschedule may not
    // move it onto a calendar outside the shared scope.
    const currentColumn =
      (booking.calendar_id as string | null) ?? (booking.practitioner_id as string | null) ?? null;
    if (!linkedGrantAllowsCalendar(access.grant, false, currentColumn)) {
      return NextResponse.json(
        { error: 'This link does not include that calendar.' },
        { status: 403 },
      );
    }
    const targetColumn = parsed.data.changes.practitioner_id ?? undefined;
    if (targetColumn && !linkedGrantAllowsCalendar(access.grant, false, targetColumn)) {
      return NextResponse.json(
        { error: 'You cannot move this booking to a calendar outside the shared scope.' },
        { status: 403 },
      );
    }

    const rpcChanges = await normalizeLinkedBookingRpcChanges(
      admin,
      {
        venue_id: ownerVenueId,
        calendar_id: (booking.calendar_id as string | null) ?? null,
        practitioner_id: (booking.practitioner_id as string | null) ?? null,
        booking_date: booking.booking_date as string,
        booking_time: String(booking.booking_time),
        booking_end_time: booking.booking_end_time ? String(booking.booking_end_time) : null,
      },
      parsed.data.changes as Record<string, unknown>,
    );

    const { data: updated, error: rpcError } = await admin.rpc('linked_apply_booking_update', {
      p_actor_user_id: user?.id ?? null,
      p_acting_venue_id: staff.venue_id,
      p_link_id: access.linkId,
      p_booking_id: parsed.data.bookingId,
      p_changes: rpcChanges,
    });
    if (rpcError) {
      console.error('linked_apply_booking_update RPC failed:', rpcError.message);
      return NextResponse.json({ error: 'Failed to update the booking.' }, { status: 500 });
    }

    // §17.3 — email the owning venue per its preferences.
    void notifyCrossVenueBookingWrite({
      admin,
      owningVenueId: ownerVenueId,
      actingVenueId: staff.venue_id,
      actionType: parsed.data.changes.status === 'Cancelled' ? 'cancelled_booking' : 'edited_booking',
      before: booking as Record<string, unknown>,
      after: (updated as Record<string, unknown> | null) ?? null,
    });

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
    // §18 — on a scoped link the new booking must target an in-scope calendar
    // (a scoped link with no chosen calendar cannot be satisfied).
    if (!linkedGrantAllowsCalendar(access.grant, false, input.practitionerId ?? null)) {
      return NextResponse.json(
        { error: 'This link only covers specific calendars — choose one of them.' },
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

    // §17.3 — email the owning venue if it opted in to "new booking" emails.
    void notifyCrossVenueBookingWrite({
      admin,
      owningVenueId: input.ownerVenueId,
      actingVenueId: staff.venue_id,
      actionType: 'created_booking',
      before: null,
      after: { booking_date: input.bookingDate, booking_time: input.bookingTime },
    });

    return NextResponse.json({ booking: created });
  } catch (err) {
    console.error('POST /api/venue/linked-calendar/booking failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
