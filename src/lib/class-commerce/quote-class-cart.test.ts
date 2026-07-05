import { describe, expect, it } from 'vitest';
import { resolveClassCartLineCardHoldFee } from './quote-class-cart';

describe('resolveClassCartLineCardHoldFee', () => {
  it('returns no fee and no warning when the class type is not card_hold', () => {
    for (const req of ['none', 'deposit', 'full_payment', null, undefined]) {
      expect(
        resolveClassCartLineCardHoldFee({
          classTypePaymentRequirement: req,
          perPersonFeePence: 2500,
          partySize: 2,
          cardHoldDepositsEnabled: true,
        }),
      ).toEqual({ feePence: null, warning: null });
    }
  });

  it('returns per-person fee x party size when card_hold, flag on, fee configured', () => {
    expect(
      resolveClassCartLineCardHoldFee({
        classTypePaymentRequirement: 'card_hold',
        perPersonFeePence: 2500,
        partySize: 3,
        cardHoldDepositsEnabled: true,
      }),
    ).toEqual({ feePence: 7500, warning: null });
  });

  it('resolves as no hold with flag_off warning when the venue flag is off (design doc 6.3)', () => {
    expect(
      resolveClassCartLineCardHoldFee({
        classTypePaymentRequirement: 'card_hold',
        perPersonFeePence: 2500,
        partySize: 1,
        cardHoldDepositsEnabled: false,
      }),
    ).toEqual({ feePence: null, warning: 'flag_off' });
  });

  it('resolves as no hold with zero_fee warning when the per-person fee is missing or zero', () => {
    for (const fee of [0, null, undefined]) {
      expect(
        resolveClassCartLineCardHoldFee({
          classTypePaymentRequirement: 'card_hold',
          perPersonFeePence: fee,
          partySize: 2,
          cardHoldDepositsEnabled: true,
        }),
      ).toEqual({ feePence: null, warning: 'zero_fee' });
    }
  });

  it('treats a negative configured fee as zero_fee', () => {
    expect(
      resolveClassCartLineCardHoldFee({
        classTypePaymentRequirement: 'card_hold',
        perPersonFeePence: -100,
        partySize: 2,
        cardHoldDepositsEnabled: true,
      }),
    ).toEqual({ feePence: null, warning: 'zero_fee' });
  });
});
