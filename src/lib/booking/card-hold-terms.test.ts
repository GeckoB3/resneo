import { describe, expect, it } from 'vitest';
import {
  CARD_HOLD_CHARGE_WINDOW_DAYS,
  buildCardHoldTermsSnapshot,
  cardHoldChargeWindowEndsAt,
  formatCardHoldFeePence,
  renderCardHoldConsentText,
} from './card-hold-terms';

describe('formatCardHoldFeePence', () => {
  it('formats whole pounds with two decimal places', () => {
    expect(formatCardHoldFeePence(2500)).toBe('£25.00');
  });

  it('formats sub-pound amounts', () => {
    expect(formatCardHoldFeePence(50)).toBe('£0.50');
  });

  it('formats mixed pounds and pence', () => {
    expect(formatCardHoldFeePence(1099)).toBe('£10.99');
  });
});

describe('renderCardHoldConsentText', () => {
  it('renders the exact consent string with the venue name and formatted fee', () => {
    expect(renderCardHoldConsentText('The Copper Room', 2500)).toBe(
      'By saving your card you authorise The Copper Room to charge up to £25.00 if you do not attend. ' +
        'If you cancel the booking before it starts, nothing extra will be charged.',
    );
  });

  it('quotes the cancellation notice when one applies (late cancellations chargeable)', () => {
    expect(renderCardHoldConsentText('The Copper Room', 2500, 24)).toBe(
      'By saving your card you authorise The Copper Room to charge up to £25.00 ' +
        'if you do not attend, or if you cancel less than 24 hours before your booking starts. ' +
        'If you cancel earlier than that, nothing extra will be charged.',
    );
  });

  it('singularises a one-hour notice', () => {
    expect(renderCardHoldConsentText('Venue', 2500, 1)).toContain('less than 1 hour before');
  });

  it('keeps the before-it-starts wording when the notice is zero or unknown', () => {
    for (const hours of [0, null, undefined]) {
      expect(renderCardHoldConsentText('Venue', 2500, hours)).toContain(
        'If you cancel the booking before it starts, nothing extra will be charged.',
      );
    }
  });

  it('formats non-round fees in the consent text', () => {
    expect(renderCardHoldConsentText('Studio 9', 1250)).toContain('charge up to £12.50 if you do not attend');
  });

  it('contains no em-dashes', () => {
    expect(renderCardHoldConsentText('Venue', 2500)).not.toContain('—');
    expect(renderCardHoldConsentText('Venue', 2500, 48)).not.toContain('—');
  });
});

describe('buildCardHoldTermsSnapshot', () => {
  it('returns the version 2 snapshot shape with a null accepted_at', () => {
    expect(buildCardHoldTermsSnapshot('The Copper Room', 2500)).toEqual({
      version: 2,
      text:
        'By saving your card you authorise The Copper Room to charge up to £25.00 if you do not attend. ' +
        'If you cancel the booking before it starts, nothing extra will be charged.',
      fee_pence: 2500,
      accepted_at: null,
    });
  });

  it('embeds the cancellation notice in the snapshotted text', () => {
    expect(buildCardHoldTermsSnapshot('The Copper Room', 2500, 48).text).toContain(
      'or if you cancel less than 48 hours before your booking starts',
    );
  });

  it('stores the unit total fee in pence, not the formatted string', () => {
    expect(buildCardHoldTermsSnapshot('Venue', 1099).fee_pence).toBe(1099);
  });
});

describe('cardHoldChargeWindowEndsAt', () => {
  it('is 14 days', () => {
    expect(CARD_HOLD_CHARGE_WINDOW_DAYS).toBe(14);
  });

  it('adds the charge window to the booking end', () => {
    expect(cardHoldChargeWindowEndsAt('2026-07-01T19:00:00.000Z')).toBe('2026-07-15T19:00:00.000Z');
  });

  it('crosses month boundaries correctly', () => {
    expect(cardHoldChargeWindowEndsAt('2026-01-25T09:30:00.000Z')).toBe('2026-02-08T09:30:00.000Z');
  });
});
