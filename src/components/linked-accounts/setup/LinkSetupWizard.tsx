'use client';

/**
 * Link with a venue (Docs/link-and-collective-setup-wizard-plan.md §3.1, decisions L1 to L4).
 *
 * One wizard for a new link and, at full access both ways, the collective with it. Steps: the venue;
 * how closely the two will work together (three plain levels, or the full editor); whether to share
 * one booking page; the collective's name and address and what changes (the Create dialog's own
 * steps, reused); check and send; sent. One call makes the link request and the collective, and one
 * notice reaches the other venue.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { FormField } from '@/components/ui/primitives/FormField';
import { Pill } from '@/components/ui/dashboard/Pill';
import { useToast } from '@/components/ui/Toast';
import { GrantPairEditor } from '@/components/linked-accounts/linked-accounts-ui';
import { VenueSearchField, type VenuePick } from './VenueSearchField';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';
import {
  DEFAULT_LINK_LEVEL,
  LINK_LEVELS,
  grantForLevel,
  isFullAccessBothWays,
  levelForGrants,
  type LinkLevelId,
} from '@/lib/linked-accounts/link-levels';
import { describeGrant, isLinkConfigurationValid, normaliseGrant } from '@/lib/linked-accounts/permissions';
import type { LinkGrant } from '@/lib/linked-accounts/types';

type Step = 'venue' | 'level' | 'collective' | 'name' | 'changes' | 'check' | 'done';
type AddressState = 'idle' | 'checking' | 'free' | 'taken' | 'format';
type ErrorField = 'venue' | 'level' | 'collective' | 'venues' | 'name' | 'slug' | 'plan';

interface SetupError {
  message: string;
  field: ErrorField | null;
}

const STEP_FOR_FIELD: Record<ErrorField, Step | null> = {
  venue: 'venue',
  level: 'level',
  collective: 'collective',
  venues: 'collective',
  name: 'name',
  slug: 'name',
  plan: null,
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

export interface LinkSetupResult {
  venueName: string;
  collective: { id: string; name: string; slug: string } | null;
}

export function LinkSetupWizard({
  venueName,
  venueSlug,
  myCalendars,
  initialSlug,
  onClose,
  onSent,
}: {
  venueName: string;
  /** This venue's own booking address, for the "what changes" table. */
  venueSlug: string | null;
  myCalendars: { id: string; name: string }[];
  initialSlug?: string;
  onClose: () => void;
  onSent: (result: LinkSetupResult) => void;
}) {
  const { addToast } = useToast();
  const [step, setStep] = useState<Step>('venue');
  const [venue, setVenue] = useState<VenuePick | null>(null);
  const [levelId, setLevelId] = useState<LinkLevelId>(DEFAULT_LINK_LEVEL);
  const [customising, setCustomising] = useState(false);
  const [mine, setMine] = useState<LinkGrant>(grantForLevel(DEFAULT_LINK_LEVEL));
  const [theirs, setTheirs] = useState<LinkGrant>(grantForLevel(DEFAULT_LINK_LEVEL));
  const [wantCollective, setWantCollective] = useState<boolean | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [address, setAddress] = useState<AddressState>('idle');
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SetupError | null>(null);
  const [sent, setSent] = useState<LinkSetupResult | null>(null);

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const effectiveSlug = slugTouched ? slug : slugify(name);
  const otherName = venue?.name ?? 'the other venue';

  // The grants the request will carry: a preset both ways, or whatever the editor holds.
  const grants = useMemo(
    () => (customising ? { mine: normaliseGrant(mine), theirs: normaliseGrant(theirs) } : { mine: grantForLevel(levelId), theirs: grantForLevel(levelId) }),
    [customising, mine, theirs, levelId],
  );
  const fullAccess = isFullAccessBothWays(grants.mine, grants.theirs);
  const grantsValid = isLinkConfigurationValid(grants.mine, grants.theirs);
  const collectiveStanding = venue?.collective ?? null;
  const collectiveBlocked = collectiveStanding?.standing === 'blocked';
  const collectivePossible = fullAccess && Boolean(venue) && !collectiveBlocked;

  const steps = useMemo<Step[]>(() => {
    const out: Step[] = ['venue', 'level'];
    if (collectivePossible) out.push('collective');
    if (collectivePossible && wantCollective) out.push('name', 'changes');
    out.push('check');
    return out;
  }, [collectivePossible, wantCollective]);
  const index = Math.max(0, steps.indexOf(step));

  // Address availability, as the Create dialog checks it.
  useEffect(() => {
    if (!effectiveSlug || !wantCollective) return;
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
  }, [effectiveSlug, wantCollective]);

  const addressState: AddressState = effectiveSlug ? address : 'idle';
  const addressMessage =
    addressState === 'checking' || (effectiveSlug && addressState === 'idle')
      ? collectiveCopy('create.address.checking')
      : addressState === 'taken'
        ? collectiveCopy('create.address.taken')
        : addressState === 'format'
          ? collectiveCopy('create.address.format')
          : null;

  const disabledReason: string | null = (() => {
    switch (step) {
      case 'venue':
        return venue?.eligible ? null : collectiveCopy('setup.disabled.venue');
      case 'level':
        return grantsValid ? null : collectiveCopy('setup.disabled.level');
      case 'collective':
        return wantCollective === null ? collectiveCopy('setup.disabled.collective') : null;
      case 'name':
        return name.trim().length < 2
          ? collectiveCopy('create.name.help')
          : addressState !== 'free'
            ? collectiveCopy('create.disabled.address')
            : null;
      case 'changes':
        return acknowledged ? null : collectiveCopy('create.changes.ack', { venue: venueName });
      default:
        return null;
    }
  })();

  const goNext = () => {
    setError(null);
    const next = steps[index + 1];
    if (next) setStep(next);
  };
  const goBack = () => {
    setError(null);
    const prev = steps[index - 1];
    if (prev) setStep(prev);
  };

  const send = async () => {
    if (!venue) return;
    setBusy(true);
    setError(null);
    try {
      const withCollective = collectivePossible && wantCollective === true;
      const res = await fetch('/api/venue/account-links/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetSlug: venue.slug,
          requestMessage: message.trim() || undefined,
          grants,
          ...(withCollective ? { collective: { name: name.trim(), slug: effectiveSlug } } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        field?: ErrorField;
        collective?: { id: string; name: string; slug: string } | null;
      };
      if (!res.ok) {
        setError({ message: data.error ?? 'The request was not sent. Please try again.', field: data.field ?? null });
        return;
      }
      const result: LinkSetupResult = { venueName: venue.name, collective: data.collective ?? null };
      setSent(result);
      setStep('done');
      addToast(`Link request sent to ${venue.name}.`, 'success');
      onSent(result);
    } catch {
      setError({ message: 'The request was not sent. Please check your connection and try again.', field: null });
    } finally {
      setBusy(false);
    }
  };

  const errorStep = error?.field ? STEP_FOR_FIELD[error.field] : null;
  const levelLabel =
    customising && levelForGrants(grants.mine, grants.theirs) === 'custom'
      ? collectiveCopy('setup.level.custom')
      : (LINK_LEVELS.find((l) => l.id === (customising ? levelForGrants(grants.mine, grants.theirs) : levelId))?.title ??
        collectiveCopy('setup.level.custom'));

  const footer =
    step === 'done' ? (
      <div className="flex justify-end">
        <Button type="button" onClick={onClose}>
          {collectiveCopy('setup.done.close')}
        </Button>
      </div>
    ) : (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {index > 0 ? (
            <Button type="button" variant="secondary" onClick={goBack} disabled={busy}>
              Back
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {step === 'check' ? (
            <Button type="button" onClick={() => void send()} disabled={busy} loading={busy}>
              {busy ? collectiveCopy('setup.cta.sending') : collectiveCopy('setup.cta.send')}
            </Button>
          ) : (
            <Button type="button" onClick={goNext} disabled={Boolean(disabledReason)}>
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
      title={step === 'done' && sent ? collectiveCopy('setup.done.title', { venue: sent.venueName }) : collectiveCopy('setup.title')}
      description={step === 'done' ? undefined : collectiveCopy('setup.step', { n: index + 1, total: steps.length })}
      size="lg"
      footer={footer}
    >
      <div className="space-y-4 text-sm text-slate-700">
        {step !== 'done' ? (
          <ol className="grid gap-1" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label="Progress">
            {steps.map((s, n) => (
              <li key={s}>
                {n < index ? (
                  <button
                    type="button"
                    onClick={() => setStep(s)}
                    className="block h-1 w-full rounded-full bg-brand-600"
                    aria-label={`Back to step ${n + 1}`}
                  />
                ) : (
                  <span className={`block h-1 w-full rounded-full ${n === index ? 'bg-brand-600' : 'bg-slate-200'}`}>
                    <span className="sr-only">{n === index ? `Step ${n + 1}, current` : `Step ${n + 1}`}</span>
                  </span>
                )}
              </li>
            ))}
          </ol>
        ) : null}

        {error && (step === 'check' || errorStep === step) ? (
          <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">
            <p>{error.message}</p>
            {step === 'check' && errorStep && errorStep !== 'check' ? (
              <button type="button" className="mt-1 font-semibold underline" onClick={() => setStep(errorStep)}>
                Go back and change it
              </button>
            ) : null}
          </div>
        ) : null}

        {step === 'venue' ? (
          <section className="space-y-3">
            <h3 className="font-semibold text-slate-900">{collectiveCopy('setup.venue.heading')}</h3>
            <p className="text-xs text-slate-600">{collectiveCopy('setup.venue.help')}</p>
            <VenueSearchField
              value={venue}
              onChange={(pick) => {
                setVenue(pick);
                setWantCollective(null);
                setError(null);
              }}
              disabled={busy}
              initialSlug={initialSlug}
            />
          </section>
        ) : null}

        {step === 'level' ? (
          <section className="space-y-3">
            <h3 className="font-semibold text-slate-900">{collectiveCopy('setup.level.heading')}</h3>
            <p className="text-xs text-slate-600">{collectiveCopy('setup.level.help', { venue: otherName })}</p>
            {!customising ? (
              <div role="radiogroup" aria-label={collectiveCopy('setup.level.heading')} className="space-y-2">
                {LINK_LEVELS.map((level) => {
                  const selected = level.id === levelId;
                  return (
                    <label
                      key={level.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 ${
                        selected ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="link-level"
                        className="mt-1"
                        checked={selected}
                        onChange={() => {
                          setLevelId(level.id);
                          setError(null);
                        }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-900">{level.title}</span>
                          <Pill variant="neutral" size="sm">
                            {collectiveCopy('setup.level.mutual')}
                          </Pill>
                          {level.unlocksCollective ? (
                            <Pill variant="brand" size="sm">
                              Collective ready
                            </Pill>
                          ) : null}
                        </span>
                        <span className="block text-xs text-slate-600">{level.summary}</span>
                        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate-600">
                          {level.bullets.map((b) => (
                            <li key={b}>{b}</li>
                          ))}
                        </ul>
                      </span>
                    </label>
                  );
                })}
                <button
                  type="button"
                  className="text-xs font-semibold text-brand-700 underline"
                  onClick={() => {
                    setMine(grantForLevel(levelId));
                    setTheirs(grantForLevel(levelId));
                    setCustomising(true);
                  }}
                >
                  {collectiveCopy('setup.level.customise')}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <GrantPairEditor
                  otherVenueName={otherName}
                  mine={mine}
                  theirs={theirs}
                  onChangeMine={setMine}
                  onChangeTheirs={setTheirs}
                  disabled={busy}
                  myCalendars={myCalendars}
                />
                {!fullAccess ? <p className="text-xs text-amber-800">{collectiveCopy('setup.level.customNote')}</p> : null}
                <button
                  type="button"
                  className="text-xs font-semibold text-brand-700 underline"
                  onClick={() => setCustomising(false)}
                >
                  Back to the three levels
                </button>
              </div>
            )}
            {disabledReason ? <p className="text-xs text-slate-500">{disabledReason}</p> : null}
          </section>
        ) : null}

        {step === 'collective' ? (
          <section className="space-y-3">
            <h3 className="font-semibold text-slate-900">{collectiveCopy('setup.collective.heading')}</h3>
            <p>{collectiveCopy('setup.collective.intro')}</p>
            <section className="rounded-xl bg-brand-50 px-4 py-3">
              <h4 className="font-semibold text-slate-900">{collectiveCopy('create.what.title')}</h4>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>{collectiveCopy('create.what.1')}</li>
                <li>{collectiveCopy('create.what.2')}</li>
                <li>{collectiveCopy('create.what.3')}</li>
              </ul>
            </section>
            {collectiveStanding?.standing === 'no_payments' && collectiveStanding.reason ? (
              <p className="text-xs text-amber-800">{collectiveStanding.reason}</p>
            ) : null}
            <div role="radiogroup" aria-label={collectiveCopy('setup.collective.heading')} className="space-y-2">
              {(
                [
                  { value: false, title: collectiveCopy('setup.collective.no'), body: collectiveCopy('setup.collective.no.body') },
                  {
                    value: true,
                    title: collectiveCopy('setup.collective.yes'),
                    body: collectiveCopy('setup.collective.yes.body', { venue: otherName }),
                  },
                ] as const
              ).map((option) => {
                const selected = wantCollective === option.value;
                return (
                  <label
                    key={String(option.value)}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 ${
                      selected ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="want-collective"
                      className="mt-1"
                      checked={selected}
                      onChange={() => {
                        setWantCollective(option.value);
                        setError(null);
                      }}
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">{option.title}</span>
                      <span className="block text-xs text-slate-600">{option.body}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {disabledReason ? <p className="text-xs text-slate-500">{disabledReason}</p> : null}
          </section>
        ) : null}

        {step === 'name' ? (
          <section className="space-y-3">
            <p className="font-medium text-slate-900">{collectiveCopy('create.what.host', { venue: venueName })}</p>
            <FormField label={collectiveCopy('create.name.label')} htmlFor="setup-collective-name" description={collectiveCopy('create.name.help')}>
              <input
                id="setup-collective-name"
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
            <FormField label="Page address" htmlFor="setup-collective-address" error={addressMessage}>
              <div className="flex min-h-[44px] items-center rounded-lg border border-slate-200 bg-white pl-3 focus-within:border-brand-500">
                <span className="shrink-0 font-mono text-slate-500">/book/c/</span>
                <input
                  id="setup-collective-address"
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
            {addressState === 'free' ? <p className="text-xs text-emerald-700">{collectiveCopy('create.address.free')}</p> : null}
            {disabledReason ? <p className="text-xs text-slate-500">{disabledReason}</p> : null}
          </section>
        ) : null}

        {step === 'changes' ? (
          <section className="space-y-3">
            <h3 className="font-semibold text-slate-900">{collectiveCopy('create.changes.title', { collective: name.trim() || 'your collective' })}</h3>
            <p>{collectiveCopy('create.changes.intro')}</p>
            <ul className="space-y-1 rounded-xl border border-slate-200 p-3">
              {[
                { name: venueName, slug: venueSlug },
                { name: otherName, slug: venue?.slug ?? null },
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
              {collectiveCopy('create.changes.address.note', { collective: name.trim() })} {collectiveCopy('create.changes.address.when')}
            </p>
            {(['services', 'owns', 'clients'] as const).map((key) => (
              <section key={key} className="rounded-xl border border-slate-200 px-3 py-2">
                <h4 className="font-semibold text-slate-900">
                  {collectiveCopy(`create.changes.${key}.title` as 'create.changes.services.title')}
                </h4>
                <p>
                  {key === 'clients'
                    ? // The Create dialog's sentence assumes an accepted link; here the link is what is being sent.
                      collectiveCopy('setup.changes.clients.body', { collective: name.trim() })
                    : collectiveCopy(`create.changes.${key}.body` as 'create.changes.services.body', { collective: name.trim() })}
                </p>
              </section>
            ))}
            <p className="rounded-xl bg-slate-100 px-3 py-2">{collectiveCopy('create.changes.ending', { collective: name.trim() })}</p>
            <label className="flex items-start gap-2 font-medium text-slate-900">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600"
              />
              {collectiveCopy('create.changes.ack', { venue: venueName })}
            </label>
          </section>
        ) : null}

        {step === 'check' ? (
          <section className="space-y-3">
            <h3 className="font-semibold text-slate-900">{collectiveCopy('setup.check.heading')}</h3>
            <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {[
                { term: collectiveCopy('setup.check.venue'), value: otherName, to: 'venue' as Step },
                { term: collectiveCopy('setup.check.level'), value: levelLabel, to: 'level' as Step },
                ...(collectivePossible
                  ? [
                      {
                        term: collectiveCopy('setup.check.collective'),
                        value: wantCollective
                          ? collectiveCopy('setup.check.collective.value', { collective: name.trim(), slug: effectiveSlug })
                          : collectiveCopy('setup.check.collective.none'),
                        to: 'collective' as Step,
                      },
                    ]
                  : []),
              ].map((row) => (
                <div key={row.term} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <dt className="text-slate-500">{row.term}</dt>
                  <dd className="flex items-center gap-3 font-medium text-slate-900">
                    {row.value}
                    <button type="button" className="text-xs font-semibold text-brand-700 underline" onClick={() => setStep(row.to)}>
                      Edit
                      <span className="sr-only"> {row.term}</span>
                    </button>
                  </dd>
                </div>
              ))}
            </dl>
            <label className="block">
              <span className="block text-sm font-medium text-slate-700">{collectiveCopy('setup.note.label', { venue: otherName })}</span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
                maxLength={1000}
                disabled={busy}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                placeholder={collectiveCopy('setup.note.placeholder')}
              />
            </label>
            <details className="rounded-xl border border-slate-200 px-3 py-2">
              <summary className="cursor-pointer font-medium text-slate-900">
                {collectiveCopy('setup.check.whatTheyRead', { venue: otherName })}
              </summary>
              <div className="mt-2 space-y-2 text-xs">
                <p>
                  <span className="font-semibold">{collectiveCopy('setup.check.theyCan', { venue: venueName })}</span>{' '}
                  {describeGrant(grants.theirs).join(', ')}.
                </p>
                <p>
                  <span className="font-semibold">{collectiveCopy('setup.check.youCan')}</span> {describeGrant(grants.mine).join(', ')}.
                </p>
                {collectivePossible && wantCollective ? (
                  <p>{collectiveCopy('notify.invite.subject', { host: venueName, collective: name.trim() })}</p>
                ) : null}
              </div>
            </details>
          </section>
        ) : null}

        {step === 'done' && sent ? (
          <section className="space-y-3">
            <p>{collectiveCopy('setup.done.body')}</p>
            <ol className="space-y-2">
              {[
                sent.collective
                  ? collectiveCopy('setup.done.next.collective', { venue: sent.venueName, collective: sent.collective.name })
                  : collectiveCopy('setup.done.next.link', { venue: sent.venueName }),
                collectiveCopy('setup.done.next.where'),
              ].map((line, i) => (
                <li key={line} className="flex gap-3 rounded-xl border border-slate-200 px-3 py-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">
                    {i + 1}
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}
