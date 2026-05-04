import type { BookingModel } from '@/types/booking-models';
import { BOOKING_MODEL_ORDER } from '@/lib/booking/enabled-models';

const VALID_BOOKING_MODEL = new Set<string>(BOOKING_MODEL_ORDER);

function bookingModelFromStoredColumn(raw: unknown): BookingModel | null {
  if (raw == null || raw === '') return null;
  const s = typeof raw === 'string' ? raw : String(raw);
  return VALID_BOOKING_MODEL.has(s) ? (s as BookingModel) : null;
}

/**
 * Infer booking model for staff UI and filters.
 * Prefer persisted `bookings.booking_model` (authoritative for inserts); fall back to FK inference for legacy rows.
 */
export function inferBookingRowModel(row: {
  booking_model?: string | null;
  experience_event_id?: string | null;
  class_instance_id?: string | null;
  resource_id?: string | null;
  event_session_id?: string | null;
  calendar_id?: string | null;
  service_item_id?: string | null;
  practitioner_id?: string | null;
  appointment_service_id?: string | null;
}): BookingModel {
  const fromDb = bookingModelFromStoredColumn(row.booking_model);
  if (fromDb != null) return fromDb;

  if (row.experience_event_id) return 'event_ticket';
  if (row.class_instance_id) return 'class_session';
  if (row.resource_id) return 'resource_booking';
  if (row.event_session_id) return 'unified_scheduling';
  if (row.calendar_id && row.service_item_id) return 'unified_scheduling';
  if (row.practitioner_id && row.appointment_service_id) return 'practitioner_appointment';
  return 'table_reservation';
}

const SHORT: Record<BookingModel, string> = {
  table_reservation: 'Table',
  practitioner_appointment: 'Appointment',
  unified_scheduling: 'Appointment',
  event_ticket: 'Event',
  class_session: 'Class',
  resource_booking: 'Resource',
};

export function bookingModelShortLabel(model: BookingModel): string {
  return SHORT[model] ?? model;
}

/** True for plain table reservations; false for appointments, classes, events, and resource bookings (use Start / Undo Start instead of Seat / Unseat). */
export function isTableReservationBooking(row: {
  booking_model?: string | null;
  experience_event_id?: string | null;
  class_instance_id?: string | null;
  resource_id?: string | null;
  event_session_id?: string | null;
  calendar_id?: string | null;
  service_item_id?: string | null;
  practitioner_id?: string | null;
  appointment_service_id?: string | null;
}): boolean {
  return inferBookingRowModel(row) === 'table_reservation';
}

/**
 * Staff-facing label for the `Seated` booking status: dining uses "Seated"; appointments,
 * classes, events, and resources use "Started" (same underlying status value).
 */
export function bookingSeatedStatusDisplayLabel(isTableReservation: boolean): 'Seated' | 'Started' {
  return isTableReservation ? 'Seated' : 'Started';
}

/** Display string for any status; rewrites `Seated` using {@link bookingSeatedStatusDisplayLabel}. */
export function bookingStatusDisplayLabel(status: string, isTableReservation: boolean): string {
  if (status === 'Seated') {
    return bookingSeatedStatusDisplayLabel(isTableReservation);
  }
  return status;
}
