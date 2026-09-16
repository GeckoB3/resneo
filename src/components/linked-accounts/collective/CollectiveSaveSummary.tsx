'use client';

/**
 * What a host is told after saving a service that is on the collective page (UX spec §2 item 1
 * step 6; plan D50; W5).
 *
 * It sits under the page header in a polite live region, never in the error slot: the save
 * succeeded, and what this reports is how far it has reached. A save that reached members also
 * offers "Put it back" for 60 seconds, which sends the save's audit row to the undo route and
 * restores what the collective copies at every venue.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { collectiveCopy, formatVenueList } from '@/lib/linked-accounts/collective-copy';
import type { CollectiveSync } from '@/lib/linked-accounts/replicas/inline-apply';
import { syncFailureReason } from '@/lib/linked-accounts/replicas/sync-reasons';

/** The host has 60 seconds to put a change back (D50); the route refuses after that. */
export const UNDO_WINDOW_MS = 60_000;

export interface CollectiveSaveSummaryProps {
  sync: CollectiveSync;
  serviceName: string;
  collectiveId: string;
  /** Names the venues the service reached, for the "up to date at" line. */
  venueNames?: string[];
  /** Scrolls to the collective strip's Retry, which is the only one (UX spec §2 item 1). */
  onRetry?: () => void;
  /** Called after a successful undo so the page can reload the service it just put back. */
  onUndone?: () => void;
  /** Injectable for tests; defaults to the real clock. */
  now?: () => number;
}

type UndoState = 'offered' | 'sending' | 'done' | 'expired' | 'gone';

export function CollectiveSaveSummary({
  sync,
  serviceName,
  collectiveId,
  venueNames = [],
  onRetry,
  onUndone,
  now = Date.now,
}: CollectiveSaveSummaryProps) {
  const auditEventId = sync.audit_event_id ?? null;
  const [undo, setUndo] = useState<UndoState>(auditEventId ? 'offered' : 'gone');
  const [secondsLeft, setSecondsLeft] = useState(Math.round(UNDO_WINDOW_MS / 1000));

  useEffect(() => {
    if (undo !== 'offered' || !auditEventId) return;
    const startedAt = now();
    const tick = setInterval(() => {
      const left = Math.max(0, Math.round((UNDO_WINDOW_MS - (now() - startedAt)) / 1000));
      setSecondsLeft(left);
      if (left === 0) setUndo('gone');
    }, 1000);
    return () => clearInterval(tick);
  }, [undo, auditEventId, now]);

  const putItBack = useCallback(async () => {
    if (!auditEventId) return;
    setUndo('sending');
    try {
      const res = await fetch(`/api/venue/collectives/${collectiveId}/undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audit_event_id: auditEventId }),
      });
      if (res.status === 410) {
        setUndo('expired');
        return;
      }
      if (!res.ok) {
        setUndo('offered');
        return;
      }
      setUndo('done');
      onUndone?.();
    } catch {
      setUndo('offered');
    }
  }, [auditEventId, collectiveId, onUndone]);

  const reached = venueNames.length > 0 ? formatVenueList(venueNames) : '';
  const lines: { key: string; text: string; tone: 'ok' | 'warn' | 'bad' }[] = [];

  if (sync.applied > 0 && sync.pending.length === 0 && sync.failed.length === 0) {
    lines.push({
      key: 'all-done',
      tone: 'ok',
      text: collectiveCopy('svc.save.allDone', { service: serviceName, venueList: reached }),
    });
  }
  for (const venue of sync.pending) {
    lines.push({
      key: `pending-${venue.venue_id}`,
      tone: 'warn',
      text: collectiveCopy('svc.save.pending', { venue: venue.venue_name, service: serviceName }),
    });
  }
  for (const venue of sync.failed) {
    lines.push({
      key: `failed-${venue.venue_id}`,
      tone: 'bad',
      text: collectiveCopy('svc.save.failed', {
        venue: venue.venue_name,
        reason: syncFailureReason(venue.code, venue.venue_name),
      }),
    });
  }
  for (const calendar of sync.calendar_failures ?? []) {
    lines.push({
      key: `calendar-${calendar.calendar_id}`,
      tone: 'bad',
      text: calendar.message,
    });
  }

  if (lines.length === 0 && undo === 'gone') return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm"
    >
      <ul className="space-y-1">
        {lines.map((line) => (
          <li
            key={line.key}
            className={
              line.tone === 'ok' ? 'text-emerald-800' : line.tone === 'warn' ? 'text-amber-800' : 'text-rose-800'
            }
          >
            {line.text}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {sync.failed.length > 0 && onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {collectiveCopy('svc.save.retry')}
          </Button>
        ) : null}
        {undo === 'offered' || undo === 'sending' ? (
          <Button variant="ghost" size="sm" onClick={putItBack} loading={undo === 'sending'}>
            {collectiveCopy('ov.undo.offer')} ({secondsLeft}s)
          </Button>
        ) : null}
        {undo === 'done' ? (
          <p className="text-slate-600">{collectiveCopy('ov.undo.done', { service: serviceName })}</p>
        ) : null}
        {undo === 'expired' ? <p className="text-slate-600">{collectiveCopy('ov.undo.expired')}</p> : null}
      </div>
    </div>
  );
}

/** Kept here so existing imports still work; the one mapping lives in sync-reasons.ts. */
export { syncFailureReason } from '@/lib/linked-accounts/replicas/sync-reasons';
