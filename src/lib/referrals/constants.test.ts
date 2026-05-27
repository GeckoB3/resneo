import { afterEach, describe, expect, it } from 'vitest';
import { formatGbpPence, referralRewardPenceForTier } from './constants';

afterEach(() => {
  delete process.env.REFERRAL_REWARD_LIGHT_PENCE;
  delete process.env.REFERRAL_REWARD_PLUS_PENCE;
  delete process.env.REFERRAL_REWARD_APPOINTMENTS_PENCE;
  delete process.env.REFERRAL_REWARD_RESTAURANT_PENCE;
});

describe('formatGbpPence', () => {
  it('formats whole pounds without decimals', () => {
    expect(formatGbpPence(9900)).toBe('£99');
    expect(formatGbpPence(2000)).toBe('£20');
    expect(formatGbpPence(0)).toBe('£0');
  });

  it('formats fractional amounts with 2dp', () => {
    expect(formatGbpPence(9950)).toBe('£99.50');
    expect(formatGbpPence(1234)).toBe('£12.34');
  });
});

describe('referralRewardPenceForTier', () => {
  it('returns price-aligned defaults by tier', () => {
    expect(referralRewardPenceForTier('light')).toBe(2000);
    expect(referralRewardPenceForTier('plus')).toBe(4900);
    expect(referralRewardPenceForTier('appointments')).toBe(9900);
    expect(referralRewardPenceForTier('restaurant')).toBe(7900);
  });

  it('treats founding like restaurant', () => {
    expect(referralRewardPenceForTier('founding')).toBe(7900);
  });

  it('falls back to lowest tier for unknown values', () => {
    expect(referralRewardPenceForTier(null)).toBe(2000);
    expect(referralRewardPenceForTier('mystery')).toBe(2000);
  });

  it('honours env overrides', () => {
    process.env.REFERRAL_REWARD_APPOINTMENTS_PENCE = '12345';
    expect(referralRewardPenceForTier('appointments')).toBe(12345);
  });
});
