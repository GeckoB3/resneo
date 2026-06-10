'use client';

import { useCallback, useEffect, useState } from 'react';

type Severity = 'info' | 'warning' | 'critical';

interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: Severity;
  starts_at: string;
  ends_at: string | null;
  active: boolean;
  created_by_email: string | null;
  created_at: string;
  dismissal_count: number;
}

const SEVERITY_PILL: Record<Severity, string> = {
  info: 'bg-blue-100 text-blue-700',
  warning: 'bg-amber-100 text-amber-800',
  critical: 'bg-rose-100 text-rose-700',
};

function dateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export function AnnouncementsPageClient() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState<Severity>('info');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/platform/announcements', { credentials: 'same-origin' });
      const data = (await res.json().catch(() => ({}))) as {
        announcements?: Announcement[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load announcements');
      setAnnouncements(data.announcements ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      setFormError('Auto-expire must be after the start time.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch('/api/platform/announcements', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          severity,
          // Omitted when blank — the API defaults starts_at to "now" (live immediately).
          starts_at: startsAt ? new Date(startsAt).toISOString() : undefined,
          ends_at: endsAt ? new Date(endsAt).toISOString() : null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to create announcement');
      setTitle('');
      setBody('');
      setSeverity('info');
      setStartsAt('');
      setEndsAt('');
      setShowForm(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create');
    } finally {
      setSaving(false);
    }
  }

  async function setActive(id: string, active: boolean) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/platform/announcements/${id}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? 'Failed to update');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this announcement permanently? Dismissal records will also be removed.')) {
      return;
    }
    setBusyId(id);
    try {
      const res = await fetch(`/api/platform/announcements/${id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? 'Failed to delete');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Announcements</h1>
          <p className="mt-1 text-sm text-slate-500">
            Dismissible banners shown to all venue dashboard users — maintenance windows, new features,
            urgent notices.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
        >
          {showForm ? 'Cancel' : 'New announcement'}
        </button>
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>
      ) : null}

      {showForm ? (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">New announcement</h2>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="Scheduled maintenance on Sunday"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Resneo will be briefly unavailable on Sunday between 02:00 and 02:30 for planned maintenance."
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Severity</label>
              <div className="flex gap-2">
                {(['info', 'warning', 'critical'] as Severity[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSeverity(s)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-all ${
                      severity === s
                        ? `${SEVERITY_PILL[s]} ring-2 ring-offset-1 ${
                            s === 'info' ? 'ring-blue-300' : s === 'warning' ? 'ring-amber-300' : 'ring-rose-300'
                          }`
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Start at (optional)</label>
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              <p className="mt-1 text-[11px] text-slate-400">Leave blank to go live immediately.</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Auto-expire (optional)</label>
              <input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>

          {/* Live preview */}
          {(title.trim() || body.trim()) && (
            <div>
              <p className="mb-1 text-xs font-medium text-slate-400">Preview</p>
              <div
                className={`rounded-xl border px-4 py-3 ${
                  severity === 'critical'
                    ? 'border-rose-200 bg-rose-50'
                    : severity === 'warning'
                      ? 'border-amber-200 bg-amber-50'
                      : 'border-blue-200 bg-blue-50'
                }`}
              >
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${SEVERITY_PILL[severity]}`}>
                  {severity === 'info' ? 'Announcement' : severity === 'warning' ? 'Important' : 'Critical'}
                </span>
                <p className="mt-1.5 text-sm font-semibold text-slate-900">{title || 'Title…'}</p>
                <p className="mt-0.5 whitespace-pre-line text-sm text-slate-600">{body || 'Message…'}</p>
              </div>
            </div>
          )}

          {formError ? <p className="text-sm text-rose-600">{formError}</p> : null}
          <button
            type="button"
            onClick={() => void create()}
            disabled={saving || title.trim().length < 3 || body.trim().length < 3}
            className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Publishing…' : 'Publish announcement'}
          </button>
        </div>
      ) : null}

      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white" />
          ))
        ) : announcements.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-400">
            No announcements yet. Create one to notify all venue dashboards.
          </p>
        ) : (
          announcements.map((a) => {
            const expired = a.ends_at !== null && new Date(a.ends_at).getTime() < Date.now();
            const scheduled = a.active && !expired && new Date(a.starts_at).getTime() > Date.now();
            const live = a.active && !expired && !scheduled;
            return (
              <div
                key={a.id}
                className={`rounded-2xl border bg-white p-5 shadow-sm ${live || scheduled ? 'border-slate-200' : 'border-slate-100 opacity-70'}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${SEVERITY_PILL[a.severity]}`}>
                        {a.severity}
                      </span>
                      {live ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live
                        </span>
                      ) : scheduled ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" /> Scheduled
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                          {expired ? 'Expired' : 'Inactive'}
                        </span>
                      )}
                      <span className="text-[11px] text-slate-400">
                        {a.dismissal_count} dismissal{a.dismissal_count === 1 ? '' : 's'}
                      </span>
                    </div>
                    <h3 className="mt-2 text-sm font-semibold text-slate-900">{a.title}</h3>
                    <p className="mt-0.5 whitespace-pre-line text-sm text-slate-600">{a.body}</p>
                    <p className="mt-2 text-[11px] text-slate-400">
                      Created {dateTime(a.created_at)}
                      {a.created_by_email ? ` by ${a.created_by_email}` : ''}
                      {scheduled ? ` · starts ${dateTime(a.starts_at)}` : ''}
                      {a.ends_at ? ` · expires ${dateTime(a.ends_at)}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => void setActive(a.id, !a.active)}
                      disabled={busyId === a.id}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {a.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(a.id)}
                      disabled={busyId === a.id}
                      className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
