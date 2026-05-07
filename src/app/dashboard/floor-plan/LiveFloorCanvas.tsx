'use client';

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Stage, Layer, Line, Rect, Text, Circle, Group, Image as KonvaImage } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type Konva from 'konva';
import {
  computeTableAdjacency,
  getTableDimensions,
  tableDimensionsPercentToPixels,
} from '@/types/table-management';
import {
  computeStageFitToView,
  FLOOR_PLAN_DEFAULT_LAYOUT_HEIGHT,
  FLOOR_PLAN_DEFAULT_LAYOUT_WIDTH,
} from '@/lib/floor-plan/fit-view';
import type { BlockedSides } from '@/types/table-management';
import TableShape from '@/components/floor-plan/TableShape';

/**
 * Stat tile label colours from `DashboardStatCard` (Tailwind `text-blue-700` / `text-emerald-700`).
 * TableShape lightens the fill from these bases; strokes use the base hex directly.
 */
const STAT_TILE_TEXT_BLUE_700 = '#1d4ed8';
const AVAILABLE_TABLE_GRAY = '#64748b';

const STATUS_COLORS: Record<string, string> = {
  available: AVAILABLE_TABLE_GRAY,
  booked: STAT_TILE_TEXT_BLUE_700,
  pending: '#2563eb',
  reserved: '#6366f1',
  seated: '#0f766e',
  held: '#57534e',
  no_show: '#b91c1c',
  late: '#c2410c',
  starters: '#0369a1',
  mains: '#0369a1',
  dessert: '#0369a1',
  bill: '#0369a1',
  paid: '#047857',
  bussing: '#78716c',
};

/** Valid drop target - amber reads on both emerald-tinted empty and blue-tinted occupied fills */
const VALID_TARGET_COLOR = '#d97706';
const DRAG_GHOST_OPACITY = 0.35;

const EMPTY_HIDDEN_SET = new Set<string>();
function blockedToHiddenSet(blocked?: BlockedSides): Set<string> {
  if (!blocked) return EMPTY_HIDDEN_SET;
  const s = new Set<string>();
  if (blocked.top) s.add('top');
  if (blocked.right) s.add('right');
  if (blocked.bottom) s.add('bottom');
  if (blocked.left) s.add('left');
  return s.size > 0 ? s : EMPTY_HIDDEN_SET;
}

function clampScale(value: number): number {
  return Math.max(0.3, Math.min(3, value));
}

function clientXYFromKonvaEvt(e: KonvaEventObject<MouseEvent | TouchEvent>): { x: number; y: number } | null {
  const ne = e.evt;
  if ('clientX' in ne && typeof (ne as MouseEvent).clientX === 'number') {
    const m = ne as MouseEvent;
    return { x: m.clientX, y: m.clientY };
  }
  const te = ne as TouchEvent;
  const t = te.changedTouches?.[0];
  if (t) return { x: t.clientX, y: t.clientY };
  return null;
}

function touchDistance(touches: TouchList): number {
  if (touches.length < 2) return 0;
  const a = touches[0]!;
  const b = touches[1]!;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function touchCenter(touches: TouchList, container: HTMLDivElement): { x: number; y: number } | null {
  if (touches.length < 2) return null;
  const rect = container.getBoundingClientRect();
  const a = touches[0]!;
  const b = touches[1]!;
  return {
    x: (a.clientX + b.clientX) / 2 - rect.left,
    y: (a.clientY + b.clientY) / 2 - rect.top,
  };
}

interface TableWithState {
  id: string;
  name: string;
  min_covers: number;
  max_covers: number;
  shape: string;
  zone: string | null;
  position_x: number | null;
  position_y: number | null;
  width: number | null;
  height: number | null;
  rotation: number | null;
  is_temporary?: boolean;
  seat_angles?: (number | null)[] | null;
  polygon_points?: { x: number; y: number }[] | null;
  service_status: string;
  booking: {
    id: string;
    guest_name: string;
    party_size: number;
    status: string;
    start_time: string;
    estimated_end_time?: string | null;
  } | null;
  /** 0–100 for bar; ring uses `turn_progress_pct` (may exceed 100 when overdue). */
  elapsed_pct: number;
  turn_progress_pct: number;
}

export interface FloorDragEvent {
  bookingId: string;
  sourceTableIds: string[];
  targetTableId: string;
}

interface Props {
  tables: TableWithState[];
  /** Logical floor size in px (same as floor plan editor); table % positions map to this rectangle. */
  layoutWidth?: number;
  layoutHeight?: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  combinedTableGroups?: Map<string, string[]>;
  validDropTargets?: Set<string> | null;
  validDropComboLabels?: Map<string, string> | null;
  reassignMode?: { bookingId: string; guestName: string } | null;
  onDragStart?: (bookingId: string, sourceTableIds: string[]) => void;
  onDragEnd?: (event: FloorDragEvent) => void;
  onDragCancel?: () => void;
  /** Tap/click a booked table (not drag): open booking detail anchored to pointer. */
  onBookingClick?: (bookingId: string, anchor: { x: number; y: number }) => void;
  /** Right-click / long-press style menu for a booked table (client viewport coords). */
  onBookedTableContextMenu?: (bookingId: string, tableId: string, clientX: number, clientY: number) => void;
  /** Dimmed floor plan background (same asset as layout editor). */
  floorBackgroundUrl?: string | null;
}

export default function LiveFloorCanvas({
  tables,
  layoutWidth = FLOOR_PLAN_DEFAULT_LAYOUT_WIDTH,
  layoutHeight = FLOOR_PLAN_DEFAULT_LAYOUT_HEIGHT,
  selectedId,
  onSelect,
  combinedTableGroups,
  validDropTargets,
  validDropComboLabels,
  reassignMode,
  onDragStart,
  onDragEnd,
  onDragCancel,
  onBookingClick,
  onBookedTableContextMenu,
  floorBackgroundUrl,
}: Props) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const layoutPixelW = Math.max(1, Math.round(layoutWidth));
  const layoutPixelH = Math.max(1, Math.round(layoutHeight));
  /** Visible container size (px). Stage is rendered at this size so all tables fit after fit-to-view. */
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const stageWidth = Math.max(1, viewport.w);
  const stageHeight = Math.max(1, viewport.h);
  const [scale, setScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const baseScaleRef = useRef(1);
  const hasMeasuredViewport = viewport.w > 1 && viewport.h > 1;
  const [draggingBookingId, setDraggingBookingId] = useState<string | null>(null);
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number } | null>(null);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  /** Tracks whether the Konva Stage is mid-pan (click vs. drag distinction for deselect). */
  const panningRef = useRef(false);
  const [isCoarsePointer, setIsCoarsePointer] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(pointer: coarse)').matches : false,
  );
  const [panMode, setPanMode] = useState(false);
  const [floorBgImage, setFloorBgImage] = useState<HTMLImageElement | null>(null);
  const pinchGestureRef = useRef<{
    distance: number;
    center: { x: number; y: number };
    scale: number;
    stagePos: { x: number; y: number };
  } | null>(null);

  const positionedTables = useMemo(() => {
    const temporaryTables = tables.filter((table) => table.is_temporary);
    if (temporaryTables.length === 0) return tables;

    const regularTables = tables.filter((table) => !table.is_temporary);
    const tempRowY = layoutPixelH + Math.max(140, layoutPixelH * 0.08);
    const gap = layoutPixelW / (temporaryTables.length + 1);

    return [
      ...regularTables,
      ...temporaryTables.map((table, index) => ({
        ...table,
        position_x: ((gap * (index + 1)) / layoutPixelW) * 100,
        position_y: (tempRowY / layoutPixelH) * 100,
        rotation: 0,
      })),
    ];
  }, [tables, layoutPixelW, layoutPixelH]);

  const handleEmptyCanvasClick = useCallback(() => {
    if (isDraggingRef.current || panningRef.current) return;
    if (draggingBookingId) {
      setDraggingBookingId(null);
      setDragPointer(null);
      isDraggingRef.current = false;
      onDragCancel?.();
    } else {
      onSelect(null);
    }
  }, [onSelect, draggingBookingId, onDragCancel]);

  const handleStageClick = useCallback((e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (e.target === e.target.getStage()) handleEmptyCanvasClick();
  }, [handleEmptyCanvasClick]);

  useEffect(() => {
    if (!floorBackgroundUrl) {
      setFloorBgImage(null);
      return;
    }
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (!cancelled) setFloorBgImage(img);
    };
    img.onerror = () => {
      if (!cancelled) setFloorBgImage(null);
    };
    img.src = floorBackgroundUrl;
    return () => {
      cancelled = true;
    };
  }, [floorBackgroundUrl]);

  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    const onChange = () => {
      setIsCoarsePointer(mq.matches);
      if (!mq.matches) setPanMode(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!panMode) return;
    const timeout = window.setTimeout(() => setPanMode(false), 15000);
    return () => window.clearTimeout(timeout);
  }, [panMode, stagePos, scale]);

  const adjacency = useMemo(() => {
    const bounds = positionedTables.map((t) => {
      const fallback = getTableDimensions(t.max_covers, t.shape);
      const { w, h } = tableDimensionsPercentToPixels(
        t.width ?? fallback.width,
        t.height ?? fallback.height,
        layoutPixelW,
        layoutPixelH,
        t.shape,
      );
      return {
        id: t.id,
        x: t.position_x != null ? (t.position_x / 100) * layoutPixelW : layoutPixelW / 2,
        y: t.position_y != null ? (t.position_y / 100) * layoutPixelH : layoutPixelH / 2,
        w,
        h,
      };
    });
    return computeTableAdjacency(bounds);
  }, [positionedTables, layoutPixelW, layoutPixelH]);

  const combinationLines = useCallback(() => {
    if (!combinedTableGroups) return [];
    const lines: Array<{ key: string; points: number[] }> = [];

    combinedTableGroups.forEach((tableIds, bookingId) => {
      if (tableIds.length < 2) return;
      for (let i = 0; i < tableIds.length - 1; i++) {
        const t1 = positionedTables.find((t) => t.id === tableIds[i]);
        const t2 = positionedTables.find((t) => t.id === tableIds[i + 1]);
        if (!t1 || !t2) continue;
        const x1 = t1.position_x != null ? (t1.position_x / 100) * layoutPixelW : layoutPixelW / 2;
        const y1 = t1.position_y != null ? (t1.position_y / 100) * layoutPixelH : layoutPixelH / 2;
        const x2 = t2.position_x != null ? (t2.position_x / 100) * layoutPixelW : layoutPixelW / 2;
        const y2 = t2.position_y != null ? (t2.position_y / 100) * layoutPixelH : layoutPixelH / 2;
        lines.push({ key: `${bookingId}-${i}`, points: [x1, y1, x2, y2] });
      }
    });

    return lines;
  }, [combinedTableGroups, positionedTables, layoutPixelW, layoutPixelH]);

  const layoutSignature = useMemo(
    () =>
      positionedTables
        .map((table) =>
          [
            table.id,
            table.position_x ?? '',
            table.position_y ?? '',
            table.width ?? '',
            table.height ?? '',
            table.shape,
            table.max_covers,
          ].join(':'),
        )
        .sort()
        .join('|'),
    [positionedTables],
  );

  const handleTableMouseDown = useCallback((tableId: string, _e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const table = positionedTables.find((t) => t.id === tableId);
    if (!table?.booking) return;

    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    dragStartPosRef.current = { x: pointer.x, y: pointer.y };
  }, [positionedTables]);

  const handleTableMouseMove = useCallback((tableId: string) => {
    if (!dragStartPosRef.current) return;
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const dx = pointer.x - dragStartPosRef.current.x;
    const dy = pointer.y - dragStartPosRef.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 8 && !isDraggingRef.current) {
      isDraggingRef.current = true;
      const table = positionedTables.find((t) => t.id === tableId);
      if (table?.booking) {
        const bookingId = table.booking.id;
        const sourceTableIds = combinedTableGroups?.get(bookingId) ?? [tableId];
        setDraggingBookingId(bookingId);
        onDragStart?.(bookingId, sourceTableIds);
      }
    }

    if (isDraggingRef.current) {
      setDragPointer({
        x: (pointer.x - stagePos.x) / scale,
        y: (pointer.y - stagePos.y) / scale,
      });
    }
  }, [positionedTables, combinedTableGroups, onDragStart, scale, stagePos]);

  const openBookingAtPointer = useCallback((tableId: string, bookingId: string, e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true;
    if (isDraggingRef.current || panningRef.current) return;
    const anchor = clientXYFromKonvaEvt(e);
    if (!anchor) return;
    setDraggingBookingId(null);
    setDragPointer(null);
    dragStartPosRef.current = null;
    onSelect(tableId);
    window.setTimeout(() => {
      onBookingClick?.(bookingId, anchor);
    }, 0);
  }, [onBookingClick, onSelect]);

  const handleTableMouseUp = useCallback((tableId: string, e?: KonvaEventObject<MouseEvent | TouchEvent>, bookingId?: string) => {
    if (isDraggingRef.current && draggingBookingId) {
      const sourceTableIds = combinedTableGroups?.get(draggingBookingId) ?? [];
      if (!sourceTableIds.includes(tableId) && validDropTargets?.has(tableId)) {
        onDragEnd?.({
          bookingId: draggingBookingId,
          sourceTableIds,
          targetTableId: tableId,
        });
      } else {
        onDragCancel?.();
      }
      setDraggingBookingId(null);
      setDragPointer(null);
      isDraggingRef.current = false;
      dragStartPosRef.current = null;
      return;
    }

    if (bookingId && e && !panningRef.current) {
      openBookingAtPointer(tableId, bookingId, e);
      return;
    }

    dragStartPosRef.current = null;
    isDraggingRef.current = false;
  }, [combinedTableGroups, draggingBookingId, validDropTargets, onDragEnd, onDragCancel, openBookingAtPointer]);

  const handleStageMouseUp = useCallback(() => {
    if (isDraggingRef.current && draggingBookingId) {
      onDragCancel?.();
      setDraggingBookingId(null);
      setDragPointer(null);
    }
    isDraggingRef.current = false;
    dragStartPosRef.current = null;
  }, [draggingBookingId, onDragCancel]);

  const handleStageMouseMove = useCallback(() => {
    if (!isDraggingRef.current || !dragStartPosRef.current) return;
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    setDragPointer({
      x: (pointer.x - stagePos.x) / scale,
      y: (pointer.y - stagePos.y) / scale,
    });
  }, [scale, stagePos]);

  /**
   * Fits the bounding box of all tables (in logical layout coords) into the visible viewport
   * so the page loads at a sensible zoom. Stage is rendered at viewport size, while tables are
   * positioned in `layoutPixelW`×`layoutPixelH` space — we find their AABB and scale+pan the Stage.
   */
  const fitViewToStage = useCallback(() => {
    const vw = viewport.w;
    const vh = viewport.h;
    if (vw < 1 || vh < 1 || positionedTables.length === 0) return;

    const fit = computeStageFitToView(
      positionedTables,
      layoutPixelW,
      layoutPixelH,
      vw,
      vh,
      {
        padding: 48,
        maxScale: 3,
      },
    );
    const nextScale = Math.max(0.1, fit.scale);
    baseScaleRef.current = nextScale;
    setScale(nextScale);
    setStagePos({ x: fit.x, y: fit.y });
  }, [positionedTables, layoutPixelW, layoutPixelH, viewport.w, viewport.h]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setViewport((prev) =>
        prev.w === Math.round(rect.width) && prev.h === Math.round(rect.height)
          ? prev
          : { w: Math.round(rect.width), h: Math.round(rect.height) },
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const initialFitDone = useRef(false);
  useEffect(() => {
    initialFitDone.current = false;
  }, [layoutWidth, layoutHeight, layoutSignature]);
  useEffect(() => {
    if (positionedTables.length === 0 || !hasMeasuredViewport) return;
    if (!initialFitDone.current) {
      fitViewToStage();
      initialFitDone.current = true;
    }
  }, [positionedTables.length, hasMeasuredViewport, fitViewToStage]);

  const zoomBy = useCallback(
    (delta: number) => {
      const newScale = clampScale(scale + delta);
      const cx = stageWidth / 2;
      const cy = stageHeight / 2;
      const pointTo = {
        x: (cx - stagePos.x) / scale,
        y: (cy - stagePos.y) / scale,
      };
      setScale(newScale);
      setStagePos({
        x: cx - pointTo.x * newScale,
        y: cy - pointTo.y * newScale,
      });
    },
    [scale, stagePos, stageWidth, stageHeight],
  );

  const handleStageTouchStart = useCallback((e: KonvaEventObject<TouchEvent>) => {
    const native = e.evt;
    if (native.touches.length < 2) return;
    const container = containerRef.current;
    if (!container) return;
    const center = touchCenter(native.touches, container);
    const distance = touchDistance(native.touches);
    if (!center || distance <= 0) return;
    if (native.cancelable) native.preventDefault();
    pinchGestureRef.current = {
      distance,
      center,
      scale,
      stagePos,
    };
    panningRef.current = true;
    isDraggingRef.current = false;
    dragStartPosRef.current = null;
  }, [scale, stagePos]);

  const handleStageTouchMove = useCallback((e: KonvaEventObject<TouchEvent>) => {
    const native = e.evt;
    if (native.touches.length < 2 || !pinchGestureRef.current) return;
    const container = containerRef.current;
    if (!container) return;
    const center = touchCenter(native.touches, container);
    const distance = touchDistance(native.touches);
    if (!center || distance <= 0) return;
    if (native.cancelable) native.preventDefault();

    const gesture = pinchGestureRef.current;
    const nextScale = clampScale(gesture.scale * (distance / gesture.distance));
    const pointTo = {
      x: (gesture.center.x - gesture.stagePos.x) / gesture.scale,
      y: (gesture.center.y - gesture.stagePos.y) / gesture.scale,
    };
    setScale(nextScale);
    setStagePos({
      x: center.x - pointTo.x * nextScale,
      y: center.y - pointTo.y * nextScale,
    });
  }, []);

  const handleStageTouchEnd = useCallback((e: KonvaEventObject<TouchEvent>) => {
    if (e.evt.touches.length >= 2) return;
    pinchGestureRef.current = null;
    setTimeout(() => {
      panningRef.current = false;
    }, 0);
  }, []);

  const isDragging = draggingBookingId != null || reassignMode != null;
  const activeBookingId = draggingBookingId ?? reassignMode?.bookingId ?? null;
  const canvasPanEnabled = !isDragging && (!isCoarsePointer || panMode);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-slate-50"
      style={{ touchAction: isCoarsePointer && !panMode ? 'pan-y' : 'none' }}
    >
      <div className="absolute right-2 top-2 z-10 flex gap-1 rounded-2xl border border-slate-200 bg-white p-0.5 shadow-sm shadow-slate-900/5">
        {isCoarsePointer ? (
          <button
            type="button"
            onClick={() => setPanMode((value) => !value)}
            className={`flex h-10 min-w-[3rem] items-center justify-center rounded-xl px-2 text-xs font-semibold sm:h-9 sm:min-w-[2.75rem] ${
              panMode ? 'bg-brand-600 text-white hover:bg-brand-700' : 'text-slate-600 hover:bg-slate-50'
            }`}
            aria-pressed={panMode}
            aria-label={panMode ? 'Turn off move mode' : 'Move floor plan'}
            title={panMode ? 'Move mode on' : 'Move floor plan'}
          >
            <svg className="h-4 w-4 sm:mr-1" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 11.5V14a5 5 0 0 0 10 0v-3.5M7 11.5V9a1.5 1.5 0 0 1 3 0v2.5m-3 0a1.5 1.5 0 0 0-3 0V14a8 8 0 0 0 16 0v-2.5a1.5 1.5 0 0 0-3 0m-7 0V7a1.5 1.5 0 0 1 3 0v4.5m-3 0h3m0 0V8.5a1.5 1.5 0 0 1 3 0v3" />
            </svg>
            <span className="hidden sm:inline">{panMode ? 'Done' : 'Move'}</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => zoomBy(0.2)}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-base text-slate-600 hover:bg-slate-50 sm:h-9 sm:w-9 sm:text-sm"
          aria-label="Zoom in"
        >+</button>
        <button
          type="button"
          onClick={() => zoomBy(-0.2)}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-base text-slate-600 hover:bg-slate-50 sm:h-9 sm:w-9 sm:text-sm"
          aria-label="Zoom out"
        >−</button>
        <button
          type="button"
          onClick={fitViewToStage}
          className="flex h-10 min-w-[3rem] items-center justify-center rounded-xl px-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 sm:h-9 sm:min-w-[2.75rem]"
          title="Fit entire floor plan to view"
        >{Math.round((baseScaleRef.current > 0 ? scale / baseScaleRef.current : scale) * 100)}%</button>
      </div>

      {isDragging && (
        <div className="absolute left-2 top-14 z-10 max-w-[calc(100%-4rem)] rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800 shadow-sm sm:top-2 sm:px-3 sm:py-1.5 sm:text-xs">
          {draggingBookingId
            ? 'Drop on a highlighted table to reassign'
            : `Select destination for ${reassignMode?.guestName ?? 'booking'}`}
        </div>
      )}

      {isCoarsePointer && panMode && !isDragging ? (
        <div className="absolute left-2 top-14 z-10 flex max-w-[calc(100%-1rem)] items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-900 shadow-sm">
          <span>Move mode on. Drag to pan, pinch to zoom.</span>
          <button
            type="button"
            onClick={() => setPanMode(false)}
            className="shrink-0 rounded-md px-1.5 py-0.5 font-semibold text-brand-700 hover:bg-brand-100"
          >
            Done
          </button>
        </div>
      ) : null}

      <Stage
        ref={(node) => { stageRef.current = node; }}
        width={stageWidth}
        height={stageHeight}
        onClick={handleStageClick}
        onTap={handleStageClick}
        onMouseUp={handleStageMouseUp}
        onMouseMove={handleStageMouseMove}
        onTouchStart={handleStageTouchStart}
        onTouchMove={handleStageTouchMove}
        onTouchEnd={handleStageTouchEnd}
        onTouchCancel={handleStageTouchEnd}
        style={{ background: '#f8fafc', cursor: isDragging || canvasPanEnabled ? 'grab' : 'default' }}
      >
        <Layer>
          <Group
            x={stagePos.x}
            y={stagePos.y}
            scaleX={scale}
            scaleY={scale}
            draggable={canvasPanEnabled}
            onDragStart={() => {
              panningRef.current = true;
            }}
            onDragMove={(e) => {
              setStagePos({ x: e.target.x(), y: e.target.y() });
            }}
            onDragEnd={(e) => {
              setStagePos({ x: e.target.x(), y: e.target.y() });
              setTimeout(() => {
                panningRef.current = false;
              }, 0);
            }}
          >
            {floorBgImage ? (
              <KonvaImage
                x={0}
                y={0}
                width={layoutPixelW}
                height={layoutPixelH}
                image={floorBgImage}
                opacity={0.22}
                listening={false}
              />
            ) : null}
            <Rect
              x={0}
              y={0}
              width={layoutPixelW}
              height={layoutPixelH}
              fill={floorBgImage ? 'rgba(248,250,252,0.92)' : 'rgba(248,250,252,0.01)'}
              onClick={handleEmptyCanvasClick}
              onTap={handleEmptyCanvasClick}
            />

            {/* Combination lines only when a booking spans multiple tables (see combinationLines) */}
            {positionedTables.some((table) => table.is_temporary) ? (
              <>
                <Line
                  points={[0, layoutPixelH + 48, layoutPixelW, layoutPixelH + 48]}
                  stroke="#cbd5e1"
                  strokeWidth={2}
                  dash={[10, 8]}
                  listening={false}
                />
                <Text
                  x={0}
                  y={layoutPixelH + 62}
                  width={layoutPixelW}
                  text="Temporary tables"
                  align="center"
                  fontSize={16}
                  fontStyle="bold"
                  fill="#9a3412"
                  listening={false}
                />
              </>
            ) : null}

            {combinationLines().map((line) => (
              <Line
                key={line.key}
                points={line.points}
                stroke="#8b5cf6"
                strokeWidth={3}
                dash={[8, 4]}
                opacity={0.7}
              />
            ))}

            {/* Tables */}
            {positionedTables.map((table) => {
              const isSelected = table.id === selectedId;
              const isSource = activeBookingId ? (combinedTableGroups?.get(activeBookingId)?.includes(table.id) ?? (table.booking?.id === activeBookingId)) : false;
              const isValidTarget = isDragging && validDropTargets?.has(table.id) && !isSource;
              const isInvalid = isDragging && !isSource && !validDropTargets?.has(table.id);
              const comboLabel = validDropComboLabels?.get(table.id);

              let statusColor = STATUS_COLORS[table.service_status] ?? AVAILABLE_TABLE_GRAY;
              let opacity = 1;

              if (isDragging) {
                if (isValidTarget) {
                  statusColor = VALID_TARGET_COLOR;
                } else if (isSource) {
                  opacity = DRAG_GHOST_OPACITY;
                } else if (isInvalid) {
                  opacity = 0.2;
                }
              }

              const blocked = adjacency.get(table.id);
              const hidden = blockedToHiddenSet(blocked);

              const fb = getTableDimensions(table.max_covers, table.shape);
              const { w, h } = tableDimensionsPercentToPixels(
                table.width ?? fb.width,
                table.height ?? fb.height,
                layoutPixelW,
                layoutPixelH,
                table.shape,
              );

              return (
                <TableShape
                  key={table.id}
                  table={table}
                  hiddenSides={hidden}
                  isSelected={isSelected || (isValidTarget ?? false)}
                  isEditorMode={false}
                  statusColour={statusColor}
                  groupOpacity={opacity}
                  booking={isDragging && isSource ? null : table.booking}
                  turnProgressPct={
                    table.booking && !(isDragging && isSource) && table.booking.estimated_end_time
                      ? table.turn_progress_pct
                      : null
                  }
                  comboTableCount={
                    table.booking ? (combinedTableGroups?.get(table.booking.id)?.length ?? 0) : 0
                  }
                  canvasWidth={layoutPixelW}
                  canvasHeight={layoutPixelH}
                  layoutScale={scale}
                  seatAngles={table.seat_angles}
                  alwaysShowTableName
                  onClick={(e) => {
                    if (isDragging && isValidTarget) {
                      if (draggingBookingId) {
                        const sourceTableIds = combinedTableGroups?.get(draggingBookingId) ?? [];
                        onDragEnd?.({
                          bookingId: draggingBookingId,
                          sourceTableIds,
                          targetTableId: table.id,
                        });
                        setDraggingBookingId(null);
                        setDragPointer(null);
                        isDraggingRef.current = false;
                        dragStartPosRef.current = null;
                      }
                      return;
                    }
                    if (table.booking) {
                      openBookingAtPointer(table.id, table.booking.id, e);
                      return;
                    }
                    if (!isDraggingRef.current) onSelect(table.id);
                  }}
                  onTap={(e) => {
                    if (isDragging && isValidTarget) {
                      if (draggingBookingId) {
                        const sourceTableIds = combinedTableGroups?.get(draggingBookingId) ?? [];
                        onDragEnd?.({
                          bookingId: draggingBookingId,
                          sourceTableIds,
                          targetTableId: table.id,
                        });
                        setDraggingBookingId(null);
                        setDragPointer(null);
                        isDraggingRef.current = false;
                        dragStartPosRef.current = null;
                      }
                      return;
                    }
                    if (table.booking) {
                      openBookingAtPointer(table.id, table.booking.id, e);
                      return;
                    }
                    onSelect(table.id);
                  }}
                >
                  {/* Valid target ring */}
                  {isValidTarget && (
                    <>
                      {table.shape === 'circle' ? (
                        <Circle
                          x={0}
                          y={0}
                          radius={Math.max(w, h) / 2 + 6}
                          stroke={VALID_TARGET_COLOR}
                          strokeWidth={3}
                          dash={[6, 3]}
                          opacity={0.8}
                          listening={false}
                        />
                      ) : (
                        <Rect
                          x={-w / 2 - 6}
                          y={-h / 2 - 6}
                          width={w + 12}
                          height={h + 12}
                          cornerRadius={6}
                          stroke={VALID_TARGET_COLOR}
                          strokeWidth={3}
                          dash={[6, 3]}
                          opacity={0.8}
                          listening={false}
                        />
                      )}
                      {comboLabel && (
                        <Text
                          x={-72}
                          y={h / 2 + 10}
                          width={144}
                          align="center"
                          verticalAlign="middle"
                          text={comboLabel}
                          fontSize={12}
                          fill="#16a34a"
                          fontStyle="bold"
                          listening={false}
                        />
                      )}
                    </>
                  )}

                  {/* Drag initiation overlay (only on occupied tables, hidden during drag) */}
                  {table.booking && !isDragging && (
                    <Rect
                      x={-w / 2}
                      y={-h / 2}
                      width={w}
                      height={h}
                      fill="rgba(15,23,42,0.01)"
                      onMouseDown={(e) => { e.cancelBubble = true; handleTableMouseDown(table.id, e); }}
                      onMouseMove={() => handleTableMouseMove(table.id)}
                      onMouseUp={(e) => handleTableMouseUp(table.id, e, table.booking?.id)}
                      onClick={(e) => {
                        if (table.booking) openBookingAtPointer(table.id, table.booking.id, e);
                      }}
                      onTap={(e) => {
                        if (table.booking) openBookingAtPointer(table.id, table.booking.id, e);
                      }}
                      onContextMenu={(e) => {
                        e.evt.preventDefault();
                        if (!table.booking || isDraggingRef.current) return;
                        const a = clientXYFromKonvaEvt(e);
                        if (a) onBookedTableContextMenu?.(table.booking.id, table.id, a.x, a.y);
                      }}
                      onTouchStart={(e) => {
                        if (isCoarsePointer) return;
                        e.cancelBubble = true;
                        handleTableMouseDown(table.id, e);
                      }}
                      onTouchMove={() => {
                        if (!isCoarsePointer) handleTableMouseMove(table.id);
                      }}
                      onTouchEnd={(e) => {
                        handleTableMouseUp(table.id, e, table.booking?.id);
                      }}
                    />
                  )}

                  {/* Drop-capture overlay (all tables during drag, catches mouseUp on target) */}
                  {isDragging && !isSource && (
                    <Rect
                      x={-w / 2}
                      y={-h / 2}
                      width={w}
                      height={h}
                      opacity={0}
                      onMouseUp={() => handleTableMouseUp(table.id)}
                      onTouchEnd={() => handleTableMouseUp(table.id)}
                    />
                  )}
                </TableShape>
              );
            })}

            {/* Drag cursor indicator */}
            {dragPointer && draggingBookingId && (
              <>
                <Circle
                  x={dragPointer.x}
                  y={dragPointer.y}
                  radius={16}
                  fill="#3b82f6"
                  opacity={0.6}
                  listening={false}
                />
                <Text
                  x={dragPointer.x - 48}
                  y={dragPointer.y + 18}
                  width={96}
                  align="center"
                  verticalAlign="middle"
                  text={(() => {
                    const b = positionedTables.find((t) => t.booking?.id === draggingBookingId);
                    return b?.booking?.guest_name ?? '';
                  })()}
                  fontSize={12}
                  fill="#1e40af"
                  fontStyle="bold"
                  listening={false}
                />
              </>
            )}
          </Group>
        </Layer>
      </Stage>
    </div>
  );
}
