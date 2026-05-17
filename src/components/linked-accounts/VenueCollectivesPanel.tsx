'use client';

import { useCallback, useEffect, useState } from 'react';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { Pill } from '@/components/ui/dashboard/Pill';
import { Modal, btnDanger, btnPrimary, btnSecondary } from './linked-accounts-ui';
import type { AccountLinkView } from '@/lib/linked-accounts/types';
import type { CollectiveView } from '@/lib/linked-accounts/collectives';

const inputCls =
  'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

/** Linked venues with full_details visibility both ways — eligible collective members. */
function fullMutualLinks(links: AccountLinkView[]): AccountLinkView[] {
  return links.filter(
    (l) =>
      l.status === 'accepted' &&
      l.iCan.calendar === 'full_details' &&
      l.theyCan.calendar === 'full_details',
  );
}

export function VenueCollectivesPanel({
  venueName,
  activeLinks,
}: {
  venueName: string;
  activeLinks: AccountLinkView[];
}) {
  const [collectives, setCollectives] = useState<CollectiveView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const eligibleLinks = fullMutualLinks(activeLinks);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/venue/collectives');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load collectives.');
      setCollectives(json.collectives ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load collectives.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const memberAction = async (
    collectiveId: string,
    body: Record<string, unknown>,
  ): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/venue/collectives/${collectiveId}/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Action failed.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const dissolve = async (collectiveId: string) => {
    if (!window.confirm('Dissolve this collective? Its combined booking page goes offline.'))
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/venue/collectives/${collectiveId}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error ?? 'Failed to dissolve collective.');
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dissolve collective.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard elevated>
      <SectionCard.Header
        eyebrow="Linked accounts"
        title="Venue collectives"
        description="A venue collective is a shared public booking page joining two or more fully linked venues under one brand."
        right={
          <button
            type="button"
            className={btnPrimary}
            disabled={eligibleLinks.length === 0}
            title={
              eligibleLinks.length === 0
                ? 'You need at least one link sharing full calendar detail both ways.'
                : undefined
            }
            onClick={() => {
              setError(null);
              setCreateOpen(true);
            }}
          >
            Create venue collective
          </button>
        }
      />
      <SectionCard.Body className="space-y-3">
        {error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        ) : null}
        {loading ? (
          <p className="text-sm text-slate-500">Loading collectives…</p>
        ) : collectives.length === 0 ? (
          <p className="text-sm text-slate-500">
            {eligibleLinks.length === 0
              ? 'Collectives need a link that shares full calendar detail in both directions. Create one above first.'
              : 'No venue collectives yet. Create one to offer a combined booking page.'}
          </p>
        ) : (
          collectives.map((c) => (
            <CollectiveRow
              key={c.id}
              collective={c}
              busy={busy}
              onAction={(body) => memberAction(c.id, body)}
              onDissolve={() => dissolve(c.id)}
            />
          ))
        )}
      </SectionCard.Body>

      {createOpen ? (
        <CreateCollectiveModal
          venueName={venueName}
          eligibleLinks={eligibleLinks}
          onClose={() => setCreateOpen(false)}
          onCreated={async () => {
            setCreateOpen(false);
            await load();
          }}
          onError={setError}
        />
      ) : null}
    </SectionCard>
  );
}

function CollectiveRow({
  collective,
  busy,
  onAction,
  onDissolve,
}: {
  collective: CollectiveView;
  busy: boolean;
  onAction: (body: Record<string, unknown>) => void;
  onDissolve: () => void;
}) {
  const dissolved = collective.status === 'dissolved';
  const invited = collective.myMembershipStatus === 'invited';
  const isActiveMember = collective.myMembershipStatus === 'active';
  const liveUrl = `/book/c/${collective.slug}`;

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-slate-900">{collective.name}</p>
            {collective.isHost ? (
              <Pill variant="brand" size="sm">
                Host
              </Pill>
            ) : (
              <Pill variant="neutral" size="sm">
                Member
              </Pill>
            )}
            {dissolved ? (
              <Pill variant="neutral" size="sm">
                Dissolved
              </Pill>
            ) : invited ? (
              <Pill variant="warning" size="sm">
                Invitation pending
              </Pill>
            ) : (
              <Pill variant="success" size="sm" dot>
                Active
              </Pill>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-600">
            {collective.activeMemberCount} active{' '}
            {collective.activeMemberCount === 1 ? 'member' : 'members'} ·{' '}
            {collective.members.map((m) => m.venueName).join(', ')}
          </p>
          {!dissolved && collective.activeMemberCount >= 2 ? (
            <a
              href={liveUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-xs font-medium text-brand-600 underline hover:text-brand-700"
            >
              View combined booking page
            </a>
          ) : null}
        </div>
      </div>

      {!dissolved ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {invited ? (
            <>
              <button
                type="button"
                className={btnPrimary}
                disabled={busy}
                onClick={() => onAction({ action: 'accept' })}
              >
                Accept invitation
              </button>
              <button
                type="button"
                className={btnSecondary}
                disabled={busy}
                onClick={() => onAction({ action: 'decline' })}
              >
                Decline
              </button>
            </>
          ) : null}
          {isActiveMember && !collective.isHost ? (
            <button
              type="button"
              className={btnDanger}
              disabled={busy}
              onClick={() => onAction({ action: 'leave' })}
            >
              Leave collective
            </button>
          ) : null}
          {collective.isHost ? (
            <button
              type="button"
              className={btnDanger}
              disabled={busy}
              onClick={onDissolve}
            >
              Dissolve collective
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CreateCollectiveModal({
  venueName,
  eligibleLinks,
  onClose,
  onCreated,
  onError,
}: {
  venueName: string;
  eligibleLinks: AccountLinkView[];
  onClose: () => void;
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [grouping, setGrouping] = useState<'by_practitioner' | 'by_service_type'>(
    'by_practitioner',
  );
  const [allowAny, setAllowAny] = useState(false);
  const [invited, setInvited] = useState<string[]>([]);
  const [slugState, setSlugState] = useState<{ available: boolean; reason: string | null } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const trimmed = slug.trim().toLowerCase();
    if (!trimmed) {
      setSlugState(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/venue/collectives/slug-available?slug=${encodeURIComponent(trimmed)}`,
        );
        const json = await res.json();
        if (!cancelled) setSlugState(json);
      } catch {
        if (!cancelled) setSlugState({ available: false, reason: 'Check failed.' });
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [slug]);

  const canSubmit =
    !busy &&
    name.trim().length >= 2 &&
    slugState?.available === true &&
    invited.length >= 1;

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title="Create a venue collective"
      description="Combine your venue with linked venues on one branded public booking page."
    >
      <div className="space-y-3">
        <label className="block">
          <span className="block text-sm font-medium text-slate-700">Collective name</span>
          <input
            className={`mt-1 ${inputCls}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="e.g. The Riverside Wellbeing Collective"
            autoFocus
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-slate-700">
            Booking-page address
          </span>
          <div className="mt-1 flex items-center gap-1 text-sm text-slate-500">
            <span>/book/c/</span>
            <input
              className={`${inputCls} flex-1`}
              value={slug}
              onChange={(e) =>
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
              }
              maxLength={60}
              placeholder="riverside-wellbeing"
            />
          </div>
          {slug && slugState ? (
            <p
              className={`mt-1 text-xs ${
                slugState.available ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              {slugState.available ? 'Address is available.' : slugState.reason}
            </p>
          ) : null}
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-slate-700">Description (optional)</span>
          <textarea
            className={`mt-1 ${inputCls}`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={600}
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-slate-700">Service grouping</span>
          <select
            className={`mt-1 ${inputCls}`}
            value={grouping}
            onChange={(e) =>
              setGrouping(e.target.value as 'by_practitioner' | 'by_service_type')
            }
          >
            <option value="by_practitioner">Group by practitioner</option>
            <option value="by_service_type">Group by service type</option>
          </select>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5 rounded border-slate-300"
            checked={allowAny}
            onChange={(e) => setAllowAny(e.target.checked)}
          />
          <span className="text-sm text-slate-700">
            Offer an &ldquo;any available practitioner&rdquo; option for substitutable services
          </span>
        </label>

        <div>
          <p className="text-sm font-medium text-slate-700">Invite linked venues</p>
          <p className="text-xs text-slate-500">
            Only venues with a full mutual link to {venueName} can be invited.
          </p>
          <div className="mt-2 space-y-1">
            {eligibleLinks.length === 0 ? (
              <p className="text-xs text-rose-700">No eligible linked venues.</p>
            ) : (
              eligibleLinks.map((l) => (
                <label key={l.id} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300"
                    checked={invited.includes(l.otherVenue.id)}
                    onChange={(e) =>
                      setInvited((cur) =>
                        e.target.checked
                          ? [...cur, l.otherVenue.id]
                          : cur.filter((v) => v !== l.otherVenue.id),
                      )
                    }
                  />
                  {l.otherVenue.name}
                </label>
              ))
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btnSecondary} disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={!canSubmit}
            onClick={async () => {
              setBusy(true);
              try {
                const res = await fetch('/api/venue/collectives', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: name.trim(),
                    slug: slug.trim().toLowerCase(),
                    branding: { description: description.trim() || null },
                    serviceGrouping: grouping,
                    allowAnyPractitioner: allowAny,
                    inviteVenueIds: invited,
                  }),
                });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error ?? 'Failed to create collective.');
                onCreated();
              } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to create collective.');
                setBusy(false);
              }
            }}
          >
            {busy ? 'Creating…' : 'Create collective'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
