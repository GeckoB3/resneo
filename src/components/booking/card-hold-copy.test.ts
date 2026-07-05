import { describe, expect, it } from 'vitest';
import {
  CARD_HOLD_CHARGE_ACTION_LABEL,
  CARD_HOLD_CHARGE_DIALOG_TITLE,
  CARD_HOLD_PAYMENT_WITH_SETUP_CONFIRMATION_LINE,
  CARD_HOLD_REFUND_ACTION_LABEL,
  CARD_HOLD_RESEND_LINK_LABEL,
  CARD_HOLD_SETUP_CONFIRMATION_LINE,
  CARD_HOLD_SETUP_HEADING,
  CARD_HOLD_SETUP_SUBHEADING,
  CARD_HOLD_SETUP_SUBMIT_LABEL,
  cardHoldBookingNoticeLine,
  cardHoldCatalogNoticeLine,
  cardHoldChargeConfirmLabel,
  cardHoldChargeDialogBody,
  cardHoldChargeFailurePlainReason,
  cardHoldConfirmationLine,
  cardHoldPaymentWithSetupBodyText,
  cardHoldSetupBodyText,
  isCardHoldPaymentMode,
} from './card-hold-copy';

describe('setup mode strings (spec 7.3, exact)', () => {
  it('uses the exact heading and sub-heading', () => {
    expect(CARD_HOLD_SETUP_HEADING).toBe('Secure your booking');
    expect(CARD_HOLD_SETUP_SUBHEADING).toBe('No payment is taken today.');
  });

  it('uses the exact submit label', () => {
    expect(CARD_HOLD_SETUP_SUBMIT_LABEL).toBe('Save card and book');
  });

  it('renders the exact setup body with venue name and fee', () => {
    expect(cardHoldSetupBodyText('The Copper Room', 2500)).toBe(
      'Your card details are stored securely by our payment provider, Stripe. ' +
        'The Copper Room may charge a no-show fee of up to £25.00 if you miss your booking.',
    );
  });

  it('renders the exact payment_with_setup body', () => {
    expect(cardHoldPaymentWithSetupBodyText('Studio 9', 1250)).toBe(
      'Your card will also be stored securely. ' +
        'Studio 9 may charge a no-show fee of up to £12.50 if you miss your booking.',
    );
  });
});

describe('cardHoldCatalogNoticeLine', () => {
  it('renders the catalog hint', () => {
    expect(cardHoldCatalogNoticeLine(2500)).toBe(
      'No-show fee of £25.00 applies. No payment is taken when you book.',
    );
  });

  it('adds per person when applicable', () => {
    expect(cardHoldCatalogNoticeLine(500, { perPerson: true })).toBe(
      'No-show fee of £5.00 per person applies. No payment is taken when you book.',
    );
  });
});

describe('cardHoldBookingNoticeLine', () => {
  it('renders the booking-step banner with the fee', () => {
    expect(cardHoldBookingNoticeLine(1000)).toBe(
      'No payment is taken when you book. A no-show fee of up to £10.00 may apply if you do not attend.',
    );
  });

  it('degrades to a fee-less sentence when no amount is known', () => {
    expect(cardHoldBookingNoticeLine(0)).toBe(
      'No payment is taken when you book. A no-show fee may apply if you do not attend.',
    );
  });
});

describe('cardHoldConfirmationLine', () => {
  it('returns the setup confirmation line', () => {
    expect(cardHoldConfirmationLine('setup')).toBe(CARD_HOLD_SETUP_CONFIRMATION_LINE);
    expect(CARD_HOLD_SETUP_CONFIRMATION_LINE).toBe('Card saved. No payment has been taken.');
  });

  it('returns the payment_with_setup confirmation line', () => {
    expect(cardHoldConfirmationLine('payment_with_setup')).toBe(
      CARD_HOLD_PAYMENT_WITH_SETUP_CONFIRMATION_LINE,
    );
    expect(CARD_HOLD_PAYMENT_WITH_SETUP_CONFIRMATION_LINE).toBe(
      'Your card has been stored securely for this booking.',
    );
  });

  it('returns null for plain payment mode and undefined', () => {
    expect(cardHoldConfirmationLine('payment')).toBeNull();
    expect(cardHoldConfirmationLine(undefined)).toBeNull();
    expect(cardHoldConfirmationLine(null)).toBeNull();
  });
});

describe('isCardHoldPaymentMode', () => {
  it('flags both hold modes and nothing else', () => {
    expect(isCardHoldPaymentMode('setup')).toBe(true);
    expect(isCardHoldPaymentMode('payment_with_setup')).toBe(true);
    expect(isCardHoldPaymentMode('payment')).toBe(false);
    expect(isCardHoldPaymentMode(undefined)).toBe(false);
    expect(isCardHoldPaymentMode(null)).toBe(false);
  });
});

describe('staff charge dialog copy (spec 9.2, exact)', () => {
  it('uses the exact title and action labels', () => {
    expect(CARD_HOLD_CHARGE_DIALOG_TITLE).toBe('Charge no-show fee');
    expect(CARD_HOLD_CHARGE_ACTION_LABEL).toBe('Charge no-show fee');
    expect(CARD_HOLD_REFUND_ACTION_LABEL).toBe('Refund no-show fee');
    expect(CARD_HOLD_RESEND_LINK_LABEL).toBe('Resend link');
  });

  it('renders the exact dialog body with guest name and max fee', () => {
    expect(cardHoldChargeDialogBody('Amina Khan', 2500)).toBe(
      "Charge Amina Khan's saved card for missing this booking. The maximum you can charge is £25.00.",
    );
  });

  it('renders the live confirm label from the entered amount', () => {
    expect(cardHoldChargeConfirmLabel(2500)).toBe('Charge £25.00');
    expect(cardHoldChargeConfirmLabel(150)).toBe('Charge £1.50');
  });

  it('maps failure codes to plain words with a generic fallback', () => {
    expect(cardHoldChargeFailurePlainReason('card_declined')).toBe('the card was declined');
    expect(cardHoldChargeFailurePlainReason('authentication_required')).toBe(
      'the card issuer requires the client to authorise the payment',
    );
    expect(cardHoldChargeFailurePlainReason('some_unknown_code')).toBe(
      'the payment did not go through',
    );
  });
});

describe('no em-dashes in any guest-facing card-hold copy', () => {
  it('contains no U+2014 characters', () => {
    const all = [
      CARD_HOLD_SETUP_HEADING,
      CARD_HOLD_SETUP_SUBHEADING,
      CARD_HOLD_SETUP_SUBMIT_LABEL,
      CARD_HOLD_SETUP_CONFIRMATION_LINE,
      CARD_HOLD_PAYMENT_WITH_SETUP_CONFIRMATION_LINE,
      cardHoldSetupBodyText('Venue', 2500),
      cardHoldPaymentWithSetupBodyText('Venue', 2500),
      cardHoldCatalogNoticeLine(2500, { perPerson: true }),
      cardHoldBookingNoticeLine(2500),
      cardHoldBookingNoticeLine(0),
      CARD_HOLD_CHARGE_DIALOG_TITLE,
      CARD_HOLD_CHARGE_ACTION_LABEL,
      CARD_HOLD_REFUND_ACTION_LABEL,
      CARD_HOLD_RESEND_LINK_LABEL,
      cardHoldChargeDialogBody('Guest', 2500),
      cardHoldChargeConfirmLabel(2500),
      cardHoldChargeFailurePlainReason('card_declined'),
      cardHoldChargeFailurePlainReason('authentication_required'),
      cardHoldChargeFailurePlainReason('other'),
    ].join('\n');
    expect(all).not.toContain('—');
  });
});
