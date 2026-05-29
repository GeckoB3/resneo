import { describe, expect, it } from 'vitest';
import { registryAppointmentToExpandedBookingRow } from '@/lib/booking/registry-to-expanded-booking-row';
import type { RegistryAppointment } from '@/components/booking/AppointmentRegistryCard';

const base: RegistryAppointment = {
  id: 'b1',
  booking_date: '2026-05-29',
  booking_time: '10:00',
  booking_end_time: '10:30',
  party_size: 1,
  status: 'Booked',
  source: 'booking_page',
  deposit_status: 'Not Required',
  deposit_amount_pence: null,
  guest_name: 'Alex Guest',
  guest_email: null,
  guest_phone: null,
  guest_visit_count: null,
  practitioner_id: 'p1',
  appointment_service_id: 's1',
  service_item_id: null,
  special_requests: null,
  internal_notes: null,
  client_arrived_at: null,
};

describe('registryAppointmentToExpandedBookingRow', () => {
  it('passes group_booking_id for multi-service visits', () => {
    const row = registryAppointmentToExpandedBookingRow({
      ...base,
      group_booking_id: 'grp-123',
      booking_item_name: 'Cut & colour',
      service_variant_name: 'Long hair',
      booking_addon_labels: ['Deep conditioning'],
    });
    expect(row.group_booking_id).toBe('grp-123');
    expect(row.booking_item_name).toBe('Cut & colour');
    expect(row.service_variant_name).toBe('Long hair');
    expect(row.booking_addon_labels).toEqual(['Deep conditioning']);
  });
});
