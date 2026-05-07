'use client';

import React, { useMemo } from 'react';
import { Group, Rect, Circle, Ellipse, Text, Line, Arc } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import {
  getTableDimensions,
  tableDimensionsPercentToPixels,
  tablePixelDimensionsToPercent,
} from '@/types/table-management';
import { calculateSeatPositions } from '@/lib/floor-plan/seat-positions';
import {
  computeBestPolygonLabelBand,
  computeInnerLabelWidthRounded,
  computeFittedTableLabelFonts,
  type TableLabelFitResult,
} from '@/lib/floor-plan/table-label-fonts';

/** ~30% larger chair markers (seat rects) around the table vs prior defaults. */
const SEAT_MARKER_SCALE = 1.3;
/** Extra scale on chair-marker rect width and length only (after radius-derived base). */
const SEAT_RECT_WL_SCALE = 1.4;
const SEAT_DOT_RADIUS = 9 * SEAT_MARKER_SCALE;
const SEAT_DOT_OFFSET = 14 * SEAT_MARKER_SCALE;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal table data needed for rendering. */
export interface TableRenderData {
  name: string;
  min_covers: number;
  max_covers: number;
  shape: string;
  position_x: number | null;
  position_y: number | null;
  width: number | null;
  height: number | null;
  rotation: number | null;
  polygon_points?: { x: number; y: number }[] | null;
  is_temporary?: boolean;
}

export interface BookingInfo {
  id: string;
  guest_name: string;
  party_size: number;
  /** Live floor: booking status label (e.g. Seated). */
  status?: string;
  /** Live floor: HH:mm start. */
  start_time?: string;
}

export interface TableShapeProps {
  table: TableRenderData;
  hiddenSides: Set<string>;
  isSelected: boolean;
  isEditorMode: boolean;
  statusColour: string;
  booking: BookingInfo | null;
  canvasWidth: number;
  canvasHeight: number;
  /**
   * Booking mini floor plan: both name and capacity are inset and vertically centred
   * inside the table so labels stay within the shape at small scales.
   */
  compactLabels?: boolean;
  /** Hide chair markers in small/read-only previews where table geometry is the important signal. */
  showSeats?: boolean;
  /** Whole-table opacity (e.g. drag ghost on live floor). */
  groupOpacity?: number;
  /** Live floor: keep the table name visible even when the primary label is the booking guest. */
  showTableNameBadge?: boolean;
  /** Live floor: keep table name as the primary in-table label; booking guest becomes secondary. */
  alwaysShowTableName?: boolean;
  /**
   * Parent canvas zoom (0–1 = layout zoomed out). Used to scale up labels/seats
   * on screen when the layout is zoomed out so text stays readable, while the
   * shrink loop and clip keep content inside each table.
   */
  layoutScale?: number;
  /** Override the computed pixel position during drag. */
  overrideX?: number;
  overrideY?: number;
  onDragStart?: (e: KonvaEventObject<DragEvent>) => void;
  onDragEnd?: (e: KonvaEventObject<DragEvent>) => void;
  onDragMove?: (e: KonvaEventObject<DragEvent>) => void;
  onClick?: (e: KonvaEventObject<MouseEvent>) => void;
  onTap?: (e: KonvaEventObject<TouchEvent>) => void;
  /**
   * Called while dragging a resize handle on oval/circle tables.
   * axis: 'x' for horizontal (width), 'y' for vertical (height).
   * halfPixels: distance from table centre to handle in pixels.
   */
  onResizeHandleDrag?: (axis: 'x' | 'y', halfPixels: number) => void;
  /** Called when a resize handle drag ends (for final save). */
  onResizeHandleEnd?: () => void;
  /**
   * Called while dragging a corner of a rectangle / square / polygon table.
   * Emits full width & height simultaneously (as a percentage of the canvas)
   * so W and H don't fight over state.
   */
  onRectResize?: (widthPct: number, heightPct: number) => void;
  /** Called when rectangle corner resize ends (for final save). */
  onRectResizeEnd?: () => void;
  /**
   * Custom seat angle overrides per seat index (radians). null = use computed.
   */
  seatAngles?: (number | null)[] | null;
  /** Called when a seat dot is dragged to a new position in editor mode. */
  onSeatDrag?: (seatIndex: number, newAngle: number) => void;
  /** Called when seat drag ends (for save). */
  onSeatDragEnd?: (seatIndex: number, newAngle: number) => void;
  /**
   * When set (e.g. floor-wide minimum from the parent canvas), all tables use these
   * font sizes so labels match the tightest table on the plan.
   */
  unifiedLabelFonts?: TableLabelFitResult | null;
  /** Editor: drag a polygon vertex (table-local unrotated pixels) to reshape the custom table. */
  onPolygonVertexDrag?: (vertexIndex: number, localX: number, localY: number) => void;
  onPolygonVertexDragEnd?: () => void;
  /**
   * Live floor: progress through the booking window (0 = start, 100 = planned end). Values &gt; 100 = overdue.
   * Renders a small corner ring; omit for empty tables.
   */
  turnProgressPct?: number | null;
  /** Live floor: booking spans multiple tables (combination). */
  comboTableCount?: number;
  children?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

function lightenHex(hex: string, amount = 0.85): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return `rgb(${Math.round(r + (255 - r) * amount)},${Math.round(g + (255 - g) * amount)},${Math.round(b + (255 - b) * amount)})`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function truncateForWidth(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return '…';
  return `${text.slice(0, maxChars - 1)}…`;
}

function darkenHex(hex: string, amount = 0.15): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return `rgb(${Math.round(r * (1 - amount))},${Math.round(g * (1 - amount))},${Math.round(b * (1 - amount))})`;
}

function rectangleBoundaryPoint(angle: number, halfW: number, halfH: number): { x: number; y: number } {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const tx = Math.abs(cosA) > 1e-6 ? halfW / Math.abs(cosA) : Number.POSITIVE_INFINITY;
  const ty = Math.abs(sinA) > 1e-6 ? halfH / Math.abs(sinA) : Number.POSITIVE_INFINITY;
  const t = Math.min(tx, ty);
  return { x: cosA * t, y: sinA * t };
}

function rayPolygonIntersection(
  angle: number,
  points: { x: number; y: number }[],
): { x: number; y: number; edgeTangentRad: number } | null {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let bestT = Number.POSITIVE_INFINITY;
  let hit: { x: number; y: number; edgeTangentRad: number } | null = null;

  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const det = dx * ey - dy * ex;
    if (Math.abs(det) < 1e-8) continue;

    const ax = a.x;
    const ay = a.y;
    const t = (ax * ey - ay * ex) / det;
    const u = (ax * dy - ay * dx) / det;
    if (t > 0 && u >= 0 && u <= 1 && t < bestT) {
      bestT = t;
      const edgeTangentRad = Math.atan2(ey, ex);
      hit = { x: dx * t, y: dy * t, edgeTangentRad };
    }
  }

  return hit;
}

/** Ellipse (rx, ry) parametric tangent at angle t — parallel to the local table edge. */
function ellipseParametricTangentRad(t: number, rx: number, ry: number): number {
  return Math.atan2(ry * Math.cos(t), -rx * Math.sin(t));
}

/** Which rectangle edge a boundary point lies on → tangent along that edge. */
function rectangleEdgeTangentAtBoundaryPoint(
  bx: number,
  by: number,
  halfW: number,
  halfH: number,
): number {
  const distTop = Math.abs(by + halfH);
  const distBottom = Math.abs(by - halfH);
  const distLeft = Math.abs(bx + halfW);
  const distRight = Math.abs(bx - halfW);
  const m = Math.min(distTop, distBottom, distLeft, distRight);
  if (m === distTop) return 0;
  if (m === distBottom) return Math.PI;
  if (m === distRight) return Math.PI / 2;
  return -Math.PI / 2;
}

/**
 * Konva Rect uses height as the long axis along local +Y; rotate so that axis
 * aligns with edgeTangentRad (parallel to the table side).
 */
function konvaSeatBackRotationDeg(edgeTangentRad: number): number {
  return ((edgeTangentRad - Math.PI / 2) * 180) / Math.PI;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TableShape({
  table,
  hiddenSides,
  isSelected,
  isEditorMode,
  statusColour,
  booking,
  canvasWidth,
  canvasHeight,
  compactLabels = false,
  showSeats = true,
  groupOpacity = 1,
  showTableNameBadge = false,
  alwaysShowTableName = false,
  layoutScale,
  overrideX,
  overrideY,
  onDragStart,
  onDragEnd,
  onDragMove,
  onClick,
  onTap,
  onResizeHandleDrag,
  onResizeHandleEnd,
  onRectResize,
  onRectResizeEnd,
  seatAngles,
  onSeatDrag,
  onSeatDragEnd,
  unifiedLabelFonts,
  onPolygonVertexDrag,
  onPolygonVertexDragEnd,
  turnProgressPct = null,
  comboTableCount = 0,
  children,
}: TableShapeProps) {
  // --- Geometry ---
  const fallback = getTableDimensions(table.max_covers, table.shape);
  const x =
    overrideX ??
    (table.position_x != null
      ? (table.position_x / 100) * canvasWidth
      : canvasWidth / 2);
  const y =
    overrideY ??
    (table.position_y != null
      ? (table.position_y / 100) * canvasHeight
      : canvasHeight / 2);
  const { w, h } = tableDimensionsPercentToPixels(
    table.width ?? fallback.width,
    table.height ?? fallback.height,
    canvasWidth,
    canvasHeight,
    table.shape,
  );

  const isOccupied = !isEditorMode && booking != null;

  const isCircular = table.shape === 'circle';
  const isOval = table.shape === 'oval';
  const isPolygon = table.shape === 'polygon';

  // Normalised polygon points → pixel coords relative to table centre (must come before useMemo)
  const polygonPixelPts = isPolygon && table.polygon_points
    ? table.polygon_points.map((pt) => ({
        x: (pt.x / 100 - 0.5) * w,
        y: (pt.y / 100 - 0.5) * h,
      }))
    : null;
  const polygonFlatPts = polygonPixelPts ? polygonPixelPts.flatMap((p) => [p.x, p.y]) : null;

  // Stabilise the Set dependency for useMemo
  const hiddenKey = useMemo(
    () => Array.from(hiddenSides).sort().join(','),
    [hiddenSides],
  );

  // Stable polygon key for useMemo dependency
  const polygonKey = useMemo(
    () => (table.polygon_points ? JSON.stringify(table.polygon_points) : ''),
    [table.polygon_points],
  );

  const seats = useMemo(
    () =>
      calculateSeatPositions(
        table.shape,
        w,
        h,
        table.max_covers,
        hiddenSides.size > 0 ? hiddenSides : undefined,
        polygonPixelPts ?? undefined,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table.shape, w, h, table.max_covers, hiddenKey, polygonKey],
  );

  // --- Appearance ---
  const fill = isEditorMode ? '#ffffff' : lightenHex(statusColour, 0.88);
  const stroke = isSelected ? '#2563eb' : statusColour;
  const strokeWidth = isSelected ? 2.5 : 1.5;

  const capacityText =
    table.min_covers === table.max_covers
      ? `${table.max_covers}`
      : `${table.min_covers}-${table.max_covers}`;
  const topLabel = alwaysShowTableName || !isOccupied
    ? table.name
    : booking!.guest_name.slice(0, 12);
  const shortStatus = booking?.status ? booking.status.replace(/-/g, ' ').slice(0, 10) : '';
  const timeBit = booking?.start_time ? booking.start_time.slice(0, 5) : '';
  const bottomLabel = alwaysShowTableName
    ? isOccupied
      ? [
          truncateForWidth(booking!.guest_name, 12),
          [timeBit, `${booking!.party_size}/${table.max_covers}`].filter(Boolean).join(' · '),
          [shortStatus || null, comboTableCount > 1 ? 'Combo' : null].filter(Boolean).join(' · '),
        ]
          .filter((p): p is string => Boolean(p))
          .join('\n')
      : ''
    : isOccupied
      ? `${booking!.party_size} pax`
      : capacityText;
  const hasBottomLabel = bottomLabel.trim().length > 0;
  const liveFloorLabelBoost = !compactLabels && !isEditorMode && alwaysShowTableName ? 1.24 : 1;
  const liveFloorTableNameMin = !compactLabels && !isEditorMode && alwaysShowTableName ? 14 : 0;
  const liveFloorInfoMin = !compactLabels && !isEditorMode && alwaysShowTableName && isOccupied ? 12 : 0;

  const HANDLE = 6;
  /** Screen-space targets: grow when zoomed out so corners stay easy to grab (desktop + touch). */
  const layoutScaleSafe = layoutScale != null && layoutScale > 0 ? layoutScale : 1;
  /** ~40% smaller than the prior default while preserving zoom-aware scaling. */
  const POLY_VERTEX_SCALE = 0.6;
  const polyVertexRadius =
    POLY_VERTEX_SCALE * Math.max(10, 16 / Math.max(layoutScaleSafe, 0.14));
  const polyVertexHitStroke =
    POLY_VERTEX_SCALE * Math.max(28, 44 / Math.max(layoutScaleSafe, 0.14));

  const minDim = Math.min(w, h);
  const polyVert =
    isPolygon && polygonPixelPts && polygonPixelPts.length >= 3
      ? {
          top: Math.min(...polygonPixelPts.map((p) => p.y)),
          bottom: Math.max(...polygonPixelPts.map((p) => p.y)),
        }
      : null;
  const topEdge = isCircular ? -Math.min(w, h) / 2 : polyVert ? polyVert.top : -h / 2;
  const bottomEdge = isCircular ? Math.min(w, h) / 2 : polyVert ? polyVert.bottom : h / 2;

  /** Single-line box height for Konva Text (bold needs extra headroom vs raw fontSize). */
  const compactLineBox = (fs: number, bold: boolean) =>
    Math.ceil(fs * (bold ? 1.32 : 1.24)) + 2;

  let fontName: number;
  let fontCap: number;
  let displayName: string;
  let displayCap: string;
  let nameY: number;
  let capY: number;
  let nameLineH: number;
  let innerW: number;
  let textX: number;
  let labelBlockCenterY: number;
  let nameFill: string;
  let capFill: string;
  let compactTextStroke: string | undefined;
  let compactTextStrokeW: number;

  let capLineH = 0;

  if (compactLabels) {
    const insetXLocal = clamp(w * 0.03, 1, 6);
    const fit =
      unifiedLabelFonts ??
      computeFittedTableLabelFonts({
        w,
        h,
        shape: table.shape,
        topLabel,
        bottomLabel,
        compactLabels: true,
        layoutScale,
        polygon_points: table.polygon_points ?? null,
      });
    const fn = fit.fontName;
    const fc = fit.fontCap;
    const gap = fit.gap;

    const measureBlock = (nameFs: number, capFs: number, g: number) => {
      const nh = nameFs + 1;
      const ch = hasBottomLabel ? capFs + 1 : 0;
      const bottomLines = Math.max(1, bottomLabel.split('\n').length);
      return { blockH: nh + (hasBottomLabel ? g + ch * bottomLines : 0), nameBox: nh, capBox: ch * bottomLines };
    };

    const { blockH, nameBox, capBox } = measureBlock(fn, fc, gap);
    const polygonBand =
      isPolygon && polygonPixelPts && polygonPixelPts.length >= 3
        ? computeBestPolygonLabelBand({
            polygonPixelPts,
            labelHalfHeight: blockH / 2,
            insetXLocal,
            curveInsetFactor: 0.97,
          })
        : null;
    const computedInnerW = computeInnerLabelWidthRounded({
      w,
      h,
      insetXLocal,
      isCircular,
      isOval,
      labelHalfHeight: blockH / 2,
      curveInsetFactor: 0.97,
      polygonPixelPts: isPolygon ? polygonPixelPts : null,
    });

    fontName = fn;
    fontCap = fc;
    nameLineH = nameBox;
    capLineH = capBox;

    innerW = computedInnerW;
    textX = -innerW / 2;

    const nm = Math.max(3, Math.floor(innerW / (fontName * 0.5)));
    const cm = Math.max(2, Math.floor(innerW / (fontCap * 0.5)));
    displayName = truncateForWidth(topLabel, nm);
    displayCap = truncateForWidth(bottomLabel, cm);

    /* Keep polygon labels centered in the largest contiguous interior band. */
    const startY = polygonBand ? polygonBand.centerY - blockH / 2 : -blockH / 2;
    nameY = startY;
    capY = hasBottomLabel ? nameY + nameLineH + gap : nameY + nameLineH;
    labelBlockCenterY = nameY + blockH / 2;

    nameFill = '#000000';
    capFill = '#000000';
    compactTextStroke = undefined;
    compactTextStrokeW = 0;
  } else {
    /* Edit + live floor: same centred block as compact picker, larger type & tighter leading. */
    const insetY = clamp(minDim * 0.032, 2, 6);
    const insetXLocal = clamp(w * 0.032, 2, 7);
    const innerTop = topEdge + insetY;
    const innerBottom = bottomEdge - insetY;
    const innerH = Math.max(0, innerBottom - innerTop);

    const fit =
      unifiedLabelFonts ??
      computeFittedTableLabelFonts({
        w,
        h,
        shape: table.shape,
        topLabel,
        bottomLabel,
        compactLabels: false,
        layoutScale,
        polygon_points: table.polygon_points ?? null,
      });
    const fn = fit.fontName;
    const fc = fit.fontCap;
    const gap = fit.gap;

    const measureBlock = (nameFs: number, capFs: number, g: number) => {
      const nh = compactLineBox(nameFs, true);
      const ch = hasBottomLabel ? compactLineBox(capFs, false) : 0;
      return { blockH: nh + (hasBottomLabel ? g + ch : 0), nameBox: nh, capBox: ch };
    };

    const { blockH, capBox } = measureBlock(fn, fc, gap);
    const polygonBand =
      isPolygon && polygonPixelPts && polygonPixelPts.length >= 3
        ? computeBestPolygonLabelBand({
            polygonPixelPts,
            labelHalfHeight: blockH / 2,
            insetXLocal,
            curveInsetFactor: 0.97,
          })
        : null;
    const computedInnerW = computeInnerLabelWidthRounded({
      w,
      h,
      insetXLocal,
      isCircular,
      isOval,
      labelHalfHeight: blockH / 2,
      curveInsetFactor: 0.97,
      polygonPixelPts: isPolygon ? polygonPixelPts : null,
    });

    fontName = Math.max(liveFloorTableNameMin, Math.round(fn * liveFloorLabelBoost));
    fontCap = Math.max(liveFloorInfoMin, Math.round(fc * liveFloorLabelBoost));
    nameLineH = compactLineBox(fontName, true);
    capLineH = hasBottomLabel ? compactLineBox(fontCap, false) : capBox;

    innerW = computedInnerW;
    textX = -innerW / 2;

    const nm = Math.max(3, Math.floor(innerW / (fontName * 0.52)));
    const cm = Math.max(2, Math.floor(innerW / (fontCap * 0.52)));
    displayName = truncateForWidth(topLabel, nm);
    displayCap = truncateForWidth(bottomLabel, cm);

    const blockStart = polygonBand
      ? clamp(
          polygonBand.centerY - blockH / 2,
          innerTop,
          Math.max(innerTop, innerBottom - blockH),
        )
      : (() => {
          const opticalUp = Math.min(2, Math.max(0, minDim * 0.01));
          const centred = innerTop + Math.max(0, (innerH - blockH) / 2);
          const rawStart = centred - opticalUp;
          return clamp(rawStart, innerTop, Math.max(innerTop, innerBottom - blockH));
        })();
    nameY = blockStart;
    capY = hasBottomLabel ? blockStart + nameLineH + gap : blockStart + nameLineH;
    labelBlockCenterY = blockStart + blockH / 2;

    nameFill = isOccupied ? '#1e293b' : '#334155';
    capFill = isOccupied ? '#64748b' : '#94a3b8';
    compactTextStroke = undefined;
    compactTextStrokeW = 0;
  }

  /** Keeps name/capacity horizontal on screen while the table Group still rotates the shape. */
  const labelScreenRotationDeg = -(table.rotation ?? 0);

  return (
    <Group
      x={x}
      y={y}
      opacity={groupOpacity}
      rotation={table.rotation ?? 0}
      draggable={isEditorMode}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragMove={onDragMove}
      onClick={onClick}
      onTap={onTap}
    >
      {/* ---- Table body ---- */}
      {isCircular ? (
        <Circle
          radius={Math.min(w, h) / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          shadowColor="rgba(0,0,0,0.15)"
          shadowBlur={4}
          shadowOffsetY={1}
        />
      ) : isOval ? (
        <Ellipse
          radiusX={w / 2}
          radiusY={h / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          shadowColor="rgba(0,0,0,0.15)"
          shadowBlur={4}
          shadowOffsetY={1}
        />
      ) : isPolygon && polygonFlatPts && polygonFlatPts.length >= 6 ? (
        <Line
          points={polygonFlatPts}
          closed
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          shadowColor="rgba(0,0,0,0.15)"
          shadowBlur={4}
          shadowOffsetY={1}
          lineJoin="round"
        />
      ) : (
        <Rect
          x={-w / 2}
          y={-h / 2}
          width={w}
          height={h}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          cornerRadius={8}
          shadowColor="rgba(0,0,0,0.15)"
          shadowBlur={4}
          shadowOffsetY={1}
        />
      )}

      {/* ---- Seat dots (subdued in compact picker so centred labels stay legible) ---- */}
      {showSeats && (
      <Group opacity={compactLabels ? 0.35 : 1}>
        {seats.map((seat, i) => {
          // Apply custom angle override if provided
          const overrideAngle = seatAngles?.[i] ?? null;
          const effectiveAngle = overrideAngle ?? seat.angle;

          // For custom angles, project to the actual shape boundary then offset outward.
          let dotX: number;
          let dotY: number;
          let edgeTangentRad: number;
          if (overrideAngle != null) {
            let edgeX: number;
            let edgeY: number;

            if (isCircular || isOval) {
              const rX = isCircular ? Math.min(w, h) / 2 : w / 2;
              const rY = isCircular ? Math.min(w, h) / 2 : h / 2;
              edgeX = rX * Math.cos(overrideAngle);
              edgeY = rY * Math.sin(overrideAngle);
              edgeTangentRad = ellipseParametricTangentRad(overrideAngle, rX, rY);
            } else if (isPolygon && polygonPixelPts && polygonPixelPts.length >= 3) {
              const hit = rayPolygonIntersection(overrideAngle, polygonPixelPts);
              if (hit) {
                edgeX = hit.x;
                edgeY = hit.y;
                edgeTangentRad = hit.edgeTangentRad;
              } else {
                const fallback = rectangleBoundaryPoint(overrideAngle, w / 2, h / 2);
                edgeX = fallback.x;
                edgeY = fallback.y;
                edgeTangentRad = rectangleEdgeTangentAtBoundaryPoint(
                  fallback.x,
                  fallback.y,
                  w / 2,
                  h / 2,
                );
              }
            } else {
              const edge = rectangleBoundaryPoint(overrideAngle, w / 2, h / 2);
              edgeX = edge.x;
              edgeY = edge.y;
              edgeTangentRad = rectangleEdgeTangentAtBoundaryPoint(edge.x, edge.y, w / 2, h / 2);
            }

            dotX = edgeX + SEAT_DOT_OFFSET * Math.cos(overrideAngle);
            dotY = edgeY + SEAT_DOT_OFFSET * Math.sin(overrideAngle);
          } else {
            dotX = seat.x + SEAT_DOT_OFFSET * Math.cos(effectiveAngle);
            dotY = seat.y + SEAT_DOT_OFFSET * Math.sin(effectiveAngle);
            edgeTangentRad = seat.edgeTangentRad;
          }

          const isFilled = isOccupied && i < booking!.party_size;
          const seatRadius = compactLabels
            ? 4 * SEAT_MARKER_SCALE
            : Math.min(
                13 * SEAT_MARKER_SCALE,
                (SEAT_DOT_RADIUS + 2) *
                  (layoutScale != null && layoutScale > 0
                    ? clamp(0.38 / layoutScale, 1, 1.8)
                    : 1),
              );

          const canDragSeat = isEditorMode && !compactLabels && !!onSeatDrag;

          // Chair-back proportions (width = short axis, length = along table edge).
          const seatThickness = Math.max(4, seatRadius * 1.1) * SEAT_RECT_WL_SCALE;
          const seatLength = Math.max(10, seatRadius * 4.1875) * SEAT_RECT_WL_SCALE;
          const seatRotation = konvaSeatBackRotationDeg(edgeTangentRad);

          return (
            <Rect
              key={`seat-${seat.edgeSide}-${i}`}
              x={dotX}
              y={dotY}
              width={seatThickness}
              height={seatLength}
              offsetX={seatThickness / 2}
              offsetY={seatLength / 2}
              cornerRadius={Math.max(1, seatThickness * 0.45)}
              rotation={seatRotation}
              fill={
                isEditorMode
                  ? canDragSeat ? '#B0B8C5' : '#D1D5DB'
                  : isFilled
                    ? darkenHex(statusColour)
                    : '#D1D5DB'
              }
              stroke={
                canDragSeat
                  ? '#6B7280'
                  : isFilled ? statusColour : '#9CA3AF'
              }
              strokeWidth={canDragSeat ? 1.3 : 1}
              draggable={canDragSeat}
              onDragMove={canDragSeat ? (e) => {
                e.cancelBubble = true;
                const node = e.target;
                const nx = node.x();
                const ny = node.y();
                const angle = Math.atan2(ny, nx);
                onSeatDrag!(i, angle);
                // Snap back to computed position — parent updates via state.
                node.x(dotX);
                node.y(dotY);
              } : undefined}
              onDragEnd={canDragSeat ? (e) => {
                e.cancelBubble = true;
                const node = e.target;
                const nx = node.x();
                const ny = node.y();
                const angle = Math.atan2(ny, nx);
                onSeatDragEnd?.(i, angle);
                node.x(dotX);
                node.y(dotY);
              } : undefined}
              style={canDragSeat ? ({ cursor: 'grab' } as React.CSSProperties) : undefined}
            />
          );
        })}
      </Group>
      )}

      {turnProgressPct != null && isOccupied ? (
        <Group
          x={w / 2 - 20}
          y={topEdge + 20}
          rotation={labelScreenRotationDeg}
          listening={false}
        >
          <Circle
            radius={17}
            fill="#ffffff"
            opacity={0.96}
            shadowColor="rgba(15,23,42,0.22)"
            shadowBlur={5}
            shadowOffsetY={1}
          />
          <Arc
            innerRadius={10}
            outerRadius={15}
            angle={360}
            rotation={-90}
            fill="#e2e8f0"
          />
          <Arc
            innerRadius={10}
            outerRadius={15}
            angle={Math.min(360, Math.max(0, (turnProgressPct / 100) * 360))}
            rotation={-90}
            fill={turnProgressPct >= 100 ? '#dc2626' : turnProgressPct >= 70 ? '#d97706' : '#0d9488'}
          />
        </Group>
      ) : null}

      {showTableNameBadge && (
        <Group y={topEdge - 22} rotation={labelScreenRotationDeg}>
          <Rect
            x={-Math.max(w * 0.56, 58)}
            y={0}
            width={Math.max(w * 1.12, 116)}
            height={18}
            cornerRadius={9}
            fill={table.is_temporary ? '#fff7ed' : '#ffffff'}
            stroke={table.is_temporary ? '#fb923c' : '#cbd5e1'}
            strokeWidth={1}
            shadowColor="rgba(15,23,42,0.12)"
            shadowBlur={3}
            shadowOffsetY={1}
            listening={false}
          />
          <Text
            x={-Math.max(w * 0.56, 58) + 7}
            y={2}
            width={Math.max(w * 1.12, 116) - 14}
            height={14}
            text={table.is_temporary ? `Temporary: ${table.name}` : table.name}
            fontSize={10}
            fontFamily="Inter, system-ui, sans-serif"
            fontStyle="bold"
            fill={table.is_temporary ? '#9a3412' : '#334155'}
            align="center"
            verticalAlign="middle"
            wrap="none"
            ellipsis
            listening={false}
          />
        </Group>
      )}

      {/* ---- Labels: keep the whole two-line block upright without letting the lines drift independently ---- */}
      <Group
        {...(isCircular || isOval
          ? {
              clipFunc: (ctx) => {
                const g = ctx as unknown as CanvasRenderingContext2D;
                g.beginPath();
                if (isCircular) {
                  g.arc(0, 0, Math.min(w, h) / 2, 0, Math.PI * 2, false);
                } else {
                  g.ellipse(0, 0, w / 2, h / 2, 0, 0, 2 * Math.PI);
                }
                g.closePath();
              },
            }
          : isPolygon && polygonPixelPts && polygonPixelPts.length >= 3
            ? {
                clipFunc: (ctx) => {
                  const g = ctx as unknown as CanvasRenderingContext2D;
                  g.beginPath();
                  g.moveTo(polygonPixelPts[0]!.x, polygonPixelPts[0]!.y);
                  for (let i = 1; i < polygonPixelPts.length; i++) {
                    g.lineTo(polygonPixelPts[i]!.x, polygonPixelPts[i]!.y);
                  }
                  g.closePath();
                },
              }
            : {
                clip: {
                  x: -w / 2,
                  y: topEdge,
                  width: w,
                  height: bottomEdge - topEdge,
                },
              })}
      >
        <Group x={0} y={labelBlockCenterY} rotation={labelScreenRotationDeg}>
          <Text
            text={displayName}
            fontSize={fontName}
            fontFamily="Inter, system-ui, sans-serif"
            fontStyle="bold"
            fill={nameFill}
            stroke={compactTextStroke}
            strokeWidth={compactTextStrokeW}
            align="center"
            verticalAlign="middle"
            wrap="none"
            ellipsis={true}
            width={innerW}
            height={nameLineH}
            x={textX}
            y={nameY - labelBlockCenterY}
            listening={false}
          />
          {hasBottomLabel ? (
            <Text
              text={displayCap}
              fontSize={fontCap}
              fontFamily="Inter, system-ui, sans-serif"
              fontStyle="normal"
              fill={capFill}
              stroke={compactTextStroke}
              strokeWidth={compactTextStrokeW}
              align="center"
              verticalAlign="middle"
              wrap="none"
              lineHeight={1.08}
              ellipsis={true}
              width={innerW}
              height={capLineH}
              x={textX}
              y={capY - labelBlockCenterY}
              listening={false}
            />
          ) : null}
        </Group>
      </Group>

      {/* ---- Corner resize handles for rectangle / square / polygon ---- */}
      {isSelected && isEditorMode && !isCircular && !isOval &&
        (
          [
            ['nw', -1, -1],
            ['ne',  1, -1],
            ['se',  1,  1],
            ['sw', -1,  1],
          ] as [string, -1 | 1, -1 | 1][]
        ).map(([name, sx, sy], i) => {
          const hx = (sx * w) / 2;
          const hy = (sy * h) / 2;
          return (
            <Rect
              key={`rect-handle-${i}`}
              x={hx - HANDLE / 2}
              y={hy - HANDLE / 2}
              width={HANDLE}
              height={HANDLE}
              fill="#ffffff"
              stroke="#2563eb"
              strokeWidth={1.5}
              draggable={!!onRectResize}
              onDragMove={onRectResize ? (e) => {
                e.cancelBubble = true;
                const node = e.target;
                // Handle centre in local coords = node.x + HANDLE/2
                const hxNow = node.x() + HANDLE / 2;
                const hyNow = node.y() + HANDLE / 2;
                const halfWpx = Math.abs(hxNow);
                const halfHpx = Math.abs(hyNow);
                const { widthPct: wp, heightPct: hp } = tablePixelDimensionsToPercent(
                  halfWpx * 2,
                  halfHpx * 2,
                  canvasWidth,
                  canvasHeight,
                  table.shape,
                );
                const widthPct = Math.max(3, Math.min(25, wp));
                const heightPct = Math.max(3, Math.min(25, hp));
                onRectResize(widthPct, table.shape === 'square' ? widthPct : heightPct);
                // Snap handle back to its corner (React re-render will place it correctly
                // once state flows; this just prevents it flying off during rapid moves).
                node.x(hx - HANDLE / 2);
                node.y(hy - HANDLE / 2);
              } : undefined}
              onDragEnd={onRectResizeEnd ? (e) => {
                e.cancelBubble = true;
                onRectResizeEnd();
              } : undefined}
              onMouseDown={(e) => { e.cancelBubble = true; }}
              onTouchStart={(e) => { e.cancelBubble = true; }}
              hitStrokeWidth={12}
              style={
                onRectResize
                  ? ({ cursor: name === 'nw' || name === 'se' ? 'nwse-resize' : 'nesw-resize' } as React.CSSProperties)
                  : undefined
              }
            />
          );
        })}

      {/* Circle handles — dragging any changes diameter (w = h) */}
      {isSelected && isEditorMode && isCircular &&
        ([
          [1, 0],    // right  → width axis
          [0, 1],    // bottom → height axis
          [-1, 0],   // left   → width axis
          [0, -1],   // top    → height axis
        ] as [number, number][]).map(([nx, ny], i) => {
          const r = Math.min(w, h) / 2;
          const hx = nx * r;
          const hy = ny * r;
          return (
            <Rect
              key={`handle-${i}`}
              x={hx - HANDLE / 2}
              y={hy - HANDLE / 2}
              width={HANDLE}
              height={HANDLE}
              fill="#ffffff"
              stroke="#2563eb"
              strokeWidth={1.5}
              draggable={!!onResizeHandleDrag}
              onDragMove={onResizeHandleDrag ? (e) => {
                e.cancelBubble = true;
                const node = e.target;
                // Distance from centre = new radius → diameter
                const dist = Math.sqrt(node.x() ** 2 + node.y() ** 2);
                onResizeHandleDrag('x', dist);
                // Snap handle back to computed position
                node.x(hx - HANDLE / 2);
                node.y(hy - HANDLE / 2);
              } : undefined}
              onDragEnd={onResizeHandleEnd ? (e) => {
                e.cancelBubble = true;
                onResizeHandleEnd();
              } : undefined}
              style={onResizeHandleDrag ? ({ cursor: 'ew-resize' } as React.CSSProperties) : undefined}
            />
          );
        })}

      {/* Oval handles — left/right for width, top/bottom for height */}
      {isSelected && isEditorMode && isOval &&
        ([
          ['x', w / 2, 0],   // right
          ['y', 0, h / 2],   // bottom
          ['x', -w / 2, 0],  // left
          ['y', 0, -h / 2],  // top
        ] as ['x' | 'y', number, number][]).map(([axis, hx, hy], i) => (
          <Rect
            key={`handle-${i}`}
            x={hx - HANDLE / 2}
            y={hy - HANDLE / 2}
            width={HANDLE}
            height={HANDLE}
            fill="#ffffff"
            stroke="#2563eb"
            strokeWidth={1.5}
            draggable={!!onResizeHandleDrag}
            onDragMove={onResizeHandleDrag ? (e) => {
              e.cancelBubble = true;
              const node = e.target;
              const halfPx = axis === 'x'
                ? Math.abs(node.x() + HANDLE / 2)
                : Math.abs(node.y() + HANDLE / 2);
              onResizeHandleDrag(axis, Math.max(14, halfPx));
              // Keep handle pinned to its axis
              if (axis === 'x') node.y(hy - HANDLE / 2);
              else node.x(hx - HANDLE / 2);
            } : undefined}
            onDragEnd={onResizeHandleEnd ? (e) => {
              e.cancelBubble = true;
              onResizeHandleEnd();
            } : undefined}
            style={onResizeHandleDrag
              ? ({ cursor: axis === 'x' ? 'ew-resize' : 'ns-resize' } as React.CSSProperties)
              : undefined}
          />
        ))}

      {/* Polygon: draggable vertices to reshape (table-local space). */}
      {isSelected &&
        isEditorMode &&
        isPolygon &&
        polygonPixelPts &&
        polygonPixelPts.length >= 3 &&
        onPolygonVertexDrag &&
        polygonPixelPts.map((pt, vi) => (
          <Circle
            key={`poly-vertex-${vi}`}
            x={pt.x}
            y={pt.y}
            radius={polyVertexRadius}
            fill="#ffffff"
            stroke="#2563eb"
            strokeWidth={POLY_VERTEX_SCALE * Math.max(1.75, 2 / Math.max(layoutScaleSafe, 0.2))}
            hitStrokeWidth={polyVertexHitStroke}
            draggable
            dragDistance={2}
            onMouseDown={(e) => {
              e.cancelBubble = true;
            }}
            onTouchStart={(e) => {
              e.cancelBubble = true;
            }}
            onDragStart={(e) => {
              e.cancelBubble = true;
            }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              const node = e.target;
              onPolygonVertexDrag(vi, node.x(), node.y());
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              onPolygonVertexDragEnd?.();
            }}
            style={{ cursor: 'move' } as React.CSSProperties}
          />
        ))}

      {children}
    </Group>
  );
}
