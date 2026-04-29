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

const STATUS_COLORS: Record<string, string> = {
  Pending: 'bg-amber-100 border-amber-300 text-amber-800',
  Booked: 'bg-sky-100 border-sky-300 text-sky-800',
  Confirmed: 'bg-emerald-100 border-emerald-300 text-emerald-800',
  Seated: 'bg-brand-100 border-brand-300 text-brand-900',
  Arrived: 'bg-emerald-100 border-emerald-300 text-emerald-800',
  Completed: 'bg-slate-100 border-slate-300 text-slate-600',
  'No-Show': 'bg-red-100 border-red-300 text-red-800',
  Cancelled: 'bg-slate-100 border-slate-300 text-slate-500',
  'Deposit Pending': 'bg-orange-100 border-orange-300 text-orange-800',
};

/** Touch/pen: if pointer moved more than this on X or Y before contextmenu, skip menu (drag intent). */
const CONTEXT_MENU_MAX_POINTER_MOVE_PX = 10;

const STATUS_DOTS: Record<string, string> = {
  Pending: 'bg-amber-500',
  Booked: 'bg-sky-500',
  Confirmed: 'bg-emerald-500',
  Seated: 'bg-brand-600',
  Arrived: 'bg-emerald-500',
  Completed: 'bg-slate-500',
  'No-Show': 'bg-red-500',
  Cancelled: 'bg-slate-400',
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
  _endMin: number;
  rowSpan: number;
  laneIndex: number;
  laneCount: number;
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
    dietary_notes: string | null;
    occasion: string | null;
  }>;
  combinations?: CombinationInfo[];
  serviceStartTime?: string;
  serviceEndTime?: string;
  slotIntervalMinutes?: number;
  statusFilter: string | null;
  showCancelled: boolean;
  showNoShow: boolean;
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
  onBookingClick: (bookingId: string) => void;
  onEditBooking: (bookingId: string) => void;
  onSendMessage: (bookingId: string) => void;
  onCellClick: (tableId: string, time: string) => void;
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

type DragDropPreview =
  | { kind: 'time'; time: string; invalid: boolean }
  | { kind: 'table'; label: string; invalid: boolean };

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
  serviceStartTime,
  serviceEndTime,
  slotIntervalMinutes,
  statusFilter,
  showCancelled,
  showNoShow,
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
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; resolve: (value: boolean) => void } | null>(null);
  const [resizeVisual, setResizeVisual] = useState<{ bookingId: string; deltaSlots: number } | null>(null);
  /** Hovered drop target while dragging - time (same table) or table/combination name (table move). */
  const [dragDropPreview, setDragDropPreview] = useState<DragDropPreview | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  const startMin = useMemo(() => serviceStartTime ? timeToMinutes(serviceStartTime) : 9 * 60, [serviceStartTime]);
  const endMin = useMemo(() => serviceEndTime ? timeToMinutes(serviceEndTime) : 23 * 60, [serviceEndTime]);
  const slotInterval = slotIntervalMinutes ?? 15;
  const isToday = useMemo(() => currentDate === formatLocalDateInput(new Date()), [currentDate]);

  const timeSlots = useMemo(() => {
    const slots: string[] = [];
    for (let m = startMin; m < endMin; m += slotInterval) {
      slots.push(minutesToTime(m));
    }
    return slots;
  }, [startMin, endMin, slotInterval]);

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
      const bEnd = cell.booking_details.end_time
        ? timeToMinutes(cell.booking_details.end_time)
        : bStart + 90;

      const startCol = Math.max(0, Math.floor((bStart - startMin) / slotInterval));
      const endCol = Math.ceil((bEnd - startMin) / slotInterval);
      const spanCols = Math.max(1, endCol - startCol);

      const clampedStart = Math.max(bStart, startMin);
      const leftPx = ((clampedStart - startMin) / slotInterval) * SLOT_WIDTH;
      const widthPx = Math.max(SLOT_WIDTH * 0.25, ((bEnd - clampedStart) / slotInterval) * SLOT_WIDTH);

      const allTableIds = bookingTableMap.get(cell.booking_id) ?? [cell.table_id];
      const tableNames = allTableIds.map((tid) => tableNameById.get(tid) ?? tid);
      for (const tableId of allTableIds) {
        blocks.push({
          id: cell.booking_id,
          guest_name: cell.booking_details.guest_name,
          party_size: cell.booking_details.party_size,
          status: cell.booking_details.status,
          deposit_status: cell.booking_details.deposit_status ?? null,
          start_time: cell.booking_details.start_time,
          end_time: cell.booking_details.end_time ?? '',
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
      const bEnd = b.end_time ? timeToMinutes(b.end_time) : bStart + 90;
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
        start_time: b.start_time,
        end_time: b.end_time,
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
  }, [cells, unassignedBookings, startMin, slotInterval, tables, SLOT_WIDTH]);

  const filteredBlocks = useMemo(() => {
    let blocks = bookingBlocks;
    if (!showCancelled) blocks = blocks.filter((b) => b.status !== 'Cancelled');
    if (!showNoShow) blocks = blocks.filter((b) => b.status !== 'No-Show');
    if (statusFilter) blocks = blocks.filter((b) => b.status === statusFilter);
    return blocks;
  }, [bookingBlocks, statusFilter, showCancelled, showNoShow]);

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

  const [nowMinutes, setNowMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });

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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 8,
      },
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setContextMenu(null);
    setDragDropPreview(null);
    const bookingId = String(event.active.id).split('__')[0] ?? String(event.active.id);
    const block = filteredBlocks.find((b) => b.id === bookingId);
    if (block) {
      activeDragRef.current = block;
      setActiveDrag(block);
      onDragValidation(block);
    }
  }, [filteredBlocks, onDragValidation]);

  const handleDragCancel = useCallback(() => {
    setContextMenu(null);
    setDragDropPreview(null);
    activeDragRef.current = null;
    setActiveDrag(null);
    onDragValidation(null);
  }, [onDragValidation]);

  const confirmAction = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmDialog({ message, resolve });
    });
  }, []);

  const isInvalidTimeTarget = useCallback((tableId: string, time: string, block: BookingBlock): boolean => {
    const start = timeToMinutes(block.start_time);
    const end = block.end_time ? timeToMinutes(block.end_time) : start + 90;
    const duration = Math.max(15, end - start);
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
  }, [cells, cellMap]);

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

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    setContextMenu((prev) => (prev ? null : prev));

    const block = activeDragRef.current;
    const overId = event.over?.id != null ? String(event.over.id) : '';

    if (!block || !overId) {
      setDragDropPreview(null);
      return;
    }

    if (overId.startsWith('cell_')) {
      const m = overId.match(CELL_DROP_ID_REGEX);
      if (!m) {
        setDragDropPreview(null);
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
        setDragDropPreview({ kind: 'table', label, invalid });
        return;
      }

      const invalid = blocked || isInvalidTimeTarget(tableId, time, block);
      setDragDropPreview({ kind: 'time', time, invalid });
      return;
    }

    if (overId.startsWith('table_')) {
      const tableId = overId.replace('table_', '');
      if (!tableId) {
        setDragDropPreview(null);
        return;
      }
      const isTableMove = !block.table_ids.includes(tableId);
      if (!isTableMove) {
        setDragDropPreview(null);
        return;
      }
      const targetTableIds = resolveTargetTableIds(tableId, block);
      const invalid = !targetTableIds || targetTableIds.length === 0;
      const label = formatTargetTableLabel(targetTableIds, tableId, tables);
      setDragDropPreview({ kind: 'table', label, invalid });
      return;
    }

    setDragDropPreview(null);
  }, [cellMap, isInvalidTimeTarget, resolveTargetTableIds, tables]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setContextMenu(null);
    setDragDropPreview(null);
    activeDragRef.current = null;
    setActiveDrag(null);
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

      if (time !== block.start_time.slice(0, 5)) {
        onTimeChange(bookingId, time);
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
  }, [filteredBlocks, tables, onReassign, onTimeChange, onAssign, onError, onDragValidation, cellMap, resolveTargetTableIds]);

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
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
      <div ref={timelineRootRef} className="flex w-full min-w-0">
        <div className="flex w-20 shrink-0 flex-col border-r border-slate-200 bg-slate-50/50 sm:w-28 md:w-[140px]">
          <div className="flex h-10 shrink-0 items-center border-b border-slate-200 px-3 text-xs font-semibold text-slate-500">
            Tables
          </div>
          <div className="flex flex-col">
            <div style={{ height: topSpacerHeight }} />
            {visibleRowEntries.map((entry) => {
              if (entry.type === 'zone') {
                return (
                  <div key={entry.key} className="flex h-6 items-center bg-slate-100 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {entry.zone}
                  </div>
                );
              }
              const table = entry.table!;
              const isValid = validDropTargets ? validDropTargets.has(table.id) : null;
              const comboLabel = validDropCombos?.get(table.id);
              return <TableRowHeader key={entry.key} table={table} isValidTarget={isValid} comboLabel={comboLabel} />;
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

        <div ref={scrollRef} className="min-w-0 flex-1 touch-manipulation overflow-x-auto">
          <div style={{ width: gridWidth, position: 'relative' }}>
            <div className="sticky top-0 z-10 flex border-b border-slate-200 bg-white" style={{ height: HEADER_HEIGHT }}>
              {timeSlots.map((time, i) => (
                <div
                  key={time}
                  className="flex shrink-0 items-center justify-center border-r border-slate-100 text-xs font-medium text-slate-500"
                  style={{ width: SLOT_WIDTH }}
                >
                  {i % 4 === 0 ? time : ''}
                </div>
              ))}
            </div>

            {isToday && currentTimeOffset > 0 && currentTimeOffset < gridWidth && (
              <div
                className="absolute z-20 w-0.5 bg-red-500"
                style={{
                  left: currentTimeOffset,
                  top: HEADER_HEIGHT,
                  height: timelineBodyScrollHeight,
                }}
              />
            )}

            <div style={{ height: topSpacerHeight }} />
            {visibleRowEntries.map((entry) => {
              if (entry.type === 'zone') {
                return <div key={entry.key} style={{ height: 24 }} />;
              }
              const table = entry.table!;
              const tableBlocks = filteredBlocks.filter((b) => b.table_id === table.id);
              const isValid = validDropTargets ? validDropTargets.has(table.id) : null;
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
                      return (
                        <DroppableCell
                          key={time}
                          droppableId={`cell_${table.id}_${time}`}
                          onClick={() => {
                            if (cell?.block_id) {
                              onBlockClick(cell.block_id);
                              return;
                            }
                            if (!cell?.booking_id) {
                              onCellClick(table.id, time);
                            }
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            onCellContextMenu(table.id, time, e.clientX, e.clientY);
                          }}
                          className={`shrink-0 border-b border-r ${
                            blocked
                              ? 'border-slate-300 bg-slate-200/80'
                              : dragInvalid
                                ? 'border-red-200 bg-red-50/70'
                              : 'border-slate-50 hover:bg-brand-50/30'
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
                      rowHeight={ROW_HEIGHT}
                      highlighted={highlightedBookingIds.has(block.id)}
                      isMultiTable={block.table_ids.length > 1}
                      onContextMenu={handleContextMenu}
                      onBookingPointerDown={handleBookingPointerDown}
                      onClick={onBookingClick}
                      onQuickStatusChange={(nextStatus) => { void handleStatusChange(block.id, block.status, nextStatus); }}
                      resizeVisual={resizeVisual}
                      onResizeVisual={setResizeVisual}
                      activeDragBookingId={activeDrag?.id ?? null}
                    />
                  ))}
                </DroppableRow>
              );
            })}
            <div style={{ height: bottomSpacerHeight }} />

            {unassignedBlocks.length > 0 && (
              <>
                <div
                  className="flex shrink-0 border-b border-emerald-100 bg-emerald-50"
                  style={{ width: gridWidth, height: UNASSIGNED_HEADER_HEIGHT }}
                >
                  {timeSlots.map((time) => (
                    <div
                      key={time}
                      className="shrink-0 border-r border-emerald-100/70"
                      style={{ width: SLOT_WIDTH, height: UNASSIGNED_HEADER_HEIGHT }}
                    />
                  ))}
                </div>
                {unassignedBlocks.map((block) => (
                  <div key={block.id} className="relative flex shrink-0 bg-emerald-50/30" style={{ width: gridWidth, height: ROW_HEIGHT }}>
                    {timeSlots.map((time) => (
                      <div
                        key={time}
                        className="shrink-0 border-b border-r border-emerald-100/60"
                        style={{ width: SLOT_WIDTH, height: ROW_HEIGHT }}
                      />
                    ))}
                    <DraggableBlock
                      block={{ ...block, laneIndex: 0, laneCount: 1, rowSpan: 1 }}
                      dragId={`${block.id}__unassigned`}
                      slotWidth={SLOT_WIDTH}
                      rowHeight={ROW_HEIGHT}
                      highlighted={highlightedBookingIds.has(block.id)}
                      isMultiTable={false}
                      onContextMenu={handleContextMenu}
                      onBookingPointerDown={handleBookingPointerDown}
                      onClick={onBookingClick}
                      onQuickStatusChange={(nextStatus) => { void handleStatusChange(block.id, block.status, nextStatus); }}
                      resizeVisual={resizeVisual}
                      onResizeVisual={setResizeVisual}
                      activeDragBookingId={activeDrag?.id ?? null}
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
                className={`flex flex-col gap-0.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-lg ${
                  STATUS_COLORS[activeDrag.status] ?? 'bg-slate-100 border-slate-300 text-slate-800'
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

      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 rounded-2xl border border-slate-200/80 bg-white py-1 shadow-xl shadow-slate-900/15 ring-1 ring-slate-100"
            style={{ left: contextMenu.x, top: contextMenu.y, minWidth: 200 }}
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
      )}
      {confirmDialog && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-slate-900/25 backdrop-blur-[2px]"
            onClick={() => {
              confirmDialog.resolve(false);
              setConfirmDialog(null);
            }}
          />
          <div className="fixed left-1/2 top-1/2 z-[61] w-full max-w-xs -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100">
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

function TableRowHeader({ table, isValidTarget, comboLabel }: { table: VenueTable; isValidTarget: boolean | null; comboLabel?: string }) {
  return (
    <div
      className={`flex flex-col justify-center border-b border-slate-100 px-1.5 transition-colors sm:px-3 ${
        isValidTarget === true ? 'bg-green-100/80' :
        isValidTarget === false ? 'bg-slate-100/50 opacity-50' :
        ''
      }`}
      style={{ height: ROW_HEIGHT }}
    >
      <div className="flex items-center gap-1 sm:gap-2">
        <span className="truncate text-[10px] font-semibold text-slate-900 sm:text-xs">{table.name}</span>
        <span className="hidden rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 sm:inline-block">
          {table.max_covers}
        </span>
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
      className={`relative flex ${bgClass}`}
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
  onClick?: () => void;
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

function DraggableBlock({ block, dragId, slotWidth, rowHeight, highlighted, isMultiTable, onContextMenu, onBookingPointerDown, onClick, onQuickStatusChange, resizeVisual, onResizeVisual, activeDragBookingId }: {
  block: BookingBlock;
  dragId: string;
  slotWidth: number;
  rowHeight: number;
  highlighted: boolean;
  isMultiTable: boolean;
  onContextMenu: (e: React.MouseEvent, block: BookingBlock) => void;
  onBookingPointerDown: (block: BookingBlock, clientX: number, clientY: number) => void;
  onClick: (bookingId: string) => void;
  onQuickStatusChange: (nextStatus: BookingStatus) => void;
  resizeVisual: { bookingId: string; deltaSlots: number } | null;
  onResizeVisual: (state: { bookingId: string; deltaSlots: number } | null) => void;
  activeDragBookingId: string | null;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: dragId });
  const resizingRef = useRef(false);
  const justResizedRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartEndRef = useRef(0);
  const [resizePreviewEnd, setResizePreviewEnd] = useState<string | null>(null);

  const colorClass = STATUS_COLORS[block.status] ?? 'bg-slate-100 border-slate-300 text-slate-800';
  const left = block.leftPx + 2;
  const resizeDelta = resizeVisual?.bookingId === block.id ? resizeVisual.deltaSlots * slotWidth : 0;
  const width = Math.max(16, block.widthPx - 4 + resizeDelta);
  const isSiblingDragging = activeDragBookingId === block.id && !isDragging;
  const rowHeightForLane = Math.max(18, (rowHeight * Math.max(1, block.rowSpan) - 8) / Math.max(1, block.laneCount));
  const top = 1 + block.laneIndex * rowHeightForLane;
  const height = rowHeightForLane - 2;
  const isCondensed = width < 72;
  const comboLabel = block.table_names.length > 1 ? block.table_names.join('+') : '';
  const depositIcon = block.deposit_status === 'Paid' ? '£' : block.deposit_status === 'Pending' ? '!' : null;
  const primaryAction = isBookingStatus(block.status) ? BOOKING_PRIMARY_ACTIONS[block.status] : undefined;
  const canShowPrimaryAction = Boolean(primaryAction) && width >= 132;
  const canShowNoShowAction =
    isBookingStatus(block.status) &&
    canTransitionBookingStatus(block.status, 'No-Show') &&
    width >= 228;

  const startResize = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const start = timeToMinutes(block.start_time.slice(0, 5));
    const currentEnd = block.end_time ? timeToMinutes(block.end_time.slice(0, 5)) : start + 90;
    resizingRef.current = true;
    resizeStartXRef.current = e.clientX;
    resizeStartEndRef.current = currentEnd;
    onResizeVisual({ bookingId: block.id, deltaSlots: 0 });
    document.body.style.cursor = 'ew-resize';
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const deltaX = ev.clientX - resizeStartXRef.current;
      const deltaSlots = Math.round(deltaX / slotWidth);
      const nextEnd = Math.max(start + 15, resizeStartEndRef.current + deltaSlots * 15);
      const clampedDelta = Math.round((nextEnd - resizeStartEndRef.current) / 15);
      const endStr = minutesToTime(nextEnd);
      setResizePreviewEnd(endStr);
      onResizeVisual({ bookingId: block.id, deltaSlots: clampedDelta });
    };
    const onUp = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const deltaX = ev.clientX - resizeStartXRef.current;
      const deltaSlots = Math.round(deltaX / slotWidth);
      const nextEnd = Math.max(start + 15, resizeStartEndRef.current + deltaSlots * 15);
      const endStr = minutesToTime(nextEnd);
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      resizingRef.current = false;
      justResizedRef.current = true;
      setTimeout(() => { justResizedRef.current = false; }, 200);
      setResizePreviewEnd(null);
      onResizeVisual(null);
      const customEvent = new CustomEvent('timeline-resize-booking', {
        detail: { bookingId: block.id, endTime: endStr },
      });
      window.dispatchEvent(customEvent);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
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

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      onPointerDownCapture={(e) => {
        if (e.button !== 0) return;
        onBookingPointerDown(block, e.clientX, e.clientY);
      }}
      onContextMenu={(e) => onContextMenu(e, block)}
      onClick={() => { if (!justResizedRef.current) onClick(block.id); }}
      className={`absolute flex cursor-grab touch-none select-none items-center gap-1 overflow-hidden rounded-md border px-2 text-xs font-medium transition-shadow active:cursor-grabbing ${colorClass} ${
        isDragging ? 'z-30 opacity-50' : ''
      } ${highlighted ? 'ring-2 ring-amber-400 ring-offset-1' : ''} ${
        isMultiTable ? 'border-l-[3px] border-l-purple-500' : ''
      }`}
      style={{ left, top, width, height, WebkitTapHighlightColor: 'transparent' }}
      title={`${block.guest_name} · Party of ${block.party_size} · ${block.start_time.slice(0, 5)}–${block.end_time.slice(0, 5)}${isMultiTable ? ' · Table combination' : ''}`}
    >
      <div {...listeners} className="flex min-h-0 flex-1 items-center gap-1 pr-1 touch-none">
        {isCondensed ? (
          <>
            <span className="text-[10px] font-semibold">{block.party_size}</span>
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
      {(canShowPrimaryAction || canShowNoShowAction) && (
        <div className="flex shrink-0 items-center gap-1 pr-1">
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
              aria-label={`${primaryAction.label} booking for ${block.guest_name}`}
            >
              {primaryAction.label}
            </button>
          )}
          {canShowNoShowAction && (
            <button
              type="button"
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                onQuickStatusChange('No-Show');
              }}
              className="rounded-md bg-white/70 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 shadow-sm ring-1 ring-rose-200/70 transition-colors hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-400/40"
              aria-label={`Mark no-show for ${block.guest_name}`}
            >
              No-show
            </button>
          )}
        </div>
      )}
      <span
        onMouseDown={startResize}
        className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-black/20 opacity-60 transition-opacity hover:opacity-100"
        title="Drag to resize"
      />
      {resizePreviewEnd && (
        <span className="absolute -top-5 right-0 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-white">
          {resizePreviewEnd}
        </span>
      )}
    </div>
  );
}
