import { describe, expect, it } from 'vitest';
import type { BookingEmailData, VenueEmailData } from '@/lib/emails/types';
import { renderCardHoldChargedEmail } from './card-hold-charged';

const EM_DASH = /—/;

const venue: VenueEmailData = {
  name: 'Glow Studio',
  address: '1 High St, Belfast BT1 1AA',
};

const appointmentBooking: BookingEmailData = {
  id: 'b-charged-1',
  guest_name: 'Jane Doe',
  guest_email: 'jane@example.com',
  booking_date: '2026-07-10',
  booking_time: '14:00:00',
  party_size: 1,
  booking_model: 'unified_scheduling',
  appointment_service_name: 'Deep tissue massage',
};

const tableBooking: BookingEmailData = {
  id: 'b-charged-2',
  guest_name: 'John Smith',
  guest_email: 'john@example.com',
  booking_date: '2026-07-10',
  booking_time: '19:00:00',
  party_size: 4,
};

describe('renderCardHoldChargedEmail (§10.2.2)', () => {
  it('renders the exact spec subject', () => {
    const out = renderCardHoldChargedEmail(appointmentBooking, venue, { chargedPence: 2500 });
    expect(out.subject).toBe('No-show fee charged: Glow Studio');
  });

  it('renders the exact spec body with the bookingLabel noun for an appointment', () => {
    const out = renderCardHoldChargedEmail(appointmentBooking, venue, { chargedPence: 2500 });
    const body =
      'You missed your Deep tissue massage at Glow Studio on Friday, 10 July 2026 at 2:00pm. ' +
      'As set out when you booked, a no-show fee of £25.00 has been charged to your saved card. ' +
      'If you think this is a mistake, please contact Glow Studio directly.';
    expect(out.text).toContain(body);
    expect(out.html).toContain(body);
    expect(out.html).toContain('No-show fee charged');
    expect(out.text).toContain('Amount charged: £25.00');
    expect(out.text).toContain('Hi Jane Doe,');
  });

  it('falls back to the plain "booking" noun for table bookings', () => {
    const out = renderCardHoldChargedEmail(tableBooking, venue, { chargedPence: 4000 });
    expect(out.text).toContain('You missed your booking at Glow Studio');
    expect(out.text).toContain('a no-show fee of £40.00 has been charged to your saved card');
  });

  it('carries the standard footer', () => {
    const out = renderCardHoldChargedEmail(tableBooking, venue, { chargedPence: 4000 });
    expect(out.html).toContain('You received this email because you have a booking at Glow Studio.');
    expect(out.html).toContain('Powered by');
    expect(out.text.trim().endsWith('Glow Studio')).toBe(true);
  });

  it('contains no em-dashes anywhere', () => {
    for (const booking of [appointmentBooking, tableBooking]) {
      const out = renderCardHoldChargedEmail(booking, venue, { chargedPence: 2500 });
      expect(out.subject).not.toMatch(EM_DASH);
      expect(out.html).not.toMatch(EM_DASH);
      expect(out.text).not.toMatch(EM_DASH);
    }
  });
});
