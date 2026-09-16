'use client';

/**
 * Moving the hosting of a collective, and ending it (UX spec `transfer.*` and `dissolve.*`; plan
 * contract 8; W7).
 *
 *   HostingRequestBanner   the venue that was asked sees the request and answers it;
 *   PausedHostingBanner    any venue in a paused collective can take over hosting;
 *   HostingConsentDialog   what hosting involves, and the box that says the venue agrees;
 *   EndCollectiveSection   the host ends the collective, typing its name to confirm.
 *
 * Every call goes to the members route (or the collective route for ending it); the engine decides.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';
import { HOST_TRANSFER_CONSENT_VERSION } from '@/lib/linked-accounts/replicas/hosting-constants';

type Answer = { ok: true } | { ok: false; error: string };

export async function hostingAction(collectiveId: string, body: Record<string, unknown>): Promise<Answer> {
  try {
    const res = await fetch(`/api/venue/collectives/${collectiveId}/members`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error ?? 'That did not go through. Please try again.' };
  } catch {
    return { ok: false, error: 'That did not go through. Please check your connection.' };
  }
}

export function HostingConsentDialog({
  open,
  onClose,
  collectiveName,
  hostName,
  onAccept,
  busy = false,
  error = null,
}: {
  open: boolean;
  onClose: () => void;
  collectiveName: string;
  hostName: string;
  onAccept: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const [agreed, setAgreed] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title={collectiveCopy('transfer.accept.title', { collective: collectiveName })}
      size="md"
      footer={
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={onAccept} disabled={!agreed || busy} loading={busy}>
            {collectiveCopy('transfer.accept.confirm')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Go back
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
        <ul className="list-disc space-y-1 pl-5">
          <li>{collectiveCopy('transfer.accept.1')}</li>
          <li>{collectiveCopy('transfer.accept.2', { host: hostName })}</li>
          <li>{collectiveCopy('transfer.accept.3', { collective: collectiveName })}</li>
          <li>{collectiveCopy('transfer.accept.4')}</li>
        </ul>
        <label className="flex items-start gap-2 font-medium text-slate-900">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
          />
          {collectiveCopy('transfer.accept.consent', { collective: collectiveName })}
        </label>
      </div>
    </Dialog>
  );
}

/** The venue that was asked to host: accept (with consent) or say no. */
export function HostingRequestBanner({
  collectiveId,
  collectiveName,
  hostName,
  onChanged,
}: {
  collectiveId: string;
  collectiveName: string;
  hostName: string;
  onChanged: () => void;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answer = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const result = await hostingAction(collectiveId, body);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setReviewing(false);
    onChanged();
  };

  return (
    <section className="rounded-xl border border-brand-200 bg-brand-50/70 px-4 py-3">
      <h2 className="text-sm font-semibold text-brand-900">
        {collectiveCopy('transfer.request.title', { host: hostName, collective: collectiveName })}
      </h2>
      <p className="mt-1 text-sm text-brand-950/80">
        {collectiveCopy('notify.hostRequest.body', { collective: collectiveName })}
      </p>
      {error && !reviewing ? (
        <p role="alert" className="mt-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => setReviewing(true)} disabled={busy}>
          {collectiveCopy('transfer.review')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => void answer({ action: 'decline_host' })}
        >
          {collectiveCopy('transfer.decline')}
        </Button>
      </div>
      <HostingConsentDialog
        open={reviewing}
        onClose={() => setReviewing(false)}
        collectiveName={collectiveName}
        hostName={hostName}
        busy={busy}
        error={error}
        onAccept={() => void answer({ action: 'accept_host', consent_version: HOST_TRANSFER_CONSENT_VERSION })}
      />
    </section>
  );
}

/** A paused collective: any venue in it can take over hosting straight away. */
export function PausedHostingBanner({
  collectiveId,
  collectiveName,
  formerHostName,
  onChanged,
}: {
  collectiveId: string;
  collectiveName: string;
  formerHostName: string;
  onChanged: () => void;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const takeOver = async () => {
    setBusy(true);
    setError(null);
    const result = await hostingAction(collectiveId, {
      action: 'take_over_hosting',
      consent_version: HOST_TRANSFER_CONSENT_VERSION,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setReviewing(false);
    onChanged();
  };

  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
      <h2 className="text-sm font-semibold text-amber-950">
        {collectiveCopy('transfer.paused.title', { collective: collectiveName })}
      </h2>
      <p className="mt-1 text-sm text-amber-950/85">
        {collectiveCopy('transfer.paused.body', { collective: collectiveName })}
      </p>
      <Button type="button" size="sm" className="mt-2" onClick={() => setReviewing(true)}>
        {collectiveCopy('transfer.paused.takeOver')}
      </Button>
      <HostingConsentDialog
        open={reviewing}
        onClose={() => setReviewing(false)}
        collectiveName={collectiveName}
        hostName={formerHostName}
        busy={busy}
        error={error}
        onAccept={() => void takeOver()}
      />
    </section>
  );
}

/** The host ends the collective, after typing its name. */
export function EndCollectiveSection({
  collectiveId,
  collectiveName,
  onEnded,
}: {
  collectiveId: string;
  collectiveName: string;
  onEnded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const end = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/venue/collectives/${collectiveId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? 'Could not end the collective. Please try again.');
        return;
      }
      setOpen(false);
      onEnded();
    } catch {
      setError('Could not end the collective. Please check your connection.');
    } finally {
      setBusy(false);
    }
  };

  const matches = typed.trim().toLowerCase() === collectiveName.trim().toLowerCase();

  return (
    <div className="border-t border-slate-100 pt-3">
      <Button type="button" variant="ghost" size="sm" className="text-rose-700" onClick={() => setOpen(true)}>
        {collectiveCopy('dissolve.button', { collective: collectiveName })}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !busy) {
            setOpen(false);
            setTyped('');
          }
        }}
        title={collectiveCopy('dissolve.title', { collective: collectiveName })}
        description={collectiveCopy('dissolve.message', { collective: collectiveName })}
        size="sm"
        footer={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="danger" onClick={() => void end()} disabled={!matches || busy} loading={busy}>
              {collectiveCopy('dissolve.button', { collective: collectiveName })}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Go back
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          {error ? (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </p>
          ) : null}
          <label className="block text-sm">
            <span className="text-slate-700">{collectiveCopy('dissolve.typeToConfirm', { collective: collectiveName })}</span>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
            />
          </label>
        </div>
      </Dialog>
    </div>
  );
}
