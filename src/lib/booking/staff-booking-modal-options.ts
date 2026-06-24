import type { BookingModel, VenueTerminology } from '@/types/booking-models';
import { DEFAULT_TERMINOLOGY } from '@/types/booking-models';
import { venueExposesBookingModel } from '@/lib/booking/enabled-models';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';

/** Stable id for staff booking surfaces (appointment uses unified_scheduling even when primary is practitioner_appointment). */
export type StaffBookingSurfaceTabId =
  | 'table_reservation'
  | 'unified_scheduling'
  | 'class_session'
  | 'event_ticket'
  | 'resource_booking';

export interface StaffBookingSurfaceTab {
  id: StaffBookingSurfaceTabId;
  label: string;
}

const SURFACE_TAB_ORDER: StaffBookingSurfaceTabId[] = [
  'table_reservation',
  'unified_scheduling',
  'class_session',
  'event_ticket',
  'resource_booking',
];

/** Fallback labels (no venue terminology). Kept singular for back-compat with existing callers. */
const SURFACE_LABEL: Record<StaffBookingSurfaceTabId, string> = {
  table_reservation: 'Table',
  unified_scheduling: 'Appointment',
  class_session: 'Class',
  event_ticket: 'Event',
  resource_booking: 'Resource',
};

/** Surface id → booking model, so labels can reuse the model-level terminology. */
const SURFACE_TAB_BOOKING_MODEL: Record<StaffBookingSurfaceTabId, BookingModel> = {
  table_reservation: 'table_reservation',
  unified_scheduling: 'unified_scheduling',
  class_session: 'class_session',
  event_ticket: 'event_ticket',
  resource_booking: 'resource_booking',
};

/**
 * B1: terminology-aware label for a staff surface tab, mirroring the public booking tabs
 * ({@link publicBookTabsForVenue}). Table/Appointment follow the venue `terminology.booking`
 * override; C/D/E use the same plural storefront labels the public tabs show (Events/Classes/
 * Resources). Falls back to {@link SURFACE_LABEL} when no terminology is supplied.
 */
function surfaceTabLabel(
  id: StaffBookingSurfaceTabId,
  terminology: Partial<VenueTerminology> | null | undefined,
): string {
  const term = terminology && typeof terminology === 'object' ? terminology : undefined;
  const model = SURFACE_TAB_BOOKING_MODEL[id];
  const defaults = DEFAULT_TERMINOLOGY[model];
  switch (id) {
    case 'table_reservation': {
      const booking = term?.booking ?? defaults.booking;
      return booking === 'Reservation' ? 'Table' : booking;
    }
    case 'unified_scheduling': {
      // Do not let a table-tab "Reservation" override relabel appointments (matches public tabs).
      const booking = defaults.booking;
      return booking === 'Appointment' ? 'Appointment' : booking;
    }
    // C/D/E: use the same plural storefront labels the public tabs show (terminology-independent),
    // instead of the legacy hard-coded singular Class/Event/Resource.
    case 'event_ticket':
      return 'Events';
    case 'class_session':
      return 'Classes';
    case 'resource_booking':
      return 'Resources';
    default:
      return SURFACE_LABEL[id];
  }
}

function appointmentSurfaceExposed(primary: BookingModel, enabledModels: BookingModel[]): boolean {
  return isUnifiedSchedulingVenue(primary) || enabledModels.includes('unified_scheduling');
}

/**
 * Ordered staff surfaces (Table → Appointment → Class → Event → Resource); only includes models the venue exposes.
 * Pass `terminology` (venue `terminology` JSONB) to label tabs the way the public booking tabs do (B1).
 */
export function getStaffBookingSurfaceTabs(
  primary: BookingModel,
  enabledModels: BookingModel[],
  terminology?: Partial<VenueTerminology> | null,
): StaffBookingSurfaceTab[] {
  const out: StaffBookingSurfaceTab[] = [];

  if (primary === 'table_reservation') {
    out.push({ id: 'table_reservation', label: surfaceTabLabel('table_reservation', terminology) });
  }

  if (appointmentSurfaceExposed(primary, enabledModels)) {
    out.push({ id: 'unified_scheduling', label: surfaceTabLabel('unified_scheduling', terminology) });
  }

  for (const id of ['class_session', 'event_ticket', 'resource_booking'] as const) {
    if (venueExposesBookingModel(primary, enabledModels, id)) {
      out.push({ id, label: surfaceTabLabel(id, terminology) });
    }
  }

  // Enforce product order (ids are appended in order above; guard if logic changes)
  out.sort((a, b) => SURFACE_TAB_ORDER.indexOf(a.id) - SURFACE_TAB_ORDER.indexOf(b.id));
  return out;
}

/**
 * Default tab = primary model mapped to surface id (appointment → unified_scheduling).
 */
export function defaultStaffBookingSurfaceTab(
  primary: BookingModel,
  enabledModels: BookingModel[],
): StaffBookingSurfaceTabId {
  const tabs = getStaffBookingSurfaceTabs(primary, enabledModels);
  if (tabs.length === 0) {
    return 'table_reservation';
  }

  let desired: StaffBookingSurfaceTabId;
  if (primary === 'table_reservation') {
    desired = 'table_reservation';
  } else if (isUnifiedSchedulingVenue(primary)) {
    desired = 'unified_scheduling';
  } else if (primary === 'class_session') {
    desired = 'class_session';
  } else if (primary === 'event_ticket') {
    desired = 'event_ticket';
  } else if (primary === 'resource_booking') {
    desired = 'resource_booking';
  } else {
    desired = tabs[0].id;
  }

  if (tabs.some((t) => t.id === desired)) {
    return desired;
  }
  return tabs[0].id;
}

/** Short query param for `?tab=` on /dashboard/bookings/new */
export function staffBookingSurfaceTabIdToQueryParam(id: StaffBookingSurfaceTabId): string {
  const m: Record<StaffBookingSurfaceTabId, string> = {
    table_reservation: 'table',
    unified_scheduling: 'appointment',
    class_session: 'class',
    event_ticket: 'event',
    resource_booking: 'resource',
  };
  return m[id];
}

/**
 * Resolve `?tab=` value to a surface id if it is exposed for this venue.
 */
export function parseStaffBookingSurfaceTabIdFromQuery(
  raw: string | null | undefined,
  tabs: StaffBookingSurfaceTab[],
): StaffBookingSurfaceTabId | null {
  if (!raw || tabs.length === 0) return null;
  const t = raw.trim().toLowerCase();
  const aliases: Record<string, StaffBookingSurfaceTabId> = {
    table: 'table_reservation',
    appointment: 'unified_scheduling',
    class: 'class_session',
    event: 'event_ticket',
    resource: 'resource_booking',
    table_reservation: 'table_reservation',
    unified_scheduling: 'unified_scheduling',
    practitioner_appointment: 'unified_scheduling',
    class_session: 'class_session',
    event_ticket: 'event_ticket',
    resource_booking: 'resource_booking',
  };
  const id = aliases[t];
  if (!id || !tabs.some((tab) => tab.id === id)) return null;
  return id;
}

export type StaffBookingExtraTab = 'none' | 'event' | 'class' | 'resource';

export interface StaffBookingSecondaryOption {
  value: Exclude<StaffBookingExtraTab, 'none'>;
  label: string;
}

/**
 * Secondary booking types (events / classes / resources) when the venue primary is something else.
 * Matches {@link NewBookingPageClient} / public booking tab ordering.
 */
export function staffSecondaryBookingOptions(
  bookingModel: BookingModel,
  enabledModels: BookingModel[],
): StaffBookingSecondaryOption[] {
  const canStaffEventBooking = bookingModel === 'event_ticket' || enabledModels.includes('event_ticket');
  const canStaffClassBooking = bookingModel === 'class_session' || enabledModels.includes('class_session');
  const canStaffResourceBooking = bookingModel === 'resource_booking' || enabledModels.includes('resource_booking');

  const opts: StaffBookingSecondaryOption[] = [];
  if (canStaffEventBooking && bookingModel !== 'event_ticket') {
    opts.push({ value: 'event', label: 'Event tickets' });
  }
  if (canStaffClassBooking && bookingModel !== 'class_session') {
    opts.push({ value: 'class', label: 'Classes' });
  }
  if (canStaffResourceBooking && bookingModel !== 'resource_booking') {
    opts.push({ value: 'resource', label: 'Resources' });
  }
  return opts;
}

/** Label for the primary (native) booking type in staff selectors. */
export function primaryStaffBookingLabel(bookingModel: BookingModel): string {
  if (isUnifiedSchedulingVenue(bookingModel)) return 'Appointment';
  if (bookingModel === 'class_session') return 'Classes';
  if (bookingModel === 'resource_booking') return 'Resources';
  if (bookingModel === 'event_ticket') return 'Event tickets';
  return 'Table reservation';
}

export function isAppointmentPrimaryBooking(bookingModel: BookingModel): boolean {
  return isUnifiedSchedulingVenue(bookingModel);
}
