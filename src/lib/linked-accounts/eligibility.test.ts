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

  // The reported bug: a venue on a free trial (plan_status 'trialing') was wrongly
  // shown "your subscription is inactive" and blocked from creating links.
  it('allows a venue on a free trial to create links', () => {
    const r = evaluateLinkEligibility({ pricing_tier: 'appointments', plan_status: 'trialing' });
    expect(r.feature).toBe(true);
    expect(r.canCreate).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('allows a superuser-complimentary venue even when its plan_status is not active', () => {
    const r = evaluateLinkEligibility({
      pricing_tier: 'plus',
      plan_status: 'cancelled',
      billing_access_source: 'superuser_free',
    });
    expect(r.canCreate).toBe(true);
  });

  it('allows a venue still inside its paid-through cancellation window', () => {
    const NOW = Date.UTC(2026, 5, 30);
    const future = new Date(NOW + 7 * 24 * 60 * 60 * 1000).toISOString();
    const r = evaluateLinkEligibility(
      { pricing_tier: 'plus', plan_status: 'cancelling', subscription_current_period_end: future },
      NOW,
    );
    expect(r.canCreate).toBe(true);
  });

  it('blocks canCreate when the plan has lapsed or fully expired', () => {
    const NOW = Date.UTC(2026, 5, 30);
    const past = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();
    const cases: { plan_status: string; subscription_current_period_end?: string }[] = [
      { plan_status: 'past_due' },
      { plan_status: 'cancelled' },
      // A scheduled cancellation whose paid-through date has already passed.
      { plan_status: 'cancelling', subscription_current_period_end: past },
    ];
    for (const c of cases) {
      const r = evaluateLinkEligibility({ pricing_tier: 'plus', ...c }, NOW);
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
