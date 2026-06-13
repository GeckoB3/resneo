'use client';

import { useCallback, useEffect, useState } from 'react';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { Pill } from '@/components/ui/dashboard/Pill';

interface DeleteVenueSectionProps {
  venueName: string;
}

/** Danger-zone card on Settings → Plan: schedule (or cancel) a 30-day self-serve venue deletion. */
export function DeleteVenueSection({ venueName }: DeleteVenueSectionProps) {
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    try {
      const res = await fetch('/api/venue/delete-request', { method: 'GET' });
      if (res.ok) {
        const body = (await res.json()) as { deletion_scheduled_at?: string | null };
        setScheduledAt(body.deletion_scheduled_at ?? null);
      }
    } catch {
      /* non-fatal — fall through to showing the request form */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  async function requestDeletion() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/venue/delete-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation }),
      });
      const body = (await res.json()) as { deletion_scheduled_at?: string; error?: string; note?: string | null };
      if (!res.ok) {
        setError(body.error ?? 'Request failed');
        return;
      }
      setScheduledAt(body.deletion_scheduled_at ?? null);
      setConfirmation('');
      setMessage(body.note ?? 'Deletion scheduled. You can cancel any time before the date below.');
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  }

  async function cancelDeletion() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/venue/delete-request/cancel', { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Could not cancel deletion.');
        return;
      }
      setScheduledAt(null);
      setMessage('Scheduled deletion cancelled. Your venue and subscription continue as normal.');
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  }

  const confirmMatches = confirmation.trim().toLowerCase() === venueName.trim().toLowerCase();

  return (
    <SectionCard elevated>
      <SectionCard.Header
        eyebrow="Danger zone"
        title="Delete this venue"
        description="Permanently removes this venue and all of its data: bookings, contacts, staff, services, uploaded files, and linked-account connections. This cannot be undone once the grace period ends."
      />
      <SectionCard.Body>
        <div className="rounded-2xl border border-rose-200/80 bg-rose-50/50 p-5">
          {!loaded ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : scheduledAt ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Pill variant="danger" dot>
                  Deletion scheduled
                </Pill>
                <span className="text-sm text-slate-700">
                  Permanent deletion on <strong>{scheduledAt.slice(0, 10)}</strong>.
                </span>
              </div>
              <p className="text-sm text-slate-600">
                You can cancel any time before then. Your subscription was set to cancel at the end of the billing
                period; cancelling deletion restores it.
              </p>
              {message ? <p className="text-sm font-medium text-emerald-700">{message}</p> : null}
              {error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => void cancelDeletion()}
                className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60"
              >
                {busy ? 'Working…' : 'Cancel scheduled deletion'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-slate-700">
                Requests a <strong>30-day grace period</strong>, after which this venue and all of its data are
                permanently erased and any linked venues are notified. Your subscription is set to cancel at the end of
                the current billing period.
              </p>
              <label className="block text-sm font-medium text-slate-700">
                Type the venue name <span className="font-semibold text-slate-900">{venueName}</span> to confirm
                <input
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  placeholder={venueName}
                  autoComplete="off"
                  className="mt-1 w-full rounded-xl border border-rose-200/80 bg-white px-3 py-2.5 text-slate-900 shadow-sm focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-200"
                />
              </label>
              {message ? <p className="text-sm font-medium text-emerald-700">{message}</p> : null}
              {error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}
              <button
                type="button"
                disabled={busy || !confirmMatches}
                onClick={() => void requestDeletion()}
                className="inline-flex min-h-10 items-center justify-center rounded-xl bg-rose-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-rose-800 disabled:opacity-60"
              >
                {busy ? 'Scheduling…' : 'Schedule venue deletion'}
              </button>
            </div>
          )}
        </div>
      </SectionCard.Body>
    </SectionCard>
  );
}
