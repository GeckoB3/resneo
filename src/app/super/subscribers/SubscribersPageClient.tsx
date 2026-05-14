'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { isSuperuserFreeBillingAccess } from '@/lib/billing/billing-access-source';
import { labelForBookingModelKey } from '@/lib/platform/subscriber-report';

interface PeriodByModel {
  [key: string]: number;
}

interface SubscriberVenueRow {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  pricing_tier: string;
  plan_status: string;
  billing_access_source: string | null;
  booking_model: string;
  enabled_model_labels: string[];
  created_at: string;
  updated_at: string;
  subscription_current_period_start: string | null;
  subscription_current_period_end: string | null;
  stripe_subscription_id: string | null;
  onboarding_completed: boolean;
  subscriber_days_on_platform: number;
  all_time_bookings: number;
  period_bookings: number;
  period_by_model: PeriodByModel;
  period_model_summary: string;
}

interface ApiPayload {
  period: { from: string; to_exclusive: string };
  summary: {
    new_venues_in_period: number;
    churned_in_period: number;
    active_subscriptions_snapshot: number;
    total_venues: number;
    bookings_in_period_total: number;
  };
  venues: SubscriberVenueRow[];
}

function utcYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysAgoUtcYmd(endYmd: string, daysInclusiveSpan: number): string {
  const [y, mo, d] = endYmd.split('-').map(Number);
  const start = new Date(Date.UTC(y, mo - 1, d - (daysInclusiveSpan - 1), 0, 0, 0, 0));
  return utcYmd(start);
}

function inclusiveEndFromExclusiveIso(toExclusiveIso: string): string {
  const d = new Date(toExclusiveIso);
  d.setUTCMilliseconds(d.getUTCMilliseconds() - 1);
  return utcYmd(d);
}

function tierBadge(tier: string) {
  const t = tier.toLowerCase().trim();
  if (t === 'appointments') return 'bg-violet-100 text-violet-700';
  if (t === 'plus') return 'bg-indigo-100 text-indigo-800';
  if (t === 'light') return 'bg-sky-100 text-sky-800';
  if (t === 'restaurant') return 'bg-blue-100 text-blue-700';
  if (t === 'founding') return 'bg-amber-100 text-amber-800';
  return 'bg-slate-100 text-slate-600';
}

function tierPillLabel(tier: string): string {
  const t = tier.toLowerCase().trim();
  if (t === 'appointments') return 'appointments pro';
  return tier;
}

function statusBadge(status: string) {
  const s = status.toLowerCase().trim();
  if (s === 'active') return 'bg-emerald-100 text-emerald-700';
  if (s === 'trialing') return 'bg-cyan-100 text-cyan-700';
  if (s === 'past_due') return 'bg-red-100 text-red-700';
  if (s === 'cancelled') return 'bg-slate-200 text-slate-500';
  if (s === 'cancelling') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-600';
}

function formatTenureDays(days: number): string {
  if (days < 45) return `${days} days`;
  if (days < 700) return `${Math.round(days / 30.4)} mo`;
  return `${(days / 365.25).toFixed(1)} yr`;
}

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return '—';
  }
}

const inputClass =
  'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100';

export function SubscribersPageClient() {
  const todayUtc = useMemo(() => utcYmd(new Date()), []);
  const [fromYmd, setFromYmd] = useState(() => daysAgoUtcYmd(todayUtc, 30));
  const [toYmd, setToYmd] = useState(todayUtc);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiPayload | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('from', fromYmd);
      params.set('to', toYmd);
      if (debouncedSearch) params.set('search', debouncedSearch);
      const res = await fetch(`/api/platform/subscribers?${params.toString()}`, { credentials: 'same-origin' });
      const body = (await res.json().catch(() => ({}))) as ApiPayload & { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? 'Failed to load subscribers');
      }
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [fromYmd, toYmd, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  function applyPreset(days: number) {
    const end = utcYmd(new Date());
    setToYmd(end);
    setFromYmd(daysAgoUtcYmd(end, days));
  }

  const periodLabel = data
    ? `${formatShortDate(data.period.from)} – ${inclusiveEndFromExclusiveIso(data.period.to_exclusive)}`
    : '';

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Subscribers</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Plans, enabled booking surfaces, booking volume, and subscription lifecycle signals across all venues. Booking
          counts use each booking&apos;s <span className="font-medium text-slate-700">created_at</span> timestamp.
          &quot;Churned&quot; counts venues that moved to cancelled or cancelling and had a profile update in the range
          after their venue was created (approximate; not a full billing audit trail).
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap gap-2">
            <span className="mr-1 self-center text-xs font-medium uppercase tracking-wide text-slate-400">Presets</span>
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => applyPreset(d)}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100"
              >
                Last {d} days
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                const y = new Date().getUTCFullYear();
                setFromYmd(`${y}-01-01`);
                setToYmd(utcYmd(new Date()));
              }}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100"
            >
              YTD (UTC)
            </button>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
              From (UTC)
              <input
                type="date"
                value={fromYmd}
                onChange={(e) => setFromYmd(e.target.value)}
                className={`${inputClass} mt-1 block min-w-[140px]`}
              />
            </label>
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
              To (UTC)
              <input
                type="date"
                value={toYmd}
                onChange={(e) => setToYmd(e.target.value)}
                className={`${inputClass} mt-1 block min-w-[140px]`}
              />
            </label>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex min-h-[40px] items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
            >
              {loading ? 'Loading…' : 'Apply range'}
            </button>
          </div>
        </div>
        <div className="mt-4">
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">Search venues</label>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or slug…"
            className={`${inputClass} mt-1 max-w-md`}
          />
        </div>
        {periodLabel ? (
          <p className="mt-3 text-xs text-slate-400">
            Reporting window: <span className="font-medium text-slate-600">{periodLabel}</span> (UTC dates)
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>
      ) : null}

      {data && !error ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi label="New venues" value={data.summary.new_venues_in_period} hint="created in window" />
            <Kpi label="Churned (approx.)" value={data.summary.churned_in_period} hint="cancelled / cancelling" />
            <Kpi label="Active plans" value={data.summary.active_subscriptions_snapshot} hint="active + trialing now" />
            <Kpi label="Bookings in window" value={data.summary.bookings_in_period_total} hint="all venues" />
            <Kpi label="Venues shown" value={data.summary.total_venues} hint="after search filter" />
          </div>
          <p className="text-[11px] text-slate-400">
            The first four KPIs are for the whole platform in this date window. Search only filters the venue table below.
          </p>
        </>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Venue detail</h2>
          <p className="mt-0.5 text-xs text-slate-500">Expand a row for per-model counts in the selected period.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <th className="w-8 px-3 py-3" />
                <th className="px-3 py-3">Venue</th>
                <th className="px-3 py-3">Plan</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Surfaces</th>
                <th className="px-3 py-3 text-right">Tenure</th>
                <th className="px-3 py-3 text-right">All-time</th>
                <th className="px-3 py-3 text-right">In period</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && !data ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    Loading subscriber data…
                  </td>
                </tr>
              ) : null}
              {!loading && data?.venues.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    No venues match your filters.
                  </td>
                </tr>
              ) : null}
              {data?.venues.map((v) => {
                const ex = expanded === v.id;
                return (
                  <Fragment key={v.id}>
                    <tr
                      className={`cursor-pointer transition-colors hover:bg-slate-50/90 ${ex ? 'bg-slate-50/90' : ''}`}
                      onClick={() => setExpanded(ex ? null : v.id)}
                    >
                      <td className="px-3 py-3">
                        <svg
                          className={`h-4 w-4 text-slate-400 transition-transform ${ex ? 'rotate-90' : ''}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                        </svg>
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-medium text-slate-900">{v.name}</p>
                        <p className="text-xs text-slate-400">{v.slug}</p>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tierBadge(v.pricing_tier)}`}>
                            {tierPillLabel(v.pricing_tier)}
                          </span>
                          {isSuperuserFreeBillingAccess(v.billing_access_source) ? (
                            <span className="inline-flex rounded-full bg-fuchsia-100 px-2 py-0.5 text-xs font-medium text-fuchsia-800">
                              Comped
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(v.plan_status)}`}>
                          {v.plan_status}
                        </span>
                      </td>
                      <td className="max-w-[220px] px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {v.enabled_model_labels.map((label) => (
                            <span
                              key={label}
                              className="inline-flex rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-600"
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right text-xs text-slate-600">
                        <span className="font-semibold text-slate-800">{formatTenureDays(v.subscriber_days_on_platform)}</span>
                        <span className="mt-0.5 block text-[10px] text-slate-400">since {formatShortDate(v.created_at)}</span>
                      </td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-800">{v.all_time_bookings}</td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums text-brand-700">{v.period_bookings}</td>
                    </tr>
                    {ex ? (
                      <tr className="bg-slate-50/80">
                        <td colSpan={8} className="px-4 py-4 pl-11">
                          <div className="grid gap-4 text-xs text-slate-600 sm:grid-cols-2 lg:grid-cols-3">
                            <div>
                              <p className="font-semibold uppercase tracking-wide text-slate-400">Billing period</p>
                              <p className="mt-1">
                                Start: {formatShortDate(v.subscription_current_period_start)}
                                <br />
                                End: {formatShortDate(v.subscription_current_period_end)}
                              </p>
                              {v.stripe_subscription_id ? (
                                <a
                                  href={`https://dashboard.stripe.com/subscriptions/${v.stripe_subscription_id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mt-2 inline-flex text-xs font-semibold text-blue-600 hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  Open in Stripe ↗
                                </a>
                              ) : (
                                <p className="mt-2 text-slate-400">No Stripe subscription on file.</p>
                              )}
                            </div>
                            <div>
                              <p className="font-semibold uppercase tracking-wide text-slate-400">Primary routing model</p>
                              <p className="mt-1 text-slate-800">{labelForBookingModelKey(v.booking_model)}</p>
                              <p className="mt-2 font-semibold uppercase tracking-wide text-slate-400">Onboarding</p>
                              <p className="mt-1">{v.onboarding_completed ? 'Completed' : 'In progress'}</p>
                            </div>
                            <div className="sm:col-span-2 lg:col-span-1">
                              <p className="font-semibold uppercase tracking-wide text-slate-400">Bookings in period by model</p>
                              <p className="mt-1 text-sm text-slate-800">{v.period_model_summary}</p>
                              {Object.keys(v.period_by_model).length > 0 ? (
                                <ul className="mt-2 space-y-1 rounded-lg border border-slate-200 bg-white p-2">
                                  {Object.entries(v.period_by_model)
                                    .sort(([a], [b]) => a.localeCompare(b))
                                    .map(([model, n]) => (
                                      <li key={model} className="flex justify-between tabular-nums">
                                        <span className="text-slate-600">{labelForBookingModelKey(model)}</span>
                                        <span className="font-medium text-slate-900">{n}</span>
                                      </li>
                                    ))}
                                </ul>
                              ) : (
                                <p className="mt-2 text-slate-400">No bookings created in this window.</p>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      <p className="mt-1 text-[11px] text-slate-400">{hint}</p>
    </div>
  );
}
