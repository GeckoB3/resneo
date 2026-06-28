import { describe, expect, it } from 'vitest';
import {
  mapStripeSubscriptionToPlanStatus,
  subscriptionCancelAtIso,
  subscriptionPeriodEndIso,
  subscriptionPeriodStartIso,
} from './subscription-fields';

describe('subscription period helpers', () => {
  it('reads legacy top-level subscription period fields', () => {
    const sub = {
      current_period_start: 1_714_521_600,
      current_period_end: 1_717_200_000,
    };

    expect(subscriptionPeriodStartIso(sub)).toBe('2024-05-01T00:00:00.000Z');
    expect(subscriptionPeriodEndIso(sub)).toBe('2024-06-01T00:00:00.000Z');
  });

  it('falls back to subscription item period fields for newer Stripe API versions', () => {
    const sub = {
      items: {
        data: [
          {
            current_period_start: 1_714_521_600,
            current_period_end: 1_717_200_000,
          },
        ],
      },
    };

    expect(subscriptionPeriodStartIso(sub)).toBe('2024-05-01T00:00:00.000Z');
    expect(subscriptionPeriodEndIso(sub)).toBe('2024-06-01T00:00:00.000Z');
  });

  it('reads a future Stripe cancel_at timestamp', () => {
    const sub = {
      cancel_at: 1_717_200_000,
    };

    expect(subscriptionCancelAtIso(sub)).toBe('2024-06-01T00:00:00.000Z');
  });

  it('treats active subscriptions with a future cancel_at timestamp as cancelling', () => {
    const sub = {
      status: 'active',
      cancel_at: Math.floor(Date.now() / 1000) + 86_400,
    };

    expect(mapStripeSubscriptionToPlanStatus(sub)).toBe('cancelling');
  });

  it('treats a canceled subscription still inside its paid period as cancelling', () => {
    const sub = {
      status: 'canceled',
      cancel_at_period_end: true,
      current_period_end: Math.floor(Date.now() / 1000) + 86_400,
    };

    expect(mapStripeSubscriptionToPlanStatus(sub)).toBe('cancelling');
  });

  it('treats a canceled, period-ended subscription as cancelled even if cancel_at_period_end lingers', () => {
    const sub = {
      status: 'canceled',
      cancel_at_period_end: true,
      current_period_end: Math.floor(Date.now() / 1000) - 86_400,
    };

    expect(mapStripeSubscriptionToPlanStatus(sub)).toBe('cancelled');
  });

  it('treats terminal unpaid/paused subscriptions as cancelled even with a lingering cancel flag', () => {
    // Terminal/dead Stripe states must not retain access just because cancel_at_period_end is set.
    expect(
      mapStripeSubscriptionToPlanStatus({ status: 'unpaid', cancel_at_period_end: true }),
    ).toBe('cancelled');
    expect(
      mapStripeSubscriptionToPlanStatus({
        status: 'paused',
        cancel_at: Math.floor(Date.now() / 1000) + 86_400,
      }),
    ).toBe('cancelled');
    expect(
      mapStripeSubscriptionToPlanStatus({ status: 'incomplete_expired', cancel_at_period_end: true }),
    ).toBe('cancelled');
  });
});
