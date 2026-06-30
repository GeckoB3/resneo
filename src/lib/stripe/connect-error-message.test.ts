import { describe, it, expect } from 'vitest';
import {
  describeStripeConnectError,
  isPlatformProfileError,
  STRIPE_GENERIC_ERROR_MESSAGE,
  STRIPE_LOGIN_LINK_ERROR_MESSAGE,
  STRIPE_PLATFORM_PROFILE_MESSAGE,
} from './connect-error-message';

function stripeErr(message: string) {
  return { type: 'StripeInvalidRequestError', message };
}

describe('isPlatformProfileError', () => {
  it('matches the managing-losses / platform-profile gate', () => {
    expect(
      isPlatformProfileError(
        'Please review the responsibilities of managing losses for connected accounts at https://dashboard.stripe.com/settings/connect/platform-profile.',
      ),
    ).toBe(true);
    expect(isPlatformProfileError('Your platform profile is under review.')).toBe(true);
  });
  it('does not match unrelated Stripe errors', () => {
    expect(isPlatformProfileError('Invalid API Key provided')).toBe(false);
    expect(isPlatformProfileError('No such account: acct_123')).toBe(false);
  });
});

describe('describeStripeConnectError', () => {
  it('returns the short review message for the platform-profile gate', () => {
    expect(
      describeStripeConnectError(
        stripeErr('Please review the responsibilities of managing losses for connected accounts at https://dashboard.stripe.com/settings/connect/platform-profile.'),
      ),
    ).toBe(STRIPE_PLATFORM_PROFILE_MESSAGE);
  });

  it('returns a short generic message for other Stripe errors (detail stays in server logs)', () => {
    expect(describeStripeConnectError(stripeErr('Invalid API Key provided'))).toBe(
      STRIPE_GENERIC_ERROR_MESSAGE,
    );
  });

  it('stays generic for non-Stripe errors', () => {
    expect(describeStripeConnectError(new Error('boom'))).toBe('Internal server error');
    expect(describeStripeConnectError(null)).toBe('Internal server error');
  });

  it('user-facing messages are short and have no em-dash', () => {
    for (const msg of [
      STRIPE_PLATFORM_PROFILE_MESSAGE,
      STRIPE_GENERIC_ERROR_MESSAGE,
      STRIPE_LOGIN_LINK_ERROR_MESSAGE,
    ]) {
      expect(msg).not.toContain('—');
      expect(msg.length).toBeLessThan(100);
    }
  });
});
