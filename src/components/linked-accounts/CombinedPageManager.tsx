'use client';

/**
 * Combined booking page manager (plan §7). The host curates the unified service
 * catalogue (pick services → offerings → assign each venue's calendars, creating
 * the service in a venue that lacks it) and chooses where the page is served; each
 * member approves the commercial terms for its own calendars (plan D6) and sets
 * its solo-page behaviour (D2).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, btnPrimary, btnSecondary, btnDanger } from './linked-accounts-ui';
import { type BookingPageConfig } from '@/lib/booking/booking-page-theme';
import { BookingPageEditor } from '@/components/booking-page-editor/BookingPageEditor';
import type {
  BookingPageEditorAdapter,
  EditorServiceItem,
  EditorTeamMember,
  ImportSource,
  SaveStatus,
} from '@/components/booking-page-editor/types';
import { collectiveSettingsToPreviewPublic } from '@/lib/linked-accounts/collective-settings-to-preview-public';
import type { CollectiveView } from '@/lib/linked-accounts/collectives';
import type { AccountLinkView } from '@/lib/linked-accounts/types';
import type {
  CatalogueManagementView,
  CatalogueItemView,
  CatalogueProviderView,
  CatalogueMemberSource,
} from '@/lib/linked-accounts/catalogue';

const inputCls =
  'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

function fmtPrice(p: number | null): string {
  return p == null ? '—' : `£${(p / 100).toFixed(2)}`;
}
function fmtDuration(m: number | null): string {
  return m == null ? '—' : `${m} min`;
}

/** Editor team list: calendars actually providing on the combined page, venue-qualified on name clash. */
function buildEditorTeam(catalogue: CatalogueManagementView | null): EditorTeamMember[] {
  if (!catalogue) return [];
  const byId = new Map<string, { name: string; venueName: string }>();
  for (const item of catalogue.items) {
    if (item.status !== 'active') continue;
    for (const p of item.providers) {
      if (p.status === 'removed' || !p.practitionerId) continue;
      if (!byId.has(p.practitionerId)) {
        byId.set(p.practitionerId, { name: p.practitionerName ?? 'Staff', venueName: p.venueName });
      }
    }
  }
  const nameCounts = new Map<string, number>();
  for (const { name } of byId.values()) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  return [...byId.entries()].map(([id, { name, venueName }]) => ({
    id,
    name: (nameCounts.get(name) ?? 0) > 1 ? `${name} · ${venueName}` : name,
  }));
}

type TabKey = 'page' | 'services' | 'members';

export function CombinedPageManager({
  collective,
  eligibleLinks,
  onClose,
  onChanged,
}: {
  collective: CollectiveView;
  /** Linked venues eligible to invite (full mutual create/edit/cancel). */
  eligibleLinks: AccountLinkView[];
  onClose: () => void;
  /** Called after a change that affects the collective list (settings/members). */
  onChanged: () => void;
}) {
  const [catalogue, setCatalogue] = useState<CatalogueManagementView | null>(null);
  const [importSources, setImportSources] = useState<ImportSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isHost = collective.isHost;
  const [tab, setTab] = useState<TabKey>('page');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/venue/collectives/${collective.id}/catalogue`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load the catalogue.');
      setCatalogue(json.catalogue ?? null);
      setImportSources(json.importSources ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the catalogue.');
    } finally {
      setLoading(false);
    }
  }, [collective.id]);

  useEffect(() => {
    void load();
  }, [load]);

  /** PATCH a catalogue action; refresh from the response. */
  const action = async (body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/venue/collectives/${collective.id}/catalogue`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Action failed.');
      if (json.catalogue) setCatalogue(json.catalogue);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** PATCH the collective settings (mode / address); refresh both views. */
  const settings = async (body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/venue/collectives/${collective.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to update settings.');
      onChanged();
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update settings.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** PATCH the members route (invite / remove / transfer host); refresh. */
  const memberAction = async (body: Record<string, unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/venue/collectives/${collective.id}/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Action failed.');
      onChanged();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const dissolve = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/venue/collectives/${collective.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error ?? 'Failed to dissolve the collective.');
      }
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dissolve the collective.');
      setBusy(false);
    }
  };

  // ── Shared booking-page editor (Page tab) — identical UI to a single venue ──
  const collectiveCover = (collective.bookingPageConfig as { cover_photo_url?: string | null } | null)
    ?.cover_photo_url;
  const [logoUrl, setLogoUrl] = useState<string | null>(
    (collective.branding?.logo_url as string | null) ?? null,
  );
  const [coverUrl, setCoverUrl] = useState<string | null>(collectiveCover ?? null);
  const [pageSave, setPageSave] = useState<{ status: SaveStatus; message: string | null }>({
    status: 'idle',
    message: null,
  });
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  // Reseed the image slots when the collective changes (mirrors the editor's config reseed).
  useEffect(() => {
    setLogoUrl((collective.branding?.logo_url as string | null) ?? null);
    setCoverUrl(
      ((collective.bookingPageConfig as { cover_photo_url?: string | null } | null)?.cover_photo_url) ??
        null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reseed only on entity switch
  }, [collective.id]);

  const pageReporter = useMemo(
    () => ({
      report: (next: { status?: SaveStatus; message?: string | null }) =>
        setPageSave((prev) => ({
          status: next.status ?? prev.status,
          message: next.message !== undefined ? next.message : prev.message,
        })),
    }),
    [],
  );

  /** PATCH the collective without a full reload (the editor owns its own state). */
  const patchCollective = useCallback(
    async (body: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
      const res = await fetch(`/api/venue/collectives/${collective.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to save.');
      return (json.collective ?? null) as Record<string, unknown> | null;
    },
    [collective.id],
  );

  const uploadPageAsset = useCallback(
    async (kind: string, file: File): Promise<string> => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/venue/collectives/${collective.id}/page-asset?kind=${kind}`, {
        method: 'POST',
        body: form,
      });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(json.error ?? 'Upload failed');
      return json.url as string;
    },
    [collective.id],
  );

  /** Stable so the editor's tab re-sync only fires when the stored config changes. */
  const getPageConfig = useCallback((): BookingPageConfig => {
    const cfg = { ...((collective.bookingPageConfig as Record<string, unknown> | null) ?? {}) };
    delete cfg.cover_photo_url;
    return cfg as BookingPageConfig;
  }, [collective.bookingPageConfig]);

  const savePageConfig = useCallback(
    async (config: BookingPageConfig): Promise<BookingPageConfig> => {
      const updated = await patchCollective({ bookingPageConfig: config });
      const saved = { ...(((updated?.bookingPageConfig as Record<string, unknown> | null)) ?? config) };
      delete (saved as Record<string, unknown>).cover_photo_url;
      return saved as BookingPageConfig;
    },
    [patchCollective],
  );

  const pageServices = useMemo<EditorServiceItem[]>(() => {
    if (!catalogue) return [];
    return catalogue.items
      .filter((i) => i.status === 'active')
      .map((i) => ({
        id: i.id,
        name: i.name,
        description: i.description,
        price_pence: i.defaultPricePence,
        duration_minutes: i.defaultDurationMinutes ?? undefined,
        imageUrl: i.imageUrl,
      }));
  }, [catalogue]);

  const pageTeam = useMemo<EditorTeamMember[]>(() => buildEditorTeam(catalogue), [catalogue]);

  const pageAdapter = useMemo<BookingPageEditorAdapter>(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const publicPath = `/book/c/${collective.slug}`;
    return {
      displayName: collective.name,
      publicUrl: `${origin}${publicPath}`,
      publicPath,
      seedKey: collective.id,
      getConfig: getPageConfig,
      savePatch: savePageConfig,
      addressSlot: (
        <div className="space-y-4">
          <PageNameField collective={collective} busy={busy} onSettings={settings} />
          <PageAddressSection collective={collective} busy={busy} onSettings={settings} />
        </div>
      ),
      logo: {
        getUrl: () => logoUrl,
        upload: (file) => uploadPageAsset('logo', file),
        saveUrl: async (url) => {
          await patchCollective({ logoUrl: url ?? '' });
          setLogoUrl(url);
          onChangedRef.current();
        },
      },
      cover: {
        getUrl: () => coverUrl,
        upload: (file) => uploadPageAsset('cover', file),
        saveUrl: async (url) => {
          await patchCollective({ coverPhotoUrl: url ?? '' });
          setCoverUrl(url);
        },
      },
      gallery: { upload: (file) => uploadPageAsset('gallery', file) },
      services: {
        list: pageServices,
        photo: {
          upload: (_offeringId, file) => uploadPageAsset('offering', file),
          save: async (offeringId, url) => {
            await action({ action: 'update_item', itemId: offeringId, imageUrl: url ?? '' });
          },
          removeStored: async (url) => {
            await fetch(`/api/venue/collectives/${collective.id}/page-asset?kind=offering`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url }),
            });
          },
        },
      },
      team: {
        list: pageTeam,
        uploadPhoto: (_memberId, file) => uploadPageAsset('team', file),
      },
      buildPreviewVenue: (draft) =>
        collectiveSettingsToPreviewPublic({
          id: collective.id,
          name: collective.name,
          slug: collective.slug,
          logoUrl,
          coverUrl,
          timezone: collective.timezone,
          draftConfig: draft,
        }),
      preserveScroll: async (task) => task(),
      capabilities: {
        isAppointmentVenue: true,
        canEdit: isHost,
        servicePhotosInConfig: false,
      },
      importSources,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- settings/action are stable enough; rebuild on the data deps below
  }, [collective, isHost, busy, logoUrl, coverUrl, importSources, pageServices, pageTeam, patchCollective, uploadPageAsset, getPageConfig, savePageConfig]);

  const tabs: { key: TabKey; label: string }[] = isHost
    ? [
        { key: 'page', label: 'Page' },
        { key: 'services', label: 'Services & calendars' },
        { key: 'members', label: 'Members' },
      ]
    : [];

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      maxWidth="max-w-5xl"
      title={`Combined booking page — ${collective.name}`}
      description={
        isHost
          ? 'Your combined page works like a single venue. Set it up here — design, services & calendars, members.'
          : 'This combined page is managed by the host venue.'
      }
    >
      {tabs.length > 1 ? (
        <div
          role="tablist"
          aria-label="Combined page settings"
          className="mb-4 flex gap-1 border-b border-slate-200"
        >
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              disabled={busy}
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                tab === t.key
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="max-h-[min(68vh,calc(100dvh-11rem))] space-y-5 overflow-y-auto pr-1">
        {error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            {error}
          </p>
        ) : null}

        {tab === 'page' && isHost ? (
          <div className="space-y-3">
            <div aria-live="polite" className="h-4 text-xs">
              {pageSave.status === 'saving' ? (
                <span className="text-amber-600">Saving…</span>
              ) : pageSave.status === 'saved' ? (
                <span className="text-emerald-600">{pageSave.message ?? 'Saved.'}</span>
              ) : pageSave.status === 'error' ? (
                <span className="text-rose-600">{pageSave.message ?? 'Save failed.'}</span>
              ) : null}
            </div>
            <BookingPageEditor adapter={pageAdapter} reporter={pageReporter} />
          </div>
        ) : null}

        {tab === 'members' && isHost ? (
          <MembersSection
            collective={collective}
            eligibleLinks={eligibleLinks}
            busy={busy}
            onMember={memberAction}
            onDissolve={dissolve}
          />
        ) : null}

        {tab === 'services' && isHost ? (
          loading ? (
            <div className="space-y-2" aria-busy="true">
              <span className="sr-only">Loading the catalogue…</span>
              <div className="skeleton h-20 rounded-xl" />
              <div className="skeleton h-20 rounded-xl" />
            </div>
          ) : catalogue ? (
            <HostCatalogue catalogue={catalogue} busy={busy} action={action} />
          ) : null
        ) : null}

        {!isHost ? (
          <p className="text-sm text-slate-600">
            Your services appear on this combined booking page using their own price, duration and
            availability from your Services settings. The host venue chooses which of your calendars
            are offered. To stop taking part, leave the collective from the Venue collectives list.
          </p>
        ) : null}
      </div>

      <div className="mt-5 flex justify-end">
        <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
          Done
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Booking page address (host) — the combined page works like one venue
// ---------------------------------------------------------------------------

function PageAddressSection({
  collective,
  busy,
  onSettings,
}: {
  collective: CollectiveView;
  busy: boolean;
  onSettings: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const adopt = collective.slugStrategy === 'adopt_member';
  return (
    <section className="space-y-2 rounded-xl border border-slate-200 p-4">
      <p className="text-sm font-bold text-slate-900">Booking page address</p>
      <p className="text-xs text-slate-500">
        Your combined page works like a single venue — one services menu and one team across all
        members. Choose where customers reach it.
      </p>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input
          type="radio"
          className="mt-0.5"
          name="slug-strategy"
          disabled={busy}
          checked={!adopt}
          onChange={() => void onSettings({ slugStrategy: 'dedicated' })}
        />
        <span>
          Dedicated address — <code className="text-xs">/book/c/{collective.slug}</code>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input
          type="radio"
          className="mt-0.5"
          name="slug-strategy"
          disabled={busy}
          checked={adopt}
          onChange={() => {
            const first = collective.members.find((m) => m.status === 'active');
            if (first) void onSettings({ slugStrategy: 'adopt_member', adoptedVenueId: first.venueId });
          }}
        />
        <span>Use a member venue’s existing booking address</span>
      </label>
      {adopt ? (
        <div className="ml-6">
          <select
            className={inputCls}
            disabled={busy}
            value={collective.adoptedVenueId ?? ''}
            onChange={(e) =>
              void onSettings({ slugStrategy: 'adopt_member', adoptedVenueId: e.target.value })
            }
          >
            {collective.members
              .filter((m) => m.status === 'active')
              .map((m) => (
                <option key={m.venueId} value={m.venueId}>
                  {m.venueName}
                </option>
              ))}
          </select>
          <p className="mt-1 text-xs text-amber-600">
            That venue’s own page will show the combined page. It can keep a separate page only under
            a new address.
          </p>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page name (host) — collective name field used in the editor's address slot
// ---------------------------------------------------------------------------

/** Page name (collective-only — single venues edit their name under Profile). */
function PageNameField({
  collective,
  busy,
  onSettings,
}: {
  collective: CollectiveView;
  busy: boolean;
  onSettings: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [name, setName] = useState(collective.name);
  const [save, setSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-sm font-medium text-slate-700">
        <span>Page name (shown to customers)</span>
        <span aria-live="polite" className="text-xs font-normal">
          {save === 'saving' ? (
            <span className="text-slate-400">Saving…</span>
          ) : save === 'saved' ? (
            <span className="text-emerald-600">Saved</span>
          ) : save === 'error' ? (
            <span className="text-rose-600">Couldn&rsquo;t save — try again</span>
          ) : null}
        </span>
      </span>
      <input
        className={inputCls}
        value={name}
        maxLength={120}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const v = name.trim();
          if (v.length < 2 || v === collective.name) return;
          setSave('saving');
          void onSettings({ name: v }).then((ok) => {
            if (!ok) {
              setSave('error');
              return;
            }
            setSave('saved');
            setTimeout(() => setSave((s) => (s === 'saved' ? 'idle' : s)), 2500);
          });
        }}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Members (host) — folded in from the collective row + "Invite venue"
// ---------------------------------------------------------------------------

function MembersSection({
  collective,
  eligibleLinks,
  busy,
  onMember,
  onDissolve,
}: {
  collective: CollectiveView;
  eligibleLinks: AccountLinkView[];
  busy: boolean;
  onMember: (body: Record<string, unknown>) => Promise<void>;
  onDissolve: () => Promise<void>;
}) {
  const memberVenueIds = new Set(collective.members.map((m) => m.venueId));
  const invitable = eligibleLinks.filter((l) => !memberVenueIds.has(l.otherVenue.id));
  const [inviteId, setInviteId] = useState('');
  const [pending, setPending] = useState<{
    message: string;
    confirmLabel: string;
    danger?: boolean;
    run: () => void;
  } | null>(null);

  return (
    <div className="space-y-4">
      {pending ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm text-slate-800">{pending.message}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className={pending.danger ? btnDanger : btnPrimary}
              disabled={busy}
              onClick={() => {
                const run = pending.run;
                setPending(null);
                run();
              }}
            >
              {pending.confirmLabel}
            </button>
            <button type="button" className={btnSecondary} disabled={busy} onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <section className="space-y-1.5 rounded-xl border border-slate-200 p-4">
        <p className="text-sm font-bold text-slate-900">Members</p>
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
                      setPending({
                        message: `Make ${m.venueName} the host? They will control this collective's settings and members; your venue becomes a regular member. Only the new host can transfer it back.`,
                        confirmLabel: 'Transfer host',
                        run: () => void onMember({ action: 'transfer_host', venueId: m.venueId }),
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
                      setPending({
                        message: `Remove ${m.venueName} from "${collective.name}"? It will no longer appear on the combined page.`,
                        confirmLabel: 'Remove member',
                        danger: true,
                        run: () => void onMember({ action: 'remove', venueId: m.venueId }),
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
      </section>

      <section className="space-y-2 rounded-xl border border-slate-200 p-4">
        <p className="text-sm font-bold text-slate-900">Invite a venue</p>
        {invitable.length === 0 ? (
          <p className="text-xs text-slate-500">
            No further venues with full create/edit/cancel links both ways are available to invite.
          </p>
        ) : (
          <div className="flex gap-2">
            <select
              className={inputCls}
              value={inviteId}
              disabled={busy}
              onChange={(e) => setInviteId(e.target.value)}
            >
              <option value="">Choose a venue…</option>
              {invitable.map((l) => (
                <option key={l.id} value={l.otherVenue.id}>
                  {l.otherVenue.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={btnSecondary}
              disabled={busy || !inviteId}
              onClick={() => {
                void onMember({ action: 'invite', venueId: inviteId });
                setInviteId('');
              }}
            >
              Send invitation
            </button>
          </div>
        )}
      </section>

      <div>
        <button
          type="button"
          className={btnDanger}
          disabled={busy}
          onClick={() =>
            setPending({
              message: `Dissolve "${collective.name}"? The combined booking page goes offline immediately. Each venue keeps its own page and data.`,
              confirmLabel: 'Dissolve collective',
              danger: true,
              run: () => void onDissolve(),
            })
          }
        >
          Dissolve collective
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Host catalogue builder
// ---------------------------------------------------------------------------

function HostCatalogue({
  catalogue,
  busy,
  action,
}: {
  catalogue: CatalogueManagementView;
  busy: boolean;
  action: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [newItemName, setNewItemName] = useState('');
  const activeItems = catalogue.items.filter((i) => i.status === 'active');

  return (
    <div className="space-y-4">
      <VenueServicesPicker
        memberSources={catalogue.memberSources}
        items={activeItems}
        busy={busy}
        action={action}
      />

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-2">
          <p className="text-sm font-bold text-slate-900">Offerings on your combined page</p>
        </div>
        {activeItems.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nothing on the page yet. Add services from your venues above, or create a custom offering
            below.
          </p>
        ) : (
          activeItems.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              memberSources={catalogue.memberSources}
              busy={busy}
              action={action}
            />
          ))
        )}
        <div className="flex gap-2">
          <input
            className={inputCls}
            placeholder="Custom offering name (e.g. 60-min Deep Tissue Massage)"
            value={newItemName}
            disabled={busy}
            onChange={(e) => setNewItemName(e.target.value)}
          />
          <button
            type="button"
            className={btnSecondary}
            disabled={busy || newItemName.trim().length === 0}
            onClick={async () => {
              const ok = await action({ action: 'create_item', name: newItemName.trim() });
              if (ok) setNewItemName('');
            }}
          >
            Add custom
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * The "choose what services to offer" view (plan §22). Lists each member venue's
 * bookable services with a checkbox; tick any number, then "Add selected" puts
 * them all on the combined page in one request (each becomes an offering seeded
 * with its venue's calendars). To offer the SAME service across venues you don't
 * merge anything — you open the offering below and tick the other venues' calendars
 * (a service is created in a venue automatically if it doesn't have it). A service
 * whose name already matches an offering on the page shows "On page" so you manage
 * it there instead of creating a duplicate.
 */
function VenueServicesPicker({
  memberSources,
  items,
  busy,
  action,
}: {
  memberSources: CatalogueMemberSource[];
  items: CatalogueItemView[];
  busy: boolean;
  action: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  // Offering names already on the page (active), for same-name de-duplication.
  // Plain trim+lowercase to match how a calendar's own service is matched when
  // assigning it (see CalendarRow.hasService) so the two views never disagree.
  const onPageNames = useMemo(
    () =>
      new Set(items.filter((i) => i.status === 'active').map((i) => i.name.trim().toLowerCase())),
    [items],
  );

  // Every service that can still be added, flattened with its venue. Keyed by
  // `${venueId}:${serviceId}` so selection survives across venues.
  const addable = useMemo(() => {
    const out: Array<{ key: string; venueId: string; id: string; name: string }> = [];
    for (const ms of memberSources) {
      for (const s of ms.services) {
        if (onPageNames.has(s.name.trim().toLowerCase())) continue;
        out.push({ key: `${ms.venueId}:${s.id}`, venueId: ms.venueId, id: s.id, name: s.name });
      }
    }
    return out;
  }, [memberSources, onPageNames]);

  const addableByKey = useMemo(() => new Map(addable.map((a) => [a.key, a])), [addable]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Only count selections that are still addable (a reload may have moved some
  // onto the page), so the button and counter never go stale.
  const selectedKeys = useMemo(
    () => [...selected].filter((k) => addableByKey.has(k)),
    [selected, addableByKey],
  );
  const selectedCount = selectedKeys.length;

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const allSelected = addable.length > 0 && selectedCount === addable.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(addable.map((a) => a.key)));

  // Addable keys grouped by venue, so each venue gets its own select-all control.
  const addableKeysByVenue = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const a of addable) {
      const list = map.get(a.venueId);
      if (list) list.push(a.key);
      else map.set(a.venueId, [a.key]);
    }
    return map;
  }, [addable]);

  const toggleVenue = (keys: string[], allOn: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (allOn) next.delete(k);
        else next.add(k);
      }
      return next;
    });

  const addSelected = async () => {
    const services = selectedKeys
      .map((k) => addableByKey.get(k))
      .filter((a): a is NonNullable<typeof a> => Boolean(a))
      // Just the name + which venue/service — price/duration/etc. live on each
      // venue's own service (no collective-level defaults).
      .map((a) => ({ name: a.name, venueId: a.venueId, sourceServiceId: a.id }));
    if (services.length === 0) return;
    const ok = await action({ action: 'create_items', services });
    if (ok) setSelected(new Set());
  };

  const anyServices = memberSources.some((m) => m.services.length > 0);

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900">Choose services to offer</p>
          <p className="mt-1 text-xs text-slate-500">
            Tick the services you want on the combined page, then add them together. To offer one at
            more than one venue, open the offering below and tick that venue&apos;s calendars — the
            service is created there automatically if it doesn&apos;t have it yet.
          </p>
        </div>
        {addable.length > 0 ? (
          <button
            type="button"
            className="shrink-0 text-xs font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-50"
            disabled={busy}
            onClick={toggleAll}
          >
            {allSelected ? 'Clear all' : 'Select all'}
          </button>
        ) : null}
      </div>
      {!anyServices ? (
        <p className="text-sm text-slate-500">No bookable services found in the member venues.</p>
      ) : (
        <>
          {memberSources.map((ms) => {
            const venueKeys = addableKeysByVenue.get(ms.venueId) ?? [];
            const venueAllSelected =
              venueKeys.length > 0 && venueKeys.every((k) => selected.has(k));
            return (
            <div key={ms.venueId} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
                  {ms.venueName}
                </p>
                {venueKeys.length > 0 ? (
                  <button
                    type="button"
                    className="shrink-0 text-[11px] font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-50"
                    disabled={busy}
                    onClick={() => toggleVenue(venueKeys, venueAllSelected)}
                  >
                    {venueAllSelected ? 'Clear' : 'Select all'}
                  </button>
                ) : null}
              </div>
              {ms.services.length === 0 ? (
                <p className="py-1 text-xs text-slate-400">No bookable services.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {ms.services.map((s) => {
                    const onPage = onPageNames.has(s.name.trim().toLowerCase());
                    const key = `${ms.venueId}:${s.id}`;
                    const meta = (
                      <span className="ml-2 text-xs text-slate-500">
                        {s.durationMinutes != null ? `${s.durationMinutes} min` : ''}
                        {s.pricePence != null ? ` · £${(s.pricePence / 100).toFixed(2)}` : ''}
                      </span>
                    );
                    if (onPage) {
                      return (
                        <li
                          key={s.id}
                          className="flex items-center justify-between gap-2 py-2 text-sm"
                        >
                          <span className="min-w-0 text-slate-700">
                            {s.name}
                            {meta}
                          </span>
                          <span className="shrink-0 text-xs font-medium text-slate-400">On page</span>
                        </li>
                      );
                    }
                    return (
                      <li key={s.id}>
                        <label className="flex cursor-pointer items-center gap-2 py-2 text-sm">
                          <input
                            type="checkbox"
                            className="rounded border-slate-300"
                            checked={selected.has(key)}
                            disabled={busy}
                            onChange={() => toggle(key)}
                          />
                          <span className="min-w-0 text-slate-700">
                            {s.name}
                            {meta}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            );
          })}
          {addable.length > 0 ? (
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <span className="text-xs text-slate-500">
                {selectedCount > 0 ? `${selectedCount} selected` : 'None selected'}
              </span>
              <div className="flex items-center gap-2">
                {selectedCount > 0 ? (
                  <button
                    type="button"
                    className="text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50"
                    disabled={busy}
                    onClick={() => setSelected(new Set())}
                  >
                    Clear
                  </button>
                ) : null}
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={busy || selectedCount === 0}
                  onClick={() => void addSelected()}
                >
                  {selectedCount > 0 ? `Add ${selectedCount} selected` : 'Add selected'}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function ItemCard({
  item,
  memberSources,
  busy,
  action,
}: {
  item: CatalogueItemView;
  memberSources: CatalogueMemberSource[];
  busy: boolean;
  action: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [name, setName] = useState(item.name);

  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <input
            className="w-full rounded border border-transparent px-1 py-0.5 text-sm font-bold text-slate-900 hover:border-slate-200 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            value={name}
            maxLength={160}
            disabled={busy}
            aria-label="Service name"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const v = name.trim();
              if (v.length >= 1 && v !== item.name) void action({ action: 'update_item', itemId: item.id, name: v });
              else if (v.length === 0) setName(item.name);
            }}
          />
          <p className="px-1 text-xs text-slate-500">
            {item.providers.length} calendar{item.providers.length === 1 ? '' : 's'} · customers see the
            “from” price
          </p>
        </div>
        <button
          type="button"
          className="text-xs font-medium text-rose-500 hover:text-rose-700 disabled:opacity-50"
          disabled={busy}
          onClick={() => void action({ action: 'archive_item', itemId: item.id })}
        >
          Remove offering
        </button>
      </div>

      <p className="mt-1 px-1 text-xs text-slate-500">
        Price, duration, description, photo, variants and add-ons all come from each venue&apos;s own
        service settings (Dashboard → Services). Here you only choose which calendars offer it.
      </p>

      <CalendarAssignment item={item} memberSources={memberSources} busy={busy} action={action} />
    </div>
  );
}

/**
 * Calendar-centric provider assignment (plan §23 / R1 + D1). Lists EVERY member
 * venue's calendars; tick which provide this offering — from any venue. A calendar
 * whose venue already has a same-named service is mapped to it; otherwise ticking
 * the box DUPLICATES the service into that venue (a real, same-named service it can
 * book and manage) so both venues can offer it.
 */
function CalendarAssignment({
  item,
  memberSources,
  busy,
  action,
}: {
  item: CatalogueItemView;
  memberSources: CatalogueMemberSource[];
  busy: boolean;
  action: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const providerByCalendar = new Map<string, CatalogueProviderView>();
  for (const p of item.providers) {
    if (p.status !== 'removed' && p.practitionerId) providerByCalendar.set(p.practitionerId, p);
  }
  const anyCalendars = memberSources.some((m) => m.practitioners.length > 0);

  return (
    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
      <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
        Calendars offering this
      </p>
      {!anyCalendars ? (
        <p className="text-xs text-slate-400">No calendars available in the member venues.</p>
      ) : (
        memberSources.map((ms) => (
          <div key={ms.venueId} className="space-y-0.5">
            <p className="text-xs font-medium text-slate-500">{ms.venueName}</p>
            {ms.practitioners.length === 0 ? (
              <p className="py-1 pl-1 text-xs text-slate-400">No calendars.</p>
            ) : (
              ms.practitioners.map((cal) => (
                <CalendarRow
                  key={cal.id}
                  item={item}
                  venueId={ms.venueId}
                  venueName={ms.venueName}
                  cal={cal}
                  provider={providerByCalendar.get(cal.id) ?? null}
                  busy={busy}
                  action={action}
                />
              ))
            )}
          </div>
        ))
      )}
    </div>
  );
}

function CalendarRow({
  item,
  venueId,
  venueName,
  cal,
  provider,
  busy,
  action,
}: {
  item: CatalogueItemView;
  venueId: string;
  venueName: string;
  cal: { id: string; name: string; services: { id: string; name: string }[] };
  provider: CatalogueProviderView | null;
  busy: boolean;
  action: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const checked = Boolean(provider);
  // Whether this calendar's venue already offers the service. If not, ticking the box
  // duplicates the service into that venue (a real, same-named service it can book + manage).
  const hasService = cal.services.some(
    (s) => s.name.trim().toLowerCase() === item.name.trim().toLowerCase(),
  );
  const willDuplicate = !checked && !hasService;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
      <label className="flex min-w-0 items-center gap-2">
        <input
          type="checkbox"
          className="rounded border-slate-300"
          checked={checked}
          disabled={busy}
          onChange={(e) => {
            if (!e.target.checked) {
              if (provider) void action({ action: 'remove_provider', providerId: provider.id });
              return;
            }
            void action({ action: 'add_provider', itemId: item.id, venueId, practitionerId: cal.id });
          }}
        />
        <span className="truncate text-slate-800">{cal.name}</span>
      </label>

      {checked && provider ? (
        <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
          <span>
            {fmtPrice(provider.effectivePricePence)} · {fmtDuration(provider.effectiveDurationMinutes)}
          </span>
          {provider.status === 'suspended' ? (
            <span className="font-medium text-amber-600">suspended</span>
          ) : null}
        </span>
      ) : willDuplicate ? (
        <span className="shrink-0 text-xs text-brand-600">adds “{item.name}” to {venueName}</span>
      ) : null}
    </div>
  );
}

