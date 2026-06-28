import { describe, expect, it } from 'vitest';
import { SIGNUP_TRIAL_DAYS } from '@/lib/signup-trial-copy';
import {
  buildSignupCheckoutSubscriptionData,
  buildSignupCheckoutSubscriptionDataWithReferral,
  buildSignupCheckoutSubscriptionDataWithSales,
} from '@/lib/stripe/subscription-line-items';
import { REFERRAL_REFEREE_BONUS_DAYS } from '@/lib/referrals/constants';
import { SALES_SIGNUP_TRIAL_DAYS, MAX_SALES_TRIAL_DAYS } from '@/lib/sales/constants';

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

describe('buildSignupCheckoutSubscriptionDataWithSales', () => {
  it('defaults to a flat one-month free trial (not the standard 14 days, not 14 + bonus)', () => {
    expect(buildSignupCheckoutSubscriptionDataWithSales()).toEqual({
      trial_period_days: SALES_SIGNUP_TRIAL_DAYS,
    });
    // "1 month free" must be a full month and strictly more than the standard trial.
    expect(SALES_SIGNUP_TRIAL_DAYS).toBe(30);
    expect(SALES_SIGNUP_TRIAL_DAYS).toBeGreaterThan(SIGNUP_TRIAL_DAYS);
  });

  it('honours a per-code custom trial length (e.g. 2 months)', () => {
    expect(buildSignupCheckoutSubscriptionDataWithSales(60)).toEqual({ trial_period_days: 60 });
  });

  it('clamps out-of-range or invalid trial lengths so Stripe never gets a bad value', () => {
    expect(buildSignupCheckoutSubscriptionDataWithSales(0)).toEqual({ trial_period_days: 1 });
    expect(buildSignupCheckoutSubscriptionDataWithSales(99999)).toEqual({
      trial_period_days: MAX_SALES_TRIAL_DAYS,
    });
    expect(buildSignupCheckoutSubscriptionDataWithSales(Number.NaN)).toEqual({
      trial_period_days: SALES_SIGNUP_TRIAL_DAYS,
    });
  });
});
