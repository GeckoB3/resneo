'use client';

import { useCallback, useEffect, useState } from 'react';

interface RevenuePayload {
  snapshot: {
    mrr_pence: number;
    arr_pence: number;
    paying_venues: number;
    arpv_pence: number;
    trialing_venues: number;
    trial_pipeline_pence: number;
    past_due_venues: number;
    at_risk_mrr_pence: number;
    comped_venues: number;
  };
  by_plan: Array<{ plan: string; count: number; mrr_pence: number }>;
  collected_by_month: Array<{ month: string; amount_pence: number }>;
  recent_invoices: Array<{
    stripe_invoice_id: string;
    venue_name: string;
    amount_pence: number;
    currency: string;
    paid_at: string | null;
  }>;
}

function gbp(pence: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: pence % 100 === 0 ? 0 : 2,
  }).format(pence / 100);
}

function monthLabel(iso: string): string {
  try {
    return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString('en-GB', {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    });
  } catch {
    return iso;
  }
}

function dateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export function RevenuePageClient() {
  const [data, setData] = useState<RevenuePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/platform/revenue', { credentials: 'same-origin' });
      const body = (await res.json().catch(() => ({}))) as RevenuePayload & { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Failed to load revenue');
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

  if (loading && !data) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-8 sm:px-6 lg:px-8">
        <div className="h-8 w-48 animate-pulse rounded bg-slate-200" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error ?? 'Failed to load revenue'}
        </p>
      </div>
    );
  }

  const { snapshot, by_plan, collected_by_month, recent_invoices } = data;
  const maxMonth = Math.max(1, ...collected_by_month.map((m) => m.amount_pence));
  const maxPlanMrr = Math.max(1, ...by_plan.map((p) => p.mrr_pence));

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Revenue</h1>
          <p className="mt-1 text-sm text-slate-500">
            MRR computed from live venue plans. Collected revenue comes from the Stripe invoice ledger
            (recorded from the webhook since deployment). Test and comped venues excluded from MRR.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
        <a
          href="/api/platform/export?type=invoices"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Export invoices CSV
        </a>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-emerald-700">MRR</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-emerald-900">{gbp(snapshot.mrr_pence)}</p>
          <p className="mt-1 text-[11px] text-emerald-700/70">ARR {gbp(snapshot.arr_pence)}</p>
        </div>
        <Kpi label="Paying venues" value={String(snapshot.paying_venues)} hint={`ARPV ${gbp(snapshot.arpv_pence)}/mo`} />
        <Kpi
          label="Trial pipeline"
          value={gbp(snapshot.trial_pipeline_pence)}
          hint={`${snapshot.trialing_venues} venue${snapshot.trialing_venues === 1 ? '' : 's'} trialing`}
        />
        <Kpi
          label="At-risk MRR"
          value={gbp(snapshot.at_risk_mrr_pence)}
          hint={`${snapshot.past_due_venues} past due`}
          danger={snapshot.past_due_venues > 0}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* MRR by plan */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">MRR by plan</h2>
          {by_plan.length === 0 ? (
            <p className="mt-4 text-sm text-slate-400">No paying venues yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {by_plan.map((p) => (
                <li key={p.plan}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium text-slate-800">{p.plan}</span>
                    <span className="tabular-nums text-slate-600">
                      {gbp(p.mrr_pence)} <span className="text-xs text-slate-400">({p.count})</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600"
                      style={{ width: `${Math.max(3, (p.mrr_pence / maxPlanMrr) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {snapshot.comped_venues > 0 && (
            <p className="mt-4 text-xs text-slate-400">
              {snapshot.comped_venues} comped venue{snapshot.comped_venues === 1 ? '' : 's'} excluded.
            </p>
          )}
        </div>

        {/* Collected by month */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Collected revenue (12 months)</h2>
          <div className="mt-4 flex h-40 items-end gap-1.5">
            {collected_by_month.map((m) => (
              <div key={m.month} className="group relative flex-1">
                <div
                  className="w-full rounded-t bg-blue-500/80 transition-colors group-hover:bg-blue-600"
                  style={{
                    height: `${Math.max(m.amount_pence > 0 ? 6 : 2, (m.amount_pence / maxMonth) * 152)}px`,
                  }}
                />
                <div className="pointer-events-none absolute -top-9 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white group-hover:block">
                  {monthLabel(m.month)}: {gbp(m.amount_pence)}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-slate-400">
            <span>{monthLabel(collected_by_month[0]?.month ?? '')}</span>
            <span>{monthLabel(collected_by_month[collected_by_month.length - 1]?.month ?? '')}</span>
          </div>
        </div>
      </div>

      {/* Recent invoices */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Recent invoices</h2>
          <p className="text-xs text-slate-500">Paid subscription invoices recorded by the Stripe webhook.</p>
        </div>
        {recent_invoices.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            No invoices recorded yet — entries appear as venues are billed after this feature deploys.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Venue</th>
                <th className="px-5 py-3 font-medium">Invoice</th>
                <th className="px-5 py-3 font-medium">Paid</th>
                <th className="px-5 py-3 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recent_invoices.map((inv) => (
                <tr key={inv.stripe_invoice_id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-medium text-slate-900">{inv.venue_name}</td>
                  <td className="px-5 py-3">
                    <a
                      href={`https://dashboard.stripe.com/invoices/${inv.stripe_invoice_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-blue-600 hover:underline"
                    >
                      …{inv.stripe_invoice_id.slice(-10)}
                    </a>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{dateTime(inv.paid_at)}</td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums text-slate-900">
                    {gbp(inv.amount_pence)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, hint, danger = false }: { label: string; value: string; hint?: string; danger?: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-2 text-3xl font-bold tracking-tight ${danger ? 'text-rose-600' : 'text-slate-900'}`}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-slate-400">{hint}</p> : null}
    </div>
  );
}
