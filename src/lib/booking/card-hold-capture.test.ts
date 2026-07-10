import { describe, expect, it } from 'vitest';
import { resolveCaptureMode, type CaptureUnitLine } from './card-hold-capture';

function line(overrides: Partial<CaptureUnitLine>): CaptureUnitLine {
  return { bookingId: 'b1', chargePence: 0, cardHoldFeePence: null, ...overrides };
}

describe('resolveCaptureMode', () => {
  it('returns none when there is no money due and no hold', () => {
    expect(resolveCaptureMode([line({ bookingId: 'b1' })])).toBe('none');
    expect(resolveCaptureMode([])).toBe('none');
  });

  it('returns payment when money is due and no line requires a hold', () => {
    expect(resolveCaptureMode([line({ bookingId: 'b1', chargePence: 1500 })])).toBe('payment');
  });

  it('returns setup when a hold is required and nothing is chargeable', () => {
    expect(resolveCaptureMode([line({ bookingId: 'b1', cardHoldFeePence: 2500 })])).toBe('setup');
  });

  it('returns payment_with_setup when money is due and a hold is required', () => {
    expect(
      resolveCaptureMode([line({ bookingId: 'b1', chargePence: 1500, cardHoldFeePence: 2500 })]),
    ).toBe('payment_with_setup');
  });

  it('returns payment_with_setup for a mixed cart of paid and card-hold lines', () => {
    expect(
      resolveCaptureMode([
        line({ bookingId: 'b1', chargePence: 2000 }),
        line({ bookingId: 'b2', cardHoldFeePence: 1000 }),
      ]),
    ).toBe('payment_with_setup');
  });

  it('returns setup when every paid line is covered and one line requires a hold', () => {
    expect(
      resolveCaptureMode([
        line({ bookingId: 'b1' }), // entitlement-covered, nothing due
        line({ bookingId: 'b2', cardHoldFeePence: 1200 }),
      ]),
    ).toBe('setup');
  });

  it('returns payment for a multi-line unit with money due on several lines and no holds', () => {
    expect(
      resolveCaptureMode([
        line({ bookingId: 'b1', chargePence: 500 }),
        line({ bookingId: 'b2', chargePence: 700 }),
      ]),
    ).toBe('payment');
  });

  it('treats a zero-fee hold line (cardHoldFeePence: 0) as a hold, matching the null check', () => {
    // The discriminator is non-null, not > 0; fee validity is enforced upstream and by the DB CHECK.
    expect(resolveCaptureMode([line({ bookingId: 'b1', cardHoldFeePence: 0 })])).toBe('setup');
  });
});
