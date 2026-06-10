import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { findOrCreateGuest } from '@/lib/guests';
import { autoAssignTable } from '@/lib/table-availability';
import { resolveVenueMode } from '@/lib/venue-mode';
import { syncTableStatusesForBooking } from '@/lib/table-management/lifecycle';
import { resolveTableAssignmentDurationBuffer } from '@/lib/table-management/booking-table-duration';
import {
  APPOINTMENT_WAITLIST_OFFER_TTL_MS,
} from '@/lib/booking/waitlist-offer-constants';
import { formatGuestDisplayName } from '@/lib/guests/name';
import { loadWaitlistVenueCapabilities } from '@/lib/booking/load-waitlist-venue-capabilities';
import { logWaitlistConvertedEvent } from '@/lib/booking/log-waitlist-converted-event';
import { enrichWaitlistEntriesForDisplay } from '@/lib/booking/waitlist-entry-display';
import { formatWaitlistTimeWindowLabel } from '@/lib/booking/waitlist-time-window';
import { offerAppointmentWaitlistEntryManually } from '@/lib/booking/manual-appointment-waitlist-offer';
import { findAppointmentWaitlistAvailability } from '@/lib/booking/waitlist-offer-availability';
import type { WaitlistEntryCandidate } from '@/lib/booking/offer-appointment-waitlist-on-cancel';
import {
  isWaitlistKindAllowed,
  normalizeWaitlistKindQuery,
} from '@/lib/booking/waitlist-venue-capabilities';
import {
  assertAppointmentsFeatureEnabled,
  parseVenueFeatureFlags,
} from '@/lib/feature-flags';
import { parseWaitlistConfig, type AppointmentWaitlistMode } from '@/lib/booking/waitlist-config';

/**
 * Table waitlist: restaurant venues. Appointment waitlist: Appointments plan or restaurant + USE.
 * Appointment offers are gated by `waitlist_v2` on write paths. See Docs/FEATURE_FLAGS.md.
 */

/** GET /api/venue/waitlist?kind=table|appointment - list waitlist entries for the venue */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
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

    const { data: venueFlagsRow } = await admin
      .from('venues')
      .select('feature_flags')
      .eq('id', staff.venue_id)
      .maybeSingle();
    const venueFlags = parseVenueFeatureFlags(
      (venueFlagsRow as { feature_flags?: unknown } | null)?.feature_flags,
    );
    const waitlistMode: AppointmentWaitlistMode = parseWaitlistConfig(venueFlags).mode;

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

    const entries = await Promise.all(
      rows.map(async (row) => {
        const r = row as {
          id: string;
          waitlist_kind?: string;
          status?: string;
          guest_first_name?: string | null;
          guest_last_name?: string | null;
          guest_name?: string | null;
          desired_date?: string;
          desired_time?: string | null;
          desired_time_end?: string | null;
          appointment_service_id?: string | null;
          service_item_id?: string | null;
          practitioner_id?: string | null;
        };
        const guest_name =
          r.guest_name ??
          formatGuestDisplayName(r.guest_first_name, r.guest_last_name, 'guest');
        const display = displayById.get(r.id);
        const time_window_label = formatWaitlistTimeWindowLabel({
          desired_time: r.desired_time ?? null,
          desired_time_end: r.desired_time_end ?? null,
        });

        let can_offer: boolean | undefined;
        let offer_unavailable_reason: string | null = null;
        if (r.waitlist_kind === 'appointment' && r.status === 'waiting') {
          const availability = await findAppointmentWaitlistAvailability(admin, staff.venue_id, {
            desired_date: String(r.desired_date),
            desired_time: r.desired_time ?? null,
            desired_time_end: r.desired_time_end ?? null,
            appointment_service_id: r.appointment_service_id ?? null,
            service_item_id: r.service_item_id ?? null,
            practitioner_id: r.practitioner_id ?? null,
          });
          can_offer = availability.available;
          offer_unavailable_reason = availability.available
            ? null
            : (availability.reason ?? 'No matching availability.');
        }

        return {
          ...row,
          guest_name,
          service_name: display?.service_name ?? null,
          practitioner_name: display?.practitioner_name ?? null,
          time_window_label,
          can_offer,
          offer_unavailable_reason,
        };
      }),
    );

    return NextResponse.json({ entries, waitlist_mode: waitlistMode });
  } catch (err) {
    console.error('GET /api/venue/waitlist failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH /api/venue/waitlist - update entry status (offer, confirm, cancel). Body: { id, status, expires_at? } */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
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

    const previousStatus = (existingEntry as { status?: string }).status;

    let waitlistMode: AppointmentWaitlistMode = 'notify_in_order';
    if (entryKind === 'appointment') {
      const { data: venueFlagsRow } = await admin
        .from('venues')
        .select('feature_flags')
        .eq('id', staff.venue_id)
        .maybeSingle();
      const venueFlags = parseVenueFeatureFlags(
        (venueFlagsRow as { feature_flags?: unknown } | null)?.feature_flags,
      );
      waitlistMode = parseWaitlistConfig(venueFlags).mode;

      if (status === 'offered' || status === 'confirmed') {
        try {
          assertAppointmentsFeatureEnabled('waitlist_v2', venueFlags);
        } catch {
          return NextResponse.json(
            { error: 'Appointment waitlist is not enabled for this venue', code: 'feature_disabled' },
            { status: 403 },
          );
        }
      }

      if (status === 'offered' && previousStatus === 'waiting') {
        const row = existingEntry as WaitlistEntryCandidate & {
          desired_date: string;
          desired_time?: string | null;
          desired_time_end?: string | null;
          appointment_service_id?: string | null;
          service_item_id?: string | null;
          practitioner_id?: string | null;
          guest_first_name?: string | null;
          guest_last_name?: string | null;
          guest_email?: string | null;
          guest_phone?: string | null;
          created_at?: string;
        };

        const offerResult = await offerAppointmentWaitlistEntryManually(
          admin,
          staff.venue_id,
          waitlistMode,
          {
            id: String(row.id),
            desired_date: String(row.desired_date),
            desired_time: row.desired_time ? String(row.desired_time) : null,
            desired_time_end: row.desired_time_end ? String(row.desired_time_end) : null,
            appointment_service_id: row.appointment_service_id ?? null,
            service_item_id: row.service_item_id ?? null,
            practitioner_id: row.practitioner_id ?? null,
            guest_first_name: row.guest_first_name ?? null,
            guest_last_name: row.guest_last_name ?? null,
            guest_email: row.guest_email ?? null,
            guest_phone: String(row.guest_phone ?? ''),
            created_at: String(row.created_at ?? new Date().toISOString()),
          },
        );

        if (!offerResult.ok) {
          return NextResponse.json({ error: offerResult.reason }, { status: offerResult.status });
        }

        const { data: updatedEntry, error: reloadErr } = await admin
          .from('waitlist_entries')
          .select('*')
          .eq('id', id)
          .eq('venue_id', staff.venue_id)
          .single();

        if (reloadErr || !updatedEntry) {
          return NextResponse.json({ error: 'Failed to load updated entry' }, { status: 500 });
        }

        const display = await enrichWaitlistEntriesForDisplay(admin, [
          {
            id: updatedEntry.id as string,
            service_item_id: (updatedEntry as { service_item_id?: string | null }).service_item_id,
            appointment_service_id: (updatedEntry as { appointment_service_id?: string | null })
              .appointment_service_id,
            practitioner_id: (updatedEntry as { practitioner_id?: string | null }).practitioner_id,
          },
        ]);
        const rowDisplay = display.get(updatedEntry.id as string);

        return NextResponse.json({
          entry: {
            ...updatedEntry,
            guest_name:
              (updatedEntry as { guest_name?: string | null }).guest_name ??
              formatGuestDisplayName(
                (updatedEntry as { guest_first_name?: string | null }).guest_first_name,
                (updatedEntry as { guest_last_name?: string | null }).guest_last_name,
                'guest',
              ),
            service_name: rowDisplay?.service_name ?? null,
            practitioner_name: rowDisplay?.practitioner_name ?? null,
          },
        });
      }
    }

    let createdBookingId: string | null = null;
    let createdBookingModel: string | undefined;

    if (status === 'confirmed') {
      const waitlistKind = entryKind;

      if (waitlistKind === 'appointment') {
        return NextResponse.json(
          { error: 'Appointment waitlist entries are completed when a spot is offered.' },
          { status: 400 },
        );
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
      if (entryKind === 'appointment') {
        return NextResponse.json(
          { error: 'Appointment waitlist entries can only be offered from waiting status.' },
          { status: 409 },
        );
      }
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
    });
  } catch (err) {
    console.error('PATCH /api/venue/waitlist failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE /api/venue/waitlist - remove an entry. Body: { id } */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
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
