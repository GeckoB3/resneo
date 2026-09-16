/**
 * UX spec `email.confirm.through`: a confirmation for a booking made on a collective page says so,
 * in the HTML preamble and the text branch; any other confirmation is unchanged.
 */
import { describe, expect, it } from 'vitest';
import { renderCommunicationEmail } from '@/lib/communications/renderer';
import type { BookingEmailData, VenueEmailData } from '@/lib/emails/types';

const venue: VenueEmailData = { name: 'Zen Studio', address: '1 High St' };
const booking = (over: Partial<BookingEmailData> = {}): BookingEmailData => ({
  id: 'b1',
  guest_name: 'Sam',
  guest_email: 'sam@example.com',
  booking_date: '2026-10-12',
  booking_time: '10:00',
  party_size: 1,
  email_variant: 'appointment',
  booking_model: 'unified_scheduling',
  ...over,
});

const render = (b: BookingEmailData) =>
  renderCommunicationEmail({ lane: 'appointments_other', messageKey: 'booking_confirmation', booking: b, venue });

describe('booking confirmation through a collective', () => {
  it('says which collective page the booking came through', () => {
    const out = render(booking({ booked_through: 'Northside' }));
    expect(out?.html).toContain('You booked through Northside.');
    expect(out?.text).toContain('You booked through Northside.');
  });

  it('says nothing for a booking made on the venue page', () => {
    const out = render(booking());
    expect(out?.html).not.toContain('You booked through');
    expect(out?.text).not.toContain('You booked through');
  });
});
