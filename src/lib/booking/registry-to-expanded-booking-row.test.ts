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
  it('synthesises estimated_end_time from the wall-clock end when the row has one', () => {
    const row = registryAppointmentToExpandedBookingRow(base);
    expect(row.booking_end_time).toBe('10:30');
    expect(row.estimated_end_time).toBe('2026-05-29T10:30:00.000Z');
  });

  it('keeps the row estimated_end_time when booking_end_time is NULL (regression)', () => {
    // Guest-created appointments carry no booking_end_time (only resource
    // bookings post one), so dropping estimated_end_time here left the Modify
    // form with no duration to read: it fell back to 30 minutes, which shrank
    // long appointments and failed processing-time validation outright.
    const row = registryAppointmentToExpandedBookingRow({
      ...base,
      booking_end_time: null,
      estimated_end_time: '2026-05-29T11:20:00.000Z',
      processing_time_blocks: [{ id: 'p1', start_minute: 20, duration_minutes: 30 }],
    });
    expect(row.estimated_end_time).toBe('2026-05-29T11:20:00.000Z');
    expect(row.processing_time_blocks).toEqual([
      { id: 'p1', start_minute: 20, duration_minutes: 30 },
    ]);
  });

  it('is null only when the row genuinely has neither end time', () => {
    const row = registryAppointmentToExpandedBookingRow({
      ...base,
      booking_end_time: null,
      estimated_end_time: null,
    });
    expect(row.estimated_end_time).toBeNull();
  });

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
