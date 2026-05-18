import type { BookingDetailLite } from '@/app/dashboard/bookings/ExpandedBookingContent';
import type { BookingDetailPanelSnapshot } from '@/app/dashboard/bookings/booking-detail-panel-snapshot';
import { guestStubFromBookingRow } from '@/lib/booking/booking-row-guest-stub';
import { inferBookingRowModel } from '@/lib/booking/infer-booking-row-model';
import type { BookingModel } from '@/types/booking-models';

/** Fields available on bookings list / calendar bar rows for instant detail UI. */
export interface BookingListRowSeed {
  id: string;
  booking_date: string;
  booking_time: string;
  estimated_end_time?: string | null;
  booking_end_time?: string | null;
  party_size: number;
  status: string;
  source?: string | null;
  guest_id?: string;
  guest_name?: string;
  guest_first_name?: string | null;
  guest_last_name?: string | null;
  guest_email?: string | null;
  guest_phone?: string | null;
  guest_visit_count?: number | null;
  dietary_notes?: string | null;
  occasion?: string | null;
  special_requests?: string | null;
  internal_notes?: string | null;
  deposit_status?: string;
  table_assignments?: Array<{ id: string; name: string }>;
  booking_item_name?: string | null;
  service_name?: string | null;
  booking_model?: string | null;
  inferred_booking_model?: BookingModel;
  experience_event_id?: string | null;
  class_instance_id?: string | null;
  resource_id?: string | null;
  event_session_id?: string | null;
  calendar_id?: string | null;
  service_item_id?: string | null;
  practitioner_id?: string | null;
  appointment_service_id?: string | null;
}

/** Wall-clock end HH:mm; prefers `booking_end_time`, then ISO `estimated_end_time`. */
export function bookingDisplayEndHm(
  row: Pick<BookingListRowSeed, 'booking_time' | 'booking_end_time' | 'estimated_end_time'>,
): string | null {
  const wallEnd = row.booking_end_time?.trim()
    ? row.booking_end_time.slice(0, 5)
    : row.estimated_end_time
      ? new Date(row.estimated_end_time).toISOString().slice(11, 16)
      : '';
  return /^\d{2}:\d{2}$/.test(wallEnd) ? wallEnd : null;
}

function endTimeFromRow(row: BookingListRowSeed): string {
  return bookingDisplayEndHm(row) ?? row.booking_time.slice(0, 5);
}

/** ISO end time for optimistic UI (matches calendar popover placeholder shape). */
export function estimatedEndIsoFromSchedule(
  bookingDate: string,
  startHm: string,
  endHm: string,
): string {
  const startTime = startHm.slice(0, 5);
  const endTimeRaw = endHm.trim() ? endHm.slice(0, 5) : '';
  const endTime = /^\d{2}:\d{2}$/.test(endTimeRaw) ? endTimeRaw : startTime;
  return `${bookingDate}T${endTime}:00.000Z`;
}

function guestDisplayName(row: BookingListRowSeed): string {
  const first = row.guest_first_name?.trim() ?? '';
  const last = row.guest_last_name?.trim() ?? '';
  if (first || last) return `${first} ${last}`.trim();
  return row.guest_name?.trim() || 'Guest';
}

/** Synchronous expanded-row detail from list data — avoids placeholder flash before GET. */
export function bookingDetailLiteFromListRow(row: BookingListRowSeed): BookingDetailLite {
  const inferred = row.inferred_booking_model ?? inferBookingRowModel(row);
  const serviceLabel =
    (typeof row.booking_item_name === 'string' && row.booking_item_name.trim()) ||
    (typeof row.service_name === 'string' && row.service_name.trim()) ||
    null;
  const guest = guestStubFromBookingRow({
    guest_id: row.guest_id,
    guest_first_name: row.guest_first_name,
    guest_last_name: row.guest_last_name,
    guest_email: row.guest_email,
    guest_phone: row.guest_phone,
    guest_name: row.guest_name,
    guest_visit_count: row.guest_visit_count,
  });

  return {
    id: row.id,
    special_requests: row.special_requests ?? null,
    internal_notes: row.internal_notes ?? null,
    cancellation_deadline: null,
    table_assignments: row.table_assignments,
    guest,
    communications: [],
    events: [],
    inferred_booking_model: inferred,
    cde_context:
      serviceLabel && inferred !== 'table_reservation'
        ? {
            inferred_model: inferred,
            title: serviceLabel,
            subtitle: null,
          }
        : null,
  };
}

/** Snapshot for calendar popover / floor plan before GET completes. */
export function bookingDetailPanelSnapshotFromListRow(row: BookingListRowSeed): BookingDetailPanelSnapshot {
  const inferred = row.inferred_booking_model ?? inferBookingRowModel(row);
  const serviceLabel =
    (typeof row.booking_item_name === 'string' && row.booking_item_name.trim()) ||
    (typeof row.service_name === 'string' && row.service_name.trim()) ||
    null;
  return {
    bookingDate: row.booking_date,
    guestName: guestDisplayName(row),
    partySize: row.party_size,
    status: row.status,
    startTime: row.booking_time.slice(0, 5),
    endTime: endTimeFromRow(row),
    dietaryNotes: row.dietary_notes ?? null,
    occasion: row.occasion ?? null,
    specialRequests: row.special_requests ?? null,
    depositStatus: row.deposit_status ?? null,
    serviceName: serviceLabel,
    tableNames: row.table_assignments?.map((t) => t.name),
    inferredBookingModel: inferred,
    guestId: row.guest_id ?? null,
    guestEmail: row.guest_email ?? null,
    guestPhone: row.guest_phone ?? null,
    guestVisitCount: row.guest_visit_count ?? null,
    source: row.source ?? null,
    practitionerId: row.practitioner_id ?? null,
    appointmentServiceId: row.appointment_service_id ?? null,
    serviceItemId: row.service_item_id ?? null,
    calendarId: row.calendar_id ?? null,
  };
}
