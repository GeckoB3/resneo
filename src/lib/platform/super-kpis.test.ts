import { describe, expect, it } from 'vitest';
import { computeSuperKpis, type SuperKpiVenueRow } from './super-kpis';

const NOW = Date.parse('2026-09-04T12:00:00Z');

function venue(over: Partial<SuperKpiVenueRow> & { id: string }): SuperKpiVenueRow {
  return { pricing_tier: 'plus', plan_status: 'active', is_test: false, ...over };
}

describe('computeSuperKpis', () => {
  it('counts only paying, trialing, past due and complimentary venues as live', () => {
    const kpis = computeSuperKpis(
      [
        venue({ id: 'a', plan_status: 'active' }),
        venue({ id: 'b', plan_status: 'trialing' }),
        venue({ id: 'c', plan_status: 'past_due' }),
        venue({ id: 'd', plan_status: 'cancelled' }),
        venue({ id: 'e', plan_status: 'cancelling', subscription_current_period_end: '2026-12-01T00:00:00Z' }),
        venue({ id: 'f', plan_status: 'cancelled', billing_access_source: 'superuser_free' }),
        venue({ id: 't', plan_status: 'active', is_test: true }),
      ],
      35,
      NOW,
    );
    expect(kpis).toMatchObject({
      liveVenues: 4,
      paying: 1,
      trialing: 1,
      pastDue: 1,
      cancelled: 2,
      freeAccess: 1,
      testVenues: 1,
      staffLogins: 35,
    });
  });

  it('reads a cancelling venue past its period end as cancelled', () => {
    const kpis = computeSuperKpis(
      [venue({ id: 'a', plan_status: 'cancelling', subscription_current_period_end: '2026-08-01T00:00:00Z' })],
      0,
      NOW,
    );
    expect(kpis.cancelled).toBe(1);
    expect(kpis.liveVenues).toBe(0);
  });

  it('splits live venues by plan tier so the tier cards add up to the headline', () => {
    const kpis = computeSuperKpis(
      [
        venue({ id: 'a', pricing_tier: 'light' }),
        venue({ id: 'b', pricing_tier: 'plus' }),
        venue({ id: 'c', pricing_tier: 'appointments' }),
        venue({ id: 'd', pricing_tier: 'restaurant' }),
        venue({ id: 'e', pricing_tier: 'founding', plan_status: 'trialing' }),
        // Cancelled venues keep their tier but are not live, so they are not in either tier card.
        venue({ id: 'f', pricing_tier: 'restaurant', plan_status: 'cancelled' }),
        venue({ id: 'g', pricing_tier: 'plus', plan_status: 'cancelled' }),
      ],
      0,
      NOW,
    );
    expect(kpis.liveVenues).toBe(5);
    expect(kpis.appointmentsPlans).toBe(3);
    expect(kpis.restaurantFounding).toBe(2);
    expect(kpis.appointmentsPlans + kpis.restaurantFounding).toBe(kpis.liveVenues);
  });

  it('does not count a complimentary venue as paying even when its stored status is active', () => {
    const kpis = computeSuperKpis([venue({ id: 'a', billing_access_source: 'superuser_free' })], 0, NOW);
    expect(kpis.paying).toBe(0);
    expect(kpis.freeAccess).toBe(1);
    expect(kpis.liveVenues).toBe(1);
  });
});
