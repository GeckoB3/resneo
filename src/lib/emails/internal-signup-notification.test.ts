import { describe, it, expect } from 'vitest';
import { renderNewSignupNotificationEmail } from './internal-signup-notification';

describe('renderNewSignupNotificationEmail', () => {
  it('renders subject, html and text with the signup details', () => {
    const { subject, html, text } = renderNewSignupNotificationEmail({
      signupEmail: 'owner@example.com',
      plan: 'appointments',
      businessType: 'physiotherapist',
      planStatus: 'trialing',
      venueId: 'v-123',
      referralCode: 'FRIEND50',
      source: 'signup_complete',
    });

    expect(subject).toBe('New Resneo signup: owner@example.com (appointments)');
    for (const value of ['owner@example.com', 'appointments', 'physiotherapist', 'trialing', 'v-123', 'FRIEND50']) {
      expect(html).toContain(value);
      expect(text).toContain(value);
    }
    expect(html).toContain('Signup success page');
    expect(text).toContain('Provisioned via: Signup success page');
  });

  it('labels the webhook path and omits empty optional rows', () => {
    const { html, text } = renderNewSignupNotificationEmail({
      signupEmail: 'owner@example.com',
      plan: 'light',
      businessType: null,
      planStatus: null,
      venueId: 'v-456',
      referralCode: null,
      source: 'stripe_webhook',
    });

    expect(html).toContain('Stripe webhook');
    expect(text).not.toContain('Business type');
    expect(text).not.toContain('Plan status');
    expect(text).not.toContain('Referral code');
  });

  it('falls back to "unknown" and escapes html in user-supplied values', () => {
    const { subject, html } = renderNewSignupNotificationEmail({
      signupEmail: null,
      plan: null,
      businessType: '<script>alert(1)</script>',
      planStatus: null,
      venueId: 'v-789',
      source: 'stripe_webhook',
    });

    expect(subject).toBe('New Resneo signup: unknown (unknown)');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
