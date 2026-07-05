import { describe, expect, it } from 'vitest';
import { renderCommunicationEmail, renderCommunicationSms } from '@/lib/communications/renderer';
import type { BookingEmailData, VenueEmailData } from '@/lib/emails/types';

const EM_DASH = /—/;

const venue: VenueEmailData = { name: 'Glow Studio', address: '1 High St, Belfast BT1 1AA' };

const appointmentBooking: BookingEmailData = {
  id: 'b-hold-1',
  guest_name: 'Jane Doe',
  guest_email: 'jane@example.com',
  guest_phone: '+447700900000',
  booking_date: '2026-07-10',
  booking_time: '14:00:00',
  party_size: 1,
  booking_model: 'unified_scheduling',
  appointment_service_name: 'Deep tissue massage',
  card_hold_fee_pence: 2500,
};

const tableBooking: BookingEmailData = {
  id: 'b-hold-2',
  guest_name: 'John Smith',
  guest_email: 'john@example.com',
  booking_date: '2026-07-10',
  booking_time: '19:00:00',
  party_size: 4,
  card_hold_fee_pence: 4000,
};

const BODY_CORE =
  'No payment is taken now. Add your card details to secure your booking. Glow Studio may charge a no-show fee of up to £25.00 if you do not attend.';

const baseOpts = {
  lane: 'appointments_other' as const,
  booking: appointmentBooking,
  venue,
  paymentLink: 'https://www.resneo.com/pay/abc123',
};

describe('card_hold_request email rendering', () => {
  it('renders the subject, heading, exact body core, CTA, and booking summary', () => {
    const out = renderCommunicationEmail({ ...baseOpts, messageKey: 'card_hold_request' });
    expect(out).not.toBeNull();
    expect(out!.subject).toBe('Add your card details to confirm your booking at Glow Studio');
    expect(out!.html).toContain('Card details needed');
    expect(out!.html).toContain(BODY_CORE);
    expect(out!.html).toContain('Add card details');
    expect(out!.html).toContain('https://www.resneo.com/pay/abc123');
    expect(out!.text).toContain(BODY_CORE);
    expect(out!.text).toContain('Add card details: https://www.resneo.com/pay/abc123');
    expect(out!.text).toContain('Service: Deep tissue massage');
    expect(out!.text).toContain('Date:');
    expect(out!.text).toContain('Time:');
  });

  it('renders the table-lane variant with party size and venue address', () => {
    const out = renderCommunicationEmail({
      lane: 'table',
      booking: tableBooking,
      venue,
      paymentLink: 'https://www.resneo.com/pay/abc123',
      messageKey: 'card_hold_request',
    });
    expect(out!.text).toContain('Guests: 4');
    expect(out!.text).toContain('£40.00');
    expect(out!.html).toContain('1 High St, Belfast BT1 1AA');
  });

  it('carries no deposit-refund-deadline copy', () => {
    const out = renderCommunicationEmail({
      ...baseOpts,
      booking: { ...appointmentBooking, refund_cutoff: '2026-07-08T19:00:00Z' },
      messageKey: 'card_hold_request',
    });
    expect(out!.html.toLowerCase()).not.toContain('refund');
    expect(out!.text.toLowerCase()).not.toContain('refund');
  });

  it('contains no em-dashes', () => {
    const out = renderCommunicationEmail({ ...baseOpts, messageKey: 'card_hold_request' });
    expect(out!.subject).not.toMatch(EM_DASH);
    expect(out!.html).not.toMatch(EM_DASH);
    expect(out!.text).not.toMatch(EM_DASH);
  });
});

describe('card_hold_payment_reminder email rendering', () => {
  it('prefixes the subject and keeps the same body shape', () => {
    const out = renderCommunicationEmail({ ...baseOpts, messageKey: 'card_hold_payment_reminder' });
    expect(out!.subject).toBe(
      'Reminder: add your card details to confirm your booking at Glow Studio',
    );
    expect(out!.html).toContain('Card details needed');
    expect(out!.html).toContain(BODY_CORE);
    expect(out!.html).toContain('https://www.resneo.com/pay/abc123');
    expect(out!.subject).not.toMatch(EM_DASH);
    expect(out!.html).not.toMatch(EM_DASH);
    expect(out!.text).not.toMatch(EM_DASH);
  });
});

describe('card_hold_request SMS rendering', () => {
  it('keeps the reassurance clause and stays within a single segment when it fits', () => {
    const out = renderCommunicationSms({ ...baseOpts, messageKey: 'card_hold_request' });
    expect(out).not.toBeNull();
    expect(out!.body).toContain(
      'Glow Studio: card details needed to secure your booking for',
    );
    expect(out!.body).toContain('No payment is taken now.');
    expect(out!.body).toContain('Add: https://www.resneo.com/pay/abc123');
    expect(out!.body.length).toBeLessThanOrEqual(160);
    expect(out!.body).not.toMatch(EM_DASH);
  });

  it('drops the reassurance clause first when the link pushes it over 160 chars', () => {
    const longLink =
      'https://www.resneo.com/pay/v2.eyJib29raW5nSWQiOiJiLWhvbGQtMSIsInNpZyI6IjEyMzQ1Njc4OTAiLCJleHAiOjE4MzAwMDAwMDB9';
    const out = renderCommunicationSms({
      ...baseOpts,
      paymentLink: longLink,
      messageKey: 'card_hold_request',
    });
    expect(out!.body).not.toContain('No payment is taken now.');
    expect(out!.body).toContain('card details needed to secure your booking for');
    expect(out!.body).toContain(`Add: ${longLink}`);
  });
});

describe('card_hold_payment_reminder SMS rendering', () => {
  it('prefixes Reminder: to the SMS body', () => {
    const out = renderCommunicationSms({ ...baseOpts, messageKey: 'card_hold_payment_reminder' });
    expect(out!.body).toContain(
      'Reminder: Glow Studio: card details needed to secure your booking for',
    );
    expect(out!.body).toContain('Add: https://www.resneo.com/pay/abc123');
    expect(out!.body).not.toMatch(EM_DASH);
  });
});

describe('booking_confirmation with an open card hold (§10.2)', () => {
  const heldBooking: BookingEmailData = {
    ...appointmentBooking,
    deposit_status: 'Card Held',
  };
  const HOLD_NOTICE =
    'No payment has been taken. Your card is securely on file and Glow Studio may charge ' +
    'a no-show fee of up to £25.00 if you do not attend. Cancel before your booking ' +
    'starts to avoid any charge.';

  it('appends the hold section to the confirmation email html and text', () => {
    const out = renderCommunicationEmail({
      lane: 'appointments_other',
      booking: heldBooking,
      venue,
      messageKey: 'booking_confirmation',
    });
    expect(out).not.toBeNull();
    expect(out!.html).toContain(HOLD_NOTICE);
    expect(out!.text).toContain(HOLD_NOTICE);
    expect(out!.html).not.toMatch(EM_DASH);
    expect(out!.text).not.toMatch(EM_DASH);
  });

  it('shows the dedicated payment status line instead of Free', () => {
    const out = renderCommunicationEmail({
      lane: 'appointments_other',
      booking: heldBooking,
      venue,
      messageKey: 'booking_confirmation',
    });
    expect(out!.text).toContain(
      'No payment taken. Card held for a no-show fee of up to £25.00.',
    );
    expect(out!.text).not.toContain('Free');
  });

  it('adds the hold suffix to the confirmation SMS', () => {
    const out = renderCommunicationSms({
      lane: 'appointments_other',
      booking: heldBooking,
      venue,
      messageKey: 'booking_confirmation',
    });
    expect(out!.body).toContain('Card held, no payment taken. No-show fee up to £25.00.');
    expect(out!.body).not.toMatch(EM_DASH);
  });

  it('leaves confirmations without a hold untouched', () => {
    const out = renderCommunicationEmail({
      lane: 'appointments_other',
      booking: { ...appointmentBooking, card_hold_fee_pence: null },
      venue,
      messageKey: 'booking_confirmation',
    });
    expect(out!.html).not.toContain('securely on file');
    expect(out!.text).not.toContain('securely on file');
  });
});
