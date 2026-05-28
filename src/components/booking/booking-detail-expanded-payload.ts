import type { BookingDetail } from '@/app/dashboard/bookings/booking-detail-panel-model';
import {
  displayBookingGuestName,
  guestFirstLastForBookingRow,
} from '@/app/dashboard/bookings/booking-detail-panel-model';
import type { BookingDetailPanelSnapshot } from '@/app/dashboard/bookings/booking-detail-panel-snapshot';

export function buildBookingForExpanded(
  d: BookingDetail,
  opts: {
    initialSnapshot?: BookingDetailPanelSnapshot | null;
    serviceLine: string | null;
    isHydrated: boolean;
    assignedTables: Array<{ id: string; name: string }>;
  },
) {
  return {
    id: d.id,
    booking_date: d.booking_date,
    booking_time: d.booking_time,
    estimated_end_time: d.estimated_end_time,
    created_at: d.created_at ?? null,
    party_size: d.party_size,
    status: d.status,
    source: d.source,
    deposit_status: d.deposit_status,
    deposit_amount_pence: d.deposit_amount_pence,
    dietary_notes: d.dietary_notes,
    occasion: d.occasion,
    guest_name: displayBookingGuestName(d.guest, opts.initialSnapshot?.guestName),
    ...guestFirstLastForBookingRow(d.guest ?? null, opts.initialSnapshot?.guestName),
    guest_email: d.guest?.email ?? null,
    guest_phone: d.guest?.phone ?? null,
    guest_id: d.guest?.id,
    table_assignments: opts.isHydrated ? opts.assignedTables : (d.table_assignments ?? []),
    service_id: d.service_id,
    service_name: opts.serviceLine,
    area_id: d.area_id,
    area_name: d.area_name,
    guest_attendance_confirmed_at: d.guest_attendance_confirmed_at,
    staff_attendance_confirmed_at: d.staff_attendance_confirmed_at,
    client_arrived_at: d.client_arrived_at ?? null,
    inferred_booking_model: d.inferred_booking_model,
    booking_model: d.booking_model,
    practitioner_id: d.practitioner_id,
    calendar_id: d.calendar_id,
    appointment_service_id: d.appointment_service_id,
    service_item_id: d.service_item_id,
    booking_end_time: d.booking_end_time ?? null,
    service_variant_id: d.service_variant_id ?? null,
    processing_time_blocks: d.processing_time_blocks ?? null,
    experience_event_id: d.experience_event_id,
    class_instance_id: d.class_instance_id,
    resource_id: d.resource_id,
    event_session_id: d.event_session_id,
    cde_context: d.cde_context,
    service_variant_name: d.service_variant_name,
  };
}

export function buildDetailForExpanded(
  d: BookingDetail,
  opts: { isHydrated: boolean; assignedTables: Array<{ id: string; name: string }> },
) {
  return {
    id: d.id,
    special_requests: d.special_requests,
    internal_notes: d.internal_notes,
    cancellation_deadline: d.cancellation_deadline,
    table_assignments: opts.isHydrated ? opts.assignedTables : [],
    guest: d.guest?.id
      ? {
          id: d.guest.id,
          first_name: d.guest.first_name,
          last_name: d.guest.last_name,
          email: d.guest.email,
          phone: d.guest.phone,
          visit_count: d.guest.visit_count,
          tags: d.guest.tags,
          customer_profile_notes: d.guest.customer_profile_notes,
        }
      : null,
    communications: d.communications,
    events: d.events.map((event) => ({
      id: event.id,
      event_type: event.event_type,
      created_at: event.created_at,
      payload: event.payload ?? null,
    })),
    combination_staff_notes: d.combination_staff_notes,
    inferred_booking_model: d.inferred_booking_model,
    cde_context: d.cde_context
      ? {
          inferred_model: d.inferred_booking_model ?? 'table_reservation',
          title: d.cde_context.title ?? '',
          subtitle: d.cde_context.subtitle ?? null,
        }
      : null,
    service_variant_name: d.service_variant_name ?? null,
    addons: d.addons ?? [],
    addons_total_price_pence: d.addons_total_price_pence ?? null,
    addons_total_duration_minutes: d.addons_total_duration_minutes ?? null,
  };
}
