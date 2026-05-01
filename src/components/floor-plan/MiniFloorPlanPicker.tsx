'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Group, Rect } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type Konva from 'konva';
import TableShape from '@/components/floor-plan/TableShape';
import { computeTableAdjacency, getTableDimensions, tableDimensionsPercentToPixels } from '@/types/table-management';
import type { BlockedSides } from '@/types/table-management';
import { computeGlobalUnifiedLabelFonts } from '@/lib/floor-plan/table-label-fonts';

const COLOR_FREE = '#047857';
const COLOR_SELECTED = '#2563eb';
const COLOR_BUSY = '#94a3b8';
/** Neutral fill for non-highlighted tables when used as a read-only combination preview. */
const COLOR_PREVIEW_IDLE = '#94a3b8';
/** Amber highlight for combination members in the read-only preview. */
const COLOR_PREVIEW_HIGHLIGHT = '#d97706';

const EMPTY_HIDDEN = new Set<string>();

function blockedToHiddenSet(blocked?: BlockedSides): Set<string> {
  if (!blocked) return EMPTY_HIDDEN;
  const s = new Set<string>();
  if (blocked.top) s.add('top');
  if (blocked.right) s.add('right');
  if (blocked.bottom) s.add('bottom');
  if (blocked.left) s.add('left');
  return s.size > 0 ? s : EMPTY_HIDDEN;
}

export interface MiniFloorTableRow {
  id: string;
  name: string;
  min_covers: number;
  max_covers: number;
  shape: string;
  position_x: number | null;
  position_y: number | null;
  width: number | null;
  height: number | null;
  rotation: number | null;
  is_active: boolean;
  /** Per-seat angle overrides from the Layout tab. */
  seat_angles?: (number | null)[] | null;
  polygon_points?: { x: number; y: number }[] | null;
  /** Dining area; used when filtering tables for multi-area venues. */
  area_id?: string | null;
}

export interface MiniFloorPlanPickerProps {
  tables?: MiniFloorTableRow[] | null;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  occupiedTableIds?: string[];
  partySize: number;
  className?: string;
  minHeight?: number;
  /**
   * Read-only preview mode. Hides the Free/Selected/Busy legend, the selection
   * summary chips, and the "Tap tables above…" helper text — useful when the
   * picker is used to preview a combination rather than to pick tables.
   * `selectedIds` still drives which tables are highlighted (shown in amber).
   */
  previewMode?: boolean;
  /** Logical floor-plan dimensions from the Layout tab. */
  layoutWidth?: number;
  layoutHeight?: number;
  /** Use the logical floor-plan aspect ratio when sizing the preview canvas. */
  preserveLayoutAspect?: boolean;
}

function computeFit(
  tables: MiniFloorTableRow[],
  layoutW: number,
  layoutH: number,
  viewportW: number,
  viewportH: number,
  fitFullLayout = false,
): { scale: number; x: number; y: number } {
  if (tables.length === 0 || layoutW < 1 || layoutH < 1 || viewportW < 1 || viewportH < 1) {
    return { scale: 1, x: 0, y: 0 };
  }

  let minX = fitFullLayout ? 0 : Infinity;
  let minY = fitFullLayout ? 0 : Infinity;
  let maxX = fitFullLayout ? layoutW : -Infinity;
  let maxY = fitFullLayout ? layoutH : -Infinity;

  for (const t of tables) {
    const fb = getTableDimensions(t.max_covers, t.shape);
    const cx = t.position_x != null ? (t.position_x / 100) * layoutW : layoutW / 2;
    const cy = t.position_y != null ? (t.position_y / 100) * layoutH : layoutH / 2;
    const { w, h } = tableDimensionsPercentToPixels(
      t.width ?? fb.width,
      t.height ?? fb.height,
      layoutW,
      layoutH,
      t.shape,
    );
    minX = Math.min(minX, cx - w / 2);
    maxX = Math.max(maxX, cx + w / 2);
    minY = Math.min(minY, cy - h / 2);
    maxY = Math.max(maxY, cy + h / 2);
  }

  const pad = 28;
  const bw = Math.max(1e-6, maxX - minX + pad * 2);
  const bh = Math.max(1e-6, maxY - minY + pad * 2);
  const rawScale = Math.min(viewportW / bw, viewportH / bh, 2.5);
  const scale = Number.isFinite(rawScale) && rawScale > 0 ? rawScale : 1;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  return {
    scale,
    x: viewportW / 2 - midX * scale,
    y: viewportH / 2 - midY * scale,
  };
}

export default function MiniFloorPlanPicker({
  tables: tablesProp,
  selectedIds,
  onChange,
  occupiedTableIds = [],
  partySize,
  className = '',
  minHeight = 220,
  previewMode = false,
  layoutWidth,
  layoutHeight,
  preserveLayoutAspect = false,
}: MiniFloorPlanPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const [dimensions, setDimensions] = useState({ width: 400, height: minHeight });
  /** Konva must never receive 0×0 — it triggers drawImage on invalid layer canvases. */
  const canvasW = Math.max(1, dimensions.width);
  const canvasH = Math.max(1, dimensions.height);
  const logicalW = Math.max(1, Math.round(layoutWidth ?? canvasW));
  const logicalH = Math.max(1, Math.round(layoutHeight ?? canvasH));
  const [fetchedTables, setFetchedTables] = useState<MiniFloorTableRow[] | null>(
    tablesProp != null ? tablesProp : null,
  );
  const [fetchLoading, setFetchLoading] = useState(tablesProp == null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });

  const occupiedSet = useMemo(() => new Set(occupiedTableIds), [occupiedTableIds]);

  const tables = useMemo(() => {
    const raw = tablesProp ?? fetchedTables ?? [];
    return raw.filter((t) => t.is_active).map((t) => {
      const fb = getTableDimensions(t.max_covers, t.shape);
      if (previewMode) {
        return {
          ...t,
          width: t.width ?? fb.width,
          height: t.height ?? fb.height,
        };
      }
      return {
        ...t,
        width: Math.max(t.width ?? fb.width, 9),
        height: Math.max(t.height ?? fb.height, 7.5),
      };
    });
  }, [tablesProp, fetchedTables, previewMode]);

  const isLoading = fetchLoading && tablesProp == null;

  useEffect(() => {
    if (tablesProp != null) {
      setFetchLoading(false);
      return;
    }
    let cancelled = false;
    setFetchLoading(true);
    void (async () => {
      try {
        const res = await fetch('/api/venue/tables');
        if (!res.ok) {
          if (!cancelled) setLoadError('Could not load tables');
          return;
        }
        const payload = await res.json();
        const next = (payload.tables ?? []) as MiniFloorTableRow[];
        if (!cancelled) {
          setFetchedTables(next);
          setLoadError(null);
        }
      } catch {
        if (!cancelled) setLoadError('Could not load tables');
      } finally {
        if (!cancelled) setFetchLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tablesProp]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.offsetWidth;
      if (w < 1) return;
      const layoutAspectHeight =
        preserveLayoutAspect && layoutWidth && layoutHeight && layoutWidth > 0 && layoutHeight > 0
          ? w * (layoutHeight / layoutWidth)
          : w * 0.55;
      const h = Math.max(minHeight, Math.round(layoutAspectHeight));
      setDimensions((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [layoutHeight, layoutWidth, minHeight, preserveLayoutAspect]);

  const fit = useMemo(
    () => computeFit(tables, logicalW, logicalH, canvasW, canvasH, previewMode && preserveLayoutAspect),
    [tables, logicalW, logicalH, canvasW, canvasH, previewMode, preserveLayoutAspect],
  );

  useEffect(() => {
    setScale(fit.scale);
    setStagePos({ x: fit.x, y: fit.y });
  }, [fit.scale, fit.x, fit.y]);

  const selectedTableNames = useMemo(() => {
    const names: string[] = [];
    for (const id of selectedIds) {
      const t = tables.find((row) => row.id === id);
      if (t) names.push(t.name);
    }
    return names;
  }, [selectedIds, tables]);

  const combinedCapacity = useMemo(() => {
    let sum = 0;
    for (const id of selectedIds) {
      const t = tables.find((row) => row.id === id);
      if (t) sum += t.max_covers;
    }
    return sum;
  }, [selectedIds, tables]);

  const unifiedLabelFonts = useMemo(() => {
    if (tables.length === 0) return null;
    const inputs = tables.map((table) => {
      const fb = getTableDimensions(table.max_covers, table.shape);
      const { w: tw, h: th } = tableDimensionsPercentToPixels(
        table.width ?? fb.width,
        table.height ?? fb.height,
        logicalW,
        logicalH,
        table.shape,
      );
      const capacityText =
        table.min_covers === table.max_covers
          ? `${table.max_covers}`
          : `${table.min_covers}-${table.max_covers}`;
      return {
        w: tw,
        h: th,
        shape: table.shape,
        topLabel: table.name,
        bottomLabel: capacityText,
        compactLabels: !previewMode,
        layoutScale: previewMode ? scale : undefined,
        polygon_points: table.polygon_points ?? null,
      };
    });
    return computeGlobalUnifiedLabelFonts(inputs);
  }, [tables, logicalW, logicalH, previewMode, scale]);

  const adjacency = useMemo(() => {
    const bounds = tables.map((table) => {
      const fb = getTableDimensions(table.max_covers, table.shape);
      const { w, h } = tableDimensionsPercentToPixels(
        table.width ?? fb.width,
        table.height ?? fb.height,
        logicalW,
        logicalH,
        table.shape,
      );
      return {
        id: table.id,
        x: table.position_x != null ? (table.position_x / 100) * logicalW : logicalW / 2,
        y: table.position_y != null ? (table.position_y / 100) * logicalH : logicalH / 2,
        w,
        h,
      };
    });
    return computeTableAdjacency(bounds);
  }, [tables, logicalW, logicalH]);

  const zoomBy = useCallback(
    (delta: number) => {
      const newScale = Math.max(0.35, Math.min(2.8, scale + delta));
      const cx = canvasW / 2;
      const cy = canvasH / 2;
      const safePrevScale = scale > 0 ? scale : 1;
      const pointTo = {
        x: (cx - stagePos.x) / safePrevScale,
        y: (cy - stagePos.y) / safePrevScale,
      };
      setScale(newScale);
      setStagePos({
        x: cx - pointTo.x * newScale,
        y: cy - pointTo.y * newScale,
      });
    },
    [scale, stagePos, canvasW, canvasH],
  );

  const toggleTable = useCallback(
    (tableId: string) => {
      if (occupiedSet.has(tableId)) return;
      const next = selectedIds.includes(tableId)
        ? selectedIds.filter((id) => id !== tableId)
        : [...selectedIds, tableId];
      onChange(next);
    },
    [occupiedSet, onChange, selectedIds],
  );

  const removeTable = useCallback(
    (tableId: string) => {
      onChange(selectedIds.filter((id) => id !== tableId));
    },
    [onChange, selectedIds],
  );

  const handleStageClick = useCallback((e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (e.target === e.target.getStage()) {
      /* keep multi-selection; tap empty does nothing */
    }
  }, []);

  if (loadError) {
    return (
      <div className={`rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs text-amber-800 ${className}`}>
        {loadError}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={className}>
        <div
          className="flex animate-pulse flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
          style={{ height: minHeight }}
        >
          <div className="flex gap-3">
            <div className="h-12 w-16 rounded-lg bg-slate-200" />
            <div className="h-12 w-12 rounded-full bg-slate-200" />
            <div className="h-12 w-16 rounded-lg bg-slate-200" />
          </div>
          <div className="flex gap-3">
            <div className="h-12 w-12 rounded-full bg-slate-200" />
            <div className="h-12 w-16 rounded-lg bg-slate-200" />
          </div>
          <p className="text-xs text-slate-400">Loading floor plan...</p>
        </div>
      </div>
    );
  }

  if (tables.length === 0) {
    return (
      <div className={`rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-xs text-slate-600 ${className}`}>
        No active tables on the floor plan. Add tables in Settings &rarr; Floor plan.
      </div>
    );
  }

  const capacityOk = selectedIds.length === 0 || combinedCapacity >= partySize;
  /** Avoid Konva layer draw with scale 0 (InvalidStateError on drawImage). */
  const stageScale = Math.max(0.001, scale);

  return (
    <div className={className}>
      {/* Header: legend + zoom controls */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
          {previewMode ? (
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: COLOR_PREVIEW_HIGHLIGHT }}
              />
              {selectedIds.length > 0 ? 'In this combination' : 'Hover a combination to preview'}
            </span>
          ) : (
            <>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_FREE }} />
                Free
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_SELECTED }} />
                Selected
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm opacity-50" style={{ background: COLOR_BUSY }} />
                Busy
              </span>
            </>
          )}
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => {
              setScale(fit.scale);
              setStagePos({ x: fit.x, y: fit.y });
            }}
            className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600 transition-colors hover:bg-slate-50"
          >
            Fit
          </button>
          <button
            type="button"
            onClick={() => zoomBy(0.15)}
            className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-xs text-slate-600 transition-colors hover:bg-slate-50"
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => zoomBy(-0.15)}
            className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-xs text-slate-600 transition-colors hover:bg-slate-50"
            aria-label="Zoom out"
          >
            &minus;
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
        style={{ height: Math.max(minHeight, canvasH), touchAction: 'none' }}
        aria-label={`Floor plan picker. ${selectedIds.length} table${selectedIds.length !== 1 ? 's' : ''} selected.`}
      >
        <Stage
          ref={(node) => {
            stageRef.current = node;
          }}
          width={canvasW}
          height={canvasH}
          scaleX={stageScale}
          scaleY={stageScale}
          x={stagePos.x}
          y={stagePos.y}
          onClick={handleStageClick}
          onTap={handleStageClick}
          draggable
          onDragEnd={(ev) => {
            if (ev.target === ev.target.getStage()) {
              setStagePos({ x: ev.target.x(), y: ev.target.y() });
            }
          }}
          style={{ background: '#f1f5f9', cursor: 'grab' }}
        >
          <Layer>
            {tables.map((table) => {
              const busy = occupiedSet.has(table.id);
              const isSelected = selectedIds.includes(table.id);
              let statusColour: string;
              if (previewMode) {
                statusColour = isSelected ? COLOR_PREVIEW_HIGHLIGHT : COLOR_PREVIEW_IDLE;
              } else if (busy) {
                statusColour = COLOR_BUSY;
              } else if (isSelected) {
                statusColour = COLOR_SELECTED;
              } else {
                statusColour = COLOR_FREE;
              }

              const fb = getTableDimensions(table.max_covers, table.shape);
              const { w, h } = tableDimensionsPercentToPixels(
                table.width ?? fb.width,
                table.height ?? fb.height,
                logicalW,
                logicalH,
                table.shape,
              );

              /* Preview mode: dim non-highlighted tables when anything is selected,
                 so the combination stands out. In picker mode, only busy tables dim. */
              const previewDim = previewMode && selectedIds.length > 0 && !isSelected;
              const groupOpacity = previewDim ? 0.35 : busy ? 0.45 : 1;

              return (
                <Group key={table.id} opacity={groupOpacity}>
                  <TableShape
                    table={table}
                    hiddenSides={previewMode ? blockedToHiddenSet(adjacency.get(table.id)) : EMPTY_HIDDEN}
                    isSelected={!previewMode && isSelected && !busy}
                    isEditorMode={false}
                    statusColour={statusColour}
                    booking={null}
                    canvasWidth={logicalW}
                    canvasHeight={logicalH}
                    compactLabels={!previewMode}
                    showSeats={!previewMode}
                    layoutScale={previewMode ? scale : undefined}
                    unifiedLabelFonts={unifiedLabelFonts}
                    seatAngles={table.seat_angles}
                    onClick={previewMode ? undefined : () => toggleTable(table.id)}
                    onTap={previewMode ? undefined : () => toggleTable(table.id)}
                  />
                  {/* Pointer-cursor hit area over each free table (picker mode only). */}
                  {!busy && !previewMode && (
                    <Rect
                      x={
                        (table.position_x != null
                          ? (table.position_x / 100) * logicalW
                          : logicalW / 2) - w / 2
                      }
                      y={
                        (table.position_y != null
                          ? (table.position_y / 100) * logicalH
                          : logicalH / 2) - h / 2
                      }
                      width={w}
                      height={h}
                      opacity={0}
                      onMouseEnter={(e) => {
                        const container = e.target.getStage()?.container();
                        if (container) container.style.cursor = 'pointer';
                      }}
                      onMouseLeave={(e) => {
                        const container = e.target.getStage()?.container();
                        if (container) container.style.cursor = 'grab';
                      }}
                      onClick={() => toggleTable(table.id)}
                      onTap={() => toggleTable(table.id)}
                    />
                  )}
                </Group>
              );
            })}
          </Layer>
        </Stage>
      </div>

      {/* Selection summary (hidden in read-only preview mode) */}
      {previewMode ? null : (
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {selectedIds.length > 0 ? (
          <>
            {selectedTableNames.map((tName, i) => (
              <span
                key={selectedIds[i]}
                className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-800"
              >
                {tName}
                <button
                  type="button"
                  onClick={() => removeTable(selectedIds[i]!)}
                  className="ml-0.5 rounded-sm text-blue-400 transition-colors hover:text-blue-700"
                  aria-label={`Remove ${tName}`}
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}

            <span className={`text-[11px] font-medium tabular-nums ${capacityOk ? 'text-emerald-600' : 'text-amber-600'}`}>
              Cap {combinedCapacity} / Party {partySize}
            </span>

            <button
              type="button"
              onClick={() => onChange([])}
              className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              Clear
            </button>
          </>
        ) : (
          <p className="text-[11px] text-slate-400">Tap tables above to select for this booking</p>
        )}
      </div>
      )}

      {!previewMode && selectedIds.length > 0 && !capacityOk && (
        <p className="mt-1.5 text-[11px] text-amber-600">
          Selected capacity is tight for this party. You can still assign; staff can adjust on the floor.
        </p>
      )}
    </div>
  );
}
