'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ServiceSettingsWorkspace } from './ServiceSettingsWorkspace';
import type { VenueServiceRow } from './service-settings-types';
import { TableManagementSection } from '@/app/dashboard/settings/sections/TableManagementSection';
import { FloorPlanEditorTabs, type FloorPlanEditorTabKey } from './FloorPlanEditorTabs';
import { AvailabilityConfigSection } from '@/app/dashboard/settings/sections/AvailabilityConfigSection';
import type { VenueSettings } from '@/app/dashboard/settings/types';
import { isRestaurantTableProductTier } from '@/lib/tier-enforcement';
import type { VenueArea } from '@/types/areas';
import { AddDiningAreaModal, type AddDiningAreaPayload } from '@/components/areas/AddDiningAreaModal';
import { EditDiningAreaModal, type EditDiningAreaPayload } from '@/components/areas/EditDiningAreaModal';
import { ConfirmDeleteAreaModal } from '@/components/areas/ConfirmDeleteAreaModal';
import { PublicBookingAreaModeModal } from '@/components/areas/PublicBookingAreaModeModal';
import { PageFrame } from '@/components/ui/dashboard/PageFrame';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { TabBar } from '@/components/ui/dashboard/TabBar';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { DashboardGridSkeleton, DashboardTabRowSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';

const BASE_TABS = [{ key: 'services' as const, label: 'Services' }];

const TABLE_TAB = { key: 'table' as const, label: 'Table Management' };

type TabKey = (typeof BASE_TABS)[number]['key'] | typeof TABLE_TAB.key;

function resolveInitialActiveTab(
  initialTab: TabKey | undefined,
  venue: VenueSettings | null,
): TabKey {
  if (!venue) return 'services';
  const showTable = isRestaurantTableProductTier(venue.pricing_tier);
  if (initialTab === 'table' && showTable) return 'table';
  return 'services';
}

const VALID_FLOOR_PLAN_TABS: FloorPlanEditorTabKey[] = ['layout', 'tables', 'combinations'];

interface Props {
  initialVenue: VenueSettings | null;
  hasServiceConfig: boolean;
  initialTab?: TabKey;
  initialFloorPlanTab?: FloorPlanEditorTabKey;
}

export default function AvailabilitySettingsClient({
  initialVenue,
  hasServiceConfig,
  initialTab,
  initialFloorPlanTab,
}: Props) {
  const searchParams = useSearchParams();
  const [venue, setVenue] = useState<VenueSettings | null>(initialVenue);
  const [activeTab, setActiveTabState] = useState<TabKey>(() =>
    resolveInitialActiveTab(initialTab, initialVenue),
  );
  const [floorPlanTab, setFloorPlanTabState] = useState<FloorPlanEditorTabKey>(() => {
    const resolved =
      initialFloorPlanTab && VALID_FLOOR_PLAN_TABS.includes(initialFloorPlanTab) ? initialFloorPlanTab : 'layout';
    if (initialVenue && !initialVenue.table_management_enabled && resolved !== 'tables') {
      return 'tables';
    }
    return resolved;
  });
  const [services, setServices] = useState<VenueServiceRow[]>([]);
  const [areas, setAreas] = useState<VenueArea[]>([]);
  /** False until `/api/venue/areas` has completed — avoids unscoped table/floor-plan fetches before `selectedAreaId` is set. */
  const [areasHydrated, setAreasHydrated] = useState(false);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [servicesHydrated, setServicesHydrated] = useState(false);
  const [servicesRefreshing, setServicesRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [addAreaOpen, setAddAreaOpen] = useState(false);
  const [addAreaSubmitting, setAddAreaSubmitting] = useState(false);
  const [renameTarget, setRenameTarget] = useState<VenueArea | null>(null);
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<VenueArea | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [publicAreaModeOpen, setPublicAreaModeOpen] = useState(false);
  // Incremented each time the floor plan editor successfully auto-saves positions.
  // Passed to the Combinations tab so the adjacency preview and pair count refresh.
  const [layoutSaveCount, setLayoutSaveCount] = useState(0);
  const [layoutActivationKey, setLayoutActivationKey] = useState(0);
  const handleLayoutSaved = useCallback(() => setLayoutSaveCount((n) => n + 1), []);

  const replaceAvailabilityUrl = useCallback(
    (update: (params: URLSearchParams) => void) => {
      if (typeof window === 'undefined') return;
      const params = new URLSearchParams(window.location.search);
      update(params);
      const query = params.toString();
      const url = query ? `/dashboard/availability?${query}` : '/dashboard/availability';
      window.history.replaceState(null, '', url);
    },
    [],
  );

  useEffect(() => {
    setVenue(initialVenue);
  }, [initialVenue]);

  useEffect(() => {
    if (initialFloorPlanTab && VALID_FLOOR_PLAN_TABS.includes(initialFloorPlanTab)) {
      const next =
        venue && !venue.table_management_enabled && initialFloorPlanTab !== 'tables'
          ? 'tables'
          : initialFloorPlanTab;
      setFloorPlanTabState(next);
    }
  }, [initialFloorPlanTab, venue]);

  const showTableTab = Boolean(venue && isRestaurantTableProductTier(venue.pricing_tier));

  /** Show dining area row whenever the venue has at least one area (including single "Main Dining") so admins can add a second area and switch once multiple exist. */
  const showAreaChrome = useMemo(() => {
    return areas.some((a) => a.is_active);
  }, [areas]);

  const selectArea = useCallback(
    (id: string) => {
      if (id === selectedAreaId) return;
      setSelectedAreaId(id);
      replaceAvailabilityUrl((next) => {
        next.set('area', id);
      });
    },
    [replaceAvailabilityUrl, selectedAreaId],
  );

  const selectedAreaName = useMemo(() => {
    if (!selectedAreaId) return '';
    return areas.find((a) => a.id === selectedAreaId)?.name ?? '';
  }, [areas, selectedAreaId]);

  const visibleTabs = useMemo(() => {
    if (showTableTab) return [...BASE_TABS, TABLE_TAB];
    return [...BASE_TABS];
  }, [showTableTab]);

  useEffect(() => {
    if (activeTab === 'table' && !showTableTab) {
      setActiveTabState('services');
      replaceAvailabilityUrl((next) => {
        next.set('tab', 'services');
        next.delete('fp');
      });
    }
  }, [activeTab, showTableTab, replaceAvailabilityUrl]);

  const setActiveTab = useCallback(
    (key: TabKey) => {
      setActiveTabState(key);
      if (key === 'table' && floorPlanTab === 'layout') {
        setLayoutActivationKey((n) => n + 1);
      }
      replaceAvailabilityUrl((next) => {
        next.set('tab', key);
        if (key === 'table') {
          next.set('fp', floorPlanTab);
        } else {
          next.delete('fp');
        }
      });
    },
    [replaceAvailabilityUrl, floorPlanTab],
  );

  const setFloorPlanTab = useCallback(
    (key: FloorPlanEditorTabKey) => {
      setFloorPlanTabState(key);
      if (key === 'layout') {
        setLayoutActivationKey((n) => n + 1);
      }
      replaceAvailabilityUrl((next) => {
        next.set('tab', 'table');
        next.set('fp', key);
      });
    },
    [replaceAvailabilityUrl],
  );

  const onUpdate = useCallback((patch: Partial<VenueSettings>) => {
    setVenue((v) => (v ? { ...v, ...patch } : null));
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const submitNewArea = useCallback(
    async (payload: AddDiningAreaPayload) => {
      setAddAreaSubmitting(true);
      try {
        const body: Record<string, unknown> = {
          name: payload.name,
          colour: payload.colour,
        };
        if (payload.copyFromSource && selectedAreaId) {
          body.copy_from_area_id = selectedAreaId;
        }
        const res = await fetch('/api/venue/areas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          showToast((err as { error?: string }).error ?? 'Could not create area');
          return;
        }
        const data = await res.json();
        const area = data.area as VenueArea;
        setAreas((prev) => [...prev, area]);
        setSelectedAreaId(area.id);
        replaceAvailabilityUrl((next) => {
          next.set('area', area.id);
        });
        setAddAreaOpen(false);
        showToast('Area created');
      } catch {
        showToast('Could not create area');
      } finally {
        setAddAreaSubmitting(false);
      }
    },
    [replaceAvailabilityUrl, selectedAreaId, showToast],
  );

  const activeAreas = useMemo(() => areas.filter((a) => a.is_active), [areas]);

  const submitRename = useCallback(
    async (payload: EditDiningAreaPayload) => {
      if (!renameTarget) return;
      setRenameSubmitting(true);
      try {
        const res = await fetch(`/api/venue/areas/${renameTarget.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: payload.name, colour: payload.colour }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          showToast((err as { error?: string }).error ?? 'Could not update area');
          return;
        }
        const data = await res.json();
        const updated = data.area as VenueArea;
        setAreas((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
        setRenameTarget(null);
        showToast('Area updated');
      } catch {
        showToast('Could not update area');
      } finally {
        setRenameSubmitting(false);
      }
    },
    [renameTarget, showToast],
  );

  const executeDeleteArea = useCallback(async () => {
    if (!deleteTarget) return;
    const deletedId = deleteTarget.id;
    setDeleteSubmitting(true);
    try {
      const res = await fetch(`/api/venue/areas/${deletedId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast((err as { error?: string }).error ?? 'Could not remove area');
        return;
      }
      const ar = await fetch('/api/venue/areas');
      let finalList: VenueArea[];
      if (ar.ok) {
        const listData = await ar.json();
        finalList = (listData.areas ?? []) as VenueArea[];
      } else {
        finalList = areas.map((a) => (a.id === deletedId ? { ...a, is_active: false } : a));
      }
      setAreas(finalList);
      setDeleteTarget(null);
      const stillActive = finalList.filter((a) => a.is_active);
      setSelectedAreaId((current) => {
        if (current !== deletedId) return current;
        const nextId = stillActive[0]?.id ?? null;
        if (nextId) {
          replaceAvailabilityUrl((next) => {
            next.set('area', nextId);
          });
        }
        return nextId;
      });
      showToast('Area removed');
    } catch {
      showToast('Could not remove area');
    } finally {
      setDeleteSubmitting(false);
    }
  }, [areas, deleteTarget, replaceAvailabilityUrl, showToast]);

  useEffect(() => {
    if (venue && !venue.table_management_enabled && floorPlanTab !== 'tables') {
      setFloorPlanTabState('tables');
      replaceAvailabilityUrl((next) => {
        next.set('tab', 'table');
        next.set('fp', 'tables');
      });
    }
  }, [venue, floorPlanTab, replaceAvailabilityUrl]);

  useEffect(() => {
    if (!venue) return;
    const venueId = venue.id;
    setAreasHydrated(false);
    async function loadAreas() {
      try {
        const ar = await fetch('/api/venue/areas');
        if (!ar.ok) return;
        const data = await ar.json();
        const list = (data.areas ?? []) as VenueArea[];
        setAreas(list);
        const active = list.filter((a) => a.is_active);
        if (active.length === 0) return;
        const key = `diningArea:${venueId}`;
        const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
        const fromUrl = searchParams.get('area');
        const id =
          fromUrl && active.some((a) => a.id === fromUrl)
            ? fromUrl
            : stored && active.some((a) => a.id === stored)
              ? stored
              : active[0]!.id;
        setSelectedAreaId(id);
      } catch {
        /* ignore */
      } finally {
        setAreasHydrated(true);
      }
    }
    void loadAreas();
    // Intentionally omit searchParams: area switches update `selectedAreaId` via `selectArea` and the sync effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-fetch area list when venue changes
  }, [venue?.id]);

  /** Keep selection in sync with `?area=` (deep links, browser back/forward) without re-fetching the full list. */
  useEffect(() => {
    if (!venue) return;
    const fromUrl = searchParams.get('area');
    if (!fromUrl) return;
    setSelectedAreaId((current) => {
      if (fromUrl === current) return current;
      const active = areas.filter((a) => a.is_active);
      if (!active.some((a) => a.id === fromUrl)) return current;
      return fromUrl;
    });
  }, [searchParams, venue, areas]);

  useEffect(() => {
    if (!venue?.id || !areasHydrated) return;
    async function loadServices() {
      setServicesRefreshing(true);
      try {
        const url = selectedAreaId
          ? `/api/venue/services?area_id=${encodeURIComponent(selectedAreaId)}`
          : '/api/venue/services';
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setServices(data.services ?? []);
        }
      } finally {
        setServicesHydrated(true);
        setServicesRefreshing(false);
      }
    }
    void loadServices();
  }, [venue?.id, areasHydrated, selectedAreaId]);

  useEffect(() => {
    if (!venue?.id || !selectedAreaId) return;
    try {
      localStorage.setItem(`diningArea:${venue.id}`, selectedAreaId);
    } catch {
      /* ignore */
    }
  }, [venue?.id, selectedAreaId]);

  /** Normalize legacy tab query params (capacity / duration / rules) to Services workspace. */
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'capacity' || tab === 'duration' || tab === 'rules') {
      replaceAvailabilityUrl((next) => {
        next.set('tab', 'services');
      });
    }
  }, [searchParams, replaceAvailabilityUrl]);

  if (!venue) {
    return (
      <PageFrame>
        <p className="text-sm text-red-600">Could not load venue settings. Try again or contact support.</p>
      </PageFrame>
    );
  }

  if (!servicesHydrated) {
    return (
      <PageFrame>
        <div className="space-y-6 py-2" role="status" aria-label="Loading availability">
          <div className="space-y-2">
            <Skeleton.Line className="w-32" />
            <Skeleton.Line className="h-8 w-56 max-w-full sm:h-9 sm:w-72" />
            <Skeleton.Line className="h-3 w-full max-w-2xl" />
          </div>
          <Skeleton.Block className="h-11 w-40" />
          <DashboardTabRowSkeleton tabCount={2} />
          <Skeleton.Card>
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton.Block className="h-24" />
              <Skeleton.Block className="h-24" />
            </div>
          </Skeleton.Card>
        </div>
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <div className="space-y-6">
      <PageHeader
        eyebrow="Configuration"
        title="Availability"
        subtitle={
          <>
            Manage services, capacity, dining durations, booking rules, and table management. Venue-wide closures,
            amended hours, and capacity blocks are under{' '}
            <Link
              href="/dashboard/settings?tab=business-hours"
              className="font-semibold text-brand-600 underline hover:text-brand-800"
            >
              Settings → Business Hours
            </Link>
            .
          </>
        }
      />

      {showAreaChrome && selectedAreaId && (
        <div className="space-y-2">
        <SectionCard>
          <SectionCard.Header eyebrow="Dining" title="Dining area" />
          <SectionCard.Body className="!pt-0">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-2">
            {activeAreas.map((a) => (
              <div
                key={a.id}
                className={`inline-flex items-center gap-0.5 rounded-lg border ${
                  selectedAreaId === a.id
                    ? 'border-brand-600 bg-brand-50'
                    : 'border-slate-200 bg-slate-50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => selectArea(a.id)}
                  className={`inline-flex items-center gap-2 rounded-l-md px-3 py-1.5 text-sm transition-colors ${
                    selectedAreaId === a.id ? 'text-brand-900' : 'text-slate-700 hover:bg-slate-100/80'
                  }`}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: a.colour || '#6366F1' }}
                  />
                  {a.name}
                </button>
                <button
                  type="button"
                  className="rounded p-1.5 text-slate-500 hover:bg-white/90 hover:text-slate-900"
                  aria-label={`Rename ${a.name}`}
                  title="Rename"
                  onClick={(e) => {
                    e.preventDefault();
                    setRenameTarget(a);
                  }}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="rounded p-1.5 text-slate-500 hover:bg-white/90 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label={`Remove ${a.name}`}
                  title={activeAreas.length <= 1 ? 'At least one dining area is required' : 'Remove area'}
                  disabled={activeAreas.length <= 1}
                  onClick={(e) => {
                    e.preventDefault();
                    setDeleteTarget(a);
                  }}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                    />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {activeAreas.length > 1 && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                onClick={() => setPublicAreaModeOpen(true)}
                title="How areas appear on the booking form"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.65.87.094.053.194.097.299.137v4.254c-.285.084-.55.22-.782.398-.337.214-.587.526-.65.901l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.063-.374-.313-.686-.65-.87a1.62 1.62 0 01-.299-.137V7.754c.285-.084.55-.22.782-.398.337-.214.587-.526.65-.901l.213-1.28zM12 15.75a3 3 0 100-6 3 3 0 000 6z"
                  />
                </svg>
                Area Settings
              </button>
            )}
            <button
              type="button"
              className="rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              onClick={() => setAddAreaOpen(true)}
            >
              + Add area
            </button>
          </div>
        </div>
        {activeAreas.length > 1 && (
          <p className="mt-3 text-xs text-slate-500">
            All settings on this page are configured per dining area. Switch the area above to manage each space.
          </p>
        )}
          </SectionCard.Body>
        </SectionCard>
        </div>
      )}

      <AddDiningAreaModal
        open={addAreaOpen}
        onClose={() => !addAreaSubmitting && setAddAreaOpen(false)}
        sourceAreaName={selectedAreaName || 'Selected area'}
        sourceAreaId={selectedAreaId}
        submitting={addAreaSubmitting}
        onSubmit={submitNewArea}
      />

      <EditDiningAreaModal
        open={renameTarget !== null}
        initialName={renameTarget?.name ?? ''}
        initialColour={renameTarget?.colour ?? '#6366F1'}
        onClose={() => !renameSubmitting && setRenameTarget(null)}
        submitting={renameSubmitting}
        onSubmit={submitRename}
      />

      <ConfirmDeleteAreaModal
        open={deleteTarget !== null}
        areaName={deleteTarget?.name ?? ''}
        onClose={() => !deleteSubmitting && setDeleteTarget(null)}
        submitting={deleteSubmitting}
        onConfirm={executeDeleteArea}
      />

      <PublicBookingAreaModeModal
        open={publicAreaModeOpen}
        onClose={() => setPublicAreaModeOpen(false)}
        initialMode={venue.public_booking_area_mode === 'manual' ? 'manual' : 'auto'}
        onSaved={(mode) => onUpdate({ public_booking_area_mode: mode })}
      />

      <div className="overflow-x-auto pb-1">
        <TabBar<TabKey>
          tabs={visibleTabs.map((tab) => ({ id: tab.key, label: tab.label }))}
          value={activeTab}
          onChange={setActiveTab}
        />
      </div>

      {servicesRefreshing && (
        <p className="text-xs font-medium text-slate-400" role="status">
          Updating area settings...
        </p>
      )}

      {activeTab === 'services' && (
        <ServiceSettingsWorkspace
          services={services}
          setServices={setServices}
          selectedAreaId={selectedAreaId}
          showToast={showToast}
        />
      )}
      {activeTab === 'table' && showTableTab && (
        <div className="space-y-6">
            <TableManagementSection venue={venue} onUpdate={onUpdate} isAdmin />
            {!areasHydrated ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <DashboardGridSkeleton />
              </div>
            ) : activeAreas.length > 0 && !selectedAreaId ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Select a dining area above to manage tables and layout for that space.
              </p>
            ) : (
              <FloorPlanEditorTabs
                isAdmin
                activeTab={floorPlanTab}
                onTabChange={setFloorPlanTab}
                advancedTableManagement={Boolean(venue.table_management_enabled)}
                onLayoutSaved={handleLayoutSaved}
                combinationThreshold={venue.combination_threshold ?? 80}
                layoutSaveCount={layoutSaveCount}
                layoutActivationKey={layoutActivationKey}
                onCombinationThresholdSaved={(v) => onUpdate({ combination_threshold: v })}
                diningAreaId={selectedAreaId}
              />
            )}
            {!hasServiceConfig && (
              <AvailabilityConfigSection venue={venue} onUpdate={onUpdate} isAdmin />
            )}
          </div>
      )}

      {toast && (
        <div className="fixed z-50 max-w-[calc(100vw-2rem)] rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg right-[max(1rem,env(safe-area-inset-right,0px))] bottom-[max(1rem,env(safe-area-inset-bottom,0px))]">
          {toast}
        </div>
      )}
      </div>
    </PageFrame>
  );
}
