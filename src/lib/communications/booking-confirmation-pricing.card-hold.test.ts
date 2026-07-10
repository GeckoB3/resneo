import { describe, expect, it } from 'vitest';
import type { BookingEmailData } from '@/lib/emails/types';
import {
  bookingConfirmationSmsPriceSuffix,
  bookingHasOpenCardHoldDisplay,
  cardHoldConfirmationNotice,
  confirmationPaymentPolicyText,
  confirmationStructuredPriceText,
  eventBookingConfirmationSmsPriceSuffix,
  isFreeBookingDisplay,
} from './booking-confirmation-pricing';

const EM_DASH = /—/;

/** Free-with-hold appointment: no price, card held for a £25 no-show fee. */
const heldBooking: BookingEmailData = {
  id: 'b-hold-1',
  guest_name: 'Jane Doe',
  booking_date: '2026-07-10',
  booking_time: '14:00',
  party_size: 1,
  booking_model: 'unified_scheduling',
  appointment_service_name: 'Deep tissue massage',
  deposit_status: 'Card Held',
  card_hold_fee_pence: 2500,
};

describe('isFreeBookingDisplay with card holds (§10.2)', () => {
  it('does not classify a card-hold booking as free', () => {
    expect(isFreeBookingDisplay(heldBooking)).toBe(false);
  });

  it('still classifies a genuinely free booking (no hold) as free', () => {
    expect(
      isFreeBookingDisplay({ ...heldBooking, deposit_status: null, card_hold_fee_pence: null }),
    ).toBe(true);
  });

  it('treats charged/refunded holds as no longer open', () => {
    expect(bookingHasOpenCardHoldDisplay({ ...heldBooking, deposit_status: 'Charged' })).toBe(
      false,
    );
    expect(bookingHasOpenCardHoldDisplay({ ...heldBooking, deposit_status: 'Refunded' })).toBe(
      false,
    );
    expect(bookingHasOpenCardHoldDisplay(heldBooking)).toBe(true);
  });
});

describe('payment status line for card holds (§10.2)', () => {
  it('renders the exact dedicated hold status line', () => {
    expect(confirmationPaymentPolicyText(heldBooking)).toBe(
      'No payment taken. Card held for a no-show fee of up to £25.00.',
    );
  });

  it('does not render "Free" or "pay at venue" in the structured price text', () => {
    const text = confirmationStructuredPriceText(heldBooking);
    expect(text).toContain('No payment taken. Card held for a no-show fee of up to £25.00.');
    expect(text).not.toContain('Free');
    expect(text?.toLowerCase()).not.toContain('due at the venue');
  });

  it('leaves paid-deposit bookings on the paid branch', () => {
    const paid: BookingEmailData = {
      ...heldBooking,
      deposit_status: 'Paid',
      card_hold_fee_pence: null,
      deposit_amount_pence: 1000,
    };
    expect(confirmationPaymentPolicyText(paid)).toContain('Payment:');
  });
});

describe('confirmation SMS suffix for card holds (§10.2)', () => {
  it('renders the exact hold suffix with a leading space', () => {
    expect(bookingConfirmationSmsPriceSuffix(heldBooking)).toBe(
      ' Card held, no payment taken. No-show fee up to £25.00.',
    );
  });

  it('keeps the suffix short enough for the single-segment pattern', () => {
    const suffix = bookingConfirmationSmsPriceSuffix(heldBooking);
    // Core confirmation SMS copy leaves roughly half the 160-char budget for
    // the suffix; keep the hold suffix within it.
    expect(suffix.length).toBeLessThanOrEqual(60);
  });

  it('is used by the event suffix fallback and the ticket-lines chain', () => {
    expect(eventBookingConfirmationSmsPriceSuffix(heldBooking)).toBe(
      ' Card held, no payment taken. No-show fee up to £25.00.',
    );
    const eventBooking: BookingEmailData = {
      ...heldBooking,
      booking_model: 'event_ticket',
      card_hold_fee_pence: 5000,
      booking_ticket_price_lines: [{ label: 'Adult', quantity: 2, unit_price_pence: 0 }],
    };
    const suffix = eventBookingConfirmationSmsPriceSuffix(eventBooking);
    expect(suffix).toContain('card held, no payment taken, no-show fee up to £50.00');
    expect(suffix).not.toContain('free');
    expect(suffix).not.toContain('pay at venue');
  });
});

describe('cardHoldConfirmationNotice (§10.2 email section)', () => {
  it('renders the exact spec copy with venue name and fee', () => {
    expect(cardHoldConfirmationNotice(heldBooking, 'Glow Studio')).toBe(
      'No payment has been taken. Your card is securely on file and Glow Studio may charge ' +
        'a no-show fee of up to £25.00 if you do not attend. Cancel before your booking ' +
        'starts to avoid any charge.',
    );
  });

  it('returns null without an open hold', () => {
    expect(
      cardHoldConfirmationNotice({ ...heldBooking, card_hold_fee_pence: null }, 'Glow Studio'),
    ).toBeNull();
    expect(
      cardHoldConfirmationNotice({ ...heldBooking, deposit_status: 'Charged' }, 'Glow Studio'),
    ).toBeNull();
  });

  it('quotes the cancellation deadline and covers late cancellations when refund_cutoff is set', () => {
    const notice = cardHoldConfirmationNotice(
      { ...heldBooking, refund_cutoff: '2026-07-08T19:00:00.000Z' },
      'Glow Studio',
    );
    expect(notice).toContain('if you do not attend or cancel late.');
    expect(notice).toContain('Cancel before ');
    expect(notice).toContain('to avoid any charge.');
    expect(notice).not.toContain('before your booking starts');
    expect(notice).not.toContain('\u2014');
  });

  it('falls back to the before-it-starts wording on an unparseable cutoff', () => {
    const notice = cardHoldConfirmationNotice(
      { ...heldBooking, refund_cutoff: 'not-a-date' },
      'Glow Studio',
    );
    expect(notice).toContain('Cancel before your booking starts to avoid any charge.');
  });
});

describe('no em-dashes in card-hold confirmation copy', () => {
  it('keeps every hold string em-dash free', () => {
    expect(confirmationPaymentPolicyText(heldBooking)).not.toMatch(EM_DASH);
    expect(bookingConfirmationSmsPriceSuffix(heldBooking)).not.toMatch(EM_DASH);
    expect(eventBookingConfirmationSmsPriceSuffix(heldBooking)).not.toMatch(EM_DASH);
    expect(cardHoldConfirmationNotice(heldBooking, 'Glow Studio')).not.toMatch(EM_DASH);
  });
});
