import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveVenueMode } from '@/lib/venue-mode';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import { getDefaultAreaIdForVenue } from '@/lib/areas/resolve-default-area';
import type { BookingModel } from '@/types/booking-models';

export interface BookingImportDefaults {
  bookingModel: BookingModel;
  unified: boolean;
  defaultAreaId: string | null;
  defaultCalendarId: string | null;
  defaultServiceItemId: string | null;
  defaultPractitionerId: string | null;
  defaultAppointmentServiceId: string | null;
}

/**
 * Resolves the venue-level defaults the import execute step relies on for booking
 * inserts. Used both at validation (pre-flight error if defaults missing) and at
 * execute time (single source of truth, kept in sync between phases).
 *
 * Returns null fields where the venue is misconfigured for that booking model so
 * callers can produce specific blocking errors.
 */
export async function resolveBookingImportDefaults(
  admin: SupabaseClient,
  venueId: string,
): Promise<BookingImportDefaults> {
  const venueMode = await resolveVenueMode(admin, venueId);
  const bookingModel = venueMode.bookingModel;
  const unified = isUnifiedSchedulingVenue(bookingModel);

  let defaultAreaId: string | null = null;
  if (bookingModel === 'table_reservation') {
    defaultAreaId = await getDefaultAreaIdForVenue(admin, venueId);
  }

  let defaultCalendarId: string | null = null;
  let defaultServiceItemId: string | null = null;
  let defaultPractitionerId: string | null = null;
  let defaultAppointmentServiceId: string | null = null;

  if (unified) {
    const { data: cal } = await admin
      .from('unified_calendars')
      .select('id')
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .order('sort_order')
      .limit(1)
      .maybeSingle();
    defaultCalendarId = (cal as { id: string } | null)?.id ?? null;
    if (defaultCalendarId) {
      const { data: csa } = await admin
        .from('calendar_service_assignments')
        .select('service_item_id')
        .eq('calendar_id', defaultCalendarId)
        .limit(1)
        .maybeSingle();
      defaultServiceItemId = (csa as { service_item_id: string } | null)?.service_item_id ?? null;
    }
    if (!defaultServiceItemId) {
      const { data: si } = await admin
        .from('service_items')
        .select('id')
        .eq('venue_id', venueId)
        .eq('is_active', true)
        .order('sort_order')
        .limit(1)
        .maybeSingle();
      defaultServiceItemId = (si as { id: string } | null)?.id ?? null;
    }
  } else if (bookingModel === 'practitioner_appointment') {
    const { data: p } = await admin
      .from('practitioners')
      .select('id')
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .order('sort_order')
      .limit(1)
      .maybeSingle();
    const { data: s } = await admin
      .from('appointment_services')
      .select('id')
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .order('sort_order')
      .limit(1)
      .maybeSingle();
    defaultPractitionerId = (p as { id: string } | null)?.id ?? null;
    defaultAppointmentServiceId = (s as { id: string } | null)?.id ?? null;
  }

  return {
    bookingModel,
    unified,
    defaultAreaId,
    defaultCalendarId,
    defaultServiceItemId,
    defaultPractitionerId,
    defaultAppointmentServiceId,
  };
}

export type BookingDefaultsBlockingIssue = {
  bookingModel: BookingModel;
  message: string;
};

/**
 * Translates booking-model-specific gaps in the resolved defaults into a single
 * blocking validation message. Returns null when the venue is sufficiently
 * configured for the booking model to import bookings.
 */
export function evaluateBookingDefaultsForImport(
  defaults: BookingImportDefaults,
): BookingDefaultsBlockingIssue | null {
  const { bookingModel } = defaults;
  if (bookingModel === 'table_reservation') {
    if (!defaults.defaultAreaId) {
      return {
        bookingModel,
        message:
          'No default seating area is configured for this venue. Add an area in Settings before importing bookings.',
      };
    }
    return null;
  }
  if (defaults.unified) {
    if (!defaults.defaultCalendarId) {
      return {
        bookingModel,
        message:
          'No active unified calendar is configured. Activate a calendar in Settings before importing bookings.',
      };
    }
    if (!defaults.defaultServiceItemId) {
      return {
        bookingModel,
        message:
          'No active service item is available for the calendar. Activate at least one service item before importing bookings.',
      };
    }
    return null;
  }
  if (bookingModel === 'practitioner_appointment') {
    if (!defaults.defaultPractitionerId) {
      return {
        bookingModel,
        message: 'No active practitioner is configured. Activate one before importing bookings.',
      };
    }
    if (!defaults.defaultAppointmentServiceId) {
      return {
        bookingModel,
        message:
          'No active appointment service is configured. Activate one before importing bookings.',
      };
    }
    return null;
  }
  if (
    bookingModel === 'event_ticket' ||
    bookingModel === 'class_session' ||
    bookingModel === 'resource_booking'
  ) {
    return {
      bookingModel,
      message:
        'Bookings can only be imported for restaurant, salon, or unified-scheduling venues. This venue uses a model that requires per-row resolution that the importer does not yet support.',
    };
  }
  return null;
}
