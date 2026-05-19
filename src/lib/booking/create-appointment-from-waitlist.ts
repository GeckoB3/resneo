/**
 * Converts an appointment waitlist entry into a staff phone booking (Phase 1a.3).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  attachVenueClockToAppointmentInput,
  computeAppointmentAvailability,
  fetchAppointmentInput,
  validateAppointmentCustomInterval,
} from '@/lib/availability/appointment-engine';
import { mergeAppointmentServiceWithPractitionerLink } from '@/lib/appointments/merge-service-with-overrides';
import { snapshotProcessingTimeBlocksFromCatalog } from '@/lib/appointments/processing-time';
import { cancellationDeadlineHoursBefore } from '@/lib/booking/cancellation-deadline';
import { resolveCancellationNoticeHoursForCreate } from '@/lib/booking/resolve-cancellation-notice-hours';
import {
  isGuestBookingDateAllowed,
  loadServiceEntityBookingWindow,
} from '@/lib/booking/entity-booking-window';
import { findOrCreateGuest } from '@/lib/guests';
import { normaliseGuestNamePart } from '@/lib/guests/name';
import { resolveVenueMode } from '@/lib/venue-mode';
import { venueUsesUnifiedAppointmentData, isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import type { BookingModel } from '@/types/booking-models';
import { findAppointmentWaitlistAvailability } from '@/lib/booking/waitlist-offer-availability';

export interface AppointmentWaitlistEntryRow {
  desired_date: string;
  desired_time: string | null;
  desired_time_end?: string | null;
  appointment_service_id: string | null;
  service_item_id: string | null;
  practitioner_id: string | null;
  guest_first_name: string | null;
  guest_last_name: string | null;
  guest_email: string | null;
  guest_phone: string;
  notes: string | null;
}

export type CreateAppointmentFromWaitlistResult =
  | { ok: true; bookingId: string }
  | { ok: false; error: string; status: number };

export function endHHmmFromDuration(startHHmm: string, durationMinutes: number): string {
  const startMin = parseInt(startHHmm.slice(0, 2), 10) * 60 + parseInt(startHHmm.slice(3, 5), 10);
  const endMin = startMin + durationMinutes;
  return `${String(Math.floor((endMin % (24 * 60)) / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
}

async function resolvePractitionerForSlot(
  admin: SupabaseClient,
  venueId: string,
  date: string,
  serviceId: string,
  timeStr: string,
  preferredPractitionerId: string | null,
): Promise<string | null> {
  if (preferredPractitionerId) return preferredPractitionerId;

  const input = await fetchAppointmentInput({
    supabase: admin,
    venueId,
    date,
    serviceId,
  });
  const result = computeAppointmentAvailability(input);
  for (const practitioner of result.practitioners) {
    const hasSlot = practitioner.slots.some(
      (slot) => slot.service_id === serviceId && slot.start_time === timeStr,
    );
    if (hasSlot) return practitioner.id;
  }
  return null;
}

export async function createAppointmentBookingFromWaitlistEntry(
  admin: SupabaseClient,
  venueId: string,
  staffId: string,
  entry: AppointmentWaitlistEntryRow,
): Promise<CreateAppointmentFromWaitlistResult> {
  const serviceId = entry.service_item_id ?? entry.appointment_service_id;
  if (!serviceId) {
    return { ok: false, error: 'Appointment waitlist entry is missing a service.', status: 400 };
  }
  const bookingDate = entry.desired_date;
  let timeStr = entry.desired_time ? String(entry.desired_time).slice(0, 5) : null;

  if (!timeStr) {
    const availability = await findAppointmentWaitlistAvailability(admin, venueId, {
      desired_date: entry.desired_date,
      desired_time: entry.desired_time,
      desired_time_end: entry.desired_time_end ?? null,
      appointment_service_id: entry.appointment_service_id,
      service_item_id: entry.service_item_id,
      practitioner_id: entry.practitioner_id,
    });
    if (!availability.available || !availability.sampleSlotStartHm) {
      return {
        ok: false,
        error:
          availability.reason ??
          'No appointment slots are available in this guest’s requested window.',
        status: 409,
      };
    }
    timeStr = availability.sampleSlotStartHm;
  }

  const timeForDb = `${timeStr}:00`;

  const { data: venue } = await admin
    .from('venues')
    .select(
      'id, timezone, booking_rules, opening_hours, venue_opening_exceptions, stripe_connected_account_id, booking_model, enabled_models',
    )
    .eq('id', venueId)
    .maybeSingle();

  if (!venue) {
    return { ok: false, error: 'Venue not found', status: 404 };
  }

  const venueMode = await resolveVenueMode(admin, venueId);
  const supportsAppointments =
    isUnifiedSchedulingVenue(venueMode.bookingModel) ||
    venueUsesUnifiedAppointmentData(venueMode.bookingModel, venueMode.enabledModels);
  if (!supportsAppointments) {
    return { ok: false, error: 'This venue does not support appointment bookings', status: 400 };
  }

  const practitionerId = await resolvePractitionerForSlot(
    admin,
    venueId,
    bookingDate,
    serviceId,
    timeStr,
    entry.practitioner_id,
  );
  if (!practitionerId) {
    return {
      ok: false,
      error: 'No practitioner is available at this time for the requested service.',
      status: 409,
    };
  }

  const { data: duplicate } = await admin
    .from('bookings')
    .select('id')
    .eq('venue_id', venueId)
    .eq('booking_date', bookingDate)
    .eq('booking_time', timeForDb)
    .or(`practitioner_id.eq.${practitionerId},calendar_id.eq.${practitionerId}`)
    .in('status', ['Pending', 'Booked', 'Confirmed', 'Seated', 'Completed'])
    .limit(1)
    .maybeSingle();

  if (duplicate) {
    return {
      ok: false,
      error: 'An appointment already exists at this time for this calendar.',
      status: 409,
    };
  }

  const guestFirst = normaliseGuestNamePart(entry.guest_first_name ?? 'Guest');
  const guestLast = normaliseGuestNamePart(entry.guest_last_name ?? '');
  const emailNorm =
    entry.guest_email && entry.guest_email.trim() !== ''
      ? entry.guest_email.trim().toLowerCase()
      : null;

  const { guest } = await findOrCreateGuest(
    admin,
    venueId,
    {
      first_name: guestFirst,
      last_name: guestLast,
      email: emailNorm,
      phone: entry.guest_phone,
    },
    { silentAuthSignup: Boolean(emailNorm) },
  );

  const svcWindow = await loadServiceEntityBookingWindow(
    admin,
    venueId,
    venueMode.bookingModel,
    serviceId,
  );
  const tz =
    typeof venue.timezone === 'string' && venue.timezone.trim() !== ''
      ? venue.timezone.trim()
      : 'Europe/London';
  if (!isGuestBookingDateAllowed(bookingDate, svcWindow, tz)) {
    return { ok: false, error: 'This date is not available for booking', status: 400 };
  }

  const appointmentInput = await fetchAppointmentInput({
    supabase: admin,
    venueId,
    date: bookingDate,
    practitionerId,
    serviceId,
  });
  attachVenueClockToAppointmentInput(appointmentInput, venue, svcWindow);

  const intervalCheck = validateAppointmentCustomInterval(
    appointmentInput,
    practitionerId,
    serviceId,
    timeStr,
    endHHmmFromDuration(
      timeStr,
      appointmentInput.services.find((s) => s.id === serviceId)?.duration_minutes ?? 30,
    ),
  );
  if (!intervalCheck.ok) {
    return {
      ok: false,
      error: intervalCheck.reason ?? 'This slot is no longer available',
      status: 409,
    };
  }

  const baseSvc = appointmentInput.services.find((s) => s.id === serviceId);
  const ps = appointmentInput.practitionerServices.find(
    (row) => row.practitioner_id === practitionerId && row.service_id === serviceId,
  );
  const svc = baseSvc ? mergeAppointmentServiceWithPractitionerLink(baseSvc, ps) : undefined;
  if (!svc) {
    return { ok: false, error: 'Service not available with this practitioner', status: 400 };
  }

  const useUnifiedAppointmentStorage =
    venueMode.bookingModel === 'unified_scheduling' ||
    venueUsesUnifiedAppointmentData(venueMode.bookingModel, venueMode.enabledModels);
  const appointmentBookingModel: BookingModel = useUnifiedAppointmentStorage
    ? 'unified_scheduling'
    : 'practitioner_appointment';

  const durationMins = svc.duration_minutes ?? 30;
  const [y, mo, d] = bookingDate.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const endDate = new Date(Date.UTC(y!, mo! - 1, d!, hh!, mm!, 0));
  endDate.setMinutes(endDate.getMinutes() + durationMins);
  const estimatedEndTime = endDate.toISOString();
  const bookingEndTime = `${String(endDate.getUTCHours()).padStart(2, '0')}:${String(endDate.getUTCMinutes()).padStart(2, '0')}:00`;

  const refundWindowHours = await resolveCancellationNoticeHoursForCreate({
    supabase: admin,
    venueId,
    effectiveModel: venueMode.bookingModel,
    ...(useUnifiedAppointmentStorage
      ? { serviceItemId: serviceId }
      : { appointmentServiceId: serviceId }),
  });
  const cancellationDeadline = cancellationDeadlineHoursBefore(
    bookingDate,
    timeForDb,
    refundWindowHours,
  );

  const apptInsert: Record<string, unknown> = {
    venue_id: venueId,
    guest_id: guest.id,
    booking_date: bookingDate,
    booking_time: timeForDb,
    booking_end_time: bookingEndTime,
    party_size: 1,
    booking_model: appointmentBookingModel,
    status: 'Booked',
    source: 'phone',
    created_by_staff_id: staffId,
    guest_email: guest.email || null,
    guest_first_name: guestFirst,
    guest_last_name: guestLast,
    guest_phone: entry.guest_phone,
    deposit_status: 'Not Required',
    cancellation_deadline: cancellationDeadline,
    dietary_notes: entry.notes?.trim() || null,
    estimated_end_time: estimatedEndTime,
    processing_time_blocks: snapshotProcessingTimeBlocksFromCatalog({ service: svc, variant: null }),
  };

  if (useUnifiedAppointmentStorage) {
    apptInsert.calendar_id = practitionerId;
    apptInsert.service_item_id = serviceId;
    apptInsert.practitioner_id = null;
    apptInsert.appointment_service_id = null;
  } else {
    apptInsert.practitioner_id = practitionerId;
    apptInsert.appointment_service_id = serviceId;
  }

  const { data: booking, error: insertErr } = await admin
    .from('bookings')
    .insert(apptInsert)
    .select('id')
    .single();

  if (insertErr || !booking) {
    console.error('[createAppointmentBookingFromWaitlistEntry] insert failed:', insertErr);
    return { ok: false, error: 'Failed to create appointment booking', status: 500 };
  }

  return { ok: true, bookingId: booking.id as string };
}
