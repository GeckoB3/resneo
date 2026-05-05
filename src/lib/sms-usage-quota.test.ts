import { describe, expect, it } from 'vitest';
import { calculateSmsOverageDelta, resolveSmsBillingPeriod, wouldExceedSmsQuota } from '@/lib/sms-usage';

describe('wouldExceedSmsQuota', () => {
  it('blocks when allowance is zero', () => {
    expect(wouldExceedSmsQuota(0, 0, 1)).toBe(true);
    expect(wouldExceedSmsQuota(0, 0, 0)).toBe(false);
  });

  it('allows sends under cap', () => {
    expect(wouldExceedSmsQuota(0, 300, 1)).toBe(false);
    expect(wouldExceedSmsQuota(299, 300, 1)).toBe(false);
  });

  it('blocks at cap', () => {
    expect(wouldExceedSmsQuota(300, 300, 1)).toBe(true);
    expect(wouldExceedSmsQuota(800, 800, 1)).toBe(true);
  });

  it('uses segment increments when checking the cap', () => {
    expect(wouldExceedSmsQuota(298, 300, 2)).toBe(false);
    expect(wouldExceedSmsQuota(299, 300, 2)).toBe(true);
  });
});

describe('calculateSmsOverageDelta', () => {
  it('returns only the newly billable segments beyond allowance', () => {
    expect(calculateSmsOverageDelta(298, 300, 2)).toBe(0);
    expect(calculateSmsOverageDelta(299, 300, 2)).toBe(1);
    expect(calculateSmsOverageDelta(300, 300, 2)).toBe(2);
  });
});

describe('resolveSmsBillingPeriod', () => {
  it('uses the active Stripe subscription period when the send is inside it', () => {
    const period = resolveSmsBillingPeriod(
      {
        subscription_current_period_start: '2026-05-03T10:00:00.000Z',
        subscription_current_period_end: '2026-06-03T10:00:00.000Z',
      },
      new Date('2026-05-10T12:00:00.000Z'),
    );

    expect(period.billingMonth).toBe('2026-05-01');
    expect(period.periodStartIso).toBe('2026-05-03T10:00:00.000Z');
    expect(period.periodEndIso).toBe('2026-06-03T10:00:00.000Z');
    expect(period.stripeTimestamp).toBe(Math.floor(Date.parse('2026-05-10T12:00:00.000Z') / 1000));
  });

  it('falls back to the calendar month when no active Stripe period is available', () => {
    const period = resolveSmsBillingPeriod({}, new Date('2026-05-10T12:00:00.000Z'));

    expect(period.billingMonth).toBe('2026-05-01');
    expect(period.periodStartIso).toBeNull();
    expect(period.periodEndIso).toBeNull();
  });
});
