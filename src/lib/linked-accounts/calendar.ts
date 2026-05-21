/** Shared types for the cross-venue linked-calendar view (§8.2). */

import type { LinkGrant } from './types';

/**
 * Map a booking row onto a calendar column id — mirrors native
 * `resolveBookingColumnId` (practitioner_id first, then calendar_id).
 * When both ids are present, prefer whichever belongs to a known column.
 */
export function resolveLinkedBookingColumnId(
  row: {
    practitioner_id?: string | null;
    calendar_id?: string | null;
  },
  columnIds?: ReadonlySet<string>,
): string | null {
  const practitionerId =
    typeof row.practitioner_id === 'string' && row.practitioner_id.trim() !== ''
      ? row.practitioner_id
      : null;
  const calendarId =
    typeof row.calendar_id === 'string' && row.calendar_id.trim() !== ''
      ? row.calendar_id
      : null;

  if (columnIds && columnIds.size > 0) {
    if (calendarId && columnIds.has(calendarId)) return calendarId;
    if (practitionerId && columnIds.has(practitionerId)) return practitionerId;
  }

  return practitionerId ?? calendarId ?? null;
}

export interface LinkedPractitioner {
  id: string;
  name: string;
  isActive: boolean;
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
}

export interface LinkedService {
  id: string;
  name: string;
  durationMinutes?: number;
  bufferMinutes?: number;
  processingTimeBlocks?: import('@/types/booking-models').ProcessingTimeBlock[];
  colour?: string;
  pricePence?: number | null;
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
    source: lb.source ?? null,
    _linkedOwnerVenueId: venueId,
    _linkedColumnKey: columnKey,
  };
}

export function linkedBookingBarDetailLabel(
  booking: Pick<LinkedBooking, 'guestName' | 'serviceName'>,
  visibility: LinkedVenueCalendar['visibility'],
  venueName: string,
): string {
  if (visibility === 'time_only') return `${venueName} — busy`;
  const service = booking.serviceName?.trim();
  if (service) return service;
  return booking.guestName?.trim() || 'Booking';
}

export interface LinkedVenueCalendar {
  venueId: string;
  venueName: string;
  linkId: string;
  /** Calendar visibility into this venue: 'time_only' | 'full_details'. */
  visibility: LinkGrant['calendar'];
  /** Action level the viewer holds over this venue's bookings. */
  action: LinkGrant['act'];
  practitioners: LinkedPractitioner[];
  /** This venue's services — populated only for full_details viewers. */
  services: LinkedService[];
  bookings: LinkedBooking[];
}
