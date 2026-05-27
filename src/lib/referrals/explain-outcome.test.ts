import { describe, expect, it } from 'vitest';
import { explainReferralOutcome } from './explain-outcome';

describe('explainReferralOutcome', () => {
  it('returns null for pending and signed-up rows', () => {
    expect(explainReferralOutcome('pending', null)).toBe(null);
    expect(explainReferralOutcome('referee_signed_up', null)).toBe(null);
    expect(explainReferralOutcome('credited', null)).toBe(null);
  });

  it('explains void via same-domain self-referral', () => {
    const out = explainReferralOutcome('void', 'self_referral_same_email_domain');
    expect(out).toContain('same business email domain');
    expect(out).toContain('Contact support');
  });

  it('explains void via same-card self-referral', () => {
    const out = explainReferralOutcome('void', 'self_referral_same_card_fingerprint');
    expect(out).toContain('same payment card');
    expect(out).toContain('Contact support');
  });

  it('explains void due to no Stripe customer (Founding Partner case)', () => {
    const out = explainReferralOutcome('void', 'referrer_has_no_stripe_customer');
    expect(out).toContain('no Stripe customer record');
    expect(out).toContain('Founding Partner');
  });

  it('falls back to a generic void message for unknown reason codes', () => {
    const out = explainReferralOutcome('void', 'something_unexpected');
    expect(out).toContain('anti-abuse');
    const outNull = explainReferralOutcome('void', null);
    expect(outNull).toContain('anti-abuse');
  });

  it('explains failed referrals from cancelled subscription', () => {
    const out = explainReferralOutcome('failed', 'referee_subscription_cancelled');
    expect(out).toContain('cancelled their subscription');
  });

  it('falls back to a generic failed message when reason is missing', () => {
    const out = explainReferralOutcome('failed', null);
    expect(out).toContain('did not convert');
  });
});
