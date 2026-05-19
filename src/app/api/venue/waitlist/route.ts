import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { findOrCreateGuest } from '@/lib/guests';
import { autoAssignTable } from '@/lib/table-availability';
import { resolveVenueMode } from '@/lib/venue-mode';
import { syncTableStatusesForBooking } from '@/lib/table-management/lifecycle';
import { resolveTableAssignmentDurationBuffer } from '@/lib/table-management/booking-table-duration';
import { createAppointmentBookingFromWaitlistEntry } from '@/lib/booking/create-appointment-from-waitlist';
import { APPOINTMENT_WAITLIST_OFFER_TTL_MS } from '@/lib/booking/waitlist-offer-constants';
import { formatGuestDisplayName } from '@/lib/guests/name';
import { loadWaitlistVenueCapabilities } from '@/lib/booking/load-waitlist-venue-capabilities';
import { logWaitlistConvertedEvent } from '@/lib/booking/log-waitlist-converted-event';
import { notifyAppointmentWaitlistOfferForEntry } from '@/lib/booking/notify-appointment-waitlist-offer';
import { enrichWaitlistEntriesForDisplay } from '@/lib/booking/waitlist-entry-display';
import {
  isWaitlistKindAllowed,
  normalizeWaitlistKindQuery,
} from '@/lib/booking/waitlist-venue-capabilities';
import {
  assertAppointmentsFeatureEnabled,
  parseVenueFeatureFlags,
} from '@/lib/feature-flags';

/**
 * Table waitlist: restaurant venues. Appointment waitlist: Appointments plan or restaurant + USE.
 * Appointment offers are gated by `waitlist_v2` on write paths. See Docs/FEATURE_FLAGS.md.
 */

/** GET /api/venue/waitlist?kind=table|appointment - list waitlist entries for the venue */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const capabilities = await loadWaitlistVenueCapabilities(admin, staff.venue_id);
    if (!capabilities) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }
    if (!capabilities.showTableWaitlist && !capabilities.showAppointmentWaitlist) {
      return NextResponse.json({ error: 'Waitlist is not available for this venue' }, { status: 403 });
    }

    const kindParam = request.nextUrl.searchParams.get('kind');
    if (
      (kindParam === 'table' || kindParam === 'appointment') &&
      !isWaitlistKindAllowed(capabilities, kindParam)
    ) {
      return NextResponse.json({ error: 'Waitlist type is not available for this venue' }, { status: 400 });
    }

    const waitlistKind = normalizeWaitlistKindQuery(capabilities, kindParam);
    let query = admin
      .from('waitlist_entries')
      .select('*')
      .eq('venue_id', staff.venue_id)
      .order('created_at', { ascending: false });
    if (waitlistKind) {
      query = query.eq('waitlist_kind', waitlistKind);
    }
    const { data, error } = await query;

    if (error) {
      console.error('GET /api/venue/waitlist failed:', error);
      return NextResponse.json({ error: 'Failed to fetch waitlist' }, { status: 500 });
    }

    const rows = data ?? [];
    const displayById = await enrichWaitlistEntriesForDisplay(
      admin,
      rows.map((row) => ({
        id: row.id as string,
        service_item_id: (row as { service_item_id?: string | null }).service_item_id,
        appointment_service_id: (row as { appointment_service_id?: string | null })
          .appointment_service_id,
        practitioner_id: (row as { practitioner_id?: string | null }).practitioner_id,
      })),
    );

    const entries = rows.map((row) => {
      const r = row as {
        id: string;
        guest_first_name?: string | null;
        guest_last_name?: string | null;
        guest_name?: string | null;
      };
      const guest_name =
        r.guest_name ??
        formatGuestDisplayName(r.guest_first_name, r.guest_last_name, 'guest');
      const display = displayById.get(r.id);
      return {
        ...row,
        guest_name,
        service_name: display?.service_name ?? null,
        practitioner_name: display?.practitioner_name ?? null,
      };
    });

    return NextResponse.json({ entries });
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

    const capabilities = await loadWaitlistVenueCapabilities(admin, staff.venue_id);
    if (!capabilities) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    const entryKind =
      (existingEntry as { waitlist_kind?: string }).waitlist_kind === 'appointment'
        ? 'appointment'
        : 'table';
    if (!isWaitlistKindAllowed(capabilities, entryKind)) {
      return NextResponse.json({ error: 'Waitlist type is not available for this venue' }, { status: 403 });
    }

    if (entryKind === 'appointment' && (status === 'offered' || status === 'confirmed')) {
      const { data: venueFlagsRow } = await admin
        .from('venues')
        .select('feature_flags')
        .eq('id', staff.venue_id)
        .maybeSingle();
      try {
        assertAppointmentsFeatureEnabled(
          'waitlist_v2',
          parseVenueFeatureFlags(
            (venueFlagsRow as { feature_flags?: unknown } | null)?.feature_flags,
          ),
        );
      } catch {
        return NextResponse.json(
          { error: 'Appointment waitlist is not enabled for this venue', code: 'feature_disabled' },
          { status: 403 },
        );
      }
    }

    const previousStatus = (existingEntry as { status?: string }).status;
    let createdBookingId: string | null = null;
    let createdBookingModel: string | undefined;

    if (status === 'confirmed') {
      const waitlistKind = entryKind;

      if (waitlistKind === 'appointment') {
        const apptResult = await createAppointmentBookingFromWaitlistEntry(
          admin,
          staff.venue_id,
          staff.id,
          {
            desired_date: String(existingEntry.desired_date),
            desired_time: existingEntry.desired_time
              ? String(existingEntry.desired_time)
              : null,
            appointment_service_id:
              (existingEntry as { appointment_service_id?: string | null }).appointment_service_id ??
              null,
            service_item_id:
              (existingEntry as { service_item_id?: string | null }).service_item_id ?? null,
            practitioner_id:
              (existingEntry as { practitioner_id?: string | null }).practitioner_id ?? null,
            guest_first_name:
              typeof existingEntry.guest_first_name === 'string'
                ? existingEntry.guest_first_name
                : null,
            guest_last_name:
              typeof existingEntry.guest_last_name === 'string'
                ? existingEntry.guest_last_name
                : null,
            guest_email:
              typeof existingEntry.guest_email === 'string' ? existingEntry.guest_email : null,
            guest_phone: String(existingEntry.guest_phone),
            notes: typeof existingEntry.notes === 'string' ? existingEntry.notes : null,
          },
        );
        if (!apptResult.ok) {
          return NextResponse.json({ error: apptResult.error }, { status: apptResult.status });
        }
        createdBookingId = apptResult.bookingId;
        createdBookingModel = 'unified_scheduling';
      } else {
        if (!existingEntry.desired_time) {
          return NextResponse.json(
            { error: 'Cannot confirm this waitlist entry without a desired time.' },
            { status: 400 },
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
            { status: 409 },
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
            first_name:
              typeof existingEntry.guest_first_name === 'string'
                ? existingEntry.guest_first_name
                : null,
            last_name:
              typeof existingEntry.guest_last_name === 'string'
                ? existingEntry.guest_last_name
                : null,
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
            guest_first_name: guest.first_name,
            guest_last_name: guest.last_name,
            guest_phone:
              typeof existingEntry.guest_phone === 'string' ? existingEntry.guest_phone : null,
            guest_email: emailNorm,
          })
          .select('id, status')
          .single();

        if (bookingError || !booking) {
          console.error('Waitlist confirm booking creation failed:', bookingError);
          return NextResponse.json(
            { error: 'Failed to convert waitlist entry to booking' },
            { status: 500 },
          );
        }

        createdBookingId = booking.id;
        createdBookingModel = 'table_reservation';

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
            await syncTableStatusesForBooking(
              admin,
              booking.id,
              assigned.table_ids,
              booking.status,
              staff.id,
            );
          }
        }
      }
    }

    const updateFields: Record<string, unknown> = { status };
    const offerExpiresAt =
      expires_at ?? new Date(Date.now() + APPOINTMENT_WAITLIST_OFFER_TTL_MS).toISOString();
    if (status === 'offered') {
      updateFields.offered_at = new Date().toISOString();
      updateFields.expires_at = offerExpiresAt;
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

    let notifyFailed = false;
    if (
      entryKind === 'appointment' &&
      status === 'offered' &&
      previousStatus === 'waiting' &&
      data
    ) {
      const notify = await notifyAppointmentWaitlistOfferForEntry(
        admin,
        staff.venue_id,
        {
          desired_date: String(data.desired_date),
          desired_time: data.desired_time ? String(data.desired_time) : null,
          guest_first_name:
            typeof data.guest_first_name === 'string' ? data.guest_first_name : null,
          guest_last_name:
            typeof data.guest_last_name === 'string' ? data.guest_last_name : null,
          guest_email: typeof data.guest_email === 'string' ? data.guest_email : null,
          guest_phone: String(data.guest_phone),
        },
        String(data.expires_at ?? offerExpiresAt),
      );
      if (!notify.skipped && !notify.emailSent && !notify.smsSent) {
        notifyFailed = true;
        console.warn('[PATCH /api/venue/waitlist] offer recorded but guest was not notified', {
          waitlistEntryId: id,
          venueId: staff.venue_id,
        });
      }
    }

    if (createdBookingId && status === 'confirmed') {
      await logWaitlistConvertedEvent(admin, {
        venueId: staff.venue_id,
        bookingId: createdBookingId,
        waitlistEntryId: id,
        waitlistKind: entryKind,
        bookingModel: createdBookingModel,
      });
    }

    const display = await enrichWaitlistEntriesForDisplay(admin, [
      {
        id: data.id as string,
        service_item_id: (data as { service_item_id?: string | null }).service_item_id,
        appointment_service_id: (data as { appointment_service_id?: string | null })
          .appointment_service_id,
        practitioner_id: (data as { practitioner_id?: string | null }).practitioner_id,
      },
    ]);
    const rowDisplay = display.get(data.id as string);

    return NextResponse.json({
      entry: {
        ...data,
        guest_name:
          (data as { guest_name?: string | null }).guest_name ??
          formatGuestDisplayName(
            (data as { guest_first_name?: string | null }).guest_first_name,
            (data as { guest_last_name?: string | null }).guest_last_name,
            'guest',
          ),
        service_name: rowDisplay?.service_name ?? null,
        practitioner_name: rowDisplay?.practitioner_name ?? null,
      },
      ...(createdBookingId ? { booking_id: createdBookingId } : {}),
      ...(notifyFailed ? { notify_failed: true } : {}),
    });
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
