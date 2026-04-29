'use client';

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Stage, Layer, Line, Rect, Text, Circle } from 'react-konva';
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
import { computeGlobalUnifiedLabelFonts } from '@/lib/floor-plan/table-label-fonts';

/**
 * Stat tile label colours from `DashboardStatCard` (Tailwind `text-blue-700` / `text-emerald-700`).
 * TableShape lightens the fill from these bases; strokes use the base hex directly.
 */
const STAT_TILE_TEXT_BLUE_700 = '#1d4ed8';
const STAT_TILE_TEXT_EMERALD_700 = '#047857';

const STATUS_COLORS: Record<string, string> = {
  available: STAT_TILE_TEXT_EMERALD_700,
  booked: STAT_TILE_TEXT_BLUE_700,
  pending: STAT_TILE_TEXT_BLUE_700,
  reserved: STAT_TILE_TEXT_BLUE_700,
  seated: STAT_TILE_TEXT_BLUE_700,
  held: STAT_TILE_TEXT_BLUE_700,
  no_show: STAT_TILE_TEXT_BLUE_700,
  starters: STAT_TILE_TEXT_BLUE_700,
  mains: STAT_TILE_TEXT_BLUE_700,
  dessert: STAT_TILE_TEXT_BLUE_700,
  bill: STAT_TILE_TEXT_BLUE_700,
  paid: STAT_TILE_TEXT_BLUE_700,
  bussing: STAT_TILE_TEXT_BLUE_700,
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
  seat_angles?: (number | null)[] | null;
  polygon_points?: { x: number; y: number }[] | null;
  service_status: string;
  booking: {
    id: string;
    guest_name: string;
    party_size: number;
  } | null;
  elapsed_pct: number;
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

  const handleStageClick = useCallback((e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (isDraggingRef.current || panningRef.current) return;
    if (e.target === e.target.getStage()) {
      if (draggingBookingId) {
        setDraggingBookingId(null);
        setDragPointer(null);
        isDraggingRef.current = false;
        onDragCancel?.();
      } else {
        onSelect(null);
      }
    }
  }, [onSelect, draggingBookingId, onDragCancel]);

  const adjacency = useMemo(() => {
    const bounds = tables.map((t) => {
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
  }, [tables, layoutPixelW, layoutPixelH]);

  const combinationLines = useCallback(() => {
    if (!combinedTableGroups) return [];
    const lines: Array<{ key: string; points: number[] }> = [];

    combinedTableGroups.forEach((tableIds, bookingId) => {
      if (tableIds.length < 2) return;
      for (let i = 0; i < tableIds.length - 1; i++) {
        const t1 = tables.find((t) => t.id === tableIds[i]);
        const t2 = tables.find((t) => t.id === tableIds[i + 1]);
        if (!t1 || !t2) continue;
        const x1 = t1.position_x != null ? (t1.position_x / 100) * layoutPixelW : layoutPixelW / 2;
        const y1 = t1.position_y != null ? (t1.position_y / 100) * layoutPixelH : layoutPixelH / 2;
        const x2 = t2.position_x != null ? (t2.position_x / 100) * layoutPixelW : layoutPixelW / 2;
        const y2 = t2.position_y != null ? (t2.position_y / 100) * layoutPixelH : layoutPixelH / 2;
        lines.push({ key: `${bookingId}-${i}`, points: [x1, y1, x2, y2] });
      }
    });

    return lines;
  }, [combinedTableGroups, tables, layoutPixelW, layoutPixelH]);

  const layoutSignature = useMemo(
    () =>
      tables
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
    [tables],
  );

  const handleTableMouseDown = useCallback((tableId: string, _e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const table = tables.find((t) => t.id === tableId);
    if (!table?.booking) return;

    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    dragStartPosRef.current = { x: pointer.x, y: pointer.y };
  }, [tables]);

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
      const table = tables.find((t) => t.id === tableId);
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
  }, [tables, combinedTableGroups, onDragStart, scale, stagePos]);

  const handleTableMouseUp = useCallback((tableId: string) => {
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

    dragStartPosRef.current = null;
    isDraggingRef.current = false;
  }, [combinedTableGroups, draggingBookingId, validDropTargets, onDragEnd, onDragCancel]);

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
    if (vw < 1 || vh < 1 || tables.length === 0) return;

    const fit = computeStageFitToView(
      tables,
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
  }, [tables, layoutPixelW, layoutPixelH, viewport.w, viewport.h]);

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
    if (tables.length === 0 || !hasMeasuredViewport) return;
    if (!initialFitDone.current) {
      fitViewToStage();
      initialFitDone.current = true;
    }
  }, [tables.length, hasMeasuredViewport, fitViewToStage]);

  const zoomBy = useCallback(
    (delta: number) => {
      const newScale = Math.max(0.3, Math.min(3, scale + delta));
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

  const isDragging = draggingBookingId != null || reassignMode != null;
  const activeBookingId = draggingBookingId ?? reassignMode?.bookingId ?? null;

  const unifiedLabelFonts = useMemo(() => {
    const inputs = tables.map((table) => {
      const fb = getTableDimensions(table.max_covers, table.shape);
      const { w: tw, h: th } = tableDimensionsPercentToPixels(
        table.width ?? fb.width,
        table.height ?? fb.height,
        layoutPixelW,
        layoutPixelH,
        table.shape,
      );
      const capacityText =
        table.min_covers === table.max_covers
          ? `${table.max_covers}`
          : `${table.min_covers}-${table.max_covers}`;
      const dragOrReassign = draggingBookingId != null || reassignMode != null;
      const isSource = activeBookingId
        ? (combinedTableGroups?.get(activeBookingId)?.includes(table.id) ??
          (table.booking?.id === activeBookingId))
        : false;
      const booking = dragOrReassign && isSource ? null : table.booking;
      const isOccupied = booking != null;
      const topLabel = isOccupied ? booking!.guest_name.slice(0, 12) : table.name;
      const bottomLabel = isOccupied ? `${booking!.party_size} pax` : capacityText;
      return {
        w: tw,
        h: th,
        shape: table.shape,
        topLabel,
        bottomLabel,
        compactLabels: false,
        layoutScale: scale,
        polygon_points: table.polygon_points ?? null,
      };
    });
    return computeGlobalUnifiedLabelFonts(inputs);
  }, [
    tables,
    layoutPixelW,
    layoutPixelH,
    scale,
    draggingBookingId,
    reassignMode,
    combinedTableGroups,
    activeBookingId,
  ]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-slate-50"
      style={{ touchAction: 'none' }}
    >
      <div className="absolute right-2 top-2 z-10 flex gap-1 rounded-2xl border border-slate-200 bg-white p-0.5 shadow-sm shadow-slate-900/5">
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

      <Stage
        ref={(node) => { stageRef.current = node; }}
        width={stageWidth}
        height={stageHeight}
        scaleX={scale}
        scaleY={scale}
        x={stagePos.x}
        y={stagePos.y}
        onClick={handleStageClick}
        onTap={handleStageClick}
        onMouseUp={handleStageMouseUp}
        onMouseMove={handleStageMouseMove}
        draggable={!isDragging}
        onDragStart={(e) => {
          if (e.target === e.target.getStage()) panningRef.current = true;
        }}
        onDragMove={(e) => {
          if (e.target === e.target.getStage()) {
            setStagePos({ x: e.target.x(), y: e.target.y() });
          }
        }}
        onDragEnd={(e) => {
          if (e.target === e.target.getStage()) {
            setStagePos({ x: e.target.x(), y: e.target.y() });
            setTimeout(() => {
              panningRef.current = false;
            }, 0);
          }
        }}
        style={{ background: '#f8fafc', cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        <Layer>
          {/* Combination lines only when a booking spans multiple tables (see combinationLines) */}
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
          {tables.map((table) => {
            const isSelected = table.id === selectedId;
            const isSource = activeBookingId ? (combinedTableGroups?.get(activeBookingId)?.includes(table.id) ?? (table.booking?.id === activeBookingId)) : false;
            const isValidTarget = isDragging && validDropTargets?.has(table.id) && !isSource;
            const isInvalid = isDragging && !isSource && !validDropTargets?.has(table.id);
            const comboLabel = validDropComboLabels?.get(table.id);

            let statusColor = STATUS_COLORS[table.service_status] ?? STAT_TILE_TEXT_EMERALD_700;
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
                canvasWidth={layoutPixelW}
                canvasHeight={layoutPixelH}
                layoutScale={scale}
                unifiedLabelFonts={unifiedLabelFonts}
                seatAngles={table.seat_angles}
                onClick={() => {
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
                  if (!isDraggingRef.current) onSelect(table.id);
                }}
                onTap={() => {
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
                    opacity={0}
                    onMouseDown={(e) => { e.cancelBubble = true; handleTableMouseDown(table.id, e); }}
                    onMouseMove={() => handleTableMouseMove(table.id)}
                    onMouseUp={() => handleTableMouseUp(table.id)}
                    onTouchStart={(e) => { e.cancelBubble = true; handleTableMouseDown(table.id, e); }}
                    onTouchMove={() => handleTableMouseMove(table.id)}
                    onTouchEnd={() => handleTableMouseUp(table.id)}
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
                  const b = tables.find((t) => t.booking?.id === draggingBookingId);
                  return b?.booking?.guest_name ?? '';
                })()}
                fontSize={12}
                fill="#1e40af"
                fontStyle="bold"
                listening={false}
              />
            </>
          )}
        </Layer>
      </Stage>
    </div>
  );
}
