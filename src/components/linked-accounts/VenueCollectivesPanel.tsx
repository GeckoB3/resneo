'use client';

import { useCallback, useEffect, useState } from 'react';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { Pill } from '@/components/ui/dashboard/Pill';
import { Modal, btnDanger, btnPrimary, btnSecondary } from './linked-accounts-ui';
import type { AccountLinkView } from '@/lib/linked-accounts/types';
import type { CollectiveBranding, CollectiveView } from '@/lib/linked-accounts/collectives';

const inputCls =
  'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

type Grouping = 'by_practitioner' | 'by_service_type';

/** Linked venues with full_details visibility both ways — eligible collective members. */
function fullMutualLinks(links: AccountLinkView[]): AccountLinkView[] {
  return links.filter(
    (l) =>
      l.status === 'accepted' &&
      l.iCan.calendar === 'full_details' &&
      l.theyCan.calendar === 'full_details',
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
  const [editTarget, setEditTarget] = useState<CollectiveView | null>(null);
  const [inviteTarget, setInviteTarget] = useState<CollectiveView | null>(null);
  const [configTarget, setConfigTarget] = useState<CollectiveView | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

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

  const dissolve = async (collectiveId: string): Promise<void> => {
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
          <div className="space-y-2" aria-busy="true">
            <span className="sr-only">Loading collectives…</span>
            <div className="skeleton h-16 rounded-xl" />
            <div className="skeleton h-16 rounded-xl" />
          </div>
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
              eligibleLinks={eligibleLinks}
              onAction={(body) => memberAction(c.id, body)}
              onEdit={() => {
                setError(null);
                setEditTarget(c);
              }}
              onInvite={() => {
                setError(null);
                setInviteTarget(c);
              }}
              onConfigure={() => {
                setError(null);
                setConfigTarget(c);
              }}
              onConfirm={setConfirm}
              onDissolve={() =>
                setConfirm({
                  title: 'Dissolve this collective?',
                  description: `"${c.name}" and its combined booking page will go offline immediately. Each venue keeps its own page and data.`,
                  confirmLabel: 'Dissolve collective',
                  danger: true,
                  run: () => dissolve(c.id),
                })
              }
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

      {editTarget ? (
        <EditCollectiveModal
          collective={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={async () => {
            setEditTarget(null);
            await load();
          }}
          onError={setError}
        />
      ) : null}

      {inviteTarget ? (
        <InviteMemberModal
          collective={inviteTarget}
          eligibleLinks={eligibleLinks}
          onClose={() => setInviteTarget(null)}
          onInvited={async () => {
            setInviteTarget(null);
            await load();
          }}
          onError={setError}
        />
      ) : null}

      {configTarget ? (
        <ConfigureVisibilityModal
          collective={configTarget}
          onClose={() => setConfigTarget(null)}
          onSaved={async () => {
            setConfigTarget(null);
            await load();
          }}
          onError={setError}
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
  eligibleLinks,
  onAction,
  onEdit,
  onInvite,
  onConfigure,
  onConfirm,
  onDissolve,
}: {
  collective: CollectiveView;
  busy: boolean;
  eligibleLinks: AccountLinkView[];
  onAction: (body: Record<string, unknown>) => void;
  onEdit: () => void;
  onInvite: () => void;
  onConfigure: () => void;
  onConfirm: (state: ConfirmState) => void;
  onDissolve: () => void;
}) {
  const dissolved = collective.status === 'dissolved';
  const invited = collective.myMembershipStatus === 'invited';
  const isActiveMember = collective.myMembershipStatus === 'active';
  const liveUrl = `/book/c/${collective.slug}`;
  const accent = collective.branding?.primary_colour ?? null;

  const memberVenueIds = new Set(collective.members.map((m) => m.venueId));
  const invitable = eligibleLinks.filter((l) => !memberVenueIds.has(l.otherVenue.id));

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
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
      </div>

      {/* Host member management ------------------------------------------ */}
      {collective.isHost && !dissolved ? (
        <div className="mt-3 space-y-1.5 rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Members</p>
          {collective.members.map((m) => {
            const isHostMember = m.venueId === collective.hostVenueId;
            return (
              <div key={m.venueId} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-slate-700">
                  {m.venueName}
                  {isHostMember ? (
                    <span className="ml-1 text-xs text-brand-600">(host)</span>
                  ) : m.status === 'invited' ? (
                    <span className="ml-1 text-xs text-amber-600">(invited)</span>
                  ) : null}
                </span>
                <div className="flex shrink-0 gap-2">
                  {m.status === 'active' && !isHostMember ? (
                    <button
                      type="button"
                      className="text-xs font-medium text-slate-500 hover:text-brand-700 disabled:opacity-50"
                      disabled={busy}
                      onClick={() =>
                        onConfirm({
                          title: `Make ${m.venueName} the host?`,
                          description: `This takes effect immediately: ${m.venueName} will control this collective's branding, members and settings, and your venue becomes a regular member. You can't undo this yourself — only the new host can transfer it back.`,
                          confirmLabel: 'Transfer host',
                          run: async () => onAction({ action: 'transfer_host', venueId: m.venueId }),
                        })
                      }
                    >
                      Make host
                    </button>
                  ) : null}
                  {!isHostMember ? (
                    <button
                      type="button"
                      className="text-xs font-medium text-rose-500 hover:text-rose-700 disabled:opacity-50"
                      disabled={busy}
                      onClick={() =>
                        onConfirm({
                          title: `Remove ${m.venueName}?`,
                          description: `${m.venueName} will be removed from "${collective.name}" and no longer appear on the combined booking page.`,
                          confirmLabel: 'Remove member',
                          danger: true,
                          run: async () => onAction({ action: 'remove', venueId: m.venueId }),
                        })
                      }
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

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
          {collective.isHost ? (
            <>
              <button type="button" className={btnSecondary} disabled={busy} onClick={onEdit}>
                Edit settings
              </button>
              <button
                type="button"
                className={btnSecondary}
                disabled={busy || invitable.length === 0}
                title={
                  invitable.length === 0
                    ? 'No further fully-linked venues available to invite.'
                    : undefined
                }
                onClick={onInvite}
              >
                Invite venue
              </button>
              <button type="button" className={btnDanger} disabled={busy} onClick={onDissolve}>
                Dissolve collective
              </button>
            </>
          ) : null}
          {isActiveMember ? (
            <button type="button" className={btnSecondary} disabled={busy} onClick={onConfigure}>
              Configure my listing
            </button>
          ) : null}
          {isActiveMember && !collective.isHost ? (
            <button
              type="button"
              className={btnDanger}
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
              Leave collective
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface BrandingState {
  description: string;
  logoUrl: string;
  colour: string;
}

function BrandingFields({
  value,
  onChange,
}: {
  value: BrandingState;
  onChange: (next: BrandingState) => void;
}) {
  return (
    <>
      <label className="block">
        <span className="block text-sm font-medium text-slate-700">Description (optional)</span>
        <textarea
          className={`mt-1 ${inputCls}`}
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
          rows={2}
          maxLength={600}
          placeholder="A short line shown on the combined booking page."
        />
      </label>
      <label className="block">
        <span className="block text-sm font-medium text-slate-700">Logo URL (optional)</span>
        <input
          className={`mt-1 ${inputCls}`}
          value={value.logoUrl}
          onChange={(e) => onChange({ ...value, logoUrl: e.target.value })}
          maxLength={500}
          placeholder="https://…/logo.png"
          inputMode="url"
        />
      </label>
      <div className="block">
        <span className="block text-sm font-medium text-slate-700">Brand colour (optional)</span>
        <div className="mt-1 flex items-center gap-3">
          <input
            type="color"
            aria-label="Brand colour"
            className="h-9 w-12 cursor-pointer rounded border border-slate-200"
            value={/^#[0-9A-Fa-f]{6}$/.test(value.colour) ? value.colour : '#003B6F'}
            onChange={(e) => onChange({ ...value, colour: e.target.value })}
          />
          <span className="text-sm text-slate-500">{value.colour || 'Default'}</span>
          {value.colour ? (
            <button
              type="button"
              className="text-xs text-slate-400 underline hover:text-slate-600"
              onClick={() => onChange({ ...value, colour: '' })}
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}

/** Build the API branding object from the editable fields (empty → null). */
function toBrandingPayload(b: BrandingState): CollectiveBranding {
  return {
    description: b.description.trim() || null,
    logo_url: b.logoUrl.trim() || null,
    primary_colour: /^#[0-9A-Fa-f]{6}$/.test(b.colour) ? b.colour : null,
  };
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
  const [branding, setBranding] = useState<BrandingState>({
    description: '',
    logoUrl: '',
    colour: '',
  });
  const [grouping, setGrouping] = useState<Grouping>('by_practitioner');
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

        <BrandingFields value={branding} onChange={setBranding} />

        <label className="block">
          <span className="block text-sm font-medium text-slate-700">Service grouping</span>
          <select
            className={`mt-1 ${inputCls}`}
            value={grouping}
            onChange={(e) => setGrouping(e.target.value as Grouping)}
          >
            <option value="by_practitioner">Group by practitioner</option>
            <option value="by_service_type">Group by service type</option>
          </select>
        </label>
        {/* §7.6 — cross-venue "any practitioner" routing isn't built yet, so we
            don't surface a live toggle that would promise it (a false promise). */}
        <div className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2">
          <input
            type="checkbox"
            disabled
            className="mt-0.5 rounded border-slate-300"
            aria-label="Any available practitioner (coming soon)"
          />
          <span className="text-sm text-slate-400">
            Offer an &ldquo;any available practitioner&rdquo; option across the collective —{' '}
            <span className="font-medium">coming soon</span>.
          </span>
        </div>

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
                    branding: toBrandingPayload(branding),
                    serviceGrouping: grouping,
                    // §7.6 — routing not built; never create with the promise on.
                    allowAnyPractitioner: false,
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

function EditCollectiveModal({
  collective,
  onClose,
  onSaved,
  onError,
}: {
  collective: CollectiveView;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(collective.name);
  const [branding, setBranding] = useState<BrandingState>({
    description: collective.branding?.description ?? '',
    logoUrl: collective.branding?.logo_url ?? '',
    colour: collective.branding?.primary_colour ?? '',
  });
  const [grouping, setGrouping] = useState<Grouping>(collective.serviceGrouping);
  // §7.6 — preserved as-is (read-only "coming soon" in the form) until routing ships.
  const [allowAny] = useState(collective.allowAnyPractitioner);
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title="Edit collective settings"
      description="Update the branding and booking-page behaviour. The booking-page address cannot be changed."
    >
      <div className="space-y-3">
        <label className="block">
          <span className="block text-sm font-medium text-slate-700">Collective name</span>
          <input
            className={`mt-1 ${inputCls}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            autoFocus
          />
        </label>

        <BrandingFields value={branding} onChange={setBranding} />

        <label className="block">
          <span className="block text-sm font-medium text-slate-700">Service grouping</span>
          <select
            className={`mt-1 ${inputCls}`}
            value={grouping}
            onChange={(e) => setGrouping(e.target.value as Grouping)}
          >
            <option value="by_practitioner">Group by practitioner</option>
            <option value="by_service_type">Group by service type</option>
          </select>
        </label>
        {/* §7.6 — routing isn't built yet; show the stored value read-only as
            "coming soon" rather than a live toggle that promises it. */}
        <div className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2">
          <input
            type="checkbox"
            disabled
            checked={allowAny}
            className="mt-0.5 rounded border-slate-300"
            aria-label="Any available practitioner (coming soon)"
            readOnly
          />
          <span className="text-sm text-slate-400">
            Offer an &ldquo;any available practitioner&rdquo; option across the collective —{' '}
            <span className="font-medium">coming soon</span>.
          </span>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btnSecondary} disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={busy || name.trim().length < 2}
            onClick={async () => {
              setBusy(true);
              try {
                const res = await fetch(`/api/venue/collectives/${collective.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: name.trim(),
                    branding: toBrandingPayload(branding),
                    serviceGrouping: grouping,
                    allowAnyPractitioner: allowAny,
                  }),
                });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error ?? 'Failed to save settings.');
                onSaved();
              } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to save settings.');
                setBusy(false);
              }
            }}
          >
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function InviteMemberModal({
  collective,
  eligibleLinks,
  onClose,
  onInvited,
  onError,
}: {
  collective: CollectiveView;
  eligibleLinks: AccountLinkView[];
  onClose: () => void;
  onInvited: () => void;
  onError: (msg: string) => void;
}) {
  const memberVenueIds = new Set(collective.members.map((m) => m.venueId));
  const invitable = eligibleLinks.filter((l) => !memberVenueIds.has(l.otherVenue.id));
  const [venueId, setVenueId] = useState<string>('');
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={`Invite a venue to ${collective.name}`}
      description="The venue must hold a full mutual link with every current member."
    >
      <div className="space-y-3">
        {invitable.length === 0 ? (
          <p className="text-sm text-slate-500">
            No further fully-linked venues are available to invite.
          </p>
        ) : (
          <div className="space-y-1">
            {invitable.map((l) => (
              <label key={l.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name="invite-venue"
                  className="border-slate-300"
                  checked={venueId === l.otherVenue.id}
                  onChange={() => setVenueId(l.otherVenue.id)}
                />
                {l.otherVenue.name}
              </label>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btnSecondary} disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={busy || !venueId}
            onClick={async () => {
              setBusy(true);
              try {
                const res = await fetch(`/api/venue/collectives/${collective.id}/members`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'invite', venueId }),
                });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error ?? 'Failed to invite venue.');
                onInvited();
              } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to invite venue.');
                setBusy(false);
              }
            }}
          >
            {busy ? 'Inviting…' : 'Send invitation'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

interface CatalogItem {
  id: string;
  name: string;
  is_active?: boolean;
}

function CatalogChooser({
  label,
  emptyHint,
  mode,
  onMode,
  items,
  selected,
  onToggle,
}: {
  label: string;
  emptyHint: string;
  mode: 'all' | 'specific';
  onMode: (m: 'all' | 'specific') => void;
  items: CatalogItem[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <div className="mt-1 flex gap-4 text-sm text-slate-700">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            className="border-slate-300"
            checked={mode === 'all'}
            onChange={() => onMode('all')}
          />
          Show all
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            className="border-slate-300"
            checked={mode === 'specific'}
            disabled={items.length === 0}
            onChange={() => onMode('specific')}
          />
          Choose specific
        </label>
      </div>
      {mode === 'specific' ? (
        items.length === 0 ? (
          <p className="mt-1 text-xs text-rose-700">{emptyHint}</p>
        ) : (
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {items.map((it) => (
              <label key={it.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="rounded border-slate-300"
                  checked={selected.has(it.id)}
                  onChange={() => onToggle(it.id)}
                />
                {it.name}
              </label>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}

function ConfigureVisibilityModal({
  collective,
  onClose,
  onSaved,
  onError,
}: {
  collective: CollectiveView;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const cfg = collective.myConfig;
  const [practitioners, setPractitioners] = useState<CatalogItem[]>([]);
  const [services, setServices] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pracMode, setPracMode] = useState<'all' | 'specific'>(
    cfg && cfg.visiblePractitionerIds.length > 0 ? 'specific' : 'all',
  );
  const [svcMode, setSvcMode] = useState<'all' | 'specific'>(
    cfg && cfg.visibleServiceIds.length > 0 ? 'specific' : 'all',
  );
  const [selP, setSelP] = useState<Set<string>>(new Set(cfg?.visiblePractitionerIds ?? []));
  const [selS, setSelS] = useState<Set<string>>(new Set(cfg?.visibleServiceIds ?? []));
  const [order, setOrder] = useState<number>(cfg?.displayOrder ?? 0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [pr, sr] = await Promise.all([
          fetch('/api/venue/practitioners'),
          fetch('/api/venue/appointment-services'),
        ]);
        const pj = pr.ok ? await pr.json() : { practitioners: [] };
        const sj = sr.ok ? await sr.json() : { services: [] };
        if (!alive) return;
        setPractitioners(
          ((pj.practitioners as CatalogItem[]) ?? []).filter((p) => p.is_active !== false),
        );
        setServices(((sj.services as CatalogItem[]) ?? []).filter((s) => s.is_active !== false));
      } catch {
        /* leave empty; the member can still choose "show all" */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const toggle = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const canSave =
    !busy &&
    !loading &&
    (pracMode === 'all' || selP.size > 0) &&
    (svcMode === 'all' || selS.size > 0);

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={`Your listing in ${collective.name}`}
      description="Choose which of your practitioners and services appear on the combined booking page. ‘Show all’ also includes anything you add later."
    >
      <div className="space-y-4">
        {loading ? (
          <div className="space-y-2" aria-busy="true">
            <span className="sr-only">Loading your practitioners and services…</span>
            <div className="skeleton h-9 rounded-lg" />
            <div className="skeleton h-24 rounded-lg" />
          </div>
        ) : (
          <>
            <CatalogChooser
              label="Practitioners shown"
              emptyHint="You have no active practitioners to choose from."
              mode={pracMode}
              onMode={setPracMode}
              items={practitioners}
              selected={selP}
              onToggle={(id) => setSelP((s) => toggle(s, id))}
            />
            <CatalogChooser
              label="Services shown"
              emptyHint="You have no active services to choose from."
              mode={svcMode}
              onMode={setSvcMode}
              items={services}
              selected={selS}
              onToggle={(id) => setSelS((s) => toggle(s, id))}
            />
            <label className="block">
              <span className="block text-sm font-medium text-slate-700">Display order</span>
              <input
                type="number"
                className={`mt-1 w-28 ${inputCls}`}
                value={order}
                min={0}
                max={999}
                onChange={(e) =>
                  setOrder(Math.min(999, Math.max(0, Number.parseInt(e.target.value, 10) || 0)))
                }
              />
              <span className="mt-1 block text-xs text-slate-400">
                Lower numbers appear earlier on the combined page.
              </span>
            </label>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btnSecondary} disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={!canSave}
            onClick={async () => {
              setBusy(true);
              try {
                const res = await fetch(`/api/venue/collectives/${collective.id}/members`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    action: 'configure',
                    visiblePractitionerIds: pracMode === 'all' ? [] : [...selP],
                    visibleServiceIds: svcMode === 'all' ? [] : [...selS],
                    displayOrder: order,
                  }),
                });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error ?? 'Failed to save your listing.');
                onSaved();
              } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to save your listing.');
                setBusy(false);
              }
            }}
          >
            {busy ? 'Saving…' : 'Save listing'}
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
