import { describe, expect, it } from 'vitest';
import {
  areVenueSubscriptionMutationsBlocked,
  effectivePlanStatus,
  hasPaidAccessUntilPeriodEnd,
  isExpiredCancelledAccess,
  isPublicOnlineBookingBlocked,
  isVenueSubscriptionExpiredCancelled,
  parseSubscriptionPeriodEndMs,
  resolveVenueSubscriptionEntitlement,
} from './subscription-entitlement';

const NOW = 1_704_000_000_000; // fixed clock

describe('effectivePlanStatus', () => {
  const future = new Date(NOW + 86_400_000).toISOString();
  const past = new Date(NOW - 86_400_000).toISOString();

  it('keeps cancelling when the period end is still in the future', () => {
    expect(effectivePlanStatus('cancelling', future, NOW)).toBe('cancelling');
  });
  it('downgrades cancelling to cancelled once the period end has passed', () => {
    expect(effectivePlanStatus('cancelling', past, NOW)).toBe('cancelled');
  });
  it('keeps cancelling when the period end is unknown (do not block on missing data)', () => {
    expect(effectivePlanStatus('cancelling', null, NOW)).toBe('cancelling');
    expect(effectivePlanStatus('cancelling', '', NOW)).toBe('cancelling');
  });
  it('passes other statuses through unchanged', () => {
    expect(effectivePlanStatus('active', past, NOW)).toBe('active');
    expect(effectivePlanStatus('trialing', past, NOW)).toBe('trialing');
    expect(effectivePlanStatus('past_due', past, NOW)).toBe('past_due');
    expect(effectivePlanStatus('cancelled', past, NOW)).toBe('cancelled');
  });
  it('normalises casing and whitespace', () => {
    expect(effectivePlanStatus('  CANCELLING  ', past, NOW)).toBe('cancelled');
    expect(effectivePlanStatus('Active', null, NOW)).toBe('active');
  });
});

describe('parseSubscriptionPeriodEndMs', () => {
  it('returns null for empty', () => {
    expect(parseSubscriptionPeriodEndMs(null)).toBeNull();
    expect(parseSubscriptionPeriodEndMs('')).toBeNull();
  });
  it('parses valid ISO', () => {
    const iso = '2024-01-15T12:00:00.000Z';
    expect(parseSubscriptionPeriodEndMs(iso)).toBe(Date.parse(iso));
  });
});

describe('hasPaidAccessUntilPeriodEnd', () => {
  it('is true for cancelled with future period end', () => {
    const end = new Date(NOW + 86_400_000).toISOString();
    expect(hasPaidAccessUntilPeriodEnd('cancelled', end, NOW)).toBe(true);
  });
  it('is true for cancelling with future period end', () => {
    const end = new Date(NOW + 86_400_000).toISOString();
    expect(hasPaidAccessUntilPeriodEnd('cancelling', end, NOW)).toBe(true);
  });
  it('is false when period end in past', () => {
    const end = new Date(NOW - 86_400_000).toISOString();
    expect(hasPaidAccessUntilPeriodEnd('cancelled', end, NOW)).toBe(false);
  });
});

describe('isExpiredCancelledAccess', () => {
  it('is true for cancelled and no future access', () => {
    const end = new Date(NOW - 86_400_000).toISOString();
    expect(isExpiredCancelledAccess('cancelled', end, NOW)).toBe(true);
  });
  it('is false for cancelled with future end', () => {
    const end = new Date(NOW + 86_400_000).toISOString();
    expect(isExpiredCancelledAccess('cancelled', end, NOW)).toBe(false);
  });
  it('is true for cancelling once its period end has passed', () => {
    expect(isExpiredCancelledAccess('cancelling', new Date(NOW - 86_400_000).toISOString(), NOW)).toBe(true);
  });
  it('is false for cancelling with a future period end', () => {
    expect(isExpiredCancelledAccess('cancelling', new Date(NOW + 86_400_000).toISOString(), NOW)).toBe(false);
  });
  it('is false for cancelling with no period end (do not block on missing data)', () => {
    expect(isExpiredCancelledAccess('cancelling', null, NOW)).toBe(false);
  });
});

describe('resolveVenueSubscriptionEntitlement', () => {
  it('returns free_access for superuser comp', () => {
    expect(
      resolveVenueSubscriptionEntitlement(
        { plan_status: 'cancelled', billing_access_source: 'superuser_free' },
        NOW,
      ).kind,
    ).toBe('free_access');
  });
  it('returns past_due when plan_status is past_due', () => {
    expect(resolveVenueSubscriptionEntitlement({ plan_status: 'past_due' }, NOW).kind).toBe('past_due');
  });
  it('returns active_like for active and trialling', () => {
    expect(resolveVenueSubscriptionEntitlement({ plan_status: 'active' }, NOW).kind).toBe('active_like');
    expect(resolveVenueSubscriptionEntitlement({ plan_status: 'trialing' }, NOW).kind).toBe('active_like');
  });
  it('returns active_like for cancelling with no period end or a future one', () => {
    expect(resolveVenueSubscriptionEntitlement({ plan_status: 'cancelling' }, NOW).kind).toBe('active_like');
    expect(
      resolveVenueSubscriptionEntitlement(
        { plan_status: 'cancelling', subscription_current_period_end: new Date(NOW + 86_400_000).toISOString() },
        NOW,
      ).kind,
    ).toBe('active_like');
  });
  it('returns expired_cancelled for cancelling stuck past its period end (missed deleted webhook)', () => {
    expect(
      resolveVenueSubscriptionEntitlement(
        { plan_status: 'cancelling', subscription_current_period_end: new Date(NOW - 86_400_000).toISOString() },
        NOW,
      ).kind,
    ).toBe('expired_cancelled');
  });
  it('returns active_like for cancelled with paid-through period', () => {
    const end = new Date(NOW + 86_400_000).toISOString();
    expect(
      resolveVenueSubscriptionEntitlement({ plan_status: 'cancelled', subscription_current_period_end: end }, NOW)
        .kind,
    ).toBe('active_like');
  });
  it('returns expired_cancelled for cancelled after period end', () => {
    const end = new Date(NOW - 86_400_000).toISOString();
    expect(
      resolveVenueSubscriptionEntitlement({ plan_status: 'cancelled', subscription_current_period_end: end }, NOW)
        .kind,
    ).toBe('expired_cancelled');
  });
  it('returns expired_cancelled for cancelled with missing period end', () => {
    expect(resolveVenueSubscriptionEntitlement({ plan_status: 'cancelled' }, NOW).kind).toBe('expired_cancelled');
  });
});

describe('areVenueSubscriptionMutationsBlocked', () => {
  it('blocks past_due and expired_cancelled', () => {
    expect(
      areVenueSubscriptionMutationsBlocked({ plan_status: 'past_due', subscription_current_period_end: null }, NOW),
    ).toBe(true);
    expect(
      areVenueSubscriptionMutationsBlocked(
        {
          plan_status: 'cancelled',
          subscription_current_period_end: new Date(NOW - 1).toISOString(),
        },
        NOW,
      ),
    ).toBe(true);
  });
  it('allows active_like', () => {
    expect(areVenueSubscriptionMutationsBlocked({ plan_status: 'active' }, NOW)).toBe(false);
    expect(
      areVenueSubscriptionMutationsBlocked(
        {
          plan_status: 'cancelled',
          subscription_current_period_end: new Date(NOW + 86_400_000).toISOString(),
        },
        NOW,
      ),
    ).toBe(false);
  });
  it('blocks cancelling once its period end has passed', () => {
    expect(
      areVenueSubscriptionMutationsBlocked(
        { plan_status: 'cancelling', subscription_current_period_end: new Date(NOW - 86_400_000).toISOString() },
        NOW,
      ),
    ).toBe(true);
  });
  it('allows cancelling that is still within its paid period', () => {
    expect(
      areVenueSubscriptionMutationsBlocked(
        { plan_status: 'cancelling', subscription_current_period_end: new Date(NOW + 86_400_000).toISOString() },
        NOW,
      ),
    ).toBe(false);
  });
  it('does not block superuser_free even when cancelled', () => {
    expect(
      areVenueSubscriptionMutationsBlocked(
        { plan_status: 'cancelled', billing_access_source: 'superuser_free' },
        NOW,
      ),
    ).toBe(false);
  });
});

describe('isPublicOnlineBookingBlocked', () => {
  it('blocks Light + past_due', () => {
    expect(
      isPublicOnlineBookingBlocked({ pricing_tier: 'light', plan_status: 'past_due' }, NOW),
    ).toBe(true);
  });
  it('does not block non-Light past_due', () => {
    expect(
      isPublicOnlineBookingBlocked({ pricing_tier: 'plus', plan_status: 'past_due' }, NOW),
    ).toBe(false);
  });
  it('blocks all tiers when expired cancelled', () => {
    const pastEnd = new Date(NOW - 1).toISOString();
    expect(
      isPublicOnlineBookingBlocked({ pricing_tier: 'plus', plan_status: 'cancelled', subscription_current_period_end: pastEnd }, NOW),
    ).toBe(true);
    expect(
      isPublicOnlineBookingBlocked({ pricing_tier: 'appointments', plan_status: 'cancelled', subscription_current_period_end: pastEnd }, NOW),
    ).toBe(true);
  });
  it('blocks all tiers when a cancelling venue is past its period end', () => {
    const pastEnd = new Date(NOW - 86_400_000).toISOString();
    expect(
      isPublicOnlineBookingBlocked({ pricing_tier: 'plus', plan_status: 'cancelling', subscription_current_period_end: pastEnd }, NOW),
    ).toBe(true);
  });
  it('does not block a cancelling venue still within its paid period', () => {
    const futureEnd = new Date(NOW + 86_400_000).toISOString();
    expect(
      isPublicOnlineBookingBlocked({ pricing_tier: 'plus', plan_status: 'cancelling', subscription_current_period_end: futureEnd }, NOW),
    ).toBe(false);
  });
  it('never blocks superuser_free venues', () => {
    expect(
      isPublicOnlineBookingBlocked(
        {
          pricing_tier: 'plus',
          plan_status: 'cancelled',
          subscription_current_period_end: new Date(NOW - 1).toISOString(),
          billing_access_source: 'superuser_free',
        },
        NOW,
      ),
    ).toBe(false);
  });
});

describe('isVenueSubscriptionExpiredCancelled', () => {
  it('matches expired_cancelled entitlement', () => {
    expect(
      isVenueSubscriptionExpiredCancelled(
        { plan_status: 'cancelled', subscription_current_period_end: new Date(NOW - 1).toISOString() },
        NOW,
      ),
    ).toBe(true);
    expect(isVenueSubscriptionExpiredCancelled({ plan_status: 'active' }, NOW)).toBe(false);
    // A cancelling venue stuck past its period end must also resubscribe.
    expect(
      isVenueSubscriptionExpiredCancelled(
        { plan_status: 'cancelling', subscription_current_period_end: new Date(NOW - 86_400_000).toISOString() },
        NOW,
      ),
    ).toBe(true);
  });
});
