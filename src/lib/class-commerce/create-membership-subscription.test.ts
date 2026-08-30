import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';

/**
 * P0-17: the server side of the SetupIntent flow that replaced hosted Checkout.
 *
 * This is where the money is actually committed, so the tests below are mostly
 * about NOT committing it twice, and about not committing it at all when the
 * plan is no longer sellable. Everything downstream is untouched:
 * `customer.subscription.created` fires and the existing
 * `syncClassMembershipFromStripeSubscription` records the membership, which is
 * why the metadata assertion here matters more than it looks.
 */

const hoisted = vi.hoisted(() => ({
  subscriptions: [] as Array<{ params: Record<string, unknown>; opts: Record<string, unknown> }>,
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    subscriptions: {
      create: vi.fn(async (params: Record<string, unknown>, opts: Record<string, unknown>) => {
        hoisted.subscriptions.push({ params, opts });
        return { id: 'sub_123' };
      }),
    },
  },
}));

import { createMembershipSubscriptionFromSetupIntent } from './create-membership-subscription';

const USER = 'user-1';
const VENUE = 'venue-1';
const PRODUCT = 'prod-1';

function setupIntent(overrides: Partial<Stripe.SetupIntent> = {}): Stripe.SetupIntent {
  return {
    id: 'seti_123',
    customer: 'cus_123',
    payment_method: 'pm_123',
    metadata: {
      reserve_ni_purpose: 'class_membership',
      user_id: USER,
      venue_id: VENUE,
      product_id: PRODUCT,
    },
    ...overrides,
  } as unknown as Stripe.SetupIntent;
}

function db(opts: { membership?: unknown; price?: string | null } = {}) {
  return makeRecordingDb((call) => {
    if (call.table === 'class_memberships') return { data: opts.membership ?? null };
    if (call.table === 'class_membership_products') {
      return { data: opts.price === undefined ? { stripe_price_id: 'price_123' } : { stripe_price_id: opts.price } };
    }
    return undefined;
  }).db;
}

describe('createMembershipSubscriptionFromSetupIntent', () => {
  beforeEach(() => {
    hoisted.subscriptions = [];
  });

  it('creates the subscription with the saved card and the metadata the sync needs', async () => {
    const outcome = await createMembershipSubscriptionFromSetupIntent(db(), setupIntent(), 'acct_123');
    expect(outcome).toEqual({ created: true, subscriptionId: 'sub_123' });

    const { params, opts } = hoisted.subscriptions[0];
    expect(params).toMatchObject({
      customer: 'cus_123',
      items: [{ price: 'price_123' }],
      default_payment_method: 'pm_123',
    });
    // Lose this and the subscription bills the customer while recording nothing.
    expect(params.metadata).toEqual({
      reserve_ni_purpose: 'class_membership',
      user_id: USER,
      venue_id: VENUE,
      product_id: PRODUCT,
    });
    expect(opts).toMatchObject({ stripeAccount: 'acct_123' });
  });

  it('is idempotent on the SetupIntent id, so a redelivered event cannot double-bill', async () => {
    await createMembershipSubscriptionFromSetupIntent(db(), setupIntent(), 'acct_123');
    expect(hoisted.subscriptions[0].opts).toMatchObject({
      idempotencyKey: 'membership_sub:seti_123',
    });
  });

  it('short circuits when the customer already has a live membership', async () => {
    // The second guard, for two SetupIntents from two taps: the idempotency key
    // is per SetupIntent and would not catch that.
    const outcome = await createMembershipSubscriptionFromSetupIntent(
      db({ membership: { id: 'mem-1' } }),
      setupIntent(),
      'acct_123',
    );
    expect(outcome).toEqual({ created: false, reason: 'already_subscribed' });
    expect(hoisted.subscriptions).toEqual([]);
  });

  it('does NOT subscribe when the plan lost its price between tap and confirm', async () => {
    // The card is saved and nothing is charged, which is the right way round.
    const outcome = await createMembershipSubscriptionFromSetupIntent(
      db({ price: null }),
      setupIntent(),
      'acct_123',
    );
    expect(outcome).toEqual({ created: false, reason: 'product_unavailable' });
    expect(hoisted.subscriptions).toEqual([]);
  });

  it('reads the price from the database, never from the SetupIntent metadata', async () => {
    // A price carried in metadata would let a plan be sold at yesterday's rate.
    const si = setupIntent({
      metadata: {
        reserve_ni_purpose: 'class_membership',
        user_id: USER,
        venue_id: VENUE,
        product_id: PRODUCT,
        price_id: 'price_STALE',
      },
    } as Partial<Stripe.SetupIntent>);
    await createMembershipSubscriptionFromSetupIntent(db(), si, 'acct_123');
    expect(hoisted.subscriptions[0].params.items).toEqual([{ price: 'price_123' }]);
  });

  it('ignores a SetupIntent that is not a membership purchase', async () => {
    // Card-hold setups arrive on the same event and must fall through to their
    // own handler untouched.
    const si = setupIntent({
      metadata: { reserve_ni_purpose: 'card_hold_setup', venue_id: VENUE },
    } as Partial<Stripe.SetupIntent>);
    const outcome = await createMembershipSubscriptionFromSetupIntent(db(), si, 'acct_123');
    expect(outcome).toEqual({ created: false, reason: 'not_a_membership_setup' });
    expect(hoisted.subscriptions).toEqual([]);
  });

  it('refuses an incomplete setup rather than guessing', async () => {
    for (const patch of [
      { payment_method: null },
      { customer: null },
      { metadata: { reserve_ni_purpose: 'class_membership', user_id: USER, venue_id: VENUE } },
    ]) {
      const outcome = await createMembershipSubscriptionFromSetupIntent(
        db(),
        setupIntent(patch as Partial<Stripe.SetupIntent>),
        'acct_123',
      );
      expect(outcome).toEqual({ created: false, reason: 'incomplete_setup' });
    }
    expect(hoisted.subscriptions).toEqual([]);
  });
});
