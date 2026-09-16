'use client';

/**
 * The Collective area's History tab (UX spec §2 item 15 "Recent activity"; plan contract 3; W5).
 *
 * The record a host and a member use to settle who changed what: one sentence per change, newest
 * first, filtered by kind, by venue and by date, and downloadable. A member sees only what was
 * done to it and to the whole collective; the route decides that, so this page never has to.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';
import type { HistoryEvent, HistoryFilter } from '@/lib/linked-accounts/replicas/history';

export interface CollectiveHistoryPanelProps {
  collectiveId: string;
  collectiveName: string;
  /** The venues a host can narrow to. Members get no venue filter: they only see their own rows. */
  venues?: { venue_id: string; venue_name: string }[];
  /** Start narrowed to one venue (from a Venues row's History link). */
  initialVenueId?: string | null;
}

const FILTERS: { value: HistoryFilter; label: string }[] = [
  { value: 'all', label: collectiveCopy('history.filter.all') },
  { value: 'services', label: collectiveCopy('history.filter.services') },
  { value: 'calendars', label: collectiveCopy('history.filter.calendars') },
  { value: 'members', label: collectiveCopy('history.filter.members') },
];

export function CollectiveHistoryPanel({
  collectiveId,
  collectiveName,
  venues = [],
  initialVenueId = null,
}: CollectiveHistoryPanelProps) {
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [venueId, setVenueId] = useState<string | null>(initialVenueId);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useCallback(
    (extra: Record<string, string> = {}) => {
      const params = new URLSearchParams({ filter, limit: '50', ...extra });
      if (venueId) params.set('venue_id', venueId);
      // A date is a whole day: from its first moment to its last.
      if (from) params.set('from', new Date(`${from}T00:00:00`).toISOString());
      if (to) params.set('to', new Date(`${to}T23:59:59.999`).toISOString());
      return params;
    },
    [filter, venueId, from, to],
  );

  const load = useCallback(
    async (after: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const params = query(after ? { cursor: after } : {});
        const res = await fetch(`/api/venue/collectives/${collectiveId}/history?${params.toString()}`);
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setError(data.error ?? 'Could not load the history.');
          return;
        }
        const data = (await res.json()) as { events: HistoryEvent[]; next_cursor: string | null };
        setEvents((prev) => (after ? [...prev, ...data.events] : data.events));
        setCursor(data.next_cursor);
      } catch {
        setError('Could not load the history. Please check your connection.');
      } finally {
        setLoading(false);
      }
    },
    [collectiveId, query],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  const csvHref = `/api/venue/collectives/${collectiveId}/history?${query({ format: 'csv' }).toString()}`;

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-slate-900">
        {collectiveCopy('history.title', { collective: collectiveName })}
      </h2>

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={`rounded-md px-2.5 py-1 ${filter === option.value ? 'bg-brand-600 text-white' : 'text-slate-700'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {venues.length > 0 ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-600">{collectiveCopy('history.filter.venue')}</span>
            <select
              value={venueId ?? ''}
              onChange={(e) => setVenueId(e.target.value || null)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1"
            >
              <option value="">{collectiveCopy('history.filter.anyVenue')}</option>
              {venues.map((venue) => (
                <option key={venue.venue_id} value={venue.venue_id}>
                  {venue.venue_name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-600">{collectiveCopy('history.filter.from')}</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-600">{collectiveCopy('history.filter.to')}</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1" />
        </label>
        <a href={csvHref} className="ml-auto font-medium text-brand-700 underline underline-offset-2">
          {collectiveCopy('history.export')}
        </a>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}

      {!loading && !error && events.length === 0 ? (
        <p className="text-sm text-slate-500">{collectiveCopy('history.empty')}</p>
      ) : null}

      <ol className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {events.map((event) => (
          <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2 text-sm">
            <span className="text-slate-900">{event.sentence}</span>
            <time dateTime={event.at} className="text-xs text-slate-500">
              {formatWhen(event.at)}
            </time>
          </li>
        ))}
      </ol>

      {loading ? (
        <p role="status" className="text-sm text-slate-500">
          Loading...
        </p>
      ) : cursor ? (
        <Button type="button" variant="secondary" size="sm" onClick={() => void load(cursor)}>
          {collectiveCopy('history.more')}
        </Button>
      ) : null}
    </section>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
