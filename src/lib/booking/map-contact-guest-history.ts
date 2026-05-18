import type { GuestBookingHistoryRow as AccordionGuestHistoryRow } from '@/app/dashboard/bookings/GuestBookingsForGuestAccordion';
import type { GuestBookingHistoryRow as ContactGuestHistoryRow } from '@/types/contacts';

/** Map contact detail `booking_history` into accordion list rows (avoids duplicate list fetch). */
export function mapContactGuestHistoryToAccordionRows(
  rows: ContactGuestHistoryRow[],
): AccordionGuestHistoryRow[] {
  return rows.map((h) => ({
    id: h.id,
    booking_date: h.booking_date,
    booking_time: h.booking_time,
    party_size: h.party_size ?? 1,
    status: h.status,
    estimated_end_time: null,
    booking_item_name: h.detail_label || h.service_name || h.kind_label || null,
    booking_model: h.booking_model,
    practitioner_id: null,
    appointment_service_id: null,
    calendar_id: null,
    service_item_id: null,
    experience_event_id: null,
    class_instance_id: null,
    resource_id: null,
    event_session_id: null,
    calendar_name: h.practitioner_name,
    service_id: null,
    service_variant_id: null,
    area_id: null,
    area_name: null,
  }));
}
