'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { Pill } from '@/components/ui/dashboard/Pill';
import { Modal, btnDanger, btnPrimary, btnSecondary } from './linked-accounts-ui';
import { CombinedPageManager } from './CombinedPageManager';
import { JoinCollectiveDialog } from './collective/JoinCollectiveDialog';
import { CreateCollectiveDialog } from './collective/CreateCollectiveDialog';
import { CollectiveSetupWizard } from './setup/CollectiveSetupWizard';
import { collectiveCopy, formatVenueList } from '@/lib/linked-accounts/collective-copy';
import { EndedCollectivesList, LeaveCollectiveDialog, ReleaseReviewCard } from './collective/ReleaseReview';
import type { ReleaseReview } from '@/lib/linked-accounts/replicas/release-review';
import type { AccountLinkView } from '@/lib/linked-accounts/types';
import type { CollectiveView } from '@/lib/linked-accounts/collectives';
import { fullMutualLinks } from '@/lib/linked-accounts/full-mutual-links';

/**
 * Linked venues eligible for a COMBINED page (plan §22 / D4): full calendar
 * detail AND create/edit/cancel access in both directions, so any member's staff
 * can manage any combined booking. Matches the create/invite write gate.
 */


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
  pendingLinkByHost = {},
  onReviewLink,
  autoOpenSetupId = null,
  onSetupHandled,
  refreshKey = 0,
}: {
  venueName: string;
  activeLinks: AccountLinkView[];
  /** Pending link requests this venue has received, by the requesting venue's id (plan L4). */
  pendingLinkByHost?: Record<string, string>;
  /** Open the review of that link request, which also answers the invitation that rides on it. */
  onReviewLink?: (linkId: string) => void;
  /** `?setup={collectiveId}` from the dashboard banner: open the finish-setting-up wizard (plan L8). */
  autoOpenSetupId?: string | null;
  onSetupHandled?: () => void;
  /** Changes when the tab knows a collective changed underneath (a request sent or answered with one). */
  refreshKey?: number;
}) {
  const [collectives, setCollectives] = useState<CollectiveView[]>([]);
  // The host's finish-setting-up wizard, and which collectives the banner feed says still need it.
  const [setupTarget, setSetupTarget] = useState<CollectiveView | null>(null);
  const [setupNeeded, setSetupNeeded] = useState<Set<string>>(new Set());
  // Collectives this venue has joined whose host is still setting the page up (the member's wait).
  const [memberWaiting, setMemberWaiting] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [manageTarget, setManageTarget] = useState<CollectiveView | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  // Joining a shared-services collective asks for consent and choices first (contract 6).
  const [joinTarget, setJoinTarget] = useState<CollectiveView | null>(null);
  // Leaving one explains what changes first, then shows what to review (contract 7).
  const [leaveTarget, setLeaveTarget] = useState<CollectiveView | null>(null);
  const [review, setReview] = useState<{ value: ReleaseReview | null; key: number }>({ value: null, key: 0 });
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
  }, [load, refreshKey]);

  const loadSetupNeeds = useCallback(async () => {
    try {
      const res = await fetch('/api/venue/account-links/incoming');
      if (!res.ok) return;
      const json = (await res.json()) as {
        collectiveSetup?: { collectiveId: string }[];
        memberWaiting?: { collectiveId: string }[];
      };
      setSetupNeeded(new Set((json.collectiveSetup ?? []).map((c) => c.collectiveId)));
      setMemberWaiting(new Set((json.memberWaiting ?? []).map((c) => c.collectiveId)));
    } catch {
      /* the row simply does not offer the shortcut */
    }
  }, []);

  useEffect(() => {
    void loadSetupNeeds();
  }, [loadSetupNeeds, refreshKey]);

  useEffect(() => {
    if (!autoOpenSetupId || loading) return;
    const match = collectives.find((c) => c.id === autoOpenSetupId && c.isHost && c.status !== 'dissolved');
    if (match) setSetupTarget(match);
    onSetupHandled?.();
  }, [autoOpenSetupId, collectives, loading, onSetupHandled]);


  

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
        <ReleaseReviewCard key={review.key} initial={review.value} />
        <EndedCollectivesList venueName={venueName} refreshKey={review.key} />
        {error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        ) : null}
        {/* Why the "Create venue collective" button is disabled. The button itself
            only carries a hover tooltip, and the explanatory empty-state below is
            hidden whenever any row is listed, including a *dissolved* one, so a
            venue that dissolved a collective and relinked would otherwise see a
            greyed-out button with no on-screen reason. Shown whenever the button is
            visible (no live collective) but disabled (no full create/edit/cancel link). */}
        {!loading && !hasLiveCollective && eligibleLinks.length === 0 ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            To create a combined page you need a link granting{' '}
            <span className="font-medium">create, edit &amp; cancel</span> access in{' '}
            <span className="font-medium">both directions</span> (full calendar detail, no
            calendar limits). In <span className="font-medium">Active links</span> above, open the
            link, choose <span className="font-medium">Edit permissions</span>, and set both
            directions to create/edit/cancel.
          </p>
        ) : null}
        {loading ? (
          <div className="space-y-2" aria-busy="true">
            <span className="sr-only">Loading collectives…</span>
            <div className="skeleton h-16 rounded-xl" />
            <div className="skeleton h-16 rounded-xl" />
          </div>
        ) : collectives.length === 0 ? (
          // The amber note above already explains the no-eligible-link case.
          eligibleLinks.length === 0 ? null : (
            <p className="text-sm text-slate-500">
              No venue collectives yet. Create one to offer a combined booking page.
            </p>
          )
        ) : (
          collectives.map((c) => (
            <CollectiveRow
              key={c.id}
              collective={c}
              busy={busy}
              onAction={(body) => memberAction(c.id, body)}
              onJoin={() => {
                setError(null);
                setJoinTarget(c);
              }}
              onLeave={() => {
                setError(null);
                setLeaveTarget(c);
              }}
              onManage={() => {
                setError(null);
                setManageTarget(c);
              }}
              onConfirm={setConfirm}
              pendingLinkId={pendingLinkByHost[c.hostVenueId] ?? null}
              onReviewLink={onReviewLink}
              setupNeeded={setupNeeded.has(c.id)}
              memberWaiting={memberWaiting.has(c.id)}
              onSetup={() => {
                setError(null);
                setSetupTarget(c);
              }}
            />
          ))
        )}
      </SectionCard.Body>

      {createOpen ? (
        <CreateCollectiveDialog
          venueName={venueName}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            // The dialog stays open on its receipt step; the list behind it refreshes now.
            void load();
            refreshLayout();
          }}
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

      {setupTarget ? (
        <CollectiveSetupWizard
          collectiveId={setupTarget.id}
          venueName={venueName}
          onClose={() => {
            setSetupTarget(null);
            void load();
            void loadSetupNeeds();
            refreshLayout();
          }}
          onChanged={() => {
            void loadSetupNeeds();
          }}
        />
      ) : null}

      {leaveTarget ? (
        <LeaveCollectiveDialog
          open
          collectiveId={leaveTarget.id}
          onClose={() => setLeaveTarget(null)}
          onLeft={(next) => {
            setLeaveTarget(null);
            setReview((cur) => ({ value: next, key: cur.key + 1 }));
            void load();
            refreshLayout();
          }}
        />
      ) : null}

      {joinTarget ? (
        <JoinCollectiveDialog
          open
          collectiveId={joinTarget.id}
          venueName={venueName}
          onClose={() => setJoinTarget(null)}
          onJoined={() => {
            setJoinTarget(null);
            void load();
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
  onJoin,
  onLeave,
  onManage,
  onConfirm,
  pendingLinkId,
  onReviewLink,
  setupNeeded,
  memberWaiting,
  onSetup,
}: {
  collective: CollectiveView;
  busy: boolean;
  onAction: (body: Record<string, unknown>) => void;
  onJoin: () => void;
  onLeave: () => void;
  onManage: () => void;
  onConfirm: (state: ConfirmState) => void;
  /** The host's link request this venue has not answered yet, which the invitation rides on. */
  pendingLinkId: string | null;
  onReviewLink?: (linkId: string) => void;
  /** The page has two venues in and nothing bookable yet: offer the guided finish (plan L8). */
  setupNeeded: boolean;
  /** This venue is a member and the host has not put anything bookable on the page yet. */
  memberWaiting: boolean;
  onSetup: () => void;
}) {
  const dissolved = collective.status === 'dissolved';
  const invited = collective.myMembershipStatus === 'invited';
  const hostName = collective.members.find((m) => m.venueId === collective.hostVenueId)?.venueName ?? 'the host';
  const invitedNames = collective.members.filter((m) => m.status === 'invited').map((m) => m.venueName);
  const isActiveMember = collective.myMembershipStatus === 'active';
  // The address customers actually use: a member venue's own page when the
  // collective adopted it (the manager shows the same), else the dedicated one.
  const adoptedSlug =
    collective.slugStrategy === 'adopt_member' && collective.adoptedVenueId
      ? (collective.members.find((m) => m.venueId === collective.adoptedVenueId)?.venueSlug ?? null)
      : null;
  const liveUrl = adoptedSlug ? `/book/${adoptedSlug}` : `/book/c/${collective.slug}`;
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
            {collective.activeMemberCount === 1 ? 'member' : 'members'}
            {collective.members.length > 0 ? ` · ${collective.members.map((m) => m.venueName).join(', ')}` : ''}
          </p>
          {!dissolved && collective.isHost && collective.activeMemberCount < 2 && invitedNames.length > 0 ? (
            <p className="mt-1 text-xs font-medium text-brand-700">
              {collectiveCopy('la.row.host.waiting', { venueList: formatVenueList(invitedNames, 3) })}
            </p>
          ) : null}
          {!dissolved && !collective.isHost && isActiveMember && memberWaiting ? (
            <p className="mt-1 text-xs font-medium text-brand-700">
              {collectiveCopy('la.row.member.waiting', { host: hostName })}
            </p>
          ) : null}
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
          <div className="flex min-w-0 flex-wrap items-start gap-2 sm:shrink-0">
            {invited && pendingLinkId ? (
              // The invitation rides on a link request this venue has not answered: one review
              // covers both (plan L4), so the row points there instead of offering a join the
              // engine would refuse for want of the link.
              <div className="flex flex-col items-end gap-1">
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={busy}
                  onClick={() => onReviewLink?.(pendingLinkId)}
                >
                  Review link request
                </button>
                <p className="max-w-xs text-right text-xs text-slate-600">
                  {collectiveCopy('la.row.invitation.pendingLink', { host: hostName })}
                </p>
              </div>
            ) : invited ? (
              <>
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={busy}
                  onClick={() =>
                    collective.serviceModel === 'replicas' ? onJoin() : onAction({ action: 'accept' })
                  }
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
              <>
                {collective.serviceModel === 'replicas' && setupNeeded ? (
                  <button type="button" className={btnPrimary} disabled={busy} onClick={onSetup}>
                    {collectiveCopy('finish.row.cta')}
                  </button>
                ) : null}
                {collective.serviceModel === 'replicas' && !dissolved ? (
                  <a href="/dashboard/collective" className={setupNeeded ? btnSecondary : btnPrimary}>
                    Manage Collective
                  </a>
                ) : null}
                <button
                  type="button"
                  className={collective.serviceModel === 'replicas' ? btnSecondary : btnPrimary}
                  disabled={busy}
                  onClick={onManage}
                >
                  Manage combined page
                </button>
              </>
            ) : null}
            {isActiveMember && !collective.isHost ? (
              <button
                type="button"
                className={btnSecondary}
                disabled={busy}
                onClick={() =>
                  collective.serviceModel === 'replicas'
                    ? onLeave()
                    : onConfirm({
                        title: 'Leave this collective?',
                        description: `Your venue will be removed from "${collective.name}". Guests who visit your own booking page will book your own services there.`,
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
