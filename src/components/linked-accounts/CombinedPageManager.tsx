'use client';

/**
 * Combined booking page manager (plan §7). The host curates the unified service
 * catalogue (pick services → offerings → assign each venue's calendars, creating
 * the service in a venue that lacks it) and chooses where the page is served; each
 * member approves the commercial terms for its own calendars (plan D6) and sets
 * its solo-page behaviour (D2).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, btnPrimary, btnSecondary, btnDanger } from './linked-accounts-ui';
import { collectivePublicPath, collectivePublicUrl } from '@/lib/linked-accounts/collective-public-url';
import { type BookingPageConfig } from '@/lib/booking/booking-page-theme';
import { BookingPageEditor } from '@/components/booking-page-editor/BookingPageEditor';
import { BookOpeningHours } from '@/components/booking/BookOpeningHours';
import {
  ServiceCategoriesManager,
  type ServiceCategoryApi,
} from '@/components/dashboard/appointment-services/ServiceCategoriesManager';
import { UNCATEGORISED_GROUP_LABEL, type ServiceCategoryRef } from '@/lib/booking/service-categories';
import { normaliseCategoryName } from '@/lib/linked-accounts/collective-categories';
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

/** Small spinner for the primary (brand-filled) action buttons. */
function ButtonSpinner() {
  return (
    <span
      className="mr-2 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
      aria-hidden
    />
  );
}

/**
 * Local overlay for the calendar-assignment checkboxes: the host ticks/unticks
 * calendars freely (no per-click server call), then "Save and close" applies every
 * change in one request. `get` returns the staged desire for a calendar (undefined
 * when it matches the server); `toggle` records or clears one change.
 */
type ProviderStaging = {
  get: (itemId: string, calendarId: string) => { desired: boolean; sync: boolean } | undefined;
  toggle: (
    itemId: string,
    venueId: string,
    calendarId: string,
    nextChecked: boolean,
    serverChecked: boolean,
    /** 'add' only: update the venue's existing same-named service to the origin's shape on save. */
    sync?: boolean,
  ) => void;
};

/**
 * A yes/no question asked with the app's own dialog rather than `window.confirm`.
 * The native dialog is blocked or auto-dismissed in some browsers (the desktop app's
 * pane among them), which silently answered "no" to every link and unlink here.
 */
type ConfirmRequest = { message: string; confirmLabel: string; resolve: (yes: boolean) => void };
type AskConfirm = (message: string, confirmLabel?: string) => Promise<boolean>;
const ConfirmContext = createContext<AskConfirm | null>(null);

/** "No" wherever the panel has not mounted the dialog (a test rendering a piece alone). */
function useAskConfirm(): AskConfirm {
  const ask = useContext(ConfirmContext);
  return ask ?? (async () => false);
}

function ConfirmDialog({ request, onDone }: { request: ConfirmRequest | null; onDone: () => void }) {
  if (!request) return null;
  const answer = (yes: boolean) => {
    request.resolve(yes);
    onDone();
  };
  return (
    <Modal
      open
      onClose={() => answer(false)}
      title={request.confirmLabel}
      maxWidth="max-w-md"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={() => answer(false)}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} onClick={() => answer(true)}>
            {request.confirmLabel}
          </button>
        </div>
      }
    >
      <div className="space-y-2 text-sm text-slate-700">
        {request.message.split('\n\n').map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>
    </Modal>
  );
}

/**
 * The copies of an offering that "Link all" would act on: every copy at another venue
 * that is not linked and in step, that is, independent copies (whether or not they
 * happen to match today), customised copies, and linked copies whose origin has moved
 * on. One entry per service, whatever number of calendars offer it. The origin itself
 * never counts.
 */
function copiesOutOfStep(item: CatalogueItemView): CatalogueProviderView[] {
  const seen = new Set<string>();
  const out: CatalogueProviderView[] = [];
  for (const p of item.providers) {
    if (p.status === 'removed' || seen.has(p.sourceServiceId)) continue;
    if (item.originVenueId && p.venueId === item.originVenueId) continue;
    const s = p.sync;
    if (s.state === 'none') continue;
    const linkedAndCurrent = s.state === 'linked' && s.inStep !== false;
    if (linkedAndCurrent) continue;
    seen.add(p.sourceServiceId);
    out.push(p);
  }
  return out;
}

function fmtPrice(p: number | null): string {
  return p == null ? '-' : `£${(p / 100).toFixed(2)}`;
}
function fmtDuration(m: number | null): string {
  return m == null ? '-' : `${m} min`;
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

const noop = (): void => {};

/**
 * The manager as a modal, opened from Linked accounts. The Booking Page tab
 * renders the same {@link CombinedPageManagerPanel} inline.
 */
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
  return (
    <CombinedPageManagerPanel
      collective={collective}
      eligibleLinks={eligibleLinks}
      onClose={onClose}
      onChanged={onChanged}
    />
  );
}

export function CombinedPageManagerPanel({
  collective,
  eligibleLinks,
  onClose = noop,
  onChanged,
  inline = false,
  onPendingChange,
}: {
  collective: CollectiveView;
  /** Linked venues eligible to invite (full mutual create/edit/cancel). */
  eligibleLinks: AccountLinkView[];
  /** Modal only: dismiss. Inline there is nothing to close. */
  onClose?: () => void;
  /** Called after a change that affects the collective list (settings/members). */
  onChanged: () => void;
  /**
   * Render as a section of the page (Settings, Booking Page tab) instead of a
   * modal: no title, and a save bar under the body while calendar changes are staged.
   */
  inline?: boolean;
  /** Inline: the number of staged calendar changes, so the page can warn before leaving. */
  onPendingChange?: (count: number) => void;
}) {
  const [catalogue, setCatalogue] = useState<CatalogueManagementView | null>(null);
  const [importSources, setImportSources] = useState<ImportSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isHost = collective.isHost;
  const [tab, setTab] = useState<TabKey>('page');

  // Staged calendar-assignment changes (Services & calendars tab), keyed by
  // `${itemId}::${calendarId}`. Applied together by "Save and close".
  const [pendingProviders, setPendingProviders] = useState<
    Record<string, { itemId: string; venueId: string; calendarId: string; desired: boolean; sync: boolean }>
  >({});
  const [savingProviders, setSavingProviders] = useState(false);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const ask = useCallback<AskConfirm>(
    (message, confirmLabel = 'Confirm') =>
      new Promise<boolean>((resolve) => setConfirmRequest({ message, confirmLabel, resolve })),
    [],
  );

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

  /**
   * PATCH a catalogue action and refresh from the response. Throws the server's
   * message on failure so a caller with its own error surface can show it.
   */
  const actionResult = useCallback(
    async (body: Record<string, unknown>): Promise<CatalogueManagementView> => {
      setBusy(true);
      try {
        const res = await fetch(`/api/venue/collectives/${collective.id}/catalogue`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Action failed.');
        if (json.catalogue) setCatalogue(json.catalogue);
        return json.catalogue as CatalogueManagementView;
      } finally {
        setBusy(false);
      }
    },
    [collective.id],
  );

  /** PATCH a catalogue action; surfaces failure in the manager's own banner. */
  const action = async (body: Record<string, unknown>): Promise<boolean> => {
    setError(null);
    try {
      await actionResult(body);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
      return false;
    }
  };

  /** The shared category manager, writing through catalogue actions instead of venue routes. */
  const categoryApi = useMemo<ServiceCategoryApi>(
    () => ({
      create: async (name) => {
        const next = await actionResult({ action: 'create_category', categoryName: name });
        const key = normaliseCategoryName(name);
        const ref = next.categories.find((c) => normaliseCategoryName(c.name) === key);
        if (!ref) throw new Error('The category was created but could not be found. Refresh the page.');
        return ref;
      },
      rename: async (id, name) => {
        const next = await actionResult({ action: 'rename_category', categoryId: id, categoryName: name });
        const ref = next.categories.find((c) => c.id === id);
        if (!ref) throw new Error('That category no longer exists. Refresh the page and try again.');
        return ref;
      },
      remove: async (id) => {
        await actionResult({ action: 'delete_category', categoryId: id });
      },
      reorder: async (ids) => {
        await actionResult({ action: 'reorder_categories', categoryIds: ids });
      },
    }),
    [actionResult],
  );

  // Read/record staged calendar-assignment changes. Toggling a calendar back to its
  // server state clears the entry, so a tick-then-untick nets to nothing.
  const providerStaging = useMemo<ProviderStaging>(
    () => ({
      get: (itemId, calendarId) => {
        const entry = pendingProviders[`${itemId}::${calendarId}`];
        return entry ? { desired: entry.desired, sync: entry.sync } : undefined;
      },
      toggle: (itemId, venueId, calendarId, nextChecked, serverChecked, sync = false) =>
        setPendingProviders((prev) => {
          const key = `${itemId}::${calendarId}`;
          const next = { ...prev };
          if (nextChecked === serverChecked) delete next[key];
          else next[key] = { itemId, venueId, calendarId, desired: nextChecked, sync };
          return next;
        }),
    }),
    [pendingProviders],
  );

  // The staged changes as server ops, recomputed against the current catalogue so a
  // reload (e.g. after adding services) or an archived offering can never leave a
  // stale op behind.
  const providerOps = useMemo<
    Array<
      | { op: 'add'; itemId: string; venueId: string; practitionerId: string; sync?: boolean }
      | { op: 'remove'; providerId: string }
    >
  >(() => {
    if (!catalogue) return [];
    const ops: Array<
      | { op: 'add'; itemId: string; venueId: string; practitionerId: string; sync?: boolean }
      | { op: 'remove'; providerId: string }
    > = [];
    for (const entry of Object.values(pendingProviders)) {
      const item = catalogue.items.find((i) => i.id === entry.itemId && i.status === 'active');
      if (!item) continue;
      const provider = item.providers.find(
        (p) => p.practitionerId === entry.calendarId && p.status !== 'removed',
      );
      if (entry.desired && !provider) {
        ops.push({
          op: 'add',
          itemId: entry.itemId,
          venueId: entry.venueId,
          practitionerId: entry.calendarId,
          ...(entry.sync ? { sync: true } : {}),
        });
      } else if (!entry.desired && provider) {
        ops.push({ op: 'remove', providerId: provider.id });
      }
    }
    return ops;
  }, [catalogue, pendingProviders]);

    const pendingCount = providerOps.length;

  useEffect(() => {
    onPendingChange?.(pendingCount);
  }, [pendingCount, onPendingChange]);
  // Leaving the inline panel (unmount) drops its staged changes with it.
  useEffect(() => () => onPendingChange?.(0), [onPendingChange]);

  /**
   * Apply every staged calendar change in one request; the modal then closes,
   * the inline panel stays put.
   */
  const saveAndClose = async (): Promise<void> => {
    if (pendingCount === 0) {
      if (!inline) onClose();
      return;
    }
    setSavingProviders(true);
    const ok = await action({ action: 'set_providers', ops: providerOps });
    setSavingProviders(false);
    if (ok) {
      setPendingProviders({});
      if (!inline) onClose();
    }
  };

  /** Dismissal (overlay / Escape / Done): warn before discarding staged changes. */
  const requestClose = (): void => {
    if (pendingCount > 0) {
      void ask('You have unsaved calendar changes. Discard them and close?', 'Discard changes').then((yes) => {
        if (yes) onClose();
      });
      return;
    }
    onClose();
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
      // Inline, the settings page re-renders without the collective once it refreshes.
      if (!inline) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dissolve the collective.');
      setBusy(false);
    }
  };

  // ── Shared booking-page editor (Page tab), identical UI to a single venue ──
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
    const categoryById = new Map(catalogue.categories.map((c) => [c.id, c]));
    return catalogue.items
      .filter((i) => i.status === 'active')
      .map((i, index) => ({
        id: i.id,
        name: i.name,
        description: i.description,
        price_pence: i.defaultPricePence,
        duration_minutes: i.defaultDurationMinutes ?? undefined,
        imageUrl: i.imageUrl,
        // The preview groups as the live page does.
        category: i.categoryId ? categoryById.get(i.categoryId) ?? null : null,
        sort_order: index,
      }));
  }, [catalogue]);

  const pageTeam = useMemo<EditorTeamMember[]>(() => buildEditorTeam(catalogue), [catalogue]);

  const pageAdapter = useMemo<BookingPageEditorAdapter>(() => {
        // The address customers actually use: a member venue's own page when the
    // collective adopted it, otherwise the dedicated combined address.
    const publicPath = collectivePublicPath(collective);
    return {
      displayName: collective.name,
      publicUrl: collectivePublicUrl(collective),
      publicPath,
      seedKey: collective.id,
      getConfig: getPageConfig,
      savePatch: savePageConfig,
      addressSlot: (
        <div className="space-y-4">
          <PageNameField collective={collective} busy={busy} onSettings={settings} />
          <PageAddressSection collective={collective} busy={busy} onSettings={settings} />
          <CombinedPageAboutSection collective={collective} />
          <HostInheritedSettingsNote collective={collective} />
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
          anyAvailablePractitioner: collective.hostAnyAvailablePractitioner,
          staffFirstBookingFlow: collective.hostStaffFirstBookingFlow,
        }),
      preserveScroll: async (task) => task(),
      capabilities: {
        isAppointmentVenue: true,
        canEdit: isHost,
        servicePhotosInConfig: false,
        inheritsFromHostName: hostVenueName(collective),
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

    const pendingLabel =
    pendingCount > 0 ? `${pendingCount} unsaved calendar change${pendingCount === 1 ? '' : 's'}` : null;

  const body = (
    <ConfirmContext.Provider value={ask}>
      <ConfirmDialog request={confirmRequest} onDone={() => setConfirmRequest(null)} />
      {tabs.length > 1 ? (
        <div
          role="tablist"
          aria-label="Combined page settings"
          className="-mx-6 mb-4 flex gap-1 overflow-x-auto border-b border-slate-200 px-6 sm:mx-0 sm:px-0"
        >
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              disabled={busy}
              onClick={() => setTab(t.key)}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-2 py-2.5 text-sm font-medium transition sm:px-3 sm:py-2 ${
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

      <div className="space-y-5">
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
            <HostCatalogue
              catalogue={catalogue}
              busy={busy}
              action={action}
              categoryApi={categoryApi}
              providerStaging={providerStaging}
            />
          ) : null
        ) : null}

                {!isHost ? (
          <CombinedPageMemberSummary collective={collective} catalogue={catalogue} loading={loading} />
        ) : null}
      </div>
    </ConfirmContext.Provider>
  );

  if (inline) {
    return (
      <div className="space-y-4" data-testid="combined-page-panel">
        {body}
        {pendingCount > 0 ? (
          <div
            className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-3 rounded-xl border border-amber-200 bg-amber-50/95 px-4 py-3 shadow-sm backdrop-blur"
            data-testid="combined-page-save-bar"
          >
            <span className="text-xs text-amber-700">{pendingLabel}</span>
            <button
              type="button"
              className={`${btnPrimary} w-full sm:w-auto`}
              onClick={() => void saveAndClose()}
              disabled={busy}
            >
              {savingProviders ? <ButtonSpinner /> : null}
              Save calendar changes
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Modal
      open
      onClose={requestClose}
      busy={busy}
      maxWidth="max-w-5xl"
      title={`Combined booking page: ${collective.name}`}
      description={
        isHost
          ? 'Your combined page works like a single venue. Set it up here: design, services & calendars, and members.'
          : 'This combined page is managed by the host venue.'
      }
      footer={
        <div className="flex flex-wrap items-center justify-end gap-3">
          {pendingLabel ? <span className="text-xs text-amber-600">{pendingLabel}</span> : null}
          <button
            type="button"
            className={`${pendingCount > 0 ? btnPrimary : btnSecondary} w-full sm:w-auto`}
            onClick={() => (pendingCount > 0 ? void saveAndClose() : requestClose())}
            disabled={busy}
          >
            {savingProviders ? <ButtonSpinner /> : null}
            {pendingCount > 0 ? 'Save and close' : 'Done'}
          </button>
        </div>
      }
    >
      {body}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// The combined page's address, with copy and open
// ---------------------------------------------------------------------------

/** The full combined-page address with Copy link and Open buttons. */
export function CombinedPageAddressRow({ collective }: { collective: CollectiveView }) {
  const [copied, setCopied] = useState(false);
  const path = collectivePublicPath(collective);
  const [url, setUrl] = useState(path);
  // The origin is only known in the browser; render the path first so server
  // and client markup agree.
  useEffect(() => {
    setUrl(collectivePublicUrl(collective));
  }, [collective]);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      window.prompt('Copy the address', url);
    }
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center" data-testid="combined-page-address">
      <input
        type="text"
        readOnly
        aria-label="Combined page address"
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
      />
      <div className="flex shrink-0 gap-2">
        <button type="button" className={btnSecondary} onClick={() => void copy()} aria-live="polite">
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <a href={path} target="_blank" rel="noopener noreferrer" className={btnSecondary}>
          Open
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A member venue's read-only view of the combined page
// ---------------------------------------------------------------------------

/**
 * What a non-host member sees: who manages the page, its address, and which of
 * this venue's calendars and services take part. Loads the catalogue itself
 * when the caller has none (the Booking Page tab).
 */
export function CombinedPageMemberSummary({
  collective,
  catalogue: given,
  loading: givenLoading,
}: {
  collective: CollectiveView;
  catalogue?: CatalogueManagementView | null;
  loading?: boolean;
}) {
  const selfLoad = given === undefined;
  const [own, setOwn] = useState<CatalogueManagementView | null>(null);
  const [ownLoading, setOwnLoading] = useState(selfLoad);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!selfLoad) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/venue/collectives/${collective.id}/catalogue`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Failed to load the combined page.');
        if (!cancelled) setOwn(json.catalogue ?? null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load the combined page.');
      } finally {
        if (!cancelled) setOwnLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selfLoad, collective.id]);

  const catalogue = selfLoad ? own : given;
  const loading = selfLoad ? ownLoading : (givenLoading ?? false);
  const host = hostVenueName(collective);

  // This venue's calendars on the page, each with the services it provides there.
  const calendars = useMemo(() => {
    const byCalendar = new Map<string, { name: string; services: string[] }>();
    if (!catalogue) return [];
    for (const item of catalogue.items) {
      if (item.status !== 'active') continue;
      for (const p of item.providers) {
        if (p.venueId !== collective.myVenueId || p.status === 'removed' || !p.practitionerId) continue;
        const entry = byCalendar.get(p.practitionerId) ?? { name: p.practitionerName ?? 'Calendar', services: [] };
        if (!entry.services.includes(item.name)) entry.services.push(item.name);
        byCalendar.set(p.practitionerId, entry);
      }
    }
    return [...byCalendar.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [catalogue, collective.myVenueId]);

  return (
    <div className="space-y-5" data-testid="combined-page-member-summary">
      <p className="text-sm text-slate-600">
        {host} hosts {collective.name} and manages its combined booking page: the services on it, which
        calendars are offered, its headings, photos and branding. Your services appear there with the
        price, length and availability set under your own Services settings.
      </p>
      <section className="space-y-2 rounded-xl border border-slate-200 p-4">
        <p className="text-sm font-bold text-slate-900">Combined page address</p>
        <p className="text-xs text-slate-500">This is the page to send your guests to.</p>
        <CombinedPageAddressRow collective={collective} />
      </section>
      <CombinedPageAboutSection collective={collective} />
      <section className="space-y-2 rounded-xl border border-slate-200 p-4">
        <p className="text-sm font-bold text-slate-900">Your calendars on the combined page</p>
        {error ? (
          <p className="text-sm text-rose-700" role="alert">
            {error}
          </p>
        ) : loading ? (
          <div className="space-y-2" aria-busy="true">
            <span className="sr-only">Loading your calendars…</span>
            <div className="skeleton h-10 rounded-lg" />
            <div className="skeleton h-10 rounded-lg" />
          </div>
        ) : calendars.length === 0 ? (
          <p className="text-sm text-slate-600">
            None of your calendars is offered on the combined page yet. {host} chooses which calendars
            take part.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {calendars.map((c) => (
              <li key={c.name} className="flex flex-col gap-0.5 py-2 text-sm">
                <span className="font-medium text-slate-900">{c.name}</span>
                <span className="text-xs text-slate-500">{c.services.join(', ')}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-500">
          {host} chooses which calendars are offered. To stop taking part, leave the collective under{' '}
          <a href="/dashboard/settings?tab=linked-accounts" className="font-medium text-brand-700 hover:underline">
            Linked accounts
          </a>
          .
        </p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Booking page address (host): the combined page works like one venue
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
  const adoptedSlug = adopt
    ? (collective.members.find((m) => m.venueId === collective.adoptedVenueId)?.venueSlug ?? null)
    : null;
  return (
    <section className="space-y-2 rounded-xl border border-slate-200 p-4">
      <p className="text-sm font-bold text-slate-900">Booking page address</p>
      <p className="text-xs text-slate-500">
        Your combined page works like a single venue, with one services menu and one team across all
        members. Choose where customers reach it.
      </p>
            <CombinedPageAddressRow collective={collective} />
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
          Dedicated address: <code className="text-xs">/book/c/{collective.slug}</code>
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
          {adoptedSlug ? (
            <p className="mt-1 text-xs text-slate-600">
              Customers reach it at <code className="text-xs">/book/{adoptedSlug}</code>.
            </p>
          ) : null}
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
// Settings the combined page follows from the host venue
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// About: the contact details and opening hours the combined page shows
// ---------------------------------------------------------------------------

/**
 * Read-only. The combined page has no contact details or opening hours of its
 * own: its header and About tab show the HOST venue's, read from the same
 * columns the public page reads. The section says where they come from, how to
 * change them, and, the part that catches people out, that the hours shown are
 * information only: what a customer can actually book on each calendar is
 * decided by that calendar's own venue account, in its own business hours,
 * closures and calendar hours.
 */
function CombinedPageAboutSection({ collective }: { collective: CollectiveView }) {
  const host = hostVenueName(collective);
  const contact = collective.hostContact ?? null;
  const website = contact?.websiteUrl ?? null;
  const websiteHref = website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : null;
  const hours = contact?.openingHours ?? null;
  const hoursSet = Boolean(hours && Object.keys(hours).length > 0);
  const notSet = <span className="text-slate-400">Not set</span>;
  const rowLabel = 'shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:w-28';
  const settingsLink = 'font-semibold text-brand-700 underline decoration-brand-200 underline-offset-2 hover:text-brand-900';

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 p-4" data-testid="combined-page-about">
      <div>
        <p className="text-sm font-bold text-slate-900">About: contact details and opening hours</p>
        <p className="mt-1 text-xs text-slate-600">
          What the combined page shows in its header and About tab. These are {host}&rsquo;s details:
          the combined page has none of its own.
        </p>
      </div>

      <dl className="space-y-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
          <dt className={rowLabel}>Phone</dt>
          <dd className="text-sm text-slate-800">{contact?.phone ?? notSet}</dd>
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
          <dt className={rowLabel}>Website</dt>
          <dd className="min-w-0 break-words text-sm text-slate-800 [overflow-wrap:anywhere]">
            {website && websiteHref ? (
              <a href={websiteHref} target="_blank" rel="noopener noreferrer" className={settingsLink}>
                {website}
              </a>
            ) : (
              notSet
            )}
          </dd>
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
          <dt className={rowLabel}>Address</dt>
          <dd className="text-sm text-slate-800">{contact?.address ?? notSet}</dd>
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-4">
          <dt className={rowLabel}>Opening hours</dt>
          <dd className="min-w-0 flex-1 text-sm text-slate-800 sm:max-w-sm">
            {hoursSet && hours ? <BookOpeningHours hours={hours} variant="expanded" /> : notSet}
          </dd>
        </div>
      </dl>

      <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
        <p>
          <span className="font-semibold text-slate-800">Where they come from.</span> {host} sets the phone,
          website and address under Settings, Profile, and the opening hours under Settings, Business
          hours. There is no separate copy for the combined page, so a change there shows on the page
          straight away.
          {collective.isHost ? (
            <>
              {' '}
              <a href="/dashboard/settings?tab=profile" className={settingsLink}>
                Edit contact details
              </a>
              {' or '}
              <a href="/dashboard/settings?tab=business-hours" className={settingsLink}>
                edit opening hours
              </a>
              .
            </>
          ) : (
            <> To change them, ask {host}.</>
          )}
        </p>
        <p>
          <span className="font-semibold text-slate-800">What customers can book.</span> The hours above
          are information for customers. They do not decide availability. Each linked account sets its
          own business hours, closures and calendar hours for its own people, and the combined page
          offers a time on a calendar only when that calendar&rsquo;s own account says it is free. So a
          calendar at another venue can be open outside the hours shown here, or closed inside them.
        </p>
        <p>
          <span className="font-semibold text-slate-800">Keeping them in step.</span> Keep your own
          venue&rsquo;s hours right under{' '}
          <a href="/dashboard/settings?tab=business-hours" className={settingsLink}>
            Business hours
          </a>{' '}
          and each person&rsquo;s hours under{' '}
          <a href="/dashboard/calendar-availability" className={settingsLink}>
            Availability
          </a>
          , since those are what bookings into your calendars follow. If the venues keep different
          hours, the header cannot match every calendar: {host}&rsquo;s business hours are the ones to
          set to describe the group as a whole.
        </p>
      </div>
    </section>
  );
}

function hostVenueName(collective: CollectiveView): string {
  return (
    collective.members.find((m) => m.venueId === collective.hostVenueId)?.venueName ??
    'the host venue'
  );
}

/**
 * The combined page has no settings of its own for the things below: it works
 * like one venue and follows the HOST venue. Say so, because a host looking for
 * these switches here would otherwise conclude the combined page cannot do them.
 */
function HostInheritedSettingsNote({ collective }: { collective: CollectiveView }) {
  const host = hostVenueName(collective);
  return (
    <section className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-bold text-slate-900">Settings that follow the host venue</p>
      <p className="text-xs text-slate-600">
        Your combined page follows {host} for these. Change them in that venue&rsquo;s Settings
        and the combined page updates with it.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
        <li>
          Any available practitioner (currently{' '}
          {collective.hostAnyAvailablePractitioner ? 'on' : 'off'}) and staff-first booking
          (currently {collective.hostStaffFirstBookingFlow ? 'on' : 'off'}): Settings, Booking
          settings.
        </li>
        <li>Address, phone and website shown in the header: Settings, Profile. Opening hours: Settings, Business hours.</li>
        <li>Currency and wording (for example &ldquo;appointment&rdquo;): Settings, Profile.</li>
      </ul>
      <p className="text-xs text-slate-600">
        Prices, durations, deposits and cancellation notice come from each member venue&rsquo;s own
        service, because every booking is made with that venue. If any member requires customers to
        sign in to book, the combined page asks them to sign in too.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page name (host): collective name field used in the editor's address slot
// ---------------------------------------------------------------------------

/** Page name (collective-only; single venues edit their name under Profile). */
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
            <span className="text-rose-600">Couldn&rsquo;t save, try again</span>
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
// Members (host): folded in from the collective row + "Invite venue"
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
          <div className="mt-2 flex flex-wrap gap-2">
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
                    className="min-h-9 px-1 text-xs font-medium text-slate-500 hover:text-brand-700 disabled:opacity-50"
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
                    className="min-h-9 px-1 text-xs font-medium text-rose-500 hover:text-rose-700 disabled:opacity-50"
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
          <div className="flex flex-col gap-2 sm:flex-row">
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
              className={`${btnSecondary} shrink-0`}
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
  categoryApi,
  providerStaging,
}: {
  catalogue: CatalogueManagementView;
  busy: boolean;
  action: (body: Record<string, unknown>) => Promise<boolean>;
  categoryApi: ServiceCategoryApi;
  providerStaging: ProviderStaging;
}) {
  const [newItemName, setNewItemName] = useState('');
  const activeItems = catalogue.items.filter((i) => i.status === 'active');

  // Offerings under their headings, in page order, uncategorised last.
  const categoryById = new Map(catalogue.categories.map((c) => [c.id, c]));
  const buckets = new Map<string | null, CatalogueItemView[]>();
  for (const item of activeItems) {
    const key = item.categoryId && categoryById.has(item.categoryId) ? item.categoryId : null;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  const groups: Array<{ id: string | null; name: string; items: CatalogueItemView[] }> = [];
  for (const category of catalogue.categories) {
    const bucket = buckets.get(category.id);
    if (bucket) groups.push({ id: category.id, name: category.name, items: bucket });
  }
  const rest = buckets.get(null);
  if (rest) groups.push({ id: null, name: groups.length > 0 ? UNCATEGORISED_GROUP_LABEL : '', items: rest });

  const serviceCountByCategory = new Map<string, number>();
  for (const item of activeItems) {
    if (item.categoryId) serviceCountByCategory.set(item.categoryId, (serviceCountByCategory.get(item.categoryId) ?? 0) + 1);
  }
  const uncategorisedCount = rest?.length ?? 0;

  return (
    <div className="space-y-4">
      <VenueServicesPicker
        memberSources={catalogue.memberSources}
        items={activeItems}
        busy={busy}
        action={action}
      />

      <ServiceCategoriesManager
        categories={catalogue.categories}
        serviceCountByCategory={serviceCountByCategory}
        uncategorisedCount={uncategorisedCount}
        isAdmin
        api={categoryApi}
        onChange={() => {}}
        settingsHint="Choose how categories look on the page, as sections with a menu or as collapsible headings, on the Page tab."
        uncategorisedHint="Pick a category on each offering below, or match them from your venues."
      />

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900">Offerings on your combined page</p>
            <p className="mt-1 text-xs text-slate-500">
              Each offering lists the calendars that provide it. A calendar at another venue uses that
              venue&apos;s own copy of the service. A <span className="font-medium">linked</span> copy
              follows the original&apos;s duration, buffer, processing periods and options whenever the
              original is saved, and its add-ons are matched whenever it is linked or updated; price
              and description are always the venue&apos;s own.
            </p>
          </div>
          <LinkAllCopiesButtons items={activeItems} busy={busy} action={action} />
          {uncategorisedCount > 0 ? (
            <button
              type="button"
              className={btnSecondary}
              disabled={busy}
              title="Files each offering without a category under the heading its service has at its own venue."
              onClick={() => void action({ action: 'sync_categories' })}
            >
              Match categories from your venues
            </button>
          ) : null}
        </div>
        {activeItems.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nothing on the page yet. Add services from your venues above, or create a custom offering
            below.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.id ?? 'other'} className="space-y-3">
              {group.name ? (
                <div className="flex items-baseline justify-between gap-3 pt-1">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group.name}</h3>
                  <span className="text-xs text-slate-400">
                    {group.items.length} offering{group.items.length === 1 ? '' : 's'}
                  </span>
                </div>
              ) : null}
              {group.items.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  categories={catalogue.categories}
                  memberSources={catalogue.memberSources}
                  busy={busy}
                  action={action}
                  providerStaging={providerStaging}
                />
              ))}
            </div>
          ))
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className={inputCls}
            placeholder="Custom offering name (e.g. 60-min Deep Tissue Massage)"
            value={newItemName}
            disabled={busy}
            onChange={(e) => setNewItemName(e.target.value)}
          />
          <button
            type="button"
            className={`${btnSecondary} shrink-0`}
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
 * merge anything. You open the offering below and tick the other venues' calendars
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

  const [adding, setAdding] = useState(false);
  const addSelected = async () => {
    const services = selectedKeys
      .map((k) => addableByKey.get(k))
      .filter((a): a is NonNullable<typeof a> => Boolean(a))
      // Just the name + which venue/service; price/duration/etc. live on each
      // venue's own service (no collective-level defaults).
      .map((a) => ({ name: a.name, venueId: a.venueId, sourceServiceId: a.id }));
    if (services.length === 0) return;
    setAdding(true);
    const ok = await action({ action: 'create_items', services });
    setAdding(false);
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
            more than one venue, open the offering below and tick that venue&apos;s calendars. If the
            venue does not have the service, an exact copy is created there and linked to the
            original; if it already has one with the same name, you are asked whether to link it.
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
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
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
                  {adding ? <ButtonSpinner /> : null}
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
  categories,
  memberSources,
  busy,
  action,
  providerStaging,
}: {
  item: CatalogueItemView;
  categories: ServiceCategoryRef[];
  memberSources: CatalogueMemberSource[];
  busy: boolean;
  action: (body: Record<string, unknown>) => Promise<boolean>;
  providerStaging: ProviderStaging;
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
            {item.providers.length} calendar{item.providers.length === 1 ? '' : 's'}
            {item.pricingDisplay === 'from' ? ' · customers see the “from” price' : ''}
          </p>
          {categories.length > 0 ? (
            <label className="mt-1 flex items-center gap-2 px-1 text-xs text-slate-600">
              <span>Category</span>
              <select
                value={item.categoryId ?? ''}
                disabled={busy}
                onChange={(e) =>
                  void action({ action: 'update_item', itemId: item.id, categoryId: e.target.value || null })
                }
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <LinkOfferingCopiesButton item={item} busy={busy} action={action} />
          <UnlinkOfferingCopiesButton item={item} busy={busy} action={action} />
          <button
            type="button"
            className="text-xs font-medium text-rose-500 hover:text-rose-700 disabled:opacity-50"
            disabled={busy}
            onClick={() => void action({ action: 'archive_item', itemId: item.id })}
          >
            Remove offering
          </button>
        </div>
      </div>

      <p className="mt-1 px-1 text-xs text-slate-500">
        Tick the calendars that offer it. Each row at another venue shows whether that venue&apos;s copy
        is linked to the original and up to date, with a button for the next step. The photo for this
        shared page is set on the Page tab.
      </p>

      <CalendarAssignment
        item={item}
        memberSources={memberSources}
        busy={busy}
        action={action}
        providerStaging={providerStaging}
      />
    </div>
  );
}

/**
 * Calendar-centric provider assignment (plan §23 / R1 + D1). Lists EVERY member
 * venue's calendars; tick which provide this offering, from any venue. A calendar
 * whose venue already has a same-named service is mapped to it; otherwise ticking
 * the box DUPLICATES the service into that venue (a real, same-named service it can
 * book and manage) so both venues can offer it.
 */
function CalendarAssignment({
  item,
  memberSources,
  busy,
  action,
  providerStaging,
}: {
  item: CatalogueItemView;
  memberSources: CatalogueMemberSource[];
  busy: boolean;
  action: (body: Record<string, unknown>) => Promise<boolean>;
  providerStaging: ProviderStaging;
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
                  providerStaging={providerStaging}
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
  providerStaging,
}: {
  item: CatalogueItemView;
  venueId: string;
  venueName: string;
  cal: { id: string; name: string; services: { id: string; name: string }[] };
  provider: CatalogueProviderView | null;
  busy: boolean;
  action: (body: Record<string, unknown>) => Promise<boolean>;
  providerStaging: ProviderStaging;
}) {
  const ask = useAskConfirm();
  // Server truth vs the staged (unsaved) desire. `checked` drives the box; a change
  // is only applied when the host clicks "Save and close".
  const serverChecked = Boolean(provider);
  const staged = providerStaging.get(item.id, cal.id);
  const checked = staged?.desired ?? serverChecked;
  // Whether this calendar's venue already offers the service. If not, ticking the box
  // duplicates the service into that venue (a real, same-named service it can book + manage).
  const hasService = cal.services.some(
    (s) => s.name.trim().toLowerCase() === item.name.trim().toLowerCase(),
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
      <label className="flex min-w-0 items-center gap-2">
        <input
          type="checkbox"
          className="rounded border-slate-300"
          checked={checked}
          disabled={busy}
          onChange={(e) => {
            const nextChecked = e.target.checked;
            // Ticking a calendar whose venue already has the service: the tick reuses that
            // service as it is, so ask whether to bring it into step with the original now.
            const originName = item.originVenueName ?? 'the original';
            const askToSync =
              nextChecked &&
              !serverChecked &&
              hasService &&
              Boolean(item.originVenueId) &&
              item.originVenueId !== venueId;
            providerStaging.toggle(item.id, venueId, cal.id, nextChecked, serverChecked, false);
            if (askToSync) {
              void ask(
                `${venueName} already has a service called “${item.name}”. Link it to ${originName}'s? Its duration, buffer, processing periods, options and add-ons will be updated to match ${originName}'s now and follow it from then on. Price and description stay as they are.\n\nChoose Link to link it, or Cancel to add the calendar and leave the service as it is.`,
                'Link it',
              ).then((yes) => {
                if (yes) providerStaging.toggle(item.id, venueId, cal.id, nextChecked, serverChecked, true);
              });
            }
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
          <CopySyncStatus item={item} provider={provider} venueName={venueName} busy={busy} action={action} />
        </span>
      ) : checked && !provider ? (
        // Staged add: on save this ticks the calendar (duplicating the service into
        // its venue when that venue does not already offer it).
        <span className="flex shrink-0 items-center gap-2 text-xs">
          {!hasService ? (
            <span className="text-brand-600">copies “{item.name}” to {venueName}, linked</span>
          ) : staged?.sync ? (
            <span className="text-brand-600">will link to {item.originVenueName ?? 'the original'}</span>
          ) : null}
          <span className="font-medium text-amber-600">unsaved</span>
        </span>
      ) : !checked && provider ? (
        // Staged remove: the calendar currently offers this but was unticked.
        <span className="shrink-0 text-xs font-medium text-amber-600">unsaved, will remove</span>
      ) : null}
    </div>
  );
}


/** The compact action button used beside a copy's status and on the offering header. */
const btnMatch =
  'inline-flex items-center rounded-lg border border-brand-300 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50';
const btnQuiet =
  'inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

const SYNCED_FIELDS_COPY = 'duration, buffer, processing periods, options and add-ons';

/** Copies at other venues that are following their origin (linked, or customised and so once linked). */
function linkedCopies(item: CatalogueItemView): CatalogueProviderView[] {
  const seen = new Set<string>();
  const out: CatalogueProviderView[] = [];
  for (const p of item.providers) {
    if (p.status === 'removed' || seen.has(p.sourceServiceId)) continue;
    if (item.originVenueId && p.venueId === item.originVenueId) continue;
    if (p.sync.state !== 'linked' && p.sync.state !== 'customised') continue;
    seen.add(p.sourceServiceId);
    out.push(p);
  }
  return out;
}

/**
 * "Link all" for one offering: every copy at another venue that is not linked and in
 * step is linked to the origin and updated. Shown only while there is one.
 */
function LinkOfferingCopiesButton({
  item,
  busy,
  action,
}: {
  item: CatalogueItemView;
  busy: boolean;
  action: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const ask = useAskConfirm();
  const out = copiesOutOfStep(item);
  if (out.length === 0) return null;
  const origin = item.originVenueName ?? 'the original';
  const venues = [...new Set(out.map((p) => p.venueName))].join(', ');
  return (
    <button
      type="button"
      className={btnMatch}
      disabled={busy}
      title={`Not linked or behind at ${venues}`}
      onClick={() => {
        void ask(
            `Link “${item.name}” at ${venues} to ${origin}'s and update ${out.length === 1 ? 'it' : 'them'} now? ${out.length === 1 ? 'Its' : 'Their'} ${SYNCED_FIELDS_COPY} will match ${origin}'s and follow it from now on. Price and description stay as they are.`,
            'Link and update',
        ).then((yes) => {
          if (yes) void action({ action: 'sync_all_providers', itemId: item.id });
        });
      }}
    >
      Link {out.length === 1 ? '1 copy' : `all ${out.length} copies`}
    </button>
  );
}

/** "Unlink all" for one offering: every linked copy stops following; nothing else changes. */
function UnlinkOfferingCopiesButton({
  item,
  busy,
  action,
}: {
  item: CatalogueItemView;
  busy: boolean;
  action: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const ask = useAskConfirm();
  const linked = linkedCopies(item);
  if (linked.length === 0) return null;
  const venues = [...new Set(linked.map((p) => p.venueName))].join(', ');
  return (
    <button
      type="button"
      className={btnQuiet}
      disabled={busy}
      onClick={() => {
        void ask(
            `Unlink “${item.name}” at ${venues}? ${linked.length === 1 ? 'The copy keeps' : 'The copies keep'} ${linked.length === 1 ? 'its' : 'their'} current settings and no longer ${linked.length === 1 ? 'follows' : 'follow'} the original.`,
            'Unlink',
        ).then((yes) => {
          if (yes) void action({ action: 'unlink_all_providers', itemId: item.id });
        });
      }}
    >
      Unlink {linked.length === 1 ? '1 copy' : `all ${linked.length} copies`}
    </button>
  );
}

/** The same two actions across every offering on the page. */
function LinkAllCopiesButtons({
  items,
  busy,
  action,
}: {
  items: CatalogueItemView[];
  busy: boolean;
  action: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const ask = useAskConfirm();
  const toLink = items.reduce((n, item) => n + copiesOutOfStep(item).length, 0);
  const toUnlink = items.reduce((n, item) => n + linkedCopies(item).length, 0);
  if (toLink === 0 && toUnlink === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {toLink > 0 ? (
        <button
          type="button"
          className={btnMatch}
          disabled={busy}
          title="Every copy at another venue that is not linked, or has fallen behind, is linked to its original and updated."
          onClick={() => {
            void ask(
                `Link ${toLink === 1 ? '1 service copy' : `all ${toLink} service copies`} to the originals and update ${toLink === 1 ? 'it' : 'them'} now? ${SYNCED_FIELDS_COPY[0].toUpperCase() + SYNCED_FIELDS_COPY.slice(1)} will match the originals and follow them from now on. Prices and descriptions stay as they are.`,
                'Link and update',
            ).then((yes) => {
              if (yes) void action({ action: 'sync_all_providers' });
            });
          }}
        >
          Link all copies ({toLink})
        </button>
      ) : null}
      {toUnlink > 0 ? (
        <button
          type="button"
          className={btnQuiet}
          disabled={busy}
          title="Every linked copy stops following its original. Their settings stay as they are."
          onClick={() => {
            void ask(
                `Unlink ${toUnlink === 1 ? '1 service copy' : `all ${toUnlink} service copies`}? ${toUnlink === 1 ? 'It keeps its' : 'They keep their'} current settings and no longer ${toUnlink === 1 ? 'follows' : 'follow'} the originals.`,
                'Unlink',
            ).then((yes) => {
              if (yes) void action({ action: 'unlink_all_providers' });
            });
          }}
        >
          Unlink all copies ({toUnlink})
        </button>
      ) : null}
    </div>
  );
}

/**
 * A copy's standing against its origin, and the one thing to do about it
 * (Docs/collective-service-sync-plan.md). A badge says the state in plain words; the
 * button beside it is always the next sensible action. Nothing is shown for the origin
 * itself, for a venue's own unrelated service, or on a database without the sync columns.
 */
function CopySyncStatus({
  item,
  provider,
  venueName,
  busy,
  action,
}: {
  item: CatalogueItemView;
  provider: CatalogueProviderView;
  venueName: string;
  busy: boolean;
  action: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const ask = useAskConfirm();
  const sync = provider.sync;
  if (!sync || sync.state === 'none') return null;
  const origin = sync.originVenueName ?? item.originVenueName ?? 'the original';
  const atOrigin = Boolean(item.originVenueId) && item.originVenueId === provider.venueId;
  if (atOrigin) return null;

  // What differs, as far as the row can tell: the length is on both providers, so it can be
  // named; anything else is one of the other synced fields.
  const originProvider = item.originVenueId
    ? item.providers.find((p) => p.venueId === item.originVenueId && p.status !== 'removed') ?? null
    : null;
  const here = provider.effectiveDurationMinutes;
  const there = originProvider?.effectiveDurationMinutes ?? null;
  const differenceNote =
    here != null && there != null && here !== there
      ? `${fmtDuration(here)} here, ${fmtDuration(there)} at ${origin}`
      : 'buffer, processing periods or options differ';

  const badge = (tone: 'ok' | 'warn' | 'muted', text: string) => (
    <span
      className={
        tone === 'ok'
          ? 'rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200'
          : tone === 'warn'
            ? 'rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200'
            : 'rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200'
      }
    >
      {text}
    </span>
  );

  const button = (label: string, confirmText: string, body: Record<string, unknown>, quiet = false) => (
    <button
      type="button"
      className={quiet ? btnQuiet : btnMatch}
      disabled={busy}
      onClick={() => {
        void ask(confirmText, quiet ? 'Unlink' : label).then((yes) => {
          if (yes) void action(body);
        });
      }}
    >
      {label}
    </button>
  );

  const linkConfirm = `Link “${item.name}” at ${venueName} to ${origin}'s and update it now? Its ${SYNCED_FIELDS_COPY} will match ${origin}'s and follow it from now on. Price and description stay as they are.`;
  const unlinkButton = button(
    'Unlink',
    `Unlink “${item.name}” at ${venueName}? It keeps its current settings and no longer follows ${origin}.`,
    { action: 'detach_provider', providerId: provider.id },
    true,
  );

  if (sync.state === 'independent') {
    return (
      <>
        {sync.inStep === false
          ? badge('warn', `Not linked. Differs from ${origin}: ${differenceNote}`)
          : sync.inStep === true
            ? badge('muted', `Not linked. Same as ${origin} today`)
            : badge('muted', 'Not linked')}
        {button(`Link to ${origin}`, linkConfirm, { action: 'link_provider', providerId: provider.id })}
      </>
    );
  }
  if (sync.state === 'customised') {
    // Was linked; the venue edited a synced field, so it stopped following.
    return (
      <>
        {badge(
          'warn',
          sync.inStep === false
            ? `Edited at ${venueName}, no longer following. ${differenceNote[0].toUpperCase() + differenceNote.slice(1)}`
            : `Edited at ${venueName}, no longer following`,
        )}
        {button(
          `Relink to ${origin}`,
          `Replace ${venueName}'s changes to “${item.name}” with ${origin}'s ${SYNCED_FIELDS_COPY}, and follow ${origin} again from now on? Price and description stay as they are.`,
          { action: 'sync_provider', providerId: provider.id, forceSync: true },
        )}
        {unlinkButton}
      </>
    );
  }
  if (sync.inStep === false) {
    return (
      <>
        {badge('warn', `Linked, behind ${origin}: ${differenceNote}`)}
        {button(
          `Update from ${origin}`,
          `Update “${item.name}” at ${venueName} to ${origin}'s current ${SYNCED_FIELDS_COPY}?`,
          { action: 'sync_provider', providerId: provider.id },
        )}
        {unlinkButton}
      </>
    );
  }
  return (
    <>
      {badge('ok', `Linked to ${origin}, in step`)}
      {unlinkButton}
    </>
  );
}
