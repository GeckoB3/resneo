'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { Pill } from '@/components/ui/dashboard/Pill';
import { Modal, btnDanger, btnPrimary, btnSecondary } from './linked-accounts-ui';
import { CombinedPageManager } from './CombinedPageManager';
import type { AccountLinkView } from '@/lib/linked-accounts/types';
import type { CollectiveView } from '@/lib/linked-accounts/collectives';

const inputCls =
  'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

/**
 * Linked venues eligible for a COMBINED page (plan §22 / D4): full calendar
 * detail AND create/edit/cancel access in both directions, so any member's staff
 * can manage any combined booking. Matches the create/invite write gate.
 */
function fullMutualLinks(links: AccountLinkView[]): AccountLinkView[] {
  return links.filter(
    (l) =>
      l.status === 'accepted' &&
      l.iCan.calendar === 'full_details' &&
      l.theyCan.calendar === 'full_details' &&
      l.iCan.act === 'create_edit_cancel' &&
      l.theyCan.act === 'create_edit_cancel',
  );
}

interface ConfirmState {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  run: () => Promise<void>;
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
  const [manageTarget, setManageTarget] = useState<CollectiveView | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const router = useRouter();

  /**
   * Collective lifecycle changes (create / accept / decline / leave / dissolve /
   * address change) alter the dashboard layout's server-rendered sidebar
   * (the combined-page booking link). Refresh the server tree so it updates
   * without a hard reload — App Router doesn't re-render the layout on its own.
   */
  const refreshLayout = useCallback(() => router.refresh(), [router]);

  const eligibleLinks = fullMutualLinks(activeLinks);
  // A venue belongs to at most one collective: once it hosts or is a member of a
  // live (non-dissolved) one, the "Create" button is hidden — further members are
  // added from the Manage combined page → Members tab, and it's ended via Dissolve.
  const hasLiveCollective = collectives.some((c) => c.status !== 'dissolved');

  const load = useCallback(async (): Promise<CollectiveView[] | null> => {
    setLoading(true);
    try {
      const res = await fetch('/api/venue/collectives');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load collectives.');
      const list: CollectiveView[] = json.collectives ?? [];
      setCollectives(list);
      setError(null);
      return list;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load collectives.');
      return null;
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
      const list = await load();
      // Re-point (or close) an open Manage modal so it never shows a stale
      // membership state after accept/decline/leave from the row.
      if (list) {
        setManageTarget((cur) => (cur ? (list.find((c) => c.id === cur.id) ?? null) : cur));
      }
      refreshLayout();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    const fn = confirm.run;
    setConfirm(null);
    await fn();
  };

  return (
    <SectionCard elevated>
      <SectionCard.Header
        eyebrow="Linked accounts"
        title="Venue collectives"
        description="A venue collective is a shared public booking page joining two or more fully linked venues under one brand."
        right={
          // Hidden once this venue is already in a live collective (one per venue).
          loading || hasLiveCollective ? undefined : (
            <button
              type="button"
              className={btnPrimary}
              disabled={eligibleLinks.length === 0}
              title={
                eligibleLinks.length === 0
                  ? 'You need at least one link granting create/edit/cancel access both ways.'
                  : undefined
              }
              onClick={() => {
                setError(null);
                setCreateOpen(true);
              }}
            >
              Create venue collective
            </button>
          )
        }
      />
      <SectionCard.Body className="space-y-3">
        {error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        ) : null}
        {loading ? (
          <div className="space-y-2" aria-busy="true">
            <span className="sr-only">Loading collectives…</span>
            <div className="skeleton h-16 rounded-xl" />
            <div className="skeleton h-16 rounded-xl" />
          </div>
        ) : collectives.length === 0 ? (
          <p className="text-sm text-slate-500">
            {eligibleLinks.length === 0
              ? 'A combined page needs a link granting create/edit/cancel access in both directions. Create one above first.'
              : 'No venue collectives yet. Create one to offer a combined booking page.'}
          </p>
        ) : (
          collectives.map((c) => (
            <CollectiveRow
              key={c.id}
              collective={c}
              busy={busy}
              onAction={(body) => memberAction(c.id, body)}
              onManage={() => {
                setError(null);
                setManageTarget(c);
              }}
              onConfirm={setConfirm}
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
            refreshLayout();
          }}
          onError={setError}
        />
      ) : null}

      {manageTarget ? (
        <CombinedPageManager
          collective={manageTarget}
          eligibleLinks={eligibleLinks}
          onClose={() => setManageTarget(null)}
          onChanged={async () => {
            // Refresh the list AND re-point the open manager at the fresh view so
            // a mode/address change is reflected without closing the modal.
            try {
              const res = await fetch('/api/venue/collectives');
              const json = await res.json();
              if (res.ok) {
                const list: CollectiveView[] = json.collectives ?? [];
                setCollectives(list);
                setManageTarget((cur) => (cur ? list.find((c) => c.id === cur.id) ?? cur : cur));
              }
            } catch {
              /* non-fatal: the manager shows its own errors */
            }
            // A dissolve or address-strategy change alters the sidebar's combined-page link.
            refreshLayout();
          }}
        />
      ) : null}

      <ConfirmModal
        state={confirm}
        busy={busy}
        onConfirm={runConfirm}
        onClose={() => setConfirm(null)}
      />
    </SectionCard>
  );
}

function CollectiveRow({
  collective,
  busy,
  onAction,
  onManage,
  onConfirm,
}: {
  collective: CollectiveView;
  busy: boolean;
  onAction: (body: Record<string, unknown>) => void;
  onManage: () => void;
  onConfirm: (state: ConfirmState) => void;
}) {
  const dissolved = collective.status === 'dissolved';
  const invited = collective.myMembershipStatus === 'invited';
  const isActiveMember = collective.myMembershipStatus === 'active';
  const liveUrl = `/book/c/${collective.slug}`;
  // Unified colour source: the page config's brand colour, falling back to legacy branding.
  const accent =
    (collective.bookingPageConfig?.brand_primary as string | undefined) ??
    collective.branding?.primary_colour ??
    null;

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {accent ? (
              <span
                aria-hidden
                className="h-3 w-3 shrink-0 rounded-full border border-black/10"
                style={{ backgroundColor: accent }}
              />
            ) : null}
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

        {!dissolved ? (
          <div className="flex shrink-0 flex-wrap items-start gap-2">
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
            ) : collective.isHost ? (
              // Only the host curates the combined page; members take part automatically
              // (their services use their own settings) and can View it or Leave below.
              <button type="button" className={btnPrimary} disabled={busy} onClick={onManage}>
                Manage combined page
              </button>
            ) : null}
            {isActiveMember && !collective.isHost ? (
              <button
                type="button"
                className={btnSecondary}
                disabled={busy}
                onClick={() =>
                  onConfirm({
                    title: 'Leave this collective?',
                    description: `Your venue will be removed from "${collective.name}". Your own booking page is unaffected.`,
                    confirmLabel: 'Leave collective',
                    danger: true,
                    run: async () => onAction({ action: 'leave' }),
                  })
                }
              >
                Leave
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
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
    !busy && name.trim().length >= 2 && slugState?.available === true && invited.length >= 1;

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
          <span className="block text-sm font-medium text-slate-700">Booking-page address</span>
          <div className="mt-1 flex items-center gap-1 text-sm text-slate-500">
            <span>/book/c/</span>
            <input
              className={`${inputCls} flex-1`}
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
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

        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Your combined page works like a single venue — one services menu and one team across all
          members. After creating it, use <span className="font-medium">Manage combined page</span> to
          choose which services to offer, assign calendars from any venue, and design the page.
        </p>

        <div>
          <p className="text-sm font-medium text-slate-700">Invite linked venues</p>
          <p className="text-xs text-slate-500">
            Only venues granting create/edit/cancel access both ways with {venueName} can be invited.
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

function ConfirmModal({
  state,
  busy,
  onConfirm,
  onClose,
}: {
  state: ConfirmState | null;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (!state) return null;
  return (
    <Modal open onClose={onClose} busy={busy} title={state.title} description={state.description}>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={state.danger ? btnDanger : btnPrimary}
          disabled={busy}
          onClick={onConfirm}
        >
          {state.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
