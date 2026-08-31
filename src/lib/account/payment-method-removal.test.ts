/**
 * P4-6: whose card is this, and what is it paying for?
 *
 * A payment method id is a bearer-ish token in the sense that matters here: it
 * is short, it appears in client code, and Stripe will happily detach it from
 * whatever account you name. Nothing in the database constrains it, so every
 * check that stops one customer detaching another's card is in this file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolvePaymentMethodOwnership,
  membershipsBackedByPaymentMethod,
} from './payment-method-removal';
import type { SupabaseClient } from '@supabase/supabase-js';

const state = {
  venue: { id: 'v-1', stripe_connected_account_id: 'acct_1' } as Record<string, unknown> | null,
  link: { stripe_customer_id: 'cus_1' } as Record<string, unknown> | null,
  memberships: [] as Array<Record<string, unknown>>,
  products: [{ id: 'prod-1', name: 'Unlimited Yoga' }] as Array<Record<string, unknown>>,
  /** What Stripe says the payment method belongs to. */
  pmCustomer: 'cus_1' as string | null,
  pmThrows: false,
  subDefault: null as string | null,
  customerDefault: null as string | null,
  stripeThrows: false,
};

function admin(): SupabaseClient {
  return {
    from: (table: string) => {
      const rowsFor = () => {
        if (table === 'venues') return state.venue ? [state.venue] : [];
        if (table === 'venue_customer_stripe') return state.link ? [state.link] : [];
        if (table === 'class_memberships') return state.memberships;
        if (table === 'class_membership_products') return state.products;
        return [];
      };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => Promise.resolve({ data: rowsFor(), error: null }),
        maybeSingle: () => Promise.resolve({ data: rowsFor()[0] ?? null, error: null }),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

function stripeStub() {
  return {
    paymentMethods: {
      retrieve: async () => {
        if (state.pmThrows) throw new Error('No such PaymentMethod');
        return { id: 'pm_1', customer: state.pmCustomer };
      },
    },
    subscriptions: {
      retrieve: async () => {
        if (state.stripeThrows) throw new Error('stripe down');
        return { default_payment_method: state.subDefault };
      },
    },
    customers: {
      retrieve: async () => {
        if (state.stripeThrows) throw new Error('stripe down');
        return { invoice_settings: { default_payment_method: state.customerDefault } };
      },
    },
  } as never;
}

const ARGS = { userId: 'user-1', venueId: 'v-1', paymentMethodId: 'pm_1' };

beforeEach(() => {
  state.venue = { id: 'v-1', stripe_connected_account_id: 'acct_1' };
  state.link = { stripe_customer_id: 'cus_1' };
  state.memberships = [];
  state.products = [{ id: 'prod-1', name: 'Unlimited Yoga' }];
  state.pmCustomer = 'cus_1';
  state.pmThrows = false;
  state.subDefault = null;
  state.customerDefault = null;
  state.stripeThrows = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('ownership', () => {
  it('accepts a card that really is this customer’s at this venue', async () => {
    const res = await resolvePaymentMethodOwnership(admin(), stripeStub(), ARGS);
    expect(res).toEqual({ ok: true, connectedAccountId: 'acct_1', customerId: 'cus_1' });
  });

  it('REFUSES a card belonging to a different Stripe customer', async () => {
    /*
      The check that matters. Everything before it only proves the venue and
      the caller's customer row exist; this is what stops a caller naming
      somebody else's payment method id.
    */
    state.pmCustomer = 'cus_someone_else';
    const res = await resolvePaymentMethodOwnership(admin(), stripeStub(), ARGS);
    expect(res).toEqual({ ok: false, reason: 'not_yours' });
  });

  it('refuses when the customer has no card record at this venue, WITHOUT asking Stripe', async () => {
    /*
      The second assertion is the one a mutation sweep asked for. Removing the
      early return still refuses, because the ownership comparison below
      catches it anyway, so the guard's real job is not the refusal: it is not
      asking a third party about an id when the answer is already known. That
      is worth pinning, or the guard reads as redundant and gets deleted.
    */
    state.link = null;
    let retrieved = false;
    const stripe = {
      paymentMethods: {
        retrieve: async () => {
          retrieved = true;
          return { id: 'pm_1', customer: 'cus_1' };
        },
      },
    } as never;
    expect((await resolvePaymentMethodOwnership(admin(), stripe, ARGS)).ok).toBe(false);
    expect(retrieved, 'Stripe was asked about a card we already know is not theirs').toBe(false);
  });

  it('treats an unknown payment method as not theirs, not as an error', async () => {
    // Indistinguishable to the caller from somebody else's, deliberately.
    state.pmThrows = true;
    const res = await resolvePaymentMethodOwnership(admin(), stripeStub(), ARGS);
    expect(res).toEqual({ ok: false, reason: 'not_yours' });
  });

  it('reports a missing venue and an unconnected one separately', async () => {
    state.venue = null;
    expect((await resolvePaymentMethodOwnership(admin(), stripeStub(), ARGS)).ok).toBe(false);
    state.venue = { id: 'v-1', stripe_connected_account_id: null };
    const res = await resolvePaymentMethodOwnership(admin(), stripeStub(), ARGS);
    expect(res).toEqual({ ok: false, reason: 'venue_not_connected' });
  });
});

describe('what the card is paying for', () => {
  const LIVE = [{ id: 'm-1', product_id: 'prod-1', status: 'active', stripe_subscription_id: 'sub_1' }];

  it('names the membership when the subscription points at THIS card', async () => {
    state.memberships = LIVE;
    state.subDefault = 'pm_1';
    const backed = await membershipsBackedByPaymentMethod(admin(), stripeStub(), {
      ...ARGS,
      customerId: 'cus_1',
      connectedAccountId: 'acct_1',
    });
    expect(backed).toEqual([{ id: 'm-1', name: 'Unlimited Yoga' }]);
  });

  it('says nothing when the subscription is paid by a DIFFERENT card', async () => {
    // A warning that fires whenever any membership exists is a warning people
    // learn to click through.
    state.memberships = LIVE;
    state.subDefault = 'pm_other';
    expect(
      await membershipsBackedByPaymentMethod(admin(), stripeStub(), {
        ...ARGS,
        customerId: 'cus_1',
        connectedAccountId: 'acct_1',
      }),
    ).toEqual([]);
  });

  it('falls back to the customer default when the subscription names none', async () => {
    /*
      Stripe's own rule: a subscription with no `default_payment_method` is
      charged to the customer's default. Ignoring that would let somebody
      remove the card that is in fact paying, with no warning at all.
    */
    state.memberships = LIVE;
    state.subDefault = null;
    state.customerDefault = 'pm_1';
    expect(
      await membershipsBackedByPaymentMethod(admin(), stripeStub(), {
        ...ARGS,
        customerId: 'cus_1',
        connectedAccountId: 'acct_1',
      }),
    ).toHaveLength(1);
  });

  it('ignores memberships that are not live', async () => {
    state.memberships = [];
    expect(
      await membershipsBackedByPaymentMethod(admin(), stripeStub(), {
        ...ARGS,
        customerId: 'cus_1',
        connectedAccountId: 'acct_1',
      }),
    ).toEqual([]);
  });

  it('FAILS SOFT and allows removal when Stripe cannot be asked', async () => {
    // Refusing to let somebody remove their own card because a third party is
    // unreachable is the worse mistake: a card can be re-added.
    state.memberships = LIVE;
    state.stripeThrows = true;
    expect(
      await membershipsBackedByPaymentMethod(admin(), stripeStub(), {
        ...ARGS,
        customerId: 'cus_1',
        connectedAccountId: 'acct_1',
      }),
    ).toEqual([]);
  });
});
