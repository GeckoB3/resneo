/**
 * Checks whether bookable appointment slots exist for a waitlist entry's date/time window.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  attachVenueClockToAppointmentInput,
  computeAppointmentAvailability,
  fetchAppointmentInput,
} from '@/lib/availability/appointment-engine';
import { isGuestBookingDateAllowed, loadServiceEntityBookingWindow } from '@/lib/booking/entity-booking-window';
import { resolveVenueMode } from '@/lib/venue-mode';
import { venueUsesUnifiedAppointmentData, isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import {
  parseWaitlistTimeWindow,
  slotStartMatchesWaitlistWindow,
  type WaitlistTimeFields,
} from '@/lib/booking/waitlist-time-window';

export interface AppointmentWaitlistAvailabilityInput {
  desired_date: string;
  desired_time: string | null;
  desired_time_end?: string | null;
  appointment_service_id: string | null;
  service_item_id: string | null;
  practitioner_id: string | null;
}

export interface AppointmentWaitlistAvailabilityResult {
  available: boolean;
  /** First matching slot start (HH:mm) when available. */
  sampleSlotStartHm: string | null;
  reason?: string;
}

export async function findAppointmentWaitlistAvailability(
  admin: SupabaseClient,
  venueId: string,
  entry: AppointmentWaitlistAvailabilityInput,
): Promise<AppointmentWaitlistAvailabilityResult> {
  const serviceId = entry.service_item_id ?? entry.appointment_service_id;
  if (!serviceId) {
    return { available: false, sampleSlotStartHm: null, reason: 'missing_service' };
  }

  const timeFields: WaitlistTimeFields = {
    desired_time: entry.desired_time,
    desired_time_end: entry.desired_time_end ?? null,
  };

  const { data: venue } = await admin
    .from('venues')
    .select('timezone, booking_rules, opening_hours, venue_opening_exceptions, booking_model, enabled_models')
    .eq('id', venueId)
    .maybeSingle();

  if (!venue) {
    return { available: false, sampleSlotStartHm: null, reason: 'venue_not_found' };
  }

  const venueMode = await resolveVenueMode(admin, venueId);
  const supportsAppointments =
    isUnifiedSchedulingVenue(venueMode.bookingModel) ||
    venueUsesUnifiedAppointmentData(venueMode.bookingModel, venueMode.enabledModels);
  if (!supportsAppointments) {
    return { available: false, sampleSlotStartHm: null, reason: 'not_appointment_venue' };
  }

  const tz =
    typeof venue.timezone === 'string' && venue.timezone.trim() !== ''
      ? venue.timezone.trim()
      : 'Europe/London';

  const svcWindow = await loadServiceEntityBookingWindow(
    admin,
    venueId,
    venueMode.bookingModel,
    serviceId,
  );

  if (!isGuestBookingDateAllowed(entry.desired_date, svcWindow, tz)) {
    return { available: false, sampleSlotStartHm: null, reason: 'date_not_bookable' };
  }

  const input = await fetchAppointmentInput({
    supabase: admin,
    venueId,
    date: entry.desired_date,
    serviceId,
    practitionerId: entry.practitioner_id ?? undefined,
  });
  attachVenueClockToAppointmentInput(input, venue, svcWindow);

  const result = computeAppointmentAvailability(input);
  const window = parseWaitlistTimeWindow(timeFields);

  for (const practitioner of result.practitioners) {
    if (entry.practitioner_id && practitioner.id !== entry.practitioner_id) continue;
    for (const slot of practitioner.slots) {
      if (slot.service_id !== serviceId) continue;
      const startHm = String(slot.start_time).slice(0, 5);
      if (!slotStartMatchesWaitlistWindow(startHm, timeFields)) continue;
      return { available: true, sampleSlotStartHm: startHm };
    }
  }

  const reason =
    window.kind === 'all_day'
      ? 'No appointment slots are available on this date.'
      : 'No appointment slots are available in the requested time window.';
  return { available: false, sampleSlotStartHm: null, reason };
}
