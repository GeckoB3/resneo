'use client';

/**
 * Joining a collective on the shared-services model (UX spec §2 item 6 and `join.*`; plan
 * contract 6; W7).
 *
 * Four steps, because joining changes who controls a venue's services and where its guests land,
 * and a single Accept button hid all of that:
 *   1. What joining means, including what happens to the venue's own page and services.
 *   2. Its services: one that shares a name with a service on the page can be used for it (keeping
 *      its calendars and bookings), or the host's added as new; its other services are parked, or
 *      the host is asked to add them.
 *   3. Its forms: one that shares a name with a form the page asks for can be used, so records
 *      clients already gave still count.
 *   4. A summary of what will happen, and the consent.
 *
 * The preview comes from the join route, which uses the engine's own rule for "the same name".
 *
 * The step bodies are exported, because the review of a link request that carries an invitation
 * (`ReviewLinkRequestDialog`, Docs/link-and-collective-setup-wizard-plan.md L4) asks the same
 * questions in the same words.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';
import type { JoinChoices, JoinPreview } from '@/lib/linked-accounts/replicas/join';

export interface JoinCollectiveDialogProps {
  open: boolean;
  onClose: () => void;
  collectiveId: string;
  venueName: string;
  onJoined: () => void;
}

export type JoinStep = 'means' | 'services' | 'forms' | 'check';

/** The venue's answers while it decides; `joinChoicesFrom` turns them into the route's body. */
export interface JoinDraft {
  sameName: Record<string, 'use_mine' | 'add_new'>;
  optionMap: Record<string, string | null>;
  own: Record<string, 'ask' | 'park'>;
  forms: Record<string, 'use_existing' | 'use_theirs'>;
}

/** Defaults: use the venue's own same-name service, match options by name, park the rest, keep its forms. */
export function defaultJoinDraft(preview: JoinPreview): JoinDraft {
  const optionMap: Record<string, string | null> = {};
  for (const pair of preview.same_name) {
    for (const mine of pair.my_options) {
      optionMap[mine.id] = pair.host_options.find((h) => h.name.trim().toLowerCase() === mine.name.trim().toLowerCase())?.id ?? null;
    }
  }
  return {
    sameName: Object.fromEntries(preview.same_name.map((s) => [s.item_id, 'use_mine'])),
    optionMap,
    own: Object.fromEntries(preview.own_services.map((s) => [s.id, 'park'])),
    forms: Object.fromEntries(preview.forms.map((f) => [f.host_type_id, 'use_existing'])),
  };
}

export function joinChoicesFrom(preview: JoinPreview, draft: JoinDraft): JoinChoices {
  return {
    same_name_choices: preview.same_name.map((pair) =>
      draft.sameName[pair.item_id] === 'use_mine'
        ? {
            item_id: pair.item_id,
            choice: 'use_mine',
            my_service_id: pair.my_service_id,
            option_map: pair.my_options.map((o) => ({ my_variant_id: o.id, host_variant_id: draft.optionMap[o.id] ?? null })),
          }
        : { item_id: pair.item_id, choice: 'add_new' },
    ),
    own_service_choices: Object.entries(draft.own).map(([service_id, choice]) => ({ service_id, choice })),
    form_choices: preview.forms.map((f) =>
      draft.forms[f.host_type_id] === 'use_existing'
        ? { host_type_id: f.host_type_id, choice: 'use_existing', my_type_id: f.my_type_id }
        : { host_type_id: f.host_type_id, choice: 'use_theirs' },
    ),
  };
}

/** The steps a preview needs: forms only when the venue holds a matching one. */
export function joinStepsFor(preview: JoinPreview): JoinStep[] {
  return preview.forms.length > 0 ? ['means', 'services', 'forms', 'check'] : ['means', 'services', 'check'];
}

export function JoinMeansStep({ preview, host, collective }: { preview: JoinPreview; host: string; collective: string }) {
  return (
    <section className="space-y-2">
      <h3 className="font-semibold text-slate-900">{collectiveCopy('join.step.means')}</h3>
      <ul className="list-disc space-y-1 pl-5">
        {(['1', '2', '3', '4', '5', '6', '7'] as const).map((n) => (
          <li key={n}>{collectiveCopy(`join.means.${n}` as 'join.means.1', { host, collective })}</li>
        ))}
      </ul>
      {preview.other_models ? (
        <p className="text-amber-800">{collectiveCopy('bm.join.otherModels', { modelList: preview.other_models, collective })}</p>
      ) : null}
      {preview.warnings.no_stripe_paid_services > 0 ? (
        <p className="text-amber-800">{collectiveCopy('join.warn.noStripe', { count: preview.warnings.no_stripe_paid_services })}</p>
      ) : null}
      {preview.warnings.form_services > 0 && preview.warnings.forms_off ? (
        <p className="text-amber-800">{collectiveCopy('join.warn.formsOn', { collective })}</p>
      ) : null}
    </section>
  );
}

export function JoinServicesStep({
  preview,
  draft,
  onChange,
  host,
  collective,
}: {
  preview: JoinPreview;
  draft: JoinDraft;
  onChange: (next: JoinDraft) => void;
  host: string;
  collective: string;
}) {
  return (
    <section className="space-y-4">
      <h3 className="font-semibold text-slate-900">{collectiveCopy('join.step.services')}</h3>
      {preview.same_name.length > 0 ? (
        <div className="space-y-2">
          <h4 className="font-medium text-slate-900">{collectiveCopy('join.services.sameName.heading')}</h4>
          <p className="text-xs text-slate-600">{collectiveCopy('join.services.sameName.help', { host })}</p>
          {preview.same_name.map((pair) => (
            <fieldset key={pair.item_id} className="rounded-lg border border-slate-200 p-3">
              <legend className="px-1 font-medium text-slate-900">{pair.name}</legend>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`same-${pair.item_id}`}
                  checked={draft.sameName[pair.item_id] === 'use_mine'}
                  onChange={() => onChange({ ...draft, sameName: { ...draft.sameName, [pair.item_id]: 'use_mine' } })}
                />
                {collectiveCopy('join.services.useMine', { service: pair.name })}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`same-${pair.item_id}`}
                  checked={draft.sameName[pair.item_id] === 'add_new'}
                  onChange={() => onChange({ ...draft, sameName: { ...draft.sameName, [pair.item_id]: 'add_new' } })}
                />
                {collectiveCopy('join.services.addNew', { host })}
              </label>
              {draft.sameName[pair.item_id] === 'use_mine' ? (
                <div className="mt-2 space-y-2">
                  <p className="text-xs text-slate-600">{collectiveCopy('join.services.useMine.note', { service: pair.name, host })}</p>
                  {pair.my_options.length > 0 ? (
                    <table className="w-full text-xs">
                      <caption className="text-left font-medium text-slate-800">{collectiveCopy('join.map.heading')}</caption>
                      <thead>
                        <tr className="text-left text-slate-500">
                          <th className="py-1 font-medium">{collectiveCopy('join.map.yours')}</th>
                          <th className="py-1 font-medium">{collectiveCopy('join.map.theirs', { host })}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pair.my_options.map((mine) => (
                          <tr key={mine.id}>
                            <td className="py-1">{mine.name}</td>
                            <td className="py-1">
                              <select
                                aria-label={`${collectiveCopy('join.map.theirs', { host })} for ${mine.name}`}
                                value={draft.optionMap[mine.id] ?? ''}
                                onChange={(e) =>
                                  onChange({ ...draft, optionMap: { ...draft.optionMap, [mine.id]: e.target.value || null } })
                                }
                                className="rounded border border-slate-200 px-1 py-0.5"
                              >
                                <option value="">{collectiveCopy('join.map.keepOld')}</option>
                                {pair.host_options.map((h) => (
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
                </div>
              ) : null}
            </fieldset>
          ))}
        </div>
      ) : null}

      <div className="space-y-2">
        <h4 className="font-medium text-slate-900">{collectiveCopy('join.services.own.heading')}</h4>
        <p className="text-xs text-slate-600">{collectiveCopy('join.services.own.help', { host, collective })}</p>
        {preview.own_services.length === 0 ? (
          <p className="text-slate-500">{collectiveCopy('join.services.none')}</p>
        ) : (
          preview.own_services.map((service) => (
            <div key={service.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1">
              <span className="text-slate-900">{service.name}</span>
              <select
                aria-label={`What happens to ${service.name}`}
                value={draft.own[service.id] ?? 'park'}
                onChange={(e) => onChange({ ...draft, own: { ...draft.own, [service.id]: e.target.value as 'ask' | 'park' } })}
                className="rounded border border-slate-200 px-1 py-0.5 text-xs"
              >
                <option value="park">{collectiveCopy('join.services.park')}</option>
                <option value="ask">{collectiveCopy('join.services.ask', { host, collective })}</option>
              </select>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export function JoinFormsStep({
  preview,
  draft,
  onChange,
  host,
}: {
  preview: JoinPreview;
  draft: JoinDraft;
  onChange: (next: JoinDraft) => void;
  host: string;
}) {
  return (
    <section className="space-y-2">
      <h3 className="font-semibold text-slate-900">{collectiveCopy('join.step.forms')}</h3>
      <p className="text-xs text-slate-600">{collectiveCopy('join.forms.note', { host })}</p>
      {preview.forms.map((form) => (
        <fieldset key={form.host_type_id} className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 font-medium text-slate-900">{form.name}</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`form-${form.host_type_id}`}
              checked={draft.forms[form.host_type_id] === 'use_existing'}
              onChange={() => onChange({ ...draft, forms: { ...draft.forms, [form.host_type_id]: 'use_existing' } })}
            />
            {collectiveCopy('join.forms.useExisting', { form: form.name })}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`form-${form.host_type_id}`}
              checked={draft.forms[form.host_type_id] === 'use_theirs'}
              onChange={() => onChange({ ...draft, forms: { ...draft.forms, [form.host_type_id]: 'use_theirs' } })}
            />
            {collectiveCopy('join.forms.useTheirs', { host })}
          </label>
        </fieldset>
      ))}
    </section>
  );
}

/** The summary lines on the check step: how many services are set up, used, parked and asked for. */
export function JoinSummaryList({
  preview,
  draft,
  host,
  collective,
}: {
  preview: JoinPreview;
  draft: JoinDraft;
  host: string;
  collective: string;
}) {
  const useMine = Object.values(draft.sameName).filter((c) => c === 'use_mine').length;
  const park = Object.values(draft.own).filter((c) => c === 'park').length;
  const ask = Object.values(draft.own).filter((c) => c === 'ask').length;
  return (
    <ul className="list-disc space-y-1 pl-5">
      <li>{collectiveCopy('join.summary.setup', { count: preview.services_to_set_up, host })}</li>
      {useMine > 0 ? <li>{collectiveCopy('join.summary.useMine', { count: useMine, host })}</li> : null}
      {park > 0 ? <li>{collectiveCopy('join.summary.park', { count: park, collective })}</li> : null}
      {ask > 0 ? <li>{collectiveCopy('join.summary.ask', { count: ask, host })}</li> : null}
    </ul>
  );
}

export function JoinCollectiveDialog({ open, onClose, collectiveId, venueName, onJoined }: JoinCollectiveDialogProps) {
  const [preview, setPreview] = useState<JoinPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<JoinStep>('means');
  const [draft, setDraft] = useState<JoinDraft>({ sameName: {}, optionMap: {}, own: {}, forms: {} });
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPreview(null);
    setLoadError(null);
    setStep('means');
    setAgreed(false);
    void (async () => {
      try {
        const res = await fetch(`/api/venue/collectives/${collectiveId}/join`);
        const data = (await res.json().catch(() => ({}))) as JoinPreview & { error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(data.error ?? 'Could not load the invitation.');
          return;
        }
        setPreview(data);
        setDraft(defaultJoinDraft(data));
      } catch {
        if (!cancelled) setLoadError('Could not load the invitation. Please check your connection.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, collectiveId]);

  const steps: JoinStep[] = useMemo(() => (preview ? joinStepsFor(preview) : ['means', 'services', 'check']), [preview]);
  const index = steps.indexOf(step);
  const host = preview?.host_name ?? 'The host';
  const collective = preview?.collective_name ?? 'the collective';

  const join = async () => {
    if (!preview) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/venue/collectives/${collectiveId}/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept', consent_version: preview.consent_version, ...joinChoicesFrom(preview, draft) }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? 'Could not join. Please try again.');
        return;
      }
      onJoined();
    } catch {
      setError('Could not join. Please check your connection.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
      title={collectiveCopy('join.title', { collective })}
      description={preview ? collectiveCopy('join.step', { n: index + 1, total: steps.length }) : undefined}
      size="lg"
      footer={
        preview && !preview.blocked ? (
          <div className="flex flex-wrap gap-2">
            {index > 0 ? (
              <Button type="button" variant="secondary" onClick={() => setStep(steps[index - 1]!)} disabled={saving}>
                {collectiveCopy('join.back')}
              </Button>
            ) : null}
            {step === 'check' ? (
              <Button type="button" onClick={() => void join()} disabled={!agreed || saving} loading={saving}>
                {collectiveCopy('join.confirm', { collective })}
              </Button>
            ) : (
              <Button type="button" onClick={() => setStep(steps[index + 1]!)}>
                {collectiveCopy('join.next')}
              </Button>
            )}
          </div>
        ) : (
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      {loadError ? (
        <p role="alert" className="text-sm text-rose-700">
          {loadError}
        </p>
      ) : !preview ? (
        <p role="status" className="text-sm text-slate-600">
          {collectiveCopy('join.loading')}
        </p>
      ) : preview.blocked ? (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {preview.blocked}
        </p>
      ) : (
        <div className="space-y-4 text-sm text-slate-700">
          {error ? (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">
              {error}
            </p>
          ) : null}

          {step === 'means' ? <JoinMeansStep preview={preview} host={host} collective={collective} /> : null}
          {step === 'services' ? (
            <JoinServicesStep preview={preview} draft={draft} onChange={setDraft} host={host} collective={collective} />
          ) : null}
          {step === 'forms' ? <JoinFormsStep preview={preview} draft={draft} onChange={setDraft} host={host} /> : null}
          {step === 'check' ? (
            <section className="space-y-2">
              <h3 className="font-semibold text-slate-900">{collectiveCopy('join.step.check')}</h3>
              <JoinSummaryList preview={preview} draft={draft} host={host} collective={collective} />
              <label className="flex items-start gap-2 font-medium text-slate-900">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                />
                {collectiveCopy('join.consent', { venue: venueName, collective, host })}
              </label>
            </section>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
