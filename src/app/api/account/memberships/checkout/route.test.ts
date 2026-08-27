import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';

/**
 * P0-17 / C9: money routes return a `client_secret`, not a hosted-Checkout URL.
 *
 * This route was the only exception. Its `success_url` was
 * `/account/memberships?checkout=success`, which middleware protects, so in an
 * app webview with no cookie a completed subscription purchase landed on
 * `/login` and read as a failure. It now creates a SetupIntent and the
 * subscription is created server side from the `setup_intent.succeeded`
 * webhook.
 */

const hoisted = vi.hoisted(() => ({
  db: null as ReturnType<typeof makeRecordingDb> | null,
  user: { id: 'user-1', email: 'a@b.test' } as { id: string; email: string } | null,
  venue: { id: 'venue-1', name: 'The Wharf', stripe_connected_account_id: 'acct_123' } as Record<
    string,
    unknown
  > | null,
  product: { id: 'prod-1', stripe_price_id: 'price_123' } as Record<string, unknown> | null,
  existingMembership: null as Record<string, unknown> | null,
  setupIntents: [] as Array<{ params: Record<string, unknown>; opts: Record<string, unknown> }>,
  checkoutSessionsCreated: 0,
}));

vi.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: hoisted.user }, error: null }) },
  }),
}));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: () => hoisted.db!.db }));
vi.mock('@/lib/class-commerce/venue-stripe-customer', () => ({
  ensureVenueStripeCustomerForUser: async () => ({ stripeCustomerId: 'cus_123' }),
}));
vi.mock('@/lib/stripe', () => ({
  stripe: {
    setupIntents: {
      create: vi.fn(async (params: Record<string, unknown>, opts: Record<string, unknown>) => {
        hoisted.setupIntents.push({ params, opts });
        return { id: 'seti_123', client_secret: 'seti_123_secret' };
      }),
    },
    checkout: {
      sessions: {
        create: vi.fn(async () => {
          hoisted.checkoutSessionsCreated += 1;
          return { url: 'https://checkout.stripe.com/x' };
        }),
      },
    },
  },
}));

import { POST } from './route';

function post(body: Record<string, unknown> = { venue_id: VENUE, product_id: PRODUCT }) {
  return POST(
    new NextRequest('http://localhost:3000/api/account/memberships/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

const VENUE = '11111111-1111-4111-8111-111111111111';
const PRODUCT = '22222222-2222-4222-8222-222222222222';

describe('POST /api/account/memberships/checkout (P0-17)', () => {
  beforeEach(() => {
    hoisted.user = { id: 'user-1', email: 'a@b.test' };
    hoisted.venue = { id: VENUE, name: 'The Wharf', stripe_connected_account_id: 'acct_123' };
    hoisted.product = { id: PRODUCT, stripe_price_id: 'price_123' };
    hoisted.existingMembership = null;
    hoisted.setupIntents = [];
    hoisted.checkoutSessionsCreated = 0;
    hoisted.db = makeRecordingDb((call) => {
      if (call.table === 'venues') return { data: hoisted.venue };
      if (call.table === 'class_membership_products') return { data: hoisted.product };
      if (call.table === 'class_memberships') return { data: hoisted.existingMembership };
      return undefined;
    });
  });

  it('returns a client_secret and NO hosted-Checkout url', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.client_secret).toBe('seti_123_secret');
    expect(body.stripe_account_id).toBe('acct_123');
    // The regression that started this: a `url` sends the app's webview to a
    // page it cannot render.
    expect(body).not.toHaveProperty('url');
    expect(hoisted.checkoutSessionsCreated, 'no hosted Checkout session').toBe(0);
  });

  it('creates the SetupIntent on the venue connected account, off_session', async () => {
    await post();
    expect(hoisted.setupIntents).toHaveLength(1);
    const { params, opts } = hoisted.setupIntents[0];
    // On the venue's account, not the platform's: the venue bills the customer.
    expect(opts).toMatchObject({ stripeAccount: 'acct_123' });
    expect(params).toMatchObject({
      customer: 'cus_123',
      // The subscription charges this card on a schedule with nobody present.
      usage: 'off_session',
    });
  });

  it('carries the metadata the subscription and its sync depend on', async () => {
    // `syncClassMembershipFromStripeSubscription` reads exactly these off the
    // SUBSCRIPTION, and the webhook copies them across from here. Lose one and
    // the purchase completes in Stripe and records nothing.
    await post();
    expect(hoisted.setupIntents[0].params.metadata).toEqual({
      reserve_ni_purpose: 'class_membership',
      user_id: 'user-1',
      venue_id: VENUE,
      product_id: PRODUCT,
    });
  });

  it('REFUSES a second subscription to the same plan', async () => {
    // A double tap would otherwise create two subscriptions on the venue's
    // account, and the only cure is a manual refund.
    hoisted.existingMembership = { id: 'mem-1', status: 'active' };
    const res = await post();
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: 'ALREADY_ENROLLED' });
    expect(hoisted.setupIntents).toEqual([]);
  });

  it('refuses an anonymous caller', async () => {
    hoisted.user = null;
    const res = await post();
    expect(res.status).toBe(401);
    expect(hoisted.setupIntents).toEqual([]);
  });

  it('refuses a venue with no Stripe connection, and one with no price', async () => {
    hoisted.venue = { id: VENUE, name: 'The Wharf', stripe_connected_account_id: null };
    expect((await post()).status).toBe(400);

    hoisted.venue = { id: VENUE, name: 'The Wharf', stripe_connected_account_id: 'acct_123' };
    hoisted.product = { id: PRODUCT, stripe_price_id: null };
    expect((await post()).status).toBe(400);
    expect(hoisted.setupIntents).toEqual([]);
  });
});

/**
 * The C9 enforcement row from §5D's constraints table. Derived from the
 * filesystem on the model of `schedule-fail-closed-coverage.test.ts`, because a
 * convention with no failing check is a comment: this route drifted for months
 * with the rule written down and nothing enforcing it.
 */
describe('C9: no customer money route returns a hosted-Checkout url', () => {
  const API = path.join(process.cwd(), 'src', 'app', 'api');

  function routeFiles(dir: string): string[] {
    const out: string[] = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...routeFiles(full));
      else if (entry.name === 'route.ts') out.push(full);
    }
    return out;
  }

  it('no handler under /api/account creates a Stripe Checkout session', () => {
    const offenders = routeFiles(path.join(API, 'account')).filter((f) =>
      /stripe\.checkout\.sessions\.create/.test(fs.readFileSync(f, 'utf8')),
    );
    expect(
      offenders.map((f) => path.relative(API, f).replace(/\\/g, '/')),
      'Hosted Checkout redirects the app webview to a page it cannot render (C9). ' +
        'Return a client_secret and confirm in a Payment Element instead.',
    ).toEqual([]);
  });

  it('no handler under /api/account returns a session url', () => {
    const offenders = routeFiles(path.join(API, 'account')).filter((f) =>
      /\burl:\s*session\.url\b|\{\s*url:\s*session/.test(fs.readFileSync(f, 'utf8')),
    );
    expect(offenders.map((f) => path.relative(API, f).replace(/\\/g, '/'))).toEqual([]);
  });

  it('the sweep is not vacuous: it can see the routes it is checking', () => {
    const files = routeFiles(path.join(API, 'account'));
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.includes('memberships'))).toBe(true);
  });
});
