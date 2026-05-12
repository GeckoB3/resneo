'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { readResponseJson } from '@/lib/api/read-response-json';

type SessionRow = {
  id: string;
  status: string;
  total_rows: number;
  imported_clients: number;
  imported_bookings: number;
  skipped_rows: number;
  updated_existing: number;
  undo_available_until: string | null;
  undone_at: string | null;
  created_at: string;
  completed_at: string | null;
};

export function ImportHub() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/import/sessions');
      const data = await readResponseJson<{ sessions?: SessionRow[]; error?: string }>(res);
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setSessions(data.sessions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function deleteSession(id: string) {
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/import/sessions/${id}`, { method: 'DELETE' });
      const data = await readResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error ?? 'Failed to delete');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    }
    setDeletingId(null);
  }

  async function startNew() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/import/sessions', { method: 'POST' });
      const data = await readResponseJson<{ id?: string; error?: string }>(res);
      if (!res.ok) throw new Error(data.error ?? 'Failed to start');
      if (data.id) {
        window.location.href = `/dashboard/import/${data.id}/upload`;
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start');
    }
    setCreating(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Data import</h1>
          <p className="mt-1 text-sm text-slate-500">
            Import clients and bookings from CSV exports of your previous booking system.
          </p>
        </div>
        <button
          type="button"
          disabled={creating}
          onClick={() => void startNew()}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {creating ? 'Starting…' : 'Start new import'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
        </div>
      ) : (
        <ul className="space-y-3">
          {sessions.length === 0 ? (
            <li className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
              No imports yet. Start a new import to upload CSV files.
            </li>
          ) : (
            sessions.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {new Date(s.created_at).toLocaleString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 font-medium capitalize ${
                        s.status === 'complete' ? 'bg-emerald-100 text-emerald-900'
                        : s.status === 'failed' || s.undone_at ? 'bg-red-50 text-red-800'
                        : ['uploading', 'mapping', 'validating', 'ready', 'importing'].includes(s.status) ?
                          'bg-sky-50 text-sky-900'
                        : 'text-slate-700'
                      }`}
                    >
                      {s.undone_at ? 'undone' : s.status.replace(/_/g, ' ')}
                    </span>
                    {s.status === 'complete' && !s.undone_at ?
                      ` · ${s.imported_clients} clients, ${s.imported_bookings} bookings`
                    : ''}
                  </p>
                  {s.undo_available_until && !s.undone_at && s.status === 'complete' && (
                    <p className="mt-1 text-xs text-amber-700">
                      Undo available until{' '}
                      {new Date(s.undo_available_until).toLocaleString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {['uploading', 'mapping', 'validating', 'ready'].includes(s.status) && (
                    <Link
                      href={`/dashboard/import/${s.id}/upload`}
                      className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Continue
                    </Link>
                  )}
                  {s.status === 'importing' && (
                    <Link
                      href={`/dashboard/import/${s.id}/importing`}
                      className="inline-flex min-h-10 items-center justify-center rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 hover:bg-sky-100"
                    >
                      Resume import
                    </Link>
                  )}
                  {s.status === 'complete' && (
                    <a
                      href={`/api/import/sessions/${s.id}/report`}
                      className="inline-flex min-h-10 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-100"
                    >
                      Report CSV
                    </a>
                  )}
                  {s.status === 'complete' && (
                    <button
                      type="button"
                      className="min-h-10 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      onClick={() => {
                        if (!window.confirm('Undo this import? This will revert created records.')) return;
                        void (async () => {
                          const res = await fetch(`/api/import/sessions/${s.id}/undo`, { method: 'POST' });
                          if (!res.ok) {
                            const j = await readResponseJson<{ error?: string }>(res);
                            alert(j.error ?? 'Undo failed');
                            return;
                          }
                          void load();
                        })();
                      }}
                    >
                      Undo
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={deletingId === s.id}
                    className="min-h-10 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50"
                    onClick={() => {
                      if (
                        !window.confirm(
                          'Remove this import from the list? Uploaded CSV files for this session will be deleted. This does not remove guests or bookings already written to your venue — use Undo on a completed import if you need to revert data.',
                        )
                      ) {
                        return;
                      }
                      void deleteSession(s.id);
                    }}
                  >
                    {deletingId === s.id ? 'Removing…' : 'Delete'}
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      )}

      <p className="text-xs text-slate-500">
        Open this tool anytime from <strong>Settings → Data Import</strong>.
      </p>
    </div>
  );
}
