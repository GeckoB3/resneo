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

export function SalesDashboard() {
  const [data, setData] = useState<SalesDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-8">
        <p className="text-sm text-slate-500">Loading your dashboard…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error ?? 'Unable to load dashboard'}</p>
      </div>
    );
  }

  const { summary, bonus_ladder, codes, statements, attributions, salesperson } = data;
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://www.resneo.com';

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6 lg:p-10">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Sales dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Track signups and estimated earnings. Payments are processed outside Resneo at month end.
        </p>
      </div>

      {codes.length > 0 && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-5">
          <h2 className="text-sm font-semibold text-slate-900">Your discount code{codes.length > 1 ? 's' : ''}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {codes.map((c) => (
              <span
                key={c.code}
                className={`rounded-lg px-3 py-1.5 font-mono text-sm font-semibold ${
                  c.active ? 'bg-white text-blue-800 shadow-sm' : 'bg-slate-200 text-slate-500 line-through'
                }`}
              >
                {c.code}
              </span>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-600">
            Share:{' '}
            <code className="rounded bg-white px-1.5 py-0.5 text-[11px]">
              {origin}/signup/choose-plan?sales={codes[0]?.code ?? ''}
            </code>
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Total signups', value: String(summary.total_signups) },
          { label: 'Validated sales', value: String(summary.validated_signups) },
          { label: 'Active paying subscribers', value: String(summary.active_paying_subscribers) },
          { label: 'Lifetime earnings (est.)', value: formatGbp(summary.lifetime_earnings_pence) },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{kpi.label}</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Your reward terms</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Lump sum per validated signup</dt>
              <dd className="font-medium text-slate-900">{formatGbp(salesperson.lump_sum_per_signup_pence)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Revenue share</dt>
              <dd className="font-medium text-slate-900">
                {salesperson.revenue_share_percent}% for {salesperson.revenue_share_months} months
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Subscriber bonus ladder</h2>
          <p className="mt-1 text-xs text-slate-500">
            One-time bonuses when you reach active paying subscriber milestones (each pays once).
          </p>
          <ul className="mt-4 space-y-2">
            {bonus_ladder.tiers.map((t) => (
              <li key={t.threshold} className="flex items-center justify-between text-sm">
                <span className={t.awarded ? 'text-emerald-700' : 'text-slate-700'}>
                  {t.threshold} subscribers → {formatGbp(t.amount_pence)}
                </span>
                {t.awarded ? (
                  <span className="text-xs font-medium text-emerald-600">Awarded</span>
                ) : summary.active_paying_subscribers >= t.threshold ? (
                  <span className="text-xs font-medium text-amber-600">Pending month-end</span>
                ) : (
                  <span className="text-xs text-slate-400">
                    {t.threshold - summary.active_paying_subscribers} to go
                  </span>
                )}
              </li>
            ))}
          </ul>
          {bonus_ladder.next_tier && (
            <p className="mt-4 text-xs text-slate-600">
              Next: {bonus_ladder.next_tier.threshold} subscribers for{' '}
              {formatGbp(bonus_ladder.next_tier.amount_pence)}
            </p>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Monthly statements</h2>
          <p className="text-xs text-slate-500">Computed on the 1st of each month (UTC)</p>
        </div>
        {statements.length === 0 ? (
          <p className="px-5 py-8 text-sm text-slate-500">No statements yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Month</th>
                  <th className="px-4 py-3">Signups</th>
                  <th className="px-4 py-3">Validated</th>
                  <th className="px-4 py-3">Lump sum</th>
                  <th className="px-4 py-3">Rev. share</th>
                  <th className="px-4 py-3">Bonus</th>
                  <th className="px-4 py-3">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {statements.map((s) => (
                  <tr key={s.period_month}>
                    <td className="px-4 py-3 font-medium">{formatMonth(s.period_month)}</td>
                    <td className="px-4 py-3">{s.signups_count}</td>
                    <td className="px-4 py-3">{s.validated_count}</td>
                    <td className="px-4 py-3">{formatGbp(s.lump_sum_pence)}</td>
                    <td className="px-4 py-3">{formatGbp(s.revenue_share_pence)}</td>
                    <td className="px-4 py-3">{formatGbp(s.bonus_pence)}</td>
                    <td className="px-4 py-3 font-semibold">{formatGbp(s.total_pence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Attributed signups</h2>
        </div>
        {attributions.length === 0 ? (
          <p className="px-5 py-8 text-sm text-slate-500">No signups yet. Share your code to get started.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Venue</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Signed up</th>
                  <th className="px-4 py-3">First paid</th>
                  <th className="px-4 py-3">Rev. share left</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {attributions.map((a, i) => (
                  <tr key={a.venue_id ?? `row-${i}`}>
                    <td className="px-4 py-3 font-medium">{a.venue_name}</td>
                    <td className="px-4 py-3">{a.pricing_tier ?? '—'}</td>
                    <td className="px-4 py-3 capitalize">{a.plan_status ?? a.status}</td>
                    <td className="px-4 py-3">{formatDate(a.signed_up_at)}</td>
                    <td className="px-4 py-3">{a.first_paid_at ? formatDate(a.first_paid_at) : '—'}</td>
                    <td className="px-4 py-3">
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
