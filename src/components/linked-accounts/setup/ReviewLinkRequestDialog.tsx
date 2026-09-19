'use client';

/**
 * Reviewing a link request, and the collective invitation that rides on it
 * (Docs/link-and-collective-setup-wizard-plan.md §3.2, decisions L4 to L6).
 *
 * One dialog covers both consents. First what the other venue is asking, with the permissions
 * editor behind "Adjust". Then, when a collective is proposed and the link will grant full access
 * both ways, the Join dialog's own steps in its own words. The last step has one consent line and
 * three ways out: decline, accept the link only, accept and join.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { ConfirmDialog } from '@/components/ui/primitives/ConfirmDialog';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { useToast } from '@/components/ui/Toast';
import { GrantPairEditor } from '@/components/linked-accounts/linked-accounts-ui';
import {
  JoinFormsStep,
  JoinMeansStep,
  JoinServicesStep,
  JoinSummaryList,
  defaultJoinDraft,
  joinChoicesFrom,
  joinStepsFor,
  type JoinDraft,
  type JoinStep,
} from '@/components/linked-accounts/collective/JoinCollectiveDialog';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';
import { isFullAccessBothWays } from '@/lib/linked-accounts/link-levels';
import { describeGrant, isLinkConfigurationValid, normaliseGrant } from '@/lib/linked-accounts/permissions';
import type { AccountLinkView, LinkGrant } from '@/lib/linked-accounts/types';
import type { JoinPreview } from '@/lib/linked-accounts/replicas/join';

export interface ProposedCollectiveSummary {
  id: string;
  name: string;
  slug: string;
  serviceModel: string;
}

export interface ReviewOutcome {
  declined: boolean;
  joined: boolean;
  collectiveName: string | null;
  /** Why the join did not finish, when the link was accepted but the collective was not joined. */
  joinError?: string;
}

type Step = 'request' | JoinStep;

export function ReviewLinkRequestDialog({
  link,
  venueName,
  myCalendars,
  collective,
  onClose,
  onDone,
}: {
  link: AccountLinkView;
  venueName: string;
  myCalendars: { id: string; name: string }[];
  /** The invitation that rides on this request, or null for a plain link request. */
  collective: ProposedCollectiveSummary | null;
  onClose: () => void;
  onDone: (outcome: ReviewOutcome) => void;
}) {
  const { addToast } = useToast();
  const other = link.otherVenue.name;
  const [step, setStep] = useState<Step>('request');
  const [editing, setEditing] = useState(false);
  // mine = what my venue grants the other; theirs = what I get from them (as the request offers).
  const [mine, setMine] = useState<LinkGrant>(link.theyCan);
  const [theirs, setTheirs] = useState<LinkGrant>(link.iCan);
  const [preview, setPreview] = useState<JoinPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [draft, setDraft] = useState<JoinDraft>({ sameName: {}, optionMap: {}, own: {}, forms: {} });
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDecline, setConfirmDecline] = useState(false);

  const proposesJoin = Boolean(collective && collective.serviceModel === 'replicas');

  useEffect(() => {
    if (!collective || !proposesJoin) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/venue/collectives/${collective.id}/join?with_pending_link=1`);
        const data = (await res.json().catch(() => ({}))) as JoinPreview & { error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setPreviewError(data.error ?? 'Could not load the invitation.');
          return;
        }
        setPreview(data);
        setDraft(defaultJoinDraft(data));
      } catch {
        if (!cancelled) setPreviewError('Could not load the invitation. Please check your connection.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [collective, proposesJoin]);

  // The link as it will stand after this accept: my side as I set it, the requester's as offered.
  const myFinal = editing ? normaliseGrant(mine) : normaliseGrant(link.theyCan);
  const grantsValid = !editing || isLinkConfigurationValid(normaliseGrant(mine), normaliseGrant(theirs));
  const fullAccessAfter = isFullAccessBothWays(myFinal, normaliseGrant(link.iCan));
  const joinable = proposesJoin && Boolean(preview) && !preview?.blocked && fullAccessAfter;

  const steps = useMemo<Step[]>(() => (joinable && preview ? ['request', ...joinStepsFor(preview)] : ['request', 'check']), [joinable, preview]);
  const index = Math.max(0, steps.indexOf(step));
  const host = preview?.host_name ?? other;
  const collectiveName = collective?.name ?? preview?.collective_name ?? 'the collective';

  const respond = async (join: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        action: editing ? 'accept_with_changes' : 'accept',
        ...(editing ? { grants: { mine, theirs } } : {}),
      };
      if (join && collective && preview) {
        body.collective = { collective_id: collective.id, consent_version: preview.consent_version, ...joinChoicesFrom(preview, draft) };
      }
      const res = await fetch(`/api/venue/account-links/${link.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        collective?: { joined: boolean; name: string; error?: string } | null;
      };
      if (!res.ok) {
        setError(data.error ?? 'Could not respond. Please try again.');
        return;
      }
      const outcome: ReviewOutcome = {
        declined: false,
        joined: Boolean(data.collective?.joined),
        collectiveName: data.collective?.name ?? null,
        joinError: data.collective && !data.collective.joined ? data.collective.error : undefined,
      };
      addToast(
        outcome.joined
          ? collectiveCopy('respond.done.joined', { venue: other, collective: outcome.collectiveName ?? collectiveName })
          : collectiveCopy('respond.done.linked', { venue: other }),
        'success',
      );
      onDone(outcome);
    } catch {
      setError('Could not respond. Please check your connection.');
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    setConfirmDecline(false);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/venue/account-links/${link.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject' }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? 'Could not decline. Please try again.');
        return;
      }
      addToast(`Declined ${other}'s request.`, 'success');
      onDone({ declined: true, joined: false, collectiveName: collective?.name ?? null });
    } catch {
      setError('Could not decline. Please check your connection.');
    } finally {
      setBusy(false);
    }
  };

  const next = steps[index + 1];
  const prev = steps[index - 1];
  const onCheck = step === 'check';

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-2">
        {prev ? (
          <Button type="button" variant="secondary" onClick={() => setStep(prev)} disabled={busy}>
            {collectiveCopy('respond.cta.back')}
          </Button>
        ) : null}
        <Button type="button" variant="danger" onClick={() => setConfirmDecline(true)} disabled={busy}>
          {collectiveCopy('respond.cta.decline')}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {onCheck && joinable ? (
          <Button type="button" variant="secondary" onClick={() => void respond(false)} disabled={busy || !grantsValid}>
            {collectiveCopy('respond.collective.linkOnly')}
          </Button>
        ) : null}
        {onCheck ? (
          <Button
            type="button"
            onClick={() => void respond(joinable)}
            disabled={busy || !grantsValid || (joinable && !agreed)}
            loading={busy}
          >
            {busy
              ? collectiveCopy('respond.cta.accepting')
              : joinable
                ? collectiveCopy('respond.cta.acceptJoin', { collective: collectiveName })
                : collectiveCopy('respond.cta.accept')}
          </Button>
        ) : (
          <Button type="button" onClick={() => next && setStep(next)} disabled={busy || !grantsValid || (proposesJoin && !preview && !previewError)}>
            {collectiveCopy('respond.cta.next')}
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !busy) onClose();
        }}
        title={
          proposesJoin && collective
            ? collectiveCopy('respond.titleWithCollective', { venue: other, collective: collective.name })
            : collectiveCopy('respond.title', { venue: other })
        }
        description={collectiveCopy('respond.step', { n: index + 1, total: steps.length })}
        size="lg"
        footer={footer}
      >
        <div className="space-y-4 text-sm text-slate-700">
          {error ? (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">
              {error}
            </p>
          ) : null}

          {step === 'request' ? (
            <section className="space-y-3">
              <h3 className="font-semibold text-slate-900">{collectiveCopy('respond.request.heading', { venue: other })}</h3>
              {link.requestMessage ? (
                <p className="rounded-lg bg-slate-50 px-3 py-2 italic text-slate-700">&ldquo;{link.requestMessage}&rdquo;</p>
              ) : null}
              {editing ? (
                <div className="space-y-2">
                  <GrantPairEditor
                    otherVenueName={other}
                    mine={mine}
                    theirs={theirs}
                    onChangeMine={setMine}
                    onChangeTheirs={setTheirs}
                    disabled={busy}
                    myCalendars={myCalendars}
                  />
                  <p className="text-xs text-slate-500">{collectiveCopy('respond.request.adjust.note', { venue: other })}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p>
                    <span className="font-semibold">{collectiveCopy('respond.request.theyCan', { venue: other })}</span>{' '}
                    {describeGrant(link.theyCan).join(', ')}.
                  </p>
                  <p>
                    <span className="font-semibold">{collectiveCopy('respond.request.youCan')}</span> {describeGrant(link.iCan).join(', ')}.
                  </p>
                  <button type="button" className="text-xs font-semibold text-brand-700 underline" onClick={() => setEditing(true)}>
                    {collectiveCopy('respond.request.adjust')}
                  </button>
                </div>
              )}
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">{collectiveCopy('respond.request.dpa')}</p>
              {proposesJoin && collective ? (
                <section className="rounded-xl bg-brand-50 px-4 py-3">
                  <h4 className="font-semibold text-slate-900">{collectiveCopy('respond.collective.heading')}</h4>
                  <p className="mt-1">{collectiveCopy('respond.collective.intro', { venue: other, collective: collective.name, me: venueName })}</p>
                  {previewError ? (
                    <p role="alert" className="mt-2 text-rose-700">
                      {previewError}
                    </p>
                  ) : preview?.blocked ? (
                    <p role="alert" className="mt-2 text-amber-800">
                      {preview.blocked}
                    </p>
                  ) : !fullAccessAfter ? (
                    <p className="mt-2 text-amber-800">{collectiveCopy('respond.collective.needsFull', { collective: collective.name })}</p>
                  ) : !preview ? (
                    <p role="status" className="mt-2 text-slate-600">
                      {collectiveCopy('join.loading')}
                    </p>
                  ) : null}
                </section>
              ) : null}
            </section>
          ) : null}

          {step === 'means' && preview ? <JoinMeansStep preview={preview} host={host} collective={collectiveName} /> : null}
          {step === 'services' && preview ? (
            <JoinServicesStep preview={preview} draft={draft} onChange={setDraft} host={host} collective={collectiveName} />
          ) : null}
          {step === 'forms' && preview ? <JoinFormsStep preview={preview} draft={draft} onChange={setDraft} host={host} /> : null}

          {step === 'check' ? (
            <section className="space-y-3">
              <h3 className="font-semibold text-slate-900">{collectiveCopy('respond.check.heading')}</h3>
              <p>{collectiveCopy('respond.check.link', { venue: other })}</p>
              <p>
                <span className="font-semibold">{collectiveCopy('respond.request.theyCan', { venue: other })}</span>{' '}
                {describeGrant(myFinal).join(', ')}.
              </p>
              {joinable && preview ? (
                <>
                  <JoinSummaryList preview={preview} draft={draft} host={host} collective={collectiveName} />
                  <label className="flex items-start gap-2 font-medium text-slate-900">
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                    />
                    {collectiveCopy('respond.consent', { venue: other, collective: collectiveName, me: venueName })}
                  </label>
                  <p className="text-xs text-slate-500">{collectiveCopy('respond.collective.linkOnly.note', { collective: collectiveName })}</p>
                </>
              ) : (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">{collectiveCopy('respond.request.dpa')}</p>
              )}
            </section>
          ) : null}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmDecline}
        onOpenChange={setConfirmDecline}
        title={collectiveCopy('respond.decline.title', { venue: other })}
        message={
          collective
            ? collectiveCopy('respond.decline.bodyWithCollective', { venue: other, collective: collective.name })
            : collectiveCopy('respond.decline.body', { venue: other })
        }
        confirmLabel={collectiveCopy('respond.decline.confirm')}
        onConfirm={() => void decline()}
        destructive
      />
    </>
  );
}
