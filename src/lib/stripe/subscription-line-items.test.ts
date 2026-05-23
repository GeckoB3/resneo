import { describe, expect, it } from 'vitest';
import { SIGNUP_TRIAL_DAYS } from '@/lib/signup-trial-copy';
import { buildSignupCheckoutSubscriptionData } from '@/lib/stripe/subscription-line-items';

describe('buildSignupCheckoutSubscriptionData', () => {
  it('sets a 14-day trial for new signup checkout', () => {
    expect(buildSignupCheckoutSubscriptionData()).toEqual({
      trial_period_days: SIGNUP_TRIAL_DAYS,
    });
  });
});
