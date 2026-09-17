'use client';

/**
 * Support console: collectives (plan §6.16; W18). Read-only, apart from "Retry now" on a replica link.
 */
import { useCallback, useEffect, useState } from 'react';
import type { SupportCollectiveDetail, SupportCollectiveRow } from '@/lib/platform/collective-support';

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }) : '';

type NewModel = 'legacy_copies' | 'replicas';

/** D37: which model a new collective starts on. Existing collectives move only by the migration script. */
function NewCollectiveModelSetting() {
  const [value, setValue] = useState<NewModel | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/platform/collectives/settings', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { new_collective_service_model?: NewModel } | null) => {
        if (!cancelled) setValue(data?.new_collective_service_model ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (next: NewModel) => {
    setState('saving');
    const res = await fetch('/api/platform/collectives/settings', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_collective_service_model: next }),
    }).catch(() => null);
    if (res?.ok) {
      setValue(next);
      setState('saved');
    } else {
      setState('error');
    }
  }, []);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="new-collective-model">
      <h2 id="new-collective-model" className="text-sm font-semibold text-slate-900">
        New collectives start on
      </h2>
      <p className="mt-1 text-xs text-slate-600">
        Applies only to collectives created from now on, and is recorded in the audit log. Existing collectives
        move to shared services only through the migration script.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <select
          aria-labelledby="new-collective-model"
          className="rounded border border-slate-300 px-2 py-1 text-sm"
          value={value ?? ''}
          disabled={value === null || state === 'saving'}
          onChange={(e) => void save(e.target.value as NewModel)}
        >
          {value === null ? <option value="">Loading...</option> : null}
          <option value="legacy_copies">Service copies (older model)</option>
          <option value="replicas">Shared services</option>
        </select>
        {state === 'saved' ? <span className="text-xs text-emerald-700">Saved.</span> : null}
        {state === 'error' ? (
          <span role="alert" className="text-xs text-rose-700">
            Could not save. Try again.
          </span>
        ) : null}
      </div>
    </section>
  );
}

export function CollectivesPageClient() {
  const [rows, setRows] = useState<SupportCollectiveRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/platform/collectives', { credentials: 'same-origin' });
        const data = (await res.json().catch(() => ({}))) as { collectives?: SupportCollectiveRow[]; error?: string };
        if (cancelled) return;
        if (!res.ok) setError(data.error ?? 'Failed to load collectives');
        else setRows(data.collectives ?? []);
      } catch {
        if (!cancelled) setError('Failed to load collectives');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Collectives</h1>
        <p className="text-sm text-slate-600">
          Each collective, its model and how up to date its venues are. Read-only, apart from retrying a replica link.
        </p>
      </header>
      <NewCollectiveModelSetting />
      {error ? (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}
      {rows === null && !error ? <p className="text-sm text-slate-500">Loading...</p> : null}
      {rows && rows.length === 0 ? <p className="text-sm text-slate-500">No collectives yet.</p> : null}
      {rows && rows.length > 0 ? (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2">Collective</th>
              <th>Host</th>
              <th>Model</th>
              <th>Status</th>
              <th>Venues</th>
              <th>Behind</th>
              <th>Failing</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="py-2">
                  <button
                    type="button"
                    className="font-semibold text-brand-700 underline"
                    onClick={() => setSelected(row.id)}
                  >
                    {row.name}
                  </button>
                  <span className="block font-mono text-xs text-slate-500">/book/c/{row.slug}</span>
                </td>
                <td>{row.host_name}</td>
                <td>{row.service_model}</td>
                <td>
                  {row.status}
                  {row.paused ? ' (paused)' : ''}
                </td>
                <td>
                  {row.venue_count}
                  {row.invited_count > 0 ? ` + ${row.invited_count} invited` : ''}
                </td>
                <td className={row.links_behind > 0 ? 'font-semibold text-amber-700' : ''}>{row.links_behind}</td>
                <td className={row.links_failing > 0 ? 'font-semibold text-rose-700' : ''}>{row.links_failing}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {selected ? <CollectiveDetail key={selected} collectiveId={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

export function CollectiveDetail({ collectiveId, onClose }: { collectiveId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<SupportCollectiveDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/platform/collectives/${collectiveId}`, { credentials: 'same-origin' });
        const data = (await res.json().catch(() => ({}))) as SupportCollectiveDetail & { error?: string };
        if (cancelled) return;
        if (!res.ok) setError(data.error ?? 'Failed to load the collective');
        else setDetail(data);
      } catch {
        if (!cancelled) setError('Failed to load the collective');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [collectiveId, version]);

  const retry = useCallback(
    async (linkId: string) => {
      setRetrying(linkId);
      setNote(null);
      try {
        const res = await fetch(`/api/platform/collectives/${collectiveId}/retry`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ link_id: linkId }),
        });
        const data = (await res.json().catch(() => ({}))) as { applied?: boolean; error?: string | null };
        if (!res.ok) setNote(data.error ?? 'The retry did not run.');
        else setNote(data.applied ? 'Applied.' : `Still failing: ${data.error ?? 'unknown error'}`);
        setVersion((v) => v + 1);
      } catch {
        setNote('The retry did not run.');
      } finally {
        setRetrying(null);
      }
    },
    [collectiveId],
  );

  return (
    <section aria-label="Collective detail" className="space-y-4 rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">{detail?.collective.name ?? 'Collective'}</h2>
        <button type="button" onClick={onClose} className="text-sm text-slate-600 underline">
          Close
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      {note ? (
        <p role="status" className="text-sm text-slate-700">
          {note}
        </p>
      ) : null}
      {detail ? (
        <>
          <p className="text-sm text-slate-600">
            {detail.collective.service_model}, {detail.collective.status}
            {detail.collective.paused ? `, paused (${detail.collective.paused_reason ?? 'no reason recorded'})` : ''}
            {detail.collective.dissolved_at ? `, ended ${when(detail.collective.dissolved_at)}` : ''}
          </p>
          <div>
            <h3 className="font-semibold text-slate-900">Venues</h3>
            <ul className="text-sm">
              {detail.venues.map((v) => (
                <li key={v.venue_id}>
                  {v.venue_name}
                  {v.is_host ? ' (host)' : ''} · {v.status}
                  {v.suspended ? ' · suspended' : ''} · {v.behind} behind · {v.failing} failing
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Replica links</h3>
            {detail.links.length === 0 ? <p className="text-sm text-slate-500">None.</p> : null}
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1">Venue</th>
                  <th>Service</th>
                  <th>Revision</th>
                  <th>Behind since</th>
                  <th>Attempts</th>
                  <th>Last error</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {detail.links.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100">
                    <td className="py-1">{l.venue_name}</td>
                    <td>{l.service_name}</td>
                    <td>
                      {l.applied_revision} / {l.desired_revision}
                    </td>
                    <td>{when(l.behind_since)}</td>
                    <td>{l.attempts}</td>
                    <td className="max-w-xs truncate" title={l.last_error ?? undefined}>
                      {l.last_error_code ?? ''}
                    </td>
                    <td>
                      {l.released ? (
                        <span className="text-slate-400">Released</span>
                      ) : (
                        <button
                          type="button"
                          disabled={retrying !== null}
                          onClick={() => void retry(l.id)}
                          className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-50"
                        >
                          {retrying === l.id ? 'Retrying...' : 'Retry now'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Last 50 events</h3>
            <ul className="text-xs text-slate-700">
              {detail.events.map((e) => (
                <li key={e.id}>
                  {when(e.at)} · {e.type} · {e.actor}
                  {e.job ? ` (${e.job})` : ''}
                  {e.target ? ` → ${e.target}` : ''}
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </section>
  );
}
