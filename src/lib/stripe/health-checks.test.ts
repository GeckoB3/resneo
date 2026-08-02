import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import {
  checkConnect,
  checkEnvPresence,
  checkKeyMode,
  checkWebhookEndpoints,
  detectKeyMode,
  evaluatePrice,
  rollupSeverity,
  WEBHOOK_SPECS,
  type PriceSpec,
} from './health-checks';

function makePrice(overrides: Partial<Stripe.Price> = {}): Stripe.Price {
  return {
    id: 'price_test',
    object: 'price',
    active: true,
    currency: 'gbp',
    unit_amount: 9900,
    product: { id: 'prod_x', object: 'product', active: true },
    recurring: { interval: 'month', usage_type: 'licensed' },
    livemode: false,
    ...overrides,
  } as unknown as Stripe.Price;
}

const BASE_SPEC: PriceSpec = {
  envKey: 'STRIPE_APPOINTMENTS_PRO_PRICE_ID',
  label: 'Appointments Pro',
  required: true,
  expectedAmount: 9900,
  metered: false,
};

const METERED_SPEC: PriceSpec = {
  envKey: 'STRIPE_SMS_OVERAGE_PRICE_ID',
  label: 'SMS overage',
  required: false,
  expectedAmount: 6,
  metered: true,
};

describe('detectKeyMode', () => {
  it('reads live/test from key prefixes', () => {
    expect(detectKeyMode('sk_live_abc')).toBe('live');
    expect(detectKeyMode('pk_live_abc')).toBe('live');
    expect(detectKeyMode('sk_test_abc')).toBe('test');
    expect(detectKeyMode('rk_test_abc')).toBe('test');
  });
  it('returns unknown for missing or unrecognised keys', () => {
    expect(detectKeyMode(undefined)).toBe('unknown');
    expect(detectKeyMode('')).toBe('unknown');
    expect(detectKeyMode('whatever')).toBe('unknown');
  });
});

describe('rollupSeverity', () => {
  it('is ok when empty', () => expect(rollupSeverity([])).toBe('ok'));
  it('prefers fail over warn over ok', () => {
    expect(rollupSeverity(['ok', 'warn'])).toBe('warn');
    expect(rollupSeverity(['ok', 'warn', 'fail'])).toBe('fail');
  });
});

describe('checkKeyMode', () => {
  it('passes when both keys share a mode', () => {
    const r = checkKeyMode({ STRIPE_SECRET_KEY: 'sk_live_1', NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_2' });
    expect(r.severity).toBe('ok');
    expect(r.consistent).toBe(true);
  });
  it('fails on a mode mismatch', () => {
    const r = checkKeyMode({ STRIPE_SECRET_KEY: 'sk_live_1', NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_2' });
    expect(r.severity).toBe('fail');
    expect(r.consistent).toBe(false);
  });
  it('fails when a key is missing', () => {
    const r = checkKeyMode({ STRIPE_SECRET_KEY: 'sk_live_1' });
    expect(r.severity).toBe('fail');
  });
});

describe('evaluatePrice', () => {
  it('accepts a valid recurring monthly GBP price', () => {
    const r = evaluatePrice(BASE_SPEC, makePrice());
    expect(r.severity).toBe('ok');
    expect(r.issues).toHaveLength(0);
  });
  it('fails an archived price', () => {
    expect(evaluatePrice(BASE_SPEC, makePrice({ active: false })).severity).toBe('fail');
  });
  it('fails a wrong currency', () => {
    expect(evaluatePrice(BASE_SPEC, makePrice({ currency: 'usd' })).severity).toBe('fail');
  });
  it('fails a one-time price', () => {
    expect(evaluatePrice(BASE_SPEC, makePrice({ recurring: null })).severity).toBe('fail');
  });
  it('fails a base plan that is metered', () => {
    const p = makePrice({ recurring: { interval: 'month', usage_type: 'metered' } as Stripe.Price.Recurring });
    expect(evaluatePrice(BASE_SPEC, p).severity).toBe('fail');
  });
  it('fails a metered spec that is licensed', () => {
    expect(evaluatePrice(METERED_SPEC, makePrice({ unit_amount: 6 })).severity).toBe('fail');
  });
  it('accepts a valid metered price', () => {
    const p = makePrice({ unit_amount: 6, recurring: { interval: 'month', usage_type: 'metered' } as Stripe.Price.Recurring });
    expect(evaluatePrice(METERED_SPEC, p).severity).toBe('ok');
  });
  it('warns on an unexpected amount', () => {
    expect(evaluatePrice(BASE_SPEC, makePrice({ unit_amount: 12000 })).severity).toBe('warn');
  });
  it('warns on a non-monthly interval', () => {
    const p = makePrice({ recurring: { interval: 'year', usage_type: 'licensed' } as Stripe.Price.Recurring });
    expect(evaluatePrice(BASE_SPEC, p).severity).toBe('warn');
  });
});

describe('checkConnect', () => {
  function clientWith(list: () => Promise<{ data: unknown[] }>): Stripe {
    return { accounts: { list } } as unknown as Stripe;
  }

  it('is ok and reports existing accounts when the Connect API is reachable', async () => {
    const r = await checkConnect(clientWith(async () => ({ data: [{ id: 'acct_1' }] })));
    expect(r.severity).toBe('ok');
    expect(r.enabled).toBe(true);
    expect(r.has_connected_accounts).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('is ok with no accounts yet', async () => {
    const r = await checkConnect(clientWith(async () => ({ data: [] })));
    expect(r.severity).toBe('ok');
    expect(r.enabled).toBe(true);
    expect(r.has_connected_accounts).toBe(false);
  });

  it('fails and surfaces the Stripe message when Connect is unavailable', async () => {
    const r = await checkConnect(
      clientWith(async () => {
        throw new Error('signed up for Connect');
      }),
    );
    expect(r.severity).toBe('fail');
    expect(r.enabled).toBe(false);
    expect(r.has_connected_accounts).toBeNull();
    expect(r.error).toContain('signed up for Connect');
    expect(r.issues.length).toBeGreaterThan(0);
  });
});

describe('checkEnvPresence', () => {
  it('fails when a required key is missing', () => {
    const r = checkEnvPresence({ STRIPE_SECRET_KEY: 'sk_live_1' });
    expect(r.severity).toBe('fail');
    expect(r.items.find((i) => i.key === 'STRIPE_SECRET_KEY')?.present).toBe(true);
  });
  it('is ok when all required keys are present', () => {
    const env = {
      STRIPE_SECRET_KEY: 'sk_live_1',
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_1',
      STRIPE_WEBHOOK_SECRET: 'whsec_1',
      STRIPE_ONBOARDING_WEBHOOK_SECRET: 'whsec_2',
      STRIPE_APPOINTMENTS_PRO_PRICE_ID: 'price_1',
      STRIPE_APPOINTMENTS_PLUS_PRICE_ID: 'price_2',
      STRIPE_LIGHT_PRICE_ID: 'price_3',
      STRIPE_RESTAURANT_PRICE_ID: 'price_4',
    };
    expect(checkEnvPresence(env).severity).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Webhook endpoint account scope
// ---------------------------------------------------------------------------

/**
 * The failure this exists for, seen in live mode: card payments succeeded on the
 * connected account and the ledger row stayed `pending` for ever, because the
 * endpoint was scoped to the platform account. Stripe does not fail a delivery
 * in that case — it never attempts one, so the endpoint log is empty and every
 * other health check still reads green.
 */
describe('checkWebhookEndpoints — account scope', () => {
  const PAYMENTS = WEBHOOK_SPECS.find((s) => s.pathSuffix === '/api/webhooks/stripe')!;
  const SUBS = WEBHOOK_SPECS.find((s) => s.pathSuffix === '/api/webhooks/stripe-subscription')!;

  /** A Stripe stub returning the given endpoints from webhookEndpoints.list. */
  function clientWith(endpoints: unknown[]): Stripe {
    return {
      webhookEndpoints: { list: async () => ({ data: endpoints }) },
    } as unknown as Stripe;
  }

  function endpoint(pathSuffix: string, events: string[], extra: Record<string, unknown> = {}) {
    return {
      url: `https://www.resneo.com${pathSuffix}`,
      status: 'enabled',
      livemode: true,
      enabled_events: events,
      ...extra,
    };
  }

  const env = {
    STRIPE_WEBHOOK_SECRET: 'whsec_a',
    STRIPE_ONBOARDING_WEBHOOK_SECRET: 'whsec_b',
  };

  /**
   * Scope is read from `application`: a Connect application id means
   * Connect-scoped, null means platform. (`connect` is create-only and never
   * comes back on a retrieved endpoint — verified against a live account.)
   */
  const CONNECT_APP = 'ca_UnKM7vPLuTPceXso6KdCRe9rMovXnZs1';
  const scoped = (isConnect: boolean) => ({ application: isConnect ? CONNECT_APP : null });

  /** Both endpoints present and fully configured, scope supplied per argument. */
  function bothEndpoints(paymentsConnect: boolean, subsConnect: boolean) {
    const all = [...PAYMENTS.requiredEvents, ...PAYMENTS.recommendedEvents];
    return clientWith([
      endpoint(PAYMENTS.pathSuffix, all, scoped(paymentsConnect)),
      endpoint(SUBS.pathSuffix, SUBS.requiredEvents, scoped(subsConnect)),
    ]);
  }

  it('declares the payments endpoint connected-account scoped and billing platform scoped', () => {
    // The specs are the contract the rest of this suite asserts against.
    expect(PAYMENTS.scope).toBe('connected_accounts');
    expect(SUBS.scope).toBe('platform');
  });

  it('passes when each endpoint has the scope its events require', async () => {
    const res = await checkWebhookEndpoints(bothEndpoints(true, false), { mode: 'live', env });
    for (const r of res) {
      expect(r.severity, `${r.label}: ${r.issues.join(' ')}`).toBe('ok');
      expect(r.issues).toHaveLength(0);
    }
  });

  it('FAILS the payments endpoint when it is scoped to the platform account', async () => {
    const [payments] = await checkWebhookEndpoints(bothEndpoints(false, false), {
      mode: 'live',
      env,
    }).then((r) => r.filter((x) => x.path_suffix === PAYMENTS.pathSuffix));
    expect(payments.severity).toBe('fail');
    expect(payments.connect_scope).toBe(false);
    expect(payments.expected_scope).toBe('connected_accounts');
    expect(payments.issues.join(' ')).toMatch(/never attempt a delivery/);
  });

  it('fails the billing endpoint when it is wrongly scoped to connected accounts', async () => {
    const res = await checkWebhookEndpoints(bothEndpoints(true, true), { mode: 'live', env });
    const subs = res.find((r) => r.path_suffix === SUBS.pathSuffix)!;
    expect(subs.severity).toBe('fail');
    expect(subs.connect_scope).toBe(true);
  });

  it('judges a real Stripe payload, which carries no `connect` key at all', async () => {
    // The exact shape a live account returns: `application` present, `connect`
    // absent. Reading `connect` here would have made every verdict "unknown".
    const client = clientWith([
      {
        url: `https://www.resneo.com${PAYMENTS.pathSuffix}`,
        status: 'enabled',
        livemode: true,
        application: CONNECT_APP,
        enabled_events: [...PAYMENTS.requiredEvents, ...PAYMENTS.recommendedEvents],
      },
    ]);
    const res = await checkWebhookEndpoints(client, { mode: 'live', env });
    const payments = res.find((r) => r.path_suffix === PAYMENTS.pathSuffix)!;
    expect(payments.connect_scope).toBe(true);
    expect(payments.connect_application).toBe(CONNECT_APP);
    expect(payments.severity).toBe('ok');
  });

  it('still reports scope alongside the other endpoint problems', async () => {
    // A wrong scope must not mask (or be masked by) missing events.
    const client = clientWith([
      endpoint(PAYMENTS.pathSuffix, ['payment_intent.succeeded'], scoped(false)),
    ]);
    const res = await checkWebhookEndpoints(client, { mode: 'live', env });
    const payments = res.find((r) => r.path_suffix === PAYMENTS.pathSuffix)!;
    expect(payments.severity).toBe('fail');
    expect(payments.missing_required_events).toContain('charge.refunded');
    expect(payments.issues.join(' ')).toMatch(/CONNECTED account/);
  });

  it('reports a null scope when the endpoint is not registered at all', async () => {
    const res = await checkWebhookEndpoints(clientWith([]), { mode: 'live', env });
    for (const r of res) {
      expect(r.found).toBe(false);
      expect(r.connect_scope).toBeNull();
      expect(r.expected_scope).toBe(r.path_suffix === PAYMENTS.pathSuffix ? 'connected_accounts' : 'platform');
    }
  });
});
