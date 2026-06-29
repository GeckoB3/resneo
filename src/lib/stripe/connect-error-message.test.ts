import { describe, it, expect } from 'vitest';
import {
  describeStripeConnectError,
  isPlatformProfileError,
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
  it('returns the friendly review message for the platform-profile gate', () => {
    expect(
      describeStripeConnectError(
        stripeErr('Please review the responsibilities of managing losses for connected accounts at https://dashboard.stripe.com/settings/connect/platform-profile.'),
      ),
    ).toBe(STRIPE_PLATFORM_PROFILE_MESSAGE);
  });

  it('surfaces other Stripe errors verbatim with a prefix', () => {
    expect(describeStripeConnectError(stripeErr('Invalid API Key provided'))).toBe(
      'Stripe error: Invalid API Key provided',
    );
  });

  it('stays generic for non-Stripe errors', () => {
    expect(describeStripeConnectError(new Error('boom'))).toBe('Internal server error');
    expect(describeStripeConnectError(null)).toBe('Internal server error');
  });

  it('friendly message contains no em-dash (user-facing copy rule)', () => {
    expect(STRIPE_PLATFORM_PROFILE_MESSAGE).not.toContain('—');
  });
});
