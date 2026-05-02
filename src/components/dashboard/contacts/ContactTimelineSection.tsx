'use client';

import { useEffect, useState } from 'react';
import type { TimelineEventRow } from '@/types/contacts';

export function ContactTimelineSection({ guestId }: { guestId: string }) {
  const [events, setEvents] = useState<TimelineEventRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/venue/guests/${guestId}/timeline?limit=60`);
        const j = (await res.json()) as { events?: TimelineEventRow[] };
        if (!cancelled) setEvents(j.events ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [guestId]);

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-800">Activity timeline</h3>
      {loading ? (
        <p className="mt-2 text-sm text-slate-500">Loading…</p>
      ) : events.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No timeline events yet.</p>
      ) : (
        <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto text-sm">
          {events.map((e) => (
            <li key={e.id} className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{e.event_type}</div>
              <div className="text-slate-800">{e.label}</div>
              <div className="text-xs text-slate-500">{new Date(e.occurred_at).toLocaleString()}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
