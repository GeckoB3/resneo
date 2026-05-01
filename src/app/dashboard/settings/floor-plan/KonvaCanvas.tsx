'use client';

import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Stage, Layer, Line, Rect, Group, Circle } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type Konva from 'konva';

import type { VenueTable } from '@/types/table-management';
import { getTableDimensions, computeTableAdjacency, tableDimensionsPercentToPixels } from '@/types/table-management';
import type { BlockedSides } from '@/types/table-management';
import TableShape from '@/components/floor-plan/TableShape';
import { computeFitFullLayoutToViewport } from '@/lib/floor-plan/fit-view';
import { computeGlobalUnifiedLabelFonts } from '@/lib/floor-plan/table-label-fonts';

// Constants & helpers

/** Logical floor size is at least this wide (px) so 50+ tables can be placed comfortably. */
const MIN_LAYOUT_WIDTH = 2600;
/** New unsaved layouts default to a square floor area. */
const MIN_LAYOUT_HEIGHT = 2600;

/** Snap “close polygon” to first vertex: tolerance in stage pixels (fat-finger friendly on touch). */
const POLYGON_CLOSE_HIT_STAGE_PX = 28;
const MIN_RESIZE_WIDTH = 1600;
const MIN_RESIZE_HEIGHT = 1200;
/** Match toolbar limits in FloorPlanEditor */
const MAX_LAYOUT_WIDTH = 12000;
const MAX_LAYOUT_HEIGHT = 9000;

export type LayoutResizeAnchor =
  | 'e'
  | 's'
  | 'w'
  | 'n'
  | 'se'
  | 'sw'
  | 'ne'
  | 'nw';

/** Multiply viewport width so the editable area is larger than the on-screen column. */
const VIEWPORT_TO_LAYOUT_MULTIPLIER = 2.6;
const ZONE_COLORS: Record<string, string> = {};
const ZONE_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4',
];
let colorIdx = 0;

function getZoneColor(zone: string | null): string {
  if (!zone) return '#3b82f6';
  if (!ZONE_COLORS[zone]) {
    ZONE_COLORS[zone] = ZONE_PALETTE[colorIdx % ZONE_PALETTE.length]!;
    colorIdx++;
  }
  return ZONE_COLORS[zone]!;
}

function pctToPixel(pct: number | null, dim: number): number {
  return pct != null ? (pct / 100) * dim : dim / 2;
}

function pixelToPct(px: number, dim: number): number {
  return Math.max(0, Math.min(100, (px / dim) * 100));
}

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

function tableBounds(t: VenueTable, dims: { width: number; height: number }): { x: number; y: number; w: number; h: number } {
  const fb = getTableDimensions(t.max_covers, t.shape);
  const { w, h } = tableDimensionsPercentToPixels(
    t.width ?? fb.width,
    t.height ?? fb.height,
    dims.width,
    dims.height,
    t.shape,
  );
  return {
    x: pctToPixel(t.position_x, dims.width),
    y: pctToPixel(t.position_y, dims.height),
    w,
    h,
  };
}

/** Layout size from pointer delta — floats (no rounding) for smooth resize; clamped only. */
function computeLayoutSizeFromDelta(
  anchor: LayoutResizeAnchor,
  startW: number,
  startH: number,
  dx: number,
  dy: number,
): { newW: number; newH: number } {
  let newW = startW;
  let newH = startH;
  switch (anchor) {
    case 'e':
      newW = startW + dx;
      break;
    case 'w':
      newW = startW - dx;
      break;
    case 's':
      newH = startH + dy;
      break;
    case 'n':
      newH = startH - dy;
      break;
    case 'se':
      newW = startW + dx;
      newH = startH + dy;
      break;
    case 'sw':
      newW = startW - dx;
      newH = startH + dy;
      break;
    case 'ne':
      newW = startW + dx;
      newH = startH - dy;
      break;
    case 'nw':
      newW = startW - dx;
      newH = startH - dy;
      break;
    default:
      break;
  }
  return {
    newW: Math.max(MIN_RESIZE_WIDTH, Math.min(MAX_LAYOUT_WIDTH, newW)),
    newH: Math.max(MIN_RESIZE_HEIGHT, Math.min(MAX_LAYOUT_HEIGHT, newH)),
  };
}

// Component props

interface CombinationLink {
  id: string;
  name: string;
  tableIds: string[];
}

interface Props {
  tables: VenueTable[];
  selectedId: string | null;
  selectedIds?: string[];
  onSelect: (id: string | null, additive?: boolean) => void;
  onMultiSelect?: (ids: string[]) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, w: number, h: number) => void;
  onRotate?: (id: string, rotation: number) => void;
  combinationLinks?: CombinationLink[];
  /** When false, manual combination link lines are not drawn (e.g. embedded Layout tab). */
  showCombinationLinkLines?: boolean;
  backgroundUrl?: string | null;
  alignmentGuidesEnabled?: boolean;
  /** Render a faint grid overlay over the canvas area. */
  showGrid?: boolean;
  /** Grid step in layout %. Used for the overlay. */
  gridStepPct?: number;
  /** Override the computed logical canvas dimensions (from saved floor plan). */
  layoutWidth?: number | null;
  layoutHeight?: number | null;
  /** Called on every frame while dragging a layout resize handle. */
  onLayoutResize?: (w: number, h: number, opts?: { anchor: LayoutResizeAnchor }) => void;
  /** Called once when the user finishes dragging a layout resize handle (for DB save). */
  onLayoutResizeEnd?: () => void;
  /** Called when a seat is dragged to a new position. */
  onSeatDrag?: (tableId: string, seatIndex: number, newAngle: number) => void;
  onSeatDragEnd?: (tableId: string, seatIndex: number, newAngle: number) => void;
  /**
   * Called when the user finishes drawing a polygon on the canvas.
   * Returns canvas-space points; caller converts to % and creates the table.
   */
  onPolygonCreate?: (points: { x: number; y: number }[], canvasWidth: number, canvasHeight: number) => void;
  /** Set to true while the user is dragging "Custom" from the elements panel. */
  polygonDrawPending?: boolean;
  onPolygonDrawCancel?: () => void;
  onDimensionsChange?: (dims: { width: number; height: number }) => void;
  /** Reshape a custom polygon table by dragging a vertex (table-local coordinates). */
  onPolygonVertexDrag?: (tableId: string, vertexIndex: number, localX: number, localY: number) => void;
  onPolygonVertexDragEnd?: () => void;
  /**
   * Report current stage view (zoom + pan) so callers can convert viewport
   * coords to layout coords (e.g. the HTML5 drag-and-drop drop handler).
   */
  onStageView?: (view: { scale: number; x: number; y: number }) => void;
  /**
   * Called when the user begins a drag with Alt held down on a table.
   * Parent should create a duplicate table at the SAME position as the original;
   * the original keeps being dragged and will land offset.
   */
  onAltDragDuplicate?: (tableId: string) => void;
}

// Component

export default function KonvaCanvas({
  tables, selectedId, selectedIds, onSelect, onMultiSelect, onMove, onResize, onRotate,
  combinationLinks,
  showCombinationLinkLines = true,
  backgroundUrl,
  alignmentGuidesEnabled = false,
  showGrid = false,
  gridStepPct = 2,
  layoutWidth, layoutHeight, onLayoutResize, onLayoutResizeEnd,
  onSeatDrag, onSeatDragEnd,
  onPolygonCreate,
  polygonDrawPending,
  onPolygonDrawCancel,
  onDimensionsChange,
  onPolygonVertexDrag,
  onPolygonVertexDragEnd,
  onStageView,
  onAltDragDuplicate,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  /** Visible area of the scroll container — used to fit the full layout on load. */
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const stagePosRef = useRef(stagePos);
  const scaleRef = useRef(scale);
  stagePosRef.current = stagePos;
  scaleRef.current = scale;
  const [, forceRender] = useState(0);

  // Drag state (refs to avoid re-renders during drag)
  const dragPosRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const snapGuidesRef = useRef<Array<{ points: number[] }>>([]);

  // Marquee (box) selection state
  const marqueeRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  // Rotation handle drag state
  const rotatingRef = useRef<{
    tableId: string;
    centerX: number;
    centerY: number;
  } | null>(null);

  // Polygon drawing state
  const [polygonDrawing, setPolygonDrawing] = useState<{
    active: boolean;
    points: { x: number; y: number }[];
    cursorPos: { x: number; y: number } | null;
  }>({ active: false, points: [], cursorPos: null });

  // Layout canvas resize via pointer tracking (NOT Konva draggable)
  const layoutResizeRef = useRef<{
    anchor: LayoutResizeAnchor;
    startW: number;
    startH: number;
    /**
     * Pointer position in **stage** coordinates at pointer-down (Konva `getPointerPosition()`).
     * Deltas must be derived from this, not from layout-local coords: layout-local uses `stagePos`,
     * which we change while resizing west/north, so `local - startLocal` would be wrong.
     */
    startPointerStage: { x: number; y: number };
    /** Stage pan at pointer-down — used to keep content visually fixed when expanding west/north. */
    startStagePos: { x: number; y: number };
  } | null>(null);

  /** Coalesce layout resize to one React update per animation frame for smooth borders. */
  const layoutResizeRafRef = useRef<number | null>(null);
  const layoutResizePendingRef = useRef<{ newW: number; newH: number } | null>(null);
  const layoutResizeDocCleanupRef = useRef<(() => void) | null>(null);
  const layoutResizePointerIdRef = useRef<number | undefined>(undefined);

  // Space-bar / middle-mouse temporary pan mode
  const [spacebarPan, setSpacebarPan] = useState(false);
  const middleMousePanRef = useRef(false);

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const vw = containerRef.current.offsetWidth;
        const autoW = Math.max(Math.round(vw * VIEWPORT_TO_LAYOUT_MULTIPLIER), MIN_LAYOUT_WIDTH);
        const autoH = Math.max(autoW, MIN_LAYOUT_HEIGHT);
        setDimensions({
          width: layoutWidth ?? autoW,
          height: layoutHeight ?? autoH,
        });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [layoutWidth, layoutHeight]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      setViewport({
        width: Math.max(1, Math.round(cr.width)),
        height: Math.max(1, Math.round(cr.height)),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    onDimensionsChange?.(dimensions);
  }, [dimensions, onDimensionsChange]);

  // Report current stage view (scale + pan) to parent so HTML5 drop handlers
  // can convert viewport coords → layout coords.
  useEffect(() => {
    onStageView?.({ scale, x: stagePos.x, y: stagePos.y });
  }, [scale, stagePos.x, stagePos.y, onStageView]);

  // --- Enter polygon drawing mode when parent signals pending drop ---
  useEffect(() => {
    if (polygonDrawPending && !polygonDrawing.active) {
      setPolygonDrawing({ active: true, points: [], cursorPos: null });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polygonDrawPending]);

  // Cancel polygon drawing when Esc fires or component unmounts
  useEffect(() => {
    if (!polygonDrawing.active) {
      onPolygonDrawCancel?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polygonDrawing.active]);

  // --- Space-bar + middle-mouse temporary pan mode; Escape to cancel polygon drawing ---
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        setSpacebarPan(true);
      }
      if (e.code === 'Escape') {
        setPolygonDrawing({ active: false, points: [], cursorPos: null });
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacebarPan(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    return () => {
      layoutResizeDocCleanupRef.current?.();
      layoutResizeDocCleanupRef.current = null;
      if (layoutResizeRafRef.current != null) {
        cancelAnimationFrame(layoutResizeRafRef.current);
        layoutResizeRafRef.current = null;
      }
    };
  }, []);

  const handleWheel = useCallback(
    (e: KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const zoomFactor = e.evt.ctrlKey ? 1.08 : 1.12;
      const direction = e.evt.deltaY > 0 ? -1 : 1;
      const oldScale = scale;
      const newScale = Math.max(0.15, Math.min(5, oldScale * (direction > 0 ? zoomFactor : 1 / zoomFactor)));

      const mousePointTo = {
        x: (pointer.x - stagePos.x) / oldScale,
        y: (pointer.y - stagePos.y) / oldScale,
      };
      setScale(newScale);
      setStagePos({
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale,
      });
    },
    [scale, stagePos],
  );

  // --- Build table bounds helper (uses latest dimensions) ---
  const getBounds = useCallback(
    (t: VenueTable) => tableBounds(t, dimensions),
    [dimensions],
  );

  // ============================================================
  // Drag handlers
  // ============================================================

  const handleDragMove = useCallback(
    (e: KonvaEventObject<DragEvent>, tableId: string) => {
      const node = e.target;
      let newX = node.x();
      let newY = node.y();

      const draggedTable = tables.find((t) => t.id === tableId);
      if (!draggedTable) return;

      const fb = getTableDimensions(draggedTable.max_covers, draggedTable.shape);
      const { w: dw, h: dh } = tableDimensionsPercentToPixels(
        draggedTable.width ?? fb.width,
        draggedTable.height ?? fb.height,
        dimensions.width,
        dimensions.height,
        draggedTable.shape,
      );

      // -- Alignment guides --
      const guides: Array<{ points: number[] }> = [];
      let snappedX = false;
      let snappedY = false;

      for (const other of tables) {
        if (other.id === tableId) continue;

        const ob = getBounds(other);
        const obLeft = ob.x - ob.w / 2;
        const obRight = ob.x + ob.w / 2;
        const obTop = ob.y - ob.h / 2;
        const obBottom = ob.y + ob.h / 2;
        const dragLeft = newX - dw / 2;
        const dragRight = newX + dw / 2;
        const dragTop = newY - dh / 2;
        const dragBottom = newY + dh / 2;

        if (!snappedX) {
          if (Math.abs(dragRight - obLeft) < 15) {
            guides.push({ points: [obLeft, Math.min(dragTop, obTop) - 10, obLeft, Math.max(dragBottom, obBottom) + 10] });
            if (alignmentGuidesEnabled) { newX = obLeft + dw / 2; }
            snappedX = true;
          } else if (Math.abs(dragLeft - obRight) < 15) {
            guides.push({ points: [obRight, Math.min(dragTop, obTop) - 10, obRight, Math.max(dragBottom, obBottom) + 10] });
            if (alignmentGuidesEnabled) { newX = obRight - dw / 2; }
            snappedX = true;
          } else if (Math.abs(newX - ob.x) < 15) {
            guides.push({ points: [ob.x, Math.min(dragTop, obTop) - 10, ob.x, Math.max(dragBottom, obBottom) + 10] });
            if (alignmentGuidesEnabled) { newX = ob.x; }
            snappedX = true;
          }
        }
        if (!snappedY) {
          if (Math.abs(dragBottom - obTop) < 15) {
            guides.push({ points: [Math.min(dragLeft, obLeft) - 10, obTop, Math.max(dragRight, obRight) + 10, obTop] });
            if (alignmentGuidesEnabled) { newY = obTop + dh / 2; }
            snappedY = true;
          } else if (Math.abs(dragTop - obBottom) < 15) {
            guides.push({ points: [Math.min(dragLeft, obLeft) - 10, obBottom, Math.max(dragRight, obRight) + 10, obBottom] });
            if (alignmentGuidesEnabled) { newY = obBottom - dh / 2; }
            snappedY = true;
          } else if (Math.abs(newY - ob.y) < 15) {
            guides.push({ points: [Math.min(dragLeft, obLeft) - 10, ob.y, Math.max(dragRight, obRight) + 10, ob.y] });
            if (alignmentGuidesEnabled) { newY = ob.y; }
            snappedY = true;
          }
        }
      }

      node.x(newX);
      node.y(newY);
      snapGuidesRef.current = guides;

      dragPosRef.current = { id: tableId, x: newX, y: newY };
      forceRender((c) => c + 1);
    },
    [tables, dimensions, getBounds, alignmentGuidesEnabled],
  );

  const handleDragEnd = useCallback(
    (e: KonvaEventObject<DragEvent>, tableId: string) => {
      const node = e.target;
      const rawX = node.x();
      const rawY = node.y();

      const finalPctX = pixelToPct(rawX, dimensions.width);
      const finalPctY = pixelToPct(rawY, dimensions.height);

      onMove(tableId, finalPctX, finalPctY);

      // Clear drag state
      dragPosRef.current = null;
      snapGuidesRef.current = [];
      forceRender((c) => c + 1);
    },
    [dimensions, onMove],
  );

  // ============================================================
  // Other handlers
  // ============================================================

  const closePolygon = useCallback(
    (pts: { x: number; y: number }[]) => {
      if (pts.length < 3 || !onPolygonCreate) {
        setPolygonDrawing({ active: false, points: [], cursorPos: null });
        return;
      }
      onPolygonCreate(pts, dimensions.width, dimensions.height);
      setPolygonDrawing({ active: false, points: [], cursorPos: null });
    },
    [onPolygonCreate, dimensions.width, dimensions.height],
  );

  const handleStageClick = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      // Polygon drawing mode
      if (polygonDrawing.active) {
        const stage = stageRef.current;
        if (!stage) return;
        const pos = stage.getRelativePointerPosition();
        if (!pos) return;
        const lx = (pos.x - stagePos.x) / scale;
        const ly = (pos.y - stagePos.y) / scale;

        const pts = polygonDrawing.points;
        const CLOSE_THRESHOLD = POLYGON_CLOSE_HIT_STAGE_PX / scale;
        const firstPt = pts[0];
        const evt = e.evt;
        const isDoubleClick =
          typeof MouseEvent !== 'undefined' &&
          evt instanceof MouseEvent &&
          typeof evt.detail === 'number' &&
          evt.detail >= 2;

        if (isDoubleClick && pts.length >= 3) {
          closePolygon(pts);
          return;
        }
        if (
          firstPt &&
          pts.length >= 3 &&
          Math.abs(lx - firstPt.x) < CLOSE_THRESHOLD &&
          Math.abs(ly - firstPt.y) < CLOSE_THRESHOLD
        ) {
          closePolygon(pts);
          return;
        }
        setPolygonDrawing((prev) => ({ ...prev, points: [...prev.points, { x: lx, y: ly }] }));
        return;
      }
      // If we just completed a marquee drag, don't deselect
      if (marqueeRef.current) return;
      if (e.target === e.target.getStage() || e.target.name() === 'panHit') onSelect(null);
    },
    [onSelect, polygonDrawing, stagePos, scale, closePolygon],
  );

  const handleStageMouseDown = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      if (!e.evt.shiftKey) return;
      const stage = stageRef.current;
      if (!stage) return;
      const target = e.target;
      const isStage = target === stage;
      const isPan = target.name() === 'panHit';
      if (!isStage && !isPan) return;
      const pos = stage.getRelativePointerPosition();
      if (!pos) return;
      const lx = (pos.x - stagePos.x) / scale;
      const ly = (pos.y - stagePos.y) / scale;
      marqueeRef.current = { active: true, startX: lx, startY: ly, currentX: lx, currentY: ly };
      e.evt.preventDefault();
    },
    [stagePos, scale],
  );

  /** Convert stage pointer to layout-local coords. */
  const pointerToLocal = useCallback((): { x: number; y: number } | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const pos = stage.getRelativePointerPosition();
    if (!pos) return null;
    return {
      x: (pos.x - stagePos.x) / scale,
      y: (pos.y - stagePos.y) / scale,
    };
  }, [stagePos, scale]);

  const flushLayoutResizeToParent = useCallback(() => {
    layoutResizeRafRef.current = null;
    const r = layoutResizeRef.current;
    const pending = layoutResizePendingRef.current;
    if (!r || !pending || !onLayoutResize) return;
    const { newW, newH } = pending;
    onLayoutResize(newW, newH, { anchor: r.anchor });
    const deltaW = newW - r.startW;
    const deltaH = newH - r.startH;
    const s = scaleRef.current;
    let nx = r.startStagePos.x;
    let ny = r.startStagePos.y;
    if (r.anchor === 'w' || r.anchor === 'nw' || r.anchor === 'sw') {
      nx -= deltaW * s;
    }
    if (r.anchor === 'n' || r.anchor === 'nw' || r.anchor === 'ne') {
      ny -= deltaH * s;
    }
    setStagePos({ x: nx, y: ny });
  }, [onLayoutResize]);

  const scheduleLayoutResizeFlush = useCallback(() => {
    if (layoutResizeRafRef.current != null) return;
    layoutResizeRafRef.current = requestAnimationFrame(() => {
      layoutResizeRafRef.current = null;
      flushLayoutResizeToParent();
    });
  }, [flushLayoutResizeToParent]);

  const endLayoutResizeGesture = useCallback(() => {
    const container = stageRef.current?.container();
    try {
      const pid = layoutResizePointerIdRef.current;
      if (container != null && pid !== undefined) {
        container.releasePointerCapture(pid);
      }
    } catch {
      /* ignore */
    }
    layoutResizePointerIdRef.current = undefined;

    if (layoutResizeRafRef.current != null) {
      cancelAnimationFrame(layoutResizeRafRef.current);
      layoutResizeRafRef.current = null;
    }
    if (layoutResizeRef.current && layoutResizePendingRef.current) {
      flushLayoutResizeToParent();
    }
    layoutResizePendingRef.current = null;
    const hadResize = layoutResizeRef.current != null;
    layoutResizeRef.current = null;
    if (hadResize) {
      onLayoutResizeEnd?.();
    }
    if (container) container.style.cursor = 'default';
  }, [flushLayoutResizeToParent, onLayoutResizeEnd]);

  const beginLayoutResize = useCallback(
    (anchor: LayoutResizeAnchor, e: KonvaEventObject<MouseEvent | TouchEvent | PointerEvent>) => {
      e.cancelBubble = true;
      const stage = stageRef.current;
      const posStage = stage?.getPointerPosition();
      if (!stage || !posStage) return;
      const W = dimensions.width;
      const H = dimensions.height;

      layoutResizeRef.current = {
        anchor,
        startW: W,
        startH: H,
        startPointerStage: { x: posStage.x, y: posStage.y },
        startStagePos: { x: stagePos.x, y: stagePos.y },
      };
      layoutResizePendingRef.current = { newW: W, newH: H };

      const onDocPointerMove = (ev: PointerEvent) => {
        const st = stageRef.current;
        const r = layoutResizeRef.current;
        if (!st || !r) return;
        const pos = st.getPointerPosition();
        if (!pos) return;
        const sc = scaleRef.current;
        const dx = (pos.x - r.startPointerStage.x) / sc;
        const dy = (pos.y - r.startPointerStage.y) / sc;
        const { newW, newH } = computeLayoutSizeFromDelta(r.anchor, r.startW, r.startH, dx, dy);
        layoutResizePendingRef.current = { newW, newH };
        scheduleLayoutResizeFlush();
        ev.preventDefault();
      };

      const onDocPointerEnd = () => {
        document.removeEventListener('pointermove', onDocPointerMove);
        document.removeEventListener('pointerup', onDocPointerEnd);
        document.removeEventListener('pointercancel', onDocPointerEnd);
        layoutResizeDocCleanupRef.current = null;
        endLayoutResizeGesture();
      };

      document.addEventListener('pointermove', onDocPointerMove, { passive: false });
      document.addEventListener('pointerup', onDocPointerEnd);
      document.addEventListener('pointercancel', onDocPointerEnd);

      layoutResizeDocCleanupRef.current = () => {
        document.removeEventListener('pointermove', onDocPointerMove);
        document.removeEventListener('pointerup', onDocPointerEnd);
        document.removeEventListener('pointercancel', onDocPointerEnd);
      };

      const pointerEv = e.evt as PointerEvent;
      layoutResizePointerIdRef.current = pointerEv.pointerId;
      try {
        const container = stageRef.current?.container();
        if (container != null && pointerEv.pointerId !== undefined) {
          container.setPointerCapture(pointerEv.pointerId);
        }
      } catch {
        /* ignore */
      }

      scheduleLayoutResizeFlush();
    },
    [dimensions.width, dimensions.height, stagePos.x, stagePos.y, scheduleLayoutResizeFlush, endLayoutResizeGesture],
  );

  const handleStagePointerMove = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      const stage = stageRef.current;
      if (!stage) return;

      if (polygonDrawing.active) {
        const local = pointerToLocal();
        if (!local) return;
        setPolygonDrawing((prev) => ({ ...prev, cursorPos: { x: local.x, y: local.y } }));
        return;
      }

      if (marqueeRef.current?.active) {
        const local = pointerToLocal();
        if (!local) return;
        marqueeRef.current = { ...marqueeRef.current, currentX: local.x, currentY: local.y };
        forceRender((c) => c + 1);
        return;
      }

      if (rotatingRef.current) {
        const local = pointerToLocal();
        if (!local) return;
        const { tableId, centerX, centerY } = rotatingRef.current;
        const angle = (Math.atan2(local.x - centerX, -(local.y - centerY)) * 180) / Math.PI;
        // Hold Shift for 1° fine rotation, otherwise snap to 15° like the slider.
        const shiftHeld =
          'shiftKey' in (e.evt as MouseEvent | TouchEvent) &&
          (e.evt as MouseEvent).shiftKey;
        const step = shiftHeld ? 1 : 15;
        let snapped = Math.round(angle / step) * step;
        snapped = ((snapped % 360) + 360) % 360;
        onRotate?.(tableId, snapped);
        e.evt.preventDefault();
      }
    },
    [onRotate, polygonDrawing.active, pointerToLocal],
  );

  const handleStageMouseUp = useCallback(() => {
    if (marqueeRef.current?.active) {
      const { startX, startY, currentX, currentY } = marqueeRef.current;
      const minX = Math.min(startX, currentX);
      const maxX = Math.max(startX, currentX);
      const minY = Math.min(startY, currentY);
      const maxY = Math.max(startY, currentY);
      if (maxX - minX > 5 || maxY - minY > 5) {
        const hit = tables.filter((t) => {
          const b = getBounds(t);
          return b.x >= minX && b.x <= maxX && b.y >= minY && b.y <= maxY;
        });
        if (hit.length > 0) onMultiSelect?.(hit.map((t) => t.id));
      }
      marqueeRef.current = null;
      forceRender((c) => c + 1);
    }
    rotatingRef.current = null;
  }, [tables, getBounds, onMultiSelect]);

  /** Scale that fits the full layout in the viewport — shown as 100% in the zoom indicator. */
  const [baselineScale, setBaselineScale] = useState(1);

  const resetView = useCallback(() => {
    const fit = computeFitFullLayoutToViewport(
      dimensions.width,
      dimensions.height,
      viewport.width,
      viewport.height,
    );
    setScale(fit.scale);
    setStagePos({ x: fit.x, y: fit.y });
    setBaselineScale(fit.scale);
  }, [dimensions.width, dimensions.height, viewport.width, viewport.height]);

  const initialFitDone = useRef(false);
  useEffect(() => {
    if (initialFitDone.current) return;
    if (dimensions.width <= 1 || viewport.width <= 1 || viewport.height <= 1) return;
    resetView();
    initialFitDone.current = true;
  }, [dimensions.width, dimensions.height, viewport.width, viewport.height, resetView]);

  const zoomBy = useCallback(
    (delta: number) => {
      const newScale = Math.max(0.3, Math.min(5, scale + delta));
      const cx = viewport.width / 2;
      const cy = viewport.height / 2;
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
    [scale, stagePos, viewport.width, viewport.height],
  );

  /** Zoom & pan so the current selection (or all tables) fits the viewport. */
  const zoomToSelection = useCallback(() => {
    const ids = selectedIds?.length ? selectedIds : (selectedId ? [selectedId] : []);
    const target = ids.length > 0
      ? tables.filter((t) => ids.includes(t.id))
      : tables;
    if (target.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of target) {
      const fb = getTableDimensions(t.max_covers, t.shape);
      const cx = pctToPixel(t.position_x, dimensions.width);
      const cy = pctToPixel(t.position_y, dimensions.height);
      const { w, h } = tableDimensionsPercentToPixels(
        t.width ?? fb.width,
        t.height ?? fb.height,
        dimensions.width,
        dimensions.height,
        t.shape,
      );
      minX = Math.min(minX, cx - w / 2);
      minY = Math.min(minY, cy - h / 2);
      maxX = Math.max(maxX, cx + w / 2);
      maxY = Math.max(maxY, cy + h / 2);
    }
    const pad = 60;
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const sx = (viewport.width - pad * 2) / bw;
    const sy = (viewport.height - pad * 2) / bh;
    const newScale = Math.max(0.3, Math.min(5, Math.min(sx, sy)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setScale(newScale);
    setStagePos({
      x: viewport.width / 2 - cx * newScale,
      y: viewport.height / 2 - cy * newScale,
    });
  }, [tables, selectedIds, selectedId, dimensions.width, dimensions.height, viewport.width, viewport.height]);

  // ============================================================
  // Computed values
  // ============================================================

  // Adjacency (for real-time seat hiding)
  const adjacency = (() => {
    const dp = dragPosRef.current;
    const bounds = tables.map((t) => {
      const fb = getTableDimensions(t.max_covers, t.shape);
      const isDrag = dp?.id === t.id;
      const { w, h } = tableDimensionsPercentToPixels(
        t.width ?? fb.width,
        t.height ?? fb.height,
        dimensions.width,
        dimensions.height,
        t.shape,
      );
      return {
        id: t.id,
        x: isDrag ? dp!.x : pctToPixel(t.position_x, dimensions.width),
        y: isDrag ? dp!.y : pctToPixel(t.position_y, dimensions.height),
        w,
        h,
      };
    });
    return computeTableAdjacency(bounds);
  })();

  // ============================================================
  // Render
  // ============================================================

  const viewW = Math.max(1, viewport.width || 800);
  const viewH = Math.max(1, viewport.height || 600);
  const panEnabled =
    !layoutResizeRef.current &&
    (spacebarPan ||
    middleMousePanRef.current ||
    (!(selectedIds?.length ?? (selectedId ? 1 : 0)) && !marqueeRef.current?.active));

  /** 100% = full layout visible (baseline), >100% zoomed in, <100% zoomed out. */
  const zoomPercent =
    baselineScale > 0 ? Math.round((scale / baselineScale) * 100) : 100;

  const unifiedLabelFonts = useMemo(() => {
    const inputs = tables.map((table) => {
      const fb = getTableDimensions(table.max_covers, table.shape);
      const { w: tw, h: th } = tableDimensionsPercentToPixels(
        table.width ?? fb.width,
        table.height ?? fb.height,
        dimensions.width,
        dimensions.height,
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
        compactLabels: false,
        layoutScale: scale,
        polygon_points: table.polygon_points ?? null,
      };
    });
    return computeGlobalUnifiedLabelFonts(inputs);
  }, [tables, dimensions.width, dimensions.height, scale]);

  return (
    <div
      ref={containerRef}
      className="min-h-0 max-h-full overflow-auto"
      style={{
        width: '100%',
        position: 'relative',
        ...(backgroundUrl
          ? {
              backgroundImage: `url(${backgroundUrl})`,
              backgroundSize: `${dimensions.width}px ${dimensions.height}px`,
              backgroundPosition: 'top left',
              backgroundRepeat: 'no-repeat',
            }
          : {}),
      }}
    >
      <div className="absolute right-2 top-2 z-10 flex gap-1">
        <button
          type="button"
          onClick={() => zoomBy(0.2)}
          className="flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-sm text-slate-600 hover:bg-slate-50"
          title="Zoom in"
          aria-label="Zoom in"
        >+</button>
        <button
          type="button"
          onClick={() => zoomBy(-0.2)}
          className="flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-sm text-slate-600 hover:bg-slate-50"
          title="Zoom out"
          aria-label="Zoom out"
        >−</button>
        <button
          type="button"
          onClick={resetView}
          className="flex h-7 min-w-[2.75rem] items-center justify-center rounded border border-slate-300 bg-white px-2 text-xs text-slate-600 hover:bg-slate-50"
          title="Fit entire layout in view"
          aria-label="Fit layout"
        >{zoomPercent}%</button>
        {((selectedIds?.length ?? 0) > 0 || !!selectedId) && (
          <button
            type="button"
            onClick={zoomToSelection}
            className="flex h-7 items-center justify-center rounded border border-brand-300 bg-brand-50 px-2 text-xs text-brand-700 hover:bg-brand-100"
            title="Zoom to selection"
            aria-label="Zoom to selection"
          >
            ⊡ Selection
          </button>
        )}
      </div>

      <Stage
        ref={(node) => { stageRef.current = node; }}
        width={viewW}
        height={viewH}
        scaleX={1}
        scaleY={1}
        x={0}
        y={0}
        onClick={handleStageClick}
        onTap={handleStageClick}
        onDblTap={(e) => {
          if (!polygonDrawing.active) return;
          const pts = polygonDrawing.points;
          if (pts.length < 3) return;
          e.cancelBubble = true;
          closePolygon(pts);
        }}
        onMouseDown={(e: KonvaEventObject<MouseEvent>) => {
          // Middle-mouse activates temporary pan
          if (e.evt.button === 1) {
            middleMousePanRef.current = true;
            forceRender((c) => c + 1);
            e.evt.preventDefault();
            return;
          }
          handleStageMouseDown(e);
        }}
        onMouseUp={(e: KonvaEventObject<MouseEvent>) => {
          if (e.evt.button === 1) {
            middleMousePanRef.current = false;
            forceRender((c) => c + 1);
            return;
          }
          handleStageMouseUp();
        }}
        onMouseMove={handleStagePointerMove}
        onTouchMove={(e) => {
          if (
            polygonDrawing.active ||
            marqueeRef.current?.active ||
            rotatingRef.current
          ) {
            if (e.evt.cancelable) e.evt.preventDefault();
          }
          handleStagePointerMove(e);
        }}
        onTouchEnd={() => {
          handleStageMouseUp();
        }}
        onTouchCancel={() => {
          handleStageMouseUp();
        }}
        onWheel={handleWheel}
        style={{
          touchAction: 'none',
          background: backgroundUrl ? 'rgba(248,250,252,0.55)' : '#f8fafc',
          cursor: marqueeRef.current?.active
            ? 'crosshair'
            : rotatingRef.current
              ? 'grabbing'
              : (spacebarPan || middleMousePanRef.current)
                ? 'grab'
                : 'default',
        }}
      >
        <Layer>
          <Group
            name="layoutGroup"
            x={stagePos.x}
            y={stagePos.y}
            scaleX={scale}
            scaleY={scale}
            draggable={panEnabled}
            onDragEnd={() => {
              const stage = stageRef.current;
              if (!stage) return;
              const g = stage.findOne((n: Konva.Node) => n.name() === 'layoutGroup');
              if (!g) return;
              setStagePos({ x: g.x(), y: g.y() });
            }}
          >
          <Rect
            name="panHit"
            x={0}
            y={0}
            width={dimensions.width}
            height={dimensions.height}
            fill="rgba(0,0,0,0.02)"
          />
          <Rect
            x={0}
            y={0}
            width={dimensions.width}
            height={dimensions.height}
            fill="rgba(248, 250, 252, 0.92)"
            stroke="#64748b"
            strokeWidth={2}
            dash={[12, 8]}
            listening={false}
          />
          {/* ---- Grid overlay ---- */}
          {showGrid && (() => {
            const step = Math.max(0.5, gridStepPct) / 100;
            const stepX = step * dimensions.width;
            const stepY = step * dimensions.height;
            const lines: React.ReactNode[] = [];
            const strokeFine = 'rgba(100,116,139,0.12)';
            const strokeMajor = 'rgba(100,116,139,0.28)';
            // Skip rendering when lines would be sub-pixel after zoom-out.
            if (stepX * scale < 3 || stepY * scale < 3) return null;
            for (let i = 1, x = stepX; x < dimensions.width; i++, x += stepX) {
              const major = i % 5 === 0;
              lines.push(
                <Line
                  key={`gx-${i}`}
                  points={[x, 0, x, dimensions.height]}
                  stroke={major ? strokeMajor : strokeFine}
                  strokeWidth={(major ? 1 : 0.75) / Math.max(scale, 0.3)}
                  listening={false}
                />,
              );
            }
            for (let i = 1, y = stepY; y < dimensions.height; i++, y += stepY) {
              const major = i % 5 === 0;
              lines.push(
                <Line
                  key={`gy-${i}`}
                  points={[0, y, dimensions.width, y]}
                  stroke={major ? strokeMajor : strokeFine}
                  strokeWidth={(major ? 1 : 0.75) / Math.max(scale, 0.3)}
                  listening={false}
                />,
              );
            }
            return <Group listening={false}>{lines}</Group>;
          })()}
          {/* ---- Tables ---- */}
          {tables.map((table) => {
            const isDragging = dragPosRef.current?.id === table.id;
            const isSelected = (selectedIds ?? []).includes(table.id) || table.id === selectedId;
            const color = getZoneColor(table.zone);
            const blocked = adjacency.get(table.id);
            const hidden = blockedToHiddenSet(blocked);

            return (
              <TableShape
                key={table.id}
                table={table}
                hiddenSides={hidden}
                isSelected={isSelected}
                isEditorMode
                statusColour={color}
                booking={null}
                canvasWidth={dimensions.width}
                canvasHeight={dimensions.height}
                overrideX={isDragging ? dragPosRef.current!.x : undefined}
                overrideY={isDragging ? dragPosRef.current!.y : undefined}
                onDragStart={(e) => {
                  const native = e.evt as DragEvent & { altKey?: boolean };
                  if (native?.altKey && onAltDragDuplicate) {
                    onAltDragDuplicate(table.id);
                  }
                }}
                onDragMove={(e) => handleDragMove(e, table.id)}
                onDragEnd={(e) => handleDragEnd(e, table.id)}
                onClick={(e) => onSelect(table.id, e.evt.shiftKey)}
                onTap={() => onSelect(table.id, false)}
                layoutScale={scale}
                unifiedLabelFonts={unifiedLabelFonts}
                seatAngles={table.seat_angles}
                onSeatDrag={onSeatDrag ? (seatIndex, newAngle) => {
                  onSeatDrag(table.id, seatIndex, newAngle);
                } : undefined}
                onSeatDragEnd={onSeatDragEnd ? (seatIndex, newAngle) => {
                  onSeatDragEnd(table.id, seatIndex, newAngle);
                } : undefined}
                onResizeHandleDrag={(axis, halfPx) => {
                  const t = tables.find((tb) => tb.id === table.id);
                  if (!t) return;
                  const fallback = getTableDimensions(t.max_covers, t.shape);
                  const curW = t.width ?? fallback.width;
                  const curH = t.height ?? fallback.height;
                  const newPct = (halfPx * 2) / (axis === 'x' ? dimensions.width : dimensions.height) * 100;
                  const clamped = Math.max(3, Math.min(25, newPct));
                  onResize(
                    table.id,
                    axis === 'x' ? clamped : (t.shape === 'circle' ? clamped : curW),
                    axis === 'y' ? clamped : (t.shape === 'circle' ? clamped : curH),
                  );
                }}
                onResizeHandleEnd={() => { /* finalisation handled on next state write */ }}
                onRectResize={(widthPct, heightPct) => {
                  onResize(table.id, widthPct, heightPct);
                }}
                onRectResizeEnd={() => { /* parent savePositions already debounced */ }}
                onPolygonVertexDrag={
                  onPolygonVertexDrag
                    ? (vertexIndex, localX, localY) =>
                        onPolygonVertexDrag(table.id, vertexIndex, localX, localY)
                    : undefined
                }
                onPolygonVertexDragEnd={onPolygonVertexDragEnd}
              />
            );
          })}

          {/* ---- Combination link lines (manual combinations; hidden on embedded Layout tab) ---- */}
          {showCombinationLinkLines &&
            (combinationLinks ?? []).map((combo) => {
            const pts: number[] = [];
            for (const tid of combo.tableIds) {
              const t = tables.find((tb) => tb.id === tid);
              if (!t) continue;
              const dp = dragPosRef.current;
              const isDrag = dp?.id === tid;
              pts.push(isDrag ? dp!.x : pctToPixel(t.position_x, dimensions.width));
              pts.push(isDrag ? dp!.y : pctToPixel(t.position_y, dimensions.height));
            }
            if (pts.length < 4) return null;
            return (
              <Line
                key={`combo-${combo.id}`}
                points={pts}
                stroke="#8b5cf6"
                strokeWidth={2.5}
                dash={[6, 4]}
                opacity={0.6}
              />
            );
          })}

          {/* ---- Alignment guides ---- */}
          {snapGuidesRef.current.map((guide, i) => (
            <Line
              key={`guide-${i}`}
              points={guide.points}
              stroke="#3b82f6"
              strokeWidth={1}
              dash={[4, 4]}
            />
          ))}

          {/* ---- Rotation handle (single selected table in editor) ---- */}
          {(() => {
            if (!selectedId || !onRotate) return null;
            const t = tables.find((tb) => tb.id === selectedId);
            if (!t) return null;
            const b = getBounds(t);
            const HANDLE_OFFSET = 24;
            const halfH = b.h / 2;
            const θ = ((t.rotation ?? 0) * Math.PI) / 180;
            const hx = b.x + (halfH + HANDLE_OFFSET) * Math.sin(θ);
            const hy = b.y - (halfH + HANDLE_OFFSET) * Math.cos(θ);
            return (
              <Group key="rotation-handle">
                {/* Line from table center to handle */}
                <Line points={[b.x, b.y, hx, hy]} stroke="#2563eb" strokeWidth={1} opacity={0.5} listening={false} />
                {/* Handle dot */}
                <Circle
                  x={hx}
                  y={hy}
                  radius={7}
                  fill="#2563eb"
                  stroke="#ffffff"
                  strokeWidth={2}
                  shadowColor="rgba(0,0,0,0.25)"
                  shadowBlur={4}
                  onMouseDown={(e: KonvaEventObject<MouseEvent>) => {
                    e.cancelBubble = true;
                    rotatingRef.current = { tableId: t.id, centerX: b.x, centerY: b.y };
                    e.evt.preventDefault();
                  }}
                  onTouchStart={(e) => {
                    e.cancelBubble = true;
                    rotatingRef.current = { tableId: t.id, centerX: b.x, centerY: b.y };
                  }}
                  hitStrokeWidth={22}
                  style={{ cursor: 'grab' } as React.CSSProperties}
                />
              </Group>
            );
          })()}

          {/* ---- Marquee selection rectangle ---- */}
          {marqueeRef.current?.active && (() => {
            const m = marqueeRef.current!;
            const x = Math.min(m.startX, m.currentX);
            const y = Math.min(m.startY, m.currentY);
            const w = Math.abs(m.currentX - m.startX);
            const h = Math.abs(m.currentY - m.startY);
            return (
              <Rect
                x={x}
                y={y}
                width={w}
                height={h}
                fill="rgba(37,99,235,0.06)"
                stroke="#2563eb"
                strokeWidth={1}
                dash={[4, 3]}
                listening={false}
              />
            );
          })()}

          {/* ---- Polygon drawing overlay ---- */}
          {polygonDrawing.active && (() => {
            const pts = polygonDrawing.points;
            const cursor = polygonDrawing.cursorPos;
            if (pts.length === 0) return null;

            // Flatten all points + cursor for the in-progress polyline
            const polyPts = pts.flatMap((p) => [p.x, p.y]);
            if (cursor) polyPts.push(cursor.x, cursor.y);

            const CLOSE_THRESHOLD = POLYGON_CLOSE_HIT_STAGE_PX / scale;
            const isNearFirst = cursor && pts.length >= 3 &&
              Math.abs(cursor.x - pts[0]!.x) < CLOSE_THRESHOLD &&
              Math.abs(cursor.y - pts[0]!.y) < CLOSE_THRESHOLD;

            return (
              <Group listening={false}>
                {/* Filled polygon preview */}
                {pts.length >= 3 && (
                  <Line
                    points={pts.flatMap((p) => [p.x, p.y])}
                    closed
                    fill="rgba(37,99,235,0.07)"
                    stroke="transparent"
                    strokeWidth={0}
                    listening={false}
                  />
                )}
                {/* In-progress polyline */}
                <Line
                  points={polyPts}
                  stroke="#2563eb"
                  strokeWidth={1.5 / scale}
                  dash={[6 / scale, 3 / scale]}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                />
                {/* Placed vertex dots */}
                {pts.map((p, i) => (
                  <Circle
                    key={`poly-pt-${i}`}
                    x={p.x}
                    y={p.y}
                    radius={(i === 0 && pts.length >= 3 ? 11 : 8) / scale}
                    fill={i === 0 && pts.length >= 3 ? '#2563eb' : '#ffffff'}
                    stroke="#2563eb"
                    strokeWidth={1.5 / scale}
                    listening={false}
                    opacity={i === 0 && isNearFirst ? 0.6 : 1}
                  />
                ))}
                {/* Snap-to-close indicator */}
                {isNearFirst && (
                  <Circle
                    x={pts[0]!.x}
                    y={pts[0]!.y}
                    radius={18 / scale}
                    stroke="#2563eb"
                    strokeWidth={1.5 / scale}
                    fill="rgba(37,99,235,0.1)"
                    listening={false}
                    dash={[3 / scale, 2 / scale]}
                  />
                )}
              </Group>
            );
          })()}

          {/* ---- Layout resize: non-draggable edge/corner hit areas ---- */}
          {onLayoutResize && (() => {
            const hSize = 14;
            const edgeHit = 16;
            const W = dimensions.width;
            const H = dimensions.height;
            const isResizing = layoutResizeRef.current != null;

            const setCur = (c: string) => {
              if (isResizing) return;
              const container = stageRef.current?.container();
              if (container) container.style.cursor = c;
            };

            const edges: Array<{
              anchor: LayoutResizeAnchor;
              x: number; y: number; w: number; h: number;
              cursor: string;
            }> = [
              { anchor: 'w',  x: -edgeHit / 2,      y: hSize,            w: edgeHit, h: H - hSize * 2, cursor: 'ew-resize' },
              { anchor: 'e',  x: W - edgeHit / 2,    y: hSize,            w: edgeHit, h: H - hSize * 2, cursor: 'ew-resize' },
              { anchor: 'n',  x: hSize,              y: -edgeHit / 2,     w: W - hSize * 2, h: edgeHit, cursor: 'ns-resize' },
              { anchor: 's',  x: hSize,              y: H - edgeHit / 2,  w: W - hSize * 2, h: edgeHit, cursor: 'ns-resize' },
            ];
            const corners: Array<{
              anchor: LayoutResizeAnchor;
              x: number; y: number;
              cursor: string;
            }> = [
              { anchor: 'nw', x: -hSize,      y: -hSize,      cursor: 'nwse-resize' },
              { anchor: 'ne', x: W - hSize,   y: -hSize,      cursor: 'nesw-resize' },
              { anchor: 'sw', x: -hSize,      y: H - hSize,   cursor: 'nesw-resize' },
              { anchor: 'se', x: W - hSize,   y: H - hSize,   cursor: 'nwse-resize' },
            ];

            return (
              <>
                {edges.map((ed) => (
                  <Rect
                    key={`resize-edge-${ed.anchor}`}
                    x={ed.x}
                    y={ed.y}
                    width={ed.w}
                    height={ed.h}
                    fill="transparent"
                    hitStrokeWidth={edgeHit}
                    onMouseEnter={() => setCur(ed.cursor)}
                    onMouseLeave={() => setCur('default')}
                    onMouseDown={(e) => beginLayoutResize(ed.anchor, e)}
                    onTouchStart={(e) => beginLayoutResize(ed.anchor, e)}
                  />
                ))}
                {corners.map((cr) => (
                  <Rect
                    key={`resize-corner-${cr.anchor}`}
                    x={cr.x}
                    y={cr.y}
                    width={hSize}
                    height={hSize}
                    fill="#3b82f6"
                    cornerRadius={2}
                    opacity={0.85}
                    hitStrokeWidth={12}
                    onMouseEnter={() => setCur(cr.cursor)}
                    onMouseLeave={() => setCur('default')}
                    onMouseDown={(e) => beginLayoutResize(cr.anchor, e)}
                    onTouchStart={(e) => beginLayoutResize(cr.anchor, e)}
                  />
                ))}
                <Line
                  points={[W - 10, H - 3, W - 3, H - 10]}
                  stroke="#dbeafe"
                  strokeWidth={1.5}
                  lineCap="round"
                  listening={false}
                />
              </>
            );
          })()}
          </Group>
        </Layer>
      </Stage>

      {/* ---- Polygon drawing hint bar ---- */}
      {polygonDrawing.active && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 z-20 max-w-[min(100vw-1rem,28rem)] -translate-x-1/2 px-2">
          <div className="rounded-lg bg-slate-900/90 px-3 py-1.5 text-xs text-white shadow-lg flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
            <span className="opacity-70 text-center">
              Tap to add points · double-tap or tap first point to close
            </span>
            <span className="opacity-30 hidden sm:inline">·</span>
            <button
              type="button"
              className="pointer-events-auto rounded bg-blue-500 px-2 py-0.5 font-medium text-white opacity-95 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={polygonDrawing.points.length < 3}
              onClick={() => closePolygon(polygonDrawing.points)}
            >
              Done
            </button>
            <button
              type="button"
              className="pointer-events-auto underline opacity-90 hover:opacity-100"
              onClick={() => setPolygonDrawing({ active: false, points: [], cursorPos: null })}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
