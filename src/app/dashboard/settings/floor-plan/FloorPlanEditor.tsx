'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import type { VenueTable, TableShape, TableType, FloorPlan } from '@/types/table-management';
import {
  getTableDimensions,
  computeGridPositions,
  TABLE_TYPES,
  tableDimensionsPercentToPixels,
  tablePixelDimensionsToPercent,
} from '@/types/table-management';
import { reshapePolygonVertexAtLocalPosition } from '@/lib/floor-plan/polygon-vertex-reshape';
import type { LayoutResizeAnchor } from '@/app/dashboard/settings/floor-plan/KonvaCanvas';
import Link from 'next/link';
import { NumericInput } from '@/components/ui/NumericInput';
import { DashboardGridSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';

const KonvaCanvas = dynamic(() => import('./KonvaCanvas'), { ssr: false });

// Constants

/** Keyboard nudge step in layout % (~1 px on a 2600px wide canvas). Shift = 10×. */
const NUDGE_STEP_PCT = 0.2;
const NUDGE_BIG_STEP_PCT = 2;
/** Max undo history entries. */
const HISTORY_LIMIT = 80;
/** Dedup adjacent snapshots within this window (ms) to compress slider drags. */
const HISTORY_DEDUP_MS = 350;
/** Grid step (in % of layout) for snap-to-grid and optional move snapping. */
const GRID_STEP_PCT = 2;

// Types

interface CombinationLink {
  id: string;
  name: string;
  tableIds: string[];
}

interface PositionRow {
  table_id: string;
  position_x: number | null;
  position_y: number | null;
  width: number | null;
  height: number | null;
  rotation: number;
  seat_angles?: (number | null)[] | null;
  polygon_points?: { x: number; y: number }[] | null;
}

interface PropEdits {
  name: string;
  table_type: TableType;
  min_covers: number;
  max_covers: number;
}

interface Props {
  className?: string;
  embedded?: boolean;
  /** Called after each debounced position save completes successfully. */
  onLayoutSaved?: () => void;
  /** Scope floor plans and tables to this dining area (multi-area venues). */
  diningAreaId?: string | null;
}

const SHAPE_OPTIONS: { shape: TableShape; label: string }[] = [
  { shape: 'rectangle', label: 'Rectangle' },
  { shape: 'square', label: 'Square' },
  { shape: 'circle', label: 'Round' },
  { shape: 'oval', label: 'Oval' },
  { shape: 'polygon', label: 'Custom' },
];

// Main component

export function FloorPlanEditor({ className, embedded = false, onLayoutSaved, diningAreaId }: Props) {
  const areaQs = diningAreaId ? `?area_id=${encodeURIComponent(diningAreaId)}` : '';

  // Floor plans
  const [floorPlans, setFloorPlans] = useState<FloorPlan[]>([]);
  const [activeFloorPlanId, setActiveFloorPlanId] = useState<string | null>(null);
  const [showFloorPlanMenu, setShowFloorPlanMenu] = useState(false);
  const [newPlanName, setNewPlanName] = useState('');
  const [floorPlanMenuAction, setFloorPlanMenuAction] = useState<'add' | 'rename' | null>(null);
  const [floorPlanSaving, setFloorPlanSaving] = useState(false);

  // Core state
  const [tables, setTables] = useState<VenueTable[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [combinations, setCombinations] = useState<CombinationLink[]>([]);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Background
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [backgroundUploading, setBackgroundUploading] = useState(false);
  const backgroundFileRef = useRef<HTMLInputElement>(null);

  // Placement aids
  const [comboSaving, setComboSaving] = useState(false);
  const [alignmentGuidesEnabled, setAlignmentGuidesEnabled] = useState(false);
  /** Snap table positions to the grid while moving (applied on commit of move). */
  const [gridSnapEnabled, setGridSnapEnabled] = useState(false);
  /** Show a grid overlay on the canvas. */
  const [showGrid, setShowGrid] = useState(false);

  // Canvas layout size (from active floor plan)
  const [layoutWidth, setLayoutWidth] = useState<number | null>(null);
  const [layoutHeight, setLayoutHeight] = useState<number | null>(null);
  const [canvasDims, setCanvasDims] = useState<{ width: number; height: number }>({ width: 2600, height: 2600 });

  // Polygon drawing mode
  const [polygonDrawPending, setPolygonDrawPending] = useState(false);
  const [polygonEditTableId, setPolygonEditTableId] = useState<string | null>(null);

  // Inline property editing
  const [propEdits, setPropEdits] = useState<PropEdits | null>(null);
  const [propSaving, setPropSaving] = useState(false);
  const [propError, setPropError] = useState<string | null>(null);

  // Refs
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialArrangeDone = useRef(false);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);

  // --- Live mirror of tables for handlers that need the latest snapshot ---
  const tablesRef = useRef<VenueTable[]>(tables);
  useEffect(() => { tablesRef.current = tables; }, [tables]);

  // --- Undo / redo (geometry only: move / resize / rotate / seat / polygon /
  //     auto-arrange / snap / plan rotate / layout resize). Deletes and creates
  //     are intentionally not undoable because they round-trip the server. ---
  const historyRef = useRef<{
    undo: VenueTable[][];
    redo: VenueTable[][];
    lastPushTs: number;
  }>({ undo: [], redo: [], lastPushTs: 0 });
  const [, forceHistoryTick] = useState(0);
  const bumpHistoryTick = useCallback(() => forceHistoryTick((v) => v + 1), []);

  /** Snapshot current `tables` onto the undo stack, clearing redo. */
  const pushHistory = useCallback(() => {
    const h = historyRef.current;
    const now = Date.now();
    if (now - h.lastPushTs < HISTORY_DEDUP_MS) return;
    h.undo.push(tablesRef.current);
    if (h.undo.length > HISTORY_LIMIT) h.undo.shift();
    h.redo = [];
    h.lastPushTs = now;
    bumpHistoryTick();
  }, [bumpHistoryTick]);

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const fetchCombinations = useCallback(async () => {
    try {
      const res = await fetch(`/api/venue/tables/combinations${areaQs}`);
      if (res.ok) {
        const data = await res.json();
        const links: CombinationLink[] = (data.combinations ?? []).map(
          (c: { id: string; name: string; members?: { table_id: string }[] }) => ({
            id: c.id,
            name: c.name,
            tableIds: (c.members ?? []).map((m: { table_id: string }) => m.table_id),
          }),
        );
        setCombinations(links);
      }
    } catch (err) {
      console.error('Failed to load combinations:', err);
    }
  }, [areaQs]);

  const fetchFloorPlans = useCallback(async (): Promise<FloorPlan[]> => {
    try {
      const res = await fetch(`/api/venue/floor-plans${areaQs}`);
      if (res.ok) {
        const data = await res.json();
        const plans: FloorPlan[] = data.floor_plans ?? [];
        setFloorPlans(plans);
        return plans;
      }
    } catch (err) {
      console.error('Failed to load floor plans:', err);
    }
    return [];
  }, [areaQs]);

  const fetchTables = useCallback(async () => {
    setLoading(true);
    try {
      // Load floor plans and tables in parallel
      const [tablesRes, plans] = await Promise.all([
        fetch(`/api/venue/tables${areaQs}`),
        fetchFloorPlans(),
        fetchCombinations(),
      ]);
      if (tablesRes.ok) {
        const data = await tablesRes.json();

        // Determine active floor plan and its background
        let bgUrl: string | null = data.settings?.floor_plan_background_url ?? null;
        let activePlanId: string | null = null;

        if (plans.length > 0) {
          // Use first plan as default active
          activePlanId = plans[0]!.id;
          bgUrl = plans[0]!.background_url ?? bgUrl;
          setActiveFloorPlanId(activePlanId);
          setLayoutWidth(plans[0]!.canvas_width ?? null);
          setLayoutHeight(plans[0]!.canvas_height ?? null);

          // Load per-plan positions
          const posRes = await fetch(`/api/venue/floor-plans/${activePlanId}/positions`);
          if (posRes.ok) {
            const posData = await posRes.json();
            const posMap = new Map<string, PositionRow>(
              (posData.positions as PositionRow[]).map((p) => [p.table_id, p]),
            );
            // Merge floor-plan positions into tables
            let active = ((data.tables ?? []) as VenueTable[]).filter((t) => t.is_active);
            active = active.map((t) => {
              const pos = posMap.get(t.id);
              if (!pos) return t;
              return {
                ...t,
                position_x: pos.position_x,
                position_y: pos.position_y,
                width: pos.width,
                height: pos.height,
                rotation: pos.rotation,
                seat_angles: pos.seat_angles ?? t.seat_angles ?? null,
                polygon_points: pos.polygon_points ?? t.polygon_points ?? null,
              };
            });
            setBackgroundUrl(bgUrl);
            setTables(active);
            return;
          }
        }

        setBackgroundUrl(bgUrl);
        let active = ((data.tables ?? []) as VenueTable[]).filter((t) => t.is_active);

        const allUnpositioned =
          active.length > 0 && active.every((t) => t.position_x == null || t.position_y == null);

        if (allUnpositioned && !initialArrangeDone.current) {
          initialArrangeDone.current = true;
          const positions = computeGridPositions(active);
          active = active.map((t, i) => {
            const dims = getTableDimensions(t.max_covers, t.shape);
            return {
              ...t,
              position_x: positions[i]!.position_x,
              position_y: positions[i]!.position_y,
              width: t.width ?? dims.width,
              height: t.height ?? dims.height,
            };
          });
          const updates = active.map((t) => ({
            id: t.id,
            position_x: t.position_x,
            position_y: t.position_y,
            width: t.width,
            height: t.height,
          }));
          fetch('/api/venue/tables', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
          }).catch((err) => console.error('Auto-arrange save failed:', err));
        }

        setTables(active);
      }
    } catch (err) {
      console.error('Failed to load tables:', err);
    } finally {
      setLoading(false);
    }
  }, [fetchFloorPlans, fetchCombinations, areaQs]);

  useEffect(() => {
    fetchTables();
  }, [fetchTables]);

  /** New area = fresh canvas: allow one-time grid auto-arrange for unpositioned tables in that area. */
  useEffect(() => {
    initialArrangeDone.current = false;
  }, [diningAreaId]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Close floor plan menu when clicking outside
  useEffect(() => {
    if (!showFloorPlanMenu) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-floor-plan-menu]')) {
        setShowFloorPlanMenu(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showFloorPlanMenu]);

  // Sync propEdits when selection changes
  useEffect(() => {
    const selectedId = selectedIds.length === 1 ? selectedIds[0]! : null;
    const selected = selectedId ? tables.find((t) => t.id === selectedId) : null;
    if (selected) {
      setPropEdits({
        name: selected.name,
        table_type: (selected.table_type as TableType) ?? 'Regular',
        min_covers: selected.min_covers,
        max_covers: selected.max_covers,
      });
      setPropError(null);
    } else {
      setPropEdits(null);
    }
  }, [selectedIds, tables]);

  // ---------------------------------------------------------------------------
  // Position save (debounced, with real error surfacing)
  // ---------------------------------------------------------------------------

  /** Execute the network write. Returns whether it succeeded. */
  const runPositionSave = useCallback(async (updatedTables: VenueTable[]): Promise<boolean> => {
    // The legacy venue_tables position columns are the single source of truth for
    // every downstream consumer (AdjacencyPreview, recalculate API, live floor canvas).
    // We always write there so those systems stay current.
    const legacyUpdates = updatedTables.map((t) => ({
      id: t.id,
      position_x: t.position_x,
      position_y: t.position_y,
      width: t.width,
      height: t.height,
      rotation: t.rotation,
      seat_angles: t.seat_angles ?? null,
      polygon_points: t.polygon_points ?? null,
    }));

    try {
      if (activeFloorPlanId) {
        const fpUpdates = updatedTables.map((t) => ({
          table_id: t.id,
          position_x: t.position_x,
          position_y: t.position_y,
          width: t.width,
          height: t.height,
          rotation: t.rotation ?? 0,
          seat_angles: t.seat_angles ?? null,
          polygon_points: t.polygon_points ?? null,
        }));
        const [fpRes, legacyRes] = await Promise.all([
          fetch(`/api/venue/floor-plans/${activeFloorPlanId}/positions`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fpUpdates),
          }),
          fetch('/api/venue/tables', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(legacyUpdates),
          }),
        ]);
        if (!fpRes.ok || !legacyRes.ok) {
          console.error('Save positions failed:', fpRes.status, legacyRes.status);
          return false;
        }
      } else {
        const res = await fetch('/api/venue/tables', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(legacyUpdates),
        });
        if (!res.ok) {
          console.error('Save positions failed:', res.status);
          return false;
        }
      }
      return true;
    } catch (err) {
      console.error('Save positions failed:', err);
      return false;
    }
  }, [activeFloorPlanId]);

  const savePositions = useCallback((updatedTables: VenueTable[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaveStatus('saving');
      const ok = await runPositionSave(updatedTables);
      if (ok) {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), 2000);
        onLayoutSaved?.();
      } else {
        setSaveStatus('error');
      }
    }, 1000);
  }, [runPositionSave, onLayoutSaved]);

  /** Retry the last pending save immediately. Useful for the error state button. */
  const retrySaveNow = useCallback(async () => {
    setSaveStatus('saving');
    const ok = await runPositionSave(tablesRef.current);
    if (ok) {
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), 2000);
      onLayoutSaved?.();
    } else {
      setSaveStatus('error');
    }
  }, [runPositionSave, onLayoutSaved]);

  // ---------------------------------------------------------------------------
  // Canvas / move handlers
  // ---------------------------------------------------------------------------

  const handleTableMove = useCallback(
    (tableId: string, x: number, y: number) => {
      pushHistory();
      setTables((prev) => {
        const source = prev.find((t) => t.id === tableId);
        if (!source) return prev;

        // If the moved table is part of a multi-selection, move the whole group
        // by the same delta. Otherwise just move the one.
        const isGroup = selectedIds.length > 1 && selectedIds.includes(tableId);
        const dx = x - (source.position_x ?? 50);
        const dy = y - (source.position_y ?? 50);

        // Grid snap: applied to the *dragged* table's final position; group members
        // move by the same delta so spacing is preserved.
        const snap = (v: number) =>
          gridSnapEnabled ? Math.round(v / GRID_STEP_PCT) * GRID_STEP_PCT : v;

        const updated = prev.map((t) => {
          if (!isGroup && t.id !== tableId) return t;
          if (!isGroup) {
            return { ...t, position_x: snap(x), position_y: snap(y) };
          }
          if (!selectedIds.includes(t.id)) return t;
          if (t.position_x == null || t.position_y == null) return t;
          if (t.id === tableId) {
            return { ...t, position_x: snap(x), position_y: snap(y) };
          }
          return {
            ...t,
            position_x: Math.max(0, Math.min(100, t.position_x + dx)),
            position_y: Math.max(0, Math.min(100, t.position_y + dy)),
          };
        });
        savePositions(updated);
        return updated;
      });
    },
    [savePositions, pushHistory, selectedIds, gridSnapEnabled],
  );

  const handleTableResize = useCallback(
    (tableId: string, width: number, height: number) => {
      pushHistory();
      setTables((prev) => {
        const updated = prev.map((t) => {
          if (t.id !== tableId) return t;
          // Square tables must stay square — always force width == height.
          if (t.shape === 'square') {
            const side = Math.max(width, height);
            return { ...t, width: side, height: side };
          }
          return { ...t, width, height };
        });
        savePositions(updated);
        return updated;
      });
    },
    [savePositions, pushHistory],
  );

  const handleSeatDrag = useCallback(
    (tableId: string, seatIndex: number, newAngle: number) => {
      setTables((prev) =>
        prev.map((t) => {
          if (t.id !== tableId) return t;
          const angles: (number | null)[] = Array.from(
            { length: t.max_covers },
            (_, i) => ((t as { seat_angles?: (number | null)[] | null }).seat_angles?.[i] ?? null),
          );
          angles[seatIndex] = newAngle;
          return { ...t, seat_angles: angles } as VenueTable & { seat_angles: (number | null)[] };
        }),
      );
    },
    [],
  );

  const handleSeatDragEnd = useCallback(
    (tableId: string, seatIndex: number, newAngle: number) => {
      pushHistory();
      setTables((prev) => {
        const updated = prev.map((t) => {
          if (t.id !== tableId) return t;
          const existing = (t as { seat_angles?: (number | null)[] | null }).seat_angles;
          const angles: (number | null)[] = Array.from(
            { length: t.max_covers },
            (_, i) => (existing?.[i] ?? null),
          );
          angles[seatIndex] = newAngle;
          return { ...t, seat_angles: angles } as VenueTable & { seat_angles: (number | null)[] };
        });
        savePositions(updated);
        return updated;
      });
    },
    [savePositions, pushHistory],
  );

  /** Clear per-seat angle overrides so chairs use the default even distribution for the shape. */
  const resetSeatAnglesToEven = useCallback(
    (tableId: string) => {
      pushHistory();
      setTables((prev) => {
        const updated = prev.map((t) =>
          t.id === tableId ? { ...t, seat_angles: null } : t,
        );
        savePositions(updated);
        return updated;
      });
    },
    [savePositions, pushHistory],
  );

  const handlePolygonVertexDrag = useCallback(
    (tableId: string, vertexIndex: number, localX: number, localY: number) => {
      setTables((prev) =>
        prev.map((t) => {
          if (t.id !== tableId || t.shape !== 'polygon' || !t.polygon_points || t.polygon_points.length < 3) {
            return t;
          }
          const fb = getTableDimensions(t.max_covers, t.shape);
          const wPct = t.width ?? fb.width;
          const hPct = t.height ?? fb.height;
          try {
            const next = reshapePolygonVertexAtLocalPosition({
              polygon_points: t.polygon_points,
              widthPct: wPct,
              heightPct: hPct,
              canvasWidth: canvasDims.width,
              canvasHeight: canvasDims.height,
              positionXPct: t.position_x,
              positionYPct: t.position_y,
              rotationDeg: t.rotation ?? 0,
              vertexIndex,
              newLocalX: localX,
              newLocalY: localY,
            });
            return { ...t, ...next };
          } catch {
            return t;
          }
        }),
      );
    },
    [canvasDims.width, canvasDims.height],
  );

  const handlePolygonVertexDragEnd = useCallback(() => {
    pushHistory();
    setTables((prev) => {
      savePositions(prev);
      return prev;
    });
  }, [savePositions, pushHistory]);

  // Snapshot of table pixel positions before resize started — used to keep
  // tables visually fixed during the drag.  Captured on first call to
  // handleLayoutResize after a reset (null).
  const layoutResizeSnapshotRef = useRef<{
    prevW: number;
    prevH: number;
    tablePx: Map<string, { x: number; y: number; w: number; h: number }>;
  } | null>(null);

  const handleLayoutResize = useCallback(
    (w: number, h: number, opts?: { anchor: LayoutResizeAnchor }) => {
      const nextW = Math.max(1600, Math.min(12000, w));
      const nextH = Math.max(1200, Math.min(9000, h));
      const anchor = opts?.anchor ?? 'se';

      // On the first frame of a resize gesture, snapshot current pixel positions
      // *and* push the pre-gesture geometry onto the undo stack.
      if (!layoutResizeSnapshotRef.current) {
        pushHistory();
        const prevW = canvasDims.width;
        const prevH = canvasDims.height;
        const tablePx = new Map<string, { x: number; y: number; w: number; h: number }>();
        for (const t of tables) {
          const fb = getTableDimensions(t.max_covers, t.shape);
          const { w, h } = tableDimensionsPercentToPixels(
            t.width ?? fb.width,
            t.height ?? fb.height,
            prevW,
            prevH,
            t.shape,
          );
          tablePx.set(t.id, {
            x: ((t.position_x ?? 50) / 100) * prevW,
            y: ((t.position_y ?? 50) / 100) * prevH,
            w,
            h,
          });
        }
        layoutResizeSnapshotRef.current = { prevW, prevH, tablePx };
      }

      const snap = layoutResizeSnapshotRef.current;
      const deltaW = nextW - snap.prevW;
      const deltaH = nextH - snap.prevH;

      setLayoutWidth(nextW);
      setLayoutHeight(nextH);
      setCanvasDims({ width: nextW, height: nextH });

      // Re-derive percentages from snapshotted pixel coords so tables stay put.
      setTables((prev) =>
        prev.map((t) => {
          const px = snap.tablePx.get(t.id);
          if (!px) return t;

          let shiftX = 0;
          let shiftY = 0;
          if (anchor === 'w' || anchor === 'nw' || anchor === 'sw') shiftX = deltaW;
          if (anchor === 'n' || anchor === 'nw' || anchor === 'ne') shiftY = deltaH;

          const pct = tablePixelDimensionsToPercent(px.w, px.h, nextW, nextH, t.shape);
          return {
            ...t,
            position_x: Math.max(0, Math.min(100, ((px.x + shiftX) / nextW) * 100)),
            position_y: Math.max(0, Math.min(100, ((px.y + shiftY) / nextH) * 100)),
            width: Math.max(1, pct.widthPct),
            height: Math.max(1, pct.heightPct),
          };
        }),
      );
    },
    [canvasDims.width, canvasDims.height, tables, pushHistory],
  );

  /** Called once when the user releases the resize handle — persists to DB. */
  const handleLayoutResizeEnd = useCallback(() => {
    layoutResizeSnapshotRef.current = null;

    const w = Math.round(canvasDims.width);
    const h = Math.round(canvasDims.height);
    setLayoutWidth(w);
    setLayoutHeight(h);
    setCanvasDims({ width: w, height: h });

    // Persist table positions.
    setTables((prev) => {
      savePositions(prev);
      return prev;
    });

    if (!activeFloorPlanId) return;
    void (async () => {
      try {
        await fetch(`/api/venue/floor-plans/${activeFloorPlanId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canvas_width: w, canvas_height: h }),
        });
        setFloorPlans((prev) =>
          prev.map((p) => (p.id === activeFloorPlanId ? { ...p, canvas_width: w, canvas_height: h } : p)),
        );
      } catch (err) {
        console.error('Failed to save layout size:', err);
      }
    })();
  }, [activeFloorPlanId, canvasDims.width, canvasDims.height, savePositions]);

  const handleTableRotate = useCallback(
    (tableId: string, rotation: number) => {
      pushHistory();
      setTables((prev) => {
        const updated = prev.map((t) => (t.id === tableId ? { ...t, rotation } : t));
        savePositions(updated);
        return updated;
      });
    },
    [savePositions, pushHistory],
  );

  const handleSelect = useCallback((id: string | null, additive?: boolean) => {
    if (!id) {
      setSelectedIds([]);
      return;
    }
    if (additive) {
      setSelectedIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
      );
    } else {
      setSelectedIds([id]);
    }
  }, []);

  const handleMultiSelect = useCallback((ids: string[]) => {
    setSelectedIds(ids);
  }, []);

  // ---------------------------------------------------------------------------
  // Layout utilities
  // ---------------------------------------------------------------------------

  const snapToGrid = useCallback(() => {
    pushHistory();
    setTables((prev) => {
      const updated = prev.map((t) => ({
        ...t,
        position_x: t.position_x != null
          ? Math.round(t.position_x / GRID_STEP_PCT) * GRID_STEP_PCT
          : t.position_x,
        position_y: t.position_y != null
          ? Math.round(t.position_y / GRID_STEP_PCT) * GRID_STEP_PCT
          : t.position_y,
      }));
      savePositions(updated);
      return updated;
    });
  }, [savePositions, pushHistory]);

  const autoArrange = useCallback(() => {
    pushHistory();
    setTables((prev) => {
      const positions = computeGridPositions(prev);
      const updated = prev.map((t, i) => {
        const fb = getTableDimensions(t.max_covers, t.shape);
        return {
          ...t,
          position_x: positions[i]!.position_x,
          position_y: positions[i]!.position_y,
          // Preserve the user's chosen size; only fall back to default if unset.
          width: t.width ?? fb.width,
          height: t.height ?? fb.height,
        };
      });
      savePositions(updated);
      return updated;
    });
  }, [savePositions, pushHistory]);

  const rotatePlanCW = useCallback(() => {
    pushHistory();
    // Rotate 90° CW about (50,50): (x,y) → (100-y, x); swap w/h; add 90° to per-table rotation.
    setTables((prev) => {
      const updated = prev.map((t) => {
        if (t.position_x == null || t.position_y == null) return t;
        return {
          ...t,
          position_x: 100 - t.position_y,
          position_y: t.position_x,
          width: t.height,
          height: t.width,
          rotation: ((t.rotation ?? 0) + 90) % 360,
        };
      });
      savePositions(updated);
      return updated;
    });
  }, [savePositions, pushHistory]);

  const rotatePlanCCW = useCallback(() => {
    pushHistory();
    // Rotate 90° CCW about (50,50): (x,y) → (y, 100-x); swap w/h; subtract 90° from per-table rotation.
    setTables((prev) => {
      const updated = prev.map((t) => {
        if (t.position_x == null || t.position_y == null) return t;
        return {
          ...t,
          position_x: t.position_y,
          position_y: 100 - t.position_x,
          width: t.height,
          height: t.width,
          rotation: (((t.rotation ?? 0) - 90) % 360 + 360) % 360,
        };
      });
      savePositions(updated);
      return updated;
    });
  }, [savePositions, pushHistory]);

  // ---------------------------------------------------------------------------
  // Undo / redo
  // ---------------------------------------------------------------------------

  const performUndo = useCallback(() => {
    const h = historyRef.current;
    const prev = h.undo.pop();
    if (!prev) return;
    h.redo.push(tablesRef.current);
    h.lastPushTs = 0;
    setTables(prev);
    savePositions(prev);
    bumpHistoryTick();
  }, [savePositions, bumpHistoryTick]);

  const performRedo = useCallback(() => {
    const h = historyRef.current;
    const next = h.redo.pop();
    if (!next) return;
    h.undo.push(tablesRef.current);
    h.lastPushTs = 0;
    setTables(next);
    savePositions(next);
    bumpHistoryTick();
  }, [savePositions, bumpHistoryTick]);

  const canUndo = historyRef.current.undo.length > 0;
  const canRedo = historyRef.current.redo.length > 0;

  // ---------------------------------------------------------------------------
  // Nudge / multi-delete
  // ---------------------------------------------------------------------------

  /** Move every selected table by (dxPct, dyPct). Clamped to 0..100. */
  const nudgeSelected = useCallback(
    (dxPct: number, dyPct: number) => {
      if (selectedIds.length === 0) return;
      pushHistory();
      setTables((prev) => {
        const updated = prev.map((t) => {
          if (!selectedIds.includes(t.id)) return t;
          if (t.position_x == null || t.position_y == null) return t;
          return {
            ...t,
            position_x: Math.max(0, Math.min(100, t.position_x + dxPct)),
            position_y: Math.max(0, Math.min(100, t.position_y + dyPct)),
          };
        });
        savePositions(updated);
        return updated;
      });
    },
    [selectedIds, savePositions, pushHistory],
  );

  const deleteSelected = useCallback(async () => {
    if (selectedIds.length === 0) return;
    const n = selectedIds.length;
    const msg =
      n === 1
        ? 'Delete this table? This cannot be undone.'
        : `Delete ${n} tables? This cannot be undone.`;
    if (!confirm(msg)) return;

    const ids = [...selectedIds];
    const results = await Promise.all(
      ids.map((id) =>
        fetch(`/api/venue/tables?id=${id}`, { method: 'DELETE' })
          .then((r) => ({ id, ok: r.ok }))
          .catch(() => ({ id, ok: false })),
      ),
    );
    const okIds = new Set(results.filter((r) => r.ok).map((r) => r.id));
    setTables((prev) => prev.filter((t) => !okIds.has(t.id)));
    setSelectedIds((prev) => prev.filter((x) => !okIds.has(x)));
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      alert(`Failed to delete ${failed.length} of ${n} tables.`);
    }
  }, [selectedIds]);

  // ---------------------------------------------------------------------------
  // Align & distribute (multi-select)
  // ---------------------------------------------------------------------------

  type AlignEdge = 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter';

  const alignSelected = useCallback(
    (edge: AlignEdge) => {
      if (selectedIds.length < 2) return;
      pushHistory();
      setTables((prev) => {
        const selected = prev.filter((t) => selectedIds.includes(t.id));
        if (selected.length < 2) return prev;

        // Each table's % size; half-size used for edge calculation.
        const sizeOf = (t: VenueTable) => {
          const fb = getTableDimensions(t.max_covers, t.shape);
          return { w: t.width ?? fb.width, h: t.height ?? fb.height };
        };

        let target = 0;
        if (edge === 'left') {
          target = Math.min(...selected.map((t) => (t.position_x ?? 50) - sizeOf(t).w / 2));
        } else if (edge === 'right') {
          target = Math.max(...selected.map((t) => (t.position_x ?? 50) + sizeOf(t).w / 2));
        } else if (edge === 'top') {
          target = Math.min(...selected.map((t) => (t.position_y ?? 50) - sizeOf(t).h / 2));
        } else if (edge === 'bottom') {
          target = Math.max(...selected.map((t) => (t.position_y ?? 50) + sizeOf(t).h / 2));
        } else if (edge === 'hcenter') {
          target =
            selected.reduce((s, t) => s + (t.position_x ?? 50), 0) / selected.length;
        } else if (edge === 'vcenter') {
          target =
            selected.reduce((s, t) => s + (t.position_y ?? 50), 0) / selected.length;
        }

        const updated = prev.map((t) => {
          if (!selectedIds.includes(t.id)) return t;
          const { w, h } = sizeOf(t);
          switch (edge) {
            case 'left':
              return { ...t, position_x: target + w / 2 };
            case 'right':
              return { ...t, position_x: target - w / 2 };
            case 'top':
              return { ...t, position_y: target + h / 2 };
            case 'bottom':
              return { ...t, position_y: target - h / 2 };
            case 'hcenter':
              return { ...t, position_x: target };
            case 'vcenter':
              return { ...t, position_y: target };
            default:
              return t;
          }
        });
        savePositions(updated);
        return updated;
      });
    },
    [selectedIds, savePositions, pushHistory],
  );

  /** Distribute spacing: divides the gap between the first and last edges evenly. */
  const distributeSelected = useCallback(
    (axis: 'horizontal' | 'vertical') => {
      if (selectedIds.length < 3) return;
      pushHistory();
      setTables((prev) => {
        const selected = prev.filter((t) => selectedIds.includes(t.id));
        if (selected.length < 3) return prev;
        const keyPos = axis === 'horizontal' ? 'position_x' : 'position_y';
        // Sort by current centre along axis.
        const sorted = [...selected].sort(
          (a, b) => (a[keyPos] ?? 50) - (b[keyPos] ?? 50),
        );
        const first = sorted[0]![keyPos] ?? 50;
        const last = sorted[sorted.length - 1]![keyPos] ?? 50;
        const step = (last - first) / (sorted.length - 1);
        const targetById = new Map<string, number>();
        sorted.forEach((t, i) => targetById.set(t.id, first + step * i));
        const updated = prev.map((t) => {
          const target = targetById.get(t.id);
          if (target == null) return t;
          return { ...t, [keyPos]: target } as VenueTable;
        });
        savePositions(updated);
        return updated;
      });
    },
    [selectedIds, savePositions, pushHistory],
  );

  // ---------------------------------------------------------------------------
  // Table CRUD
  // ---------------------------------------------------------------------------

  const handleCreateTable = useCallback(
    async (shape: TableShape, position_x: number, position_y: number) => {
      const base = getTableDimensions(4, shape);
      const dims = {
        width: Math.round(base.width * 1.28 * 10) / 10,
        height: Math.round(base.height * 1.28 * 10) / 10,
      };
      const existingNames = new Set(tables.map((t) => t.name));
      let n = tables.length + 1;
      let name = `Table ${n}`;
      while (existingNames.has(name)) {
        n++;
        name = `Table ${n}`;
      }
      try {
        const res = await fetch('/api/venue/tables', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            min_covers: 2,
            max_covers: 4,
            shape,
            position_x,
            position_y,
            width: dims.width,
            height: dims.height,
            sort_order: tables.length,
            ...(diningAreaId ? { area_id: diningAreaId } : {}),
          }),
        });
        if (res.ok) {
          const { table } = await res.json();
          setTables((prev) => [...prev, table]);
          setSelectedIds([table.id]);
        }
      } catch (err) {
        console.error('Failed to create table:', err);
      }
    },
    [tables, diningAreaId],
  );

  const handleDeleteTable = useCallback(async (id: string) => {
    if (!confirm('Delete this table? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/venue/tables?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setTables((prev) => prev.filter((t) => t.id !== id));
        setSelectedIds((prev) => prev.filter((x) => x !== id));
      } else {
        const data = await res.json();
        alert(data.error ?? 'Failed to delete table');
      }
    } catch (err) {
      console.error('Failed to delete table:', err);
    }
  }, []);

  const handleDuplicateTable = useCallback(
    async (
      id: string,
      opts?: { offsetX?: number; offsetY?: number; select?: boolean },
    ) => {
      const source = tables.find((t) => t.id === id);
      if (!source) return null;
      const dims = getTableDimensions(source.max_covers, source.shape);
      const existingNames = new Set(tables.map((t) => t.name));
      let copyName = `${source.name} (copy)`;
      let i = 2;
      while (existingNames.has(copyName)) {
        copyName = `${source.name} (copy ${i++})`;
      }
      const offX = opts?.offsetX ?? 5;
      const offY = opts?.offsetY ?? 5;
      const offsetX = Math.max(2, Math.min(98, (source.position_x ?? 50) + offX));
      const offsetY = Math.max(2, Math.min(98, (source.position_y ?? 50) + offY));
      try {
        const res = await fetch('/api/venue/tables', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: copyName,
            min_covers: source.min_covers,
            max_covers: source.max_covers,
            shape: source.shape,
            table_type: (source.table_type as TableType) ?? 'Regular',
            zone: source.zone,
            position_x: offsetX,
            position_y: offsetY,
            width: source.width ?? dims.width,
            height: source.height ?? dims.height,
            rotation: source.rotation ?? 0,
            polygon_points: source.polygon_points ?? null,
            seat_angles: source.seat_angles ?? null,
            sort_order: tables.length,
            ...(diningAreaId ? { area_id: diningAreaId } : {}),
          }),
        });
        if (res.ok) {
          const { table } = await res.json();
          setTables((prev) => [...prev, table]);
          if (opts?.select ?? true) setSelectedIds([table.id]);
          return table as VenueTable;
        }
      } catch (err) {
        console.error('Failed to duplicate table:', err);
      }
      return null;
    },
    [tables, diningAreaId],
  );

  /** Duplicate every currently selected table (used by Ctrl/Cmd+D and Alt-drag). */
  const duplicateSelected = useCallback(async () => {
    if (selectedIds.length === 0) return;
    const created: string[] = [];
    for (const id of selectedIds) {
      const t = await handleDuplicateTable(id, { offsetX: 3, offsetY: 3, select: false });
      if (t) created.push(t.id);
    }
    if (created.length > 0) setSelectedIds(created);
  }, [selectedIds, handleDuplicateTable]);

  // ---------------------------------------------------------------------------
  // Inline property editing
  // ---------------------------------------------------------------------------

  const handlePropSave = useCallback(async () => {
    const selectedId = selectedIds.length === 1 ? selectedIds[0]! : null;
    if (!selectedId || !propEdits) return;
    setPropSaving(true);
    setPropError(null);
    try {
      const res = await fetch('/api/venue/tables', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedId,
          name: propEdits.name,
          table_type: propEdits.table_type,
          min_covers: propEdits.min_covers,
          max_covers: propEdits.max_covers,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setPropError(data.error ?? 'Failed to save');
      } else {
        const { table } = await res.json();
        setTables((prev) => prev.map((t) => (t.id === table.id ? table : t)));
        onLayoutSaved?.();
      }
    } catch (err) {
      console.error('Property save failed:', err);
      setPropError('Failed to save');
    } finally {
      setPropSaving(false);
    }
  }, [selectedIds, propEdits, onLayoutSaved]);

  // ---------------------------------------------------------------------------
  // Combinations
  // ---------------------------------------------------------------------------

  const createCombination = useCallback(async () => {
    if (selectedIds.length < 2) return;
    setComboSaving(true);
    try {
      const selectedTables = tables.filter((t) => selectedIds.includes(t.id));
      const res = await fetch('/api/venue/tables/combinations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: selectedTables.map((t) => t.name).join(' + '),
          combined_min_covers: selectedTables.reduce((s, t) => s + t.min_covers, 0),
          combined_max_covers: selectedTables.reduce((s, t) => s + t.max_covers, 0),
          table_ids: selectedIds,
        }),
      });
      if (res.ok) {
        await fetchCombinations();
        setSelectedIds([]);
      }
    } catch (err) {
      console.error('Failed to create combination:', err);
    } finally {
      setComboSaving(false);
    }
  }, [selectedIds, tables, fetchCombinations]);

  const deleteCombination = useCallback(
    async (comboId: string) => {
      try {
        await fetch(`/api/venue/tables/combinations?id=${comboId}`, { method: 'DELETE' });
        await fetchCombinations();
      } catch (err) {
        console.error('Failed to delete combination:', err);
      }
    },
    [fetchCombinations],
  );

  // ---------------------------------------------------------------------------
  // Background upload
  // ---------------------------------------------------------------------------

  const handleBackgroundUpload = useCallback(async (file: File) => {
    setBackgroundUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const uploadRes = await fetch('/api/venue/tables/background', {
        method: 'POST',
        body: formData,
      });
      if (!uploadRes.ok) {
        const data = await uploadRes.json();
        console.error('Background upload failed:', data.error);
        return;
      }
      const { url } = await uploadRes.json();
      if (activeFloorPlanId) {
        await fetch(`/api/venue/floor-plans/${activeFloorPlanId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ background_url: url }),
        });
        setFloorPlans((prev) =>
          prev.map((p) => (p.id === activeFloorPlanId ? { ...p, background_url: url } : p)),
        );
      } else {
        await fetch('/api/venue/tables/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ floor_plan_background_url: url }),
        });
      }
      setBackgroundUrl(url);
    } catch (err) {
      console.error('Background upload error:', err);
    } finally {
      setBackgroundUploading(false);
    }
  }, [activeFloorPlanId]);

  const clearBackground = useCallback(async () => {
    if (activeFloorPlanId) {
      await fetch(`/api/venue/floor-plans/${activeFloorPlanId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ background_url: null }),
      });
      setFloorPlans((prev) =>
        prev.map((p) => (p.id === activeFloorPlanId ? { ...p, background_url: null } : p)),
      );
    } else {
      await fetch('/api/venue/tables/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ floor_plan_background_url: null }),
      });
    }
    setBackgroundUrl(null);
  }, [activeFloorPlanId]);

  // ---------------------------------------------------------------------------
  // Floor plan management
  // ---------------------------------------------------------------------------

  const switchFloorPlan = useCallback(
    async (planId: string) => {
      const plan = floorPlans.find((p) => p.id === planId);
      if (!plan) return;
      setActiveFloorPlanId(planId);
      setBackgroundUrl(plan.background_url ?? null);
      setLayoutWidth(plan.canvas_width ?? null);
      setLayoutHeight(plan.canvas_height ?? null);
      setShowFloorPlanMenu(false);
      setSelectedIds([]);

      // Load positions for the new floor plan
      try {
        const [tablesRes, posRes] = await Promise.all([
          fetch(`/api/venue/tables${areaQs}`),
          fetch(`/api/venue/floor-plans/${planId}/positions`),
        ]);
        if (tablesRes.ok && posRes.ok) {
          const [tablesData, posData] = await Promise.all([tablesRes.json(), posRes.json()]);
          const posMap = new Map<string, PositionRow>(
            (posData.positions as PositionRow[]).map((p) => [p.table_id, p]),
          );
          let active = ((tablesData.tables ?? []) as VenueTable[]).filter((t) => t.is_active);
          active = active.map((t) => {
            const pos = posMap.get(t.id);
            if (!pos) return t;
            return {
              ...t,
              position_x: pos.position_x,
              position_y: pos.position_y,
              width: pos.width,
              height: pos.height,
              rotation: pos.rotation,
              seat_angles: pos.seat_angles ?? t.seat_angles ?? null,
              polygon_points: pos.polygon_points ?? t.polygon_points ?? null,
            };
          });
          setTables(active);
        }
      } catch (err) {
        console.error('Failed to switch floor plan:', err);
      }
    },
    [floorPlans, areaQs],
  );

  const createFloorPlan = useCallback(
    async (name: string, copyFrom?: string) => {
      if (!name.trim()) return;
      setFloorPlanSaving(true);
      try {
        const res = await fetch('/api/venue/floor-plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            copy_from_id: copyFrom,
            ...(diningAreaId ? { area_id: diningAreaId } : {}),
          }),
        });
        if (res.ok) {
          const { floor_plan } = await res.json();
          setFloorPlans((prev) => [...prev, floor_plan]);
          setNewPlanName('');
          setFloorPlanMenuAction(null);
          await switchFloorPlan(floor_plan.id);
        } else {
          const data = await res.json();
          alert(data.error ?? 'Failed to create floor plan');
        }
      } catch (err) {
        console.error('Failed to create floor plan:', err);
      } finally {
        setFloorPlanSaving(false);
      }
    },
    [switchFloorPlan, diningAreaId],
  );

  const renameFloorPlan = useCallback(
    async (name: string) => {
      if (!name.trim() || !activeFloorPlanId) return;
      setFloorPlanSaving(true);
      try {
        const res = await fetch(`/api/venue/floor-plans/${activeFloorPlanId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        });
        if (res.ok) {
          const { floor_plan } = await res.json();
          setFloorPlans((prev) => prev.map((p) => (p.id === floor_plan.id ? floor_plan : p)));
          setNewPlanName('');
          setFloorPlanMenuAction(null);
        }
      } catch (err) {
        console.error('Failed to rename floor plan:', err);
      } finally {
        setFloorPlanSaving(false);
      }
    },
    [activeFloorPlanId],
  );

  const deleteFloorPlan = useCallback(
    async (planId: string) => {
      if (!confirm('Delete this floor plan? The layout data for this floor plan will be removed. Tables and bookings are not affected.')) return;
      try {
        const res = await fetch(`/api/venue/floor-plans/${planId}`, { method: 'DELETE' });
        if (res.ok) {
          const remaining = floorPlans.filter((p) => p.id !== planId);
          setFloorPlans(remaining);
          if (activeFloorPlanId === planId && remaining.length > 0) {
            await switchFloorPlan(remaining[0]!.id);
          }
        } else {
          const data = await res.json();
          alert(data.error ?? 'Failed to delete floor plan');
        }
      } catch (err) {
        console.error('Failed to delete floor plan:', err);
      }
    },
    [floorPlans, activeFloorPlanId, switchFloorPlan],
  );

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Ignore when typing in form controls.
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const mod = e.ctrlKey || e.metaKey;

      // Undo / redo
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        performUndo();
        return;
      }
      if (
        (mod && e.shiftKey && e.key.toLowerCase() === 'z') ||
        (mod && e.key.toLowerCase() === 'y')
      ) {
        e.preventDefault();
        performRedo();
        return;
      }

      // Duplicate selected (Ctrl/Cmd+D)
      if (mod && e.key.toLowerCase() === 'd' && selectedIds.length > 0) {
        e.preventDefault();
        duplicateSelected();
        return;
      }

      // Select all (Ctrl/Cmd+A)
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedIds(tables.map((t) => t.id));
        return;
      }

      // Delete selected
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.length > 0) {
          e.preventDefault();
          deleteSelected();
        }
        return;
      }

      // Arrow-key nudge
      if (
        selectedIds.length > 0 &&
        (e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight')
      ) {
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_BIG_STEP_PCT : NUDGE_STEP_PCT;
        const dx =
          e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy =
          e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        nudgeSelected(dx, dy);
        return;
      }

      // Escape to deselect (but not while polygon drawing — KonvaCanvas handles that)
      if (e.key === 'Escape' && !polygonDrawPending && selectedIds.length > 0) {
        setSelectedIds([]);
        return;
      }

      // Show shortcuts
      if (e.key === '?' && e.shiftKey) {
        e.preventDefault();
        setShowShortcuts((v) => !v);
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedIds,
    tables,
    deleteSelected,
    duplicateSelected,
    nudgeSelected,
    performUndo,
    performRedo,
    polygonDrawPending,
  ]);

  // ---------------------------------------------------------------------------
  // Canvas drag-and-drop (from elements panel)
  // ---------------------------------------------------------------------------

  /** Populated by KonvaCanvas so drop coordinates stay accurate under pan/zoom. */
  const stageViewRef = useRef<{ scale: number; x: number; y: number }>({ scale: 1, x: 0, y: 0 });

  const handleCanvasDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const shape = e.dataTransfer.getData('shape') as TableShape;
      if (!shape) return;
      if (shape === 'polygon') {
        // Polygon tables are created via an interactive drawing mode
        setPolygonEditTableId(null);
        setPolygonDrawPending(true);
        return;
      }
      const wrapper = canvasWrapperRef.current;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const viewX = e.clientX - rect.left;
      const viewY = e.clientY - rect.top;
      // Convert viewport point → layout point (accounts for pan & zoom).
      const view = stageViewRef.current;
      const layoutX = (viewX - view.x) / view.scale;
      const layoutY = (viewY - view.y) / view.scale;
      const pctX = Math.max(5, Math.min(95, (layoutX / canvasDims.width) * 100));
      const pctY = Math.max(5, Math.min(95, (layoutY / canvasDims.height) * 100));
      handleCreateTable(shape, pctX, pctY);
    },
    [handleCreateTable, canvasDims.width, canvasDims.height],
  );

  const handlePolygonCreate = useCallback(
    async (canvasPts: { x: number; y: number }[], canvasW: number, canvasH: number) => {
      setPolygonDrawPending(false);
      if (canvasPts.length < 3) return;

      // Compute bounding box of the polygon in canvas pixels
      const xs = canvasPts.map((p) => p.x);
      const ys = canvasPts.map((p) => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const bboxW = Math.max(1, maxX - minX);
      const bboxH = Math.max(1, maxY - minY);
      const centreX = (minX + maxX) / 2;
      const centreY = (minY + maxY) / 2;

      const pctX = (centreX / canvasW) * 100;
      const pctY = (centreY / canvasH) * 100;
      const widthPct = (bboxW / canvasW) * 100;
      const heightPct = (bboxH / canvasH) * 100;

      // Normalise points to 0–100% of the bounding box
      const normalised = canvasPts.map((p) => ({
        x: ((p.x - minX) / bboxW) * 100,
        y: ((p.y - minY) / bboxH) * 100,
      }));

      try {
        if (polygonEditTableId) {
          const updates = {
            id: polygonEditTableId,
            width: Math.max(4, Math.round(widthPct * 10) / 10),
            height: Math.max(4, Math.round(heightPct * 10) / 10),
            position_x: Math.max(2, Math.min(98, pctX)),
            position_y: Math.max(2, Math.min(98, pctY)),
            polygon_points: normalised,
          };
          const res = await fetch('/api/venue/tables', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
          });
          if (res.ok) {
            const { table } = await res.json();
            setTables((prev) => prev.map((t) => (t.id === table.id ? table : t)));
            setSelectedIds([table.id]);
            setPolygonEditTableId(null);
          }
          return;
        }

        const names = tables.map((t) => t.name);
        let n = tables.length + 1;
        while (names.includes(`Table ${n}`)) n++;
        const res = await fetch('/api/venue/tables', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `Table ${n}`,
            shape: 'polygon',
            min_covers: 2,
            max_covers: 4,
            width: Math.max(4, Math.round(widthPct * 10) / 10),
            height: Math.max(4, Math.round(heightPct * 10) / 10),
            position_x: Math.max(2, Math.min(98, pctX)),
            position_y: Math.max(2, Math.min(98, pctY)),
            polygon_points: normalised,
            ...(diningAreaId ? { area_id: diningAreaId } : {}),
          }),
        });
        if (!res.ok) return;
        const { table } = await res.json();
        setTables((prev) => [...prev, table]);
        setSelectedIds([table.id]);
      } catch {
        // error handled silently
      }
    },
    [tables, polygonEditTableId, diningAreaId],
  );

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const selectedId = selectedIds.length === 1 ? selectedIds[0]! : null;
  const selected = selectedId ? tables.find((t) => t.id === selectedId) : null;

  const zones: string[] = [];
  const tablesByZone = new Map<string, VenueTable[]>();
  const tablesNoZone: VenueTable[] = [];
  for (const t of tables) {
    if (t.zone) {
      if (!tablesByZone.has(t.zone)) {
        zones.push(t.zone);
        tablesByZone.set(t.zone, []);
      }
      tablesByZone.get(t.zone)!.push(t);
    } else {
      tablesNoZone.push(t);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="px-2 py-4 sm:px-4" role="status" aria-label="Loading floor plan">
        <DashboardGridSkeleton />
      </div>
    );
  }

  return (
    <div className={`flex min-h-0 flex-col ${className ?? ''}`} style={{ minHeight: '600px' }}>
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
        {!embedded && (
          <Link
            href="/dashboard/availability?tab=table&fp=layout"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            ← Back
          </Link>
        )}

        {/* Floor plan selector */}
        <div className="relative" data-floor-plan-menu>
          <button
            onClick={() => { setShowFloorPlanMenu((v) => !v); setFloorPlanMenuAction(null); setNewPlanName(''); }}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            {floorPlans.find((p) => p.id === activeFloorPlanId)?.name ?? 'Floor Plan'}
            <svg className="h-3.5 w-3.5 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          {showFloorPlanMenu && (
            <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-xl border border-slate-200 bg-white shadow-lg">
              <div className="p-2">
                {floorPlans.map((plan) => (
                  <div key={plan.id} className="flex items-center gap-1">
                    <button
                      onClick={() => switchFloorPlan(plan.id)}
                      className={`flex-1 rounded-lg px-3 py-2 text-left text-sm font-medium ${
                        plan.id === activeFloorPlanId
                          ? 'bg-brand-50 text-brand-700'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {plan.name}
                    </button>
                    {plan.id === activeFloorPlanId && (
                      <button
                        onClick={() => { setFloorPlanMenuAction('rename'); setNewPlanName(plan.name); }}
                        className="rounded p-1.5 text-slate-400 hover:text-slate-600"
                        title="Rename"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                        </svg>
                      </button>
                    )}
                    {floorPlans.length > 1 && plan.id === activeFloorPlanId && (
                      <button
                        onClick={() => deleteFloorPlan(plan.id)}
                        className="rounded p-1.5 text-slate-300 hover:text-red-500"
                        title="Delete this floor plan"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-100 p-2">
                {floorPlanMenuAction === 'add' || floorPlanMenuAction === 'rename' ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={newPlanName}
                      onChange={(e) => setNewPlanName(e.target.value)}
                      placeholder={floorPlanMenuAction === 'add' ? 'New floor plan name…' : 'Rename floor plan…'}
                      autoFocus
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (floorPlanMenuAction === 'add') createFloorPlan(newPlanName);
                          else renameFloorPlan(newPlanName);
                        }
                        if (e.key === 'Escape') { setFloorPlanMenuAction(null); setNewPlanName(''); }
                      }}
                    />
                    <div className="flex gap-1">
                      <button
                        onClick={() => floorPlanMenuAction === 'add' ? createFloorPlan(newPlanName) : renameFloorPlan(newPlanName)}
                        disabled={!newPlanName.trim() || floorPlanSaving}
                        className="flex-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                      >
                        {floorPlanSaving ? '…' : floorPlanMenuAction === 'add' ? 'Add' : 'Rename'}
                      </button>
                      {floorPlanMenuAction === 'add' && activeFloorPlanId && (
                        <button
                          onClick={() => createFloorPlan(newPlanName, activeFloorPlanId)}
                          disabled={!newPlanName.trim() || floorPlanSaving}
                          className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                          title="Copy current layout to new floor plan"
                        >
                          Copy Layout
                        </button>
                      )}
                      <button
                        onClick={() => { setFloorPlanMenuAction(null); setNewPlanName(''); }}
                        className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { setFloorPlanMenuAction('add'); setNewPlanName(''); }}
                    disabled={floorPlans.length >= 24}
                    className="flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    Add Floor Plan {floorPlans.length >= 24 ? '(max 24)' : `(${floorPlans.length}/24)`}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mx-1 h-4 w-px bg-slate-200" />

        {/* Undo / redo */}
        <button
          type="button"
          onClick={performUndo}
          disabled={!canUndo}
          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >
          ↶
        </button>
        <button
          type="button"
          onClick={performRedo}
          disabled={!canRedo}
          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
        >
          ↷
        </button>

        <div className="mx-1 h-4 w-px bg-slate-200" />

        <SaveStatusPill status={saveStatus} onRetry={retrySaveNow} />

        <div className="flex-1" />

        {/* Layout size controls (commit on blur / Enter, not every keystroke) */}
        <div className="hidden lg:flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1">
          <span className="text-[10px] font-medium text-slate-500">Layout</span>
          <LayoutSizeInput
            value={Math.round(layoutWidth ?? canvasDims.width)}
            min={1600}
            max={12000}
            onCommit={(v) => {
              handleLayoutResize(v, Math.round(layoutHeight ?? canvasDims.height));
              handleLayoutResizeEnd();
            }}
            title="Canvas width in pixels — press Enter to apply"
          />
          <span className="text-[10px] text-slate-400">×</span>
          <LayoutSizeInput
            value={Math.round(layoutHeight ?? canvasDims.height)}
            min={1200}
            max={9000}
            onCommit={(v) => {
              handleLayoutResize(Math.round(layoutWidth ?? canvasDims.width), v);
              handleLayoutResizeEnd();
            }}
            title="Canvas height in pixels — press Enter to apply"
          />
        </div>

        {/* Placement aid toggles */}
        <ToggleSwitch
          label="Snap to guides"
          checked={alignmentGuidesEnabled}
          onChange={() => setAlignmentGuidesEnabled((v) => !v)}
          title="Alignment guides always appear while dragging; toggle this to snap to them"
        />
        <ToggleSwitch
          label="Grid"
          checked={showGrid}
          onChange={() => setShowGrid((v) => !v)}
        />
        <ToggleSwitch
          label="Snap"
          checked={gridSnapEnabled}
          onChange={() => setGridSnapEnabled((v) => !v)}
        />
        <div className="mx-1 h-4 w-px bg-slate-200" />

        <button
          onClick={autoArrange}
          className="rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          title="Auto-arrange tables in a grid"
        >
          Auto-Arrange
        </button>
        <button
          onClick={snapToGrid}
          className="rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          title="Snap all tables to the 2% grid"
        >
          Snap Grid
        </button>
        <button
          onClick={rotatePlanCW}
          className="rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          title="Rotate entire layout 90° clockwise"
        >
          ↻ CW
        </button>
        <button
          onClick={rotatePlanCCW}
          className="rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          title="Rotate entire layout 90° counter-clockwise"
        >
          ↺ CCW
        </button>

        <div className="mx-1 h-4 w-px bg-slate-200" />

        {/* Background upload */}
        <input
          ref={backgroundFileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleBackgroundUpload(f);
            e.target.value = '';
          }}
        />
        <button
          onClick={() => backgroundFileRef.current?.click()}
          disabled={backgroundUploading}
          className="rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          title="Upload floor plan background image (JPEG, PNG, or WebP)"
        >
          {backgroundUploading ? 'Uploading…' : backgroundUrl ? '⬡ Background' : '+ Background'}
        </button>
        {backgroundUrl && (
          <button
            onClick={clearBackground}
            className="rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-50"
            title="Remove background image"
          >
            × Background
          </button>
        )}

        <div className="mx-1 h-4 w-px bg-slate-200" />
        <button
          type="button"
          onClick={() => setShowShortcuts(true)}
          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50"
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
        >
          ?
        </button>
      </div>

      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}

      {/* ── Three-column body ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* Left: Elements Panel */}
        <div className="w-36 shrink-0 border-r border-slate-200 bg-slate-50 overflow-y-auto p-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Elements</p>
          <p className="mb-3 text-[9px] text-slate-400 leading-relaxed">
            Drag a shape onto the canvas. Click <span className="font-medium text-slate-500">Custom</span> to draw
            vertices on the canvas.
          </p>
          <div className="space-y-1.5">
            {SHAPE_OPTIONS.map(({ shape, label }) => {
              const isPolygon = shape === 'polygon';
              const startPolygonDraw = () => {
                setPolygonEditTableId(null);
                setPolygonDrawPending(true);
              };
              return (
                <div
                  key={shape}
                  draggable={!isPolygon}
                  onDragStart={
                    isPolygon ? undefined : (e) => e.dataTransfer.setData('shape', shape)
                  }
                  onClick={isPolygon ? startPolygonDraw : undefined}
                  role={isPolygon ? 'button' : undefined}
                  tabIndex={isPolygon ? 0 : undefined}
                  onKeyDown={
                    isPolygon
                      ? (e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          e.preventDefault();
                          startPolygonDraw();
                        }
                      : undefined
                  }
                  className={`flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 shadow-sm hover:border-brand-300 hover:bg-brand-50 select-none ${
                    isPolygon
                      ? 'cursor-pointer active:opacity-90'
                      : 'cursor-grab active:cursor-grabbing'
                  }`}
                >
                  <ShapeIcon shape={shape} size={26} />
                  <span className="min-w-0 flex-1 font-medium leading-snug">{label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Centre: Canvas */}
        <div
          ref={canvasWrapperRef}
          className="min-h-0 flex-1 overflow-auto"
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
          onDrop={handleCanvasDrop}
        >
          <KonvaCanvas
            tables={tables}
            backgroundUrl={backgroundUrl}
            selectedId={selectedId}
            selectedIds={selectedIds}
            onSelect={handleSelect}
            onMultiSelect={handleMultiSelect}
            onMove={handleTableMove}
            onResize={handleTableResize}
            onRotate={handleTableRotate}
            combinationLinks={combinations}
            showCombinationLinkLines={!embedded}
            alignmentGuidesEnabled={alignmentGuidesEnabled}
            showGrid={showGrid}
            gridStepPct={GRID_STEP_PCT}
            layoutWidth={layoutWidth}
            layoutHeight={layoutHeight}
            onLayoutResize={handleLayoutResize}
            onLayoutResizeEnd={handleLayoutResizeEnd}
            onSeatDrag={handleSeatDrag}
            onSeatDragEnd={handleSeatDragEnd}
            onPolygonVertexDrag={handlePolygonVertexDrag}
            onPolygonVertexDragEnd={handlePolygonVertexDragEnd}
            polygonDrawPending={polygonDrawPending}
            onPolygonCreate={handlePolygonCreate}
            onPolygonDrawCancel={() => {
              setPolygonDrawPending(false);
              setPolygonEditTableId(null);
            }}
            onDimensionsChange={setCanvasDims}
            onStageView={(v) => { stageViewRef.current = v; }}
            onAltDragDuplicate={(id) =>
              handleDuplicateTable(id, { offsetX: 0, offsetY: 0, select: true })
            }
          />
        </div>

        {/* Right: Context Panel */}
        <div className="w-64 shrink-0 border-l border-slate-200 bg-white overflow-y-auto">
          {selectedIds.length >= 2 ? (
            /* Multi-selection */
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">
                  {selectedIds.length} Tables
                </h3>
                <button
                  onClick={() => setSelectedIds([])}
                  className="rounded p-0.5 text-slate-400 hover:text-slate-600"
                  title="Deselect"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-xs text-slate-500 line-clamp-2">
                {tables.filter((t) => selectedIds.includes(t.id)).map((t) => t.name).join(', ')}
              </p>

              {/* Align */}
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Align
                </p>
                <div className="grid grid-cols-6 gap-1">
                  <AlignButton title="Align left edges" onClick={() => alignSelected('left')}>
                    <AlignIcon dir="left" />
                  </AlignButton>
                  <AlignButton title="Align horizontal centres" onClick={() => alignSelected('hcenter')}>
                    <AlignIcon dir="hcenter" />
                  </AlignButton>
                  <AlignButton title="Align right edges" onClick={() => alignSelected('right')}>
                    <AlignIcon dir="right" />
                  </AlignButton>
                  <AlignButton title="Align top edges" onClick={() => alignSelected('top')}>
                    <AlignIcon dir="top" />
                  </AlignButton>
                  <AlignButton title="Align vertical centres" onClick={() => alignSelected('vcenter')}>
                    <AlignIcon dir="vcenter" />
                  </AlignButton>
                  <AlignButton title="Align bottom edges" onClick={() => alignSelected('bottom')}>
                    <AlignIcon dir="bottom" />
                  </AlignButton>
                </div>
              </div>

              {/* Distribute (needs 3+) */}
              {selectedIds.length >= 3 && (
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Distribute
                  </p>
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      onClick={() => distributeSelected('horizontal')}
                      className="rounded border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                      title="Distribute horizontal spacing"
                    >
                      ↔ Horizontal
                    </button>
                    <button
                      onClick={() => distributeSelected('vertical')}
                      className="rounded border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                      title="Distribute vertical spacing"
                    >
                      ↕ Vertical
                    </button>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={duplicateSelected}
                  className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  title="Duplicate selection (Ctrl+D)"
                >
                  Duplicate
                </button>
                <button
                  onClick={deleteSelected}
                  className="flex-1 rounded-lg border border-red-200 px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                  title="Delete selection (Del)"
                >
                  Delete
                </button>
              </div>

              {/* Combine */}
              <div className="rounded-xl border border-purple-200 bg-purple-50 p-3">
                <p className="mb-2 text-[11px] font-medium text-purple-700">
                  Link these tables so they can be booked together:
                </p>
                <button
                  onClick={createCombination}
                  disabled={comboSaving}
                  className="w-full rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
                >
                  {comboSaving ? 'Linking…' : 'Link as Combination'}
                </button>
                <p className="mt-2 text-[10px] text-purple-500">
                  Combined covers:{' '}
                  {tables.filter((t) => selectedIds.includes(t.id)).reduce((s, t) => s + t.max_covers, 0)}
                </p>
              </div>
              {combinations.length > 0 && (
                <CombinationsList combinations={combinations} onDelete={deleteCombination} />
              )}
            </div>
          ) : selected ? (
            /* Single table selected — properties */
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">Properties</h3>
                <button
                  onClick={() => setSelectedIds([])}
                  className="rounded p-0.5 text-slate-400 hover:text-slate-600"
                  title="Deselect"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {propEdits && (
                <div className="space-y-3">
                  {propError && (
                    <p className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-600">
                      {propError}
                    </p>
                  )}
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Name
                    </label>
                    <input
                      type="text"
                      value={propEdits.name}
                      onChange={(e) => setPropEdits({ ...propEdits, name: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Table Type
                    </label>
                    <select
                      value={propEdits.table_type}
                      onChange={(e) => setPropEdits({ ...propEdits, table_type: e.target.value as TableType })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
                    >
                      {TABLE_TYPES.map((tt) => (
                        <option key={tt} value={tt}>{tt}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Min
                      </label>
                      <NumericInput
                        min={1}
                        max={50}
                        value={propEdits.min_covers}
                        onChange={(v) => setPropEdits({ ...propEdits, min_covers: v })}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Max
                      </label>
                      <NumericInput
                        min={1}
                        max={50}
                        value={propEdits.max_covers}
                        onChange={(v) => setPropEdits({ ...propEdits, max_covers: v })}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
                      />
                    </div>
                  </div>
                  <button
                    onClick={handlePropSave}
                    disabled={propSaving || !propEdits.name.trim()}
                    className="w-full rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    {propSaving ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              )}

              {/* Display-only geometry info */}
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 space-y-1 text-[10px]">
                <p className="text-slate-500">Shape: <span className="capitalize text-slate-700">{selected.shape}</span></p>
                {selected.zone && (
                  <p className="text-slate-500">Zone: <span className="text-slate-700">{selected.zone}</span></p>
                )}
              </div>

              {/* Rotation */}
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  Rotation
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={360}
                    step={15}
                    value={selected.rotation ?? 0}
                    onChange={(e) => handleTableRotate(selected.id, parseInt(e.target.value))}
                    className="flex-1"
                    title="Drag to rotate · hold Shift on the stage rotation handle for 1° steps"
                  />
                  <NumericInput
                    min={0}
                    max={359}
                    value={Math.round(selected.rotation ?? 0)}
                    onChange={(v) => handleTableRotate(selected.id, ((v % 360) + 360) % 360)}
                    className="w-12 rounded border border-slate-300 px-1 py-0.5 text-xs text-right text-slate-600 focus:border-brand-400 focus:outline-none"
                    title="Precise rotation in degrees"
                  />
                  <span className="text-xs text-slate-500">°</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
                    <button
                      key={deg}
                      onClick={() => handleTableRotate(selected.id, deg)}
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                        (selected.rotation ?? 0) === deg
                          ? 'border-brand-300 bg-brand-50 text-brand-700'
                          : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {deg}°
                    </button>
                  ))}
                </div>
              </div>

              {selected.max_covers > 0 && (
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                    Chairs
                  </label>
                  <ToggleSwitch
                    label="Even spacing around table"
                    checked={!tableHasCustomSeatAngles(selected)}
                    onChange={() => {
                      if (tableHasCustomSeatAngles(selected)) {
                        resetSeatAnglesToEven(selected.id);
                      }
                    }}
                  />
                  <p className="mt-1.5 text-[10px] text-slate-400 leading-relaxed">
                    Drag a chair on the canvas to fine-tune. Turn this on to reset to the automatic layout.
                  </p>
                </div>
              )}

              {/* Size */}
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  Size
                </label>
                <div className="space-y-1.5">
                  {selected.shape === 'circle' || selected.shape === 'square' ? (
                    /* Single size slider — W always equals H */
                    (() => {
                      const fallback = getTableDimensions(selected.max_covers, selected.shape);
                      const val = selected.width ?? fallback.width;
                      const isCircle = selected.shape === 'circle';
                      return (
                        <div className="flex items-center gap-2">
                          <span className="w-5 text-[10px] text-slate-500 uppercase">
                            {isCircle ? '⌀' : '□'}
                          </span>
                          <input
                            type="range"
                            min={4}
                            max={24}
                            step={0.5}
                            value={val}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              handleTableResize(selected.id, v, v);
                            }}
                            className="flex-1"
                            title={isCircle ? 'Diameter' : 'Side length'}
                          />
                          <span className="w-8 text-right text-[10px] text-slate-600">{val.toFixed(1)}</span>
                        </div>
                      );
                    })()
                  ) : (
                    /* Oval, rectangle, polygon fallback: separate W / H sliders */
                    (['width', 'height'] as const).map((dim) => {
                      const fallback = getTableDimensions(selected.max_covers, selected.shape);
                      const val = selected[dim] ?? fallback[dim];
                      return (
                        <div key={dim} className="flex items-center gap-2">
                          <span className="w-3 text-[10px] text-slate-500 uppercase">{dim === 'width' ? 'W' : 'H'}</span>
                          <input
                            type="range"
                            min={4}
                            max={24}
                            step={0.5}
                            value={val}
                            onChange={(e) => {
                              const fb = getTableDimensions(selected.max_covers, selected.shape);
                              handleTableResize(
                                selected.id,
                                dim === 'width' ? Number(e.target.value) : (selected.width ?? fb.width),
                                dim === 'height' ? Number(e.target.value) : (selected.height ?? fb.height),
                              );
                            }}
                            className="flex-1"
                          />
                          <span className="w-8 text-right text-[10px] text-slate-600">{val.toFixed(1)}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Polygon shape info */}
              {selected.shape === 'polygon' && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 space-y-1.5">
                  <p className="font-semibold text-slate-700">
                    Custom shape · {selected.polygon_points?.length ?? 0} vertices
                  </p>
                  <p className="text-[10px] text-slate-500">
                    With the table selected on the layout, drag any blue vertex on the outline to reshape it. Drag
                    the table to move it. Use reset to redraw the polygon while keeping the same table.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setPolygonEditTableId(selected.id);
                      setPolygonDrawPending(true);
                    }}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Reset shape
                  </button>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => handleDuplicateTable(selected.id)}
                  className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Duplicate
                </button>
                <button
                  onClick={() => handleDeleteTable(selected.id)}
                  className="flex-1 rounded-lg border border-red-200 px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>

              {combinations.length > 0 && (
                <CombinationsList combinations={combinations} onDelete={deleteCombination} />
              )}
            </div>
          ) : (
            /* No selection — tables list + dining areas */
            <div className="divide-y divide-slate-100">
              {/* Tables header */}
              <div className="flex items-center gap-2 px-4 py-3">
                <span className="text-sm font-semibold text-slate-900">Tables</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  {tables.length}
                </span>
              </div>

              {/* Table list */}
              <div className="px-3 py-3">
                {tables.length === 0 ? (
                  <p className="text-xs text-slate-400">No tables yet. Drag a shape from the Elements panel onto the canvas.</p>
                ) : (
                  <div className="space-y-3">
                    {zones.map((zone) => (
                      <div key={zone}>
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{zone}</p>
                        <div className="space-y-0.5">
                          {(tablesByZone.get(zone) ?? []).map((t) => (
                            <TableListRow key={t.id} table={t} onClick={() => setSelectedIds([t.id])} />
                          ))}
                        </div>
                      </div>
                    ))}
                    {tablesNoZone.length > 0 && (
                      <div>
                        {zones.length > 0 && (
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Other</p>
                        )}
                        <div className="space-y-0.5">
                          {tablesNoZone.map((t) => (
                            <TableListRow key={t.id} table={t} onClick={() => setSelectedIds([t.id])} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Dining Areas */}
              {zones.length > 0 && (
                <div className="px-3 py-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Dining Areas</p>
                  <div className="space-y-1">
                    {zones.map((zone) => (
                      <div key={zone} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                        <span className="text-xs font-medium text-slate-700">{zone}</span>
                        <span className="text-[10px] text-slate-400">
                          {(tablesByZone.get(zone) ?? []).length} tables
                        </span>
                      </div>
                    ))}
                    {tablesNoZone.length > 0 && (
                      <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                        <span className="text-xs font-medium text-slate-400">No Zone</span>
                        <span className="text-[10px] text-slate-400">{tablesNoZone.length} tables</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Combinations */}
              {combinations.length > 0 && (
                <div className="px-3 py-3">
                  <CombinationsList combinations={combinations} onDelete={deleteCombination} />
                </div>
              )}

              {/* Tips */}
              <div className="px-3 py-3">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Tips</p>
                <ul className="space-y-0.5 text-[10px] text-slate-400 leading-relaxed">
                  <li>• Drag shapes from Elements to add tables</li>
                  <li>• Shift+click or shift-drag a box to multi-select</li>
                  <li>• Arrow keys nudge · Shift+Arrow for 10×</li>
                  <li>• Ctrl+Z undo · Ctrl+Shift+Z redo · Ctrl+D duplicate</li>
                  <li>• Scroll to zoom · Space or middle-click to pan</li>
                  {!embedded && <li>• Purple lines show linked combinations</li>}
                  <li>• Press ? to see all shortcuts</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Small sub-components

/** Numeric layout-size input that only commits on Enter / blur — avoids resize
 * thrash while typing multi-digit values like 2400. */
function LayoutSizeInput({
  value,
  min,
  max,
  onCommit,
  title,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (v: number) => void;
  title?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(String(value));
  }, [value]);
  const commit = () => {
    const n = Number(text);
    if (!Number.isFinite(n)) {
      setText(String(value));
      return;
    }
    const clamped = Math.max(min, Math.min(max, Math.round(n)));
    setText(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      value={text}
      min={min}
      max={max}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === 'Escape') {
          setText(String(value));
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="w-20 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600 focus:border-brand-400 focus:outline-none"
      title={title}
    />
  );
}

function SaveStatusPill({
  status,
  onRetry,
}: {
  status: 'idle' | 'saving' | 'saved' | 'error';
  onRetry: () => void;
}) {
  if (status === 'error') {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="rounded border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100"
        title="Changes failed to save — click to retry"
      >
        Retry save
      </button>
    );
  }
  return (
    <span
      className={`text-xs font-medium ${
        status === 'saving'
          ? 'text-amber-600'
          : status === 'saved'
            ? 'text-green-600'
            : 'text-slate-400'
      }`}
    >
      {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}
    </span>
  );
}

function AlignButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex h-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
    >
      {children}
    </button>
  );
}

function AlignIcon({ dir }: { dir: 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter' }) {
  // Simple inline SVGs for align icons — edges are the heavy line; shapes hint at grouping.
  const stroke = 'currentColor';
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={1.4} strokeLinecap="round">
      {dir === 'left' && (<>
        <line x1="2" y1="2" x2="2" y2="14" strokeWidth={2} />
        <rect x="2" y="4" width="8" height="3" rx="0.5" />
        <rect x="2" y="9" width="11" height="3" rx="0.5" />
      </>)}
      {dir === 'right' && (<>
        <line x1="14" y1="2" x2="14" y2="14" strokeWidth={2} />
        <rect x="6" y="4" width="8" height="3" rx="0.5" />
        <rect x="3" y="9" width="11" height="3" rx="0.5" />
      </>)}
      {dir === 'hcenter' && (<>
        <line x1="8" y1="2" x2="8" y2="14" strokeWidth={2} strokeDasharray="2 2" />
        <rect x="4" y="4" width="8" height="3" rx="0.5" />
        <rect x="2.5" y="9" width="11" height="3" rx="0.5" />
      </>)}
      {dir === 'top' && (<>
        <line x1="2" y1="2" x2="14" y2="2" strokeWidth={2} />
        <rect x="4" y="2" width="3" height="8" rx="0.5" />
        <rect x="9" y="2" width="3" height="11" rx="0.5" />
      </>)}
      {dir === 'bottom' && (<>
        <line x1="2" y1="14" x2="14" y2="14" strokeWidth={2} />
        <rect x="4" y="6" width="3" height="8" rx="0.5" />
        <rect x="9" y="3" width="3" height="11" rx="0.5" />
      </>)}
      {dir === 'vcenter' && (<>
        <line x1="2" y1="8" x2="14" y2="8" strokeWidth={2} strokeDasharray="2 2" />
        <rect x="4" y="4" width="3" height="8" rx="0.5" />
        <rect x="9" y="2.5" width="3" height="11" rx="0.5" />
      </>)}
    </svg>
  );
}

function ShortcutsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows: [string, string][] = [
    ['Undo / Redo', 'Ctrl+Z  ·  Ctrl+Shift+Z (or Ctrl+Y)'],
    ['Duplicate selection', 'Ctrl+D  ·  Alt-drag a table'],
    ['Select all tables', 'Ctrl+A'],
    ['Delete selection', 'Del or Backspace'],
    ['Nudge selection', 'Arrow keys  ·  Shift+Arrow = 10×'],
    ['Multi-select', 'Shift-click  ·  Shift-drag a box'],
    ['Pan the canvas', 'Space-drag  ·  Middle-mouse drag  ·  Drag empty area'],
    ['Zoom', 'Scroll wheel  ·  + / − buttons'],
    ['Rotate selected table', 'Drag the rotation handle on the stage'],
    ['Draw a custom polygon', 'Click Custom, then tap to add points, double-tap to close'],
    ['Cancel / deselect', 'Escape'],
    ['Show this help', 'Shift + ?'],
  ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[min(480px,92vw)] max-h-[80vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:text-slate-700"
            aria-label="Close"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <dl className="divide-y divide-slate-100">
          {rows.map(([label, keys]) => (
            <div key={label} className="flex items-center justify-between gap-4 px-5 py-2.5 text-xs">
              <dt className="text-slate-600">{label}</dt>
              <dd className="font-mono text-[11px] text-slate-500">{keys}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

function tableHasCustomSeatAngles(table: VenueTable): boolean {
  const sa = table.seat_angles;
  if (!sa?.length) return false;
  return sa.some((a) => a != null);
}

function ToggleSwitch({ label, checked, onChange, title }: { label: string; checked: boolean; onChange: () => void; title?: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600" title={title}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={`relative inline-flex h-4 w-8 shrink-0 rounded-full border-2 border-transparent transition-colors ${checked ? 'bg-brand-600' : 'bg-slate-300'}`}
      >
        <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
      </button>
      {label}
    </label>
  );
}

function TableListRow({ table, onClick }: { table: VenueTable; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-slate-50 group"
    >
      <span className="font-medium text-slate-700 group-hover:text-brand-700">{table.name}</span>
      <span className="text-slate-400">{table.min_covers}–{table.max_covers}</span>
    </button>
  );
}

function CombinationsList({
  combinations,
  onDelete,
}: {
  combinations: { id: string; name: string; tableIds: string[] }[];
  onDelete: (id: string) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Combinations</p>
      <div className="space-y-1">
        {combinations.map((combo) => (
          <div
            key={combo.id}
            className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
          >
            <div>
              <p className="text-xs font-medium text-slate-700">{combo.name}</p>
              <p className="text-[10px] text-slate-400">{combo.tableIds.length} tables</p>
            </div>
            <button
              onClick={() => onDelete(combo.id)}
              className="text-slate-300 hover:text-red-500"
              title="Remove combination"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShapeIcon({ shape, size }: { shape: TableShape; size: number }) {
  const s = size;
  const pad = 4;
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} className="shrink-0 text-slate-500" fill="none">
      {shape === 'circle' ? (
        <circle cx={s / 2} cy={s / 2} r={s / 2 - pad} stroke="currentColor" strokeWidth={1.5} />
      ) : shape === 'oval' ? (
        <ellipse cx={s / 2} cy={s / 2} rx={s / 2 - pad} ry={s / 2 - pad - 3} stroke="currentColor" strokeWidth={1.5} />
      ) : shape === 'square' ? (
        <rect x={pad} y={pad} width={s - pad * 2} height={s - pad * 2} rx={2} stroke="currentColor" strokeWidth={1.5} />
      ) : shape === 'l-shape' ? (
        <path
          d={`M${pad} ${pad} L${pad} ${s - pad} L${s * 0.6} ${s - pad} L${s * 0.6} ${s * 0.55} L${s - pad} ${s * 0.55} L${s - pad} ${pad} Z`}
          stroke="currentColor"
          strokeWidth={1.5}
        />
      ) : shape === 'polygon' ? (
        <path
          d={`M${s * 0.22} ${s * 0.2} L${s * 0.8} ${s * 0.26} L${s * 0.72} ${s * 0.78} L${s * 0.3} ${s * 0.86} L${s * 0.15} ${s * 0.5} Z`}
          stroke="currentColor"
          strokeWidth={1.5}
          fill="none"
        />
      ) : (
        /* rectangle — wider than tall */
        <rect x={pad} y={pad + 3} width={s - pad * 2} height={s - pad * 2 - 6} rx={2} stroke="currentColor" strokeWidth={1.5} />
      )}
    </svg>
  );
}
