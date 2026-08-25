import { describe, expect, it } from 'vitest';
import { renderCommunicationEmail } from '@/lib/communications/renderer';
import type { BookingEmailData, GroupAppointmentLine, VenueEmailData } from '@/lib/emails/types';

/**
 * One guest booking several services and a party of several people share one array,
 * `group_appointments`, told apart by `person_label`. Reminders used to label every line
 * of a visit "Guest", so a customer already greeted by name saw "Guest" stamped above each
 * of their own treatments. They were also anchored on whichever service row triggered the
 * send, so the hero read 11:30am for a visit starting at 9:00am, and the plain-text part
 * named only that one service.
 */

const venue: VenueEmailData = { name: 'Aura', address: '1 High St' };

const foils: GroupAppointmentLine = {
  person_label: '',
  booking_date: '2026-08-25',
  booking_time: '09:00',
  practitioner_name: 'Neill',
  service_name: 'Full Head Foils',
  price_display: '£110.00',
};
const blowDry: GroupAppointmentLine = {
  person_label: '',
  booking_date: '2026-08-25',
  booking_time: '11:30',
  practitioner_name: 'Neill',
  service_name: 'Blow Dry',
  price_display: '£30.00',
};

function booking(lines: GroupAppointmentLine[], over: Partial<BookingEmailData> = {}): BookingEmailData {
  return {
    id: 'b1',
    guest_name: 'Andrew Courtney',
    guest_email: 'a@example.com',
    // The row this email was sent for: the second service, at 11:30.
    booking_date: '2026-08-25',
    booking_time: '11:30',
    party_size: 1,
    manage_booking_link: 'https://example.com/m',
    email_variant: 'appointment',
    appointment_service_name: 'Blow Dry',
    practitioner_name: 'Neill',
    group_appointments: lines,
    ...over,
  };
}

function reminder(b: BookingEmailData) {
  return renderCommunicationEmail({
    lane: 'appointments_other',
    messageKey: 'pre_visit_reminder',
    booking: b,
    venue,
  })!;
}

const heroChip = (html: string) => html.match(/border-radius:9999px[^>]*>([^<]+)</)?.[1] ?? '';

describe('reminder for one guest booking several services', () => {
  it('does not label the services with a person', () => {
    const out = reminder(booking([foils, blowDry]));
    expect(out.html).not.toContain('>Guest<');
    expect(out.text).not.toMatch(/^\s*-\s*Guest,/m);
    // The customer is named once, in the greeting.
    expect(out.text).toContain('Hi Andrew Courtney,');
  });

  it('leads each row with the service, and follows with the time and price', () => {
    const html = reminder(booking([foils, blowDry])).html;
    expect(html).toContain('Full Head Foils with Neill');
    expect(html).toContain('Blow Dry with Neill');
    expect(html).toContain('9:00am');
    expect(html).toContain('11:30am');
    expect(html).toContain('£110.00');
    expect(html).toContain('£30.00');
  });

  it('shows when the visit starts, not the service that triggered the send', () => {
    expect(heroChip(reminder(booking([foils, blowDry])).html)).toBe('Tuesday, 25 August 2026 at 9:00am');
  });

  it('lists every service in the plain-text part', () => {
    const text = reminder(booking([foils, blowDry])).text;
    expect(text).toContain('Services:');
    expect(text).toContain('9:00am, Full Head Foils with Neill, £110.00');
    expect(text).toContain('11:30am, Blow Dry with Neill, £30.00');
    expect(text).toContain('Time: 9:00am');
  });

  it('says the day once, in the hero, when every service is on it', () => {
    const html = reminder(booking([foils, blowDry])).html;
    expect(heroChip(html)).toContain('Tuesday, 25 August 2026');
    // The date is not repeated on each row.
    expect(html.match(/25 August 2026/g)).toHaveLength(1);
  });

  it('puts the date back on each row when the services span days', () => {
    const nextDay = { ...blowDry, booking_date: '2026-08-26' };
    const html = reminder(booking([foils, nextDay])).html;
    expect(html).toContain('25 August 2026 at 9:00am');
    expect(html).toContain('26 August 2026 at 11:30am');
  });
});

describe('reminder for a party keeps naming each person', () => {
  const alex: GroupAppointmentLine = { ...foils, person_label: 'Alex', service_name: 'Cut', price_display: '£40.00' };
  const sam: GroupAppointmentLine = { ...blowDry, person_label: 'Sam', service_name: 'Colour', price_display: '£60.00' };

  it('leads each row with the person, not the service', () => {
    const html = reminder(booking([alex, sam])).html;
    expect(html).toContain('>Alex<');
    expect(html).toContain('>Sam<');
    expect(html).toContain('Cut with Neill');
  });

  it('names each person in the plain-text part', () => {
    const text = reminder(booking([alex, sam])).text;
    expect(text).toContain('- Alex, 9:00am, Cut with Neill, £40.00');
    expect(text).toContain('- Sam, 11:30am, Colour with Neill, £60.00');
  });

  it('still anchors the hero on the earliest arrival', () => {
    expect(heroChip(reminder(booking([alex, sam])).html)).toBe('Tuesday, 25 August 2026 at 9:00am');
  });
});

describe('confirmation for one guest booking several services', () => {
  // The confirmation has always itemised services in its own priced table rather than the
  // group-line list, so it never showed "Guest". It is asserted here so the two emails stay
  // consistent, and because the hero and the text part are shared with the reminder.
  const confirmation = () =>
    renderCommunicationEmail({
      lane: 'appointments_other',
      messageKey: 'booking_confirmation',
      booking: booking([foils, blowDry], { deposit_status: 'Not Required' }),
      venue,
    })!;

  it('names no person and itemises both services', () => {
    const html = confirmation().html;
    expect(html).not.toContain('>Guest<');
    expect(html).toContain('Full Head Foils');
    expect(html).toContain('Blow Dry');
    expect(html).toContain('£110.00');
    expect(html).toContain('£30.00');
  });

  it('shares the visit start and the full service list with the reminder', () => {
    const out = confirmation();
    expect(heroChip(out.html)).toBe('Tuesday, 25 August 2026 at 9:00am');
    expect(out.text).toContain('9:00am, Full Head Foils with Neill, £110.00');
    expect(out.text).toContain('11:30am, Blow Dry with Neill, £30.00');
  });
});

describe('a single-service booking is untouched', () => {
  it('keeps the one Service line and its own time', () => {
    const out = reminder(booking([], { group_appointments: undefined }));
    expect(out.text).toContain('Service: Blow Dry with Neill');
    expect(out.text).not.toContain('Services:');
    expect(heroChip(out.html)).toBe('Tuesday, 25 August 2026 at 11:30am');
  });
});
