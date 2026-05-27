import { describe, expect, it } from 'vitest';
import { SIGNUP_TRIAL_DAYS } from '@/lib/signup-trial-copy';
import {
  buildSignupCheckoutSubscriptionData,
  buildSignupCheckoutSubscriptionDataWithReferral,
} from '@/lib/stripe/subscription-line-items';
import { REFERRAL_REFEREE_BONUS_DAYS } from '@/lib/referrals/constants';

describe('buildSignupCheckoutSubscriptionData', () => {
  it('sets a 14-day trial for new signup checkout', () => {
    expect(buildSignupCheckoutSubscriptionData()).toEqual({
      trial_period_days: SIGNUP_TRIAL_DAYS,
    });
  });
});

describe('buildSignupCheckoutSubscriptionDataWithReferral', () => {
  it('extends the trial by REFERRAL_REFEREE_BONUS_DAYS', () => {
    expect(buildSignupCheckoutSubscriptionDataWithReferral()).toEqual({
      trial_period_days: SIGNUP_TRIAL_DAYS + REFERRAL_REFEREE_BONUS_DAYS,
    });
  });
});
