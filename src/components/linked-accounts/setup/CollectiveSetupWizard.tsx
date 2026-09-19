'use client';

/**
 * Finish setting up a collective (Docs/link-and-collective-setup-wizard-plan.md §3.3, decisions L8 to
 * L10).
 *
 * The other venue is in; the page is not live. This walks the host through the two things that make
 * it live, where it would otherwise have to find them on the Services page and in the Collective
 * area: which of its services go on the page, and which calendars, at each venue, offer them. Two
 * saves, because a member's calendar cannot offer a service until its copy is applied (L9).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/primitives/Button';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { EmptyState } from '@/components/ui/dashboard/EmptyState';
import { FormField } from '@/components/ui/primitives/FormField';
import { Pill } from '@/components/ui/dashboard/Pill';
import { useToast } from '@/components/ui/Toast';
import { collectiveCopy, formatVenueList } from '@/lib/linked-accounts/collective-copy';
import { currencySymbolFromCode } from '@/lib/money/currency-symbol';
import type { CollectiveCalendarGroup } from '@/lib/linked-accounts/replicas/host-calendars';
import type { CollectiveServiceBlock } from '@/lib/linked-accounts/replicas/service-blocks';
import type { BulkOp, BulkOpResult } from '@/lib/linked-accounts/replicas/bulk-ops';

type Step = 'intro' | 'services' | 'calendars' | 'done';

interface ServiceRow {
  id: string;
  name: string;
  is_active?: boolean | null;
  is_bookable_online?: boolean | null;
  duration_minutes?: number | null;
  price_pence?: number | null;
  collective?: CollectiveServiceBlock | null;
}

interface CalendarLink {
  practitioner_id: string;
  service_id: string;
}

interface CollectiveEntry {
  id: string;
  name: string;
  slug: string;
  hostVenueId: string;
  members: { venueId: string; venueName: string; status: string }[];
}

interface Loaded {
  services: ServiceRow[];
  groups: CollectiveCalendarGroup[];
  links: CalendarLink[];
  entry: CollectiveEntry | null;
}

const cellKey = (serviceId: string, venueId: string, calendarId: string) => `${serviceId}:${venueId}:${calendarId}`;

async function loadAll(collectiveId: string): Promise<Loaded> {
  const [servicesRes, collectivesRes] = await Promise.all([fetch('/api/venue/appointment-services'), fetch('/api/venue/collectives')]);
  if (!servicesRes.ok) throw new Error('services');
  const data = (await servicesRes.json()) as {
    services?: ServiceRow[];
    practitioner_services?: CalendarLink[];
    collective_calendars?: CollectiveCalendarGroup[];
  };
  const list = collectivesRes.ok ? ((await collectivesRes.json()) as { collectives?: CollectiveEntry[] }).collectives ?? [] : [];
  return {
    services: data.services ?? [],
    groups: data.collective_calendars ?? [],
    links: data.practitioner_services ?? [],
    entry: list.find((c) => c.id === collectiveId) ?? null,
  };
}

export function CollectiveSetupWizard({
  collectiveId,
  venueName,
  currency = 'GBP',
  onClose,
  onChanged,
}: {
  collectiveId: string;
  venueName: string;
  currency?: string;
  onClose: () => void;
  /** Called after each save, so the page behind can refresh what the collective looks like. */
  onChanged?: () => void;
}) {
  const { addToast } = useToast();
  const [step, setStep] = useState<Step>('intro');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cells, setCells] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<null | 'services' | 'calendars' | 'adding'>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMinutes, setNewMinutes] = useState('60');
  const [newPrice, setNewPrice] = useState('');
  const [copied, setCopied] = useState(false);

  const symbol = currencySymbolFromCode(currency);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  const load = useCallback(async () => {
    try {
      const next = await loadAll(collectiveId);
      setLoaded(next);
      setLoadError(null);
      return next;
    } catch {
      setLoadError('Could not load your services. Please check your connection and try again.');
      return null;
    }
  }, [collectiveId]);

  useEffect(() => {
    void (async () => {
      const first = await load();
      if (!first) return;
      // Sensible defaults: what is already on the page, plus everything guests can book online.
      const initial = new Set<string>();
      for (const s of hostServices(first.services)) {
        if (s.collective?.role === 'master' || s.is_bookable_online !== false) initial.add(s.id);
      }
      setSelected(initial);
    })();
  }, [load]);

  const entry = loaded?.entry ?? null;
  const collectiveName = entry?.name ?? loaded?.services.find((s) => s.collective)?.collective?.collective_name ?? 'your collective';
  const slug = entry?.slug ?? '';
  const memberNames = useMemo(
    () => (entry?.members ?? []).filter((m) => m.status === 'active' && m.venueId !== entry?.hostVenueId).map((m) => m.venueName),
    [entry],
  );
  const services = useMemo(() => (loaded ? hostServices(loaded.services) : []), [loaded]);
  const onPage = (s: ServiceRow) => s.collective?.role === 'master';
  const selectedServices = services.filter((s) => selected.has(s.id));

  /** The services on the page after the first save, with the item id the calendars are keyed by. */
  const pageServices = useMemo(
    () => services.filter((s) => onPage(s) && s.collective?.item_id && selected.has(s.id)),
    [services, selected],
  );

  // Calendar defaults: what already offers the service (on the page), else, at the host, the
  // calendars that offer it on the venue's own page.
  const seedCells = useCallback(
    (data: Loaded) => {
      const next: Record<string, boolean> = {};
      for (const s of hostServices(data.services)) {
        const itemId = s.collective?.item_id ?? null;
        for (const group of data.groups) {
          for (const cal of group.calendars) {
            if (!cal.is_active) continue;
            const assigned = itemId ? cal.assigned.some((a) => a.item_id === itemId) : false;
            const own = group.is_host && data.links.some((l) => l.practitioner_id === cal.id && l.service_id === s.id);
            next[cellKey(s.id, group.venue_id, cal.id)] = assigned || own;
          }
        }
      }
      setCells(next);
    },
    [],
  );

  const commit = async (ops: BulkOp[]): Promise<BulkOpResult[]> => {
    const res = await fetch(`/api/venue/collectives/${collectiveId}/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ops }),
    });
    const data = (await res.json().catch(() => ({}))) as { results?: BulkOpResult[]; error?: string };
    if (!res.ok) throw new Error(data.error ?? 'The save did not go through.');
    return data.results ?? [];
  };

  const saveServices = async () => {
    if (!loaded) return;
    const toOffer = selectedServices.filter((s) => !onPage(s));
    setBusy('services');
    setError(null);
    setNotice(toOffer.length > 0 ? collectiveCopy('finish.services.saving') : null);
    try {
      let failed = 0;
      if (toOffer.length > 0) {
        const results = await commit(toOffer.map((s) => ({ op: 'offer', service_id: s.id })));
        failed = results.filter((r) => !r.ok).length;
      }
      const fresh = await load();
      if (fresh) seedCells(fresh);
      onChanged?.();
      if (failed > 0) setError(collectiveCopy('finish.services.failed', { count: failed }));
      setNotice(null);
      setStep('calendars');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The save did not go through.');
      setNotice(null);
    } finally {
      setBusy(null);
    }
  };

  const saveCalendars = async () => {
    if (!loaded) return;
    const ops: BulkOp[] = [];
    for (const s of pageServices) {
      const itemId = s.collective!.item_id!;
      for (const group of loaded.groups) {
        if (!venueReady(group, itemId)) continue;
        for (const cal of group.calendars) {
          if (!cal.is_active) continue;
          const want = cells[cellKey(s.id, group.venue_id, cal.id)] === true;
          const has = cal.assigned.some((a) => a.item_id === itemId);
          if (want && !has) ops.push({ op: 'assign', service_id: s.id, venue_id: group.venue_id, calendar_id: cal.id });
          if (!want && has) ops.push({ op: 'unassign', service_id: s.id, venue_id: group.venue_id, calendar_id: cal.id });
        }
      }
    }
    setBusy('calendars');
    setError(null);
    setNotice(ops.length > 0 ? collectiveCopy('finish.calendars.saving') : null);
    try {
      let failed = 0;
      for (let i = 0; i < ops.length; i += 200) {
        const results = await commit(ops.slice(i, i + 200));
        failed += results.filter((r) => !r.ok).length;
      }
      const fresh = await load();
      if (fresh) seedCells(fresh);
      onChanged?.();
      if (failed > 0) setError(collectiveCopy('finish.calendars.failed', { count: failed }));
      setNotice(null);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The save did not go through.');
      setNotice(null);
    } finally {
      setBusy(null);
    }
  };

  const addService = async () => {
    const minutes = Number.parseInt(newMinutes, 10);
    const price = newPrice.trim() === '' ? 0 : Math.round(Number.parseFloat(newPrice) * 100);
    if (newName.trim().length === 0 || !Number.isFinite(minutes) || minutes < 5 || !Number.isFinite(price) || price < 0) {
      setError('Give the service a name, a length of at least 5 minutes, and a price.');
      return;
    }
    setBusy('adding');
    setError(null);
    try {
      const res = await fetch('/api/venue/appointment-services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), duration_minutes: minutes, price_pence: price }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; service?: { id?: string }; id?: string };
      if (!res.ok) {
        setError(data.error ?? 'The service was not added. Please try again.');
        return;
      }
      const fresh = await load();
      const createdId = data.service?.id ?? data.id ?? null;
      if (fresh) {
        const match = createdId ? fresh.services.find((s) => s.id === createdId) : fresh.services.find((s) => s.name === newName.trim());
        if (match) setSelected((prev) => new Set([...prev, match.id]));
      }
      setNewName('');
      setNewPrice('');
      setAdding(false);
      addToast(`${newName.trim()} added.`, 'success');
    } catch {
      setError('The service was not added. Please check your connection.');
    } finally {
      setBusy(null);
    }
  };

  const live = useMemo(() => {
    if (!loaded || !entry) return false;
    const activeCount = entry.members.filter((m) => m.status === 'active').length;
    if (activeCount < 2) return false;
    return loaded.groups.some((g) => g.calendars.some((c) => c.is_active && c.assigned.length > 0));
  }, [loaded, entry]);

  const steps: Step[] = ['intro', 'services', 'calendars', 'done'];
  const index = steps.indexOf(step);
  const fullAddress = `${origin}/book/c/${slug}`;

  const footer =
    step === 'done' ? (
      <div className="flex justify-end">
        <Button type="button" onClick={onClose}>
          {collectiveCopy('finish.done.close')}
        </Button>
      </div>
    ) : (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {step === 'calendars' ? (
            <Button type="button" variant="secondary" onClick={() => setStep('services')} disabled={busy !== null}>
              {collectiveCopy('finish.cta.back')}
            </Button>
          ) : step === 'services' ? (
            <Button type="button" variant="secondary" onClick={() => setStep('intro')} disabled={busy !== null}>
              {collectiveCopy('finish.cta.back')}
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy !== null}>
            {collectiveCopy('finish.cta.later')}
          </Button>
          {step === 'intro' ? (
            <Button type="button" onClick={() => setStep('services')} disabled={!loaded}>
              {collectiveCopy('finish.cta.next')}
            </Button>
          ) : step === 'services' ? (
            <Button type="button" onClick={() => void saveServices()} disabled={busy !== null || selectedServices.length === 0} loading={busy === 'services'}>
              {collectiveCopy('finish.cta.save')}
            </Button>
          ) : (
            <Button type="button" onClick={() => void saveCalendars()} disabled={busy !== null} loading={busy === 'calendars'}>
              {collectiveCopy('finish.cta.save')}
            </Button>
          )}
        </div>
      </div>
    );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && busy === null) onClose();
      }}
      title={
        step === 'done'
          ? live
            ? collectiveCopy('finish.done.title', { collective: collectiveName })
            : collectiveCopy('finish.done.notLive.title', { collective: collectiveName })
          : collectiveCopy('finish.title', { collective: collectiveName })
      }
      description={step === 'done' ? undefined : collectiveCopy('finish.step', { n: index + 1, total: 3 })}
      size="lg"
      footer={footer}
    >
      <div className="space-y-4 text-sm text-slate-700">
        {step !== 'done' ? (
          <ol className="grid grid-cols-3 gap-1" aria-label="Progress">
            {(['intro', 'services', 'calendars'] as const).map((s, n) => (
              <li key={s}>
                <span className={`block h-1 w-full rounded-full ${n <= index ? 'bg-brand-600' : 'bg-slate-200'}`}>
                  <span className="sr-only">{n === index ? `Step ${n + 1}, current` : `Step ${n + 1}`}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : null}

        {loadError ? (
          <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">
            <p>{loadError}</p>
            <Button type="button" variant="link" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-slate-600">
            {notice}
          </p>
        ) : null}

        {step === 'intro' ? (
          <section className="space-y-3">
            <h3 className="font-semibold text-slate-900">
              {collectiveCopy('finish.intro.heading', { venueList: formatVenueList(memberNames, 3) || 'Your partner venue' })}
            </h3>
            <p>{collectiveCopy('finish.intro.body', { collective: collectiveName })}</p>
            <p className="rounded-xl bg-brand-50 px-4 py-3">{collectiveCopy('finish.intro.owns')}</p>
            {!loaded && !loadError ? (
              <p role="status" className="text-slate-500">
                Loading...
              </p>
            ) : null}
          </section>
        ) : null}

        {step === 'services' && loaded ? (
          <section className="space-y-3">
            <h3 className="font-semibold text-slate-900">{collectiveCopy('finish.services.heading')}</h3>
            <p className="text-xs text-slate-600">{collectiveCopy('finish.services.help', { collective: collectiveName })}</p>
            {services.length === 0 && !adding ? (
              <EmptyState
                size="compact"
                title={collectiveCopy('finish.services.none.title')}
                description={collectiveCopy('finish.services.none.body')}
                action={
                  <Button type="button" onClick={() => setAdding(true)}>
                    {collectiveCopy('finish.services.add')}
                  </Button>
                }
              />
            ) : (
              <ul className="space-y-2">
                {services.map((s) => {
                  const already = onPage(s);
                  const checked = selected.has(s.id);
                  return (
                    <li key={s.id} className="flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-2">
                      <input
                        id={`finish-service-${s.id}`}
                        type="checkbox"
                        checked={checked}
                        disabled={already}
                        onChange={(e) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(s.id);
                            else next.delete(s.id);
                            return next;
                          })
                        }
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600"
                      />
                      <label htmlFor={`finish-service-${s.id}`} className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-900">{s.name}</span>
                          {already ? (
                            <Pill variant="brand" size="sm">
                              {collectiveCopy('finish.services.onPage')}
                            </Pill>
                          ) : null}
                          {s.is_bookable_online === false ? (
                            <Pill variant="neutral" size="sm">
                              {collectiveCopy('finish.services.staffOnly')}
                            </Pill>
                          ) : null}
                        </span>
                        <span className="block text-xs text-slate-600">
                          {[
                            s.duration_minutes ? `${s.duration_minutes} min` : null,
                            s.price_pence != null ? `${symbol}${(s.price_pence / 100).toFixed(2)}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {adding ? (
              <div className="space-y-2 rounded-xl border border-brand-200 bg-brand-50/40 p-3">
                <FormField label={collectiveCopy('finish.services.add.name')} htmlFor="finish-new-name">
                  <input
                    id="finish-new-name"
                    value={newName}
                    maxLength={200}
                    autoFocus
                    onChange={(e) => setNewName(e.target.value)}
                    className="min-h-[44px] w-full rounded-lg border border-slate-200 px-3 py-2"
                  />
                </FormField>
                <div className="grid gap-2 sm:grid-cols-2">
                  <FormField label={collectiveCopy('finish.services.add.duration')} htmlFor="finish-new-minutes">
                    <input
                      id="finish-new-minutes"
                      type="number"
                      min={5}
                      max={480}
                      step={5}
                      value={newMinutes}
                      onChange={(e) => setNewMinutes(e.target.value)}
                      className="min-h-[44px] w-full rounded-lg border border-slate-200 px-3 py-2"
                    />
                  </FormField>
                  <FormField label={`${collectiveCopy('finish.services.add.price')} (${symbol})`} htmlFor="finish-new-price">
                    <input
                      id="finish-new-price"
                      type="number"
                      min={0}
                      step="0.01"
                      value={newPrice}
                      placeholder="0.00"
                      onChange={(e) => setNewPrice(e.target.value)}
                      className="min-h-[44px] w-full rounded-lg border border-slate-200 px-3 py-2"
                    />
                  </FormField>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => void addService()} disabled={busy !== null} loading={busy === 'adding'}>
                    {busy === 'adding' ? collectiveCopy('finish.services.add.adding') : collectiveCopy('finish.services.add.cta')}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)} disabled={busy !== null}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : services.length > 0 ? (
              <Button type="button" variant="link" size="sm" onClick={() => setAdding(true)}>
                {collectiveCopy('finish.services.add')}
              </Button>
            ) : null}
            <p className="text-xs text-slate-500">
              {collectiveCopy(selectedServices.length === 1 ? 'finish.services.selectedOne' : 'finish.services.selected', {
                count: selectedServices.length,
              })}
            </p>
          </section>
        ) : null}

        {step === 'calendars' && loaded ? (
          <section className="space-y-3">
            <h3 className="font-semibold text-slate-900">{collectiveCopy('finish.calendars.heading')}</h3>
            <p className="text-xs text-slate-600">{collectiveCopy('finish.calendars.help')}</p>
            {loaded.groups.map((group) => {
              const active = group.calendars.filter((c) => c.is_active);
              const ready = pageServices.every((s) => venueReady(group, s.collective!.item_id!));
              return (
                <section key={group.venue_id} className="space-y-2 rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-semibold text-slate-900">{group.venue_name}</h4>
                    {group.is_host ? (
                      <Pill variant="brand" size="sm">
                        Host
                      </Pill>
                    ) : null}
                  </div>
                  {!ready ? (
                    <p className="text-xs text-amber-800">
                      {collectiveCopy('finish.calendars.notReady', { venue: group.venue_name })}{' '}
                      <Button type="button" variant="link" size="sm" onClick={() => void load().then((f) => f && seedCells(f))}>
                        Check again
                      </Button>
                    </p>
                  ) : active.length === 0 ? (
                    <p className="text-xs text-slate-500">{collectiveCopy('finish.calendars.noCalendars', { venue: group.venue_name })}</p>
                  ) : (
                    pageServices.map((s) => {
                      const allOn = active.every((c) => cells[cellKey(s.id, group.venue_id, c.id)]);
                      return (
                        <fieldset key={s.id} className="rounded-lg bg-slate-50 px-3 py-2">
                          <legend className="px-1 font-medium text-slate-900">{s.name}</legend>
                          <div className="flex flex-wrap gap-x-4 gap-y-1">
                            <label className="flex items-center gap-2 text-xs font-medium text-brand-700">
                              <input
                                type="checkbox"
                                checked={allOn}
                                onChange={(e) =>
                                  setCells((prev) => {
                                    const next = { ...prev };
                                    for (const c of active) next[cellKey(s.id, group.venue_id, c.id)] = e.target.checked;
                                    return next;
                                  })
                                }
                                className="h-4 w-4 rounded border-slate-300 text-brand-600"
                              />
                              {collectiveCopy('finish.calendars.all')}
                            </label>
                            {active.map((c) => {
                              const key = cellKey(s.id, group.venue_id, c.id);
                              return (
                                <label key={c.id} className="flex items-center gap-2 text-xs text-slate-700">
                                  <input
                                    type="checkbox"
                                    checked={cells[key] === true}
                                    onChange={(e) => setCells((prev) => ({ ...prev, [key]: e.target.checked }))}
                                    className="h-4 w-4 rounded border-slate-300 text-brand-600"
                                  />
                                  {c.name}
                                </label>
                              );
                            })}
                          </div>
                        </fieldset>
                      );
                    })
                  )}
                </section>
              );
            })}
          </section>
        ) : null}

        {step === 'done' ? (
          <section className="space-y-3">
            <p>{live ? collectiveCopy('finish.done.body', { collective: collectiveName }) : collectiveCopy('finish.done.notLive.body')}</p>
            {slug ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
                <span className="min-w-0 flex-1 break-all font-mono text-slate-900">{fullAddress}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard?.writeText(fullAddress).then(() => setCopied(true), () => undefined);
                  }}
                >
                  {copied ? 'Copied' : collectiveCopy('finish.done.copy')}
                </Button>
                <Button asChild size="sm" variant="secondary">
                  <a href={`/book/c/${slug}`} target="_blank" rel="noreferrer">
                    {collectiveCopy('finish.done.open')}
                  </a>
                </Button>
              </div>
            ) : null}
            <ol className="space-y-2">
              {[
                { label: collectiveCopy('finish.done.design'), body: collectiveCopy('finish.done.design.body'), href: '/dashboard/settings?tab=booking-page' },
                { label: collectiveCopy('finish.done.area'), body: collectiveCopy('finish.done.area.body'), href: '/dashboard/collective' },
              ].map((next, i) => (
                <li key={next.href} className="flex gap-3 rounded-xl border border-slate-200 px-3 py-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">
                    {i + 1}
                  </span>
                  <span>
                    <Link href={next.href} className="font-semibold text-brand-700 underline">
                      {next.label}
                    </Link>
                    <span className="block text-xs text-slate-600">{next.body}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-xs text-slate-500">{venueName} is the host of {collectiveName}.</p>
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}

/** The host's own active services: what can go on the page. Copies from another collective never appear here. */
function hostServices(services: ServiceRow[]): ServiceRow[] {
  return services.filter((s) => s.is_active !== false && s.collective?.role !== 'replica' && s.collective?.role !== 'retired');
}

/** A venue can take calendar choices for a service once its copy of it is applied (the host always can). */
function venueReady(group: CollectiveCalendarGroup, itemId: string): boolean {
  if (group.is_host) return true;
  if (group.sync.pending.some((p) => p.venue_id === group.venue_id)) return false;
  if (group.sync.failed.some((f) => f.venue_id === group.venue_id)) return false;
  // A member's calendar can only list a service it holds; the host's groups carry each calendar's
  // assignments, so a venue with no calendars yet is "ready" (there is simply nothing to tick).
  void itemId;
  return true;
}
