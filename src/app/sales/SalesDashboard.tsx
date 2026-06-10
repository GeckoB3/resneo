'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SalesDashboardData } from '@/lib/sales/load-dashboard';

function formatGbp(pence: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100);
}

function formatMonth(iso: string): string {
  try {
    const d = new Date(`${iso}T00:00:00.000Z`);
    return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  } catch {
    return iso;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return iso;
  }
}

function StatusPill({ status }: { status: string | null }) {
  const s = (status ?? '').toLowerCase().trim();
  const styles: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    trialing: 'bg-blue-50 text-blue-700 ring-blue-600/20',
    past_due: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    cancelling: 'bg-orange-50 text-orange-700 ring-orange-600/20',
    cancelled: 'bg-slate-100 text-slate-600 ring-slate-500/20',
    churned: 'bg-slate-100 text-slate-600 ring-slate-500/20',
    pending: 'bg-slate-50 text-slate-500 ring-slate-400/20',
  };
  const cls = styles[s] ?? 'bg-slate-50 text-slate-600 ring-slate-400/20';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset capitalize ${cls}`}>
      {s.replace('_', ' ') || '—'}
    </span>
  );
}

const KPI_ICONS: Record<string, React.ReactNode> = {
  signups: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
  ),
  validated: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
  ),
  subscribers: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
  ),
  month: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
  ),
  lifetime: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
  ),
};

function KpiCard({ icon, label, value, accent }: { icon: string; label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${accent ? 'border-blue-200 bg-gradient-to-br from-blue-50 to-white' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-center gap-2">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${accent ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
          <svg className="h-4.5 w-4.5" style={{ height: 18, width: 18 }} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            {KPI_ICONS[icon]}
          </svg>
        </span>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
    </div>
  );
}

export function SalesDashboard() {
  const [data, setData] = useState<SalesDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/sales/overview', { credentials: 'same-origin' });
      const body = (await res.json().catch(() => ({}))) as SalesDashboardData & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Failed to load (${res.status})`);
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function copyShareLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — the link is still visible to copy manually.
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
          Loading your dashboard…
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error ?? 'Unable to load dashboard'}
        </p>
      </div>
    );
  }

  const { summary, bonus_ladder, codes, statements, attributions, salesperson } = data;
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://www.resneo.com';
  const primaryCode = codes.find((c) => c.active)?.code ?? codes[0]?.code ?? '';
  const shareLink = `${origin}/signup/choose-plan?sales=${encodeURIComponent(primaryCode)}`;

  const nextTier = bonus_ladder.next_tier;
  const prevThreshold = nextTier
    ? bonus_ladder.tiers
        .filter((t) => t.threshold < nextTier.threshold)
        .reduce((max, t) => Math.max(max, t.threshold), 0)
    : 0;
  const tierProgress = nextTier
    ? Math.min(
        100,
        Math.max(
          0,
          ((summary.active_paying_subscribers - prevThreshold) / (nextTier.threshold - prevThreshold)) * 100,
        ),
      )
    : 100;

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6 lg:p-10">
      {/* Hero */}
      <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 p-6 text-white shadow-lg sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-blue-300">Resneo Sales</p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
              {salesperson.name?.trim() || 'Sales dashboard'}
            </h1>
            <p className="mt-2 max-w-lg text-sm text-slate-300">
              Track your signups, revenue share, and bonuses. Figures are informational — payments are made
              outside Resneo at the end of each month.
            </p>
          </div>
          {primaryCode && (
            <div className="shrink-0 rounded-2xl bg-white/10 p-4 backdrop-blur">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-300">Your code</p>
              <p className="mt-1 font-mono text-xl font-bold tracking-wide text-white">{primaryCode}</p>
              <button
                type="button"
                onClick={() => void copyShareLink(shareLink)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 shadow-sm transition-colors hover:bg-blue-50"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                </svg>
                {copied ? 'Copied!' : 'Copy signup link'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard icon="signups" label="Total signups" value={String(summary.total_signups)} />
        <KpiCard icon="validated" label="Validated sales" value={String(summary.validated_signups)} />
        <KpiCard icon="subscribers" label="Active subscribers" value={String(summary.active_paying_subscribers)} />
        <KpiCard icon="month" label="This month (est.)" value={formatGbp(summary.current_month_estimated_pence)} accent />
        <KpiCard icon="lifetime" label="Lifetime earnings" value={formatGbp(summary.lifetime_earnings_pence)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Reward terms */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-900">Your reward terms</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
              <dt className="text-slate-600">Lump sum per validated signup</dt>
              <dd className="font-semibold text-slate-900">{formatGbp(salesperson.lump_sum_per_signup_pence)}</dd>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
              <dt className="text-slate-600">Revenue share</dt>
              <dd className="font-semibold text-slate-900">{salesperson.revenue_share_percent}%</dd>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
              <dt className="text-slate-600">Share duration per venue</dt>
              <dd className="font-semibold text-slate-900">{salesperson.revenue_share_months} months</dd>
            </div>
          </dl>
          {codes.length > 1 && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="text-xs font-medium text-slate-500">All your codes</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {codes.map((c) => (
                  <span
                    key={c.code}
                    className={`rounded-lg px-2.5 py-1 font-mono text-xs font-semibold ${
                      c.active ? 'bg-blue-50 text-blue-800' : 'bg-slate-100 text-slate-400 line-through'
                    }`}
                  >
                    {c.code}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Bonus ladder */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Subscriber bonus ladder</h2>
              <p className="mt-1 text-xs text-slate-500">
                One-time bonuses for active paying subscriber milestones. Each bonus pays once, even if your count
                later dips and recovers.
              </p>
            </div>
          </div>

          {nextTier && (
            <div className="mt-5">
              <div className="flex items-end justify-between text-xs">
                <span className="font-medium text-slate-600">
                  {summary.active_paying_subscribers} of {nextTier.threshold} subscribers
                </span>
                <span className="font-semibold text-blue-700">
                  Next: {formatGbp(nextTier.amount_pence)}
                </span>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all"
                  style={{ width: `${tierProgress}%` }}
                />
              </div>
            </div>
          )}

          <ul className="mt-5 grid gap-2 sm:grid-cols-2">
            {bonus_ladder.tiers.map((t) => {
              const reached = summary.active_paying_subscribers >= t.threshold;
              return (
                <li
                  key={t.threshold}
                  className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${
                    t.awarded
                      ? 'border-emerald-200 bg-emerald-50'
                      : reached
                        ? 'border-amber-200 bg-amber-50'
                        : 'border-slate-200 bg-white'
                  }`}
                >
                  <div>
                    <p className="font-semibold text-slate-900">{t.threshold} subscribers</p>
                    <p className="text-xs text-slate-500">{formatGbp(t.amount_pence)}</p>
                  </div>
                  {t.awarded ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                      Awarded
                    </span>
                  ) : reached ? (
                    <span className="text-xs font-semibold text-amber-700">Pending month-end</span>
                  ) : (
                    <span className="text-xs text-slate-400">
                      {t.threshold - summary.active_paying_subscribers} to go
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Monthly statements */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Monthly statements</h2>
          <p className="text-xs text-slate-500">Finalised on the 1st of each month (UTC). Payment follows outside Resneo.</p>
        </div>
        {statements.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-slate-500">No statements yet — your first statement is generated after your first full month.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Month</th>
                  <th className="px-5 py-3 font-medium">Signups</th>
                  <th className="px-5 py-3 font-medium">Validated</th>
                  <th className="px-5 py-3 font-medium">Lump sum</th>
                  <th className="px-5 py-3 font-medium">Rev. share</th>
                  <th className="px-5 py-3 font-medium">Bonus</th>
                  <th className="px-5 py-3 font-medium">Subscribers</th>
                  <th className="px-5 py-3 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {statements.map((s) => (
                  <tr key={s.period_month} className="hover:bg-slate-50/60">
                    <td className="px-5 py-3.5 font-medium text-slate-900">{formatMonth(s.period_month)}</td>
                    <td className="px-5 py-3.5 text-slate-600">{s.signups_count}</td>
                    <td className="px-5 py-3.5 text-slate-600">{s.validated_count}</td>
                    <td className="px-5 py-3.5 text-slate-600">{formatGbp(s.lump_sum_pence)}</td>
                    <td className="px-5 py-3.5 text-slate-600">{formatGbp(s.revenue_share_pence)}</td>
                    <td className="px-5 py-3.5 text-slate-600">{formatGbp(s.bonus_pence)}</td>
                    <td className="px-5 py-3.5 text-slate-600">{s.active_subscribers_end}</td>
                    <td className="px-5 py-3.5 text-right font-semibold text-slate-900">{formatGbp(s.total_pence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Attributed signups */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Attributed signups</h2>
          <p className="text-xs text-slate-500">Venues that signed up with your code.</p>
        </div>
        {attributions.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm font-medium text-slate-700">No signups yet</p>
            <p className="mt-1 text-sm text-slate-500">Share your signup link to start earning.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Venue</th>
                  <th className="px-5 py-3 font-medium">Plan</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Signed up</th>
                  <th className="px-5 py-3 font-medium">First paid</th>
                  <th className="px-5 py-3 font-medium">Rev. share left</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {attributions.map((a, i) => (
                  <tr key={a.venue_id ?? `row-${i}`} className="hover:bg-slate-50/60">
                    <td className="px-5 py-3.5 font-medium text-slate-900">{a.venue_name}</td>
                    <td className="px-5 py-3.5 text-slate-600">{a.pricing_tier ?? '—'}</td>
                    <td className="px-5 py-3.5">
                      <StatusPill status={a.plan_status ?? a.status} />
                    </td>
                    <td className="px-5 py-3.5 text-slate-600">{formatDate(a.signed_up_at)}</td>
                    <td className="px-5 py-3.5 text-slate-600">{a.first_paid_at ? formatDate(a.first_paid_at) : '—'}</td>
                    <td className="px-5 py-3.5 text-slate-600">
                      {a.revenue_share_months_remaining === null
                        ? '—'
                        : `${a.revenue_share_months_remaining} mo`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
