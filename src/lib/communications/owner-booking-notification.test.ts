import { describe, expect, it } from 'vitest';
import { renderOwnerBookingNotificationEmail } from './owner-booking-notification';
import type { BookingEmailData, VenueEmailData } from '@/lib/emails/types';

const venue: VenueEmailData = {
  name: 'Glow Studio',
  address: '1 Main Street, Bangor',
  logo_url: null,
};

function baseBooking(overrides: Partial<BookingEmailData> = {}): BookingEmailData {
  return {
    id: 'abc12345-0000-0000-0000-000000000000',
    guest_name: 'Sam Carter',
    guest_email: 'sam@example.com',
    guest_phone: '+447700900123',
    booking_date: '2026-07-01',
    booking_time: '14:30',
    party_size: 1,
    ...overrides,
  };
}

describe('renderOwnerBookingNotificationEmail', () => {
  it('renders subject with guest name, date and time', () => {
    const { subject } = renderOwnerBookingNotificationEmail(baseBooking(), venue);
    expect(subject).toContain('New booking: Sam Carter');
    expect(subject).toContain('at');
  });

  it('includes guest contact details in html and text', () => {
    const { html, text } = renderOwnerBookingNotificationEmail(baseBooking(), venue);
    expect(html).toContain('sam@example.com');
    expect(html).toContain('+447700900123');
    expect(text).toContain('sam@example.com');
    expect(text).toContain('+447700900123');
  });

  it('renders appointment service and practitioner rows', () => {
    const { html, text } = renderOwnerBookingNotificationEmail(
      baseBooking({
        email_variant: 'appointment',
        appointment_service_name: 'Cut & Blow Dry',
        practitioner_name: 'Alex',
        appointment_price_display: '£45.00',
      }),
      venue,
    );
    expect(html).toContain('Cut &amp; Blow Dry');
    expect(html).toContain('Alex');
    expect(text).toContain('Service: Cut & Blow Dry');
    expect(text).toContain('With: Alex');
  });

  it('falls back to a generic guest name and omits missing contact lines', () => {
    const { subject, text } = renderOwnerBookingNotificationEmail(
      baseBooking({ guest_name: '', guest_email: null, guest_phone: null }),
      venue,
    );
    expect(subject).toContain('New booking: A guest');
    expect(text).not.toContain('Guest contact:');
  });

  it('escapes html in guest-provided fields', () => {
    const { html } = renderOwnerBookingNotificationEmail(
      baseBooking({ guest_name: '<img src=x onerror=alert(1)>' }),
      venue,
    );
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});

describe('renderOwnerBookingNotificationEmail: booking location', () => {
  it('shows the venue address when the booking has no location snapshot', () => {
    const { html, text } = renderOwnerBookingNotificationEmail(baseBooking(), venue);
    expect(html).toContain('1 Main Street, Bangor');
    expect(text).toContain('Location: 1 Main Street, Bangor');
  });

  it("names the client's address (staff perspective) for client-address bookings", () => {
    const { html, text } = renderOwnerBookingNotificationEmail(
      baseBooking({
        email_variant: 'appointment',
        appointment_service_name: 'Mobile massage',
        booking_location: {
          kind: 'client_address',
          client_address: '12 High Street, Belfast, BT1 1AA',
        },
      }),
      venue,
    );
    expect(text).toContain("Location: Client's address — 12 High Street, Belfast, BT1 1AA");
    expect(html).toContain('12 High Street, Belfast, BT1 1AA');
    // Staff email must not borrow the guest-facing "Your address" wording.
    expect(html).not.toContain('Your address');
  });

  it('includes the join link and joining info for online bookings', () => {
    const { html, text } = renderOwnerBookingNotificationEmail(
      baseBooking({
        email_variant: 'appointment',
        appointment_service_name: 'Online consultation',
        booking_location: {
          kind: 'online',
          online_url: 'https://meet.example.com/abc-123',
          online_info: 'Use headphones and join 5 minutes early.',
        },
      }),
      venue,
    );
    expect(html).toContain('Online');
    expect(html).toContain('https://meet.example.com/abc-123');
    expect(html).toContain('Use headphones and join 5 minutes early.');
    expect(text).toContain('Location: Online');
    expect(text).toContain('Join link: https://meet.example.com/abc-123');
    expect(text).toContain('Joining info: Use headphones and join 5 minutes early.');
  });

  it('falls back to "Online" with no link when the service has no meeting url', () => {
    const { html, text } = renderOwnerBookingNotificationEmail(
      baseBooking({
        email_variant: 'appointment',
        booking_location: { kind: 'online', online_url: null, online_info: null },
      }),
      venue,
    );
    expect(text).toContain('Location: Online');
    expect(text).not.toContain('Join link:');
    expect(html).toContain('Online');
  });
});
