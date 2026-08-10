import type { BookingRow } from '@/app/dashboard/bookings/ExpandedBookingContent';
import type { RegistryAppointment } from '@/components/booking/AppointmentRegistryCard';
import { inferBookingRowModel } from '@/lib/booking/infer-booking-row-model';

function inferRegistryModel(b: RegistryAppointment) {
  return inferBookingRowModel({
    booking_model: b.booking_model,
    experience_event_id: b.experience_event_id,
    class_instance_id: b.class_instance_id,
    resource_id: b.resource_id,
    event_session_id: b.event_session_id,
    calendar_id: b.calendar_id,
    service_item_id: b.service_item_id,
    practitioner_id: b.practitioner_id,
    appointment_service_id: b.appointment_service_id,
  });
}

/** Maps appointment registry list rows into {@link ExpandedBookingContent} props. */
export function registryAppointmentToExpandedBookingRow(b: RegistryAppointment): BookingRow {
  return {
    id: b.id,
    booking_date: b.booking_date,
    booking_time: b.booking_time,
    // `booking_end_time` (venue-local wall clock) wins when the row has it, as
    // everywhere else. When it is NULL — every guest-created appointment, since
    // only resource bookings post an end time — keep the row's real
    // `estimated_end_time` instead of dropping it. Dropping both left the
    // expanded panel with no end time and, worse, made the Modify form fall back
    // to a 30-minute default: long appointments silently shrank on save, and one
    // with processing time was rejected outright ("Processing blocks must lie
    // within the service duration").
    estimated_end_time: b.booking_end_time
      ? `${b.booking_date}T${b.booking_end_time.slice(0, 5)}:00.000Z`
      : b.estimated_end_time ?? null,
    created_at: null,
    party_size: b.party_size,
    status: b.status,
    source: b.source,
    deposit_status: b.deposit_status,
    deposit_amount_pence: b.deposit_amount_pence,
    dietary_notes: null,
    occasion: null,
    guest_name: b.guest_name,
    guest_email: b.guest_email,
    guest_phone: b.guest_phone,
    guest_id: b.guest_id,
    client_arrived_at: b.client_arrived_at,
    guest_attendance_confirmed_at: b.guest_attendance_confirmed_at ?? null,
    staff_attendance_confirmed_at: b.staff_attendance_confirmed_at ?? null,
    practitioner_id: b.practitioner_id,
    calendar_id: b.calendar_id,
    appointment_service_id: b.appointment_service_id,
    experience_event_id: b.experience_event_id,
    class_instance_id: b.class_instance_id,
    resource_id: b.resource_id,
    event_session_id: b.event_session_id,
    service_item_id: b.service_item_id,
    booking_end_time: b.booking_end_time,
    service_variant_id: b.service_variant_id ?? null,
    processing_time_blocks: b.processing_time_blocks ?? null,
    inferred_booking_model: inferRegistryModel(b),
    booking_model: b.booking_model,
    group_booking_id: b.group_booking_id ?? null,
    person_label: b.person_label ?? null,
    booking_item_name: b.booking_item_name ?? null,
    service_variant_name: b.service_variant_name ?? null,
    booking_addon_labels: b.booking_addon_labels ?? undefined,
    location_type: b.location_type ?? null,
    client_address_line1: b.client_address_line1 ?? null,
    client_address_line2: b.client_address_line2 ?? null,
    client_address_city: b.client_address_city ?? null,
    client_address_postcode: b.client_address_postcode ?? null,
  };
}
