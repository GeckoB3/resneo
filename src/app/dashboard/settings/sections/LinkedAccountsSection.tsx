'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { Pill } from '@/components/ui/dashboard/Pill';
import {
  GrantEditor,
  GrantPairEditor,
  GrantSummary,
  Modal,
  btnDanger,
  btnPrimary,
  btnSecondary,
  statusPill,
} from '@/components/linked-accounts/linked-accounts-ui';
import { LinkedAccountAuditModal } from '@/components/linked-accounts/LinkedAccountAuditModal';
import { VenueCollectivesPanel } from '@/components/linked-accounts/VenueCollectivesPanel';
import { NotificationPrefsCard } from '@/components/linked-accounts/NotificationPrefsCard';
import { ConfirmDialog } from '@/components/ui/primitives/ConfirmDialog';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import {
  describeGrant,
  grantsEqual,
  isIncreaseOnly,
  isReductionOnly,
  normaliseGrant,
} from '@/lib/linked-accounts/permissions';
import {
  DEFAULT_LINK_GRANT,
  LINK_COUNT_SOFT_WARNING,
  type AccountLinkView,
  type LinkGrant,
} from '@/lib/linked-accounts/types';
import type { EligibilityResult } from '@/lib/linked-accounts/eligibility';
import { notifyLinkedAccountIncomingChanged } from '@/lib/linked-accounts/incoming-banner-events';

interface ApiData {
  eligibility: EligibilityResult;
  venue: { id: string; name: string; slug: string };
  links: AccountLinkView[];
  outgoingPendingCount: number;
  maxOutgoingPending: number;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

const TERMINATION_LABELS: Record<string, string> = {
  unlinked: 'Unlinked',
  subscription_lapsed: 'Subscription lapsed',
  venue_deleted: 'Venue deleted',
  plan_ineligible: 'Plan no longer eligible',
  request_expired: 'Request expired',
};

/** Shimmer placeholder while the linked-accounts data loads (§19.3). */
function LinkedAccountsSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading linked accounts…</span>
      {[0, 1].map((card) => (
        <SectionCard key={card} elevated>
          <SectionCard.Body className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-2">
                <div className="skeleton h-3 w-24 rounded" />
                <div className="skeleton h-5 w-40 rounded" />
              </div>
              <div className="skeleton h-9 w-32 rounded-lg" />
            </div>
            {[0, 1].map((row) => (
              <div key={row} className="space-y-3 rounded-xl border border-slate-100 p-4">
                <div className="skeleton h-4 w-48 rounded" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="skeleton h-16 rounded-xl" />
                  <div className="skeleton h-16 rounded-xl" />
                </div>
              </div>
            ))}
          </SectionCard.Body>
        </SectionCard>
      ))}
    </div>
  );
}

/**
 * Inline error shown next to the control that failed (§19.2). Scrolls itself
 * into view and announces via role="alert" so it's never missed at the top of
 * a long modal or page.
 */
function ActionError({ message }: { message: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [message]);
  return (
    <p
      ref={ref}
      role="alert"
      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700"
    >
      {message}
    </p>
  );
}

/**
 * The Linked Accounts settings tab. Wrapped in its own {@link ToastProvider}
 * because the settings page doesn't mount one — so success/failure toasts
 * (§19.2) are self-contained to this feature.
 */
export function LinkedAccountsSection(props: { venueName: string }) {
  return (
    <ToastProvider>
      <LinkedAccountsSectionInner {...props} />
    </ToastProvider>
  );
}

function LinkedAccountsSectionInner({ venueName }: { venueName: string }) {
  const { addToast } = useToast();
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // §19.2 — per-link busy state, so acting on one link never freezes the rest.
  const [busyLinkId, setBusyLinkId] = useState<string | null>(null);

  // Modal state
  const [sendOpen, setSendOpen] = useState(false);
  // §20 — when set, the send modal opens pre-filled from a shareable invite link.
  const [sendInitialSlug, setSendInitialSlug] = useState<string | undefined>(undefined);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [reviewLink, setReviewLink] = useState<AccountLinkView | null>(null);
  const [editLink, setEditLink] = useState<AccountLinkView | null>(null);
  const [reduceLink, setReduceLink] = useState<AccountLinkView | null>(null);
  const [unlinkConfirmLink, setUnlinkConfirmLink] = useState<AccountLinkView | null>(null);
  const [declineChangeLink, setDeclineChangeLink] = useState<AccountLinkView | null>(null);
  const [auditLink, setAuditLink] = useState<AccountLinkView | null>(null);
  // §18 — this venue's own calendars, for the "which calendars?" scope picker.
  const [myCalendars, setMyCalendars] = useState<{ id: string; name: string }[]>([]);
  // §19.6 — first-run explainer, dismissible and remembered locally.
  const [onboardingDismissed, setOnboardingDismissed] = useState(true);

  useEffect(() => {
    try {
      setOnboardingDismissed(
        localStorage.getItem('reserveni.linkedAccountsOnboardingDismissed') === '1',
      );
    } catch {
      setOnboardingDismissed(false);
    }
  }, []);

  const dismissOnboarding = useCallback(() => {
    setOnboardingDismissed(true);
    try {
      localStorage.setItem('reserveni.linkedAccountsOnboardingDismissed', '1');
    } catch {
      /* ignore */
    }
  }, []);

  // §20 — if opened via a shareable invite link (?invite=token), verify it and
  // pre-fill a request back to the initiating venue. Runs once; clears the param.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('invite');
    if (!token) return;
    params.delete('invite');
    const qs = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    (async () => {
      try {
        const res = await fetch(
          `/api/venue/account-links/invite?token=${encodeURIComponent(token)}`,
        );
        const json = await res.json();
        if (!res.ok || !json.valid) {
          addToast(
            json?.reason === 'expired'
              ? 'That invite link has expired.'
              : 'That invite link is no longer valid.',
            'error',
          );
          return;
        }
        if (json.self) {
          addToast('That’s your own invite link — share it with another venue.', 'info');
          return;
        }
        if (!json.eligible) {
          addToast(json.reason ?? 'That venue isn’t available to link right now.', 'error');
          return;
        }
        setActionError(null);
        setSendInitialSlug(json.venueSlug);
        setSendOpen(true);
        addToast(`Invite from ${json.venueName} — review and send your request.`, 'info');
      } catch {
        addToast('Couldn’t open that invite link.', 'error');
      }
    })();
  }, [addToast]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/venue/account-links/my-calendars');
        if (res.ok && alive) {
          const json = (await res.json()) as { calendars?: { id: string; name: string }[] };
          setMyCalendars(json.calendars ?? []);
        }
      } catch {
        /* the scope picker simply won't render */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/venue/account-links');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load linked accounts.');
      setData(json as ApiData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load linked accounts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Run a link mutation with per-row busy state, toasts, and inline error. */
  const runLinkAction = useCallback(
    async (
      linkId: string,
      fn: () => Promise<void>,
      { success, failure }: { success: string; failure: string },
    ): Promise<boolean> => {
      setBusyLinkId(linkId);
      setActionError(null);
      try {
        await fn();
        addToast(success, 'success');
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : failure;
        setActionError(msg);
        addToast(msg, 'error');
        return false;
      } finally {
        setBusyLinkId(null);
      }
    },
    [addToast],
  );

  const performUnlink = async (link: AccountLinkView) => {
    const ok = await runLinkAction(
      link.id,
      async () => {
        const res = await fetch(`/api/venue/account-links/${link.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const j = await res.json();
          throw new Error(j.error ?? 'Failed to unlink.');
        }
        await load();
      },
      { success: `Unlinked from ${link.otherVenue.name}.`, failure: 'Failed to unlink.' },
    );
    if (ok) setUnlinkConfirmLink(null);
  };

  const performDeclineChange = async (link: AccountLinkView) => {
    const ok = await runLinkAction(
      link.id,
      async () => {
        const res = await fetch(`/api/venue/account-links/${link.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reject_change' }),
        });
        if (!res.ok) {
          const j = await res.json();
          throw new Error(j.error ?? 'Failed to decline change.');
        }
        await load();
        notifyLinkedAccountIncomingChanged();
      },
      { success: 'Permission change declined.', failure: 'Failed to decline change.' },
    );
    if (ok) setDeclineChangeLink(null);
  };

  if (loading) {
    return <LinkedAccountsSkeleton />;
  }

  if (error || !data) {
    return (
      <SectionCard elevated>
        <SectionCard.Body className="py-8 text-center">
          <p className="text-sm text-rose-700">{error ?? 'Linked accounts unavailable.'}</p>
          <button type="button" className={`mt-3 ${btnSecondary}`} onClick={() => void load()}>
            Try again
          </button>
        </SectionCard.Body>
      </SectionCard>
    );
  }

  const links = data.links;
  const activeLinks = links.filter((l) => l.status === 'accepted' || l.status === 'suspended');
  const receivedRequests = links.filter((l) => l.status === 'pending' && !l.initiatedByMe);
  const sentRequests = links.filter((l) => l.status === 'pending' && l.initiatedByMe);
  const pastLinks = links.filter((l) =>
    ['rejected', 'revoked', 'expired'].includes(l.status),
  );

  return (
    <div className="space-y-6">
      {actionError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
          {actionError}
        </div>
      ) : null}

      {/* First-run explainer (§19.6) ----------------------------------- */}
      {links.length === 0 && !onboardingDismissed ? (
        <div className="relative overflow-hidden rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-5">
          <button
            type="button"
            aria-label="Dismiss"
            onClick={dismissOnboarding}
            className="absolute top-3 right-3 inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-white hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
          <h3 className="pr-8 text-base font-bold tracking-tight text-slate-900">
            Work alongside another Resneo venue
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Linking lets two venues see each other’s calendars and (if you choose) manage each
            other’s bookings — ideal for chair-rental, co-located practitioners or a shared brand.
          </p>
          <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
            <li className="flex items-start gap-2">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
              You stay the sole owner of your bookings and clients — linking shares access, never data.
            </li>
            <li className="flex items-start gap-2">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
              You choose, per direction, what each venue can see and do — down to specific calendars.
            </li>
            <li className="flex items-start gap-2">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
              Either venue can reduce access or unlink at any time; nothing is shared after that.
            </li>
          </ul>
          {data.eligibility.canCreate ? (
            <button
              type="button"
              className={`mt-4 ${btnPrimary}`}
              onClick={() => {
                setActionError(null);
                setSendOpen(true);
              }}
            >
              Send your first link request
            </button>
          ) : (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {data.eligibility.reason ?? 'Linking isn’t available on your current plan.'}
            </p>
          )}
        </div>
      ) : null}

      {/* Active links --------------------------------------------------- */}
      <SectionCard elevated>
        <SectionCard.Header
          eyebrow="Linked accounts"
          title="Active links"
          description="Venues your venue is currently linked with. Each venue keeps full ownership of its own bookings and clients — linking only shares access."
          right={
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={btnSecondary}
                disabled={!data.eligibility.canCreate}
                onClick={() => setInviteOpen(true)}
              >
                Get invite link
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={!data.eligibility.canCreate}
                onClick={() => {
                  setActionError(null);
                  setSendInitialSlug(undefined);
                  setSendOpen(true);
                }}
              >
                Send link request
              </button>
            </div>
          }
        />
        <SectionCard.Body className="space-y-3">
          {!data.eligibility.canCreate && data.eligibility.reason ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {data.eligibility.reason}
            </p>
          ) : null}
          {activeLinks.length + receivedRequests.length + sentRequests.length >=
          LINK_COUNT_SOFT_WARNING ? (
            <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
              You have {activeLinks.length + receivedRequests.length + sentRequests.length}{' '}
              active or pending links (we suggest keeping fewer than {LINK_COUNT_SOFT_WARNING} for
              easier management). A{' '}
              <span className="font-semibold">venue collective</span> may be simpler if you share a
              brand with several partners.
            </p>
          ) : null}
          {activeLinks.length > 0 ? (
            <a
              href="/dashboard/calendar"
              className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-slate-50"
            >
              Open linked calendars
            </a>
          ) : null}
          {activeLinks.length === 0 ? (
            <p className="text-sm text-slate-500">
              No active links yet. Send a request to link with another Resneo venue.
            </p>
          ) : (
            activeLinks.map((link) => (
              <ActiveLinkRow
                key={link.id}
                link={link}
                busy={busyLinkId === link.id}
                onAudit={() => setAuditLink(link)}
                onEdit={() => {
                  setActionError(null);
                  setEditLink(link);
                }}
                onReduce={() => {
                  setActionError(null);
                  setReduceLink(link);
                }}
                onUnlink={() => {
                  setActionError(null);
                  setUnlinkConfirmLink(link);
                }}
                onAcceptChange={() =>
                  runLinkAction(
                    link.id,
                    async () => {
                      const res = await fetch(`/api/venue/account-links/${link.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'accept_change' }),
                      });
                      if (!res.ok) {
                        const j = await res.json();
                        throw new Error(j.error ?? 'Failed to update link.');
                      }
                      await load();
                      notifyLinkedAccountIncomingChanged();
                    },
                    { success: 'Permission change accepted.', failure: 'Failed to update link.' },
                  )
                }
                onDeclineChange={() => {
                  setActionError(null);
                  setDeclineChangeLink(link);
                }}
                onCancelChange={() =>
                  runLinkAction(
                    link.id,
                    async () => {
                      const res = await fetch(`/api/venue/account-links/${link.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'cancel_change' }),
                      });
                      if (!res.ok) {
                        const j = await res.json();
                        throw new Error(j.error ?? 'Failed to withdraw change.');
                      }
                      await load();
                    },
                    { success: 'Pending change withdrawn.', failure: 'Failed to withdraw change.' },
                  )
                }
              />
            ))
          )}
        </SectionCard.Body>
      </SectionCard>

      {/* Pending requests ---------------------------------------------- */}
      <SectionCard elevated>
        <SectionCard.Header
          eyebrow="Linked accounts"
          title="Pending requests"
          description="Requests waiting for a response."
        />
        <SectionCard.Body className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Received
            </p>
            {receivedRequests.length === 0 ? (
              <p className="text-sm text-slate-500">No incoming requests.</p>
            ) : (
              <div className="space-y-2">
                {receivedRequests.map((link) => (
                  <div
                    key={link.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {link.otherVenue.name}
                      </p>
                      <p className="text-xs text-slate-600">
                        Requested {formatDate(link.createdAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className={btnPrimary}
                      onClick={() => {
                        setActionError(null);
                        setReviewLink(link);
                      }}
                    >
                      Review request
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Sent by you ({data.outgoingPendingCount}/{data.maxOutgoingPending})
            </p>
            {sentRequests.length === 0 ? (
              <p className="text-sm text-slate-500">No outgoing requests.</p>
            ) : (
              <div className="space-y-2">
                {sentRequests.map((link) => (
                  <div
                    key={link.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {link.otherVenue.name}
                      </p>
                      <p className="text-xs text-slate-600">
                        Sent {formatDate(link.createdAt)} · awaiting response
                      </p>
                    </div>
                    <button
                      type="button"
                      className={btnSecondary}
                      disabled={busyLinkId === link.id}
                      onClick={() =>
                        runLinkAction(
                          link.id,
                          async () => {
                            const res = await fetch(`/api/venue/account-links/${link.id}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'cancel' }),
                            });
                            if (!res.ok) {
                              const j = await res.json();
                              throw new Error(j.error ?? 'Failed to cancel request.');
                            }
                            await load();
                          },
                          { success: 'Request cancelled.', failure: 'Failed to cancel request.' },
                        )
                      }
                    >
                      {busyLinkId === link.id ? 'Cancelling…' : 'Cancel request'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SectionCard.Body>
      </SectionCard>

      {/* Venue collectives (Phase 2) ----------------------------------- */}
      <VenueCollectivesPanel venueName={venueName} activeLinks={activeLinks} />

      {/* Notification email preferences (§17.4) ------------------------- */}
      <NotificationPrefsCard />

      {/* Past links ----------------------------------------------------- */}
      <SectionCard elevated>
        <SectionCard.Header
          eyebrow="Linked accounts"
          title="Past links"
          description="Ended links, kept for audit access. A fresh request is needed to relink."
        />
        <SectionCard.Body className="space-y-2">
          {pastLinks.length === 0 ? (
            <p className="text-sm text-slate-500">No past links.</p>
          ) : (
            pastLinks.map((link) => {
              const pill = statusPill(link.status);
              return (
                <div
                  key={link.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">
                        {link.otherVenue.name}
                      </p>
                      <Pill variant={pill.variant} size="sm">
                        {pill.label}
                      </Pill>
                    </div>
                    <p className="text-xs text-slate-600">
                      {formatDate(link.createdAt)} – {formatDate(link.terminatedAt ?? link.respondedAt)}
                      {link.terminationReason
                        ? ` · ${TERMINATION_LABELS[link.terminationReason] ?? link.terminationReason}`
                        : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={btnSecondary}
                    onClick={() => setAuditLink(link)}
                  >
                    View audit log
                  </button>
                </div>
              );
            })
          )}
        </SectionCard.Body>
      </SectionCard>

      {/* Modals --------------------------------------------------------- */}
      {sendOpen ? (
        <SendRequestModal
          myCalendars={myCalendars}
          initialSlug={sendInitialSlug}
          onClose={() => {
            setSendOpen(false);
            setSendInitialSlug(undefined);
          }}
          onSent={async () => {
            setSendOpen(false);
            setSendInitialSlug(undefined);
            await load();
          }}
        />
      ) : null}

      {inviteOpen ? <InviteLinkModal onClose={() => setInviteOpen(false)} /> : null}

      {reviewLink ? (
        <ReviewRequestModal
          link={reviewLink}
          myCalendars={myCalendars}
          onClose={() => setReviewLink(null)}
          onDone={async () => {
            setReviewLink(null);
            await load();
            notifyLinkedAccountIncomingChanged();
          }}
        />
      ) : null}

      {editLink ? (
        <EditPermissionsModal
          link={editLink}
          myCalendars={myCalendars}
          onClose={() => setEditLink(null)}
          onDone={async () => {
            setEditLink(null);
            await load();
          }}
        />
      ) : null}

      {reduceLink ? (
        <ReduceAccessModal
          link={reduceLink}
          myCalendars={myCalendars}
          onClose={() => setReduceLink(null)}
          onDone={async () => {
            setReduceLink(null);
            await load();
          }}
        />
      ) : null}

      {auditLink ? (
        <LinkedAccountAuditModal
          linkId={auditLink.id}
          otherVenueName={auditLink.otherVenue.name}
          open
          onClose={() => setAuditLink(null)}
        />
      ) : null}

      {unlinkConfirmLink ? (
        <UnlinkConfirmModal
          link={unlinkConfirmLink}
          busy={busyLinkId === unlinkConfirmLink.id}
          onClose={() => setUnlinkConfirmLink(null)}
          onConfirm={() => void performUnlink(unlinkConfirmLink)}
        />
      ) : null}

      {declineChangeLink ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => {
            if (!o) setDeclineChangeLink(null);
          }}
          title={`Decline ${declineChangeLink.otherVenue.name}'s change?`}
          message="The proposed permissions won't be applied and your current access stays as it is. The other venue can propose a new change later."
          confirmLabel="Decline change"
          cancelLabel="Keep reviewing"
          onConfirm={() => void performDeclineChange(declineChangeLink)}
        />
      ) : null}
    </div>
  );
}

function UnlinkConfirmModal({
  link,
  busy,
  onClose,
  onConfirm,
}: {
  link: AccountLinkView;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={`Unlink from ${link.otherVenue.name}?`}
      description="Cross-venue access stops immediately for both venues. To link again later, send a new request from either venue."
      maxWidth="max-w-md"
    >
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={btnSecondary} disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={btnDanger} disabled={busy} onClick={onConfirm}>
          {busy ? 'Unlinking…' : 'Unlink'}
        </button>
      </div>
    </Modal>
  );
}

function ActiveLinkRow({
  link,
  busy,
  onAudit,
  onEdit,
  onReduce,
  onUnlink,
  onAcceptChange,
  onDeclineChange,
  onCancelChange,
}: {
  link: AccountLinkView;
  busy: boolean;
  onAudit: () => void;
  onEdit: () => void;
  onReduce: () => void;
  onUnlink: () => void;
  onAcceptChange: () => void;
  onDeclineChange: () => void;
  onCancelChange: () => void;
}) {
  const pill = statusPill(link.status);
  const suspended = link.status === 'suspended';
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold text-slate-900">{link.otherVenue.name}</p>
          <Pill variant={pill.variant} size="sm" dot>
            {pill.label}
          </Pill>
        </div>
        <p className="text-xs text-slate-500">Linked {formatDate(link.respondedAt)}</p>
      </div>

      {suspended ? (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Suspended — {link.otherVenue.name}&rsquo;s subscription is inactive. The link resumes
          automatically if their subscription is restored within 30 days.
        </p>
      ) : null}

      <div className="mt-3">
        <GrantSummary
          iCan={link.iCan}
          theyCan={link.theyCan}
          otherVenueName={link.otherVenue.name}
        />
      </div>

      {link.pendingChange ? (
        <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/70 p-3">
          <p className="text-xs font-semibold text-sky-900">
            {link.pendingChange.proposedByMe
              ? 'You proposed a permission change — awaiting their response.'
              : `${link.otherVenue.name} proposed a permission change.`}
          </p>
          <div className="mt-2 grid gap-2 text-xs text-slate-700 sm:grid-cols-2">
            <div>
              <span className="font-medium">You would: </span>
              {describeGrant(link.pendingChange.iCan).join(', ')}
            </div>
            <div>
              <span className="font-medium">{link.otherVenue.name} would: </span>
              {describeGrant(link.pendingChange.theyCan).join(', ')}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {link.pendingChange.proposedByMe ? (
              <button
                type="button"
                className={btnSecondary}
                disabled={busy}
                onClick={onCancelChange}
              >
                Withdraw change
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={busy}
                  onClick={onAcceptChange}
                >
                  {busy ? 'Working…' : 'Accept change'}
                </button>
                <button
                  type="button"
                  className={btnSecondary}
                  disabled={busy}
                  onClick={onDeclineChange}
                >
                  Decline change
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={btnSecondary} onClick={onAudit}>
          View audit log
        </button>
        {!suspended && !link.pendingChange ? (
          <button type="button" className={btnSecondary} disabled={busy} onClick={onEdit}>
            Edit permissions
          </button>
        ) : null}
        {!suspended && link.pendingChange ? (
          <p className="w-full text-xs text-slate-500">
            {link.pendingChange.proposedByMe
              ? 'Withdraw your pending permission change above before proposing a new one.'
              : 'Respond to the pending permission change above before proposing a new one.'}
          </p>
        ) : null}
        <button type="button" className={btnSecondary} disabled={busy} onClick={onReduce}>
          Reduce access now
        </button>
        <button type="button" className={btnDanger} disabled={busy} onClick={onUnlink}>
          Unlink
        </button>
      </div>
    </div>
  );
}

interface VenuePick {
  name: string;
  slug: string;
  eligible: boolean;
  reason: string | null;
}

function SendRequestModal({
  onClose,
  onSent,
  myCalendars,
  initialSlug,
}: {
  onClose: () => void;
  onSent: () => void;
  myCalendars: { id: string; name: string }[];
  /** §20 — pre-select this venue (from a shareable invite link). */
  initialSlug?: string;
}) {
  const { addToast } = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VenuePick[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [selected, setSelected] = useState<VenuePick | null>(null);
  const [message, setMessage] = useState('');
  const [mine, setMine] = useState<LinkGrant>(DEFAULT_LINK_GRANT);
  const [theirs, setTheirs] = useState<LinkGrant>(DEFAULT_LINK_GRANT);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // §20 — resolve a venue handed in via an invite link, once on mount.
  const prefilledRef = useRef(false);
  useEffect(() => {
    const slug = initialSlug?.trim().toLowerCase();
    if (!slug || prefilledRef.current) return;
    prefilledRef.current = true;
    (async () => {
      try {
        const res = await fetch(`/api/venue/account-links/lookup?slug=${encodeURIComponent(slug)}`);
        const json = await res.json();
        if (res.ok && json.found) {
          setSelected({
            name: json.name ?? slug,
            slug: json.slug ?? slug,
            eligible: Boolean(json.eligible),
            reason: json.reason ?? null,
          });
        }
      } catch {
        /* fall back to manual search */
      }
    })();
  }, [initialSlug]);

  // Debounced search-by-name (also matches slug, so typing a full slug works).
  useEffect(() => {
    const term = query.trim();
    if (selected || term.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/venue/account-links/search?q=${encodeURIComponent(term)}`);
        const json = await res.json();
        if (!cancelled) {
          setResults(res.ok ? (json.results ?? []) : []);
          setTruncated(Boolean(json.truncated));
          setActiveIndex(-1);
          setSearched(true);
        }
      } catch {
        if (!cancelled) {
          setResults([]);
          setSearched(true);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, selected]);

  const choose = (pick: VenuePick) => {
    setSelected(pick);
    setResults([]);
    setSearched(false);
    setQuery('');
  };

  const clearSelection = () => {
    setSelected(null);
    setErr(null);
  };

  const canSubmit =
    !busy &&
    selected?.eligible === true &&
    (normaliseGrant(mine).calendar !== 'none' || normaliseGrant(theirs).calendar !== 'none');

  const onSearchKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      choose(results[activeIndex]);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title="Send a link request"
      description="Search for the venue by name, or paste its booking-page address."
    >
      <div className="space-y-4">
        {selected ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{selected.name}</p>
                <p className="truncate text-xs text-slate-500">/{selected.slug}</p>
              </div>
              <button
                type="button"
                onClick={clearSelection}
                disabled={busy}
                className="shrink-0 text-xs font-semibold text-brand-700 hover:text-brand-800 disabled:opacity-50"
              >
                Change
              </button>
            </div>
            {!selected.eligible ? (
              <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700">
                {selected.reason ?? 'This venue isn’t available to link right now.'}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="relative">
            <label className="block">
              <span className="block text-sm font-medium text-slate-700">Find a venue</span>
              <input
                type="text"
                role="combobox"
                aria-expanded={results.length > 0}
                aria-controls="venue-search-results"
                aria-autocomplete="list"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="Venue name or booking-page address"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                autoFocus
                autoComplete="off"
              />
            </label>
            {searching ? (
              <p className="mt-1 text-xs text-slate-500">Searching…</p>
            ) : searched && results.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">
                No venues found. Check the name or ask them for their booking-page address.
              </p>
            ) : null}
            {results.length > 0 ? (
              <ul
                id="venue-search-results"
                role="listbox"
                className="mt-2 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm"
              >
                {results.map((r, i) => (
                  <li key={r.slug} role="option" aria-selected={i === activeIndex}>
                    <button
                      type="button"
                      onClick={() => choose(r)}
                      onMouseEnter={() => setActiveIndex(i)}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                        i === activeIndex ? 'bg-brand-50' : 'hover:bg-slate-50'
                      } ${i > 0 ? 'border-t border-slate-100' : ''}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900">{r.name}</span>
                        <span className="block truncate text-xs text-slate-500">/{r.slug}</span>
                      </span>
                      {r.eligible ? (
                        <span className="shrink-0 text-[11px] font-semibold text-emerald-600">
                          Available
                        </span>
                      ) : (
                        <span className="shrink-0 text-[11px] font-medium text-slate-400">
                          Unavailable
                        </span>
                      )}
                    </button>
                  </li>
                ))}
                {truncated ? (
                  <li className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">
                    Showing the first {results.length}. Refine your search to narrow it down.
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>
        )}

        <label className="block">
          <span className="block text-sm font-medium text-slate-700">
            Personal note (optional)
          </span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            maxLength={1000}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            placeholder="Add a short message for the other venue"
          />
        </label>

        <GrantPairEditor
          otherVenueName={selected?.name ?? 'the other venue'}
          mine={mine}
          theirs={theirs}
          onChangeMine={setMine}
          onChangeTheirs={setTheirs}
          disabled={busy}
          myCalendars={myCalendars}
        />

        {err ? <ActionError message={err} /> : null}

        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={!canSubmit}
            onClick={async () => {
              if (!selected) return;
              setBusy(true);
              setErr(null);
              try {
                const res = await fetch('/api/venue/account-links', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    targetSlug: selected.slug,
                    requestMessage: message.trim() || undefined,
                    grants: { mine, theirs },
                  }),
                });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error ?? 'Failed to send request.');
                addToast(`Link request sent to ${selected.name}.`, 'success');
                onSent();
              } catch (e) {
                const msg = e instanceof Error ? e.message : 'Failed to send request.';
                setErr(msg);
                addToast(msg, 'error');
                setBusy(false);
              }
            }}
          >
            {busy ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** §20 — generate and share a one-time, 30-day invite link (copy + QR). */
function InviteLinkModal({ onClose }: { onClose: () => void }) {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{
    url: string;
    qrDataUrl: string | null;
    expiresAt: string;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/venue/account-links/invite', { method: 'POST' });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Failed to create an invite link.');
        if (alive) setData(json);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : 'Failed to create an invite link.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.url);
      setCopied(true);
      addToast('Invite link copied.', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      addToast('Couldn’t copy automatically — select the link and copy it.', 'error');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Invite a venue to link"
      description="Share this link with a venue you know. When an admin there opens it, it pre-fills a request back to you — it grants nothing until you both confirm, and expires in 30 days."
      maxWidth="max-w-md"
    >
      {loading ? (
        <div className="space-y-3" aria-busy="true">
          <span className="sr-only">Generating your invite link…</span>
          <div className="skeleton mx-auto h-40 w-40 rounded-xl" />
          <div className="skeleton h-10 w-full rounded-lg" />
        </div>
      ) : err ? (
        <ActionError message={err} />
      ) : data ? (
        <div className="space-y-4">
          {data.qrDataUrl ? (
            <div className="flex justify-center">
              <img
                src={data.qrDataUrl}
                alt="QR code for your venue's invite link"
                className="h-40 w-40 rounded-xl border border-slate-200 bg-white p-2"
              />
            </div>
          ) : null}
          <div className="flex items-stretch gap-2">
            <input
              type="text"
              readOnly
              value={data.url}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Invite link"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <button type="button" className={btnPrimary} onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Expires {formatDate(data.expiresAt)}. Anyone with this link who signs in as a venue
            admin can start a request back to you — you still approve every link.
          </p>
          <div className="flex justify-end">
            <button type="button" className={btnSecondary} onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function ReviewRequestModal({
  link,
  onClose,
  onDone,
  myCalendars,
}: {
  link: AccountLinkView;
  onClose: () => void;
  onDone: () => void;
  myCalendars: { id: string; name: string }[];
}) {
  const { addToast } = useToast();
  const [editing, setEditing] = useState(false);
  // mine = what my venue grants the other; theirs = what I get from them.
  const [mine, setMine] = useState<LinkGrant>(link.theyCan);
  const [theirs, setTheirs] = useState<LinkGrant>(link.iCan);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const SUCCESS_COPY: Record<string, string> = {
    accept: `You're now linked with ${link.otherVenue.name}.`,
    accept_with_changes: `Linked with ${link.otherVenue.name} with your adjustments.`,
    reject: `Declined ${link.otherVenue.name}'s request.`,
  };

  const respond = async (action: string, grants?: { mine: LinkGrant; theirs: LinkGrant }) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/venue/account-links/${link.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, grants }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to respond.');
      addToast(SUCCESS_COPY[action] ?? 'Done.', 'success');
      onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to respond.';
      setErr(msg);
      addToast(msg, 'error');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={`${link.otherVenue.name} wants to link with you`}
      description="Review what each venue would be able to do, then accept, adjust, or reject."
    >
      {link.requestMessage ? (
        <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm italic text-slate-700">
          “{link.requestMessage}”
        </p>
      ) : null}

      {editing ? (
        <div className="space-y-3">
          <GrantPairEditor
            otherVenueName={link.otherVenue.name}
            mine={mine}
            theirs={theirs}
            onChangeMine={setMine}
            onChangeTheirs={setTheirs}
            disabled={busy}
            myCalendars={myCalendars}
          />
          {/* §19.2 — the data-sharing notice must appear here too, not only in the plain accept view. */}
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Linking is a controller-to-controller data-sharing arrangement. Each venue stays the
            data controller for its own clients. You can reduce access or unlink at any time.
          </p>
        </div>
      ) : (
        <div className="space-y-2 text-sm text-slate-700">
          <p>
            <span className="font-semibold">{link.otherVenue.name} will be able to:</span>{' '}
            {describeGrant(link.theyCan).join(', ')}.
          </p>
          <p>
            <span className="font-semibold">You will be able to:</span>{' '}
            {describeGrant(link.iCan).join(', ')}.
          </p>
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Linking is a controller-to-controller data-sharing arrangement. Each venue stays the
            data controller for its own clients. You can reduce access or unlink at any time.
          </p>
        </div>
      )}

      {err ? <div className="mt-3"><ActionError message={err} /></div> : null}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" className={btnSecondary} disabled={busy} onClick={onClose}>
          Close
        </button>
        <button
          type="button"
          className={btnDanger}
          disabled={busy}
          onClick={() => respond('reject')}
        >
          Reject
        </button>
        {editing ? (
          <button
            type="button"
            className={btnPrimary}
            disabled={
              busy ||
              (normaliseGrant(mine).calendar === 'none' &&
                normaliseGrant(theirs).calendar === 'none')
            }
            onClick={() => respond('accept_with_changes', { mine, theirs })}
          >
            {busy ? 'Saving…' : 'Save & accept'}
          </button>
        ) : (
          <>
            <button
              type="button"
              className={btnSecondary}
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              Accept with changes
            </button>
            <button
              type="button"
              className={btnPrimary}
              disabled={busy}
              onClick={() => respond('accept')}
            >
              {busy ? 'Accepting…' : 'Accept'}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

function EditPermissionsModal({
  link,
  onClose,
  onDone,
  myCalendars,
}: {
  link: AccountLinkView;
  onClose: () => void;
  onDone: () => void;
  myCalendars: { id: string; name: string }[];
}) {
  const { addToast } = useToast();
  const [mine, setMine] = useState<LinkGrant>(link.theyCan);
  const [theirs, setTheirs] = useState<LinkGrant>(link.iCan);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const currentMine = normaliseGrant(link.theyCan);
  const currentTheirs = normaliseGrant(link.iCan);
  const nextMine = normaliseGrant(mine);
  const nextTheirs = normaliseGrant(theirs);
  const mineChanged = !grantsEqual(currentMine, nextMine);
  const theirsChanged = !grantsEqual(currentTheirs, nextTheirs);
  const onlyMineChanged = mineChanged && !theirsChanged;
  const canApplyMineIncrease = onlyMineChanged && isIncreaseOnly(currentMine, nextMine);
  const canApplyMineReduction = onlyMineChanged && isReductionOnly(currentMine, nextMine);
  const needsNegotiation = theirsChanged || (mineChanged && !canApplyMineIncrease && !canApplyMineReduction);

  const submitLabel = canApplyMineIncrease
    ? 'Expand access now'
    : canApplyMineReduction
      ? 'Reduce access now'
      : 'Propose change';

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={`Edit permissions with ${link.otherVenue.name}`}
      description={
        needsNegotiation
          ? 'Changes that affect what you can do on their data, or both directions at once, are proposed to the other venue and take effect once they accept. Expanding or reducing only what you grant takes effect immediately.'
          : canApplyMineIncrease
            ? 'You are expanding access your venue grants. This takes effect immediately.'
            : 'You are reducing access your venue grants. This takes effect immediately.'
      }
    >
      <GrantPairEditor
        otherVenueName={link.otherVenue.name}
        mine={mine}
        theirs={theirs}
        onChangeMine={setMine}
        onChangeTheirs={setTheirs}
        disabled={busy}
        myCalendars={myCalendars}
      />
      {needsNegotiation && link.pendingChange ? (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {link.pendingChange.proposedByMe
            ? 'Withdraw your pending change first, or use the controls above to expand or reduce only what you grant.'
            : 'Accept or decline the pending change above before proposing a new one.'}
        </p>
      ) : null}
      {err ? <div className="mt-3"><ActionError message={err} /></div> : null}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={canApplyMineReduction ? btnDanger : btnPrimary}
          disabled={
            busy ||
            (!mineChanged && !theirsChanged) ||
            (nextMine.calendar === 'none' && nextTheirs.calendar === 'none') ||
            (needsNegotiation && !!link.pendingChange)
          }
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              let successMsg: string;
              if (canApplyMineIncrease) {
                const res = await fetch(`/api/venue/account-links/${link.id}/grant`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ grant: nextMine }),
                });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error ?? 'Failed to expand access.');
                successMsg = `Expanded ${link.otherVenue.name}'s access.`;
              } else if (canApplyMineReduction) {
                const res = await fetch(`/api/venue/account-links/${link.id}/reduce`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ grant: nextMine }),
                });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error ?? 'Failed to reduce access.');
                successMsg = `Reduced ${link.otherVenue.name}'s access.`;
              } else {
                const res = await fetch(`/api/venue/account-links/${link.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'propose_change', grants: { mine, theirs } }),
                });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error ?? 'Failed to propose change.');
                successMsg = `Change proposed to ${link.otherVenue.name}.`;
              }
              addToast(successMsg, 'success');
              onDone();
            } catch (e) {
              const msg = e instanceof Error ? e.message : 'Failed to update permissions.';
              setErr(msg);
              addToast(msg, 'error');
              setBusy(false);
            }
          }}
        >
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </Modal>
  );
}

function ReduceAccessModal({
  link,
  onClose,
  onDone,
  myCalendars,
}: {
  link: AccountLinkView;
  onClose: () => void;
  onDone: () => void;
  myCalendars: { id: string; name: string }[];
}) {
  const { addToast } = useToast();
  // theyCan = what my venue currently grants the other venue.
  const [grant, setGrant] = useState<LinkGrant>(link.theyCan);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const current = normaliseGrant(link.theyCan);
  const next = normaliseGrant(grant);
  const isReduction = isReductionOnly(current, next);
  const hasChanged = !grantsEqual(current, next);

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={`Reduce ${link.otherVenue.name}'s access`}
      description="Lower the access your venue grants. This takes effect immediately and does not need the other venue's consent."
    >
      <GrantEditor
        label={`What ${link.otherVenue.name} can do with your data`}
        value={grant}
        onChange={setGrant}
        disabled={busy}
        calendars={myCalendars}
      />
      {!isReduction ? (
        <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
          This control can only reduce access. To grant more, use “Edit permissions”.
        </p>
      ) : null}
      {err ? <div className="mt-3"><ActionError message={err} /></div> : null}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={btnDanger}
          disabled={busy || !isReduction || !hasChanged}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              const res = await fetch(`/api/venue/account-links/${link.id}/reduce`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ grant }),
              });
              const json = await res.json();
              if (!res.ok) throw new Error(json.error ?? 'Failed to reduce access.');
              addToast(`Reduced ${link.otherVenue.name}'s access.`, 'success');
              onDone();
            } catch (e) {
              const msg = e instanceof Error ? e.message : 'Failed to reduce access.';
              setErr(msg);
              addToast(msg, 'error');
              setBusy(false);
            }
          }}
        >
          {busy ? 'Saving…' : 'Reduce access'}
        </button>
      </div>
    </Modal>
  );
}
