import { describe, expect, it } from 'vitest';
import { buildStaffRebookBootstrapFromBookingSource } from '@/lib/booking/staff-rebook-from-booking-source';
import { mapContactGuestHistoryToAccordionRows } from '@/lib/booking/map-contact-guest-history';
import type { GuestBookingHistoryRow } from '@/types/contacts';

describe('mapContactGuestHistoryToAccordionRows', () => {
  it('preserves appointment ids needed for staff rebook', () => {
    const contactRow: GuestBookingHistoryRow = {
      id: 'b1',
      booking_date: '2026-05-01',
      booking_time: '09:00',
      party_size: 1,
      status: 'Confirmed',
      deposit_status: null,
      booking_model: 'practitioner_appointment',
      kind_label: 'Appointment',
      detail_label: 'Alex · Cut',
      practitioner_name: 'Alex',
      service_name: 'Cut',
      practitioner_id: 'prac-1',
      appointment_service_id: 'svc-1',
      estimated_end_time: '2026-05-01T10:00:00.000Z',
    };

    const [accordionRow] = mapContactGuestHistoryToAccordionRows([contactRow]);

    expect(buildStaffRebookBootstrapFromBookingSource(accordionRow, {})).not.toBeNull();
    expect(accordionRow.practitioner_id).toBe('prac-1');
    expect(accordionRow.appointment_service_id).toBe('svc-1');
  });

  it('preserves unified scheduling ids needed for staff rebook', () => {
    const contactRow: GuestBookingHistoryRow = {
      id: 'b2',
      booking_date: '2026-05-02',
      booking_time: '14:00',
      party_size: 1,
      status: 'Completed',
      deposit_status: null,
      booking_model: 'unified_scheduling',
      kind_label: 'Appointment',
      detail_label: 'Room A · Massage',
      practitioner_name: null,
      service_name: null,
      calendar_id: 'cal-1',
      service_item_id: 'item-1',
      calendar_name: 'Room A',
      booking_end_time: '15:00:00',
    };

    const [accordionRow] = mapContactGuestHistoryToAccordionRows([contactRow]);

    expect(buildStaffRebookBootstrapFromBookingSource(accordionRow, {})).not.toBeNull();
    expect(accordionRow.calendar_id).toBe('cal-1');
    expect(accordionRow.service_item_id).toBe('item-1');
  });

  // Regression: rebook must NOT pre-fill "Comments or requests" from the prior
  // booking — comments are per-booking and entered fresh; persistent customer
  // info lives on the client record.
  it('does not carry the prior booking notes into the rebook comments', () => {
    const contactRow: GuestBookingHistoryRow = {
      id: 'b3',
      booking_date: '2026-05-03',
      booking_time: '11:00',
      party_size: 1,
      status: 'Completed',
      deposit_status: null,
      booking_model: 'practitioner_appointment',
      kind_label: 'Appointment',
      detail_label: 'Alex · Cut',
      practitioner_name: 'Alex',
      service_name: 'Cut',
      practitioner_id: 'prac-1',
      appointment_service_id: 'svc-1',
      estimated_end_time: '2026-05-03T12:00:00.000Z',
    };
    const [accordionRow] = mapContactGuestHistoryToAccordionRows([contactRow]);

    const payload = buildStaffRebookBootstrapFromBookingSource(accordionRow, {
      firstName: 'Jacob',
      lastName: 'Moore',
      email: 'jacobrmoore@hotmail.co.uk',
      phone: '7713351057',
      // Prior-booking / client-record data that must NOT leak into comments.
      specialRequests: 'Service price £26.00',
      dietaryNotes: 'Nut allergy',
      occasion: 'Birthday',
      internalNotes: 'VIP — comp the coffee',
      customerProfileNotes: 'Prefers Alex',
    });

    expect(payload).not.toBeNull();
    // Identity is carried (legitimate "rebook this client").
    expect(payload?.guest.firstName).toBe('Jacob');
    expect(payload?.guest.lastName).toBe('Moore');
    // But the comments box is left blank for manual entry.
    expect(payload?.appointmentComments ?? '').toBe('');
  });
});
