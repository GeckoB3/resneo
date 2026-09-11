import { describe, expect, it } from 'vitest';
import { renderCommunicationSms } from './renderer';
import type { BookingEmailData, GroupAppointmentLine, VenueEmailData } from '@/lib/emails/types';
import type { CommunicationMessageKey } from './policies';

const venue: VenueEmailData = { name: 'Willow & Sage Studio', address: null, phone: null };

const cut: GroupAppointmentLine = {
  person_label: '',
  booking_date: '2026-09-18',
  booking_time: '09:00',
  practitioner_name: 'Hannah',
  service_name: 'Cut & Blow Dry',
  price_display: '£45.00',
};
const colour: GroupAppointmentLine = {
  person_label: '',
  booking_date: '2026-09-18',
  booking_time: '10:00',
  practitioner_name: 'Hannah',
  service_name: 'Full Head Colour',
  price_display: '£80.00',
};

/** The row that triggered the send is the SECOND service, as a reminder cron would. */
function visit(overrides: Partial<BookingEmailData> = {}): BookingEmailData {
  return {
    id: 'b2',
    guest_name: 'Priya Patel',
    guest_email: 'p@x.com',
    guest_phone: '07700900123',
    booking_date: '2026-09-18',
    booking_time: '10:00',
    party_size: 1,
    booking_model: 'unified_scheduling',
    appointment_service_name: 'Full Head Colour',
    practitioner_name: 'Hannah',
    group_appointments: [cut, colour],
    ...overrides,
  };
}

function sms(messageKey: CommunicationMessageKey, booking: BookingEmailData) {
  return renderCommunicationSms({ lane: 'appointments_other', messageKey, booking, venue })!.body;
}

describe('SMS names every service of a multi-service booking', () => {
  it('confirmation lists both services and the visit start time', () => {
    const body = sms('booking_confirmation', visit());
    expect(body).toBe('Willow & Sage Studio: Confirmed: Cut & Blow Dry and Full Head Colour with Hannah on 18 Sept at 9:00am. Free.');
    expect(body.length).toBeLessThanOrEqual(160);
  });
  it('reminder, modification and cancellation carry both services', () => {
    expect(sms('pre_visit_reminder', visit())).toContain('Cut & Blow Dry and Full Head Colour');
    expect(sms('booking_modification', visit())).toContain('Cut & Blow Dry and Full Head Colour');
    expect(sms('cancellation_confirmation', visit())).toContain('Cut & Blow Dry and Full Head Colour');
    expect(sms('deposit_payment_request', visit())).toContain('Cut & Blow Dry and Full Head Colour');
  });
  it('never quotes the triggering row\'s later time', () => {
    for (const key of ['booking_confirmation', 'pre_visit_reminder', 'booking_modification', 'cancellation_confirmation'] as const) {
      expect(sms(key, visit())).not.toContain('10:00am');
    }
  });
  it('drops the staff name when the services are with different people', () => {
    const body = sms('booking_confirmation', visit({ group_appointments: [cut, { ...colour, practitioner_name: 'Sam' }] }));
    expect(body).toContain('Cut & Blow Dry and Full Head Colour on 18 Sept');
    expect(body).not.toContain('with Hannah');
  });
  it('summarises past three services and a party', () => {
    const four = [cut, colour, { ...cut, service_name: 'Treatment' }, { ...cut, service_name: 'Fringe trim' }];
    expect(sms('booking_confirmation', visit({ group_appointments: four }))).toContain('Cut & Blow Dry, Full Head Colour and 2 more');
    const party = [{ ...cut, person_label: 'Priya' }, { ...colour, person_label: 'Anna' }];
    expect(sms('booking_confirmation', visit({ group_appointments: party }))).toContain('2 appointments');
  });
  it('single-service bookings read as before', () => {
    expect(sms('booking_confirmation', visit({ group_appointments: undefined }))).toBe(
      'Willow & Sage Studio: Confirmed: Full Head Colour with Hannah on 18 Sept at 10:00am. Free.',
    );
  });
});
