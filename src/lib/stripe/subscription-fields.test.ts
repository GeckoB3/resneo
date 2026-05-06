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
});
