import { describe, expect, it } from 'vitest';
import { evaluateLinkEligibility, isLinkFeatureVenue } from './eligibility';

describe('evaluateLinkEligibility', () => {
  it('allows an active appointments-family venue (canCreate)', () => {
    for (const tier of ['appointments', 'light', 'plus']) {
      const r = evaluateLinkEligibility({ pricing_tier: tier, plan_status: 'active' });
      expect(r.feature).toBe(true);
      expect(r.canCreate).toBe(true);
    }
  });

  it('treats a null plan_status as active', () => {
    const r = evaluateLinkEligibility({ pricing_tier: 'appointments', plan_status: null });
    expect(r.canCreate).toBe(true);
  });

  it('keeps the feature but blocks canCreate when the plan is inactive', () => {
    for (const status of ['past_due', 'cancelled', 'paused']) {
      const r = evaluateLinkEligibility({ pricing_tier: 'plus', plan_status: status });
      expect(r.feature).toBe(true);
      expect(r.canCreate).toBe(false);
      expect(r.reason).toBeTruthy();
    }
  });

  it('excludes restaurant table-reservation venues entirely', () => {
    const r = evaluateLinkEligibility({
      pricing_tier: 'restaurant',
      plan_status: 'active',
      booking_model: 'table_reservation',
    });
    expect(r.feature).toBe(false);
    expect(r.canCreate).toBe(false);
  });

  it('falls back to a non-table booking model on an unusual tier', () => {
    const r = evaluateLinkEligibility({
      pricing_tier: 'legacy',
      plan_status: 'active',
      booking_model: 'unified_scheduling',
    });
    expect(r.feature).toBe(true);
    expect(r.canCreate).toBe(true);
  });

  // §16.1 #6 — a restaurant/founding venue must never pass the gate, even if its
  // booking_model is non-table (the previous OR-fallback let it slip through).
  it('excludes restaurant/founding tiers even with a non-table booking model', () => {
    for (const tier of ['restaurant', 'founding']) {
      const r = evaluateLinkEligibility({
        pricing_tier: tier,
        plan_status: 'active',
        booking_model: 'unified_scheduling',
      });
      expect(r.feature).toBe(false);
      expect(r.canCreate).toBe(false);
    }
  });
});

describe('isLinkFeatureVenue', () => {
  it('is true for appointments-family tiers regardless of booking model', () => {
    expect(isLinkFeatureVenue({ pricing_tier: 'appointments' })).toBe(true);
    expect(isLinkFeatureVenue({ pricing_tier: 'light', booking_model: '' })).toBe(true);
  });

  it('is false for a table-reservation product', () => {
    expect(
      isLinkFeatureVenue({ pricing_tier: 'restaurant', booking_model: 'table_reservation' }),
    ).toBe(false);
  });
});
