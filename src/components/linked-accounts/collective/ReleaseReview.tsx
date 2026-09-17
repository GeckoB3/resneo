'use client';

/**
 * Leaving a shared-services collective, and the review after (UX spec J7 to J9, `leave.*`,
 * `review.*`; plan contract 7; W7).
 *
 *   LeaveCollectiveDialog   what leaving does before the member confirms: its services become its
 *                           own, payments that stop without Stripe, bookings stay, account links
 *                           stay, and whether leaving ends the collective;
 *   ReleaseReviewPanel      the checklist after leave, removal or the end of the collective, until
 *                           dismissed;
 *   ReleaseReviewCard       loads the panel for the signed-in venue, for the Linked accounts tab and
 *                           the Services page.
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { collectiveCopy, formatVenueList } from '@/lib/linked-accounts/collective-copy';
import type { ReleaseReview } from '@/lib/linked-accounts/replicas/release-review';

interface LeavePreview {
  collective_name: string;
  host_name: string;
  services: number;
  no_stripe: number;
  other_venues: string[];
  last_member: boolean;
}

export function LeaveCollectiveDialog({
  open,
  collectiveId,
  onClose,
  onLeft,
}: {
  open: boolean;
  collectiveId: string;
  onClose: () => void;
  onLeft: (review: ReleaseReview | null) => void;
}) {
  const [preview, setPreview] = useState<LeavePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPreview(null);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/venue/collectives/${collectiveId}/leave`);
        const data = (await res.json().catch(() => ({}))) as LeavePreview & { error?: string };
        if (cancelled) return;
        if (!res.ok) setError(data.error ?? 'Could not load what leaving changes.');
        else setPreview(data);
      } catch {
        if (!cancelled) setError('Could not load what leaving changes. Please check your connection.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, collectiveId]);

  const leave = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/venue/collectives/${collectiveId}/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'leave' }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; review?: ReleaseReview | null };
      if (!res.ok) {
        setError(data.error ?? 'Could not leave. Please try again.');
        return;
      }
      onLeft(data.review ?? null);
    } catch {
      setError('Could not leave. Please check your connection.');
    } finally {
      setBusy(false);
    }
  };

  const collective = preview?.collective_name ?? 'the collective';
  const host = preview?.host_name ?? 'the host';
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title={collectiveCopy('leave.title', { collective })}
      size="md"
      footer={
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="danger" onClick={() => void leave()} disabled={!preview || busy} loading={busy}>
            {collectiveCopy('leave.confirm', { collective })}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm text-slate-700">
        {error ? (
          <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">
            {error}
          </p>
        ) : null}
        {!preview ? (
          error ? null : (
            <p role="status" className="text-slate-500">
              Loading...
            </p>
          )
        ) : (
          <>
            <p>{collectiveCopy('leave.message', { host })}</p>
            <ul className="list-disc space-y-1 pl-5">
              {preview.services > 0 ? (
                <li>
                  {preview.services === 1
                    ? collectiveCopy('leave.body.servicesOne', { host })
                    : collectiveCopy('leave.body.services', { count: preview.services, host })}
                </li>
              ) : null}
              {preview.no_stripe > 0 ? (
                <li className="text-amber-800">
                  {preview.no_stripe === 1 && preview.services === 1
                    ? collectiveCopy('leave.body.noStripeOne')
                    : collectiveCopy('leave.body.noStripe', { count: preview.no_stripe })}
                </li>
              ) : null}
              <li>{collectiveCopy('leave.body.bookings', { collective })}</li>
              {preview.other_venues.length > 0 ? (
                <li>
                  {collectiveCopy('leave.body.access', { venueList: formatVenueList(preview.other_venues, 3) })}
                </li>
              ) : null}
            </ul>
            {preview.last_member ? (
              <p className="font-medium text-amber-900">{collectiveCopy('leave.body.lastMember', { collective })}</p>
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  );
}

export function ReleaseReviewPanel({ review, onDismiss }: { review: ReleaseReview; onDismiss: () => void }) {
  const collective = review.collective_name;
  const host = review.host_name;
  const title =
    review.reason === 'left'
      ? collectiveCopy('review.title', { collective })
      : collectiveCopy('review.titleRemoved', { collective });
  const items: { key: string; text: string; tone?: 'warn' }[] = [];
  if (review.prices > 0) {
    items.push({
      key: 'prices',
      text:
        review.prices === 1
          ? collectiveCopy('review.pricesOne', { host })
          : collectiveCopy('review.prices', { count: review.prices, host }),
    });
  }
  if (review.link > 0) {
    items.push({
      key: 'link',
      text: review.link === 1 ? collectiveCopy('review.linkOne') : collectiveCopy('review.link', { count: review.link }),
    });
  }
  if (review.stripe) items.push({ key: 'stripe', text: collectiveCopy('review.stripe'), tone: 'warn' });
  if (review.library) items.push({ key: 'library', text: collectiveCopy('review.library', { host }) });
  if (review.photos === 'copying') items.push({ key: 'photos', text: collectiveCopy('review.photos.copying', { host }) });
  if (review.photos === 'done') items.push({ key: 'photos', text: collectiveCopy('review.photos.done') });
  if (review.photos === 'failed') {
    items.push({ key: 'photos', text: collectiveCopy('review.photos.failed'), tone: 'warn' });
  }
  for (const name of review.sameName) {
    items.push({ key: `same-${name}`, text: collectiveCopy('review.sameName', { service: name, host }) });
  }
  if (review.unparked > 0) {
    items.push({
      key: 'unparked',
      text:
        review.unparked === 1
          ? collectiveCopy('review.unparkedOne', { collective })
          : collectiveCopy('review.unparked', { count: review.unparked, collective }),
    });
  }

  return (
    <section
      aria-labelledby={`release-review-${review.collective_id}`}
      className="rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3 text-sm text-slate-800"
    >
      <h3 id={`release-review-${review.collective_id}`} className="font-semibold text-slate-900">
        {title}
      </h3>
      {items.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {items.map((item) => (
            <li key={item.key} className={item.tone === 'warn' ? 'text-amber-800' : undefined}>
              {item.text}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3">
        <Button type="button" size="sm" variant="secondary" onClick={onDismiss}>
          {collectiveCopy('review.dismiss')}
        </Button>
      </div>
    </section>
  );
}

/** Loads the review for the signed-in venue; renders nothing when there is none. */
export function ReleaseReviewCard({ initial }: { initial?: ReleaseReview | null }) {
  const [review, setReview] = useState<ReleaseReview | null>(initial ?? null);

  // A new `initial` arrives with a new key, so the effect only loads when there is none.
  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/venue/collectives/review');
        if (!res.ok) return;
        const data = (await res.json()) as { review: ReleaseReview | null };
        if (!cancelled) setReview(data.review);
      } catch {
        /* The panel is a convenience: it stays hidden when it cannot load. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initial]);

  if (!review) return null;
  const dismiss = () => {
    const collectiveId = review.collective_id;
    setReview(null);
    void fetch('/api/venue/collectives/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collective_id: collectiveId }),
    }).catch(() => undefined);
  };
  return <ReleaseReviewPanel review={review} onDismiss={dismiss} />;
}

interface EndedCollectiveRow {
  collective_id: string;
  name: string;
  dissolved_at: string;
  list_on_old_page: boolean;
}

/**
 * The collectives this venue was part of when they ended, for the 90 days their old page shows,
 * with the choice to be listed there (UX spec `la.row.ended`, `la.row.listOnOldPage`; contract 9).
 */
export function EndedCollectivesList({ venueName, refreshKey = 0 }: { venueName: string; refreshKey?: number }) {
  const [rows, setRows] = useState<EndedCollectiveRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/venue/collectives/ended');
        if (!res.ok) return;
        const data = (await res.json()) as { ended: EndedCollectiveRow[] };
        if (!cancelled) setRows(data.ended);
      } catch {
        /* Nothing to show when it cannot load. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (rows.length === 0) return null;

  const toggle = async (row: EndedCollectiveRow, listed: boolean) => {
    setError(null);
    setRows((prev) => prev.map((r) => (r.collective_id === row.collective_id ? { ...r, list_on_old_page: listed } : r)));
    try {
      const res = await fetch(`/api/venue/collectives/${row.collective_id}/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'configure', list_on_old_page: listed }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setRows((prev) =>
        prev.map((r) => (r.collective_id === row.collective_id ? { ...r, list_on_old_page: !listed } : r)),
      );
      setError('That did not save. Please try again.');
    }
  };

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <ul className="space-y-2" aria-label="Ended collectives">
      {error ? (
        <li role="alert" className="text-sm text-rose-700">
          {error}
        </li>
      ) : null}
      {rows.map((row) => (
        <li
          key={row.collective_id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm"
        >
          <span>
            <span className="font-semibold text-slate-900">{row.name}</span>{' '}
            <span className="text-slate-500">{collectiveCopy('la.row.ended', { date: date(row.dissolved_at) })}</span>
          </span>
          <label className="flex items-center gap-2 text-slate-700">
            <input
              type="checkbox"
              checked={row.list_on_old_page}
              onChange={(e) => void toggle(row, e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
            />
            {collectiveCopy('la.row.listOnOldPage', { venue: venueName, collective: row.name })}
          </label>
        </li>
      ))}
    </ul>
  );
}
