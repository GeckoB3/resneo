'use client';

import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import type { VenueTable, TableGridCell } from '@/types/table-management';
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  rectIntersection,
  type CollisionDetection,
  type DragStartEvent,
  type DragEndEvent,
  type DragMoveEvent,
  MeasuringStrategy,
} from '@dnd-kit/core';
import {
  BOOKING_STATUSES,
  BOOKING_PRIMARY_ACTIONS,
  BOOKING_STATUS_TRANSITIONS,
  BOOKING_REVERT_ACTIONS,
  canTransitionBookingStatus,
  isBookingStatus,
  isDestructiveBookingStatus,
  isRevertTransition,
  type BookingStatus,
} from '@/lib/table-management/booking-status';
import { resolveDropTarget, type CombinationInfo } from '@/lib/table-management/move-validation';
import { isAttendanceConfirmed } from '@/lib/booking/booking-staff-indicators';
import { computePointAnchoredMenuStyle } from '@/lib/ui/clamped-floating-styles';
import { useViewportBounds } from '@/lib/ui/use-viewport-bounds';
import {
  detectAdjacentTables,
  findValidCombinations,
  type CombinationBlock,
  type CombinationBooking,
  type CombinationTable,
  type ManualCombination,
} from '@/lib/table-management/combination-engine';

const STATUS_COLORS: Record<string, string> = {
  Pending: 'bg-[#EFF6FF] border-[#BFDBFE] border-l-[#3B82F6] text-[#1E40AF]',
  Booked: 'bg-[#EFF6FF] border-[#BFDBFE] border-l-[#3B82F6] text-[#1E40AF]',
  Confirmed: 'bg-[#ECFDF5] border-[#A7F3D0] border-l-[#059669] text-[#065F46]',
  Seated: 'bg-[#F5F3FF] border-[#DDD6FE] border-l-[#8B5CF6] text-[#5B21B6]',
  Arrived: 'bg-[#FFFBEB] border-[#FDE68A] border-l-[#F59E0B] text-[#92400E]',
  Completed: 'bg-slate-100 border-slate-200/90 border-l-emerald-500 text-slate-700 ring-1 ring-inset ring-slate-200/60',
  'No-Show': 'bg-[#FEF2F2] border-[#FECACA] border-l-[#EF4444] text-[#991B1B]',
  Cancelled: 'bg-[#F3F4F6] border-[#E5E7EB] border-l-[#6B7280] text-[#6B7280]',
  'Deposit Pending': 'bg-orange-100 border-orange-300 text-orange-800',
};

/** Touch/pen: if pointer moved more than this on X or Y before contextmenu, skip menu (drag intent). */
const CONTEXT_MENU_MAX_POINTER_MOVE_PX = 10;

const STATUS_DOTS: Record<string, string> = {
  Pending: 'bg-[#3B82F6]',
  Booked: 'bg-[#3B82F6]',
  Confirmed: 'bg-[#059669]',
  Seated: 'bg-[#8B5CF6]',
  Arrived: 'bg-[#F59E0B]',
  Completed: 'bg-emerald-500',
  'No-Show': 'bg-[#EF4444]',
  Cancelled: 'bg-[#6B7280]',
  'Deposit Pending': 'bg-orange-500',
};

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
}

function timelineGridLineClass(minutes: number, palette: 'slate' | 'emerald' = 'slate'): string {
  if (minutes % 60 === 0) {
    return palette === 'emerald'
      ? 'border-l border-l-emerald-500/70'
      : 'border-l border-l-slate-400';
  }
  if (minutes % 30 === 0) {
    return palette === 'emerald'
      ? 'border-l border-l-emerald-300/80'
      : 'border-l border-l-slate-300';
  }
  return '';
}

function timelineTimeBlockBandClass(
  minutes: number,
  startMinutes: number,
  slotIntervalMinutes: number,
  palette: 'slate' | 'emerald' = 'slate',
): string {
  const slotIndex = Math.max(0, Math.floor((minutes - startMinutes) / slotIntervalMinutes));
  const isAltBlock = slotIndex % 2 === 1;
  if (palette === 'emerald') {
    return isAltBlock ? 'bg-emerald-50/55' : 'bg-emerald-50/25';
  }
  return isAltBlock ? 'bg-slate-50/55' : 'bg-white';
}

function endMinutesAfterStart(start: string, end: string | null | undefined, fallbackMinutes = 90): number {
  const startMin = timeToMinutes(start);
  if (!end) return startMin + fallbackMinutes;
  let endMin = timeToMinutes(end);
  if (endMin <= startMin) {
    endMin += 24 * 60;
  }
  return endMin;
}

function departedWallMinutes(departedIso: string): number {
  const d = new Date(departedIso);
  return d.getHours() * 60 + d.getMinutes();
}

function effectiveBookingEndMinutes(
  status: string,
  start: string,
  end: string | null | undefined,
  isToday: boolean,
  nowMinutes: number,
  actualDepartedTime?: string | null,
): number {
  const scheduledEnd = endMinutesAfterStart(start, end);
  const startMin = timeToMinutes(start.slice(0, 5));

  if (status === 'Completed') {
    if (actualDepartedTime) {
      return Math.max(startMin, departedWallMinutes(actualDepartedTime));
    }
    if (isToday) {
      return Math.max(startMin, nowMinutes);
    }
    return scheduledEnd;
  }

  if ((status === 'Seated' || status === 'Arrived') && isToday) {
    if (nowMinutes > startMin) {
      return Math.max(scheduledEnd, nowMinutes);
    }
  }
  return scheduledEnd;
}

function formatLocalDateInput(d: Date): string {
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

interface BookingBlock {
  id: string;
  guest_name: string;
  party_size: number;
  status: string;
  deposit_status?: string | null;
  guest_attendance_confirmed_at?: string | null;
  staff_attendance_confirmed_at?: string | null;
  start_time: string;
  end_time: string;
  table_id: string | null;
  table_ids: string[];
  table_names: string[];
  dietary_notes: string | null;
  occasion: string | null;
  startCol: number;
  spanCols: number;
  leftPx: number;
  widthPx: number;
  _startMin: number;
  _scheduledEndMin: number;
  _endMin: number;
  rowSpan: number;
  laneIndex: number;
  laneCount: number;
}

interface MoveSuggestion {
  id: string;
  bookingId: string;
  guestName: string;
  targetTableIds: string[];
  targetTableName: string;
  dotClassName: string;
  buttonClassName: string;
}

function statusColorKeyForBooking(block: BookingBlock): string {
  if (isAttendanceConfirmed(block) && (block.status === 'Booked' || block.status === 'Confirmed')) {
    return 'Confirmed';
  }
  return block.status;
}

interface Props {
  tables: VenueTable[];
  cells: TableGridCell[];
  unassignedBookings: Array<{
    id: string;
    guest_name: string;
    party_size: number;
    start_time: string;
    end_time: string;
    status: string;
    guest_attendance_confirmed_at?: string | null;
    staff_attendance_confirmed_at?: string | null;
    dietary_notes: string | null;
    occasion: string | null;
    actual_departed_time?: string | null;
  }>;
  combinations?: CombinationInfo[];
  combinationThreshold?: number;
  serviceStartTime?: string;
  serviceEndTime?: string;
  slotIntervalMinutes?: number;
  statusFilter: string | null;
  highlightedBookingIds: Set<string>;
  validDropTargets: Set<string> | null;
  validDropCombos: Map<string, string> | null;
  onReassign: (bookingId: string, oldTableIds: string[], newTableIds: string[]) => void;
  onTimeChange: (bookingId: string, newTime: string) => void;
  onResizeBooking: (bookingId: string, newEndTime: string) => void;
  onAssign: (bookingId: string, tableIds: string[]) => void;
  onUnassign: (bookingId: string) => void;
  onRefresh: () => void;
  onDragValidation: (block: BookingBlock | null) => void;
  onError: (message: string) => void;
  onBookingClick: (bookingId: string, anchor: { x: number; y: number }) => void;
  onEditBooking: (bookingId: string) => void;
  onSendMessage: (bookingId: string) => void;
  onCellClick: (tableId: string, time: string, anchor: { x: number; y: number }) => void;
  onBlockClick: (blockId: string) => void;
  onCellContextMenu: (tableId: string, time: string, x: number, y: number) => void;
  onBlockAfterBooking: (tableId: string, endTime: string) => void;
  currentDate: string;
  slotWidth?: number;
  onMoveBooking: (bookingId: string) => void;
  onRescheduleBooking: (bookingId: string) => void;
  onAssignAllUnassigned?: () => void;
  assignAllUnassignedLoading?: boolean;
  onBookingStatusChange: (bookingId: string, currentStatus: BookingStatus, nextStatus: BookingStatus) => Promise<void>;
}

const SLOT_WIDTH_DEFAULT = 64;
const ROW_HEIGHT = 48;
const HEADER_HEIGHT = 40;
/** Left/right unassigned toolbar row height - stacked label + full-width “Assign All” (matches narrow sidebar). */
const UNASSIGNED_HEADER_HEIGHT = 64;

/** Prefer timeline cells over parent row droppables so drop target + drag preview match the slot under the pointer. */
const cellFirstTimelineCollision: CollisionDetection = (args) => {
  const collisions = rectIntersection(args);
  const cells = collisions.filter((c) => String(c.id).startsWith('cell_'));
  return cells.length > 0 ? cells : collisions;
};

const CELL_DROP_ID_REGEX = /^cell_(.+)_(\d{1,2}:\d{2})$/;
const TABLE_GRID_VISUAL_INTERACTION_EVENT = 'table-grid-visual-interaction';
const MOVE_SUGGESTION_STYLES = [
  {
    dot: 'bg-sky-500 ring-sky-100',
    button: 'bg-sky-600 text-white hover:bg-sky-700 focus:ring-sky-300',
  },
  {
    dot: 'bg-violet-500 ring-violet-100',
    button: 'bg-violet-600 text-white hover:bg-violet-700 focus:ring-violet-300',
  },
  {
    dot: 'bg-fuchsia-500 ring-fuchsia-100',
    button: 'bg-fuchsia-600 text-white hover:bg-fuchsia-700 focus:ring-fuchsia-300',
  },
  {
    dot: 'bg-amber-500 ring-amber-100',
    button: 'bg-amber-500 text-white hover:bg-amber-600 focus:ring-amber-300',
  },
  {
    dot: 'bg-teal-500 ring-teal-100',
    button: 'bg-teal-600 text-white hover:bg-teal-700 focus:ring-teal-300',
  },
  {
    dot: 'bg-rose-500 ring-rose-100',
    button: 'bg-rose-600 text-white hover:bg-rose-700 focus:ring-rose-300',
  },
] as const;

type DragDropPreview =
  | { kind: 'time'; time: string; invalid: boolean }
  | { kind: 'table'; label: string; invalid: boolean };

interface TimeDragTarget {
  tableIds: string[];
  startMin: number;
  endMin: number;
  invalid: boolean;
}

function sameDragDropPreview(a: DragDropPreview | null, b: DragDropPreview | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind || a.invalid !== b.invalid) return false;
  if (a.kind === 'time' && b.kind === 'time') return a.time === b.time;
  if (a.kind === 'table' && b.kind === 'table') return a.label === b.label;
  return false;
}

function emitVisualInteraction(active: boolean): void {
  window.dispatchEvent(
    new CustomEvent(TABLE_GRID_VISUAL_INTERACTION_EVENT, {
      detail: { active },
    }),
  );
}

function formatTargetTableLabel(
  targetTableIds: string[] | null | undefined,
  hoveredTableId: string,
  tableList: VenueTable[],
): string {
  if (targetTableIds && targetTableIds.length > 0) {
    return targetTableIds.map((id) => tableList.find((t) => t.id === id)?.name ?? id).join(' + ');
  }
  return tableList.find((t) => t.id === hoveredTableId)?.name ?? 'Table';
}

export function TimelineGrid({
  tables,
  cells,
  unassignedBookings,
  combinations,
  combinationThreshold = 80,
  serviceStartTime,
  serviceEndTime,
  slotIntervalMinutes,
  statusFilter,
  highlightedBookingIds,
  validDropTargets,
  validDropCombos,
  onReassign,
  onTimeChange,
  onResizeBooking,
  onAssign,
  onUnassign,
  onRefresh: _onRefresh,
  onDragValidation,
  onError,
  onBookingClick,
  onEditBooking,
  onSendMessage,
  onCellClick,
  onBlockClick,
  onCellContextMenu,
  onBlockAfterBooking,
  currentDate,
  slotWidth,
  onMoveBooking,
  onRescheduleBooking,
  onAssignAllUnassigned,
  assignAllUnassignedLoading,
  onBookingStatusChange,
}: Props) {
  const SLOT_WIDTH = slotWidth ?? SLOT_WIDTH_DEFAULT;
  const scrollRef = useRef<HTMLDivElement>(null);
  const timelineRootRef = useRef<HTMLDivElement>(null);
  const [activeDrag, setActiveDrag] = useState<BookingBlock | null>(null);
  const activeDragRef = useRef<BookingBlock | null>(null);
  /** Touch/pen start position for a booking - used to avoid opening the context menu after a drag-intent move. */
  const bookingPointerDownRef = useRef<{ bookingId: string; x: number; y: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; booking: BookingBlock } | null>(null);
  const viewportBounds = useViewportBounds();
  const bookingContextMenuStyle = useMemo(() => {
    if (!contextMenu) return undefined;
    return computePointAnchoredMenuStyle({
      anchorX: contextMenu.x,
      anchorY: contextMenu.y,
      viewportWidth: viewportBounds.width,
      viewportHeight: viewportBounds.height,
      minWidth: 200,
      maxWidth: Math.min(340, viewportBounds.width - 16),
    });
  }, [contextMenu, viewportBounds.width, viewportBounds.height]);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; resolve: (value: boolean) => void } | null>(null);
  const [resizeVisual, setResizeVisual] = useState<{ bookingId: string; deltaPx: number } | null>(null);
  /** Hovered drop target while dragging - time (same table) or table/combination name (table move). */
  const [dragDropPreview, setDragDropPreview] = useState<DragDropPreview | null>(null);
  const [timeDragTarget, setTimeDragTarget] = useState<TimeDragTarget | null>(null);
  const dragDropPreviewRef = useRef<DragDropPreview | null>(null);
  const pendingDragDropPreviewRef = useRef<DragDropPreview | null>(null);
  const dragDropPreviewFrameRef = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  useEffect(() => {
    dragDropPreviewRef.current = dragDropPreview;
  }, [dragDropPreview]);

  useEffect(() => {
    return () => {
      if (dragDropPreviewFrameRef.current !== null) {
        window.cancelAnimationFrame(dragDropPreviewFrameRef.current);
      }
    };
  }, []);

  const cancelQueuedDragPreview = useCallback(() => {
    if (dragDropPreviewFrameRef.current !== null) {
      window.cancelAnimationFrame(dragDropPreviewFrameRef.current);
      dragDropPreviewFrameRef.current = null;
    }
    pendingDragDropPreviewRef.current = null;
    dragDropPreviewRef.current = null;
    setDragDropPreview(null);
  }, []);

  const queueDragDropPreview = useCallback((next: DragDropPreview | null) => {
    if (sameDragDropPreview(pendingDragDropPreviewRef.current ?? dragDropPreviewRef.current, next)) return;
    pendingDragDropPreviewRef.current = next;
    if (dragDropPreviewFrameRef.current !== null) return;

    dragDropPreviewFrameRef.current = window.requestAnimationFrame(() => {
      dragDropPreviewFrameRef.current = null;
      const queued = pendingDragDropPreviewRef.current;
      pendingDragDropPreviewRef.current = null;
      if (sameDragDropPreview(dragDropPreviewRef.current, queued)) return;
      dragDropPreviewRef.current = queued;
      setDragDropPreview(queued);
    });
  }, []);

  const startMin = useMemo(() => serviceStartTime ? timeToMinutes(serviceStartTime) : 9 * 60, [serviceStartTime]);
  const endMin = useMemo(() => serviceEndTime ? timeToMinutes(serviceEndTime) : 23 * 60, [serviceEndTime]);
  const slotInterval = slotIntervalMinutes ?? 15;
  const isToday = useMemo(() => currentDate === formatLocalDateInput(new Date()), [currentDate]);

  const [nowMinutes, setNowMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });

  const timeSlots = useMemo(() => {
    const slots: string[] = [];
    for (let m = startMin; m < endMin; m += slotInterval) {
      slots.push(minutesToTime(m));
    }
    return slots;
  }, [startMin, endMin, slotInterval]);
  const hourMarkers = useMemo(() => {
    return timeSlots
      .filter((time) => timeToMinutes(time) % 60 === 0)
      .map((time) => ({
        time,
        leftPx: ((timeToMinutes(time) - startMin) / slotInterval) * SLOT_WIDTH,
      }));
  }, [SLOT_WIDTH, slotInterval, startMin, timeSlots]);

  const bookingBlocks = useMemo(() => {
    const blocks: BookingBlock[] = [];
    const bookingTableMap = new Map<string, string[]>();
    const tableNameById = new Map(tables.map((t) => [t.id, t.name]));

    for (const cell of cells) {
      if (!cell.booking_id) continue;
      const existing = bookingTableMap.get(cell.booking_id) ?? [];
      if (!existing.includes(cell.table_id)) existing.push(cell.table_id);
      bookingTableMap.set(cell.booking_id, existing);
    }

    const seenBookings = new Set<string>();
    for (const cell of cells) {
      if (!cell.booking_id || !cell.booking_details || seenBookings.has(cell.booking_id)) continue;
      seenBookings.add(cell.booking_id);

      const bStart = timeToMinutes(cell.booking_details.start_time);
      const scheduledEnd = endMinutesAfterStart(cell.booking_details.start_time, cell.booking_details.end_time);
      const bEnd = effectiveBookingEndMinutes(
        cell.booking_details.status,
        cell.booking_details.start_time,
        cell.booking_details.end_time,
        isToday,
        nowMinutes,
        cell.booking_details.actual_departed_time ?? null,
      );

      const startCol = Math.max(0, Math.floor((bStart - startMin) / slotInterval));
      const endCol = Math.ceil((bEnd - startMin) / slotInterval);
      const spanCols = Math.max(1, endCol - startCol);

      const clampedStart = Math.max(bStart, startMin);
      const leftPx = ((clampedStart - startMin) / slotInterval) * SLOT_WIDTH;
      const widthPx = Math.max(SLOT_WIDTH * 0.25, ((bEnd - clampedStart) / slotInterval) * SLOT_WIDTH);

      const assignedTableIds = cell.booking_details.table_ids?.filter((tableId) => tableNameById.has(tableId)) ?? [];
      const allTableIds = assignedTableIds.length > 0
        ? Array.from(new Set(assignedTableIds))
        : bookingTableMap.get(cell.booking_id) ?? [cell.table_id];
      const tableNames = cell.booking_details.table_names && cell.booking_details.table_names.length === allTableIds.length
        ? cell.booking_details.table_names
        : allTableIds.map((tid) => tableNameById.get(tid) ?? tid);
      for (const tableId of allTableIds) {
        blocks.push({
          id: cell.booking_id,
          guest_name: cell.booking_details.guest_name,
          party_size: cell.booking_details.party_size,
          status: cell.booking_details.status,
          deposit_status: cell.booking_details.deposit_status ?? null,
          guest_attendance_confirmed_at: cell.booking_details.guest_attendance_confirmed_at ?? null,
          staff_attendance_confirmed_at: cell.booking_details.staff_attendance_confirmed_at ?? null,
          start_time: cell.booking_details.start_time,
          end_time: minutesToTime(bEnd),
          table_id: tableId,
          table_ids: allTableIds,
          table_names: tableNames,
          dietary_notes: cell.booking_details.dietary_notes,
          occasion: cell.booking_details.occasion,
          startCol,
          spanCols,
          leftPx,
          widthPx,
          _startMin: bStart,
          _scheduledEndMin: scheduledEnd,
          _endMin: bEnd,
          rowSpan: 1,
          laneIndex: 0,
          laneCount: 1,
        });
      }
    }

    for (const b of unassignedBookings) {
      if (seenBookings.has(b.id)) continue;
      seenBookings.add(b.id);

      const bStart = timeToMinutes(b.start_time);
      const scheduledEnd = endMinutesAfterStart(b.start_time, b.end_time);
      const bEnd = effectiveBookingEndMinutes(
        b.status,
        b.start_time,
        b.end_time,
        isToday,
        nowMinutes,
        b.actual_departed_time ?? null,
      );
      const startCol = Math.max(0, Math.floor((bStart - startMin) / slotInterval));
      const endCol = Math.ceil((bEnd - startMin) / slotInterval);

      const clampedStart = Math.max(bStart, startMin);
      const uLeftPx = ((clampedStart - startMin) / slotInterval) * SLOT_WIDTH;
      const uWidthPx = Math.max(SLOT_WIDTH * 0.25, ((bEnd - clampedStart) / slotInterval) * SLOT_WIDTH);

      blocks.push({
        id: b.id,
        guest_name: b.guest_name,
        party_size: b.party_size,
        status: b.status,
        deposit_status: null,
        guest_attendance_confirmed_at: b.guest_attendance_confirmed_at ?? null,
        staff_attendance_confirmed_at: b.staff_attendance_confirmed_at ?? null,
        start_time: b.start_time,
        end_time: minutesToTime(bEnd),
        table_id: null,
        table_ids: [],
        table_names: [],
        dietary_notes: b.dietary_notes,
        occasion: b.occasion,
        startCol,
        spanCols: Math.max(1, endCol - startCol),
        leftPx: uLeftPx,
        widthPx: uWidthPx,
        _startMin: bStart,
        _scheduledEndMin: scheduledEnd,
        _endMin: bEnd,
        rowSpan: 1,
        laneIndex: 0,
        laneCount: 1,
      });
    }

    const byRow = new Map<string, BookingBlock[]>();
    for (const block of blocks) {
      const key = block.table_id ?? '__unassigned__';
      const existing = byRow.get(key) ?? [];
      existing.push(block);
      byRow.set(key, existing);
    }

    for (const rowBlocks of byRow.values()) {
      rowBlocks.sort((a, b) => {
        if (a._startMin !== b._startMin) return a._startMin - b._startMin;
        return a._endMin - b._endMin;
      });
      const laneEnds: number[] = [];
      for (const block of rowBlocks) {
        let laneIndex = laneEnds.findIndex((laneEnd) => laneEnd <= block._startMin);
        if (laneIndex === -1) {
          laneEnds.push(block._endMin);
          laneIndex = laneEnds.length - 1;
        } else {
          laneEnds[laneIndex] = block._endMin;
        }
        block.laneIndex = laneIndex;
      }
      const laneCount = Math.max(1, laneEnds.length);
      for (const block of rowBlocks) {
        block.laneCount = laneCount;
      }
    }

    return blocks;
  }, [cells, unassignedBookings, startMin, slotInterval, tables, SLOT_WIDTH, isToday, nowMinutes]);

  const filteredBlocks = useMemo(() => {
    let blocks = bookingBlocks.filter((b) => b.status !== 'Cancelled' && b.status !== 'No-Show');
    if (statusFilter) blocks = blocks.filter((b) => b.status === statusFilter);
    return blocks;
  }, [bookingBlocks, statusFilter]);

  const moveSuggestionsByBookingId = useMemo(() => {
    const suggestions = new Map<string, MoveSuggestion>();
    if (!isToday) return suggestions;

    const activeBlocks = bookingBlocks.filter((block) => block.status !== 'Cancelled' && block.status !== 'No-Show');
    const blocksByTable = new Map<string, BookingBlock[]>();
    for (const block of activeBlocks) {
      if (!block.table_id) continue;
      const list = blocksByTable.get(block.table_id) ?? [];
      list.push(block);
      blocksByTable.set(block.table_id, list);
    }
    for (const list of blocksByTable.values()) {
      list.sort((a, b) => a._startMin - b._startMin || a._endMin - b._endMin);
    }

    const isLiveOverrun = (block: BookingBlock) =>
      (block.status === 'Seated' || block.status === 'Arrived') &&
      block._endMin > block._scheduledEndMin;

    const combinationTables: CombinationTable[] = tables.map((table) => ({
      id: table.id,
      name: table.name,
      max_covers: table.max_covers,
      is_active: table.is_active,
      position_x: table.position_x,
      position_y: table.position_y,
      width: table.width,
      height: table.height,
      rotation: table.rotation,
    }));
    const adjacencyMap = detectAdjacentTables(combinationTables, combinationThreshold);
    const manualCombinations: ManualCombination[] = (combinations ?? [])
      .filter((combo) => !combo.id.startsWith('auto_'))
      .map((combo) => ({
        id: combo.id,
        name: combo.name,
        table_ids: combo.table_ids,
        combined_min_covers: combo.combined_min_covers ?? 1,
        combined_max_covers: combo.combined_max_covers,
        is_active: true,
      }));
    const combinationBookingsById = new Map<string, CombinationBooking>();
    for (const block of activeBlocks) {
      if (!block.table_id) continue;
      const booking = combinationBookingsById.get(block.id) ?? {
        id: block.id,
        status: block.status,
        booking_time: block.start_time,
        estimated_end_time: minutesToTime(block._endMin),
        table_ids: [],
      };
      for (const tableId of block.table_ids.length > 0 ? block.table_ids : [block.table_id]) {
        if (!booking.table_ids.includes(tableId)) booking.table_ids.push(tableId);
      }
      combinationBookingsById.set(block.id, booking);
    }
    const combinationBlocks: CombinationBlock[] = cells
      .filter((cell) => cell.is_blocked)
      .map((cell) => ({
        table_id: cell.table_id,
        start_at: `${currentDate}T${cell.time.slice(0, 5)}:00.000Z`,
        end_at: `${currentDate}T${minutesToTime(timeToMinutes(cell.time.slice(0, 5)) + slotInterval)}:00.000Z`,
      }));

    const findTargetCandidate = (booking: BookingBlock) => {
      const durationMinutes = Math.max(slotInterval, booking._scheduledEndMin - booking._startMin);
      return findValidCombinations({
        partySize: booking.party_size,
        datetime: `${currentDate}T${booking.start_time.slice(0, 5)}:00.000Z`,
        durationMinutes,
        tables: combinationTables,
        bookings: Array.from(combinationBookingsById.values()),
        blocks: combinationBlocks,
        adjacencyMap,
        manualCombinations,
        bookingContext: {
          bookingDate: currentDate,
          bookingTime: booking.start_time.slice(0, 5),
          bookingModel: 'table_reservation',
        },
        excludeBookingId: booking.id,
      }).find((candidate) => !candidate.requires_manager_approval);
    };

    for (const rowBlocks of blocksByTable.values()) {
      for (let index = 1; index < rowBlocks.length; index += 1) {
        const next = rowBlocks[index]!;
        if (suggestions.has(next.id)) continue;
        if (next.status === 'Completed') continue;
        const previousOverrun = rowBlocks
          .slice(0, index)
          .reverse()
          .find((previous) =>
            previous.id !== next.id &&
            isLiveOverrun(previous) &&
            previous._scheduledEndMin <= next._startMin &&
            previous._endMin > next._startMin
          );
        if (!previousOverrun) continue;

        const target = findTargetCandidate(next);
        if (!target) continue;
        const style = MOVE_SUGGESTION_STYLES[suggestions.size % MOVE_SUGGESTION_STYLES.length]!;
        suggestions.set(next.id, {
          id: `${next.id}-${target.table_ids.join('-')}`,
          bookingId: next.id,
          guestName: next.guest_name,
          targetTableIds: target.table_ids,
          targetTableName: target.table_names.join(' + '),
          dotClassName: style.dot,
          buttonClassName: style.button,
        });
      }
    }

    return suggestions;
  }, [bookingBlocks, cells, combinationThreshold, combinations, currentDate, isToday, slotInterval, tables]);

  const tableMoveSuggestionIndicators = useMemo(() => {
    const indicators = new Map<string, MoveSuggestion[]>();
    const visibleBookingIds = new Set(filteredBlocks.map((block) => block.id));
    for (const suggestion of moveSuggestionsByBookingId.values()) {
      if (!visibleBookingIds.has(suggestion.bookingId)) continue;
      for (const tableId of suggestion.targetTableIds) {
        const list = indicators.get(tableId) ?? [];
        list.push(suggestion);
        indicators.set(tableId, list);
      }
    }
    return indicators;
  }, [filteredBlocks, moveSuggestionsByBookingId]);

  const unassignedBlocks = useMemo(() => {
    const list = filteredBlocks.filter((b) => !b.table_id);
    return [...list].sort((a, b) => {
      if (a._startMin !== b._startMin) return a._startMin - b._startMin;
      return a.id.localeCompare(b.id);
    });
  }, [filteredBlocks]);

  const cellMap = useMemo(() => {
    const map = new Map<string, TableGridCell>();
    for (const cell of cells) {
      map.set(`${cell.table_id}__${cell.time}`, cell);
    }
    return map;
  }, [cells]);

  useEffect(() => {
    if (!isToday) return;
    if (scrollRef.current) {
      const now = new Date();
      const currentMin = now.getHours() * 60 + now.getMinutes();
      const colIndex = Math.floor((currentMin - startMin) / slotInterval);
      if (colIndex > 0) {
        scrollRef.current.scrollLeft = Math.max(0, colIndex * SLOT_WIDTH - 200);
      }
    }
  }, [isToday, startMin, slotInterval, SLOT_WIDTH]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const mainEl = el.closest('main');

    const sync = () => {
      const node = scrollRef.current;
      if (!node) return;
      const main = node.closest('main');
      if (!main) {
        setScrollTop(node.scrollTop);
        setViewportHeight(node.clientHeight);
        return;
      }
      const mainRect = main.getBoundingClientRect();
      const elRect = node.getBoundingClientRect();
      const st = Math.max(0, mainRect.top - elRect.top);
      setScrollTop(st);
      const clipTop = Math.max(0, mainRect.top - elRect.top);
      const clipBottom = Math.min(node.offsetHeight, mainRect.bottom - elRect.top);
      setViewportHeight(Math.max(0, clipBottom - clipTop));
    };

    sync();
    el.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    mainEl?.addEventListener('scroll', sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);

    return () => {
      el.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      mainEl?.removeEventListener('scroll', sync);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    const root = timelineRootRef.current;
    if (!root) return;

    const onWheel = (e: WheelEvent) => {
      const node = scrollRef.current;
      const main = node?.closest('main');
      if (!node || !main) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        node.scrollLeft += e.deltaX;
        e.preventDefault();
        return;
      }
      if (e.deltaY !== 0) {
        main.scrollBy({ top: e.deltaY });
        e.preventDefault();
      }
    };

    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    if (!isToday) return;
    const interval = window.setInterval(() => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
    }, 60000);
    return () => window.clearInterval(interval);
  }, [isToday]);

  const currentTimeOffset = useMemo(() => {
    return ((nowMinutes - startMin) / slotInterval) * SLOT_WIDTH;
  }, [nowMinutes, startMin, slotInterval, SLOT_WIDTH]);
  const currentTimeLabel = useMemo(() => minutesToTime(nowMinutes), [nowMinutes]);

  /** Stricter touch activation reduces accidental moves while panning the timeline on phones/tablets. */
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 12 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 450,
        tolerance: 4,
      },
    }),
  );

  const [coarsePointer, setCoarsePointer] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(pointer: coarse)');
    const sync = () => setCoarsePointer(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setContextMenu(null);
    cancelQueuedDragPreview();
    const bookingId = String(event.active.id).split('__')[0] ?? String(event.active.id);
    const block = filteredBlocks.find((b) => b.id === bookingId);
    if (block) {
      emitVisualInteraction(true);
      activeDragRef.current = block;
      setActiveDrag(block);
      onDragValidation(block);
    }
  }, [cancelQueuedDragPreview, filteredBlocks, onDragValidation]);

  const handleDragCancel = useCallback(() => {
    setContextMenu(null);
    cancelQueuedDragPreview();
    setTimeDragTarget(null);
    activeDragRef.current = null;
    setActiveDrag(null);
    emitVisualInteraction(false);
    onDragValidation(null);
  }, [cancelQueuedDragPreview, onDragValidation]);

  const getBlockDurationMinutes = useCallback((block: BookingBlock) => {
    const start = timeToMinutes(block.start_time);
    const end = block.end_time ? timeToMinutes(block.end_time) : start + 90;
    return Math.max(15, end - start);
  }, []);

  const confirmAction = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmDialog({ message, resolve });
    });
  }, []);

  const isInvalidTimeTarget = useCallback((tableId: string, time: string, block: BookingBlock): boolean => {
    const duration = getBlockDurationMinutes(block);
    const candidateStart = timeToMinutes(time);
    const candidateEnd = candidateStart + duration;

    const targetCell = cellMap.get(`${tableId}__${time}`);
    if (targetCell?.is_blocked) return true;

    for (const cell of cells) {
      if (!cell.booking_id || !cell.booking_details) continue;
      if (cell.booking_id === block.id) continue;
      if (cell.table_id !== tableId) continue;

      const existingStart = timeToMinutes(cell.booking_details.start_time);
      const existingEnd = cell.booking_details.end_time
        ? timeToMinutes(cell.booking_details.end_time)
        : existingStart + 90;
      if (candidateStart < existingEnd && candidateEnd > existingStart) {
        return true;
      }
    }

    return false;
  }, [cells, cellMap, getBlockDurationMinutes]);

  const resolveTargetTableIds = useCallback((targetTableId: string, block: BookingBlock): string[] | null => {
    const context = {
      id: block.id,
      party_size: block.party_size,
      start_time: block.start_time,
      end_time: block.end_time ?? '',
    };
    const tableInfos = tables.map((t) => ({
      id: t.id, name: t.name, max_covers: t.max_covers,
      position_x: t.position_x, position_y: t.position_y,
      width: t.width, height: t.height, rotation: t.rotation,
    }));
    return resolveDropTarget(targetTableId, context, tableInfos, cells, combinations ?? []);
  }, [tables, cells, combinations]);

  const snappedTimeFromDragDelta = useCallback((block: BookingBlock, deltaX: number): string => {
    const rawLeftPx = Math.max(0, block.leftPx + deltaX);
    const slotIndex = Math.max(0, Math.min(timeSlots.length - 1, Math.floor(rawLeftPx / SLOT_WIDTH)));
    return minutesToTime(startMin + slotIndex * slotInterval);
  }, [SLOT_WIDTH, slotInterval, startMin, timeSlots.length]);

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    setContextMenu((prev) => (prev ? null : prev));

    const block = activeDragRef.current;
    const overId = event.over?.id != null ? String(event.over.id) : '';

    if (!block || !overId) {
      queueDragDropPreview(null);
      setTimeDragTarget(null);
      return;
    }

    if (overId.startsWith('cell_')) {
      const m = overId.match(CELL_DROP_ID_REGEX);
      if (!m) {
        queueDragDropPreview(null);
        setTimeDragTarget(null);
        return;
      }

      const tableId = m[1] ?? '';
      const time = m[2] ?? '';
      const targetCell = cellMap.get(`${tableId}__${time}`);
      const blocked = Boolean(targetCell?.is_blocked);
      const isTableMove = !block.table_ids.includes(tableId);

      if (isTableMove) {
        const targetTableIds = resolveTargetTableIds(tableId, block);
        const invalid = blocked || !targetTableIds || targetTableIds.length === 0;
        const label = formatTargetTableLabel(targetTableIds, tableId, tables);
        queueDragDropPreview({ kind: 'table', label, invalid });
        setTimeDragTarget(null);
        return;
      }

      const snappedTime = snappedTimeFromDragDelta(block, event.delta.x);
      const previewTableIds = block.table_ids.length > 0 ? block.table_ids : [tableId];
      const invalid = previewTableIds.some((previewTableId) => {
        const snappedCell = cellMap.get(`${previewTableId}__${snappedTime}`);
        return Boolean(snappedCell?.is_blocked) || isInvalidTimeTarget(previewTableId, snappedTime, block);
      });
      queueDragDropPreview({ kind: 'time', time: snappedTime, invalid });
      const start = timeToMinutes(snappedTime);
      setTimeDragTarget({
        tableIds: previewTableIds,
        startMin: start,
        endMin: start + getBlockDurationMinutes(block),
        invalid,
      });
      return;
    }

    if (overId.startsWith('table_')) {
      const tableId = overId.replace('table_', '');
      if (!tableId) {
        queueDragDropPreview(null);
        setTimeDragTarget(null);
        return;
      }
      const isTableMove = !block.table_ids.includes(tableId);
      if (!isTableMove) {
        queueDragDropPreview(null);
        setTimeDragTarget(null);
        return;
      }
      const targetTableIds = resolveTargetTableIds(tableId, block);
      const invalid = !targetTableIds || targetTableIds.length === 0;
      const label = formatTargetTableLabel(targetTableIds, tableId, tables);
      queueDragDropPreview({ kind: 'table', label, invalid });
      setTimeDragTarget(null);
      return;
    }

    queueDragDropPreview(null);
    setTimeDragTarget(null);
  }, [cellMap, getBlockDurationMinutes, isInvalidTimeTarget, queueDragDropPreview, resolveTargetTableIds, snappedTimeFromDragDelta, tables]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setContextMenu(null);
    cancelQueuedDragPreview();
    setTimeDragTarget(null);
    activeDragRef.current = null;
    setActiveDrag(null);
    emitVisualInteraction(false);
    onDragValidation(null);
    const { active, over } = event;
    if (!over) return;

    const dropId = over.id as string;
    const [bookingId] = String(active.id).split('__');
    const block = filteredBlocks.find((b) => b.id === bookingId);
    if (!block) return;

    if (dropId.startsWith('cell_')) {
      const [, tableId, time] = dropId.split('_');
      if (!tableId || !time) return;
      const targetCell = cellMap.get(`${tableId}__${time}`);
      if (targetCell?.is_blocked) {
        onError('Target slot is blocked');
        return;
      }
      const isTableMove = !block.table_ids.includes(tableId);

      if (isTableMove) {
        const targetTableIds = resolveTargetTableIds(tableId, block);
        if (!targetTableIds || targetTableIds.length === 0) {
          onError('No valid table or combination available for this party size');
          return;
        }
        const oldTableIds = block.table_ids.length > 0 ? block.table_ids : [];
        if (oldTableIds.length > 0) {
          onReassign(bookingId, oldTableIds, targetTableIds);
        } else {
          onAssign(bookingId, targetTableIds);
        }
        // Never change booking time when changing table - time updates only on same-table cell drops below.
        return;
      }

      const snappedTime = snappedTimeFromDragDelta(block, event.delta.x);
      const snappedCell = cellMap.get(`${tableId}__${snappedTime}`);
      if (snappedCell?.is_blocked || isInvalidTimeTarget(tableId, snappedTime, block)) {
        onError('Target time is not available');
        return;
      }
      if (snappedTime !== block.start_time.slice(0, 5)) {
        onTimeChange(bookingId, snappedTime);
      }
      return;
    }

    if (dropId.startsWith('table_')) {
      const newTableId = dropId.replace('table_', '');
      const targetTable = tables.find((t) => t.id === newTableId);
      if (!targetTable) return;
      if (block.table_ids.includes(newTableId)) return;

      const targetTableIds = resolveTargetTableIds(newTableId, block);
      if (!targetTableIds || targetTableIds.length === 0) {
        onError(`No valid target for party of ${block.party_size} at ${targetTable.name}`);
        return;
      }
      const oldTableIds = block.table_ids.length > 0 ? block.table_ids : [];
      if (oldTableIds.length > 0) {
        onReassign(bookingId, oldTableIds, targetTableIds);
      } else {
        onAssign(bookingId, targetTableIds);
      }
    }
  }, [cancelQueuedDragPreview, filteredBlocks, tables, onReassign, onTimeChange, onAssign, onError, onDragValidation, cellMap, resolveTargetTableIds, snappedTimeFromDragDelta, isInvalidTimeTarget]);

  const handleBookingPointerDown = useCallback((block: BookingBlock, clientX: number, clientY: number) => {
    bookingPointerDownRef.current = { bookingId: block.id, x: clientX, y: clientY };
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, block: BookingBlock) => {
    e.preventDefault();
    if (activeDragRef.current?.id === block.id) return;

    const ne = e.nativeEvent as PointerEvent | MouseEvent;
    const pointerType = 'pointerType' in ne ? ne.pointerType : 'mouse';
    if (pointerType === 'touch' || pointerType === 'pen') {
      const down = bookingPointerDownRef.current;
      if (down?.bookingId === block.id) {
        const dx = Math.abs(e.clientX - down.x);
        const dy = Math.abs(e.clientY - down.y);
        if (Math.max(dx, dy) > CONTEXT_MENU_MAX_POINTER_MOVE_PX) return;
      }
    }

    setContextMenu({ x: e.clientX, y: e.clientY, booking: block });
  }, []);

  const handleStatusChange = useCallback(async (bookingId: string, currentStatus: string, newStatus: string) => {
    setContextMenu(null);
    if (!isBookingStatus(currentStatus) || !isBookingStatus(newStatus)) return;
    if (!canTransitionBookingStatus(currentStatus, newStatus)) {
      onError(`Cannot change from ${currentStatus} to ${newStatus}`);
      return;
    }
    const block = filteredBlocks.find((b) => b.id === bookingId);
    const guest = block?.guest_name ?? 'Guest';
    const party = block?.party_size ?? '?';
    const time = block?.start_time?.slice(0, 5) ?? '';
    if (isRevertTransition(currentStatus, newStatus)) {
      const revertAction = BOOKING_REVERT_ACTIONS[currentStatus as BookingStatus];
      const confirmed = await confirmAction(`${guest} (${party}) at ${time} will be changed from ${currentStatus} back to ${newStatus}. ${revertAction?.label ?? 'Revert'}?`);
      if (!confirmed) return;
    } else if (isDestructiveBookingStatus(newStatus)) {
      const confirmed = await confirmAction(`${guest} (${party}) at ${time} will be marked ${newStatus}.`);
      if (!confirmed) return;
    }
    try {
      await onBookingStatusChange(bookingId, currentStatus, newStatus);
    } catch (err) {
      console.error('Status change failed:', err);
      onError('Failed to update status');
    }
  }, [onError, onBookingStatusChange, confirmAction, filteredBlocks]);

  const handleUnassignFromMenu = useCallback((bookingId: string) => {
    setContextMenu(null);
    onUnassign(bookingId);
  }, [onUnassign]);

  const handleSuggestedMove = useCallback((block: BookingBlock, suggestion: MoveSuggestion) => {
    if (block.table_ids.length > 0) {
      onReassign(block.id, block.table_ids, suggestion.targetTableIds);
      return;
    }
    onAssign(block.id, suggestion.targetTableIds);
  }, [onAssign, onReassign]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  useEffect(() => {
    const clearBookingPointer = () => {
      bookingPointerDownRef.current = null;
    };
    window.addEventListener('pointerup', clearBookingPointer);
    window.addEventListener('pointercancel', clearBookingPointer);
    return () => {
      window.removeEventListener('pointerup', clearBookingPointer);
      window.removeEventListener('pointercancel', clearBookingPointer);
    };
  }, []);

  const gridWidth = timeSlots.length * SLOT_WIDTH;
  const zones = useMemo(() => [...new Set(tables.map((t) => t.zone).filter(Boolean))] as string[], [tables]);
  const sortedTables = useMemo(() => {
    const baseSorted = zones.length === 0
      ? [...tables]
      : [...tables].sort((a, b) => {
          const zA = a.zone ?? '';
          const zB = b.zone ?? '';
          if (zA !== zB) return zA.localeCompare(zB);
          return a.sort_order - b.sort_order;
        });

    const comboGroupsByTable = new Map<string, string[]>();
    for (const block of bookingBlocks) {
      if (block.table_ids.length <= 1) continue;
      for (const tableId of block.table_ids) {
        if (!comboGroupsByTable.has(tableId)) {
          comboGroupsByTable.set(tableId, block.table_ids);
        }
      }
    }

    if (comboGroupsByTable.size === 0) return baseSorted;

    const placed = new Set<string>();
    const result: VenueTable[] = [];
    for (const table of baseSorted) {
      if (placed.has(table.id)) continue;
      result.push(table);
      placed.add(table.id);
      const comboIds = comboGroupsByTable.get(table.id);
      if (comboIds) {
        for (const comboId of comboIds) {
          if (placed.has(comboId)) continue;
          const comboTable = baseSorted.find((t) => t.id === comboId);
          if (comboTable) {
            result.push(comboTable);
            placed.add(comboId);
          }
        }
      }
    }
    return result;
  }, [tables, zones, bookingBlocks]);

  const rowEntries = useMemo(() => {
    const entries: Array<{ key: string; type: 'zone' | 'table'; height: number; table?: VenueTable; zone?: string }> = [];
    sortedTables.forEach((table, i) => {
      const prevTable = i > 0 ? sortedTables[i - 1] : null;
      const showZoneLabel = table.zone && table.zone !== prevTable?.zone;
      if (showZoneLabel) {
        entries.push({
          key: `zone-${table.zone}`,
          type: 'zone',
          height: 24,
          zone: table.zone ?? '',
        });
      }
      entries.push({
        key: `table-${table.id}`,
        type: 'table',
        height: ROW_HEIGHT,
        table,
      });
    });
    return entries;
  }, [sortedTables]);
  const shouldVirtualizeRows = sortedTables.length > 20;
  const visibleTop = Math.max(0, scrollTop - HEADER_HEIGHT);
  const renderTop = shouldVirtualizeRows ? Math.max(0, visibleTop - 300) : 0;
  const renderBottom = shouldVirtualizeRows ? visibleTop + viewportHeight + 300 : Number.MAX_SAFE_INTEGER;
  const visibleRowEntries = useMemo(() => {
    let y = 0;
    const visible: Array<{ key: string; type: 'zone' | 'table'; height: number; top: number; table?: VenueTable; zone?: string }> = [];
    for (const entry of rowEntries) {
      const top = y;
      const bottom = y + entry.height;
      if (bottom >= renderTop && top <= renderBottom) {
        visible.push({ ...entry, top });
      }
      y = bottom;
    }
    return visible;
  }, [rowEntries, renderTop, renderBottom]);
  const topSpacerHeight = visibleRowEntries.length > 0 ? visibleRowEntries[0]!.top : 0;
  const totalBodyHeight = rowEntries.reduce((sum, entry) => sum + entry.height, 0);
  const renderedBodyHeight = visibleRowEntries.reduce((sum, entry) => sum + entry.height, 0);
  const bottomSpacerHeight = Math.max(0, totalBodyHeight - topSpacerHeight - renderedBodyHeight);
  const unassignedSectionHeight =
    unassignedBlocks.length > 0 ? UNASSIGNED_HEADER_HEIGHT + unassignedBlocks.length * ROW_HEIGHT : 0;
  const timelineBodyScrollHeight = totalBodyHeight + unassignedSectionHeight;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={cellFirstTimelineCollision}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
      <div ref={timelineRootRef} className="flex w-full min-w-0">
        <div className="flex w-20 shrink-0 flex-col border-r border-slate-300 bg-gradient-to-r from-slate-100/90 to-slate-50/80 shadow-[4px_0_14px_rgba(15,23,42,0.05)] sm:w-28 md:w-[140px]">
          <div className="flex h-10 shrink-0 items-center border-b border-slate-300 bg-gradient-to-br from-white via-slate-50 to-slate-100/80 px-3 text-xs font-bold uppercase tracking-wide text-slate-500">
            Tables
          </div>
          <div className="flex flex-col">
            <div style={{ height: topSpacerHeight }} />
            {visibleRowEntries.map((entry) => {
              if (entry.type === 'zone') {
                return (
                  <div key={entry.key} className="flex h-6 items-center border-b border-slate-200 bg-gradient-to-r from-slate-100 via-slate-50 to-white px-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    {entry.zone}
                  </div>
                );
              }
              const table = entry.table!;
              const isSourceTable = activeDrag ? activeDrag.table_ids.includes(table.id) : false;
              const isValid = validDropTargets && !isSourceTable ? validDropTargets.has(table.id) : null;
              const comboLabel = validDropCombos?.get(table.id);
              return (
                <TableRowHeader
                  key={entry.key}
                  table={table}
                  isValidTarget={isValid}
                  comboLabel={comboLabel}
                  moveIndicators={tableMoveSuggestionIndicators.get(table.id) ?? []}
                />
              );
            })}
            <div style={{ height: bottomSpacerHeight }} />
            {unassignedBlocks.length > 0 && (
              <>
                <div
                  className="flex min-w-0 flex-col justify-center gap-1 border-b border-emerald-100 bg-emerald-50 px-1.5 py-1.5 sm:gap-1.5 sm:px-2 sm:py-2 md:px-3"
                  style={{ height: UNASSIGNED_HEADER_HEIGHT }}
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Unassigned</span>
                  {onAssignAllUnassigned && unassignedBookings.length > 0 && (
                    <button
                      type="button"
                      onClick={onAssignAllUnassigned}
                      disabled={assignAllUnassignedLoading}
                      className="w-full shrink-0 rounded-md border border-emerald-200 bg-white px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-emerald-800 shadow-sm hover:bg-emerald-100/80 disabled:opacity-50"
                    >
                      {assignAllUnassignedLoading ? 'Assigning...' : 'Assign All'}
                    </button>
                  )}
                </div>
                {unassignedBlocks.map((block) => (
                  <div
                    key={block.id}
                    className="flex min-w-0 flex-col justify-center border-b border-emerald-100 bg-emerald-50/60 px-1.5 py-0.5 sm:px-2 md:px-3"
                    style={{ height: ROW_HEIGHT }}
                  >
                    <span className="truncate text-[10px] font-semibold text-emerald-900 sm:text-xs">{block.guest_name}</span>
                    <span className="truncate text-[9px] text-emerald-700 sm:text-[10px]">
                      {block.start_time.slice(0, 5)} · {block.party_size} pax
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        <div
          ref={scrollRef}
          className="min-w-0 flex-1 touch-pan-x touch-manipulation overflow-x-auto overscroll-x-contain"
        >
          <div style={{ width: gridWidth, position: 'relative' }}>
            <div
              className="sticky top-0 z-10 border-b border-slate-300 bg-gradient-to-br from-white via-slate-50 to-slate-100/90 shadow-sm shadow-slate-900/5"
              style={{ height: HEADER_HEIGHT }}
            >
              <div className="flex h-full">
                {timeSlots.map((time) => {
                  const minutes = timeToMinutes(time);
                  const isHourStart = minutes % 60 === 0;
                  const isHalfHourStart = minutes % 30 === 0;
                  return (
                    <div
                      key={time}
                      className={`shrink-0 border-r ${
                        isHourStart
                          ? 'border-l border-l-slate-400 border-r-slate-200'
                          : isHalfHourStart
                            ? 'border-l border-l-slate-300 border-r-slate-200/80'
                            : 'border-slate-200/70'
                      }`}
                      style={{ width: SLOT_WIDTH }}
                      aria-hidden
                    />
                  );
                })}
              </div>
              <div className="pointer-events-none absolute inset-0">
                {hourMarkers.map((marker) => (
                  <span
                    key={marker.time}
                    className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-slate-200/80 bg-white/90 px-1.5 py-0.5 text-xs font-bold tabular-nums text-slate-600 shadow-sm shadow-slate-900/5"
                    style={{ left: marker.leftPx }}
                  >
                    {marker.time}
                  </span>
                ))}
              </div>
            </div>

            {isToday && currentTimeOffset > 0 && currentTimeOffset < gridWidth && (
              <div
                className="pointer-events-none absolute z-20 w-px bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.45)]"
                style={{
                  left: currentTimeOffset,
                  top: 0,
                  height: HEADER_HEIGHT + timelineBodyScrollHeight,
                }}
              >
                <span className="absolute top-1 -translate-x-1/2 whitespace-nowrap rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold tabular-nums text-white shadow-md shadow-red-600/20">
                  Now {currentTimeLabel}
                </span>
              </div>
            )}

            <div style={{ height: topSpacerHeight }} />
            {visibleRowEntries.map((entry) => {
              if (entry.type === 'zone') {
                return <div key={entry.key} style={{ height: 24 }} />;
              }
              const table = entry.table!;
              const tableBlocks = filteredBlocks.filter((b) => b.table_id === table.id);
              const isSourceTable = activeDrag ? activeDrag.table_ids.includes(table.id) : false;
              const isValid = validDropTargets && !isSourceTable ? validDropTargets.has(table.id) : null;
              return (
                <DroppableRow key={entry.key} tableId={table.id} width={gridWidth} height={ROW_HEIGHT} isValidTarget={isValid}>
                  {timeSlots.map((time) => (
                    (() => {
                      const cell = cellMap.get(`${table.id}__${time}`);
                      const blocked = Boolean(cell?.is_blocked);
                      const dragInvalid = Boolean(
                        activeDrag &&
                        activeDrag.table_id === table.id &&
                        isInvalidTimeTarget(table.id, time, activeDrag)
                      );
                      const cellStartMin = timeToMinutes(time);
                      const dropPreview = timeDragTarget;
                      const isTimeDropPreview =
                        dropPreview !== null &&
                        dropPreview.tableIds.includes(table.id) &&
                        cellStartMin >= dropPreview.startMin &&
                        cellStartMin < dropPreview.endMin;
                      const gridLineClass = timelineGridLineClass(cellStartMin);
                      const timeBlockBandClass = timelineTimeBlockBandClass(cellStartMin, startMin, slotInterval);
                      return (
                        <DroppableCell
                          key={time}
                          droppableId={`cell_${table.id}_${time}`}
                          onClick={(e) => {
                            if (cell?.block_id) {
                              onBlockClick(cell.block_id);
                              return;
                            }
                            if (!cell?.booking_id) {
                              onCellClick(table.id, time, { x: e.clientX, y: e.clientY });
                            }
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            onCellContextMenu(table.id, time, e.clientX, e.clientY);
                          }}
                          className={`shrink-0 border-b border-r ${gridLineClass} transition-colors ${
                            isTimeDropPreview
                              ? dropPreview.invalid
                                ? 'border-amber-300 bg-amber-100/90 ring-1 ring-inset ring-amber-400'
                                : 'border-emerald-300 bg-emerald-100/90 ring-1 ring-inset ring-emerald-400'
                            : blocked
                              ? 'border-slate-300 bg-slate-200/80'
                              : dragInvalid
                                ? 'border-red-200 bg-red-50/70'
                              : `border-slate-200/70 ${timeBlockBandClass} hover:bg-brand-50/40`
                          }`}
                          style={{
                            width: SLOT_WIDTH,
                            height: ROW_HEIGHT,
                            backgroundImage: blocked
                              ? 'repeating-linear-gradient(135deg, rgba(71,85,105,0.22) 0, rgba(71,85,105,0.22) 4px, rgba(148,163,184,0.18) 4px, rgba(148,163,184,0.18) 8px)'
                              : undefined,
                          }}
                          title={blocked ? cell?.block_details?.reason ?? 'Blocked' : undefined}
                        />
                      );
                    })()
                  ))}
                  {tableBlocks.map((block) => (
                    <DraggableBlock
                      key={`${block.id}-${block.table_id}`}
                      block={block}
                      dragId={`${block.id}__${block.table_id}`}
                      slotWidth={SLOT_WIDTH}
                      slotMinutes={slotInterval}
                      rowHeight={ROW_HEIGHT}
                      highlighted={highlightedBookingIds.has(block.id)}
                      isMultiTable={block.table_ids.length > 1}
                      useDragHandle={coarsePointer}
                      onContextMenu={handleContextMenu}
                      onBookingPointerDown={handleBookingPointerDown}
                      onClick={onBookingClick}
                      onQuickStatusChange={(nextStatus) => { void handleStatusChange(block.id, block.status, nextStatus); }}
                      resizeVisual={resizeVisual}
                      onResizeVisual={setResizeVisual}
                      activeDragBookingId={activeDrag?.id ?? null}
                      moveSuggestion={moveSuggestionsByBookingId.get(block.id)}
                      onSuggestedMove={handleSuggestedMove}
                    />
                  ))}
                </DroppableRow>
              );
            })}
            <div style={{ height: bottomSpacerHeight }} />

            {unassignedBlocks.length > 0 && (
              <>
                <div
                  className="flex shrink-0 border-b border-emerald-200 bg-emerald-50"
                  style={{ width: gridWidth, height: UNASSIGNED_HEADER_HEIGHT }}
                >
                  {timeSlots.map((time) => {
                    const cellStartMin = timeToMinutes(time);
                    const gridLineClass = timelineGridLineClass(cellStartMin, 'emerald');
                    const timeBlockBandClass = timelineTimeBlockBandClass(cellStartMin, startMin, slotInterval, 'emerald');
                    return (
                    <div
                      key={time}
                      className={`shrink-0 border-r border-emerald-200/70 ${gridLineClass} ${timeBlockBandClass}`}
                      style={{ width: SLOT_WIDTH, height: UNASSIGNED_HEADER_HEIGHT }}
                    />
                    );
                  })}
                </div>
                {unassignedBlocks.map((block) => (
                  <div key={block.id} className="relative flex shrink-0 bg-emerald-50/30" style={{ width: gridWidth, height: ROW_HEIGHT }}>
                    {timeSlots.map((time) => {
                      const cellStartMin = timeToMinutes(time);
                      const dropPreview = timeDragTarget;
                      const isTimeDropPreview =
                        dropPreview !== null &&
                        dropPreview.tableIds.includes('__unassigned__') &&
                        cellStartMin >= dropPreview.startMin &&
                        cellStartMin < dropPreview.endMin;
                      const gridLineClass = timelineGridLineClass(cellStartMin, 'emerald');
                      const timeBlockBandClass = timelineTimeBlockBandClass(cellStartMin, startMin, slotInterval, 'emerald');
                      return (
                        <div
                          key={time}
                          className={`shrink-0 border-b border-r ${gridLineClass} transition-colors ${
                            isTimeDropPreview
                              ? dropPreview.invalid
                                ? 'border-amber-300 bg-amber-100/90 ring-1 ring-inset ring-amber-400'
                                : 'border-emerald-300 bg-emerald-100/90 ring-1 ring-inset ring-emerald-400'
                              : `border-emerald-200/70 ${timeBlockBandClass}`
                          }`}
                          style={{ width: SLOT_WIDTH, height: ROW_HEIGHT }}
                        />
                      );
                    })}
                    <DraggableBlock
                      block={{ ...block, laneIndex: 0, laneCount: 1, rowSpan: 1 }}
                      dragId={`${block.id}__unassigned`}
                      slotWidth={SLOT_WIDTH}
                      slotMinutes={slotInterval}
                      rowHeight={ROW_HEIGHT}
                      highlighted={highlightedBookingIds.has(block.id)}
                      isMultiTable={false}
                      useDragHandle={coarsePointer}
                      onContextMenu={handleContextMenu}
                      onBookingPointerDown={handleBookingPointerDown}
                      onClick={onBookingClick}
                      onQuickStatusChange={(nextStatus) => { void handleStatusChange(block.id, block.status, nextStatus); }}
                      resizeVisual={resizeVisual}
                      onResizeVisual={setResizeVisual}
                      activeDragBookingId={activeDrag?.id ?? null}
                      moveSuggestion={moveSuggestionsByBookingId.get(block.id)}
                      onSuggestedMove={handleSuggestedMove}
                    />
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      <DragOverlay className="overflow-visible">
        {activeDrag && (
          <div className="flex flex-col gap-0.5 overflow-visible">
            <div className="relative inline-block max-w-[min(100vw-2rem,20rem)] overflow-visible">
              {dragDropPreview && (
                <div
                  className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-max max-w-[90vw] -translate-x-1/2"
                  aria-live="polite"
                >
                  <span
                    className={`inline-block max-w-[min(90vw,18rem)] truncate rounded-md px-2 py-1 text-center text-[11px] font-semibold shadow-md ${
                      dragDropPreview.kind === 'time' ? 'tabular-nums' : ''
                    } ${
                      dragDropPreview.invalid
                        ? 'bg-red-600 text-white'
                        : 'bg-slate-900 text-white'
                    }`}
                  >
                    {dragDropPreview.kind === 'time'
                      ? `Move to ${dragDropPreview.time}`
                      : `Move to ${dragDropPreview.label}`}
                  </span>
                </div>
              )}
              <div
                className={`flex flex-col gap-0.5 rounded-lg border border-l-[3px] px-2.5 py-1.5 text-xs font-medium shadow-lg ${
                  STATUS_COLORS[statusColorKeyForBooking(activeDrag)] ?? 'bg-slate-100 border-slate-300 text-slate-800'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span>{activeDrag.guest_name}</span>
                  <span className="rounded-full bg-white/60 px-1.5 py-0.5 text-[10px] font-bold">
                    {activeDrag.party_size}
                  </span>
                </div>
              </div>
            </div>
            {activeDrag.table_ids.length > 1 && (
              <span className="text-[10px] font-semibold text-purple-700">
                🔗 Moving {activeDrag.table_names.join(' + ')} together
              </span>
            )}
          </div>
        )}
      </DragOverlay>

      {contextMenu && bookingContextMenuStyle ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 rounded-2xl border border-slate-200/80 bg-white py-1 shadow-xl shadow-slate-900/15 ring-1 ring-slate-100"
            style={bookingContextMenuStyle}
          >
            <div className="border-b border-slate-100 px-3 py-2">
              <p className="text-xs font-semibold text-slate-900">{contextMenu.booking.guest_name}</p>
              <p className="text-[10px] text-slate-500">
                Party of {contextMenu.booking.party_size} · {contextMenu.booking.start_time.slice(0, 5)}
                {contextMenu.booking.table_ids.length > 1 && (
                  <span className="ml-1 text-purple-600">· Combination</span>
                )}
              </p>
            </div>
            <div className="py-1">
              <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Status</p>
              {(BOOKING_STATUS_TRANSITIONS[contextMenu.booking.status as BookingStatus] ?? BOOKING_STATUSES).map((status) => {
                const revert = isRevertTransition(contextMenu.booking.status, status);
                const revertLabel = revert ? BOOKING_REVERT_ACTIONS[contextMenu.booking.status as BookingStatus]?.label : null;
                return (
                <button
                  key={status}
                  onClick={() => { void handleStatusChange(contextMenu.booking.id, contextMenu.booking.status, status); }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-40 ${revert ? 'font-semibold text-amber-800' : 'text-slate-700'}`}
                  disabled={contextMenu.booking.status === status}
                >
                  <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOTS[status] ?? 'bg-slate-400'}`} />
                  {revertLabel ?? status}
                </button>
                );
              })}
            </div>
            <div className="border-t border-slate-100 py-1">
              <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Duration</p>
              <button
                onClick={() => {
                  const currentEnd = contextMenu.booking.end_time
                    ? timeToMinutes(contextMenu.booking.end_time.slice(0, 5))
                    : timeToMinutes(contextMenu.booking.start_time.slice(0, 5)) + 90;
                  onResizeBooking(contextMenu.booking.id, minutesToTime(currentEnd + 15));
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
              >
                Extend +15m
              </button>
              <button
                onClick={() => {
                  const start = timeToMinutes(contextMenu.booking.start_time.slice(0, 5));
                  const currentEnd = contextMenu.booking.end_time
                    ? timeToMinutes(contextMenu.booking.end_time.slice(0, 5))
                    : start + 90;
                  const nextEnd = Math.max(start + 15, currentEnd - 15);
                  onResizeBooking(contextMenu.booking.id, minutesToTime(nextEnd));
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
              >
                Shorten -15m
              </button>
            </div>
            {contextMenu.booking.table_id && (
              <div className="border-t border-slate-100 py-1">
                <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Table</p>
                <button
                  onClick={() => {
                    onEditBooking(contextMenu.booking.id);
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                >
                  Edit Booking
                </button>
                <button
                  onClick={() => {
                    onSendMessage(contextMenu.booking.id);
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                >
                  Send Message to Guest
                </button>
                <button
                  onClick={() => {
                    onMoveBooking(contextMenu.booking.id);
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                >
                  Move to Table
                </button>
                <button
                  onClick={() => {
                    onRescheduleBooking(contextMenu.booking.id);
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                >
                  Reschedule
                </button>
                {contextMenu.booking.status !== 'Cancelled' && (
                  <button
                    onClick={async () => {
                      await handleStatusChange(contextMenu.booking.id, contextMenu.booking.status, 'Cancelled');
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
                  >
                    Cancel Booking
                  </button>
                )}
                <button
                  onClick={() => {
                    const endTime = contextMenu.booking.end_time
                      ? contextMenu.booking.end_time.slice(0, 5)
                      : contextMenu.booking.start_time.slice(0, 5);
                    onBlockAfterBooking(contextMenu.booking.table_id!, endTime);
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                >
                  Block Table After Booking
                </button>
                <button
                  onClick={() => handleUnassignFromMenu(contextMenu.booking.id)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Unassign from table
                </button>
              </div>
            )}
          </div>
        </>
      ) : null}
      {confirmDialog && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-slate-900/25 backdrop-blur-[2px]"
            onClick={() => {
              confirmDialog.resolve(false);
              setConfirmDialog(null);
            }}
          />
          <div className="fixed left-1/2 top-1/2 z-[61] w-[min(calc(100vw-2rem),20rem)] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100">
            <p className="text-sm text-slate-800">{confirmDialog.message}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  confirmDialog.resolve(false);
                  setConfirmDialog(null);
                }}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmDialog.resolve(true);
                  setConfirmDialog(null);
                }}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
              >
                Confirm
              </button>
            </div>
          </div>
        </>
      )}
    </DndContext>
  );
}

function TableRowHeader({
  table,
  isValidTarget,
  comboLabel,
  moveIndicators,
}: {
  table: VenueTable;
  isValidTarget: boolean | null;
  comboLabel?: string;
  moveIndicators: MoveSuggestion[];
}) {
  const targetStateClass =
    isValidTarget === true
      ? 'border-emerald-300/80 bg-emerald-100/90 shadow-[inset_3px_0_0_rgba(16,185,129,0.75)]'
      : isValidTarget === false
        ? 'border-slate-200/90 bg-slate-100/70 opacity-50'
        : 'border-slate-200/90 bg-white/60 hover:bg-white';

  return (
    <div
      className={`flex flex-col justify-center border-b px-1.5 transition-colors sm:px-3 ${targetStateClass}`}
      style={{ height: ROW_HEIGHT }}
    >
      <div className="flex items-center gap-1 sm:gap-2">
        <span className="truncate text-[10px] font-semibold text-slate-900 sm:text-xs">{table.name}</span>
        <span className="hidden rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 sm:inline-block">
          {table.max_covers}
        </span>
        {moveIndicators.length > 0 ? (
          <span className="flex shrink-0 items-center gap-0.5" aria-label="Suggested move destination">
            {moveIndicators.map((indicator) => (
              <span
                key={indicator.id}
                className={`h-2.5 w-2.5 rounded-full ring-2 ${indicator.dotClassName}`}
                title={`Move ${indicator.guestName} here`}
                aria-label={`Suggested destination for ${indicator.guestName}`}
              />
            ))}
          </span>
        ) : null}
      </div>
      {isValidTarget && comboLabel && (
        <span className="mt-0.5 text-[9px] font-semibold leading-tight text-green-700">
          → {comboLabel}
        </span>
      )}
    </div>
  );
}

function DroppableRow({ tableId, width, height, children, isValidTarget }: {
  tableId: string;
  width: number;
  height: number;
  children: React.ReactNode;
  isValidTarget: boolean | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `table_${tableId}` });

  let bgClass = '';
  if (isOver && isValidTarget === true) bgClass = 'bg-green-50/60 ring-1 ring-inset ring-green-400';
  else if (isOver && isValidTarget === false) bgClass = 'bg-red-50/40 ring-1 ring-inset ring-red-300';
  else if (isOver) bgClass = 'bg-brand-50/50 ring-1 ring-inset ring-brand-300';
  else if (isValidTarget === true) bgClass = 'bg-green-50/30';
  else if (isValidTarget === false) bgClass = 'opacity-60';

  return (
    <div
      ref={setNodeRef}
      className={`group/row relative flex ${bgClass} transition-shadow hover:shadow-[inset_0_1px_0_rgba(59,130,246,0.10),inset_0_-1px_0_rgba(59,130,246,0.10)]`}
      style={{ width, height }}
    >
      {children}
    </div>
  );
}

function DroppableCell({
  droppableId,
  className,
  style,
  title,
  onClick,
  onContextMenu,
}: {
  droppableId: string;
  className: string;
  style: React.CSSProperties;
  title?: string;
  onClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const { setNodeRef } = useDroppable({ id: droppableId });
  return (
    <div
      ref={setNodeRef}
      className={className}
      style={style}
      title={title}
      onClick={onClick}
      onContextMenu={onContextMenu}
    />
  );
}

function DraggableBlock({
  block,
  dragId,
  slotWidth,
  slotMinutes,
  rowHeight,
  highlighted,
  isMultiTable,
  useDragHandle,
  onContextMenu,
  onBookingPointerDown,
  onClick,
  onQuickStatusChange,
  resizeVisual,
  onResizeVisual,
  activeDragBookingId,
  moveSuggestion,
  onSuggestedMove,
}: {
  block: BookingBlock;
  dragId: string;
  slotWidth: number;
  /** Grid slot length in minutes; used for resize snapping and minimum duration. */
  slotMinutes: number;
  rowHeight: number;
  highlighted: boolean;
  isMultiTable: boolean;
  /** When true (coarse pointers), only the grip activates drag so timeline scroll does not move bookings. */
  useDragHandle: boolean;
  onContextMenu: (e: React.MouseEvent, block: BookingBlock) => void;
  onBookingPointerDown: (block: BookingBlock, clientX: number, clientY: number) => void;
  onClick: (bookingId: string, anchor: { x: number; y: number }) => void;
  onQuickStatusChange: (nextStatus: BookingStatus) => void;
  resizeVisual: { bookingId: string; deltaPx: number } | null;
  onResizeVisual: (state: { bookingId: string; deltaPx: number } | null) => void;
  activeDragBookingId: string | null;
  moveSuggestion?: MoveSuggestion;
  onSuggestedMove: (block: BookingBlock, suggestion: MoveSuggestion) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: dragId,
    disabled: block.status === 'Completed',
  });
  const resizingRef = useRef(false);
  const justResizedRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartEndRef = useRef(0);
  const resizeFrameRef = useRef<number | null>(null);
  const resizePendingVisualRef = useRef<{ bookingId: string; deltaPx: number } | null>(null);
  const resizePreviewEndRef = useRef<string | null>(null);
  const [resizePreviewEnd, setResizePreviewEnd] = useState<string | null>(null);

  const isConfirmed = isAttendanceConfirmed(block);
  const colorClass = STATUS_COLORS[statusColorKeyForBooking(block)] ?? 'bg-slate-100 border-slate-300 text-slate-800';
  const left = block.leftPx + 2;
  const resizeDelta = resizeVisual?.bookingId === block.id ? resizeVisual.deltaPx : 0;
  const width = Math.max(16, block.widthPx - 4 + resizeDelta);
  const isSiblingDragging = activeDragBookingId === block.id && !isDragging;
  const rowHeightForLane = Math.max(18, (rowHeight * Math.max(1, block.rowSpan) - 8) / Math.max(1, block.laneCount));
  const top = 1 + block.laneIndex * rowHeightForLane;
  const height = rowHeightForLane - 2;
  const isCondensed = width < 72;
  const comboLabel = block.table_names.length > 1 ? block.table_names.join('+') : '';
  const depositIcon = block.deposit_status === 'Paid' ? '£' : block.deposit_status === 'Pending' ? '!' : null;
  const primaryAction = isBookingStatus(block.status) ? BOOKING_PRIMARY_ACTIONS[block.status] : undefined;
  const primaryActionLabel =
    block.status === 'Pending' && primaryAction?.target === 'Booked' ? 'Book' : primaryAction?.label;
  const canConfirmBooking =
    isBookingStatus(block.status) &&
    canTransitionBookingStatus(block.status, 'Confirmed') &&
    !isConfirmed &&
    width >= 132;
  const canShowPrimaryAction =
    Boolean(primaryAction) &&
    width >= (canConfirmBooking && block.status === 'Booked' ? 184 : 132);
  const canShowMoveSuggestion = Boolean(moveSuggestion) && width >= 104;

  const startResize = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (block.status === 'Completed') return;
    e.stopPropagation();
    e.preventDefault();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (resizingRef.current) return;

    const pointerId = e.pointerId;
    const start = timeToMinutes(block.start_time.slice(0, 5));
    const currentEnd = block.end_time ? timeToMinutes(block.end_time.slice(0, 5)) : start + 90;
    const minEnd = start + slotMinutes;

    resizingRef.current = true;
    emitVisualInteraction(true);
    resizeStartXRef.current = e.clientX;
    resizeStartEndRef.current = currentEnd;
    resizePreviewEndRef.current = null;
    onResizeVisual({ bookingId: block.id, deltaPx: 0 });

    const target = e.currentTarget;
    try {
      target.setPointerCapture(pointerId);
    } catch {
      /* ignore if capture unsupported */
    }
    document.body.style.cursor = 'ew-resize';

    const flushResizeVisual = () => {
      resizeFrameRef.current = null;
      if (resizePendingVisualRef.current) {
        onResizeVisual(resizePendingVisualRef.current);
      }
    };

    const applyDeltaX = (clientX: number) => {
      const deltaX = clientX - resizeStartXRef.current;
      const minutesPerPixel = slotMinutes / slotWidth;
      const nextEnd = Math.max(minEnd, Math.round(resizeStartEndRef.current + deltaX * minutesPerPixel));
      const minDeltaPx = ((minEnd - resizeStartEndRef.current) / slotMinutes) * slotWidth;
      const clampedDeltaPx = Math.max(minDeltaPx, deltaX);
      const endStr = minutesToTime(nextEnd);
      if (resizePreviewEndRef.current !== endStr) {
        resizePreviewEndRef.current = endStr;
        setResizePreviewEnd(endStr);
      }
      resizePendingVisualRef.current = { bookingId: block.id, deltaPx: clampedDeltaPx };
      if (resizeFrameRef.current === null) {
        resizeFrameRef.current = window.requestAnimationFrame(flushResizeVisual);
      }
      return endStr;
    };

    const onMove = (ev: PointerEvent) => {
      if (!resizingRef.current || ev.pointerId !== pointerId) return;
      ev.preventDefault();
      applyDeltaX(ev.clientX);
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!resizingRef.current) return;

      const endStr = applyDeltaX(ev.clientX);
      document.body.style.cursor = '';
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        /* ignore */
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      resizingRef.current = false;
      justResizedRef.current = true;
      setTimeout(() => {
        justResizedRef.current = false;
      }, 200);

      window.dispatchEvent(
        new CustomEvent('timeline-resize-booking', {
          detail: { bookingId: block.id, endTime: endStr },
        }),
      );
      emitVisualInteraction(false);

      window.requestAnimationFrame(() => {
        resizePendingVisualRef.current = null;
        resizePreviewEndRef.current = null;
        setResizePreviewEnd(null);
        onResizeVisual(null);
      });
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  if (isSiblingDragging) {
    return (
      <div
        className="absolute flex items-center justify-center rounded-md border-2 border-dashed border-purple-400 bg-purple-50/40"
        style={{ left, top, width, height }}
      >
        <span className="text-[9px] font-semibold text-purple-500">Moving with combo</span>
      </div>
    );
  }

  const dragDisabled = block.status === 'Completed';
  const dragRootAttrs = dragDisabled ? {} : useDragHandle ? {} : { ...attributes };
  const dragListeners = dragDisabled ? {} : useDragHandle ? {} : { ...listeners };

  return (
    <div
      ref={setNodeRef}
      {...dragRootAttrs}
      onPointerDownCapture={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        onBookingPointerDown(block, e.clientX, e.clientY);
      }}
      onContextMenu={(e) => onContextMenu(e, block)}
      onClick={(e) => {
        if (!justResizedRef.current) {
          onClick(block.id, { x: e.clientX, y: e.clientY });
        }
      }}
      className={`absolute flex select-none items-center gap-0 overflow-hidden rounded-md border border-l-[3px] text-xs font-medium transition-colors duration-200 ease-out ${colorClass} ${
        dragDisabled ? 'cursor-default' : useDragHandle ? 'touch-manipulation' : 'touch-none cursor-grab active:cursor-grabbing'
      } ${isDragging ? 'z-30 opacity-50' : ''} ${highlighted ? 'ring-2 ring-amber-400 ring-offset-1' : ''} ${
        isMultiTable ? 'border-l-[3px] border-l-purple-500' : ''
      }`}
      style={{ left, top, width, height, WebkitTapHighlightColor: 'transparent' }}
      title={`${block.guest_name} · Party of ${block.party_size} · ${block.start_time.slice(0, 5)}–${block.end_time.slice(0, 5)}${block.status === 'Completed' ? ' · Completed' : ''}${isMultiTable ? ' · Table combination' : ''}`}
    >
      {useDragHandle && !dragDisabled && (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...listeners}
          {...attributes}
          className="flex h-full w-9 shrink-0 touch-none cursor-grab items-center justify-center border-r border-black/10 bg-black/[0.06] active:cursor-grabbing sm:w-7"
          aria-label={`Move booking: ${block.guest_name}`}
        >
          <span className="flex flex-col gap-0.5 text-slate-500" aria-hidden>
            <span className="block h-0.5 w-3 rounded-full bg-current sm:w-2.5" />
            <span className="block h-0.5 w-3 rounded-full bg-current sm:w-2.5" />
            <span className="block h-0.5 w-3 rounded-full bg-current sm:w-2.5" />
          </span>
        </button>
      )}
      <div
        {...dragListeners}
        className={`flex min-h-0 flex-1 items-center gap-1 overflow-hidden px-2 py-0.5 pr-1 ${useDragHandle || dragDisabled ? 'touch-manipulation' : 'touch-none'}`}
      >
        {isCondensed ? (
          <>
            <span className="text-[10px] font-semibold">{block.party_size}</span>
            {isConfirmed && (
              <span
                className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[8px] font-black lowercase leading-none text-white shadow-sm ring-1 ring-white/70"
                title="Confirmed"
              >
                c
              </span>
            )}
            {isMultiTable && <span className="text-[10px]" title="Linked combination booking">🔗</span>}
            {depositIcon && <span className="text-[10px]" title={`Deposit: ${block.deposit_status}`}>{depositIcon}</span>}
          </>
        ) : (
          <>
            <span className={`truncate ${block.status === 'Cancelled' ? 'line-through' : ''}`}>{block.guest_name}</span>
            <span className="shrink-0 text-[10px] opacity-80">{block.start_time.slice(0, 5)}</span>
            <span className="shrink-0 rounded-full bg-white/50 px-1 py-0.5 text-[10px] font-bold">
              {block.party_size}
            </span>
            {isConfirmed && (
              <span
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[9px] font-black lowercase leading-none text-white shadow-sm ring-1 ring-white/70"
                title="Confirmed"
              >
                c
              </span>
            )}
            {isMultiTable && (
              <span className="shrink-0 text-[10px]" title="Linked combination booking">🔗</span>
            )}
            {isMultiTable && (
              <span className="shrink-0 rounded bg-purple-100 px-1 py-0.5 text-[10px] font-semibold text-purple-700">
                {comboLabel}
              </span>
            )}
            {block.dietary_notes && (
              <span className="shrink-0 text-[10px]" title={block.dietary_notes}>🍽</span>
            )}
            {block.occasion && (
              <span className="shrink-0 text-[10px]" title={block.occasion}>🎉</span>
            )}
            {depositIcon && (
              <span className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold ${
                block.deposit_status === 'Paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
              }`} title={`Deposit: ${block.deposit_status}`}>
                {depositIcon}
              </span>
            )}
          </>
        )}
      </div>
      {(canShowMoveSuggestion || canConfirmBooking || canShowPrimaryAction) && (
        <div className="flex shrink-0 items-center gap-1 pr-1">
          {moveSuggestion && canShowMoveSuggestion && (
            <button
              type="button"
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSuggestedMove(block, moveSuggestion);
              }}
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold shadow-sm ring-1 ring-black/5 transition-colors focus:outline-none focus:ring-2 ${moveSuggestion.buttonClassName}`}
              aria-label={`Move ${block.guest_name} to ${moveSuggestion.targetTableName}`}
              title={`Move to ${moveSuggestion.targetTableName}`}
            >
              <span className={`h-2 w-2 rounded-full ring-1 ring-white/70 ${moveSuggestion.dotClassName}`} aria-hidden />
              Move
            </button>
          )}
          {canConfirmBooking && (
            <button
              type="button"
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                onQuickStatusChange('Confirmed');
              }}
              className="rounded-md bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm ring-1 ring-emerald-700/10 transition-colors hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-400/50"
              aria-label={`Confirm booking for ${block.guest_name}`}
            >
              Confirm
            </button>
          )}
          {primaryAction && canShowPrimaryAction && (
            <button
              type="button"
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                onQuickStatusChange(primaryAction.target);
              }}
              className="rounded-md bg-white/80 px-1.5 py-0.5 text-[10px] font-bold text-slate-800 shadow-sm ring-1 ring-black/5 transition-colors hover:bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40"
              aria-label={`${primaryActionLabel} booking for ${block.guest_name}`}
            >
              {primaryActionLabel}
            </button>
          )}
        </div>
      )}
      {!dragDisabled && (
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize end time for ${block.guest_name}`}
        onPointerDown={startResize}
        className="absolute right-0 top-0 z-[1] flex h-full min-h-[44px] min-w-[44px] max-w-[44px] cursor-ew-resize touch-none items-stretch justify-end bg-gradient-to-l from-black/25 to-transparent opacity-70 transition-opacity hover:opacity-100 sm:min-h-0 sm:min-w-0 sm:max-w-none sm:w-2 sm:bg-black/20"
        style={{ touchAction: 'none' }}
        title="Drag to resize end"
      />
      )}
      {!dragDisabled && resizePreviewEnd && (
        <span className="absolute -top-5 right-0 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-white">
          {resizePreviewEnd}
        </span>
      )}
    </div>
  );
}
