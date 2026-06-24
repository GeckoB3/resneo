import type Stripe from 'stripe';

/**
 * Read-only Stripe billing health checks for the superuser dashboard.
 *
 * Everything here is passive (Stripe API reads + env inspection) and safe to run in
 * live mode. The Stripe client is injected so the pure evaluators can be unit-tested
 * with mocked prices/endpoints. The checkout smoke test (the only side-effecting path)
 * lives in the smoke-test route, not here.
 */

export type Severity = 'ok' | 'warn' | 'fail';

/** Worst-wins rollup: any fail -> fail, else any warn -> warn, else ok. */
export function rollupSeverity(severities: Severity[]): Severity {
  if (severities.includes('fail')) return 'fail';
  if (severities.includes('warn')) return 'warn';
  return 'ok';
}

export type StripeMode = 'live' | 'test' | 'unknown';

/** Infer live/test from a Stripe key prefix (sk_/pk_/rk_). */
export function detectKeyMode(key: string | undefined | null): StripeMode {
  if (!key) return 'unknown';
  if (/^(sk|pk|rk)_live_/.test(key)) return 'live';
  if (/^(sk|pk|rk)_test_/.test(key)) return 'test';
  return 'unknown';
}

function gbp(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

const EXPECTED_CURRENCY = 'gbp';

// ---------------------------------------------------------------------------
// Key mode consistency
// ---------------------------------------------------------------------------

export interface ModeCheck {
  severity: Severity;
  secret_key_mode: StripeMode;
  publishable_key_mode: StripeMode;
  consistent: boolean;
  issues: string[];
}

export function checkKeyMode(env: Record<string, string | undefined> = process.env): ModeCheck {
  const secret_key_mode = detectKeyMode(env.STRIPE_SECRET_KEY);
  const publishable_key_mode = detectKeyMode(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  const issues: string[] = [];
  const severities: Severity[] = [];

  if (secret_key_mode === 'unknown') {
    issues.push('STRIPE_SECRET_KEY is missing or has an unrecognised prefix.');
    severities.push('fail');
  }
  if (publishable_key_mode === 'unknown') {
    issues.push('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is missing or has an unrecognised prefix.');
    severities.push('fail');
  }

  const bothKnown = secret_key_mode !== 'unknown' && publishable_key_mode !== 'unknown';
  const consistent = bothKnown && secret_key_mode === publishable_key_mode;

  if (bothKnown && !consistent) {
    issues.push(
      `Secret key is in ${secret_key_mode} mode but the publishable key is in ${publishable_key_mode} mode. Checkout will fail for real users.`,
    );
    severities.push('fail');
  }

  return { severity: rollupSeverity(severities), secret_key_mode, publishable_key_mode, consistent, issues };
}

// ---------------------------------------------------------------------------
// Platform account
// ---------------------------------------------------------------------------

export interface AccountCheck {
  severity: Severity;
  ok: boolean;
  id: string | null;
  charges_enabled: boolean | null;
  details_submitted: boolean | null;
  error: string | null;
}

export async function checkAccount(client: Stripe): Promise<AccountCheck> {
  try {
    const account = await client.accounts.retrieve();
    const charges_enabled = account.charges_enabled ?? null;
    return {
      severity: charges_enabled === false ? 'fail' : 'ok',
      ok: true,
      id: account.id ?? null,
      charges_enabled,
      details_submitted: account.details_submitted ?? null,
      error: null,
    };
  } catch (e) {
    return {
      severity: 'fail',
      ok: false,
      id: null,
      charges_enabled: null,
      details_submitted: null,
      error: e instanceof Error ? e.message : 'Failed to reach Stripe',
    };
  }
}

// ---------------------------------------------------------------------------
// Plan prices
// ---------------------------------------------------------------------------

export interface PriceSpec {
  envKey: string;
  label: string;
  required: boolean;
  /** Reference amount in pence (from scripts/create-stripe-products.ts); mismatch is a warning, not a failure. */
  expectedAmount: number | null;
  metered: boolean;
}

export const PRICE_SPECS: PriceSpec[] = [
  { envKey: 'STRIPE_APPOINTMENTS_PRO_PRICE_ID', label: 'Appointments Pro', required: true, expectedAmount: 9900, metered: false },
  { envKey: 'STRIPE_APPOINTMENTS_PLUS_PRICE_ID', label: 'Appointments Plus', required: true, expectedAmount: 4900, metered: false },
  { envKey: 'STRIPE_LIGHT_PRICE_ID', label: 'Appointments Light', required: true, expectedAmount: 2000, metered: false },
  { envKey: 'STRIPE_RESTAURANT_PRICE_ID', label: 'Restaurant', required: true, expectedAmount: 7900, metered: false },
  { envKey: 'STRIPE_SMS_OVERAGE_PRICE_ID', label: 'SMS overage (metered)', required: false, expectedAmount: 6, metered: true },
];

export interface PriceCheck {
  severity: Severity;
  label: string;
  env_key: string;
  configured: boolean;
  id: string | null;
  active: boolean | null;
  currency: string | null;
  unit_amount: number | null;
  interval: string | null;
  usage_type: string | null;
  product_name: string | null;
  product_active: boolean | null;
  livemode: boolean | null;
  expected_amount: number | null;
  issues: string[];
}

/** Pure validation of a retrieved price against its spec — no network, unit-testable. */
export function evaluatePrice(spec: PriceSpec, price: Stripe.Price): { severity: Severity; issues: string[] } {
  const issues: string[] = [];
  const severities: Severity[] = [];

  if (price.active === false) {
    issues.push('Price is archived (inactive) in Stripe.');
    severities.push('fail');
  }

  const product = price.product;
  if (typeof product === 'object' && product !== null) {
    if ('deleted' in product && product.deleted) {
      issues.push('The product for this price has been deleted in Stripe.');
      severities.push('fail');
    } else if ('active' in product && product.active === false) {
      issues.push('The product for this price is inactive in Stripe.');
      severities.push('fail');
    }
  }

  if (price.currency && price.currency.toLowerCase() !== EXPECTED_CURRENCY) {
    issues.push(`Currency is ${price.currency.toUpperCase()}, expected GBP.`);
    severities.push('fail');
  }

  if (!price.recurring) {
    issues.push('Price is one-time, not a recurring subscription price.');
    severities.push('fail');
  } else {
    if (spec.metered && price.recurring.usage_type !== 'metered') {
      issues.push(`Expected a metered usage price but usage type is "${price.recurring.usage_type}".`);
      severities.push('fail');
    }
    if (!spec.metered && price.recurring.usage_type === 'metered') {
      issues.push('Base plan price is metered — this is likely the wrong price ID.');
      severities.push('fail');
    }
    if (price.recurring.interval !== 'month') {
      issues.push(`Billing interval is "${price.recurring.interval}", expected monthly.`);
      severities.push('warn');
    }
  }

  if (spec.expectedAmount != null && price.unit_amount != null && price.unit_amount !== spec.expectedAmount) {
    issues.push(
      `Amount is ${gbp(price.unit_amount)}, expected ${gbp(spec.expectedAmount)} (update the reference if pricing changed intentionally).`,
    );
    severities.push('warn');
  }

  return { severity: rollupSeverity(severities), issues };
}

async function checkOnePrice(client: Stripe, spec: PriceSpec, env: Record<string, string | undefined>): Promise<PriceCheck> {
  const id = env[spec.envKey]?.trim();
  const base = {
    label: spec.label,
    env_key: spec.envKey,
    expected_amount: spec.expectedAmount,
  };

  if (!id) {
    return {
      ...base,
      severity: spec.required ? 'fail' : 'warn',
      configured: false,
      id: null,
      active: null,
      currency: null,
      unit_amount: null,
      interval: null,
      usage_type: null,
      product_name: null,
      product_active: null,
      livemode: null,
      issues: [
        spec.required
          ? `${spec.envKey} is not set — this plan cannot be purchased.`
          : `${spec.envKey} is not set (optional — SMS overage billing is disabled).`,
      ],
    };
  }

  try {
    const price = await client.prices.retrieve(id, { expand: ['product'] });
    const { severity, issues } = evaluatePrice(spec, price);
    const product =
      typeof price.product === 'object' && price.product !== null && !('deleted' in price.product && price.product.deleted)
        ? (price.product as Stripe.Product)
        : null;
    return {
      ...base,
      severity,
      configured: true,
      id: price.id,
      active: price.active,
      currency: price.currency,
      unit_amount: price.unit_amount,
      interval: price.recurring?.interval ?? null,
      usage_type: price.recurring?.usage_type ?? null,
      product_name: product?.name ?? null,
      product_active: product?.active ?? null,
      livemode: price.livemode,
      issues,
    };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    const notFound = code === 'resource_missing';
    return {
      ...base,
      severity: 'fail',
      configured: true,
      id,
      active: null,
      currency: null,
      unit_amount: null,
      interval: null,
      usage_type: null,
      product_name: null,
      product_active: null,
      livemode: null,
      issues: [
        notFound
          ? `Price ${id} was not found on this Stripe account (wrong ID, wrong account, or wrong live/test mode).`
          : `Could not retrieve price ${id}: ${e instanceof Error ? e.message : 'unknown error'}.`,
      ],
    };
  }
}

export async function checkPrices(client: Stripe, env: Record<string, string | undefined> = process.env): Promise<PriceCheck[]> {
  return Promise.all(PRICE_SPECS.map((spec) => checkOnePrice(client, spec, env)));
}

// ---------------------------------------------------------------------------
// Webhook endpoints
// ---------------------------------------------------------------------------

export interface WebhookEndpointSpec {
  label: string;
  pathSuffix: string;
  secretEnvKey: string;
  requiredEvents: string[];
  recommendedEvents: string[];
}

export const WEBHOOK_SPECS: WebhookEndpointSpec[] = [
  {
    label: 'Subscription & billing webhook',
    pathSuffix: '/api/webhooks/stripe-subscription',
    secretEnvKey: 'STRIPE_ONBOARDING_WEBHOOK_SECRET',
    requiredEvents: [
      'checkout.session.completed',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'invoice.payment_succeeded',
      'invoice.payment_failed',
    ],
    recommendedEvents: [],
  },
  {
    label: 'Payments & deposits webhook',
    pathSuffix: '/api/webhooks/stripe',
    secretEnvKey: 'STRIPE_WEBHOOK_SECRET',
    requiredEvents: ['payment_intent.succeeded', 'payment_intent.payment_failed', 'charge.refunded'],
    recommendedEvents: [
      'account.updated',
      'charge.refund.updated',
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
    ],
  },
];

export interface WebhookEndpointCheck {
  severity: Severity;
  label: string;
  path_suffix: string;
  found: boolean;
  url: string | null;
  status: string | null;
  livemode: boolean | null;
  secret_env_present: boolean;
  missing_required_events: string[];
  missing_recommended_events: string[];
  issues: string[];
}

function endpointMatchesSuffix(url: string, suffix: string): boolean {
  try {
    return new URL(url).pathname.replace(/\/$/, '') === suffix;
  } catch {
    return url.replace(/\/$/, '').endsWith(suffix);
  }
}

export async function checkWebhookEndpoints(
  client: Stripe,
  opts: { mode: StripeMode; env?: Record<string, string | undefined> } = { mode: 'unknown' },
): Promise<WebhookEndpointCheck[]> {
  const env = opts.env ?? process.env;
  let endpoints: Stripe.WebhookEndpoint[] = [];
  let listError: string | null = null;
  try {
    const res = await client.webhookEndpoints.list({ limit: 100 });
    endpoints = res.data;
  } catch (e) {
    listError = e instanceof Error ? e.message : 'Failed to list webhook endpoints';
  }

  return WEBHOOK_SPECS.map((spec) => {
    const secret_env_present = Boolean(env[spec.secretEnvKey]?.trim());
    const issues: string[] = [];
    const severities: Severity[] = [];

    if (!secret_env_present) {
      issues.push(`${spec.secretEnvKey} is not set — signature verification will reject every delivery.`);
      severities.push('fail');
    }

    if (listError) {
      issues.push(`Could not list webhook endpoints from Stripe: ${listError}.`);
      severities.push('warn');
      return {
        severity: rollupSeverity(severities),
        label: spec.label,
        path_suffix: spec.pathSuffix,
        found: false,
        url: null,
        status: null,
        livemode: null,
        secret_env_present,
        missing_required_events: spec.requiredEvents,
        missing_recommended_events: spec.recommendedEvents,
        issues,
      };
    }

    const match = endpoints.find((e) => endpointMatchesSuffix(e.url, spec.pathSuffix));

    if (!match) {
      const sev: Severity = opts.mode === 'test' ? 'warn' : 'fail';
      issues.push(
        opts.mode === 'test'
          ? `No registered endpoint points at ${spec.pathSuffix} (expected in test mode if you forward events with the Stripe CLI).`
          : `No registered Stripe endpoint points at ${spec.pathSuffix}.`,
      );
      severities.push(sev);
      return {
        severity: rollupSeverity(severities),
        label: spec.label,
        path_suffix: spec.pathSuffix,
        found: false,
        url: null,
        status: null,
        livemode: null,
        secret_env_present,
        missing_required_events: spec.requiredEvents,
        missing_recommended_events: spec.recommendedEvents,
        issues,
      };
    }

    const enabled = match.enabled_events ?? [];
    const wildcard = enabled.includes('*');
    const missingRequired = wildcard ? [] : spec.requiredEvents.filter((ev) => !enabled.includes(ev));
    const missingRecommended = wildcard ? [] : spec.recommendedEvents.filter((ev) => !enabled.includes(ev));

    if (match.status !== 'enabled') {
      issues.push(`Endpoint is "${match.status}" in Stripe — no events will be delivered.`);
      severities.push('fail');
    }
    if (missingRequired.length > 0) {
      issues.push(`Missing required events: ${missingRequired.join(', ')}.`);
      severities.push('fail');
    }
    if (missingRecommended.length > 0) {
      issues.push(`Missing recommended events: ${missingRecommended.join(', ')}.`);
      severities.push('warn');
    }

    return {
      severity: rollupSeverity(severities),
      label: spec.label,
      path_suffix: spec.pathSuffix,
      found: true,
      url: match.url,
      status: match.status,
      livemode: match.livemode,
      secret_env_present,
      missing_required_events: missingRequired,
      missing_recommended_events: missingRecommended,
      issues,
    };
  });
}

// ---------------------------------------------------------------------------
// Env presence
// ---------------------------------------------------------------------------

export interface EnvItem {
  key: string;
  present: boolean;
  required: boolean;
}

export const REQUIRED_ENV_KEYS: Array<{ key: string; required: boolean }> = [
  { key: 'STRIPE_SECRET_KEY', required: true },
  { key: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', required: true },
  { key: 'STRIPE_WEBHOOK_SECRET', required: true },
  { key: 'STRIPE_ONBOARDING_WEBHOOK_SECRET', required: true },
  { key: 'STRIPE_APPOINTMENTS_PRO_PRICE_ID', required: true },
  { key: 'STRIPE_APPOINTMENTS_PLUS_PRICE_ID', required: true },
  { key: 'STRIPE_LIGHT_PRICE_ID', required: true },
  { key: 'STRIPE_RESTAURANT_PRICE_ID', required: true },
  { key: 'STRIPE_SMS_OVERAGE_PRICE_ID', required: false },
];

export function checkEnvPresence(env: Record<string, string | undefined> = process.env): { severity: Severity; items: EnvItem[] } {
  const items = REQUIRED_ENV_KEYS.map(({ key, required }) => ({
    key,
    present: Boolean(env[key]?.trim()),
    required,
  }));
  const missingRequired = items.some((e) => e.required && !e.present);
  return { severity: missingRequired ? 'fail' : 'ok', items };
}
