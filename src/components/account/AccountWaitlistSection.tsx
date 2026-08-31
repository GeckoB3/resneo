'use client';

import { useState } from 'react';
import { Button, ConfirmDialog } from '@/components/ui/primitives';
import type { AccountWaitlistRow } from '@/lib/account/account-waitlist';

/**
 * Waitlist places the customer is holding (P4-4).
 *
 * Shown with their bookings rather than in the profile, because a waitlist
 * place is a booking that has not happened yet: it is the same question
 * ("what am I waiting for?") as "what have I got booked?", and separating them
 * makes a customer look in two places to answer one thing.
 */
export function AccountWaitlistSection({
  entries,
  venueNames,
  failed,
}: {
  entries: AccountWaitlistRow[];
  venueNames: Record<string, string>;
  /** True when the lookup failed; an empty list then means nothing (P4-1). */
  failed?: boolean;
}) {
  const [rows, setRows] = useState(entries);
  const [pending, setPending] = useState<AccountWaitlistRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function leave(entry: AccountWaitlistRow) {
    setBusyId(entry.id);
    setError(null);
    try {
      const res = await fetch(`/api/account/waitlist/${encodeURIComponent(entry.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'We could not leave that waitlist. Please try again.');
        return;
      }
      setRows((r) => r.map((x) => (x.id === entry.id ? { ...x, status: 'cancelled' } : x)));
    } catch {
      setError('We could not leave that waitlist. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  if (failed) {
    return (
      <section aria-labelledby="waitlist-heading">
        <h2 id="waitlist-heading" className="text-sm font-semibold text-slate-900">
          Waitlists
        </h2>
        <p role="alert" className="mt-2 text-sm text-slate-600">
          We could not check your waitlist places. Please refresh.
        </p>
      </section>
    );
  }

  const live = rows.filter((r) => r.status !== 'cancelled' && r.status !== 'expired');
  if (live.length === 0) return null;

  return (
    <section aria-labelledby="waitlist-heading">
      <h2 id="waitlist-heading" className="text-sm font-semibold text-slate-900">
        Waitlists
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Places you are waiting for. We will let you know if one comes up.
      </p>

      {error ? (
        // On the row, not in the dialog: the dialog closes on confirm, so an
        // error shown inside it can never be read (P2-6).
        <p role="alert" className="mt-2 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      <ul className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-900/5">
        {live.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="font-medium text-slate-900">
                {venueNames[entry.venue_id] ?? 'Venue'}
                {entry.status === 'offered' ? (
                  <span className="ml-2 text-sm font-normal text-emerald-700">A place is open</span>
                ) : null}
              </p>
              <p className="text-sm text-slate-600">{describeWaitlistEntry(entry)}</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="min-h-9"
              loading={busyId === entry.id}
              onClick={() => setPending(entry)}
            >
              Leave waitlist
            </Button>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) setPending(null);
        }}
        title="Leave this waitlist"
        message="You will lose your place, and we will stop letting you know if one comes up."
        confirmLabel="Yes, leave the waitlist"
        cancelLabel="Stay on it"
        onConfirm={() => {
          // Read before clearing: the dialog closes on confirm.
          const target = pending;
          setPending(null);
          if (target) void leave(target);
        }}
      />
    </section>
  );
}

/** "Waiting for 20 Sept, any time" and similar, in the customer's words. */
export function describeWaitlistEntry(entry: AccountWaitlistRow): string {
  const when = formatWaitlistDate(entry.desired_date);
  const time =
    entry.desired_time && entry.desired_time_end
      ? `between ${short(entry.desired_time)} and ${short(entry.desired_time_end)}`
      : entry.desired_time
        ? `around ${short(entry.desired_time)}`
        : 'any time';
  return `Waiting for ${when}, ${time}`;
}

function short(t: string): string {
  return t.slice(0, 5);
}

function formatWaitlistDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
