import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { findOrCreateGuest } from '@/lib/guests';
import { generateConfirmToken, hashConfirmToken } from '@/lib/confirm-token';

import { sendBookingConfirmationNotifications, sendDepositRequestNotifications } from '@/lib/communications/send-templated';
import { autoAssignTable } from '@/lib/table-availability';
import { computeAvailability, fetchEngineInput } from '@/lib/availability';
import { AVAILABILITY_SETUP_REQUIRED_MESSAGE } from '@/lib/availability/availability-errors';
import { resolveVenueMode } from '@/lib/venue-mode';
import { syncTableStatusesForBooking } from '@/lib/table-management/lifecycle';
import { resolveDurationAndBufferForTableAssignment } from '@/lib/table-management/booking-table-duration';
import {
  attachVenueClockToAppointmentInput,
  fetchAppointmentInput,
  computeAppointmentAvailability,
  validateAppointmentCustomInterval,
} from '@/lib/availability/appointment-engine';
import { z } from 'zod';
import { normalizeToE164 } from '@/lib/phone/e164';
import { createOrGetBookingShortLink, createOrGetPaymentShortLink } from '@/lib/booking-short-links';
import { isUnifiedSchedulingVenue, venueUsesUnifiedAppointmentData } from '@/lib/booking/unified-scheduling';
import { fetchEventInput, computeEventAvailability } from '@/lib/availability/event-ticket-engine';
import { cancellationDeadlineHoursBefore } from '@/lib/booking/cancellation-deadline';
import { getCancellationNoticeHoursForBooking, parseExtendedBookingRules } from '@/lib/booking/venue-booking-rules';
import { resolveCancellationNoticeHoursForCreate } from '@/lib/booking/resolve-cancellation-notice-hours';
import { applyStaffBookingPaymentAndComms } from '@/lib/booking/staff-booking-payment-comms';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import { fetchClassInput, computeClassAvailability } from '@/lib/availability/class-session-engine';
import { getResourceBookingEmailLabels } from '@/lib/booking/resource-booking-email-labels';
import {
  fetchResourceInput,
  computeResourceAvailability,
  isResourceBookingStartInPast,
} from '@/lib/availability/resource-booking-engine';
import { mergeAppointmentServiceWithPractitionerLink } from '@/lib/appointments/merge-service-with-overrides';
import { snapshotProcessingTimeBlocksFromCatalog } from '@/lib/appointments/processing-time';
import type { BookingModel } from '@/types/booking-models';
import { resolveAppointmentServiceOnlineCharge } from '@/lib/appointments/appointment-service-payment';
import {
  isGuestBookingDateAllowed,
  isStaffWalkInBookingDateAllowed,
  loadServiceEntityBookingWindow,
} from '@/lib/booking/entity-booking-window';
import { listActiveAreasForVenue } from '@/lib/areas/resolve-default-area';
import { formatGuestDisplayName, normaliseGuestNamePart } from '@/lib/guests/name';

function endHHmmFromDuration(startHHmm: string, durationMinutes: number): string {
  const [startH, startM] = startHHmm.split(':').map(Number);
  const end = new Date(Date.UTC(2000, 0, 1, startH ?? 0, startM ?? 0, 0));
  end.setUTCMinutes(end.getUTCMinutes() + durationMinutes);
  return `${String(end.getUTCHours()).padStart(2, '0')}:${String(end.getUTCMinutes()).padStart(2, '0')}`;
}

const ticketLineSchema = z.object({
  ticket_type_id: z.string().uuid(),
  label: z.string().min(1),
  quantity: z.number().int().min(1),
  unit_price_pence: z.number().int().min(0),
});

const phoneBookingSchema = z.object({
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  booking_time: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/),
  party_size: z.number().int().min(1).max(50),
  /** Optional for staff/walk-in; both may be omitted. */
  first_name: z.string().max(100).optional(),
  last_name: z.string().max(100).optional(),
  /** Required for table (Model A) phone bookings and staff-created practitioner appointments (Model B); optional only for non-appointment unified paths if added later. */
  phone: z.string().max(24).optional(),
  email: z.union([z.literal(''), z.string().email()]).optional(),
  dietary_notes: z.string().max(500).optional(),
  occasion: z.string().max(200).optional(),
  special_requests: z.string().max(500).optional(),
  require_deposit: z.boolean().optional(),
  practitioner_id: z.string().uuid().optional(),
  appointment_service_id: z.string().uuid().optional(),
  experience_event_id: z.string().uuid().optional(),
  ticket_lines: z.array(ticketLineSchema).optional(),
  class_instance_id: z.string().uuid().optional(),
  resource_id: z.string().uuid().optional(),
  booking_end_time: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/).optional(),
  source: z.enum(['phone', 'walk-in']).optional(),
  area_id: z.string().uuid().optional(),
  /** One-off duration override for staff-created table or appointment bookings. */
  duration_minutes: z.number().int().min(15).max(14 * 60).optional(),
});

function cancellationDeadline(bookingDate: string, bookingTime: string): string {
  const [y, m, d] = bookingDate.split('-').map(Number);
  const [hh, mm] = bookingTime.slice(0, 5).split(':').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!, hh, mm, 0));
  dt.setHours(dt.getHours() - 48);
  return dt.toISOString();
}

/**
 * POST /api/venue/bookings - create a phone booking (staff). Status Pending, deposit Pending.
 * Returns payment_url if deposit required (stub: log SMS send).
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = phoneBookingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const isAppointmentCreateRequest = Boolean(parsed.data.practitioner_id && parsed.data.appointment_service_id);
    const isTableCreateRequest = !isAppointmentCreateRequest &&
      !parsed.data.experience_event_id &&
      !parsed.data.class_instance_id &&
      !parsed.data.resource_id;
    if (parsed.data.duration_minutes != null && isTableCreateRequest && parsed.data.duration_minutes > 300) {
      return NextResponse.json(
        { error: 'duration_minutes must be an integer between 15 and 300' },
        { status: 400 },
      );
    }

    const anchorIds = [
      parsed.data.experience_event_id,
      parsed.data.class_instance_id,
      parsed.data.resource_id,
    ].filter(Boolean);
    if (anchorIds.length > 1) {
      return NextResponse.json(
        { error: 'Only one of experience_event_id, class_instance_id, or resource_id may be set' },
        { status: 400 },
      );
    }
    if (parsed.data.resource_id && !parsed.data.booking_end_time) {
      return NextResponse.json({ error: 'booking_end_time is required for resource bookings' }, { status: 400 });
    }
    if (parsed.data.booking_end_time && !parsed.data.resource_id) {
      return NextResponse.json({ error: 'resource_id is required when booking_end_time is set' }, { status: 400 });
    }

    const {
      booking_date,
      booking_time,
      party_size,
      first_name,
      last_name,
      phone,
      email,
      dietary_notes,
      occasion,
      special_requests,
      require_deposit,
    } = parsed.data;
    const bookingSource = (parsed.data.source ?? 'phone') as 'phone' | 'walk-in';
    const staffWalkIn = bookingSource === 'walk-in';
    const venueId = staff.venue_id;
    const admin = getSupabaseAdminClient();

    const { data: venue } = await admin
      .from('venues')
      .select('id, name, stripe_connected_account_id, booking_rules, deposit_config, table_management_enabled, show_table_in_confirmation, timezone, address, opening_hours, venue_opening_exceptions, email, reply_to_email')
      .eq('id', venueId)
      .single();

    if (!venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    const venueMode = await resolveVenueMode(admin, venueId);

    const phoneRaw = (phone ?? '').trim();
    let phoneE164: string | null = null;
    if (isUnifiedSchedulingVenue(venueMode.bookingModel)) {
      if (isAppointmentCreateRequest && !phoneRaw && !staffWalkIn) {
        return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
      }
      if (phoneRaw) {
        const n = normalizeToE164(phoneRaw, 'GB');
        if (!n) {
          return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
        }
        phoneE164 = n;
      }
    } else {
      if (!phoneRaw && !staffWalkIn) {
        return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
      }
      if (phoneRaw) {
        const n = normalizeToE164(phoneRaw, 'GB');
        if (!n) {
          return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
        }
        phoneE164 = n;
      }
    }

    const emailNorm = email && email.trim() !== '' ? email.trim().toLowerCase() : null;
    const guestFirst = normaliseGuestNamePart(first_name);
    const guestLast = normaliseGuestNamePart(last_name);
    const { guest } = await findOrCreateGuest(
      admin,
      venueId,
      {
        first_name: guestFirst,
        last_name: guestLast,
        email: emailNorm,
        phone: phoneE164,
      },
      { silentAuthSignup: Boolean(emailNorm) },
    );
    const staffGuestDisplayName = formatGuestDisplayName(guest.first_name, guest.last_name, 'walk-in');
    const timeForDb = booking_time.length === 5 ? booking_time + ':00' : booking_time;
    const timeStr = timeForDb.slice(0, 5);

    // --- Model C: Event ticket (staff; primary or enabled secondary) ---
    if (parsed.data.experience_event_id) {
      const canEvent =
        venueMode.bookingModel === 'event_ticket' || venueMode.enabledModels.includes('event_ticket');
      if (!canEvent) {
        return NextResponse.json(
          { error: 'This venue does not support event ticket bookings' },
          { status: 400 },
        );
      }
      if (!phoneE164 && !staffWalkIn) {
        return NextResponse.json({ error: 'Phone number is required for event bookings' }, { status: 400 });
      }
      const ticketLines = parsed.data.ticket_lines ?? [];
      if (ticketLines.length === 0) {
        return NextResponse.json({ error: 'ticket_lines is required for event bookings' }, { status: 400 });
      }
      const totalQty = ticketLines.reduce((s, t) => s + t.quantity, 0);
      if (totalQty !== party_size) {
        return NextResponse.json({ error: 'party_size must match total ticket quantity' }, { status: 400 });
      }

      const tz =
        typeof venue.timezone === 'string' && venue.timezone.trim() !== ''
          ? venue.timezone.trim()
          : 'Europe/London';
      const eventInput = await fetchEventInput({ supabase: admin, venueId, date: booking_date });
      const eventSlots = computeEventAvailability(eventInput, { venueTimezone: tz });
      const evSlot = eventSlots.find((e) => e.event_id === parsed.data.experience_event_id);
      if (!evSlot || evSlot.remaining_capacity < party_size) {
        return NextResponse.json({ error: 'This event is fully booked or unavailable' }, { status: 409 });
      }
      const startStr = String(evSlot.start_time).slice(0, 5);
      if (startStr !== timeStr) {
        return NextResponse.json({ error: 'Booking time does not match the event start time' }, { status: 400 });
      }

      for (const line of ticketLines) {
        const tt = evSlot.ticket_types.find((t) => t.id === line.ticket_type_id);
        if (!tt) {
          return NextResponse.json({ error: 'Invalid ticket type for this event' }, { status: 400 });
        }
        if (line.quantity > tt.remaining) {
          return NextResponse.json({ error: 'Not enough tickets remaining for one or more ticket types' }, { status: 409 });
        }
        if (line.unit_price_pence !== tt.price_pence) {
          return NextResponse.json({ error: 'Ticket price does not match the current event price' }, { status: 400 });
        }
      }

      const ticketTotal = ticketLines.reduce((sum, tl) => sum + tl.quantity * tl.unit_price_pence, 0);
      const eventPayReq = evSlot.payment_requirement ?? 'none';
      const eventDepPerPerson = evSlot.deposit_amount_pence ?? 0;

      let depositAmountPence = 0;
      let requiresDeposit = false;
      if (!staffWalkIn && eventPayReq === 'full_payment' && ticketTotal > 0) {
        requiresDeposit = true;
        depositAmountPence = ticketTotal;
      } else if (!staffWalkIn && eventPayReq === 'deposit' && eventDepPerPerson > 0) {
        requiresDeposit = true;
        depositAmountPence = eventDepPerPerson * party_size;
      }

      const ticketTotalDisplay = ticketTotal > 0 ? `£${(ticketTotal / 100).toFixed(2)}` : null;
      const eventEmailExtras = {
        email_variant: 'appointment' as const,
        booking_model: 'event_ticket' as const,
        appointment_service_name: evSlot.event_name,
        practitioner_name: null,
        appointment_price_display: ticketTotalDisplay,
      };

      const refundWindowHours = await resolveCancellationNoticeHoursForCreate({
        supabase: admin,
        venueId,
        effectiveModel: 'event_ticket',
        experienceEventId: parsed.data.experience_event_id,
      });
      const cancellation_deadline = cancellationDeadlineHoursBefore(booking_date, booking_time, refundWindowHours);
      const cancellationPolicySnapshot = {
        refund_window_hours: refundWindowHours,
        policy: `Full refund if cancelled ${refundWindowHours}+ hours before your booking start time. No refund within ${refundWindowHours} hours of the start or for no-shows.`,
      };

      const [yEv, moEv, dEv] = booking_date.split('-').map(Number);
      const endHm = String(evSlot.end_time).slice(0, 5);
      const [eh, em] = endHm.split(':').map(Number);
      const estimatedEndTime = new Date(Date.UTC(yEv!, moEv! - 1, dEv!, eh!, em!, 0)).toISOString();

      if (requiresDeposit && !venue.stripe_connected_account_id) {
        return NextResponse.json(
          { error: 'Venue has not set up payments; payment is required for this booking type.' },
          { status: 400 },
        );
      }

      const eventInsert = {
        venue_id: venueId,
        guest_id: guest.id,
        booking_date,
        booking_time: timeForDb,
        party_size,
        /** Must be set explicitly — column defaults to `table_reservation`, which fails the area_required CHECK for non-table venues. */
        booking_model: 'event_ticket' as const,
        status: requiresDeposit ? ('Pending' as const) : ('Booked' as const),
        source: bookingSource,
        created_by_staff_id: staff.id,
        guest_email: guest.email || null,
        guest_first_name: guestFirst,
        guest_last_name: guestLast,
        guest_phone: phoneE164,
        deposit_amount_pence: requiresDeposit ? depositAmountPence : null,
        deposit_status: requiresDeposit ? ('Pending' as const) : ('Not Required' as const),
        cancellation_deadline,
        cancellation_policy_snapshot: cancellationPolicySnapshot,
        estimated_end_time: estimatedEndTime,
        experience_event_id: parsed.data.experience_event_id,
        dietary_notes: dietary_notes?.trim() || null,
        occasion: occasion?.trim() || null,
        special_requests: special_requests?.trim() || null,
      };

      const { data: evBooking, error: evBookErr } = await admin
        .from('bookings')
        .insert(eventInsert)
        .select('id')
        .single();

      if (evBookErr) {
        console.error('Staff event booking insert failed:', evBookErr);
        return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
      }

      const lines = ticketLines.map((tl) => ({
        booking_id: evBooking.id,
        ticket_type_id: tl.ticket_type_id,
        label: tl.label,
        quantity: tl.quantity,
        unit_price_pence: tl.unit_price_pence,
      }));
      const { error: lineErr } = await admin.from('booking_ticket_lines').insert(lines);
      if (lineErr) {
        console.error('Staff event ticket lines failed:', lineErr);
        await admin.from('bookings').delete().eq('id', evBooking.id);
        return NextResponse.json({ error: 'Failed to create ticket lines' }, { status: 500 });
      }

      let payment_url: string | undefined;
      try {
        const comms = await applyStaffBookingPaymentAndComms({
          admin,
          request,
          venueId,
          venueName: venue.name,
          venueAddress: venue.address ?? undefined,
          venueProfileEmail: venue.email ?? null,
          venueReplyToEmail: venue.reply_to_email ?? null,
          stripeConnectedAccountId: venue.stripe_connected_account_id,
          bookingId: evBooking.id,
          guestName: staffGuestDisplayName,
          guestEmail: guest.email ?? null,
          guestPhone: guest.phone ?? null,
          booking_date,
          booking_time,
          party_size,
          special_requests: special_requests ?? null,
          dietary_notes: dietary_notes ?? null,
          requiresDeposit: Boolean(requiresDeposit && depositAmountPence > 0),
          depositAmountPence: depositAmountPence ?? 0,
          emailExtras: eventEmailExtras,
          logContext: 'staff event booking',
        });
        payment_url = comms.payment_url;
      } catch (e) {
        if (e instanceof Error && e.message === 'payment_failed') {
          await admin.from('booking_ticket_lines').delete().eq('booking_id', evBooking.id);
          await admin.from('bookings').delete().eq('id', evBooking.id);
          return NextResponse.json({ error: 'Payment setup failed' }, { status: 500 });
        }
        throw e;
      }

      return NextResponse.json(
        {
          booking_id: evBooking.id,
          payment_url: payment_url ?? undefined,
          message: payment_url ? 'Event booking created. Deposit link sent.' : 'Event booking created.',
        },
        { status: 201 },
      );
    }

    // --- Model D: Class session (staff; primary or enabled secondary) ---
    if (parsed.data.class_instance_id) {
      const canClass =
        venueMode.bookingModel === 'class_session' || venueMode.enabledModels.includes('class_session');
      if (!canClass) {
        return NextResponse.json(
          { error: 'This venue does not support class session bookings' },
          { status: 400 },
        );
      }
      if (!phoneE164 && !staffWalkIn) {
        return NextResponse.json({ error: 'Phone number is required for class bookings' }, { status: 400 });
      }

      const classInput = await fetchClassInput({ supabase: admin, venueId, date: booking_date });
      const classSlots = computeClassAvailability(classInput);
      const cls = classSlots.find((c) => c.instance_id === parsed.data.class_instance_id);
      if (!cls || cls.remaining < party_size) {
        return NextResponse.json({ error: 'This class is full or unavailable' }, { status: 409 });
      }
      if (cls.instance_date !== booking_date) {
        return NextResponse.json({ error: 'Booking date does not match the class instance' }, { status: 400 });
      }
      const clsStart = String(cls.start_time).slice(0, 5);
      if (clsStart !== timeStr) {
        return NextResponse.json({ error: 'Booking time does not match the class start time' }, { status: 400 });
      }

      let depositAmountPence = 0;
      let requiresDeposit = false;
      const classPayReq = cls.payment_requirement;
      const classPriceP = cls.price_pence ?? 0;
      const classDepPerPerson = cls.deposit_amount_pence ?? 0;
      if (!staffWalkIn && classPayReq === 'full_payment' && classPriceP > 0) {
        requiresDeposit = true;
        depositAmountPence = classPriceP * party_size;
      } else if (!staffWalkIn && classPayReq === 'deposit' && classDepPerPerson > 0) {
        requiresDeposit = true;
        depositAmountPence = classDepPerPerson * party_size;
      }
      const classPriceDisplay =
        cls.price_pence != null ? `£${((cls.price_pence * party_size) / 100).toFixed(2)}` : null;
      const classEmailExtras = {
        email_variant: 'appointment' as const,
        booking_model: 'class_session' as const,
        appointment_service_name: cls.class_name,
        practitioner_name: null,
        appointment_price_display: classPriceDisplay,
      };

      const bookingRulesParsedClass = parseExtendedBookingRules(venue.booking_rules);
      const refundWindowHoursClass = getCancellationNoticeHoursForBooking(
        bookingRulesParsedClass,
        'class_session',
        48,
      );
      const cancellation_deadline_class = cancellationDeadlineHoursBefore(
        booking_date,
        booking_time,
        refundWindowHoursClass,
      );
      const cancellationPolicySnapshotClass = {
        refund_window_hours: refundWindowHoursClass,
        policy: `Full refund if cancelled ${refundWindowHoursClass}+ hours before your booking start time. No refund within ${refundWindowHoursClass} hours of the start or for no-shows.`,
      };

      const [yc, mc, dc] = booking_date.split('-').map(Number);
      const [hc, minc] = timeStr.split(':').map(Number);
      const endClass = new Date(Date.UTC(yc!, mc! - 1, dc!, hc!, minc!, 0));
      endClass.setMinutes(endClass.getMinutes() + cls.duration_minutes);
      const estimatedEndTimeClass = endClass.toISOString();

      if (requiresDeposit && !venue.stripe_connected_account_id) {
        return NextResponse.json(
          { error: 'Venue has not set up payments; payment is required for this booking type.' },
          { status: 400 },
        );
      }

      const classInsert = {
        venue_id: venueId,
        guest_id: guest.id,
        booking_date,
        booking_time: timeForDb,
        party_size,
        /** Must be set explicitly — column defaults to `table_reservation`, which fails the area_required CHECK for non-table venues. */
        booking_model: 'class_session' as const,
        status: requiresDeposit ? ('Pending' as const) : ('Booked' as const),
        source: bookingSource,
        created_by_staff_id: staff.id,
        guest_email: guest.email || null,
        guest_first_name: guestFirst,
        guest_last_name: guestLast,
        guest_phone: phoneE164,
        deposit_amount_pence: requiresDeposit ? depositAmountPence : null,
        deposit_status: requiresDeposit ? ('Pending' as const) : ('Not Required' as const),
        cancellation_deadline: cancellation_deadline_class,
        cancellation_policy_snapshot: cancellationPolicySnapshotClass,
        estimated_end_time: estimatedEndTimeClass,
        class_instance_id: parsed.data.class_instance_id,
        dietary_notes: dietary_notes?.trim() || null,
        occasion: occasion?.trim() || null,
        special_requests: special_requests?.trim() || null,
      };

      const { data: classBooking, error: classBookErr } = await admin
        .from('bookings')
        .insert(classInsert)
        .select('id')
        .single();

      if (classBookErr) {
        console.error('Staff class booking insert failed:', classBookErr);
        return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
      }

      let payment_url_class: string | undefined;
      try {
        const comms = await applyStaffBookingPaymentAndComms({
          admin,
          request,
          venueId,
          venueName: venue.name,
          venueAddress: venue.address ?? undefined,
          venueProfileEmail: venue.email ?? null,
          venueReplyToEmail: venue.reply_to_email ?? null,
          stripeConnectedAccountId: venue.stripe_connected_account_id,
          bookingId: classBooking.id,
          guestName: staffGuestDisplayName,
          guestEmail: guest.email ?? null,
          guestPhone: guest.phone ?? null,
          booking_date,
          booking_time,
          party_size,
          special_requests: special_requests ?? null,
          dietary_notes: dietary_notes ?? null,
          requiresDeposit: Boolean(requiresDeposit && depositAmountPence > 0),
          depositAmountPence,
          emailExtras: classEmailExtras,
          logContext: 'staff class booking',
        });
        payment_url_class = comms.payment_url;
      } catch (e) {
        if (e instanceof Error && e.message === 'payment_failed') {
          await admin.from('bookings').delete().eq('id', classBooking.id);
          return NextResponse.json({ error: 'Payment setup failed' }, { status: 500 });
        }
        throw e;
      }

      return NextResponse.json(
        {
          booking_id: classBooking.id,
          payment_url: payment_url_class ?? undefined,
          message: payment_url_class ? 'Class booking created. Deposit link sent.' : 'Class booking created.',
        },
        { status: 201 },
      );
    }

    // --- Model E: Resource booking (staff; primary or enabled secondary) ---
    if (parsed.data.resource_id && parsed.data.booking_end_time) {
      const canResource =
        venueMode.bookingModel === 'resource_booking' ||
        venueMode.enabledModels.includes('resource_booking');
      if (!canResource) {
        return NextResponse.json(
          { error: 'This venue does not support resource bookings' },
          { status: 400 },
        );
      }
      if (!phoneE164 && !staffWalkIn) {
        return NextResponse.json({ error: 'Phone number is required for resource bookings' }, { status: 400 });
      }

      const booking_end_time = parsed.data.booking_end_time;
      const endTimeStr = booking_end_time.length === 5 ? booking_end_time + ':00' : booking_end_time;
      const durationMinutes =
        (parseInt(endTimeStr.slice(0, 2), 10) * 60 + parseInt(endTimeStr.slice(3, 5), 10)) -
        (parseInt(timeStr.slice(0, 2), 10) * 60 + parseInt(timeStr.slice(3, 5), 10));

      if (durationMinutes <= 0) {
        return NextResponse.json({ error: 'booking_end_time must be after booking start time' }, { status: 400 });
      }

      const resInput = await fetchResourceInput({
        supabase: admin,
        venueId,
        date: booking_date,
        resourceId: parsed.data.resource_id,
      });
      const resResults = computeResourceAvailability(resInput, durationMinutes);
      const resRow = resResults.find((r) => r.id === parsed.data.resource_id);
      if (!resRow) {
        return NextResponse.json({ error: 'Resource not found or inactive' }, { status: 404 });
      }
      if (durationMinutes < resRow.min_booking_minutes || durationMinutes > resRow.max_booking_minutes) {
        return NextResponse.json(
          {
            error: `Booking duration must be between ${resRow.min_booking_minutes} and ${resRow.max_booking_minutes} minutes`,
          },
          { status: 400 },
        );
      }
      const venueTzResource =
        typeof venue.timezone === 'string' && venue.timezone.trim() !== ''
          ? venue.timezone.trim()
          : 'Europe/London';
      if (isResourceBookingStartInPast(booking_date, timeStr, venueTzResource)) {
        return NextResponse.json(
          { error: 'Choose a start time in the future for today.' },
          { status: 400 },
        );
      }

      const slotAvailable = resRow.slots.some((s) => s.start_time === timeStr);
      if (!slotAvailable) {
        return NextResponse.json({ error: 'This resource slot is no longer available' }, { status: 409 });
      }

      const numSlotsRes = Math.ceil(durationMinutes / resRow.slot_interval_minutes);
      const totalPricePenceRes = (resRow.price_per_slot_pence ?? 0) * numSlotsRes;
      const payReqRes = resRow.payment_requirement ?? 'none';
      const depConfiguredRes = resRow.deposit_amount_pence ?? 0;

      let depositAmountPenceRes: number | null = null;
      let requiresDepositRes = false;
      if (!staffWalkIn && payReqRes === 'full_payment' && totalPricePenceRes > 0) {
        requiresDepositRes = true;
        depositAmountPenceRes = totalPricePenceRes;
      } else if (!staffWalkIn && payReqRes === 'deposit' && depConfiguredRes > 0) {
        requiresDepositRes = true;
        depositAmountPenceRes = depConfiguredRes;
      }

      const resourceLabels = await getResourceBookingEmailLabels(admin, parsed.data.resource_id);
      const resourcePriceDisplay =
        requiresDepositRes && depositAmountPenceRes != null && depositAmountPenceRes > 0
          ? `£${(depositAmountPenceRes / 100).toFixed(2)}`
          : totalPricePenceRes > 0 && payReqRes === 'none'
            ? `£${(totalPricePenceRes / 100).toFixed(2)} (pay at venue)`
            : null;
      const resourceEmailExtras = {
        email_variant: 'appointment' as const,
        booking_model: 'resource_booking' as const,
        appointment_service_name: resourceLabels.resourceName ?? resRow.name,
        practitioner_name: resourceLabels.hostCalendarName,
        appointment_price_display: resourcePriceDisplay,
      };

      const bookingRulesParsedRes = parseExtendedBookingRules(venue.booking_rules);
      const refundWindowHoursRes = getCancellationNoticeHoursForBooking(
        bookingRulesParsedRes,
        'resource_booking',
        48,
      );
      const cancellation_deadline_res = cancellationDeadlineHoursBefore(
        booking_date,
        booking_time,
        refundWindowHoursRes,
      );
      const cancellationPolicySnapshotRes = {
        refund_window_hours: refundWindowHoursRes,
        policy: `Full refund if cancelled ${refundWindowHoursRes}+ hours before your booking start time. No refund within ${refundWindowHoursRes} hours of the start or for no-shows.`,
      };

      const [yr, mr, dr] = booking_date.split('-').map(Number);
      const [hr, minr] = timeStr.split(':').map(Number);
      const endRes = new Date(Date.UTC(yr!, mr! - 1, dr!, hr!, minr!, 0));
      endRes.setMinutes(endRes.getMinutes() + durationMinutes);
      const estimatedEndTimeRes = endRes.toISOString();

      if (requiresDepositRes && !venue.stripe_connected_account_id) {
        return NextResponse.json(
          { error: 'Venue has not set up payments; payment is required for this booking type.' },
          { status: 400 },
        );
      }

      const bookingEndForDb = booking_end_time.length === 5 ? booking_end_time + ':00' : booking_end_time;

      const resourceInsert = {
        venue_id: venueId,
        guest_id: guest.id,
        booking_date,
        booking_time: timeForDb,
        booking_end_time: bookingEndForDb,
        party_size,
        /** Must be set explicitly — column defaults to `table_reservation`, which fails the area_required CHECK for non-table venues. */
        booking_model: 'resource_booking' as const,
        status: requiresDepositRes ? ('Pending' as const) : ('Booked' as const),
        source: bookingSource,
        created_by_staff_id: staff.id,
        guest_email: guest.email || null,
        guest_first_name: guestFirst,
        guest_last_name: guestLast,
        guest_phone: phoneE164,
        deposit_amount_pence: requiresDepositRes ? depositAmountPenceRes : null,
        deposit_status: requiresDepositRes ? ('Pending' as const) : ('Not Required' as const),
        resource_payment_requirement: payReqRes,
        cancellation_deadline: cancellation_deadline_res,
        cancellation_policy_snapshot: cancellationPolicySnapshotRes,
        estimated_end_time: estimatedEndTimeRes,
        resource_id: parsed.data.resource_id,
        /** Same anchor as public /api/booking/create — resource rows live on unified_calendars. */
        calendar_id: parsed.data.resource_id,
        dietary_notes: dietary_notes?.trim() || null,
        occasion: occasion?.trim() || null,
        special_requests: special_requests?.trim() || null,
      };

      const { data: resBooking, error: resBookErr } = await admin
        .from('bookings')
        .insert(resourceInsert)
        .select('id')
        .single();

      if (resBookErr) {
        console.error('Staff resource booking insert failed:', resBookErr);
        return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
      }

      let payment_url_res: string | undefined;
      try {
        const comms = await applyStaffBookingPaymentAndComms({
          admin,
          request,
          venueId,
          venueName: venue.name,
          venueAddress: venue.address ?? undefined,
          venueProfileEmail: venue.email ?? null,
          venueReplyToEmail: venue.reply_to_email ?? null,
          stripeConnectedAccountId: venue.stripe_connected_account_id,
          bookingId: resBooking.id,
          guestName: staffGuestDisplayName,
          guestEmail: guest.email ?? null,
          guestPhone: guest.phone ?? null,
          booking_date,
          booking_time,
          party_size,
          special_requests: special_requests ?? null,
          dietary_notes: dietary_notes ?? null,
          requiresDeposit: Boolean(
            requiresDepositRes && depositAmountPenceRes != null && depositAmountPenceRes > 0,
          ),
          depositAmountPence: depositAmountPenceRes ?? 0,
          emailExtras: resourceEmailExtras,
          logContext: 'staff resource booking',
        });
        payment_url_res = comms.payment_url;
      } catch (e) {
        if (e instanceof Error && e.message === 'payment_failed') {
          await admin.from('bookings').delete().eq('id', resBooking.id);
          return NextResponse.json({ error: 'Payment setup failed' }, { status: 500 });
        }
        throw e;
      }

      return NextResponse.json(
        {
          booking_id: resBooking.id,
          payment_url: payment_url_res ?? undefined,
          message: payment_url_res ? 'Resource booking created. Deposit link sent.' : 'Resource booking created.',
        },
        { status: 201 },
      );
    }

    // --- Model B: Practitioner / calendar appointment ---
    // Primary USE/practitioner venues, OR restaurant + appointments secondary (unified_scheduling in enabled_models).
    const supportsStaffAppointmentCreate =
      isUnifiedSchedulingVenue(venueMode.bookingModel) ||
      venueUsesUnifiedAppointmentData(venueMode.bookingModel, venueMode.enabledModels);

    if (supportsStaffAppointmentCreate && isAppointmentCreateRequest) {
      const practitioner_id = parsed.data.practitioner_id as string;
      const appointment_service_id = parsed.data.appointment_service_id as string;

      const svcWindow = await loadServiceEntityBookingWindow(
        admin,
        venueId,
        venueMode.bookingModel,
        appointment_service_id,
      );
      const tzAppt =
        typeof venue.timezone === 'string' && venue.timezone.trim() !== ''
          ? venue.timezone.trim()
          : 'Europe/London';
      const dateAllowedForBooking = staffWalkIn
        ? isStaffWalkInBookingDateAllowed(booking_date, svcWindow, tzAppt)
        : isGuestBookingDateAllowed(booking_date, svcWindow, tzAppt);
      if (!dateAllowedForBooking) {
        return NextResponse.json({ error: 'This date is not available for booking' }, { status: 400 });
      }

      const appointmentInput = await fetchAppointmentInput({
        supabase: admin,
        venueId,
        date: booking_date,
        practitionerId: practitioner_id,
        serviceId: appointment_service_id,
      });

      attachVenueClockToAppointmentInput(
        appointmentInput,
        venue as { timezone?: string | null; booking_rules?: unknown; opening_hours?: unknown },
        svcWindow,
      );

      let matchingSlot: { duration_minutes: number; start_time: string; service_id: string } | null = null;

      if (!staffWalkIn) {
        if (parsed.data.duration_minutes != null) {
          const intervalCheck = validateAppointmentCustomInterval(
            appointmentInput,
            practitioner_id,
            appointment_service_id,
            timeStr,
            endHHmmFromDuration(timeStr, parsed.data.duration_minutes),
          );
          if (!intervalCheck.ok) {
            return NextResponse.json(
              { error: intervalCheck.reason ?? 'Selected time is not available for this practitioner and service' },
              { status: 409 },
            );
          }
        } else {
          const availResult = computeAppointmentAvailability(appointmentInput);
          const practitionerSlots = availResult.practitioners.find((p) => p.id === practitioner_id);
          matchingSlot =
            practitionerSlots?.slots.find(
              (s) => s.start_time === timeStr && s.service_id === appointment_service_id,
            ) ?? null;

          if (!matchingSlot) {
            return NextResponse.json({ error: 'Selected time is not available for this practitioner and service' }, { status: 409 });
          }
        }
      }

      const baseSvc = appointmentInput.services.find((s) => s.id === appointment_service_id);
      const ps = appointmentInput.practitionerServices.find(
        (row) => row.practitioner_id === practitioner_id && row.service_id === appointment_service_id,
      );
      const svc = baseSvc ? mergeAppointmentServiceWithPractitionerLink(baseSvc, ps) : undefined;
      if (!svc) {
        return NextResponse.json({ error: 'Service not available with this practitioner' }, { status: 400 });
      }
      if (staffWalkIn && parsed.data.duration_minutes != null) {
        const intervalCheck = validateAppointmentCustomInterval(
          appointmentInput,
          practitioner_id,
          appointment_service_id,
          timeStr,
          endHHmmFromDuration(timeStr, parsed.data.duration_minutes),
          undefined,
          { allowBookingOverlap: true },
        );
        if (!intervalCheck.ok) {
          return NextResponse.json(
            { error: intervalCheck.reason ?? 'Selected time is not available for this practitioner and service' },
            { status: 409 },
          );
        }
      }
      const practRow = appointmentInput.practitioners.find((p) => p.id === practitioner_id);

      /** Same storage as public POST /api/booking/create: USE rows use service_items + unified_calendars, not appointment_services. */
      const useUnifiedAppointmentStorage =
        venueMode.bookingModel === 'unified_scheduling' ||
        venueUsesUnifiedAppointmentData(venueMode.bookingModel, venueMode.enabledModels);
      const appointmentBookingModel: BookingModel = useUnifiedAppointmentStorage
        ? 'unified_scheduling'
        : 'practitioner_appointment';

      const apptEmailExtras = {
        email_variant: 'appointment' as const,
        booking_model: appointmentBookingModel,
        practitioner_name: practRow?.name ?? null,
        appointment_service_name: svc?.name ?? null,
        appointment_price_display:
          svc?.price_pence != null ? `£${(svc.price_pence / 100).toFixed(2)}` : null,
      };
      const durationMins =
        parsed.data.duration_minutes ?? svc.duration_minutes ?? matchingSlot?.duration_minutes ?? 30;
      const [y, mo, d] = booking_date.split('-').map(Number);
      const timeParts = timeForDb.split(':').map(Number);
      const hh = timeParts[0] ?? 0;
      const mm = timeParts[1] ?? 0;
      const ss = timeParts[2] ?? 0;
      const endDate = new Date(Date.UTC(y!, mo! - 1, d!, hh, mm, ss));
      endDate.setMinutes(endDate.getMinutes() + durationMins);
      const estimatedEndTime = endDate.toISOString();
      const bookingEndTime = `${String(endDate.getUTCHours()).padStart(2, '0')}:${String(endDate.getUTCMinutes()).padStart(2, '0')}:00`;

      const refundWindowHoursAppt = await resolveCancellationNoticeHoursForCreate({
        supabase: admin,
        venueId,
        effectiveModel: venueMode.bookingModel,
        ...(useUnifiedAppointmentStorage
          ? { serviceItemId: appointment_service_id }
          : { appointmentServiceId: appointment_service_id }),
      });
      const cancellationDeadlineAppt = cancellationDeadlineHoursBefore(
        booking_date,
        booking_time,
        refundWindowHoursAppt,
      );

      const online = svc ? resolveAppointmentServiceOnlineCharge(svc) : null;
      const staffWantsDeposit = !staffWalkIn && (require_deposit ?? false);
      const requiresDeposit =
        !staffWalkIn &&
        online != null &&
        online.amountPence > 0 &&
        (online.chargeLabel === 'full_payment' || (online.chargeLabel === 'deposit' && staffWantsDeposit));
      const depositAmountPence = requiresDeposit ? online!.amountPence : null;

      if (requiresDeposit && !venue.stripe_connected_account_id) {
        return NextResponse.json(
          { error: 'Venue has not set up payments; deposits are required for this booking type.' },
          { status: 400 },
        );
      }

      const apptInsert: Record<string, unknown> = {
        venue_id: venueId,
        guest_id: guest.id,
        booking_date,
        booking_time: timeForDb,
        booking_end_time: bookingEndTime,
        party_size: 1,
        /** Must not rely on DB default `table_reservation` — that requires area_id for multi-area venues. */
        booking_model: appointmentBookingModel,
        status: requiresDeposit ? 'Pending' : 'Booked',
        source: bookingSource,
        created_by_staff_id: staff.id,
        guest_email: guest.email || null,
        guest_first_name: guestFirst,
        guest_last_name: guestLast,
        guest_phone: phoneE164,
        deposit_amount_pence: depositAmountPence,
        deposit_status: requiresDeposit ? ('Pending' as const) : ('Not Required' as const),
        cancellation_deadline: cancellationDeadlineAppt,
        dietary_notes: dietary_notes?.trim() || null,
        occasion: occasion?.trim() || null,
        special_requests: special_requests?.trim() || null,
        estimated_end_time: estimatedEndTime,
      };

      if (useUnifiedAppointmentStorage) {
        apptInsert.calendar_id = practitioner_id;
        apptInsert.service_item_id = appointment_service_id;
        apptInsert.practitioner_id = null;
        apptInsert.appointment_service_id = null;
      } else {
        apptInsert.practitioner_id = practitioner_id;
        apptInsert.appointment_service_id = appointment_service_id;
      }

      apptInsert.processing_time_blocks = svc
        ? snapshotProcessingTimeBlocksFromCatalog({ service: svc, variant: null })
        : [];

      const { data: apptBooking, error: apptErr } = await admin
        .from('bookings')
        .insert(apptInsert)
        .select('id')
        .single();

      if (apptErr) {
        console.error('Appointment booking insert failed:', apptErr);
        return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
      }

      let payment_url: string | undefined;
      if (requiresDeposit && depositAmountPence != null && depositAmountPence > 0 && venue.stripe_connected_account_id) {
        try {
          const paymentIntent = await stripe.paymentIntents.create(
            {
              amount: depositAmountPence,
              currency: 'gbp',
              metadata: { booking_id: apptBooking.id, venue_id: venueId },
              automatic_payment_methods: { enabled: true },
            },
            { stripeAccount: venue.stripe_connected_account_id },
          );
          await admin
            .from('bookings')
            .update({ stripe_payment_intent_id: paymentIntent.id, updated_at: new Date().toISOString() })
            .eq('id', apptBooking.id);

          const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : request.nextUrl.origin);
          payment_url = await createOrGetPaymentShortLink(venueId, apptBooking.id, baseUrl);
        } catch (stripeErr) {
          console.error('PaymentIntent create failed for appointment:', stripeErr);
          await admin.from('bookings').delete().eq('id', apptBooking.id);
          return NextResponse.json({ error: 'Payment setup failed' }, { status: 500 });
        }

        const depositBookingPayload = {
          id: apptBooking.id,
          guest_name: staffGuestDisplayName,
          guest_email: guest.email ?? null,
          guest_phone: guest.phone ?? null,
          booking_date,
          booking_time,
          booking_model: appointmentBookingModel,
          party_size: 1,
          special_requests: special_requests ?? null,
          dietary_notes: dietary_notes ?? null,
          deposit_amount_pence: depositAmountPence,
        };
        after(async () => {
          try {
            const results = await sendDepositRequestNotifications(
              depositBookingPayload,
              venueRowToEmailData({
                name: venue.name,
                address: venue.address ?? null,
                email: venue.email ?? null,
                reply_to_email: venue.reply_to_email ?? null,
              }),
              venueId,
              payment_url!,
            );
            if (!results.email.sent && !results.sms.sent) {
              console.warn('[after] deposit request notifications not sent:', {
                email: results.email.reason,
                sms: results.sms.reason,
              });
            }
          } catch (err) {
            console.error('[after] deposit request notifications failed:', err);
          }
        });
      } else {
        const manageToken = generateConfirmToken();
        await admin
          .from('bookings')
          .update({ confirm_token_hash: hashConfirmToken(manageToken), updated_at: new Date().toISOString() })
          .eq('id', apptBooking.id);

        const manageBookingLink = await createOrGetBookingShortLink({
          venueId,
          bookingId: apptBooking.id,
          purpose: 'manage',
          publicOrigin:
            process.env.NEXT_PUBLIC_BASE_URL ||
            (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : request.nextUrl.origin),
        });

        if (guest.email || guest.phone) {
          after(async () => {
            try {
              const { email, sms } = await sendBookingConfirmationNotifications(
                {
                  id: apptBooking.id,
                  guest_name: staffGuestDisplayName,
                  guest_email: guest.email ?? null,
                  guest_phone: guest.phone ?? null,
                  booking_date,
                  booking_time,
                  party_size: 1,
                  special_requests: special_requests ?? null,
                  dietary_notes: dietary_notes ?? null,
                  manage_booking_link: manageBookingLink,
                  ...apptEmailExtras,
                },
                venueRowToEmailData({
                  name: venue.name,
                  address: venue.address ?? null,
                  email: venue.email ?? null,
                  reply_to_email: venue.reply_to_email ?? null,
                }),
                venueId,
              );
              if (!email.sent) console.warn('[after] appointment confirmation email not sent:', email.reason);
              if (!sms.sent && sms.reason !== 'skipped' && sms.reason !== 'no_phone') {
                console.warn('[after] appointment confirmation SMS not sent:', sms.reason);
              }
            } catch (err) {
              console.error('[after] appointment confirmation notifications failed:', err);
            }
          });
        }
      }

      return NextResponse.json(
        {
          booking_id: apptBooking.id,
          payment_url: payment_url ?? undefined,
          message: payment_url ? 'Appointment created. Deposit link sent.' : 'Appointment created.',
        },
        { status: 201 },
      );
    }

    if (isUnifiedSchedulingVenue(venueMode.bookingModel) && !isAppointmentCreateRequest) {
      return NextResponse.json(
        { error: 'practitioner_id and appointment_service_id are required for appointment bookings' },
        { status: 400 },
      );
    }

    // --- Model A: Table reservation ---
    if (venueMode.availabilityEngine !== 'service') {
      return NextResponse.json({ error: AVAILABILITY_SETUP_REQUIRED_MESSAGE }, { status: 503 });
    }

    const areas = await listActiveAreasForVenue(admin, venueId);
    let resolvedAreaId: string | null = parsed.data.area_id ?? null;
    if (areas.length > 1) {
      if (!resolvedAreaId) {
        return NextResponse.json({ error: 'area_id is required for this venue' }, { status: 400 });
      }
      if (!areas.some((a) => a.id === resolvedAreaId)) {
        return NextResponse.json({ error: 'Invalid area_id' }, { status: 400 });
      }
    } else if (areas.length === 1) {
      resolvedAreaId = areas[0]!.id;
    } else {
      return NextResponse.json({ error: AVAILABILITY_SETUP_REQUIRED_MESSAGE }, { status: 503 });
    }

    const engineInput = await fetchEngineInput({
      supabase: admin,
      venueId,
      date: booking_date,
      partySize: party_size,
      areaId: resolvedAreaId,
    });
    const slots = computeAvailability(engineInput).flatMap((result) => result.slots);
    const slot = slots.find((s) => s.start_time === timeStr);
    if (!slot || slot.available_covers < party_size) {
      return NextResponse.json({ error: 'Selected time is not available' }, { status: 409 });
    }

    const { durationMinutes: engineDurationMinutes, bufferMinutes } = await resolveDurationAndBufferForTableAssignment(
      admin,
      engineInput,
      booking_date,
      party_size,
      slot.service_id,
    );
    const durationMinutes =
      parsed.data.duration_minutes != null ? parsed.data.duration_minutes : engineDurationMinutes;
    const [y, mo, d] = booking_date.split('-').map(Number);
    const [hh, mm] = timeStr.split(':').map(Number);
    const endDate = new Date(Date.UTC(y!, mo! - 1, d!, hh!, mm!, 0));
    endDate.setMinutes(endDate.getMinutes() + durationMinutes);
    const estimatedEndTime = endDate.toISOString();

    const { data: tableRestriction } = await admin
      .from('booking_restrictions')
      .select('deposit_amount_per_person_gbp')
      .eq('service_id', slot.service_id)
      .maybeSingle();

    const legacyGbp = (venue.deposit_config as { amount_per_person_gbp?: number } | null)?.amount_per_person_gbp;
    const amountPerPersonGbp =
      typeof tableRestriction?.deposit_amount_per_person_gbp === 'number'
        ? tableRestriction.deposit_amount_per_person_gbp
        : typeof legacyGbp === 'number'
          ? legacyGbp
          : null;

    const requiresDeposit = !staffWalkIn && Boolean(require_deposit);

    if (requiresDeposit && (amountPerPersonGbp == null || amountPerPersonGbp <= 0)) {
      return NextResponse.json(
        {
          error:
            'No per-person deposit amount is configured for this dining service. Set it under Availability → Booking rules for that service.',
        },
        { status: 400 },
      );
    }

    const depositAmountPence =
      requiresDeposit && amountPerPersonGbp != null
        ? Math.round(amountPerPersonGbp * party_size * 100)
        : null;

    if (requiresDeposit && !venue.stripe_connected_account_id) {
      return NextResponse.json(
        { error: 'Venue has not set up payments; deposits are required for this booking type.' },
        { status: 400 }
      );
    }

    const bookingInsert = {
      venue_id: venueId,
      guest_id: guest.id,
      booking_date,
      booking_time: timeForDb,
      party_size,
      status: requiresDeposit ? 'Pending' : 'Booked',
      source: bookingSource,
      created_by_staff_id: staff.id,
      guest_email: guest.email || null,
      guest_first_name: guestFirst,
      guest_last_name: guestLast,
      guest_phone: phoneE164,
      deposit_amount_pence: depositAmountPence,
      deposit_status: requiresDeposit ? ('Pending' as const) : ('Not Required' as const),
      cancellation_deadline: cancellationDeadline(booking_date, booking_time),
      dietary_notes: dietary_notes?.trim() || null,
      occasion: occasion?.trim() || null,
      special_requests: special_requests?.trim() || null,
      service_id: slot.service_id,
      estimated_end_time: estimatedEndTime,
      area_id: resolvedAreaId,
    };

    const { data: booking, error: bookErr } = await admin
      .from('bookings')
      .insert(bookingInsert)
      .select('id')
      .single();

    if (bookErr) {
      console.error('Phone booking insert failed:', bookErr);
      return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
    }

    let tableAssignmentUnassigned = false;
    if (venueMode.tableManagementEnabled) {
      const assigned = await autoAssignTable(
        admin,
        venueId,
        booking.id,
        booking_date,
        booking_time.slice(0, 5),
        durationMinutes,
        bufferMinutes,
        party_size,
      );
      if (assigned) {
        await syncTableStatusesForBooking(
          admin,
          booking.id,
          assigned.table_ids,
          bookingInsert.status,
          staff.id
        );
      } else {
        tableAssignmentUnassigned = true;
      }
    }

    let payment_url: string | undefined;

    if (requiresDeposit && depositAmountPence != null && depositAmountPence > 0 && venue.stripe_connected_account_id) {
      try {
        const paymentIntent = await stripe.paymentIntents.create(
          {
            amount: depositAmountPence,
            currency: 'gbp',
            metadata: { booking_id: booking.id, venue_id: venueId },
            automatic_payment_methods: { enabled: true },
          },
          { stripeAccount: venue.stripe_connected_account_id }
        );

        await admin
          .from('bookings')
          .update({
            stripe_payment_intent_id: paymentIntent.id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', booking.id);

        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : request.nextUrl.origin);
        payment_url = await createOrGetPaymentShortLink(venueId, booking.id, baseUrl);
      } catch (stripeErr) {
        console.error('PaymentIntent create failed for phone booking:', stripeErr);
        await admin.from('bookings').delete().eq('id', booking.id);
        return NextResponse.json({ error: 'Payment setup failed' }, { status: 500 });
      }

      const tableDepositPayload = {
        id: booking.id,
        guest_name: staffGuestDisplayName,
        guest_email: guest.email ?? null,
        guest_phone: guest.phone ?? null,
        booking_date,
        booking_time,
        party_size,
        special_requests: special_requests ?? null,
        dietary_notes: dietary_notes ?? null,
        deposit_amount_pence: depositAmountPence ?? null,
      };
      after(async () => {
        try {
          const results = await sendDepositRequestNotifications(
            tableDepositPayload,
            venueRowToEmailData({
              name: venue.name,
              address: venue.address ?? null,
              email: venue.email ?? null,
              reply_to_email: venue.reply_to_email ?? null,
            }),
            venueId,
            payment_url!,
          );
          if (!results.email.sent && !results.sms.sent) {
            console.warn('[after] deposit request notifications not sent:', {
              email: results.email.reason,
              sms: results.sms.reason,
            });
          }
        } catch (err) {
          console.error('[after] deposit request notifications failed:', err);
        }
      });
    } else {
      const manageToken = generateConfirmToken();
      await admin
        .from('bookings')
        .update({
          confirm_token_hash: hashConfirmToken(manageToken),
          updated_at: new Date().toISOString(),
        })
        .eq('id', booking.id);

      const manageBookingLink = await createOrGetBookingShortLink({
        venueId,
        bookingId: booking.id,
        purpose: 'manage',
        publicOrigin:
          process.env.NEXT_PUBLIC_BASE_URL ||
          (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : request.nextUrl.origin),
      });

      if (guest.email || guest.phone) {
        after(async () => {
          try {
            const { email, sms } = await sendBookingConfirmationNotifications(
              {
                id: booking.id,
                guest_name: staffGuestDisplayName,
                guest_email: guest.email ?? null,
                guest_phone: guest.phone ?? null,
                booking_date,
                booking_time,
                party_size,
                special_requests: special_requests ?? null,
                dietary_notes: dietary_notes ?? null,
                manage_booking_link: manageBookingLink,
              },
              venueRowToEmailData({
                name: venue.name,
                address: venue.address ?? null,
                email: venue.email ?? null,
                reply_to_email: venue.reply_to_email ?? null,
              }),
              venueId,
            );
            if (!email.sent) console.warn('[after] confirmation email not sent:', email.reason);
            if (!sms.sent && sms.reason !== 'skipped' && sms.reason !== 'no_phone') {
              console.warn('[after] confirmation SMS not sent:', sms.reason);
            }
          } catch (err) {
            console.error('[after] confirmation notifications failed:', err);
          }
        });
      }
    }

    return NextResponse.json(
      {
        booking_id: booking.id,
        payment_url: payment_url ?? undefined,
        message: payment_url ? 'Booking created. Deposit link sent to guest (stub: check logs).' : 'Booking created.',
        ...(tableAssignmentUnassigned ? { table_assignment_unassigned: true as const } : {}),
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('POST /api/venue/bookings failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
