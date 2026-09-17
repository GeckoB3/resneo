'use client';

/**
 * Host-initiated adoption on the Services page (UX spec `svc.addFrom.*`, `svc.member.adopt.*`, J3,
 * N26; plan contracts 1 and 10; W7).
 *
 *   AddFromVenueDialog      the host picks a member and one of its own services; it is copied, put on
 *                           the page, and the member is asked;
 *   AdoptionRequests        the member's open questions, one line each, opening the answer; a link
 *                           from the N26 email (`?adopt={itemId}`) opens it straight away;
 *   AdoptionReviewDialog    "Use my {service}" with its options matched, or "Keep mine separate".
 */
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';
import type { AdoptionReview, OwnService, PendingAdoption } from '@/lib/linked-accounts/replicas/adoptions';

const readError = async (res: Response, fallback: string) => {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? fallback;
};

export function AddFromVenueDialog({
  open,
  onClose,
  collectiveId,
  collectiveName,
  venues,
  formatPrice,
  onAdded,
  initialVenueId = null,
  initialServiceId = null,
}: {
  /** From a member's suggestion (N25): that venue and service, already chosen. */
  initialVenueId?: string | null;
  initialServiceId?: string | null;
  open: boolean;
  onClose: () => void;
  collectiveId: string;
  collectiveName: string;
  venues: { venue_id: string; venue_name: string }[];
  formatPrice: (pence: number) => string;
  onAdded: (message: string) => void;
}) {
  const [venueId, setVenueId] = useState(
    initialVenueId && venues.some((v) => v.venue_id === initialVenueId) ? initialVenueId : (venues[0]?.venue_id ?? ''),
  );
  const [preset, setPreset] = useState(initialServiceId);
  const [services, setServices] = useState<OwnService[] | null>(null);
  const [serviceId, setServiceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !venueId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/venue/collectives/${collectiveId}/offerings?source_venue_id=${encodeURIComponent(venueId)}`);
        if (cancelled) return;
        if (!res.ok) {
          setError(await readError(res, 'Could not load that venue’s services.'));
          setServices([]);
          return;
        }
        const data = (await res.json()) as { services: OwnService[] };
        if (cancelled) return;
        setServices(data.services);
        // A suggested service is chosen for the host, once, if it can still be added.
        setServiceId(preset && data.services.some((s) => s.id === preset) ? preset : '');
        setPreset(null);
        setError(null);
      } catch {
        if (!cancelled) setError('Could not load that venue’s services. Please check your connection.');
      }
    })();
    return () => {
      cancelled = true;
    };
    // `preset` is read once, for the first list; it is not a reason to fetch again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, collectiveId, venueId]);

  const venueName = venues.find((v) => v.venue_id === venueId)?.venue_name ?? 'That venue';
  const chosen = services?.find((s) => s.id === serviceId) ?? null;

  const add = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/venue/collectives/${collectiveId}/offerings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_venue_id: venueId, source_service_id: chosen.id }),
      });
      if (!res.ok) {
        setError(await readError(res, 'Could not add that service. Please try again.'));
        return;
      }
      onAdded(collectiveCopy('svc.addFrom.done', { service: chosen.name, collective: collectiveName, venue: venueName }));
    } catch {
      setError('Could not add that service. Please check your connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title={collectiveCopy('svc.addFrom.title')}
      description={collectiveCopy('svc.addFrom.help', { collective: collectiveName })}
      size="md"
      footer={
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void add()} disabled={!chosen || busy} loading={busy}>
            {collectiveCopy('svc.addFrom.confirm')}
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
        <label className="block">
          <span className="mb-1 block font-medium text-slate-900">{collectiveCopy('svc.addFrom.venueLabel')}</span>
          <select
            value={venueId}
            onChange={(e) => {
              setServices(null);
              setVenueId(e.target.value);
            }}
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
          >
            {venues.map((v) => (
              <option key={v.venue_id} value={v.venue_id}>
                {v.venue_name}
              </option>
            ))}
          </select>
        </label>
        {services === null ? (
          <p role="status" className="text-slate-500">
            Loading...
          </p>
        ) : services.length === 0 ? (
          <p className="text-slate-500">{collectiveCopy('svc.addFrom.empty', { venue: venueName })}</p>
        ) : (
          <fieldset className="space-y-1">
            <legend className="sr-only">Service</legend>
            {services.map((s) => (
              <label key={s.id} className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2">
                <input
                  type="radio"
                  name="add-from-service"
                  checked={serviceId === s.id}
                  onChange={() => setServiceId(s.id)}
                />
                <span className="flex-1 font-medium text-slate-900">{s.name}</span>
                <span className="text-xs text-slate-500">
                  {s.duration_minutes != null ? `${s.duration_minutes} min` : ''}
                  {s.duration_minutes != null && s.price_pence != null ? ', ' : ''}
                  {s.price_pence != null ? formatPrice(s.price_pence) : ''}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {chosen ? (
          <p className="text-xs text-slate-600">
            {collectiveCopy('svc.addFrom.adoptNote', { venue: venueName, service: chosen.name })}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

export function AdoptionReviewDialog({
  collectiveId,
  itemId,
  onClose,
  onAnswered,
}: {
  collectiveId: string;
  itemId: string;
  onClose: () => void;
  onAnswered: () => void;
}) {
  const [review, setReview] = useState<AdoptionReview | null>(null);
  const [map, setMap] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/venue/collectives/${collectiveId}/adoptions/${itemId}`);
        if (cancelled) return;
        if (!res.ok) {
          setError(await readError(res, 'Could not load the question.'));
          return;
        }
        const data = (await res.json()) as AdoptionReview;
        if (cancelled) return;
        setReview(data);
        setMap(Object.fromEntries(data.suggested_map.map((m) => [m.my_variant_id, m.host_variant_id])));
      } catch {
        if (!cancelled) setError('Could not load the question. Please check your connection.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [collectiveId, itemId]);

  const answer = async (choice: 'use_mine' | 'keep_separate') => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/venue/collectives/${collectiveId}/adoptions/${itemId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          choice,
          ...(choice === 'use_mine'
            ? { option_map: Object.entries(map).map(([my, host]) => ({ my_variant_id: my, host_variant_id: host })) }
            : {}),
        }),
      });
      if (!res.ok) {
        setError(await readError(res, 'Could not save your answer. Please try again.'));
        return;
      }
      onAnswered();
    } catch {
      setError('Could not save your answer. Please check your connection.');
    } finally {
      setBusy(false);
    }
  };

  const params = useMemo(
    () => ({
      host: review?.host_name ?? 'The host',
      service: review?.service.name ?? 'your service',
      collective: review?.collective_name ?? 'the collective',
    }),
    [review],
  );

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title={review ? collectiveCopy('svc.member.adopt.title', params) : 'Loading...'}
      size="lg"
      footer={
        review ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void answer('use_mine')} disabled={busy} loading={busy}>
              {collectiveCopy('svc.member.adopt.useMine', params)}
            </Button>
            <Button type="button" variant="secondary" onClick={() => void answer('keep_separate')} disabled={busy}>
              {collectiveCopy('svc.member.adopt.keepSeparate')}
            </Button>
          </div>
        ) : (
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className="space-y-3 text-sm text-slate-700">
        {error ? (
          <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">
            {error}
          </p>
        ) : null}
        {review ? (
          <>
            <p>{collectiveCopy('svc.member.adopt.message', params)}</p>
            {review.service.options.length > 0 ? (
              <table className="w-full text-xs">
                <caption className="text-left font-medium text-slate-800">{collectiveCopy('join.map.heading')}</caption>
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-1 font-medium">{collectiveCopy('join.map.yours')}</th>
                    <th className="py-1 font-medium">{collectiveCopy('join.map.theirs', { host: params.host })}</th>
                  </tr>
                </thead>
                <tbody>
                  {review.service.options.map((mine) => (
                    <tr key={mine.id}>
                      <td className="py-1">{mine.name}</td>
                      <td className="py-1">
                        <select
                          aria-label={`${collectiveCopy('join.map.theirs', { host: params.host })} for ${mine.name}`}
                          value={map[mine.id] ?? ''}
                          onChange={(e) => setMap((prev) => ({ ...prev, [mine.id]: e.target.value || null }))}
                          className="rounded border border-slate-200 px-1 py-0.5"
                        >
                          <option value="">{collectiveCopy('join.map.keepOld')}</option>
                          {review.host_options.map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

/** The member's open questions, with `?adopt=` opening one straight away. */
export function AdoptionRequests({
  collectiveId,
  initialItemId,
  onAnswered,
}: {
  collectiveId: string;
  initialItemId: string | null;
  onAnswered: () => void;
}) {
  const [data, setData] = useState<{ host_name: string; collective_name: string; adoptions: PendingAdoption[] } | null>(
    null,
  );
  const [open, setOpen] = useState<string | null>(initialItemId);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/venue/collectives/${collectiveId}/adoptions`);
        if (!res.ok || cancelled) return;
        const next = (await res.json()) as { host_name: string; collective_name: string; adoptions: PendingAdoption[] };
        if (!cancelled) setData(next);
      } catch {
        /* The list is a convenience; the email link still opens the question. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [collectiveId, version]);

  const adoptions = data?.adoptions ?? [];
  return (
    <>
      {adoptions.length > 0 ? (
        <section aria-label="Questions from the host" className="space-y-2">
          {adoptions.map((a) => (
            <div
              key={a.item_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            >
              <span className="font-medium">
                {collectiveCopy('svc.member.adopt.title', { host: data?.host_name ?? 'The host', service: a.service_name })}
              </span>
              <Button type="button" size="sm" onClick={() => setOpen(a.item_id)}>
                {collectiveCopy('svc.member.adopt.open')}
              </Button>
            </div>
          ))}
        </section>
      ) : null}
      {open ? (
        <AdoptionReviewDialog
          collectiveId={collectiveId}
          itemId={open}
          onClose={() => setOpen(null)}
          onAnswered={() => {
            setOpen(null);
            setVersion((v) => v + 1);
            onAnswered();
          }}
        />
      ) : null}
    </>
  );
}
