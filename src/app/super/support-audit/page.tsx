'use client';

import { useCallback, useEffect, useState } from 'react';

type Tab = 'platform' | 'support' | 'sessions';

interface SupportAuditRow {
  id: string;
  venue_id: string;
  event_type: string;
  created_at: string;
  display_line: string;
}

interface PlatformAuditRow {
  id: string;
  superuser_email: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  summary: string;
  created_at: string;
}

interface SessionRow {
  id: string;
  superuser_email: string;
  superuser_display_name: string | null;
  venue_name: string;
  reason: string;
  started_at: string;
  expires_at: string;
  ended_at: string | null;
  active: boolean;
}

function dateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Europe/London',
    });
  } catch {
    return iso;
  }
}

const ACTION_PILL: Record<string, string> = {
  venue: 'bg-blue-100 text-blue-700',
  salesperson: 'bg-violet-100 text-violet-700',
  announcement: 'bg-amber-100 text-amber-800',
  support_session: 'bg-sky-100 text-sky-700',
  data: 'bg-slate-200 text-slate-700',
};

export default function SuperAuditPage() {
  const [tab, setTab] = useState<Tab>('platform');

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Audit log</h1>
        <p className="mt-1 text-sm text-slate-500">
          Who did what, when — superuser platform actions, support-session activity inside venue
          dashboards, and the impersonation session list.
        </p>
      </div>

      <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm w-fit">
        {(
          [
            { id: 'platform', label: 'Platform actions' },
            { id: 'support', label: 'Support actions' },
            { id: 'sessions', label: 'Support sessions' },
          ] as Array<{ id: Tab; label: string }>
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              tab === t.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'platform' ? <PlatformActionsTab /> : tab === 'support' ? <SupportActionsTab /> : <SessionsTab />}
    </div>
  );
}

function PlatformActionsTab() {
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [events, setEvents] = useState<PlatformAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (committedSearch) params.set('search', committedSearch);
      const res = await fetch(`/api/platform/audit-events?${params.toString()}`, {
        credentials: 'same-origin',
      });
      const data = (await res.json().catch(() => ({}))) as {
        events?: PlatformAuditRow[];
        totalPages?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setEvents(data.events ?? []);
      setTotalPages(Math.max(1, data.totalPages ?? 1));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [page, committedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setCommittedSearch(search.trim());
        }}
        className="flex gap-2"
      >
        <input
          type="search"
          placeholder="Search summary or superuser email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
        />
        <button
          type="submit"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Search
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : error ? (
        <p className="text-sm text-rose-600">{error}</p>
      ) : events.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-400">
          No platform audit events {committedSearch ? 'match your search' : 'yet — actions like marking venues as test, editing salespeople or publishing announcements appear here'}.
        </p>
      ) : (
        <ul className="space-y-2">
          {events.map((ev) => {
            const category = ev.action.split('.')[0] ?? '';
            return (
              <li key={ev.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      ACTION_PILL[category] ?? 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {ev.action}
                  </span>
                  <span className="text-xs text-slate-400">{dateTime(ev.created_at)}</span>
                </div>
                <p className="mt-1.5 text-sm text-slate-800">{ev.summary}</p>
                <p className="mt-0.5 text-xs text-slate-400">by {ev.superuser_email}</p>
              </li>
            );
          })}
        </ul>
      )}

      <Pager page={page} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}

function SupportActionsTab() {
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [events, setEvents] = useState<SupportAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/platform/support-audit?page=${page}`, { credentials: 'same-origin' });
      const data = (await res.json().catch(() => ({}))) as {
        events?: SupportAuditRow[];
        totalPages?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setEvents(data.events ?? []);
      setTotalPages(Math.max(1, data.totalPages ?? 1));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : error ? (
        <p className="text-sm text-rose-600">{error}</p>
      ) : events.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-400">
          No support-session audit events yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {events.map((ev) => (
            <li key={ev.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 shadow-sm">
              <p>{ev.display_line}</p>
              <p className="mt-1 text-xs text-slate-400">
                Venue {ev.venue_id.slice(0, 8)}… · {dateTime(ev.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
      <Pager page={page} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}

function SessionsTab() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/platform/support-sessions', { credentials: 'same-origin' });
      const data = (await res.json().catch(() => ({}))) as { sessions?: SessionRow[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setSessions(data.sessions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function endSession(id: string) {
    if (!window.confirm('Force-end this support session immediately?')) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/platform/support-sessions/${id}/end`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? 'Failed to end session');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to end session');
    } finally {
      setBusyId(null);
    }
  }

  const active = sessions.filter((s) => s.active);
  const past = sessions.filter((s) => !s.active);

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-900">
              Active sessions {active.length > 0 ? `(${active.length})` : ''}
            </h2>
            {active.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 bg-white px-5 py-6 text-center text-sm text-slate-400">
                No active impersonation sessions.
              </p>
            ) : (
              <ul className="space-y-2">
                {active.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50/60 px-4 py-3 shadow-sm"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">
                        <span className="mr-2 inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" /> Live
                        </span>
                        {s.superuser_display_name ?? s.superuser_email} → {s.venue_name}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Started {dateTime(s.started_at)} · expires {dateTime(s.expires_at)} · “{s.reason}”
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void endSession(s.id)}
                      disabled={busyId === s.id}
                      className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                    >
                      {busyId === s.id ? 'Ending…' : 'End session'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Recent sessions</h2>
            {past.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 bg-white px-5 py-6 text-center text-sm text-slate-400">
                No past sessions.
              </p>
            ) : (
              <ul className="space-y-2">
                {past.map((s) => (
                  <li key={s.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                    <p className="text-sm text-slate-800">
                      {s.superuser_display_name ?? s.superuser_email} → {s.venue_name}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {dateTime(s.started_at)} – {s.ended_at ? dateTime(s.ended_at) : 'expired'} · “{s.reason}”
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Pager({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (updater: (p: number) => number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange((p) => Math.max(1, p - 1))}
        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
      >
        Previous
      </button>
      <span className="text-xs text-slate-500">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onChange((p) => Math.min(totalPages, p + 1))}
        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}
