import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { findOrCreateGuest } from '@/lib/guests';
import { autoAssignTable } from '@/lib/table-availability';
import { resolveVenueMode } from '@/lib/venue-mode';
import { syncTableStatusesForBooking } from '@/lib/table-management/lifecycle';
import { resolveTableAssignmentDurationBuffer } from '@/lib/table-management/booking-table-duration';

/** GET /api/venue/waitlist - list waitlist entries for the venue */
export async function GET() {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from('waitlist_entries')
      .select('*')
      .eq('venue_id', staff.venue_id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('GET /api/venue/waitlist failed:', error);
      return NextResponse.json({ error: 'Failed to fetch waitlist' }, { status: 500 });
    }

    return NextResponse.json({ entries: data });
  } catch (err) {
    console.error('GET /api/venue/waitlist failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH /api/venue/waitlist - update entry status (offer, confirm, cancel). Body: { id, status, expires_at? } */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const body = await request.json();
    const { id, status, expires_at } = body;
    if (!id || !status) return NextResponse.json({ error: 'Missing id or status' }, { status: 400 });

    const admin = getSupabaseAdminClient();
    const { data: existingEntry, error: existingError } = await admin
      .from('waitlist_entries')
      .select('*')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .single();

    if (existingError || !existingEntry) {
      return NextResponse.json({ error: 'Waitlist entry not found' }, { status: 404 });
    }

    if (status === 'confirmed') {
      if (!existingEntry.desired_time) {
        return NextResponse.json(
          { error: 'Cannot confirm this waitlist entry without a desired time.' },
          { status: 400 }
        );
      }

      const bookingTime = String(existingEntry.desired_time).slice(0, 5);
      const timeForDb = `${bookingTime}:00`;
      const bookingDate = String(existingEntry.desired_date);
      const partySize = Number(existingEntry.party_size);

      const { data: duplicateBooking } = await admin
        .from('bookings')
        .select('id')
        .eq('venue_id', staff.venue_id)
        .eq('booking_date', bookingDate)
        .eq('booking_time', timeForDb)
        .eq('party_size', partySize)
        .limit(1)
        .maybeSingle();

      if (duplicateBooking) {
        return NextResponse.json(
          { error: 'A booking already exists for this waitlist confirmation.' },
          { status: 409 }
        );
      }

      const venueMode = await resolveVenueMode(admin, staff.venue_id);
      const emailNorm =
        typeof existingEntry.guest_email === 'string' && existingEntry.guest_email.trim() !== ''
          ? existingEntry.guest_email.trim().toLowerCase()
          : null;
      const { guest } = await findOrCreateGuest(
        admin,
        staff.venue_id,
        {
          name: existingEntry.guest_name,
          email: emailNorm,
          phone: existingEntry.guest_phone,
        },
        { silentAuthSignup: Boolean(emailNorm) },
      );

      const { data: booking, error: bookingError } = await admin
        .from('bookings')
        .insert({
          venue_id: staff.venue_id,
          guest_id: guest.id,
          booking_date: bookingDate,
          booking_time: timeForDb,
          party_size: partySize,
          status: 'Booked',
          source: 'phone',
          deposit_status: 'Not Required',
          service_id: existingEntry.service_id ?? null,
          dietary_notes: existingEntry.notes ?? null,
        })
        .select('id, status')
        .single();

      if (bookingError || !booking) {
        console.error('Waitlist confirm booking creation failed:', bookingError);
        return NextResponse.json({ error: 'Failed to convert waitlist entry to booking' }, { status: 500 });
      }

      if (venueMode.tableManagementEnabled && venueMode.availabilityEngine === 'service') {
        const { durationMinutes, bufferMinutes } = await resolveTableAssignmentDurationBuffer(
          admin,
          staff.venue_id,
          bookingDate,
          partySize,
          existingEntry.service_id ?? null,
        );
        const assigned = await autoAssignTable(
          admin,
          staff.venue_id,
          booking.id,
          bookingDate,
          bookingTime,
          durationMinutes,
          bufferMinutes,
          partySize,
        );
        if (assigned) {
          await syncTableStatusesForBooking(admin, booking.id, assigned.table_ids, booking.status, staff.id);
        }
      }
    }

    const updateFields: Record<string, unknown> = { status };
    if (status === 'offered') {
      updateFields.offered_at = new Date().toISOString();
      updateFields.expires_at = expires_at ?? new Date(Date.now() + 30 * 60 * 1000).toISOString();
    }

    const { data, error } = await admin
      .from('waitlist_entries')
      .update(updateFields)
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .select('*')
      .single();

    if (error) {
      console.error('PATCH /api/venue/waitlist failed:', error);
      return NextResponse.json({ error: 'Failed to update entry' }, { status: 500 });
    }

    return NextResponse.json({ entry: data });
  } catch (err) {
    console.error('PATCH /api/venue/waitlist failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE /api/venue/waitlist - remove an entry. Body: { id } */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const admin = getSupabaseAdminClient();
    const { error } = await admin.from('waitlist_entries').delete().eq('id', body.id).eq('venue_id', staff.venue_id);
    if (error) {
      console.error('DELETE /api/venue/waitlist failed:', error);
      return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/venue/waitlist failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
