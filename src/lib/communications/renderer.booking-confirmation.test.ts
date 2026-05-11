import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  renderCommunicationEmail,
  renderCommunicationSms,
} from '@/lib/communications/renderer';
import type { BookingEmailData } from '@/lib/emails/types';
import type { VenueEmailData } from '@/lib/emails/types';

const venue: VenueEmailData = { name: 'Test Venue', address: '1 High St' };

function baseBooking(over: Partial<BookingEmailData>): BookingEmailData {
  return {
    id: 'b1',
    guest_name: 'Sam',
    guest_email: 'sam@example.com',
    booking_date: '2026-06-01',
    booking_time: '10:00',
    party_size: 1,
    manage_booking_link: 'https://example.com/m',
    ...over,
  };
}

describe('renderCommunicationEmail booking_confirmation', () => {
  it('puts price and pay-at-venue copy in the detail card only, not the intro', () => {
    const out = renderCommunicationEmail({
      lane: 'appointments_other',
      messageKey: 'booking_confirmation',
      booking: baseBooking({
        email_variant: 'appointment',
        appointment_service_name: 'Massage',
        practitioner_name: 'Jo',
        appointment_price_display: '£45.00 (pay at venue)',
        deposit_status: 'Not Required',
      }),
      venue,
    });
    expect(out?.html).toContain('£45.00');
    expect(out?.html).not.toMatch(/Total price £45\.00\. Pay at the venue/i);
    expect(out?.html).toMatch(/Due at the venue/i);
    expect(out?.text).toContain('Price and payment:');
    expect(out?.text).toContain('£45.00');
    expect(out?.text).toMatch(/Due at the venue/i);
    expect(out?.text).not.toMatch(/Total price £45\.00\. Pay at the venue/i);
  });

  it('shows paid in full when deposit_status is Paid and amount meets total', () => {
    const out = renderCommunicationEmail({
      lane: 'appointments_other',
      messageKey: 'booking_confirmation',
      booking: baseBooking({
        email_variant: 'appointment',
        appointment_service_name: 'Class',
        appointment_price_display: '£20.00',
        booking_total_price_pence: 2000,
        deposit_amount_pence: 2000,
        deposit_status: 'Paid',
      }),
      venue,
    });
    expect(out?.html).toContain('Paid in full online');
    expect(out?.text).toMatch(/Paid in full online/);
  });

  it('shows full-refund deadline in the card when paid online and refund_cutoff is set', () => {
    const out = renderCommunicationEmail({
      lane: 'appointments_other',
      messageKey: 'booking_confirmation',
      booking: baseBooking({
        email_variant: 'appointment',
        appointment_service_name: 'Workshop',
        booking_total_price_pence: 5000,
        deposit_amount_pence: 5000,
        deposit_status: 'Paid',
        refund_cutoff: '2026-12-20T18:00:00.000Z',
      }),
      venue,
    });
    expect(out?.html).toMatch(/Cancellation:.*Full refund if you cancel before/i);
    expect(out?.text).toMatch(/Full refund if you cancel before/i);
  });

  it('shows per-seat and total for multi-seat class bookings', () => {
    const out = renderCommunicationEmail({
      lane: 'appointments_other',
      messageKey: 'booking_confirmation',
      booking: baseBooking({
        email_variant: 'appointment',
        booking_model: 'class_session',
        appointment_service_name: 'Yoga',
        party_size: 2,
        booking_unit_price_pence: 1000,
        booking_price_quantity: 2,
        booking_total_price_pence: 2000,
        appointment_price_display: '£20.00',
        deposit_status: 'Not Required',
      }),
      venue,
    });
    expect(out?.html).toMatch(/£10\.00 each × 2/i);
    expect(out?.html).toMatch(/Total: £20\.00/i);
  });

  it('shows deposit + balance when partially paid online', () => {
    const out = renderCommunicationEmail({
      lane: 'appointments_other',
      messageKey: 'booking_confirmation',
      booking: baseBooking({
        email_variant: 'appointment',
        appointment_service_name: 'Event',
        appointment_price_display: '£50.00',
        booking_total_price_pence: 5000,
        deposit_amount_pence: 2000,
        deposit_status: 'Paid',
      }),
      venue,
    });
    expect(out?.html).toMatch(/Deposit of £20\.00 paid online/i);
    expect(out?.html).toMatch(/£30\.00 due at the venue/i);
  });

  it('shows Free when there is no charge and no deposit paid', () => {
    const out = renderCommunicationEmail({
      lane: 'appointments_other',
      messageKey: 'booking_confirmation',
      booking: baseBooking({
        email_variant: 'appointment',
        appointment_service_name: 'Intro class',
        booking_total_price_pence: 0,
        deposit_status: 'Not Required',
      }),
      venue,
    });
    expect(out?.html).toMatch(/>Free<\/p>/);
    expect(out?.html).not.toContain('There is no charge for this booking');
    expect(out?.text).toContain('Price and payment:');
    expect(out?.text).toContain('Free');
  });
});

describe('renderCommunicationEmail booking_confirmation account CTA', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://rnapp.test');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('includes per-booking manage CTA plus account magic-link copy when guest_email is set', () => {
    const venue: VenueEmailData = { name: 'Test Venue', address: '1 High St' };
    const out = renderCommunicationEmail({
      lane: 'table',
      messageKey: 'booking_confirmation',
      booking: {
        id: 'b1',
        guest_name: 'Sam',
        guest_email: 'sam@example.com',
        booking_date: '2026-06-01',
        booking_time: '10:00',
        party_size: 2,
        manage_booking_link: 'https://example.com/m',
      },
      venue,
    });
    expect(out?.html).toMatch(/>\s*Manage\s*</);
    expect(out?.html).toContain('https://example.com/m');
    expect(out?.html).toContain('/auth/magic');
    expect(out?.html).toContain('View or sign in to your account');
    const html = out!.html;
    const addCalIdx = html.indexOf('Add to calendar');
    const acctIdx = html.indexOf('Your bookings across venues');
    expect(addCalIdx).toBeGreaterThan(-1);
    expect(acctIdx).toBeGreaterThan(addCalIdx);
    expect(out?.text).toMatch(/View or sign in to your account:/);
    expect(out?.text).toContain('https://rnapp.test/auth/magic');
    expect(out?.text).toMatch(/email=sam%40example\.com/);
    const text = out!.text;
    const addCalLine = text.indexOf('Add to calendar:');
    const acctLine = text.indexOf('View or sign in to your account:');
    expect(addCalLine).toBeGreaterThan(-1);
    expect(acctLine).toBeGreaterThan(addCalLine);
  });
});

describe('renderCommunicationSms confirm_or_cancel_prompt', () => {
  it('keeps table booking confirmation wording when the manage link is long', () => {
    const longManageLink =
      'https://www.reserveni.com/m/v2.eyJib29raW5nSWQiOiJhYWFhYWFhYS1iYmJiLWNjY2MtZGRkZC1lZWVlZWVlZWVlZWUiLCJzaWciOiIxMjM0NTY3ODkwIn0';
    const out = renderCommunicationSms({
      lane: 'table',
      messageKey: 'booking_confirmation',
      booking: baseBooking({
        party_size: 4,
        manage_booking_link: longManageLink,
      }),
      venue,
    });

    expect(out?.body).toContain('Test Venue: Booking confirmed for 4 guests');
    expect(out?.body).toContain('Manage: https://www.reserveni.com/m/v2.');
    expect(out?.body).not.toBe(longManageLink);
  });

  it('uses compact /b/ short links in booking confirmation SMS when provided', () => {
    const shortUrl = 'https://www.reserveni.com/b/aZ3kQ9';
    const out = renderCommunicationSms({
      lane: 'table',
      messageKey: 'booking_confirmation',
      booking: baseBooking({
        party_size: 2,
        manage_booking_link: shortUrl,
      }),
      venue,
    });
    expect(out?.body).toContain('Test Venue: Booking confirmed for 2 guests');
    expect(out?.body).toContain('Manage: https://www.reserveni.com/b/aZ3kQ9');
    expect(out?.body).not.toContain('/m/v3.');
  });

  it('keeps table confirm-or-cancel wording when the confirm link is long', () => {
    const longConfirmLink =
      'https://www.reserveni.com/c/v2.eyJib29raW5nSWQiOiJhYWFhYWFhYS1iYmJiLWNjY2MtZGRkZC1lZWVlZWVlZWVlZWUiLCJzaWciOiIxMjM0NTY3ODkwIn0';
    const out = renderCommunicationSms({
      lane: 'table',
      messageKey: 'confirm_or_cancel_prompt',
      booking: baseBooking({ party_size: 4 }),
      venue,
      confirmLink: longConfirmLink,
      cancelLink: longConfirmLink,
    });

    expect(out?.body).toContain('Test Venue: Please confirm or cancel your booking for 4 guests');
    expect(out?.body).toContain(longConfirmLink);
    expect(out?.body).not.toBe(longConfirmLink);
  });

  it('includes compact /b/ confirm links in confirm-or-cancel SMS', () => {
    const shortConfirm = 'https://www.reserveni.com/b/qwerty';
    const out = renderCommunicationSms({
      lane: 'table',
      messageKey: 'confirm_or_cancel_prompt',
      booking: baseBooking({ party_size: 3 }),
      venue,
      confirmLink: shortConfirm,
      cancelLink: shortConfirm,
    });
    expect(out?.body).toContain('Please confirm or cancel');
    expect(out?.body).toContain('https://www.reserveni.com/b/qwerty');
    expect(out?.body).not.toContain('/c/');
  });

  it('uses one confirm-or-cancel link for table bookings', () => {
    const link = 'https://example.com/c/signed';
    const out = renderCommunicationSms({
      lane: 'table',
      messageKey: 'confirm_or_cancel_prompt',
      booking: baseBooking({ party_size: 4 }),
      venue,
      confirmLink: link,
      cancelLink: link,
    });

    expect(out?.body).toContain('https://example.com/c/signed');
    expect(out?.body).toMatch(/Please confirm or cancel/);
    expect(out?.body).not.toContain('Confirm:');
    expect(out?.body).not.toContain('Cancel:');
    expect(out?.body.match(/https:\/\/example\.com\/c\/signed/g)).toHaveLength(1);
    expect(out!.body.length).toBeLessThanOrEqual(160);
  });

  it('uses one confirm-or-cancel link for appointment bookings', () => {
    const link = 'https://example.com/c/signed';
    const out = renderCommunicationSms({
      lane: 'appointments_other',
      messageKey: 'confirm_or_cancel_prompt',
      booking: baseBooking({
        appointment_service_name: 'Massage',
        practitioner_name: 'Jo',
      }),
      venue,
      confirmLink: link,
      cancelLink: link,
    });

    expect(out?.body).toContain('https://example.com/c/signed');
    expect(out?.body).toMatch(/Please confirm or cancel/);
    expect(out?.body).not.toContain('Confirm:');
    expect(out?.body).not.toContain('Cancel:');
    expect(out?.body.match(/https:\/\/example\.com\/c\/signed/g)).toHaveLength(1);
    expect(out!.body.length).toBeLessThanOrEqual(160);
  });
});
