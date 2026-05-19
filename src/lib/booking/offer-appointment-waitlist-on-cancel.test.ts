import { describe, expect, it } from 'vitest';
import {
  isAppointmentBookingForWaitlistOffer,
  pickFirstMatchingWaitlistEntry,
  waitlistPractitionerMatchesFreedSlot,
  waitlistServiceMatchesFreedSlot,
  waitlistTimeMatchesFreedSlot,
  type WaitlistEntryCandidate,
} from '@/lib/booking/offer-appointment-waitlist-on-cancel';

const baseBooking = {
  id: 'b1',
  venue_id: 'v1',
  booking_date: '2026-06-15',
  booking_time: '14:30:00',
  practitioner_id: 'prac-1',
  calendar_id: null,
  appointment_service_id: 'svc-1',
  service_item_id: null,
};

const entry = (overrides: Partial<WaitlistEntryCandidate>): WaitlistEntryCandidate => ({
  id: 'w1',
  desired_date: '2026-06-15',
  desired_time: '14:30:00',
  practitioner_id: null,
  appointment_service_id: 'svc-1',
  service_item_id: null,
  guest_first_name: 'Alex',
  guest_last_name: 'Smith',
  guest_email: 'alex@example.com',
  guest_phone: '+447700900123',
  created_at: '2026-06-10T10:00:00Z',
  ...overrides,
});

describe('offer-appointment-waitlist-on-cancel matching', () => {
  it('detects appointment bookings', () => {
    expect(isAppointmentBookingForWaitlistOffer(baseBooking)).toBe(true);
    expect(
      isAppointmentBookingForWaitlistOffer({
        ...baseBooking,
        practitioner_id: null,
        appointment_service_id: null,
        service_item_id: null,
        experience_event_id: 'ev-1',
      }),
    ).toBe(false);
  });

  it('matches service, practitioner, and time', () => {
    expect(
      waitlistServiceMatchesFreedSlot(entry({}), {
        serviceItemId: null,
        appointmentServiceId: 'svc-1',
      }),
    ).toBe(true);
    expect(waitlistPractitionerMatchesFreedSlot(null, 'prac-1')).toBe(true);
    expect(waitlistPractitionerMatchesFreedSlot('prac-1', 'prac-1')).toBe(true);
    expect(waitlistPractitionerMatchesFreedSlot('prac-2', 'prac-1')).toBe(false);
    expect(waitlistTimeMatchesFreedSlot('14:30:00', '14:30')).toBe(true);
    expect(waitlistTimeMatchesFreedSlot(null, '14:30')).toBe(true);
    expect(waitlistTimeMatchesFreedSlot('15:00:00', '14:30')).toBe(false);
  });

  it('picks FIFO first match', () => {
    const entries = [
      entry({ id: 'w2', created_at: '2026-06-11T10:00:00Z', desired_time: '15:00:00' }),
      entry({ id: 'w1', created_at: '2026-06-10T10:00:00Z' }),
    ];
    const picked = pickFirstMatchingWaitlistEntry(entries, baseBooking);
    expect(picked?.id).toBe('w1');
  });

  it('skips wrong service', () => {
    const picked = pickFirstMatchingWaitlistEntry(
      [entry({ appointment_service_id: 'other' })],
      baseBooking,
    );
    expect(picked).toBeNull();
  });
});
