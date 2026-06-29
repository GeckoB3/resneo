'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';

type Severity = 'ok' | 'warn' | 'fail';

interface ModeCheck {
  severity: Severity;
  secret_key_mode: string;
  publishable_key_mode: string;
  consistent: boolean;
  issues: string[];
}
interface AccountCheck {
  severity: Severity;
  ok: boolean;
  id: string | null;
  charges_enabled: boolean | null;
  details_submitted: boolean | null;
  error: string | null;
}
interface ConnectCheck {
  severity: Severity;
  enabled: boolean;
  has_connected_accounts: boolean | null;
  error: string | null;
  issues: string[];
}
interface PriceCheck {
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
interface WebhookEndpointCheck {
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
interface EnvItem {
  key: string;
  present: boolean;
  required: boolean;
}
interface HealthPayload {
  overall: Severity;
  mode: ModeCheck;
  account: AccountCheck;
  connect: ConnectCheck;
  prices: PriceCheck[];
  webhooks: {
    endpoints: WebhookEndpointCheck[];
    db: {
      severity: Severity;
      last_event_at: string | null;
      last_event_type: string | null;
      events_24h: number;
      stale_after_hours: number;
      stale: boolean;
    };
  };
  billing: {
    severity: Severity;
    by_status: Array<{ plan_status: string; count: number }>;
    past_due_count: number;
  };
  env: { severity: Severity; items: EnvItem[] };
  generated_at: string;
}

interface SmokeResult {
  label: string;
  env_key: string;
  ok: boolean;
  error: string | null;
  session_id: string | null;
  expired: boolean;
}
interface SmokePayload {
  ok: boolean;
  results: SmokeResult[];
  note: string;
  generated_at: string;
}
interface ConnectSmokePayload {
  ok: boolean;
  account_created: boolean;
  account_link_created: boolean;
  cleaned_up: boolean;
  account_id: string | null;
  error: string | null;
  cleanup_error: string | null;
  note: string;
  generated_at: string;
}

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'just now';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function gbp(pence: number | null): string {
  return pence == null ? '—' : `£${(pence / 100).toFixed(2)}`;
}

const SEV_DOT: Record<Severity, string> = { ok: 'bg-emerald-500', warn: 'bg-amber-500', fail: 'bg-rose-500' };
const SEV_TEXT: Record<Severity, string> = { ok: 'text-slate-900', warn: 'text-amber-700', fail: 'text-rose-700' };
const SEV_CARD: Record<Severity, string> = {
  ok: 'border-slate-200 bg-white',
  warn: 'border-amber-200 bg-amber-50/50',
  fail: 'border-rose-200 bg-rose-50/50',
};
const SEV_PILL: Record<Severity, string> = {
  ok: 'bg-emerald-100 text-emerald-700',
  warn: 'bg-amber-100 text-amber-700',
  fail: 'bg-rose-100 text-rose-700',
};
const SEV_PILL_LABEL: Record<Severity, string> = { ok: 'Healthy', warn: 'Warning', fail: 'Action needed' };

export function StripeHealthPageClient() {
  const [data, setData] = useState<HealthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [smoke, setSmoke] = useState<SmokePayload | null>(null);
  const [smokeLoading, setSmokeLoading] = useState(false);
  const [smokeError, setSmokeError] = useState<string | null>(null);

  const [connectSmoke, setConnectSmoke] = useState<ConnectSmokePayload | null>(null);
  const [connectSmokeLoading, setConnectSmokeLoading] = useState(false);
  const [connectSmokeError, setConnectSmokeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/platform/stripe-health', { credentials: 'same-origin' });
      const body = (await res.json().catch(() => ({}))) as HealthPayload & { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Failed to load Stripe health');
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runSmoke = useCallback(async () => {
    setSmokeLoading(true);
    setSmokeError(null);
    try {
      const res = await fetch('/api/platform/stripe-health/smoke-test', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const body = (await res.json().catch(() => ({}))) as SmokePayload & { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Smoke test failed');
      setSmoke(body);
    } catch (e) {
      setSmokeError(e instanceof Error ? e.message : 'Smoke test failed');
    } finally {
      setSmokeLoading(false);
    }
  }, []);

  const runConnectSmoke = useCallback(async () => {
    setConnectSmokeLoading(true);
    setConnectSmokeError(null);
    try {
      const res = await fetch('/api/platform/stripe-health/smoke-test/connect', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const body = (await res.json().catch(() => ({}))) as ConnectSmokePayload & { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Connect onboarding test failed');
      setConnectSmoke(body);
    } catch (e) {
      setConnectSmokeError(e instanceof Error ? e.message : 'Connect onboarding test failed');
    } finally {
      setConnectSmokeLoading(false);
    }
  }, []);

  const pricesSeverity: Severity | null = data
    ? data.prices.some((p) => p.severity === 'fail')
      ? 'fail'
      : data.prices.some((p) => p.severity === 'warn')
        ? 'warn'
        : 'ok'
    : null;
  const webhookSeverity: Severity | null = data
    ? [...data.webhooks.endpoints.map((e) => e.severity), data.webhooks.db.severity].includes('fail')
      ? 'fail'
      : [...data.webhooks.endpoints.map((e) => e.severity), data.webhooks.db.severity].includes('warn')
        ? 'warn'
        : 'ok'
    : null;
  const pricesOk = data ? data.prices.filter((p) => p.severity === 'ok').length : 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Billing health</h1>
          <p className="mt-1 text-sm text-slate-500">
            Can users sign up and manage subscriptions right now? Live checks against Stripe keys, prices and webhooks.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          <svg className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          Refresh
        </button>
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>
      ) : null}

      {data ? (
        <>
          <OverallBanner severity={data.overall} generatedAt={data.generated_at} />

          {/* Summary tiles */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
            <SeverityTile
              label="Keys & mode"
              severity={data.mode.severity}
              value={data.mode.secret_key_mode}
              hint={data.mode.consistent ? 'secret + publishable aligned' : 'key mode mismatch'}
            />
            <SeverityTile
              label="Platform account"
              severity={data.account.severity}
              value={data.account.ok ? (data.account.charges_enabled ? 'Charges on' : 'Charges off') : 'Error'}
              hint={data.account.id ?? data.account.error ?? 'unknown'}
            />
            <SeverityTile
              label="Connect"
              severity={data.connect.severity}
              value={data.connect.enabled ? 'Enabled' : 'Unavailable'}
              hint={data.connect.enabled ? 'venues can onboard for payments' : 'venue payment onboarding blocked'}
            />
            <SeverityTile
              label="Plan prices"
              severity={pricesSeverity ?? 'ok'}
              value={`${pricesOk}/${data.prices.length}`}
              hint="price IDs valid in Stripe"
            />
            <SeverityTile
              label="Webhooks"
              severity={webhookSeverity ?? 'ok'}
              value={`${data.webhooks.endpoints.filter((e) => e.found && e.status === 'enabled').length}/${data.webhooks.endpoints.length}`}
              hint={`last event ${ago(data.webhooks.db.last_event_at)}`}
            />
          </div>

          {/* Keys & mode */}
          <Section title="API keys & mode" severity={data.mode.severity}>
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <Field label="Secret key" value={data.mode.secret_key_mode} mono />
              <Field label="Publishable key" value={data.mode.publishable_key_mode} mono />
              <Field label="Aligned" value={data.mode.consistent ? 'yes' : 'no'} />
            </dl>
            <IssueList issues={data.mode.issues} />
          </Section>

          {/* Connect / payment onboarding */}
          <Section
            title="Payment onboarding (Connect)"
            severity={data.connect.severity}
            subtitle="Whether a venue can start Stripe payment onboarding in this mode. Connect is configured per mode (test vs live)."
          >
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <Field label="Connect API" value={data.connect.enabled ? 'reachable' : 'unavailable'} />
              <Field
                label="Connected accounts"
                value={
                  data.connect.has_connected_accounts == null
                    ? '—'
                    : data.connect.has_connected_accounts
                      ? 'present'
                      : 'none yet'
                }
              />
            </dl>
            <IssueList issues={data.connect.issues} />

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-700">Onboarding smoke test</p>
                  <p className="text-xs text-slate-500">
                    Creates a throwaway Express account and onboarding link exactly as venue setup does, then deletes it.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void runConnectSmoke()}
                  disabled={connectSmokeLoading}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
                >
                  {connectSmokeLoading ? 'Running…' : 'Run onboarding test'}
                </button>
              </div>
              {connectSmokeError ? <p className="mt-3 text-sm text-rose-700">{connectSmokeError}</p> : null}
              {connectSmoke ? (
                <div className="mt-4 space-y-2">
                  <div
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2.5 text-sm ${
                      connectSmoke.ok ? 'border-slate-200 bg-white' : 'border-rose-200 bg-rose-50/50'
                    }`}
                  >
                    <span className="font-medium text-slate-800">
                      {connectSmoke.ok
                        ? 'A venue can start payment onboarding right now.'
                        : 'Onboarding would fail for venues.'}
                    </span>
                    <SeverityPill severity={connectSmoke.ok ? 'ok' : 'fail'} />
                  </div>
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    <StepPill ok={connectSmoke.account_created} label="account created" />
                    <StepPill ok={connectSmoke.account_link_created} label="onboarding link" />
                    <StepPill ok={connectSmoke.cleaned_up} label="cleaned up" />
                  </div>
                  {connectSmoke.error ? <p className="text-xs text-rose-700">{connectSmoke.error}</p> : null}
                  {connectSmoke.cleanup_error ? (
                    <p className="text-xs text-amber-700">
                      Test account {connectSmoke.account_id} could not be deleted automatically: {connectSmoke.cleanup_error}
                    </p>
                  ) : null}
                  <p className="text-[11px] text-slate-400">{connectSmoke.note}</p>
                </div>
              ) : null}
            </div>
          </Section>

          {/* Prices */}
          <Section title="Plan prices" severity={pricesSeverity ?? undefined} subtitle="Each plan’s price ID resolved against Stripe.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Plan</th>
                    <th className="px-4 py-2.5 font-medium">Price ID</th>
                    <th className="px-4 py-2.5 font-medium">Amount</th>
                    <th className="px-4 py-2.5 font-medium">Interval</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.prices.map((p) => (
                    <tr key={p.env_key} className="align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{p.label}</div>
                        <div className="font-mono text-[10px] text-slate-400">{p.env_key}</div>
                        <IssueList issues={p.issues} />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{p.id ?? '—'}</td>
                      <td className="px-4 py-3 text-xs tabular-nums text-slate-700">
                        {gbp(p.unit_amount)}
                        {p.usage_type === 'metered' ? <span className="text-slate-400"> /unit</span> : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{p.interval ?? '—'}</td>
                      <td className="px-4 py-3">
                        <SeverityPill severity={p.severity} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Webhooks */}
          <Section title="Webhook endpoints" severity={webhookSeverity ?? undefined} subtitle="Registered in Stripe and matched by URL path.">
            <div className="space-y-3">
              {data.webhooks.endpoints.map((w) => (
                <div key={w.path_suffix} className={`rounded-xl border p-4 ${SEV_CARD[w.severity]}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{w.label}</p>
                      <p className="font-mono text-[11px] text-slate-500">{w.url ?? w.path_suffix}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {w.found ? (
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                          {w.status}
                        </span>
                      ) : null}
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          w.secret_env_present ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                        }`}
                      >
                        secret {w.secret_env_present ? 'set' : 'missing'}
                      </span>
                      <SeverityPill severity={w.severity} />
                    </div>
                  </div>
                  <IssueList issues={w.issues} />
                </div>
              ))}

              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-700">Recent deliveries</p>
                  <SeverityPill severity={data.webhooks.db.severity} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {data.webhooks.db.events_24h} processed in 24h · last event{' '}
                  {data.webhooks.db.last_event_type ? (
                    <span className="font-mono">{data.webhooks.db.last_event_type}</span>
                  ) : (
                    '—'
                  )}{' '}
                  {ago(data.webhooks.db.last_event_at)}
                </p>
                {data.webhooks.db.stale ? (
                  <p className="mt-1 text-xs text-amber-700">
                    No webhook processed in over {data.webhooks.db.stale_after_hours}h — verify the endpoint and signing secret.
                  </p>
                ) : null}
              </div>
            </div>
          </Section>

          {/* Billing drift */}
          <Section title="Subscription status" severity={data.billing.severity} subtitle="Venue plan_status counts from the database.">
            {data.billing.by_status.length === 0 ? (
              <p className="text-sm text-slate-400">No venues with a plan status yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.billing.by_status.map((s) => (
                  <span
                    key={s.plan_status}
                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                      s.plan_status === 'past_due' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <span className="font-medium text-slate-700">{s.plan_status}</span>
                    <span className="rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold text-white">{s.count}</span>
                  </span>
                ))}
              </div>
            )}
          </Section>

          {/* Smoke test */}
          <Section title="Checkout smoke test" subtitle="Opens and immediately expires a real Checkout Session per plan. No customer, no charge.">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void runSmoke()}
                disabled={smokeLoading}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
              >
                {smokeLoading ? 'Running…' : 'Run checkout smoke test'}
              </button>
              {smoke ? (
                <span className={`text-sm font-medium ${smoke.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {smoke.ok ? 'All plans opened a valid checkout.' : 'One or more plans failed.'}
                </span>
              ) : null}
            </div>
            {smokeError ? <p className="mt-3 text-sm text-rose-700">{smokeError}</p> : null}
            {smoke ? (
              <div className="mt-4 space-y-2">
                {smoke.results.map((r) => (
                  <div
                    key={r.env_key}
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2.5 text-sm ${
                      r.ok ? 'border-slate-200 bg-white' : 'border-rose-200 bg-rose-50/50'
                    }`}
                  >
                    <span className="font-medium text-slate-800">{r.label}</span>
                    <span className="flex items-center gap-2">
                      {r.ok ? (
                        <span className="text-xs text-slate-500">
                          session {r.session_id} {r.expired ? '· expired' : '· created'}
                        </span>
                      ) : (
                        <span className="text-xs text-rose-700">{r.error}</span>
                      )}
                      <SeverityPill severity={r.ok ? 'ok' : 'fail'} />
                    </span>
                  </div>
                ))}
                <p className="text-[11px] text-slate-400">{smoke.note}</p>
              </div>
            ) : null}
          </Section>

          {/* Env presence */}
          <Section title="Environment variables" severity={data.env.severity} subtitle="Presence only — values are never read into the dashboard.">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {data.env.items.map((e) => (
                <div key={e.key} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                  <span className="font-mono text-xs text-slate-600">{e.key}</span>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      e.present
                        ? 'bg-emerald-100 text-emerald-700'
                        : e.required
                          ? 'bg-rose-100 text-rose-700'
                          : 'bg-slate-200 text-slate-500'
                    }`}
                  >
                    {e.present ? 'set' : e.required ? 'missing' : 'optional'}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        </>
      ) : loading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function OverallBanner({ severity, generatedAt }: { severity: Severity; generatedAt: string }) {
  const map: Record<Severity, { bg: string; text: string; title: string; body: string }> = {
    ok: {
      bg: 'border-emerald-200 bg-emerald-50',
      text: 'text-emerald-800',
      title: 'Billing is healthy',
      body: 'Keys, prices and webhooks all check out. Users can sign up and manage subscriptions.',
    },
    warn: {
      bg: 'border-amber-200 bg-amber-50',
      text: 'text-amber-800',
      title: 'Billing works, with warnings',
      body: 'Core checkout should work, but review the warnings below.',
    },
    fail: {
      bg: 'border-rose-200 bg-rose-50',
      text: 'text-rose-800',
      title: 'Billing needs attention',
      body: 'One or more critical checks failed — users may be unable to sign up or pay.',
    },
  };
  const m = map[severity];
  return (
    <div className={`rounded-2xl border px-5 py-4 ${m.bg}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${SEV_DOT[severity]} ${severity !== 'ok' ? 'animate-pulse' : ''}`} />
        <div>
          <p className={`text-base font-bold ${m.text}`}>{m.title}</p>
          <p className={`text-sm ${m.text} opacity-80`}>{m.body}</p>
          <p className="mt-1 text-[11px] text-slate-400">Checked {ago(generatedAt)}</p>
        </div>
      </div>
    </div>
  );
}

function SeverityTile({ label, severity, value, hint }: { label: string; severity: Severity; value: string; hint: string }) {
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${SEV_CARD[severity]}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${SEV_DOT[severity]} ${severity !== 'ok' ? 'animate-pulse' : ''}`} />
        <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</p>
      </div>
      <p className={`mt-2 truncate text-2xl font-bold tracking-tight ${SEV_TEXT[severity]}`}>{value}</p>
      <p className="mt-0.5 truncate text-[11px] text-slate-400">{hint}</p>
    </div>
  );
}

function Section({
  title,
  subtitle,
  severity,
  children,
}: {
  title: string;
  subtitle?: string;
  severity?: Severity;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
        </div>
        {severity ? <SeverityPill severity={severity} /> : null}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function SeverityPill({ severity }: { severity: Severity }) {
  return (
    <span className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${SEV_PILL[severity]}`}>
      {SEV_PILL_LABEL[severity]}
    </span>
  );
}

function StepPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
        ok ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'
      }`}
    >
      {ok ? '✓' : '–'} {label}
    </span>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className={`mt-0.5 text-slate-800 ${mono ? 'font-mono text-xs' : 'text-sm'}`}>{value}</dd>
    </div>
  );
}

function IssueList({ issues }: { issues: string[] }) {
  if (!issues || issues.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1">
      {issues.map((it, i) => (
        <li key={i} className="flex gap-2 text-xs text-slate-600">
          <span className="text-slate-300">•</span>
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}
