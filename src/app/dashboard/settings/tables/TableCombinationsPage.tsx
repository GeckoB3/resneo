'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';
import { AdjacencyPreview } from '@/app/dashboard/settings/sections/AdjacencyPreview';
import { NumericInput } from '@/components/ui/NumericInput';
import { HorizontalScrollHint } from '@/components/ui/HorizontalScrollHint';
import { FloorPlanTablesPanelSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';
import type { VenueTable, TableCombination } from '@/types/table-management';
import type { BookingModel } from '@/types/booking-models';
const MiniFloorPlanPicker = dynamic(() => import('@/components/floor-plan/MiniFloorPlanPicker'), {
  ssr: false,
});

const BOOKING_TYPE_OPTIONS: { id: BookingModel; label: string }[] = [
  { id: 'table_reservation', label: 'Table reservation' },
  { id: 'event_ticket', label: 'Event / ticket' },
  { id: 'class_session', label: 'Class' },
  { id: 'resource_booking', label: 'Resource' },
  { id: 'practitioner_appointment', label: 'Appointment' },
  { id: 'unified_scheduling', label: 'Unified scheduling' },
];

interface CatalogAutoGroup {
  table_group_key: string;
  table_ids: string[];
  default_name: string;
  default_capacity: number;
  effective_min_covers: number;
  effective_max_covers: number;
  override: Record<string, unknown> | null;
  /** Kept in the list when adjacency changes (e.g. after updating detection distance). */
  is_locked: boolean;
  status: 'active' | 'disabled' | 'modified';
}

interface Props {
  tables: VenueTable[];
  combinations: TableCombination[];
  setCombinations: (c: TableCombination[]) => void;
  isAdmin: boolean;
  onRefresh: () => void;
  /**
   * Mirrors the venue “Combination Detection Distance” (`combination_threshold`).
   * When this value changes after saving settings, the auto-detected groups list is refetched.
   */
  combinationThreshold?: number;
  /** Incremented when the floor plan layout is saved (Availability → Table Management). Refreshes adjacency preview. */
  layoutSaveCount?: number;
  /** Called after a successful save of `combination_threshold` so parent venue state can stay in sync. */
  onCombinationThresholdSaved?: (value: number) => void;
  /** Scope auto-detected groups, overrides, and layout preview to this dining area (Availability → Table Management). */
  diningAreaId?: string | null;
  /** Logical floor-plan dimensions from the Layout tab. */
  layoutWidth?: number;
  layoutHeight?: number;
}

export function TableCombinationsPage({
  tables,
  combinations,
  setCombinations,
  isAdmin,
  onRefresh,
  combinationThreshold,
  layoutSaveCount = 0,
  onCombinationThresholdSaved,
  diningAreaId = null,
  layoutWidth,
  layoutHeight,
}: Props) {
  const router = useRouter();
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [autoGroups, setAutoGroups] = useState<CatalogAutoGroup[]>([]);
  const [thresholdDraft, setThresholdDraft] = useState(combinationThreshold ?? 80);
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const [recalcLoading, setRecalcLoading] = useState(false);
  const [recalcError, setRecalcError] = useState<string | null>(null);
  const [previewIds, setPreviewIds] = useState<string[]>([]);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [combinationsSubTab, setCombinationsSubTab] = useState<'auto' | 'custom'>('auto');
  /** When set, only combinations that include this table are listed (both tabs). */
  const [filterTableId, setFilterTableId] = useState<string>('');

  const [modal, setModal] = useState<
    | { mode: 'auto'; group: CatalogAutoGroup }
    | { mode: 'custom'; combo: TableCombination | null }
    | null
  >(null);

  const loadCatalog = useCallback(async (options?: { silent?: boolean }) => {
    const showSpinner = !options?.silent;
    if (showSpinner) setCatalogLoading(true);
    try {
      const qs = diningAreaId ? `?area_id=${encodeURIComponent(diningAreaId)}` : '';
      const catRes = await fetch(`/api/venue/tables/combinations/catalog${qs}`);
      if (catRes.ok) {
        const data = await catRes.json();
        setAutoGroups(data.auto_groups ?? []);
        setThresholdDraft(data.combination_threshold ?? 80);
      }
    } catch (e) {
      console.error('loadCatalog', e);
    } finally {
      if (showSpinner) setCatalogLoading(false);
    }
  }, [diningAreaId]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog, combinationThreshold]);

  useEffect(() => {
    if (combinationThreshold != null) {
      setThresholdDraft(combinationThreshold);
    }
  }, [combinationThreshold]);

  const recalculateAdjacency = useCallback(async () => {
    if (!isAdmin) return;
    setRecalcLoading(true);
    setRecalcError(null);
    try {
      const res = await fetch('/api/venue/tables/combinations/recalculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(diningAreaId ? { area_id: diningAreaId } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRecalcError((data as { error?: string }).error ?? 'Failed to recalculate adjacency.');
        return;
      }
      await loadCatalog({ silent: true });
    } catch {
      setRecalcError('Failed to recalculate adjacency.');
    } finally {
      setRecalcLoading(false);
    }
  }, [isAdmin, loadCatalog, diningAreaId]);

  async function saveThreshold() {
    if (!isAdmin || thresholdSaving) return;
    setThresholdSaving(true);
    setRecalcError(null);
    try {
      const res = await fetch('/api/venue/tables/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ combination_threshold: thresholdDraft }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setToast((data as { error?: string }).error ?? 'Failed to save combination threshold.');
        return;
      }
      onCombinationThresholdSaved?.(thresholdDraft);
      router.refresh();
      // Recalculate + refetch catalog so auto-detected counts and list use the new threshold.
      await recalculateAdjacency();
      setToast('Automatic table combinations updated.');
    } catch {
      setToast('Failed to save combination threshold.');
    } finally {
      setThresholdSaving(false);
    }
  }

  useEffect(() => {
    if (layoutSaveCount === 0) return;
    void recalculateAdjacency();
  }, [layoutSaveCount, recalculateAdjacency]);

  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel('combinations-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'table_combinations' },
        () => {
          void onRefresh();
          void loadCatalog();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'combination_auto_overrides' },
        () => void loadCatalog(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [onRefresh, loadCatalog]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!filterTableId) return;
    if (!tables.some((t) => t.is_active && t.id === filterTableId)) {
      setFilterTableId('');
    }
  }, [filterTableId, tables]);

  const allAutoDisabled = autoGroups.length > 0 && autoGroups.every((g) => g.status === 'disabled');

  const tableFilterOptions = useMemo(() => {
    return [...tables]
      .filter((t) => t.is_active)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      .map((t) => ({ id: t.id, label: t.name }));
  }, [tables]);

  const filteredAutoGroups = useMemo(() => {
    if (!filterTableId) return autoGroups;
    return autoGroups.filter((g) => g.table_ids.includes(filterTableId));
  }, [autoGroups, filterTableId]);

  const filteredCombinations = useMemo(() => {
    if (!filterTableId) return combinations;
    return combinations.filter((c) => (c.members ?? []).some((m) => m.table_id === filterTableId));
  }, [combinations, filterTableId]);

  const filterTableLabel = useMemo(() => {
    if (!filterTableId) return '';
    return tableFilterOptions.find((o) => o.id === filterTableId)?.label ?? 'this table';
  }, [filterTableId, tableFilterOptions]);

  const miniTables = useMemo(
    () =>
      tables
        .filter((t) => t.is_active)
        .map((t) => ({
          id: t.id,
          name: t.name,
          min_covers: t.min_covers,
          max_covers: t.max_covers,
          shape: t.shape,
          position_x: t.position_x,
          position_y: t.position_y,
          width: t.width,
          height: t.height,
          rotation: t.rotation,
          seat_angles: t.seat_angles ?? null,
          polygon_points: t.polygon_points ?? null,
          is_active: t.is_active,
        })),
    [tables],
  );

  const saveAutoOverride = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/venue/tables/combinations/auto-overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...body,
        ...(diningAreaId ? { area_id: diningAreaId } : {}),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error ?? 'Save failed');
    }
    setToast('Saved combination rules');
    await loadCatalog();
    onRefresh();
  };

  return (
    <div className="space-y-6">
      {toast && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
          {toast}
        </div>
      )}

      <header>
        <h2 className="text-lg font-semibold text-slate-900">Table Combinations</h2>
        <p className="mt-1 text-sm text-slate-600">
          Control how tables can be joined to seat larger parties.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          ResNeo automatically detects which tables can combine based on their position in your floor plan. Use this page
          to adjust auto-detected combinations, or add custom combinations.
        </p>
        <button
          type="button"
          onClick={() => setHowItWorksOpen((o) => !o)}
          className="mt-2 text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          {howItWorksOpen ? 'Hide' : 'How it works'}
        </button>
        {howItWorksOpen && (
          <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <p>
              Single tables are tried first. If none fit the party size, the system considers adjacent table groups (2–4
              tables) using your floor plan layout. Custom combinations are merged with the same rules. Manual entries
              override auto-detected groups when they share the same set of tables.
            </p>
          </div>
        )}
      </header>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
          Combination Detection Distance
        </label>
        <p className="mt-1 text-xs text-slate-500">
          How close two tables need to be on your floor plan to be suggested as a combination.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <NumericInput
            min={5}
            max={300}
            value={thresholdDraft}
            onChange={(v) => setThresholdDraft(v)}
            disabled={!isAdmin || thresholdSaving}
            className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={() => void saveThreshold()}
            disabled={!isAdmin || thresholdSaving || recalcLoading}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {thresholdSaving ? 'Updating…' : 'Update Automatic Table Combinations'}
          </button>
          {recalcError && <p className="text-xs text-red-600">{recalcError}</p>}
          {!catalogLoading && (
            <p className="text-xs text-slate-500">
              {autoGroups.length} auto-detected combination{autoGroups.length !== 1 ? 's' : ''}.
            </p>
          )}
        </div>
        <AdjacencyPreview threshold={thresholdDraft} refreshKey={layoutSaveCount} diningAreaId={diningAreaId} />
      </div>

      <div className="mt-4 space-y-4">
        <HorizontalScrollHint />
        <div className="touch-pan-x overflow-x-auto [-webkit-overflow-scrolling:touch]">
          <div className="flex w-max gap-2">
            <button
              type="button"
              onClick={() => setCombinationsSubTab('auto')}
              className={`min-h-10 rounded-lg px-3 py-2 text-sm font-medium ${
                combinationsSubTab === 'auto'
                  ? 'bg-brand-600 text-white'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              Auto-detected combinations
              {!catalogLoading && (
                <span className="ml-1 font-normal opacity-90">({autoGroups.length})</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setCombinationsSubTab('custom')}
              className={`min-h-10 rounded-lg px-3 py-2 text-sm font-medium ${
                combinationsSubTab === 'custom'
                  ? 'bg-brand-600 text-white'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              Custom combinations
              <span className="ml-1 font-normal opacity-90">({combinations.length})</span>
            </button>
          </div>
        </div>

        {tableFilterOptions.length > 0 && (
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <div className="min-w-[200px] flex-1">
              <label htmlFor="combinations-table-filter" className="block text-xs font-semibold text-slate-600">
                Filter by table
              </label>
              <select
                id="combinations-table-filter"
                value={filterTableId}
                onChange={(e) => setFilterTableId(e.target.value)}
                className="mt-1 w-full max-w-md rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"
              >
                <option value="">All tables</option>
                {tableFilterOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                Show only combinations that include the selected table.
              </p>
            </div>
            {filterTableId && (
              <p className="text-xs text-slate-600">
                <span className="font-medium text-slate-800">{filterTableLabel}</span>:{' '}
                {combinationsSubTab === 'auto'
                  ? `${filteredAutoGroups.length} of ${autoGroups.length} auto-detected`
                  : `${filteredCombinations.length} of ${combinations.length} custom`}
              </p>
            )}
          </div>
        )}

        {combinationsSubTab === 'auto' && allAutoDisabled && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            You&apos;ve disabled all auto-detected combinations. Bookings for parties larger than your biggest single table
            may not find a table combination unless you add custom combinations.
          </div>
        )}

        <div className="lg:hidden sticky top-0 z-20 mx-auto w-full max-w-[40vw] py-2">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Preview</p>
          <div className="rounded-xl border border-slate-200 bg-slate-50/95 shadow-sm ring-1 ring-slate-200/80 backdrop-blur-sm supports-[backdrop-filter]:bg-slate-50/90">
            <MiniFloorPlanPicker
              tables={miniTables}
              selectedIds={previewIds}
              onChange={() => {}}
              partySize={2}
              minHeight={180}
              previewMode
              layoutWidth={layoutWidth}
              layoutHeight={layoutHeight}
              preserveLayoutAspect
            />
          </div>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,40vw)]">
        <div className="min-w-0">
          {combinationsSubTab === 'auto' && (
            <section>
              <h3 className="text-sm font-semibold text-slate-900">
                Auto-detected combinations
                {!catalogLoading && (
                  <span className="ml-2 font-normal text-slate-500">
                    ({filteredAutoGroups.length}
                    {filterTableId && autoGroups.length !== filteredAutoGroups.length
                      ? ` of ${autoGroups.length}`
                      : ''}
                    )
                  </span>
                )}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                From adjacency on the floor plan (read-only). Disable or adjust rules without changing table positions.
                Lock a combination in Edit to keep it listed and bookable even if it is no longer auto-detected after you
                change the combination distance or layout.
              </p>
              {catalogLoading ? (
                <div className="mt-4">
                  <FloorPlanTablesPanelSkeleton />
                </div>
              ) : autoGroups.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">
                  No adjacent table pairs or groups found. Adjust the layout or combination threshold.
                </p>
              ) : filteredAutoGroups.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">
                  No auto-detected combinations include{' '}
                  <span className="font-medium text-slate-700">{filterTableLabel}</span>. Choose another table or clear the
                  filter.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                  {filteredAutoGroups.map((g) => (
                    <li
                      key={g.table_group_key}
                      className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm ${
                        g.status === 'disabled' ? 'bg-slate-50 opacity-70' : ''
                      }`}
                      onMouseEnter={() => setPreviewIds(g.table_ids)}
                      onMouseLeave={() => setPreviewIds([])}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={g.status === 'disabled' ? 'line-through text-slate-500' : 'font-medium text-slate-800'}
                          >
                            {g.default_name}
                          </span>
                          {g.status === 'modified' && (
                            <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-violet-800">
                              Modified
                            </span>
                          )}
                          {g.is_locked && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-900">
                              Locked
                            </span>
                          )}
                          {g.status === 'disabled' && (
                            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                              Disabled
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Up to {g.effective_max_covers} guests
                          {g.override &&
                          (g.override.combined_max_covers != null || g.override.combined_min_covers != null) ? (
                            <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-600">Custom</span>
                          ) : null}
                        </p>
                      </div>
                      {isAdmin && (
                        <div className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                            onClick={() => setModal({ mode: 'auto', group: g })}
                          >
                            Edit
                          </button>
                          {g.status === 'disabled' ? (
                            <button
                              type="button"
                              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                              onClick={async () => {
                                try {
                                  await saveAutoOverride({
                                    table_group_key: g.table_group_key,
                                    disabled: false,
                                  });
                                } catch (e) {
                                  setToast((e as Error).message);
                                }
                              }}
                            >
                              Enable
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                              onClick={async () => {
                                if (!confirm(`${g.default_name} will no longer combine for bookings. Continue?`)) return;
                                try {
                                  await saveAutoOverride({
                                    table_group_key: g.table_group_key,
                                    disabled: true,
                                  });
                                  setToast(`${g.default_name} will no longer combine for bookings`);
                                } catch (e) {
                                  setToast((e as Error).message);
                                }
                              }}
                            >
                              Disable
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {combinationsSubTab === 'custom' && (
            <section>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  Custom combinations
                  {combinations.length > 0 && (
                    <span className="ml-2 font-normal text-slate-500">
                      (
                      {filterTableId ? (
                        <>
                          {filteredCombinations.length}
                          {combinations.length !== filteredCombinations.length ? ` of ${combinations.length}` : ''}
                        </>
                      ) : (
                        combinations.length
                      )}
                      )
                    </span>
                  )}
                </h3>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setModal({ mode: 'custom', combo: null })}
                    className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
                  >
                    + Add custom combination
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                For joins the auto-detector cannot see (e.g. tables you push together for events).
              </p>
              {combinations.length === 0 ? (
                <div className="mt-4 rounded-xl border border-dashed border-slate-300 px-6 py-8 text-center text-sm text-slate-500">
                  No custom combinations yet. Add one to define table joins that the auto-detector can&apos;t see (e.g.
                  tables across the room for special events).
                </div>
              ) : filteredCombinations.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">
                  No custom combinations include{' '}
                  <span className="font-medium text-slate-700">{filterTableLabel}</span>. Choose another table or clear the
                  filter.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                  {filteredCombinations.map((combo) => (
                    <li
                      key={combo.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"
                      onMouseEnter={() => setPreviewIds((combo.members ?? []).map((m) => m.table_id))}
                      onMouseLeave={() => setPreviewIds([])}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-800">{combo.name}</span>
                          <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand-800">
                            Custom
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {(combo.members ?? [])
                            .map((m) => (m as { table?: { name?: string } }).table?.name ?? m.table_id)
                            .join(', ')}
                          {' · '}
                          {combo.combined_min_covers}–{combo.combined_max_covers} guests
                        </p>
                      </div>
                      {isAdmin && (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                            onClick={() => setModal({ mode: 'custom', combo })}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                            onClick={async () => {
                              if (!confirm('Delete this combination?')) return;
                              const res = await fetch(`/api/venue/tables/combinations?id=${combo.id}`, { method: 'DELETE' });
                              if (res.ok) {
                                setCombinations(combinations.filter((c) => c.id !== combo.id));
                                setToast('Combination deleted');
                              }
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

          <aside className="sticky top-6 z-10 hidden w-full max-w-[40vw] justify-self-end lg:block">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Preview</p>
            <div className="w-full rounded-xl border border-slate-200 bg-slate-50">
              <MiniFloorPlanPicker
                tables={miniTables}
                selectedIds={previewIds}
                onChange={() => {}}
                partySize={2}
                minHeight={220}
                previewMode
                layoutWidth={layoutWidth}
                layoutHeight={layoutHeight}
                preserveLayoutAspect
              />
            </div>
          </aside>
        </div>
      </div>

      {modal?.mode === 'auto' && (
        <AutoOverrideModal
          group={modal.group}
          onClose={() => setModal(null)}
          onSave={saveAutoOverride}
        />
      )}
      {modal?.mode === 'custom' && (
        <CustomComboModal
          combo={modal.combo}
          tables={tables}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            onRefresh();
            setToast('Combination saved');
          }}
        />
      )}
    </div>
  );
}

function AutoOverrideModal({
  group,
  onClose,
  onSave,
}: {
  group: CatalogAutoGroup;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  const ov = group.override ?? {};
  const [disabled, setDisabled] = useState(
    group.status === 'disabled' || Boolean((ov as { disabled?: boolean }).disabled),
  );
  const [locked, setLocked] = useState(
    group.is_locked || Boolean((ov as { locked?: boolean }).locked),
  );
  const [name, setName] = useState((ov.display_name as string) ?? '');
  const [minC, setMinC] = useState<number | ''>((ov.combined_min_covers as number | null) ?? '');
  const [maxC, setMaxC] = useState<number | ''>((ov.combined_max_covers as number | null) ?? '');
  const [days, setDays] = useState<number[]>(
    (ov.days_of_week as number[] | undefined) ?? [1, 2, 3, 4, 5, 6, 7],
  );
  const [tStart, setTStart] = useState((ov.time_start as string | null) ?? '');
  const [tEnd, setTEnd] = useState((ov.time_end as string | null) ?? '');
  const [types, setTypes] = useState<string[]>(
    ((ov.booking_type_filters as string[] | null) ?? []).filter(Boolean),
  );
  const [mgr, setMgr] = useState(Boolean(ov.requires_manager_approval));
  const [notes, setNotes] = useState((ov.internal_notes as string | null) ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggleDay = (d: number) => {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));
  };

  const save = async () => {
    if (days.length === 0) {
      setErr('Select at least one day');
      return;
    }
    if (tStart && tEnd && tEnd <= tStart) {
      setErr('End time must be after start time');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await onSave({
        table_group_key: group.table_group_key,
        disabled,
        locked,
        display_name: name.trim() || null,
        combined_min_covers: minC === '' ? null : Number(minC),
        combined_max_covers: maxC === '' ? null : Number(maxC),
        days_of_week: days,
        time_start: tStart || null,
        time_end: tEnd || null,
        booking_type_filters: types.length ? types : null,
        requires_manager_approval: mgr,
        internal_notes: notes.trim() || null,
      });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold text-slate-900">Edit auto-detected combination</h3>
        <p className="mt-1 text-xs text-slate-500">Tables: {group.default_name}</p>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={disabled} onChange={(e) => setDisabled(e.target.checked)} />
          Disabled (excluded from booking suggestions)
        </label>
        <label className="mt-2 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={locked}
            disabled={disabled}
            onChange={(e) => setLocked(e.target.checked)}
          />
          <span>
            Lock this combination — keep it when you click &quot;Update Automatic Table Combinations&quot; even if tables
            are no longer detected as adjacent.
          </span>
        </label>
        <div className="mt-3">
          <label className="text-xs font-medium text-slate-600">Name (optional)</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            placeholder={group.default_name}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="mt-0.5 text-[10px] text-slate-500">Leave blank to use the auto-generated name in lists.</p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-slate-600">Min party (optional)</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              placeholder="1"
              value={minC === '' ? '' : String(minC)}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9]/g, '');
                setMinC(v === '' ? '' : parseInt(v, 10));
              }}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Max party (optional)</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              placeholder={`Auto: ${group.default_capacity}`}
              value={maxC === '' ? '' : String(maxC)}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9]/g, '');
                setMaxC(v === '' ? '' : parseInt(v, 10));
              }}
            />
          </div>
        </div>
        <details className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-slate-800">When is this combination available?</summary>
          <div className="mt-3 space-y-3 pb-1">
            <div>
              <p className="text-xs text-slate-600">Days of week</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((lbl, i) => {
                  const d = i + 1;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDay(d)}
                      className={`h-8 w-8 rounded text-xs font-medium ${
                        days.includes(d) ? 'bg-brand-600 text-white' : 'bg-white border border-slate-200 text-slate-600'
                      }`}
                    >
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-600">Start time</label>
                <input type="time" className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" value={tStart} onChange={(e) => setTStart(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-slate-600">End time</label>
                <input type="time" className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" value={tEnd} onChange={(e) => setTEnd(e.target.value)} />
              </div>
            </div>
            <p className="text-[10px] text-slate-500">Leave times blank for all-day availability.</p>
            <div>
              <p className="text-xs text-slate-600">Booking types (empty = all)</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {BOOKING_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() =>
                      setTypes((prev) =>
                        prev.includes(opt.id) ? prev.filter((x) => x !== opt.id) : [...prev, opt.id],
                      )
                    }
                    className={`rounded px-2 py-0.5 text-[11px] ${
                      types.includes(opt.id) ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-600'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </details>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mgr} onChange={(e) => setMgr(e.target.checked)} />
          Manager approval required (never auto-assigned)
        </label>
        <div className="mt-3">
          <label className="text-xs font-medium text-slate-600">Internal notes</label>
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            rows={2}
            placeholder="Notes for staff when this combination is used"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="rounded-lg border border-slate-300 px-4 py-2 text-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CustomComboModal({
  combo,
  tables,
  onClose,
  onSaved,
}: {
  combo: TableCombination | null;
  tables: VenueTable[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(combo?.name ?? '');
  const [ids, setIds] = useState<string[]>(combo ? (combo.members ?? []).map((m) => m.table_id) : []);
  const [minC, setMinC] = useState(combo?.combined_min_covers ?? 1);
  const [maxC, setMaxC] = useState(combo?.combined_max_covers ?? 4);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (id: string) => {
    setIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const save = async () => {
    if (ids.length < 2) {
      setErr('Select at least two tables');
      return;
    }
    if (!name.trim()) {
      setErr('Name is required');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      if (combo) {
        const res = await fetch(`/api/venue/tables/combinations?id=${combo.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            combined_min_covers: minC,
            combined_max_covers: maxC,
            table_ids: ids,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error((j as { error?: string }).error ?? 'Update failed');
        }
      } else {
        const res = await fetch('/api/venue/tables/combinations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            combined_min_covers: minC,
            combined_max_covers: maxC,
            table_ids: ids,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error((j as { error?: string }).error ?? 'Create failed');
        }
      }
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold text-slate-900">{combo ? 'Edit custom combination' : 'New custom combination'}</h3>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        <div className="mt-3">
          <label className="text-xs font-medium text-slate-600">Name</label>
          <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="mt-3">
          <label className="text-xs font-medium text-slate-600">Tables</label>
          <div className="mt-1 flex flex-wrap gap-1">
            {tables.filter((t) => t.is_active).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => toggle(t.id)}
                className={`rounded-lg border px-2 py-1 text-xs ${
                  ids.includes(t.id) ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600'
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-slate-600">Min covers</label>
            <NumericInput
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={minC}
              min={1}
              onChange={setMinC}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Max covers</label>
            <NumericInput
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={maxC}
              min={1}
              onChange={setMaxC}
            />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="rounded-lg border border-slate-300 px-4 py-2 text-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
