'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';

interface RecRow {
  id: string;
  venue_id: string;
  class_type_id: string;
  status: string;
  next_materialize_on: string | null;
  last_error: string | null;
}

interface CatalogType {
  id: string;
  name: string;
  venue_id: string;
}

export function AccountRecurringSection() {
  const [rows, setRows] = useState<RecRow[]>([]);
  const [types, setTypes] = useState<Array<{ id: string; name: string }>>([]);
  const [venues, setVenues] = useState<Array<{ id: string; name: string }>>([]);
  const [catalog, setCatalog] = useState<{
    venues: Array<{ id: string; name: string }>;
    class_types: CatalogType[];
  }>({ venues: [], class_types: [] });
  const [venueId, setVenueId] = useState('');
  const [classTypeId, setClassTypeId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    await Promise.resolve();
    const res = await fetch('/api/account/class-recurring');
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not load');
      return;
    }
    setRows((data.reservations ?? []) as RecRow[]);
    setTypes((data.class_types ?? []) as Array<{ id: string; name: string }>);
    setVenues((data.venues ?? []) as Array<{ id: string; name: string }>);
    const rc = (data as { recurring_catalog?: { venues?: unknown[]; class_types?: unknown[] } }).recurring_catalog;
    setCatalog({
      venues: (rc?.venues ?? []) as Array<{ id: string; name: string }>,
      class_types: (rc?.class_types ?? []) as CatalogType[],
    });
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const resolvedVenueId = venueId || catalog.venues[0]?.id || '';

  const typeChoices = useMemo(
    () => catalog.class_types.filter((t) => t.venue_id === resolvedVenueId),
    [catalog.class_types, resolvedVenueId],
  );

  const firstTypeId = typeChoices[0]?.id ?? '';
  const effectiveClassTypeId =
    classTypeId && typeChoices.some((t) => t.id === classTypeId) ? classTypeId : firstTypeId;

  const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? id.slice(0, 8);
  const venueName = (id: string) => venues.find((v) => v.id === id)?.name ?? id.slice(0, 8);

  async function createRule() {
    setError(null);
    if (!resolvedVenueId || !effectiveClassTypeId) {
      setError('Choose a venue and class type.');
      return;
    }
    const res = await fetch('/api/account/class-recurring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        venue_id: resolvedVenueId,
        class_type_id: effectiveClassTypeId,
        rule: { frequency: 'weekly', note: 'Materialization stub — cron advances next_materialize_on' },
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Create failed');
      return;
    }
    void load();
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Account"
        title="Recurring class reservations"
        subtitle={
          <>
            Standing rules are processed by a nightly cron; concrete bookings are not created automatically yet — see{' '}
            <code className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800">last_error</code>{' '}
            on rows.
          </>
        }
      />
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}

      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/5 sm:p-6">
        <h2 className="text-sm font-semibold text-slate-900">Your rules</h2>
        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">None yet.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {rows.map((r) => (
              <li key={r.id} className="rounded-lg bg-slate-50 px-3 py-2">
                <div className="font-medium">{typeName(r.class_type_id)}</div>
                <div className="text-xs text-slate-600">
                  {venueName(r.venue_id)} · {r.status}
                  {r.next_materialize_on ? ` · next ${r.next_materialize_on}` : ''}
                </div>
                {r.last_error ? <div className="mt-1 text-xs text-amber-800">{r.last_error}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/5 sm:p-6">
        <h2 className="text-sm font-semibold text-slate-900">New rule (stub)</h2>
        {catalog.venues.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No active class types found.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1 text-xs text-slate-600">
              Venue
              <select
                value={resolvedVenueId}
                onChange={(e) => {
                  setVenueId(e.target.value);
                  setClassTypeId('');
                }}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm"
              >
                {catalog.venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 flex-1 text-xs text-slate-600">
              Class type
              <select
                value={classTypeId}
                onChange={(e) => setClassTypeId(e.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm"
              >
                {typeChoices.length === 0 ? (
                  <option value="">No class types at this venue</option>
                ) : (
                  typeChoices.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <button
              type="button"
              disabled={!effectiveClassTypeId}
              onClick={() => void createRule()}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Create
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
