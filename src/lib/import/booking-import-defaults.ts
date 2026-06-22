import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveVenueMode } from '@/lib/venue-mode';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import { isCdeBookingModel } from '@/lib/booking/cde-booking';
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
  /**
   * Pre-flight catalogue size for C/D/E venues: number of mappable catalogue entries
   * (event sessions / class types / resource calendars). `null` for non-CDE models. `0` means
   * the references step would have nothing to map to, so CDE rows would skip at execute time.
   */
  cdeCatalogueCount: number | null;
}

/** Per-CDE-model catalogue wording for the empty-catalogue pre-flight message. */
const CDE_CATALOGUE_LABEL: Partial<Record<BookingModel, { thing: string; where: string }>> = {
  event_ticket: { thing: 'event session', where: 'the Events manager' },
  class_session: { thing: 'class', where: 'the Class timetable' },
  resource_booking: { thing: 'bookable resource', where: 'the Resources manager' },
};

/** Counts the mappable catalogue for a CDE venue (event sessions / class types / resource calendars). */
async function countCdeCatalogue(
  admin: SupabaseClient,
  venueId: string,
  bookingModel: BookingModel,
): Promise<number> {
  if (bookingModel === 'event_ticket') {
    const { count } = await admin
      .from('event_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId)
      .eq('is_cancelled', false);
    return count ?? 0;
  }
  if (bookingModel === 'class_session') {
    const { count } = await admin
      .from('class_types')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId);
    return count ?? 0;
  }
  if (bookingModel === 'resource_booking') {
    const { count } = await admin
      .from('unified_calendars')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .eq('calendar_type', 'resource');
    return count ?? 0;
  }
  return 0;
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

  const cdeCatalogueCount = isCdeBookingModel(bookingModel)
    ? await countCdeCatalogue(admin, venueId, bookingModel)
    : null;

  return {
    bookingModel,
    unified,
    defaultAreaId,
    defaultCalendarId,
    defaultServiceItemId,
    defaultPractitionerId,
    defaultAppointmentServiceId,
    cdeCatalogueCount,
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
  if (isCdeBookingModel(bookingModel)) {
    // CDE rows resolve per-row against the catalogue on the references step. If the catalogue is
    // empty there is nothing to map to, so every CDE row would silently skip at execute time —
    // surface that up-front as a blocking pre-flight error instead.
    if (defaults.cdeCatalogueCount != null && defaults.cdeCatalogueCount === 0) {
      const label = CDE_CATALOGUE_LABEL[bookingModel];
      const thing = label?.thing ?? 'catalogue entry';
      const where = label?.where ?? 'the relevant manager';
      return {
        bookingModel,
        message: `No ${thing} exists yet for this venue, so imported bookings would have nothing to attach to and would be skipped. Add at least one ${thing} in ${where} before importing.`,
      };
    }
    return null;
  }
  return null;
}
