import { describe, expect, it } from 'vitest';
import { decideClassLineEntitlement } from '@/lib/class-commerce/entitlement-engine';

const base = {
  onlineChargePence: 2500,
  paymentRequirement: 'full_payment' as const,
  courseCovers: false,
  membershipCovers: false,
  payWithClassCredits: false,
  creditsAvailableForClassType: 0,
  partySize: 1,
};

describe('decideClassLineEntitlement', () => {
  it('returns free when there is no online charge', () => {
    const d = decideClassLineEntitlement({
      ...base,
      onlineChargePence: 0,
      paymentRequirement: 'none',
      courseCovers: true,
      membershipCovers: true,
      payWithClassCredits: true,
      creditsAvailableForClassType: 5,
      partySize: 2,
    });
    expect(d.kind).toBe('free');
    expect(d.stripeAmountPence).toBe(0);
    expect(d.creditsToRedeem).toBe(0);
  });

  it('prefers course coverage over credits even when paying with credits', () => {
    const d = decideClassLineEntitlement({
      ...base,
      onlineChargePence: 2500,
      courseCovers: true,
      payWithClassCredits: true,
      creditsAvailableForClassType: 5,
      partySize: 2,
    });
    expect(d.kind).toBe('course');
    expect(d.stripeAmountPence).toBe(0);
    expect(d.creditsToRedeem).toBe(0);
  });

  it('prefers course coverage over membership', () => {
    const d = decideClassLineEntitlement({
      ...base,
      courseCovers: true,
      membershipCovers: true,
    });
    expect(d.kind).toBe('course');
  });

  it('prefers membership coverage over credits even when paying with credits', () => {
    const d = decideClassLineEntitlement({
      ...base,
      onlineChargePence: 2500,
      membershipCovers: true,
      payWithClassCredits: true,
      creditsAvailableForClassType: 5,
      partySize: 2,
    });
    expect(d.kind).toBe('membership');
    expect(d.stripeAmountPence).toBe(0);
    expect(d.creditsToRedeem).toBe(0);
  });

  it('consumes credits only when the guest opted in and the balance covers party size', () => {
    const d = decideClassLineEntitlement({
      ...base,
      onlineChargePence: 2500,
      payWithClassCredits: true,
      creditsAvailableForClassType: 2,
      partySize: 2,
    });
    expect(d.kind).toBe('credits');
    expect(d.creditsToRedeem).toBe(2);
    expect(d.stripeAmountPence).toBe(0);
  });

  it('does NOT consume credits when the guest did not opt in', () => {
    const d = decideClassLineEntitlement({
      ...base,
      onlineChargePence: 2500,
      payWithClassCredits: false,
      creditsAvailableForClassType: 5,
      partySize: 2,
    });
    expect(d.kind).toBe('stripe');
    expect(d.stripeAmountPence).toBe(2500);
    expect(d.creditsToRedeem).toBe(0);
  });

  it('falls back to stripe when opted in but credits are insufficient', () => {
    const d = decideClassLineEntitlement({
      ...base,
      onlineChargePence: 1200,
      paymentRequirement: 'deposit',
      payWithClassCredits: true,
      creditsAvailableForClassType: 1,
      partySize: 2,
    });
    expect(d.kind).toBe('stripe');
    expect(d.stripeAmountPence).toBe(1200);
    expect(d.creditsToRedeem).toBe(0);
  });

  it('falls back to stripe when nothing covers the line', () => {
    const d = decideClassLineEntitlement({
      ...base,
      onlineChargePence: 2500,
    });
    expect(d.kind).toBe('stripe');
    expect(d.stripeAmountPence).toBe(2500);
  });
});
