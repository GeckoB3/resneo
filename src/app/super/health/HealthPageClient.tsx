'use client';

import { useCallback, useEffect, useState } from 'react';

type Band = 'healthy' | 'watch' | 'at_risk';

interface HealthVenue {
  id: string;
  name: string;
  slug: string;
  plan: string;
  plan_status: string;
  comped: boolean;
  onboarding_completed: boolean;
  age_days: number;
  bookings_last_30: number;
  bookings_prev_30: number;
  bookings_last_7: number;
  upcoming_bookings: number;
  trend_pct: number;
  last_booking_at: string | null;
  days_since_last_booking: number | null;
  score: number;
  band: Band;
  flags: string[];
}

interface HealthPayload {
  summary: { healthy: number; watch: number; at_risk: number };
  venues: HealthVenue[];
}

const BAND_META: Record<Band, { label: string; pill: string; bar: string }> = {
  healthy: { label: 'Healthy', pill: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500' },
  watch: { label: 'Watch', pill: 'bg-amber-100 text-amber-800', bar: 'bg-amber-500' },
  at_risk: { label: 'At risk', pill: 'bg-rose-100 text-rose-700', bar: 'bg-rose-500' },
};

export function HealthPageClient() {
  const [data, setData] = useState<HealthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [bandFilter, setBandFilter] = useState<Band | ''>('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/platform/health', { credentials: 'same-origin' });
      const body = (await res.json().catch(() => ({}))) as HealthPayload & { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Failed to load health data');
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

  const venues = (data?.venues ?? []).filter((v) => {
    if (bandFilter && v.band !== bandFilter) return false;
    if (search && !`${v.name} ${v.slug}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Venue health</h1>
          <p className="mt-1 text-sm text-slate-500">
            Early churn-risk signals for live venues: booking trends, recency, pipeline, and billing state.
            Sorted worst-first.
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

      {/* Band summary (clickable filters) */}
      {data ? (
        <div className="grid grid-cols-3 gap-4">
          {(['at_risk', 'watch', 'healthy'] as Band[]).map((band) => {
            const meta = BAND_META[band];
            const count = data.summary[band];
            const active = bandFilter === band;
            return (
              <button
                key={band}
                type="button"
                onClick={() => setBandFilter(active ? '' : band)}
                className={`rounded-2xl border p-5 text-left shadow-sm transition-all ${
                  active ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${meta.pill}`}>
                  {meta.label}
                </span>
                <p className="mt-2 text-3xl font-bold text-slate-900">{count}</p>
                <p className="text-[11px] text-slate-400">{active ? 'Showing only — click to clear' : 'Click to filter'}</p>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
          <input
            type="search"
            placeholder="Search venues…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-xs rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
          <span className="ml-auto text-xs text-slate-400">
            {venues.length} venue{venues.length === 1 ? '' : 's'}
          </span>
        </div>

        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : venues.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-slate-400">No venues match the current filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Venue</th>
                  <th className="px-5 py-3 font-medium">Score</th>
                  <th className="px-5 py-3 font-medium">30d bookings</th>
                  <th className="px-5 py-3 font-medium">Trend</th>
                  <th className="px-5 py-3 font-medium">Upcoming</th>
                  <th className="px-5 py-3 font-medium">Last booking</th>
                  <th className="px-5 py-3 font-medium">Signals</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {venues.map((v) => {
                  const meta = BAND_META[v.band];
                  return (
                    <tr key={v.id} className="align-top hover:bg-slate-50/60">
                      <td className="px-5 py-3.5">
                        <p className="font-medium text-slate-900">{v.name}</p>
                        <p className="text-xs text-slate-400">
                          {v.plan}
                          {v.comped ? ' · comped' : ''} · {v.age_days}d on platform
                        </p>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className="w-7 text-right font-bold tabular-nums text-slate-900">{v.score}</span>
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                            <div className={`h-full rounded-full ${meta.bar}`} style={{ width: `${v.score}%` }} />
                          </div>
                        </div>
                        <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.pill}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 tabular-nums text-slate-700">
                        {v.bookings_last_30}
                        <span className="text-xs text-slate-400"> (prev {v.bookings_prev_30})</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums ${
                            v.trend_pct > 0 ? 'text-emerald-700' : v.trend_pct < 0 ? 'text-rose-700' : 'text-slate-500'
                          }`}
                        >
                          {v.trend_pct > 0 ? '▲' : v.trend_pct < 0 ? '▼' : '–'} {Math.abs(v.trend_pct)}%
                        </span>
                      </td>
                      <td className="px-5 py-3.5 tabular-nums text-slate-700">{v.upcoming_bookings}</td>
                      <td className="px-5 py-3.5 text-xs text-slate-600">
                        {v.days_since_last_booking === null
                          ? 'never'
                          : v.days_since_last_booking === 0
                            ? 'today'
                            : `${v.days_since_last_booking}d ago`}
                      </td>
                      <td className="px-5 py-3.5">
                        {v.flags.length === 0 ? (
                          <span className="text-xs text-slate-300">—</span>
                        ) : (
                          <div className="flex max-w-[260px] flex-wrap gap-1">
                            {v.flags.map((f) => (
                              <span
                                key={f}
                                className="inline-flex rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-700"
                              >
                                {f}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
