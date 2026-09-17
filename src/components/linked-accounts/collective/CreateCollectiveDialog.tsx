'use client';

/**
 * Creating a collective (UX spec J1, `create.*`; UI-C-01; plan CB-41; W7).
 *
 * Four steps and a receipt, replacing the one-screen dialog whose refusals rendered behind it:
 *   1. name it and choose its address, with what a collective is and who hosts it;
 *   2. choose the venues, listing every linked venue, including the ones that cannot join and why;
 *   3. what changes, venue by venue, with the one acknowledgement;
 *   4. check and create, where every refusal from the server is shown, with a way back to the step
 *      it belongs to;
 *   5. done: the address, and what to do next.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/primitives/Button';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { FormField } from '@/components/ui/primitives/FormField';
import { Pill } from '@/components/ui/dashboard/Pill';
import { EmptyState } from '@/components/ui/dashboard/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { collectiveCopy, formatVenueList } from '@/lib/linked-accounts/collective-copy';
import type { CollectiveCandidate } from '@/lib/linked-accounts/collective-candidates';

type Step = 1 | 2 | 3 | 4 | 5;
type AddressState = 'idle' | 'checking' | 'free' | 'taken' | 'format';
type ErrorField = 'name' | 'slug' | 'venues' | 'collective' | 'plan';

interface CreateError {
  message: string;
  field: ErrorField | null;
}

const STEP_FOR_FIELD: Record<ErrorField, Step | null> = { name: 1, slug: 1, venues: 2, collective: null, plan: null };

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

export function CreateCollectiveDialog({
  venueName,
  onClose,
  onCreated,
}: {
  venueName: string;
  onClose: () => void;
  /** Called once the collective exists, with the route's 201 body. */
  onCreated: (created: unknown) => void;
}) {
  const { addToast } = useToast();
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [address, setAddress] = useState<AddressState>('idle');
  const [candidates, setCandidates] = useState<CollectiveCandidate[] | null>(null);
  const [venueSlug, setVenueSlug] = useState<string | null>(null);
  const [invited, setInvited] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CreateError | null>(null);
  const [copied, setCopied] = useState(false);

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const effectiveSlug = slugTouched ? slug : slugify(name);

  // Step 1: is the address free? A short wait, so typing is not a request per key.
  useEffect(() => {
    if (!effectiveSlug) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/venue/collectives/slug-available?slug=${encodeURIComponent(effectiveSlug)}`);
        const data = (await res.json().catch(() => ({}))) as { available?: boolean; format?: boolean };
        if (cancelled) return;
        setAddress(data.available ? 'free' : data.format ? 'format' : 'taken');
      } catch {
        if (!cancelled) setAddress('idle');
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [effectiveSlug]);

  // Step 2: every linked venue, and whether it can join.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/venue/collectives/candidates');
        const data = (await res.json().catch(() => ({}))) as {
          candidates?: CollectiveCandidate[];
          host_slug?: string | null;
        };
        if (cancelled) return;
        setCandidates(data.candidates ?? []);
        setVenueSlug(data.host_slug ?? null);
      } catch {
        if (!cancelled) setCandidates([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const addressState: AddressState = effectiveSlug ? address : 'idle';
  const invitedVenues = useMemo(
    () => (candidates ?? []).filter((c) => invited.includes(c.venue_id)),
    [candidates, invited],
  );
  const invitedNames = invitedVenues.map((c) => c.venue_name);
  const collective = name.trim() || 'your collective';
  const venueList = formatVenueList(invitedNames, 3);

  const stepOneReason =
    name.trim().length < 2
      ? collectiveCopy('create.name.help')
      : addressState !== 'free'
        ? collectiveCopy('create.disabled.address')
        : null;
  const canContinue =
    step === 1 ? stepOneReason === null : step === 2 ? invited.length > 0 : step === 3 ? acknowledged : true;

  const addressMessage =
    addressState === 'checking' || (effectiveSlug && addressState === 'idle')
      ? collectiveCopy('create.address.checking')
      : addressState === 'taken'
        ? collectiveCopy('create.address.taken')
        : addressState === 'format'
          ? collectiveCopy('create.address.format')
          : null;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/venue/collectives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), slug: effectiveSlug, inviteVenueIds: invited }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; field?: ErrorField };
      if (!res.ok) {
        setError({
          message: data.error ?? 'Something went wrong and the collective was not created. Please try again.',
          field: data.field ?? null,
        });
        return;
      }
      setStep(5);
      addToast(collectiveCopy('create.toast.done', { collective, venueList }), 'success');
      onCreated(data);
    } catch {
      setError({ message: 'The collective was not created. Please check your connection and try again.', field: null });
    } finally {
      setBusy(false);
    }
  };

  const fullAddress = `${origin}/book/c/${effectiveSlug}`;
  const back = step > 1 && step < 5 ? ((step - 1) as Step) : null;

  const footer =
    step === 5 ? (
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          {collectiveCopy('create.done.later')}
        </Button>
        <Button asChild>
          <Link href="/dashboard/collective">{collectiveCopy('create.done.cta')}</Link>
        </Button>
      </div>
    ) : (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {back ? (
            <Button type="button" variant="secondary" onClick={() => setStep(back)} disabled={busy}>
              Back
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {step === 4 ? (
            <Button type="button" onClick={() => void create()} disabled={busy} loading={busy}>
              {busy ? collectiveCopy('create.cta.creating') : collectiveCopy('create.cta.create')}
            </Button>
          ) : (
            <Button type="button" onClick={() => setStep((step + 1) as Step)} disabled={!canContinue}>
              Continue
            </Button>
          )}
        </div>
      </div>
    );

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title={step === 5 ? collectiveCopy('create.done.title', { collective }) : collectiveCopy('create.title')}
      description={step === 5 ? undefined : collectiveCopy('create.step', { n: step })}
      size="lg"
      footer={footer}
    >
      <div className="space-y-4 text-sm text-slate-700">
        {step < 5 ? (
          <ol className="grid grid-cols-4 gap-1" aria-label="Progress">
            {([1, 2, 3, 4] as const).map((n) => (
              <li key={n}>
                {n < step ? (
                  <button
                    type="button"
                    onClick={() => setStep(n)}
                    className="block h-1 w-full rounded-full bg-brand-600"
                    aria-label={`Back to step ${n}`}
                  />
                ) : (
                  <span className={`block h-1 w-full rounded-full ${n === step ? 'bg-brand-600' : 'bg-slate-200'}`}>
                    <span className="sr-only">{n === step ? `Step ${n}, current` : `Step ${n}`}</span>
                  </span>
                )}
              </li>
            ))}
          </ol>
        ) : null}

        {error && step === 4 ? (
          <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">
            <p>{error.message}</p>
            {error.field && STEP_FOR_FIELD[error.field] ? (
              <button
                type="button"
                className="mt-1 font-semibold underline"
                onClick={() => {
                  setStep(STEP_FOR_FIELD[error.field!]!);
                }}
              >
                {error.field === 'venues' ? 'Change the venues' : 'Change the name or address'}
              </button>
            ) : null}
          </div>
        ) : null}

        {step === 1 ? (
          <>
            <section className="rounded-xl bg-brand-50 px-4 py-3">
              <h3 className="font-semibold text-slate-900">{collectiveCopy('create.what.title')}</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>{collectiveCopy('create.what.1')}</li>
                <li>{collectiveCopy('create.what.2')}</li>
                <li>{collectiveCopy('create.what.3')}</li>
              </ul>
              <p className="mt-2 font-medium text-slate-900">{collectiveCopy('create.what.host', { venue: venueName })}</p>
            </section>
            {error && STEP_FOR_FIELD[error.field ?? 'plan'] === 1 ? (
              <p role="alert" className="text-rose-700">
                {error.message}
              </p>
            ) : null}
            <FormField label={collectiveCopy('create.name.label')} htmlFor="collective-name" description={collectiveCopy('create.name.help')}>
              <input
                id="collective-name"
                value={name}
                maxLength={120}
                autoFocus
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                className="min-h-[44px] w-full rounded-lg border border-slate-200 px-3 py-2"
              />
            </FormField>
            <FormField label="Page address" htmlFor="collective-address" error={addressMessage}>
              <div className="flex min-h-[44px] items-center rounded-lg border border-slate-200 bg-white pl-3 focus-within:border-brand-500">
                <span className="shrink-0 font-mono text-slate-500">/book/c/</span>
                <input
                  id="collective-address"
                  value={effectiveSlug}
                  maxLength={60}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setAddress('checking');
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                    setError(null);
                  }}
                  className="min-w-0 flex-1 border-0 bg-transparent px-1 py-2 font-mono focus:outline-none focus:ring-0"
                />
              </div>
            </FormField>
            {effectiveSlug ? (
              <p className="break-all font-mono text-xs text-slate-500">
                {collectiveCopy('create.address.preview', { origin, slug: effectiveSlug })}
              </p>
            ) : null}
            {addressState === 'free' ? (
              <p className="text-xs text-emerald-700">{collectiveCopy('create.address.free')}</p>
            ) : null}
            {stepOneReason ? <p className="text-xs text-slate-500">{stepOneReason}</p> : null}
          </>
        ) : null}

        {step === 2 ? (
          candidates === null ? (
            <p role="status" className="text-slate-500">
              Loading...
            </p>
          ) : candidates.length === 0 ? (
            <EmptyState
              size="compact"
              title={collectiveCopy('create.venues.empty.title')}
              description={collectiveCopy('create.venues.empty.body')}
              action={
                <Button asChild variant="secondary">
                  <Link href="/dashboard/settings?tab=linked-accounts">Active links</Link>
                </Button>
              }
            />
          ) : (
            <>
              {error && STEP_FOR_FIELD[error.field ?? 'plan'] === 2 ? (
                <p role="alert" className="text-rose-700">
                  {error.message}
                </p>
              ) : null}
              <ul className="space-y-2">
                {candidates.map((c) => {
                  const selectable = c.standing === 'ok' || c.standing === 'no_payments';
                  return (
                    <li
                      key={c.venue_id}
                      className={`flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-3 ${selectable ? '' : 'bg-slate-50'}`}
                    >
                      <input
                        id={`invite-${c.venue_id}`}
                        type="checkbox"
                        disabled={!selectable}
                        checked={invited.includes(c.venue_id)}
                        onChange={(e) => {
                          setError(null);
                          setInvited((prev) =>
                            e.target.checked ? [...prev, c.venue_id] : prev.filter((v) => v !== c.venue_id),
                          );
                        }}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <label htmlFor={`invite-${c.venue_id}`} className="font-semibold text-slate-900">
                            {c.venue_name}
                          </label>
                          {c.standing === 'no_payments' ? (
                            <Pill variant="warning">{collectiveCopy('create.venues.pill.noPayments')}</Pill>
                          ) : c.standing === 'blocked' || c.standing === 'permissions' ? (
                            <Pill variant="neutral">{collectiveCopy('create.venues.pill.cannotJoin')}</Pill>
                          ) : null}
                        </div>
                        <p className={`text-xs ${c.standing === 'no_payments' ? 'text-amber-800' : 'text-slate-600'}`}>
                          {c.standing === 'ok' ? collectiveCopy('create.venues.ok') : c.reason}
                        </p>
                        {c.detail ? <p className="text-xs text-slate-500">{c.detail}</p> : null}
                        {c.standing === 'permissions' ? (
                          <Link
                            href="/dashboard/settings?tab=linked-accounts"
                            className="text-xs font-semibold text-brand-700 underline"
                          >
                            {collectiveCopy('create.venues.fixPermissions')}
                          </Link>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-slate-500">{collectiveCopy('create.venues.selected', { count: invited.length })}</p>
            </>
          )
        ) : null}

        {step === 3 ? (
          <>
            <h3 className="font-semibold text-slate-900">{collectiveCopy('create.changes.title', { collective })}</h3>
            <p>{collectiveCopy('create.changes.intro')}</p>
            <ul className="space-y-1 rounded-xl border border-slate-200 p-3">
              {[
                { name: venueName, slug: venueSlug },
                ...invitedVenues.map((c) => ({ name: c.venue_name, slug: c.venue_slug })),
              ].map((row) => (
                <li key={row.name} className="flex flex-wrap items-center gap-x-2 text-xs">
                  <span className="font-medium text-slate-900">{row.name}</span>
                  <span className="font-mono text-slate-500">{row.slug ? `/book/${row.slug}` : ''}</span>
                  <span aria-hidden="true">→</span>
                  <span className="sr-only">will lead to</span>
                  <span className="font-mono text-slate-900">/book/c/{effectiveSlug}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-600">
              {collectiveCopy('create.changes.address.note', { collective })}{' '}
              {collectiveCopy('create.changes.address.when')}
            </p>
            {(['services', 'owns', 'clients'] as const).map((key) => (
              <section key={key} className="rounded-xl border border-slate-200 px-3 py-2">
                <h4 className="font-semibold text-slate-900">
                  {collectiveCopy(`create.changes.${key}.title` as 'create.changes.services.title')}
                </h4>
                <p>{collectiveCopy(`create.changes.${key}.body` as 'create.changes.services.body', { collective })}</p>
              </section>
            ))}
            <p className="rounded-xl bg-slate-100 px-3 py-2">{collectiveCopy('create.changes.ending', { collective })}</p>
            <label className="flex items-start gap-2 font-medium text-slate-900">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600"
              />
              {collectiveCopy('create.changes.ack', { venue: venueName })}
            </label>
            <Link href="/help" className="text-xs font-semibold text-brand-700 underline">
              {collectiveCopy('create.changes.help')}
            </Link>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {[
                { term: collectiveCopy('create.name.label'), value: collective, to: 1 as Step },
                { term: 'Page address', value: `/book/c/${effectiveSlug}`, to: 1 as Step },
                { term: 'Venues invited', value: venueList, to: 2 as Step },
                { term: 'Your role', value: collectiveCopy('create.check.role'), to: null },
              ].map((row) => (
                <div key={row.term} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <dt className="text-slate-500">{row.term}</dt>
                  <dd className="flex items-center gap-3 font-medium text-slate-900">
                    {row.value}
                    {row.to ? (
                      <button
                        type="button"
                        className="text-xs font-semibold text-brand-700 underline"
                        onClick={() => setStep(row.to!)}
                      >
                        Edit
                        <span className="sr-only"> {row.term}</span>
                      </button>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sky-900">
              {collectiveCopy('create.check.notLive', { collective })}
            </p>
            <details className="rounded-xl border border-slate-200 px-3 py-2">
              <summary className="cursor-pointer font-medium text-slate-900">
                {collectiveCopy('create.check.emailPreview', { venueList })}
              </summary>
              <p className="mt-2">{collectiveCopy('notify.invite.subject', { host: venueName, collective })}</p>
            </details>
          </>
        ) : null}

        {step === 5 ? (
          <>
            <p>{collectiveCopy('create.done.body', { venueList })}</p>
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
                {copied ? 'Copied' : collectiveCopy('create.done.copy')}
              </Button>
            </div>
            <ol className="space-y-2">
              {[
                {
                  label: collectiveCopy('create.next.invitees', { count: invited.length }),
                  body: collectiveCopy('create.next.invitees.body'),
                  href: '/dashboard/collective?tab=venues',
                },
                {
                  label: collectiveCopy('create.next.services'),
                  body: collectiveCopy('create.next.services.body', { collective }),
                  href: '/dashboard/appointment-services',
                },
                {
                  label: collectiveCopy('create.next.design'),
                  body: collectiveCopy('create.next.design.body', { collective }),
                  href: '/dashboard/settings?tab=booking-page',
                },
              ].map((next, index) => (
                <li key={next.href} className="flex gap-3 rounded-xl border border-slate-200 px-3 py-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">
                    {index + 1}
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
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
