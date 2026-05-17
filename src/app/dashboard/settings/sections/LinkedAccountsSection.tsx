'use client';

import { useCallback, useEffect, useState } from 'react';
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
import {
  describeGrant,
  isReductionOnly,
  normaliseGrant,
} from '@/lib/linked-accounts/permissions';
import { DEFAULT_LINK_GRANT, type AccountLinkView, type LinkGrant } from '@/lib/linked-accounts/types';
import type { EligibilityResult } from '@/lib/linked-accounts/eligibility';

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

export function LinkedAccountsSection({ venueName }: { venueName: string }) {
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Modal state
  const [sendOpen, setSendOpen] = useState(false);
  const [reviewLink, setReviewLink] = useState<AccountLinkView | null>(null);
  const [editLink, setEditLink] = useState<AccountLinkView | null>(null);
  const [reduceLink, setReduceLink] = useState<AccountLinkView | null>(null);
  const [auditLink, setAuditLink] = useState<AccountLinkView | null>(null);

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

  if (loading) {
    return (
      <SectionCard elevated>
        <SectionCard.Body className="py-10 text-center text-sm text-slate-500">
          Loading linked accounts…
        </SectionCard.Body>
      </SectionCard>
    );
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

      {/* Active links --------------------------------------------------- */}
      <SectionCard elevated>
        <SectionCard.Header
          eyebrow="Linked accounts"
          title="Active links"
          description="Venues your venue is currently linked with. Each venue keeps full ownership of its own bookings and clients — linking only shares access."
          right={
            <button
              type="button"
              className={btnPrimary}
              disabled={!data.eligibility.canCreate}
              onClick={() => {
                setActionError(null);
                setSendOpen(true);
              }}
            >
              Send link request
            </button>
          }
        />
        <SectionCard.Body className="space-y-3">
          {!data.eligibility.canCreate && data.eligibility.reason ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {data.eligibility.reason}
            </p>
          ) : null}
          {activeLinks.length >= 10 ? (
            <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">
              You have a lot of linked venues. Consider whether a venue collective would be
              simpler to manage.
            </p>
          ) : null}
          {activeLinks.length > 0 ? (
            <a
              href="/dashboard/linked-calendar"
              className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-slate-50"
            >
              Open linked calendars
            </a>
          ) : null}
          {activeLinks.length === 0 ? (
            <p className="text-sm text-slate-500">
              No active links yet. Send a request to link with another ReserveNI venue.
            </p>
          ) : (
            activeLinks.map((link) => (
              <ActiveLinkRow
                key={link.id}
                link={link}
                busy={busy}
                onAudit={() => setAuditLink(link)}
                onEdit={() => {
                  setActionError(null);
                  setEditLink(link);
                }}
                onReduce={() => {
                  setActionError(null);
                  setReduceLink(link);
                }}
                onUnlink={async () => {
                  if (
                    !window.confirm(
                      `Unlink from ${link.otherVenue.name}? Cross-venue access stops immediately for both venues.`,
                    )
                  )
                    return;
                  setBusy(true);
                  setActionError(null);
                  try {
                    const res = await fetch(`/api/venue/account-links/${link.id}`, {
                      method: 'DELETE',
                    });
                    if (!res.ok) {
                      const j = await res.json();
                      throw new Error(j.error ?? 'Failed to unlink.');
                    }
                    await load();
                  } catch (err) {
                    setActionError(err instanceof Error ? err.message : 'Failed to unlink.');
                  } finally {
                    setBusy(false);
                  }
                }}
                onRespondChange={async (accept: boolean) => {
                  setBusy(true);
                  setActionError(null);
                  try {
                    const res = await fetch(`/api/venue/account-links/${link.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        action: accept ? 'accept_change' : 'reject_change',
                      }),
                    });
                    if (!res.ok) {
                      const j = await res.json();
                      throw new Error(j.error ?? 'Failed to update link.');
                    }
                    await load();
                  } catch (err) {
                    setActionError(
                      err instanceof Error ? err.message : 'Failed to update link.',
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
                onCancelChange={async () => {
                  setBusy(true);
                  setActionError(null);
                  try {
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
                  } catch (err) {
                    setActionError(
                      err instanceof Error ? err.message : 'Failed to withdraw change.',
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
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
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setActionError(null);
                        try {
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
                        } catch (err) {
                          setActionError(
                            err instanceof Error ? err.message : 'Failed to cancel request.',
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Cancel request
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
          onClose={() => setSendOpen(false)}
          onSent={async () => {
            setSendOpen(false);
            await load();
          }}
          onError={setActionError}
        />
      ) : null}

      {reviewLink ? (
        <ReviewRequestModal
          link={reviewLink}
          onClose={() => setReviewLink(null)}
          onDone={async () => {
            setReviewLink(null);
            await load();
          }}
          onError={setActionError}
        />
      ) : null}

      {editLink ? (
        <EditPermissionsModal
          link={editLink}
          onClose={() => setEditLink(null)}
          onDone={async () => {
            setEditLink(null);
            await load();
          }}
          onError={setActionError}
        />
      ) : null}

      {reduceLink ? (
        <ReduceAccessModal
          link={reduceLink}
          onClose={() => setReduceLink(null)}
          onDone={async () => {
            setReduceLink(null);
            await load();
          }}
          onError={setActionError}
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
    </div>
  );
}

function ActiveLinkRow({
  link,
  busy,
  onAudit,
  onEdit,
  onReduce,
  onUnlink,
  onRespondChange,
  onCancelChange,
}: {
  link: AccountLinkView;
  busy: boolean;
  onAudit: () => void;
  onEdit: () => void;
  onReduce: () => void;
  onUnlink: () => void;
  onRespondChange: (accept: boolean) => void;
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
                  onClick={() => onRespondChange(true)}
                >
                  Accept change
                </button>
                <button
                  type="button"
                  className={btnSecondary}
                  disabled={busy}
                  onClick={() => onRespondChange(false)}
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
        {!suspended ? (
          <button type="button" className={btnSecondary} disabled={busy} onClick={onEdit}>
            Edit permissions
          </button>
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

function SendRequestModal({
  onClose,
  onSent,
  onError,
}: {
  onClose: () => void;
  onSent: () => void;
  onError: (msg: string) => void;
}) {
  const [slug, setSlug] = useState('');
  const [message, setMessage] = useState('');
  const [mine, setMine] = useState<LinkGrant>(DEFAULT_LINK_GRANT);
  const [theirs, setTheirs] = useState<LinkGrant>(DEFAULT_LINK_GRANT);
  const [lookup, setLookup] = useState<
    { found: boolean; eligible?: boolean; name?: string; reason?: string | null } | null
  >(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const trimmed = slug.trim().toLowerCase();
    if (!trimmed) {
      setLookup(null);
      return;
    }
    let cancelled = false;
    setLookingUp(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/venue/account-links/lookup?slug=${encodeURIComponent(trimmed)}`,
        );
        const json = await res.json();
        if (!cancelled) setLookup(res.ok ? json : { found: false });
      } catch {
        if (!cancelled) setLookup({ found: false });
      } finally {
        if (!cancelled) setLookingUp(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [slug]);

  const canSubmit =
    !busy &&
    lookup?.found === true &&
    lookup.eligible === true &&
    (normaliseGrant(mine).calendar !== 'none' || normaliseGrant(theirs).calendar !== 'none');

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title="Send a link request"
      description="Identify the venue by the address of its public booking page (its slug)."
    >
      <div className="space-y-4">
        <label className="block">
          <span className="block text-sm font-medium text-slate-700">
            Venue booking-page address
          </span>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="e.g. riverside-clinic"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            autoFocus
          />
          {lookingUp ? (
            <p className="mt-1 text-xs text-slate-500">Looking up venue…</p>
          ) : lookup ? (
            lookup.found ? (
              <p
                className={`mt-1 text-xs ${
                  lookup.eligible ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {lookup.eligible
                  ? `Found: ${lookup.name}`
                  : `${lookup.name ?? 'Venue'} — ${lookup.reason ?? 'not eligible'}`}
              </p>
            ) : (
              <p className="mt-1 text-xs text-rose-700">No venue found with that address.</p>
            )
          ) : null}
        </label>

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
          otherVenueName={lookup?.name ?? 'the other venue'}
          mine={mine}
          theirs={theirs}
          onChangeMine={setMine}
          onChangeTheirs={setTheirs}
          disabled={busy}
        />

        <div className="flex justify-end gap-2">
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
                const res = await fetch('/api/venue/account-links', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    targetSlug: slug.trim().toLowerCase(),
                    requestMessage: message.trim() || undefined,
                    grants: { mine, theirs },
                  }),
                });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error ?? 'Failed to send request.');
                onSent();
              } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to send request.');
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

function ReviewRequestModal({
  link,
  onClose,
  onDone,
  onError,
}: {
  link: AccountLinkView;
  onClose: () => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  // mine = what my venue grants the other; theirs = what I get from them.
  const [mine, setMine] = useState<LinkGrant>(link.theyCan);
  const [theirs, setTheirs] = useState<LinkGrant>(link.iCan);
  const [busy, setBusy] = useState(false);

  const respond = async (action: string, grants?: { mine: LinkGrant; theirs: LinkGrant }) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/venue/account-links/${link.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, grants }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to respond.');
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to respond.');
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
        <GrantPairEditor
          otherVenueName={link.otherVenue.name}
          mine={mine}
          theirs={theirs}
          onChangeMine={setMine}
          onChangeTheirs={setTheirs}
          disabled={busy}
        />
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
  onError,
}: {
  link: AccountLinkView;
  onClose: () => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [mine, setMine] = useState<LinkGrant>(link.theyCan);
  const [theirs, setTheirs] = useState<LinkGrant>(link.iCan);
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={`Edit permissions with ${link.otherVenue.name}`}
      description="Changes are proposed to the other venue and take effect once they accept. To reduce access immediately without consent, use “Reduce access now”."
    >
      <GrantPairEditor
        otherVenueName={link.otherVenue.name}
        mine={mine}
        theirs={theirs}
        onChangeMine={setMine}
        onChangeTheirs={setTheirs}
        disabled={busy}
      />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={btnPrimary}
          disabled={
            busy ||
            (normaliseGrant(mine).calendar === 'none' &&
              normaliseGrant(theirs).calendar === 'none')
          }
          onClick={async () => {
            setBusy(true);
            try {
              const res = await fetch(`/api/venue/account-links/${link.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'propose_change', grants: { mine, theirs } }),
              });
              const json = await res.json();
              if (!res.ok) throw new Error(json.error ?? 'Failed to propose change.');
              onDone();
            } catch (err) {
              onError(err instanceof Error ? err.message : 'Failed to propose change.');
              setBusy(false);
            }
          }}
        >
          {busy ? 'Proposing…' : 'Propose change'}
        </button>
      </div>
    </Modal>
  );
}

function ReduceAccessModal({
  link,
  onClose,
  onDone,
  onError,
}: {
  link: AccountLinkView;
  onClose: () => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  // theyCan = what my venue currently grants the other venue.
  const [grant, setGrant] = useState<LinkGrant>(link.theyCan);
  const [busy, setBusy] = useState(false);
  const isReduction = isReductionOnly(normaliseGrant(link.theyCan), normaliseGrant(grant));

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
      />
      {!isReduction ? (
        <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
          This control can only reduce access. To grant more, use “Edit permissions”.
        </p>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={btnDanger}
          disabled={busy || !isReduction}
          onClick={async () => {
            setBusy(true);
            try {
              const res = await fetch(`/api/venue/account-links/${link.id}/reduce`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ grant }),
              });
              const json = await res.json();
              if (!res.ok) throw new Error(json.error ?? 'Failed to reduce access.');
              onDone();
            } catch (err) {
              onError(err instanceof Error ? err.message : 'Failed to reduce access.');
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
