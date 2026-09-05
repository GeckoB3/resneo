/** Shared types for the cross-venue linked-calendar view (§8.2). */

import type { LinkActionLevel, LinkGrant } from './types';
import type { WorkingHours } from '@/types/booking-models';
import type { ScheduleBlockDTO } from '@/types/schedule-blocks';

/**
 * Map a booking row onto a calendar column id — mirrors native
 * `resolveBookingColumnId` (resource host column, then practitioner/calendar).
 * When both ids are present, prefer whichever belongs to a known column.
 */
export function resolveLinkedBookingColumnId(
  row: {
    practitioner_id?: string | null;
    calendar_id?: string | null;
    resource_id?: string | null;
    experience_event_id?: string | null;
    class_instance_id?: string | null;
  },
  columnIds?: ReadonlySet<string>,
  resourceParentById?: ReadonlyMap<string, string>,
  cdeColumnHints?: {
    eventCalendarId?: string | null;
    classCalendarId?: string | null;
  },
): string | null {
  const practitionerId =
    typeof row.practitioner_id === 'string' && row.practitioner_id.trim() !== ''
      ? row.practitioner_id
      : null;
  const calendarId =
    typeof row.calendar_id === 'string' && row.calendar_id.trim() !== ''
      ? row.calendar_id
      : null;
  const resourceId =
    typeof row.resource_id === 'string' && row.resource_id.trim() !== ''
      ? row.resource_id
      : null;

  if (resourceParentById && resourceParentById.size > 0) {
    if (resourceId && resourceParentById.has(resourceId)) {
      return resourceParentById.get(resourceId)!;
    }
    if (calendarId && resourceParentById.has(calendarId)) {
      return resourceParentById.get(calendarId)!;
    }
  }

  const eventCal = cdeColumnHints?.eventCalendarId ?? null;
  const classCal = cdeColumnHints?.classCalendarId ?? null;

  if (columnIds && columnIds.size > 0) {
    if (eventCal && columnIds.has(eventCal)) return eventCal;
    if (classCal && columnIds.has(classCal)) return classCal;
    if (calendarId && columnIds.has(calendarId)) return calendarId;
    if (practitionerId && columnIds.has(practitionerId)) return practitionerId;
  }

  return eventCal ?? classCal ?? practitionerId ?? calendarId ?? null;
}

export interface LinkedPractitioner {
  id: string;
  name: string;
  isActive: boolean;
  /** Per-day template from the owner venue's calendar availability settings. */
  workingHours?: WorkingHours;
}

export interface LinkedBooking {
  id: string;
  practitionerId: string | null;
  bookingDate: string;
  bookingTime: string;
  bookingEndTime: string | null;
  status: string;
  /** Present only when the viewer has full_details access. */
  guestName: string | null;
  serviceName: string | null;
  /** True when the viewer's grant allows editing this booking. */
  editable: boolean;
  /** Grid fields — populated for full_details viewers (native day-grid parity). */
  partySize?: number;
  bookingModel?: string | null;
  source?: string | null;
  depositStatus?: string;
  depositAmountPence?: number | null;
  specialRequests?: string | null;
  internalNotes?: string | null;
  clientArrivedAt?: string | null;
  guestAttendanceConfirmedAt?: string | null;
  staffAttendanceConfirmedAt?: string | null;
  estimatedEndTime?: string | null;
  guestId?: string | null;
  guestEmail?: string | null;
  guestPhone?: string | null;
  appointmentServiceId?: string | null;
  serviceItemId?: string | null;
  serviceVariantId?: string | null;
  processingTimeBlocks?: unknown | null;
  resourceId?: string | null;
  calendarId?: string | null;
  practitionerIdRaw?: string | null;
  experienceEventId?: string | null;
  classInstanceId?: string | null;
  eventSessionId?: string | null;
}

export interface LinkedService {
  id: string;
  name: string;
  /**
   * False once the owner venue has archived the service. The list keeps
   * archived services so an existing booking still has a duration and
   * processing pattern to paint; a picker for a NEW booking must filter on it.
   */
  isActive: boolean;
  durationMinutes?: number;
  bufferMinutes?: number;
  processingTimeBlocks?: import('@/types/booking-models').ProcessingTimeBlock[];
  colour?: string;
  pricePence?: number | null;
  /**
   * Variants, for the processing pattern a variant booking paints when it has
   * no stored snapshot. The native grid resolves the same way.
   */
  variants?: {
    id: string;
    name: string;
    processingTimeBlocks?: import('@/types/booking-models').ProcessingTimeBlock[];
  }[];
}

/** Bookable resource assigned to a staff calendar column (for free-slot indicators). */
export interface LinkedResource {
  id: string;
  name: string;
  displayOnCalendarId: string;
  minBookingMinutes: number;
  maxBookingMinutes: number;
  slotIntervalMinutes: number;
  isActive: boolean;
  availabilityHours: WorkingHours;
  availabilityExceptions?: import('@/types/booking-models').VenueResource['availability_exceptions'];
}

/** Full-details linked venues with edit grants use the native interactive day grid. */
export function linkedColumnUsesNativeGrid(
  col: Pick<LinkedVenueCalendar, 'visibility' | 'action'>,
): boolean {
  return (
    col.visibility === 'full_details' &&
    (col.action === 'edit_existing' || col.action === 'create_edit_cancel')
  );
}

export function linkedColumnKey(venueId: string, practitionerId: string): string {
  return `linked:${venueId}:${practitionerId}`;
}

/** Resolve a namespaced linked column key to the real calendar/practitioner id for PATCH. */
export function resolveLinkedGridPractitionerIdForPatch(pracId: string): string {
  if (!pracId.startsWith('linked:')) return pracId;
  const parts = pracId.split(':');
  if (parts.length >= 3) return parts.slice(2).join(':');
  return pracId;
}

/** Map a linked booking row into the staff calendar `Booking` shape. */
export function linkedBookingToGridBooking(
  lb: LinkedBooking,
  venueId: string,
  columnKey: string,
): {
  id: string;
  booking_date: string;
  booking_time: string;
  booking_end_time: string | null;
  party_size: number;
  status: string;
  practitioner_id: string | null;
  calendar_id: string | null;
  appointment_service_id: string | null;
  service_item_id: string | null;
  service_variant_id?: string | null;
  processing_time_blocks?: unknown | null;
  guest_id?: string;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  guest_visit_count: number | null;
  booking_item_name?: string | null;
  estimated_end_time: string | null;
  special_requests: string | null;
  internal_notes: string | null;
  client_arrived_at: string | null;
  guest_attendance_confirmed_at?: string | null;
  staff_attendance_confirmed_at?: string | null;
  deposit_amount_pence: number | null;
  deposit_status: string;
  resource_id?: string | null;
  booking_model?: string | null;
  experience_event_id?: string | null;
  class_instance_id?: string | null;
  event_session_id?: string | null;
  source?: string | null;
  _linkedOwnerVenueId: string;
  _linkedColumnKey: string;
} {
  const timeRaw = lb.bookingTime.trim();
  const bookingTime =
    timeRaw.length >= 8 ? timeRaw : `${timeRaw.slice(0, 5)}:00`;
  const endRaw = lb.bookingEndTime?.trim() ?? '';
  const bookingEnd =
    endRaw.length === 0
      ? null
      : endRaw.length >= 8
        ? endRaw
        : `${endRaw.slice(0, 5)}:00`;

  return {
    id: lb.id,
    booking_date: lb.bookingDate,
    booking_time: bookingTime,
    booking_end_time: bookingEnd,
    party_size: lb.partySize ?? 1,
    status: lb.status,
    practitioner_id: lb.practitionerIdRaw ?? lb.practitionerId,
    calendar_id: lb.calendarId ?? lb.practitionerId,
    appointment_service_id: lb.appointmentServiceId ?? null,
    service_item_id: lb.serviceItemId ?? null,
    service_variant_id: lb.serviceVariantId ?? null,
    processing_time_blocks: lb.processingTimeBlocks ?? null,
    guest_id: lb.guestId ?? undefined,
    guest_name: lb.guestName ?? 'Guest',
    guest_email: lb.guestEmail ?? null,
    guest_phone: lb.guestPhone ?? null,
    guest_visit_count: null,
    booking_item_name: lb.serviceName ?? null,
    estimated_end_time: lb.estimatedEndTime ?? null,
    special_requests: lb.specialRequests ?? null,
    internal_notes: lb.internalNotes ?? null,
    client_arrived_at: lb.clientArrivedAt ?? null,
    guest_attendance_confirmed_at: lb.guestAttendanceConfirmedAt ?? null,
    staff_attendance_confirmed_at: lb.staffAttendanceConfirmedAt ?? null,
    deposit_amount_pence: lb.depositAmountPence ?? null,
    deposit_status: lb.depositStatus ?? 'none',
    resource_id: lb.resourceId ?? null,
    booking_model: lb.bookingModel ?? null,
    experience_event_id: lb.experienceEventId ?? null,
    class_instance_id: lb.classInstanceId ?? null,
    event_session_id: lb.eventSessionId ?? null,
    source: lb.source ?? null,
    _linkedOwnerVenueId: venueId,
    _linkedColumnKey: columnKey,
  };
}

/** Schedule blocks (events/classes) for one linked calendar column on a given day. */
export function linkedVenueScheduleBlocksForColumn(
  scheduleBlocks: ScheduleBlockDTO[] | undefined,
  practitionerId: string,
  dayDate: string,
): { classBlocks: ScheduleBlockDTO[]; eventBlocks: ScheduleBlockDTO[] } {
  const blocks = scheduleBlocks ?? [];
  const classBlocks = blocks.filter(
    (b) =>
      b.kind === 'class_session' &&
      b.status !== 'Cancelled' &&
      b.calendar_id === practitionerId &&
      b.date === dayDate,
  );
  const eventBlocks = blocks.filter(
    (b) =>
      b.kind === 'event_ticket' &&
      b.status !== 'Cancelled' &&
      b.calendar_id === practitionerId &&
      b.date === dayDate,
  );
  return { classBlocks, eventBlocks };
}

export function linkedBookingBarDetailLabel(
  booking: Pick<LinkedBooking, 'guestName' | 'serviceName'>,
  visibility: LinkedVenueCalendar['visibility'],
  venueName: string,
): string {
  if (visibility === 'time_only') return `${venueName}: busy`;
  const guest = booking.guestName?.trim();
  if (guest) return guest;
  const service = booking.serviceName?.trim();
  if (service) return service;
  return 'Booking';
}

/** Viewer grant level for bookings owned by a linked venue (calendar detail / ExpandedBookingContent). */
export function linkedGrantActForOwnerVenue(
  linkedVenues: readonly Pick<LinkedVenueCalendar, 'venueId' | 'action'>[],
  ownerVenueId: string,
): LinkActionLevel {
  return linkedVenues.find((v) => v.venueId === ownerVenueId)?.action ?? 'none';
}

export interface LinkedVenueCalendar {
  venueId: string;
  venueName: string;
  /** Owner venue IANA timezone — used for guest-history upcoming/previous splits. */
  venueTimezone?: string;
  linkId: string;
  /** Calendar visibility into this venue: 'time_only' | 'full_details'. */
  visibility: LinkGrant['calendar'];
  /** Action level the viewer holds over this venue's bookings. */
  action: LinkGrant['act'];
  /** Whether the viewer may see guest email/phone from the owner venue. */
  pii: boolean;
  practitioners: LinkedPractitioner[];
  /** This venue's services — populated only for full_details viewers. */
  services: LinkedService[];
  /** Resources on staff columns — used to show labelled free resource slots. */
  resources: LinkedResource[];
  bookings: LinkedBooking[];
  /** Event/class occurrence shells — full_details links only. */
  scheduleBlocks?: ScheduleBlockDTO[];
}
