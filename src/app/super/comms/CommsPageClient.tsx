'use client';

import { useCallback, useEffect, useState } from 'react';

interface CommsPayload {
  window_days: number;
  summary: {
    email_sent: number;
    email_failed: number;
    email_failure_rate_pct: number;
    sms_sent: number;
    sms_failed: number;
    sms_failure_rate_pct: number;
    pending: number;
  };
  recent_failures: Array<{
    id: string;
    venue_name: string;
    channel: string;
    message_type: string;
    recipient_masked: string;
    status: string;
    error_message: string | null;
    created_at: string;
  }>;
  failure_leaderboard: Array<{ venue_name: string; failures: number }>;
  sms_usage_current_month: Array<{
    venue_id: string;
    venue_name: string;
    messages_sent: number;
    messages_included: number;
    overage_count: number;
    overage_amount_pence: number;
  }>;
}

function dateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function CommsPageClient() {
  const [days, setDays] = useState<7 | 30 | 90>(7);
  const [data, setData] = useState<CommsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [smsSearch, setSmsSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/platform/comms?days=${days}`, { credentials: 'same-origin' });
      const body = (await res.json().catch(() => ({}))) as CommsPayload & { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Failed to load communications data');
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Communications</h1>
          <p className="mt-1 text-sm text-slate-500">
            Email and SMS delivery health across all venues, plus current-month SMS usage and overage.
          </p>
        </div>
        <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {([7, 30, 90] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                days === d ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>
      ) : null}

      {loading && !data ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white" />
          ))}
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <Kpi label="Emails sent" value={data.summary.email_sent} />
            <Kpi
              label="Email failure rate"
              value={`${data.summary.email_failure_rate_pct}%`}
              danger={data.summary.email_failure_rate_pct >= 2}
              hint={`${data.summary.email_failed} failed`}
            />
            <Kpi label="SMS sent" value={data.summary.sms_sent} />
            <Kpi
              label="SMS failure rate"
              value={`${data.summary.sms_failure_rate_pct}%`}
              danger={data.summary.sms_failure_rate_pct >= 2}
              hint={`${data.summary.sms_failed} failed`}
            />
            <Kpi label="Pending" value={data.summary.pending} hint="queued / awaiting send" />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Recent failures */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:col-span-2">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="text-sm font-semibold text-slate-900">Recent failures</h2>
                <p className="text-xs text-slate-500">Last {data.window_days} days, newest first (max 50).</p>
              </div>
              {data.recent_failures.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-emerald-700">
                  No delivery failures in this window.
                </p>
              ) : (
                <div className="max-h-[480px] overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50 uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">When</th>
                        <th className="px-4 py-2.5 font-medium">Venue</th>
                        <th className="px-4 py-2.5 font-medium">Channel</th>
                        <th className="px-4 py-2.5 font-medium">Type</th>
                        <th className="px-4 py-2.5 font-medium">Recipient</th>
                        <th className="px-4 py-2.5 font-medium">Error</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.recent_failures.map((f) => (
                        <tr key={f.id} className="align-top hover:bg-slate-50/60">
                          <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{dateTime(f.created_at)}</td>
                          <td className="px-4 py-2.5 font-medium text-slate-800">{f.venue_name}</td>
                          <td className="px-4 py-2.5">
                            <span
                              className={`inline-flex rounded-full px-1.5 py-0.5 font-semibold uppercase ${
                                f.channel === 'sms' ? 'bg-violet-100 text-violet-700' : 'bg-sky-100 text-sky-700'
                              }`}
                            >
                              {f.channel}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">{f.message_type.replace(/_/g, ' ')}</td>
                          <td className="px-4 py-2.5 font-mono text-slate-500">{f.recipient_masked}</td>
                          <td className="max-w-[220px] px-4 py-2.5 text-rose-700">
                            {f.error_message ?? f.status}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Leaderboard + SMS usage */}
            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-900">Failures by venue</h2>
                {data.failure_leaderboard.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-400">None in this window.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {data.failure_leaderboard.map((v) => (
                      <li key={v.venue_name} className="flex items-center justify-between text-sm">
                        <span className="truncate text-slate-700">{v.venue_name}</span>
                        <span className="ml-2 shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
                          {v.failures}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-900">SMS usage (current billing period)</h2>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  All venues · {data.sms_usage_current_month.filter((s) => s.overage_count > 0).length} over
                  allowance
                </p>
                <input
                  type="search"
                  value={smsSearch}
                  onChange={(e) => setSmsSearch(e.target.value)}
                  placeholder="Search venues…"
                  className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
                {(() => {
                  const q = smsSearch.trim().toLowerCase();
                  const rows = q
                    ? data.sms_usage_current_month.filter((s) => s.venue_name.toLowerCase().includes(q))
                    : data.sms_usage_current_month;
                  if (rows.length === 0) {
                    return (
                      <p className="mt-3 text-sm text-slate-400">
                        {q ? 'No venues match your search.' : 'No venues yet.'}
                      </p>
                    );
                  }
                  return (
                    <ul className="mt-3 max-h-[420px] space-y-3 overflow-y-auto pr-1">
                      {rows.map((s) => {
                        const pct = s.messages_included > 0
                          ? Math.min(100, Math.round((s.messages_sent / s.messages_included) * 100))
                          : 100;
                        return (
                          <li key={s.venue_id}>
                            <div className="flex items-baseline justify-between text-xs">
                              <span className="truncate font-medium text-slate-700">{s.venue_name}</span>
                              <span className="ml-2 shrink-0 tabular-nums text-slate-500">
                                {s.messages_sent}/{s.messages_included}
                                {s.overage_count > 0 ? (
                                  <span className="ml-1 font-semibold text-amber-700">+{s.overage_count} over</span>
                                ) : null}
                              </span>
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className={`h-full rounded-full ${pct >= 100 ? 'bg-amber-500' : 'bg-violet-500'}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  );
                })()}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  danger = false,
}: {
  label: string;
  value: number | string;
  hint?: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-bold tracking-tight ${danger ? 'text-rose-600' : 'text-slate-900'}`}>
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p> : null}
    </div>
  );
}
