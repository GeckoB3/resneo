'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';

interface SystemPayload {
  db: { ok: boolean; latency_ms: number; error: string | null };
  webhooks: {
    last_event_at: string | null;
    last_event_type: string | null;
    events_24h: number;
    by_type_7d: Array<{ event_type: string; count: number }>;
    note: string;
  };
  crons: Array<{
    name: string;
    schedule: string;
    last_run_at: string | null;
    last_ok: boolean | null;
    last_duration_ms: number | null;
    last_status_code: number | null;
    last_detail: string | null;
    failures_7d: number;
  }>;
  comms: { failures_24h: number };
  activity: { last_booking_at: string | null };
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

export function SystemPageClient() {
  const [data, setData] = useState<SystemPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/platform/system', { credentials: 'same-origin' });
      const body = (await res.json().catch(() => ({}))) as SystemPayload & { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Failed to load system status');
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

  const cronProblems = (data?.crons ?? []).filter((c) => c.last_ok === false || c.failures_7d > 0).length;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">System status</h1>
          <p className="mt-1 text-sm text-slate-500">
            Database, Stripe webhooks, scheduled jobs and delivery failures — at a glance.
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
          {/* Status tiles */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatusTile
              label="Database"
              ok={data.db.ok}
              value={data.db.ok ? `${data.db.latency_ms}ms` : 'Error'}
              hint={data.db.ok ? 'query round-trip' : data.db.error ?? 'unknown error'}
            />
            <StatusTile
              label="Stripe webhooks"
              ok={data.webhooks.events_24h > 0 || data.webhooks.last_event_at !== null}
              value={String(data.webhooks.events_24h)}
              hint={`events in 24h · last ${ago(data.webhooks.last_event_at)}`}
            />
            <StatusTile
              label="Cron jobs"
              ok={cronProblems === 0}
              value={cronProblems === 0 ? 'All clear' : `${cronProblems} issue${cronProblems === 1 ? '' : 's'}`}
              hint={`${data.crons.filter((c) => c.last_run_at).length}/${data.crons.length} jobs have run history`}
            />
            <StatusTile
              label="Comms failures (24h)"
              ok={data.comms.failures_24h === 0}
              value={String(data.comms.failures_24h)}
              hint={`last booking ${ago(data.activity.last_booking_at)}`}
            />
          </div>

          {/* Cron table */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">Scheduled jobs</h2>
              <p className="text-xs text-slate-500">
                Run history starts recording after this feature deploys. Click a row for the last response.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Job</th>
                    <th className="px-5 py-3 font-medium">Schedule</th>
                    <th className="px-5 py-3 font-medium">Last run</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Duration</th>
                    <th className="px-5 py-3 font-medium">Failures (7d)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.crons.map((c) => (
                    <Fragment key={c.name}>
                      <tr
                        onClick={() => setExpandedJob(expandedJob === c.name ? null : c.name)}
                        className="cursor-pointer hover:bg-slate-50/60"
                      >
                        <td className="px-5 py-3 font-mono text-xs font-medium text-slate-800">{c.name}</td>
                        <td className="px-5 py-3 text-xs text-slate-500">{c.schedule}</td>
                        <td className="px-5 py-3 text-xs text-slate-600">{ago(c.last_run_at)}</td>
                        <td className="px-5 py-3">
                          {c.last_ok === null ? (
                            <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                              No data
                            </span>
                          ) : c.last_ok ? (
                            <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                              OK
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                              Failed{c.last_status_code ? ` (${c.last_status_code})` : ''}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-xs tabular-nums text-slate-600">
                          {c.last_duration_ms !== null ? `${c.last_duration_ms}ms` : '—'}
                        </td>
                        <td className="px-5 py-3">
                          {c.failures_7d > 0 ? (
                            <span className="text-xs font-semibold text-rose-700">{c.failures_7d}</span>
                          ) : (
                            <span className="text-xs text-slate-300">0</span>
                          )}
                        </td>
                      </tr>
                      {expandedJob === c.name && c.last_detail ? (
                        <tr className="bg-slate-50/80">
                          <td colSpan={6} className="px-5 py-3">
                            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-200">
                              {c.last_detail}
                            </pre>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Webhook breakdown */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Stripe webhook events (7 days)</h2>
            <p className="mt-0.5 text-xs text-slate-400">{data.webhooks.note}</p>
            {data.webhooks.by_type_7d.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">No webhook events recorded in the last 7 days.</p>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                {data.webhooks.by_type_7d.map((t) => (
                  <span
                    key={t.event_type}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs"
                  >
                    <span className="font-mono text-slate-700">{t.event_type}</span>
                    <span className="rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {t.count}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
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

function StatusTile({ label, ok, value, hint }: { label: string; ok: boolean; value: string; hint: string }) {
  return (
    <div
      className={`rounded-2xl border p-5 shadow-sm ${
        ok ? 'border-slate-200 bg-white' : 'border-rose-200 bg-rose-50/50'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`} />
        <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</p>
      </div>
      <p className={`mt-2 text-2xl font-bold tracking-tight ${ok ? 'text-slate-900' : 'text-rose-700'}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>
    </div>
  );
}
