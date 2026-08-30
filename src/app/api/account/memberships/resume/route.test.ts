/**
 * P2-6: undoing a scheduled membership cancellation.
 *
 * The Register's point is that this is the CHEAPEST mitigation for an
 * accidental cancellation, and it is cheap because the subscription has not
 * ended yet. So the rows below are mostly about the boundary: it must clear a
 * pending cancellation, must not touch somebody else's membership, and must
 * not quietly revive one that Stripe has already finished with, because that
 * would be a purchase and a purchase needs its own consent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const hoisted = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  membership: null as Record<string, unknown> | null,
  venue: { stripe_connected_account_id: 'acct_1' } as Record<string, unknown> | null,
  subscriptionStatus: 'active',
  updates: [] as Array<{ table: string; payload: Record<string, unknown> }>,
  /** Every filter the membership read was scoped with. */
  membershipFilters: [] as Array<[string, unknown]>,
  stripeUpdate: vi.fn(async () => ({})),
  stripeRetrieve: vi.fn(async () => ({ status: hoisted.subscriptionStatus })),
}));

vi.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: hoisted.user } }) },
  }),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    subscriptions: {
      update: (...args: unknown[]) => hoisted.stripeUpdate(...(args as [])),
      retrieve: (...args: unknown[]) => hoisted.stripeRetrieve(...(args as [])),
    },
  },
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: () => ({
    from(table: string) {
      const call: { payload?: Record<string, unknown> } = {};
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.update = (payload: Record<string, unknown>) => {
        call.payload = payload;
        hoisted.updates.push({ table, payload });
        return builder;
      };
      builder.eq = (col: string, val: unknown) => {
        if (table === 'class_memberships') hoisted.membershipFilters.push([col, val]);
        return builder;
      };
      builder.maybeSingle = async () => ({
        data: table === 'class_memberships' ? hoisted.membership : hoisted.venue,
        error: null,
      });
      builder.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve);
      return builder;
    },
  }),
}));

function membership(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    venue_id: 'venue-1',
    user_id: 'user-1',
    stripe_subscription_id: 'sub_1',
    cancel_at_period_end: true,
    ...overrides,
  };
}

async function post(body: unknown = { membership_id: '11111111-1111-4111-8111-111111111111' }) {
  const { POST } = await import('./route');
  const res = await POST(
    new NextRequest('http://localhost:3000/api/account/memberships/resume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { res, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  hoisted.user = { id: 'user-1' };
  hoisted.membership = membership();
  hoisted.venue = { stripe_connected_account_id: 'acct_1' };
  hoisted.subscriptionStatus = 'active';
  hoisted.updates = [];
  hoisted.membershipFilters = [];
  hoisted.stripeUpdate = vi.fn(async () => ({}));
  hoisted.stripeRetrieve = vi.fn(async () => ({ status: hoisted.subscriptionStatus }));
});

describe('POST /api/account/memberships/resume', () => {
  it('clears the scheduled cancellation on Stripe and locally', async () => {
    const { res, json } = await post();
    expect(res.status, JSON.stringify(json)).toBe(200);
    expect(hoisted.stripeUpdate).toHaveBeenCalledWith(
      'sub_1',
      { cancel_at_period_end: false },
      { stripeAccount: 'acct_1' },
    );
    expect(hoisted.updates).toEqual([
      { table: 'class_memberships', payload: expect.objectContaining({ cancel_at_period_end: false }) },
    ]);
  });

  it('asks Stripe BEFORE writing the local row', async () => {
    // The other order leaves the portal saying the membership renews while
    // Stripe still intends to end it, and the customer finds out when it
    // stops working. Proven by making Stripe throw: nothing may be written.
    hoisted.stripeUpdate = vi.fn(async () => {
      throw new Error('card_declined');
    });
    const { res } = await post();
    expect(res.status).toBe(500);
    expect(hoisted.updates, 'the local row was written despite Stripe refusing').toEqual([]);
  });

  it('refuses to resume a subscription Stripe has already ended', async () => {
    // Past the period end this is not an undo, it is a new purchase, and a
    // purchase needs its own consent. Clearing the flag would also show an
    // active membership that Stripe has finished with.
    hoisted.subscriptionStatus = 'canceled';
    const { res, json } = await post();
    expect(res.status).toBe(409);
    expect(String(json.error)).toMatch(/already ended/i);
    expect(hoisted.stripeUpdate).not.toHaveBeenCalled();
    expect(hoisted.updates).toEqual([]);
  });

  it('is a no-op on a membership that was never cancelling', async () => {
    // The customer wanted it to continue and it is continuing. Reaching Stripe
    // to say so would be a request that can fail for no reason at all.
    hoisted.membership = membership({ cancel_at_period_end: false });
    const { res, json } = await post();
    expect(res.status).toBe(200);
    expect(json.already_active).toBe(true);
    expect(hoisted.stripeUpdate).not.toHaveBeenCalled();
    expect(hoisted.updates).toEqual([]);
  });

  it('scopes the lookup to the caller, so another user’s membership is a 404', async () => {
    await post();
    expect(hoisted.membershipFilters).toContainEqual(['user_id', 'user-1']);
  });

  it('answers an anonymous caller 401 without reading anything', async () => {
    hoisted.user = null;
    const { res, json } = await post();
    expect(res.status).toBe(401);
    expect(json.code).toBe('UNAUTHENTICATED');
    expect(hoisted.membershipFilters).toEqual([]);
  });

  it('404s a membership that is not there', async () => {
    hoisted.membership = null;
    const { res } = await post();
    expect(res.status).toBe(404);
    expect(hoisted.stripeUpdate).not.toHaveBeenCalled();
  });

  it('rejects a body that is not a membership id', async () => {
    const { res } = await post({ membership_id: 'not-a-uuid' });
    expect(res.status).toBe(400);
    expect(hoisted.stripeUpdate).not.toHaveBeenCalled();
  });

  it('says so when the venue has no Stripe account rather than throwing', async () => {
    hoisted.venue = { stripe_connected_account_id: null };
    const { res, json } = await post();
    expect(res.status).toBe(400);
    expect(String(json.error)).toMatch(/stripe account/i);
    expect(hoisted.stripeUpdate).not.toHaveBeenCalled();
  });
});
