'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import type { TableGridData, UndoAction } from '@/types/table-management';
import { TimelineGrid } from './TimelineGrid';
import { UndoToast } from './UndoToast';
import { useToast } from '@/components/ui/Toast';
import { useVenueLiveSync } from '@/lib/realtime/useVenueLiveSync';
import { BookingDetailPanel, type BookingDetailPanelSnapshot } from '@/app/dashboard/bookings/BookingDetailPanel';
import { DashboardStaffBookingModal } from '@/components/booking/DashboardStaffBookingModal';
import type { BookingModel } from '@/types/booking-models';
import { detectAdjacentTables, type CombinationTable } from '@/lib/table-management/combination-engine';
import { canMarkNoShowForSlot, canTransitionBookingStatus, type BookingStatus } from '@/lib/table-management/booking-status';
import { computeValidMoveTargets, type BookingMoveContext } from '@/lib/table-management/move-validation';
import type { ViewToolbarSummary } from '@/components/dashboard/ViewToolbar';
import { OperationsWorkspaceToolbar } from '@/components/dashboard/OperationsWorkspaceToolbar';
import { DiningAreaPicker } from '@/components/dashboard/DiningAreaPicker';
import { coversInUseAtTime, tablesInUseAtTime } from '@/lib/table-management/covers-at-time';
import { computeNextBookingsSlot } from '@/lib/table-management/next-bookings-slot';
import { bookingStatusDisplayLabel } from '@/lib/booking/infer-booking-row-model';
import { CalendarDateTimePicker } from '@/components/calendar/CalendarDateTimePicker';
import { getCalendarGridBounds } from '@/lib/venue-calendar-bounds';
import { isBookingTimeInHourRange } from '@/lib/booking-time-window';
import type { OpeningHours } from '@/types/availability';
import type { VenueArea } from '@/types/areas';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { EmptyState } from '@/components/ui/dashboard/EmptyState';
import { DashboardGridSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';
import { ClampedFixedDropdown } from '@/components/ui/ClampedFixedDropdown';
import { computePointAnchoredMenuStyle } from '@/lib/ui/clamped-floating-styles';
import { useViewportBounds } from '@/lib/ui/use-viewport-bounds';

function formatDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function minutesToTime(value: number): string {
  const h = Math.floor(value / 60);
  const m = value % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function localDateTimeIso(date: string, minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).toISOString();
}

/** Matches `TimelineGrid` default slot column width at 100% scale. */
const TIMELINE_SLOT_BASE_PX = 64;
const TIMELINE_SCALE_PERCENT_MIN = 50;
const TIMELINE_SCALE_PERCENT_MAX = 150;
const TIMELINE_SCALE_STEP = 5;
const TIMELINE_SCALE_STORAGE_KEY = 'reserve:table-grid:timeline-scale-pct';
const LEGACY_SLOT_WIDTH_STORAGE_KEY = 'reserve:table-grid:slot-width';
const VISUAL_RECONCILE_DELAY_MS = 120;
const VISUAL_RECONCILE_MIN_INTERVAL_MS = 350;
const VISUAL_RECONCILE_FOLLOW_UP_DELAY_MS = 80;
const SETTLED_VISUAL_HOLD_MS = 1_500;
const TABLE_GRID_VISUAL_INTERACTION_EVENT = 'table-grid-visual-interaction';

function timelinePercentToSlotWidthPx(percent: number): number {
  const raw = Math.round(TIMELINE_SLOT_BASE_PX * (percent / 100));
  return Math.max(28, Math.min(100, raw));
}

function endMinutesAfterStart(start: string, end: string | null | undefined, fallbackMinutes = 90): number {
  const startMin = timeToMinutes(start.slice(0, 5));
  if (!end) return startMin + fallbackMinutes;
  let endMin = timeToMinutes(end.slice(0, 5));
  if (endMin <= startMin) {
    endMin += 24 * 60;
  }
  return endMin;
}

function effectiveBookingEndMinutes(
  status: string,
  start: string,
  end: string | null | undefined,
  isToday: boolean,
): number {
  const scheduledEnd = endMinutesAfterStart(start, end);
  if (status === 'Seated' || status === 'Arrived') {
    if (!isToday) return scheduledEnd;
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = timeToMinutes(start.slice(0, 5));
    if (nowMinutes > startMinutes) {
      return Math.max(scheduledEnd, nowMinutes);
    }
  }
  return scheduledEnd;
}

type VisualBookingSnapshot = {
  booking: NonNullable<TableGridData['cells'][number]['booking_details']>;
  tableIds: string[];
};

function visualBookingSnapshot(data: TableGridData | null, bookingId: string): VisualBookingSnapshot | null {
  if (!data) return null;
  const bookingCells = data.cells.filter((cell) => cell.booking_id === bookingId && cell.booking_details);
  const bookingFromCell = bookingCells[0]?.booking_details;
  if (bookingFromCell) {
    return {
      booking: bookingFromCell,
      tableIds: Array.from(new Set(bookingCells.map((cell) => cell.table_id))),
    };
  }

  const unassignedBooking = data.unassigned_bookings.find((booking) => booking.id === bookingId);
  if (!unassignedBooking) return null;

  return {
    booking: {
      guest_name: unassignedBooking.guest_name,
      party_size: unassignedBooking.party_size,
      status: unassignedBooking.status,
      deposit_status: null,
      guest_attendance_confirmed_at: unassignedBooking.guest_attendance_confirmed_at ?? null,
      staff_attendance_confirmed_at: unassignedBooking.staff_attendance_confirmed_at ?? null,
      start_time: unassignedBooking.start_time,
      end_time: unassignedBooking.end_time,
      actual_departed_time: unassignedBooking.actual_departed_time ?? null,
      dietary_notes: unassignedBooking.dietary_notes,
      occasion: unassignedBooking.occasion,
    },
    tableIds: [],
  };
}

function withOptimisticBookingMove(
  prev: TableGridData | null,
  bookingId: string,
  patch: { tableIds?: string[]; startTime?: string; endTime?: string },
  fallback?: VisualBookingSnapshot | null,
): TableGridData | null {
  if (!prev) return prev;
  const bookingCells = prev.cells.filter((c) => c.booking_id === bookingId && c.booking_details);
  const unassignedBooking = prev.unassigned_bookings.find((booking) => booking.id === bookingId);
  if (bookingCells.length === 0 && !unassignedBooking && !fallback) return prev;
  const booking = bookingCells[0]?.booking_details ?? (unassignedBooking
    ? {
        guest_name: unassignedBooking.guest_name,
        party_size: unassignedBooking.party_size,
        status: unassignedBooking.status,
        deposit_status: null,
        guest_attendance_confirmed_at: unassignedBooking.guest_attendance_confirmed_at ?? null,
        staff_attendance_confirmed_at: unassignedBooking.staff_attendance_confirmed_at ?? null,
        start_time: unassignedBooking.start_time,
        end_time: unassignedBooking.end_time,
        actual_departed_time: unassignedBooking.actual_departed_time ?? null,
        dietary_notes: unassignedBooking.dietary_notes,
        occasion: unassignedBooking.occasion,
      }
    : fallback?.booking ?? null);
  if (!booking) return prev;
  const targetTables = patch.tableIds ?? (
    bookingCells.length > 0
      ? Array.from(new Set(bookingCells.map((c) => c.table_id)))
      : fallback?.tableIds ?? []
  );
  const startTime = patch.startTime ?? booking.start_time.slice(0, 5);
  const durationMins = (() => {
    const start = timeToMinutes(booking.start_time.slice(0, 5));
    const end = booking.end_time ? timeToMinutes(booking.end_time.slice(0, 5)) : start + 90;
    return Math.max(15, end - start);
  })();
  const endTime = patch.endTime ?? (() => {
    const end = timeToMinutes(startTime) + durationMins;
    return `${Math.floor(end / 60).toString().padStart(2, '0')}:${(end % 60).toString().padStart(2, '0')}`;
  })();
  const nextBookingDetails = {
    ...booking,
    start_time: startTime,
    end_time: endTime,
    table_ids: targetTables,
    table_names: targetTables.map((tableId) => prev.tables.find((table) => table.id === tableId)?.name ?? tableId),
  };

  let updatedCells = prev.cells.map((cell) => {
    if (cell.booking_id === bookingId) {
      return {
        ...cell,
        booking_id: null,
        booking_details: null,
      };
    }
    const inTargetTable = targetTables.includes(cell.table_id);
    if (!inTargetTable) return cell;
    const slot = timeToMinutes(cell.time.slice(0, 5));
    const inRange = slot >= timeToMinutes(startTime) && slot < timeToMinutes(endTime);
    if (!inRange) return cell;
    return {
      ...cell,
      booking_id: bookingId,
      booking_details: nextBookingDetails,
    };
  });

  // Rendering only needs one cell with booking details to rebuild the full bar.
  // During rapid resize/reconcile races, the requested range can temporarily miss
  // all current slots; preserve an anchor so the bar never disappears for a frame.
  if (targetTables.length > 0 && !updatedCells.some((cell) => cell.booking_id === bookingId)) {
    const targetTableSet = new Set(targetTables);
    const startMinutes = timeToMinutes(startTime);
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < updatedCells.length; index += 1) {
      const cell = updatedCells[index]!;
      if (!targetTableSet.has(cell.table_id)) continue;
      const distance = Math.abs(timeToMinutes(cell.time.slice(0, 5)) - startMinutes);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    if (bestIndex >= 0) {
      updatedCells = updatedCells.map((cell, index) =>
        index === bestIndex
          ? {
              ...cell,
              booking_id: bookingId,
              booking_details: nextBookingDetails,
            }
          : cell,
      );
    }
  }

  if (targetTables.length === 0 && patch.tableIds === undefined && !unassignedBooking) {
    return prev;
  }

  const movedToUnassigned = targetTables.length === 0;
  const nextUnassignedBooking = {
    id: bookingId,
    guest_name: booking.guest_name,
    party_size: booking.party_size,
    start_time: startTime,
    end_time: endTime,
    status: booking.status,
    guest_attendance_confirmed_at: booking.guest_attendance_confirmed_at ?? null,
    staff_attendance_confirmed_at: booking.staff_attendance_confirmed_at ?? null,
    dietary_notes: booking.dietary_notes,
    occasion: booking.occasion,
    actual_departed_time: booking.actual_departed_time ?? null,
  };
  const unassignedWithoutBooking = prev.unassigned_bookings.filter((item) => item.id !== bookingId);

  return {
    ...prev,
    cells: updatedCells,
    unassigned_bookings: movedToUnassigned
      ? [...unassignedWithoutBooking, nextUnassignedBooking]
      : unassignedWithoutBooking,
    summary: {
      ...prev.summary,
      unassigned_count: movedToUnassigned
        ? unassignedWithoutBooking.length + 1
        : unassignedWithoutBooking.length,
    },
  };
}

function withOptimisticBookingStatus(
  prev: TableGridData | null,
  bookingId: string,
  status: BookingStatus,
  options?: { actualDepartedTime?: string },
): TableGridData | null {
  if (!prev) return prev;

  return {
    ...prev,
    cells: prev.cells.map((cell) => {
      if (cell.booking_id !== bookingId || !cell.booking_details) return cell;
      return {
        ...cell,
        booking_details: {
          ...cell.booking_details,
          status,
          actual_departed_time:
            status === 'Completed'
              ? options?.actualDepartedTime ?? new Date().toISOString()
              : cell.booking_details.status === 'Completed' && status === 'Seated'
                ? null
                : cell.booking_details.actual_departed_time ?? null,
          staff_attendance_confirmed_at:
            status === 'Confirmed'
              ? cell.booking_details.staff_attendance_confirmed_at ?? new Date().toISOString()
              : cell.booking_details.status === 'Confirmed' && status === 'Booked'
                ? null
              : cell.booking_details.staff_attendance_confirmed_at ?? null,
        },
      };
    }),
    unassigned_bookings: prev.unassigned_bookings.map((booking) => {
      if (booking.id !== bookingId) return booking;
      return {
        ...booking,
        status,
        actual_departed_time:
          status === 'Completed'
            ? options?.actualDepartedTime ?? new Date().toISOString()
            : booking.status === 'Completed' && status === 'Seated'
              ? null
              : booking.actual_departed_time ?? null,
        staff_attendance_confirmed_at:
          status === 'Confirmed'
            ? booking.staff_attendance_confirmed_at ?? new Date().toISOString()
            : booking.status === 'Confirmed' && status === 'Booked'
              ? null
            : booking.staff_attendance_confirmed_at ?? null,
      };
    }),
  };
}

interface CombinationInfo {
  id: string;
  name: string;
  combined_max_covers: number;
  table_ids: string[];
}

interface BlockFormState {
  id?: string;
  table_id: string;
  start_at: string;
  end_at: string;
  reason: string;
  repeat?: 'none' | 'week';
}

interface FetchGridOptions {
  silent?: boolean;
}

type PendingVisualMutation =
  | {
      id: string;
      bookingId: string;
      expiresAt: number;
      settledUntil?: number;
      type: 'move';
      patch: { tableIds?: string[]; startTime?: string; endTime?: string };
      fallback: VisualBookingSnapshot | null;
    }
  | {
      id: string;
      bookingId: string;
      expiresAt: number;
      settledUntil?: number;
      type: 'status';
      status: BookingStatus;
      actualDepartedTime?: string;
    };

type PendingVisualMutationInput =
  | {
      bookingId: string;
      type: 'move';
      patch: { tableIds?: string[]; startTime?: string; endTime?: string };
    }
  | {
      bookingId: string;
      type: 'status';
      status: BookingStatus;
      actualDepartedTime?: string;
    };

function applyPendingVisualMutations(
  data: TableGridData,
  mutations: PendingVisualMutation[],
  now = Date.now(),
): TableGridData {
  return mutations
    .filter((mutation) => mutation.expiresAt > now)
    .reduce<TableGridData>((next, mutation) => {
      if (mutation.type === 'move') {
        return withOptimisticBookingMove(next, mutation.bookingId, mutation.patch, mutation.fallback) ?? next;
      }
      return withOptimisticBookingStatus(
        next,
        mutation.bookingId,
        mutation.status,
        { actualDepartedTime: mutation.actualDepartedTime },
      ) ?? next;
    }, data);
}

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every((value) => bSet.has(value));
}

function isPendingVisualMutationSettled(data: TableGridData, mutation: PendingVisualMutation): boolean {
  if (mutation.type === 'status') {
    const cell = data.cells.find((item) => item.booking_id === mutation.bookingId && item.booking_details);
    const unassigned = data.unassigned_bookings.find((item) => item.id === mutation.bookingId);
    return (cell?.booking_details?.status ?? unassigned?.status) === mutation.status;
  }

  const bookingCells = data.cells.filter((item) => item.booking_id === mutation.bookingId && item.booking_details);
  const unassigned = data.unassigned_bookings.find((item) => item.id === mutation.bookingId);
  const details = bookingCells[0]?.booking_details ?? unassigned;
  if (!details) return false;

  if (mutation.patch.tableIds) {
    const actualTableIds = Array.from(new Set(bookingCells.map((cell) => cell.table_id)));
    if (!sameStringSet(actualTableIds, mutation.patch.tableIds)) return false;
  }
  if (mutation.patch.startTime && details.start_time.slice(0, 5) !== mutation.patch.startTime) return false;
  if (mutation.patch.endTime && details.end_time.slice(0, 5) !== mutation.patch.endTime) return false;
  return true;
}

export function TableGridView({
  venueId,
  currency,
  bookingModel = 'table_reservation',
  enabledModels = [],
}: {
  venueId: string;
  currency?: string;
  bookingModel?: BookingModel;
  enabledModels?: BookingModel[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [diningAreas, setDiningAreas] = useState<VenueArea[]>([]);
  const [diningAreaId, setDiningAreaId] = useState<string | null>(null);

  const [date, setDate] = useState(formatDateInput(new Date()));
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [services, setServices] = useState<Array<{ id: string; name: string; start_time: string; end_time: string }>>([]);
  const [gridData, setGridData] = useState<TableGridData | null>(null);
  const [combinations, setCombinations] = useState<CombinationInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [zoneFilter, setZoneFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchPopoverRef = useRef<HTMLDivElement>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterPopoverRef = useRef<HTMLDivElement>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [showUndoToast, setShowUndoToast] = useState(false);
  const [validDropTargets, setValidDropTargets] = useState<Set<string> | null>(null);
  const [validDropCombos, setValidDropCombos] = useState<Map<string, string> | null>(null);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [selectedBookingAnchor, setSelectedBookingAnchor] = useState<{ x: number; y: number } | null>(null);
  /** Bumps every minute while viewing today so “covers in use” stays current. */
  const [coversClockTick, setCoversClockTick] = useState(0);
  const [newBookingCell, setNewBookingCell] = useState<{ tableId: string; time: string } | null>(null);
  const [cellContext, setCellContext] = useState<{ tableId: string; time: string; x: number; y: number } | null>(null);
  const viewportBounds = useViewportBounds();
  const cellContextMenuStyle = useMemo(() => {
    if (!cellContext) return undefined;
    return computePointAnchoredMenuStyle({
      anchorX: cellContext.x,
      anchorY: cellContext.y,
      viewportWidth: viewportBounds.width,
      viewportHeight: viewportBounds.height,
      minWidth: Math.min(224, viewportBounds.width - 24),
      maxWidth: Math.min(288, viewportBounds.width - 16),
    });
  }, [cellContext, viewportBounds.width, viewportBounds.height]);
  const [blockForm, setBlockForm] = useState<BlockFormState | null>(null);
  const [blockSaving, setBlockSaving] = useState(false);
  const [blockDetails, setBlockDetails] = useState<Array<{
    id: string;
    table_id: string;
    start_at: string;
    end_at: string;
    reason: string | null;
    created_at: string;
    created_by: string | null;
  }>>([]);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [walkInCell, setWalkInCell] = useState<{ tableId: string; time: string } | null>(null);
  const [noShowGraceMinutes, setNoShowGraceMinutes] = useState(15);
  const [combinationThreshold, setCombinationThreshold] = useState(80);
  const [timelineScalePercent, setTimelineScalePercent] = useState(100);
  const [moveBookingId, setMoveBookingId] = useState<string | null>(null);
  const [rescheduleDialog, setRescheduleDialog] = useState<{ bookingId: string; time: string } | null>(null);
  const [assignAllUnassignedLoading, setAssignAllUnassignedLoading] = useState(false);
  const isUndoingRef = useRef(false);
  const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconcileInFlightRef = useRef(false);
  const pendingReconcileRef = useRef(false);
  const lastReconcileAtRef = useRef(0);
  const visualInteractionCountRef = useRef(0);
  const gridDataRef = useRef<TableGridData | null>(null);
  const pendingVisualMutationsRef = useRef<PendingVisualMutation[]>([]);
  const skipNextTimelineScalePersist = useRef(true);
  const { addToast } = useToast();

  const [openingHours, setOpeningHours] = useState<OpeningHours | null>(null);
  const [venueTimezone, setVenueTimezone] = useState<string>('Europe/London');
  const [startHourOverride, setStartHourOverride] = useState<number | null>(null);
  const [endHourOverride, setEndHourOverride] = useState<number | null>(null);
  const [timeRangeFilterActive, setTimeRangeFilterActive] = useState(false);

  const rememberPendingVisualMutation = useCallback((mutation: PendingVisualMutationInput): string => {
    const id = crypto.randomUUID();
    const nextMutation = {
      ...mutation,
      id,
      expiresAt: Date.now() + 10_000,
      ...(mutation.type === 'move'
        ? { fallback: visualBookingSnapshot(gridDataRef.current, mutation.bookingId) }
        : {}),
    } as PendingVisualMutation;
    pendingVisualMutationsRef.current = [
      ...pendingVisualMutationsRef.current.filter((item) => item.expiresAt > Date.now()),
      nextMutation,
    ];
    return id;
  }, []);

  const forgetPendingVisualMutation = useCallback((id: string) => {
    pendingVisualMutationsRef.current = pendingVisualMutationsRef.current.filter((mutation) => mutation.id !== id);
  }, []);

  const applyPendingVisuals = useCallback((data: TableGridData): TableGridData => {
    const now = Date.now();
    pendingVisualMutationsRef.current = pendingVisualMutationsRef.current.flatMap((mutation) => {
      if (mutation.expiresAt <= now) return [];
      const settled = isPendingVisualMutationSettled(data, mutation);
      if (!settled) return [mutation];

      const settledUntil = mutation.settledUntil ?? now + SETTLED_VISUAL_HOLD_MS;
      if (settledUntil <= now) return [];
      return [{ ...mutation, settledUntil }];
    });
    return applyPendingVisualMutations(data, pendingVisualMutationsRef.current, now);
  }, []);

  const commitVisualGridUpdate = useCallback((updater: (prev: TableGridData | null) => TableGridData | null) => {
    flushSync(() => {
      setGridData(updater);
    });
  }, []);

  const shouldRollbackPendingMutation = useCallback((pendingId: string, bookingId: string): boolean => {
    const now = Date.now();
    return !pendingVisualMutationsRef.current.some(
      (mutation) => mutation.id !== pendingId && mutation.bookingId === bookingId && mutation.expiresAt > now,
    );
  }, []);

  const rollbackPendingMutation = useCallback((
    pendingId: string,
    bookingId: string,
    rollback: TableGridData | null,
  ) => {
    const shouldRollback = shouldRollbackPendingMutation(pendingId, bookingId);
    forgetPendingVisualMutation(pendingId);
    if (shouldRollback) {
      setGridData(rollback);
    }
  }, [forgetPendingVisualMutation, shouldRollbackPendingMutation]);

  useEffect(() => {
    if (!searchOpen) return;

    const focusTimer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(focusTimer);
  }, [searchOpen]);

  useEffect(() => {
    if (!filterOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (filterPopoverRef.current?.contains(event.target as Node)) return;
      setFilterOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFilterOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [filterOpen]);

  useEffect(() => {
    if (!searchOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (searchPopoverRef.current?.contains(event.target as Node)) return;
      setSearchOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSearchOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [searchOpen]);

  const showDiningAreaChrome =
    bookingModel === 'table_reservation' && diningAreas.filter((a) => a.is_active).length > 1;

  useEffect(() => {
    if (bookingModel !== 'table_reservation') return;
    let cancelled = false;
    void fetch('/api/venue/areas')
      .then((res) => (res.ok ? res.json() : null))
      .then((j) => {
        if (cancelled || !j?.areas) return;
        setDiningAreas(j.areas as VenueArea[]);
      })
      .catch((e) => console.error('[TableGridView] /api/venue/areas preload failed:', e));
    return () => {
      cancelled = true;
    };
  }, [bookingModel]);

  useEffect(() => {
    if (bookingModel !== 'table_reservation') {
      setDiningAreaId(null);
      return;
    }
    const active = diningAreas.filter((a) => a.is_active);
    if (active.length === 0) {
      setDiningAreaId(null);
      return;
    }
    if (active.length === 1) {
      setDiningAreaId(active[0]!.id);
      return;
    }
    const fromUrl = searchParams.get('area');
    let fromLs: string | null = null;
    try {
      fromLs = window.localStorage.getItem(`diningArea:${venueId}`);
    } catch {
      /* ignore */
    }
    const pick =
      fromUrl && active.some((a) => a.id === fromUrl)
        ? fromUrl
        : fromLs && active.some((a) => a.id === fromLs)
          ? fromLs
          : active[0]!.id;
    setDiningAreaId(pick);
  }, [bookingModel, diningAreas, searchParams, venueId]);

  const setDiningAreaFilter = useCallback(
    (id: string) => {
      setDiningAreaId(id);
      setServiceId(null);
      try {
        window.localStorage.setItem(`diningArea:${venueId}`, id);
      } catch {
        /* ignore */
      }
      const next = new URLSearchParams(searchParams.toString());
      next.set('area', id);
      router.replace(`/dashboard/table-grid?${next}`, { scroll: false });
    },
    [router, searchParams, venueId],
  );

  const selectedBookingSnapshot = useMemo((): BookingDetailPanelSnapshot | null => {
    if (!selectedBookingId || !gridData) return null;
    const cellsWithBooking = gridData.cells.filter(
      (c) => c.booking_id === selectedBookingId && c.booking_details
    );
    if (cellsWithBooking.length > 0) {
      const bd = cellsWithBooking[0]!.booking_details!;
      const tableIds = [...new Set(cellsWithBooking.map((c) => c.table_id))];
      const tableNames = tableIds
        .map((tid) => gridData.tables.find((t) => t.id === tid)?.name)
        .filter((n): n is string => Boolean(n));
      return {
        bookingDate: date,
        guestName: bd.guest_name,
        partySize: bd.party_size,
        status: bd.status,
        startTime: bd.start_time,
        endTime: bd.end_time,
        dietaryNotes: bd.dietary_notes,
        occasion: bd.occasion,
        depositStatus: bd.deposit_status ?? undefined,
        tableNames: tableNames.length > 0 ? tableNames : undefined,
      };
    }
    const unassigned = gridData.unassigned_bookings?.find((b) => b.id === selectedBookingId);
    if (unassigned) {
      return {
        bookingDate: date,
        guestName: unassigned.guest_name,
        partySize: unassigned.party_size,
        status: unassigned.status,
        startTime: unassigned.start_time,
        endTime: unassigned.end_time,
        dietaryNotes: unassigned.dietary_notes,
        occasion: unassigned.occasion,
        tableNames: undefined,
      };
    }
    return null;
  }, [selectedBookingId, gridData, date]);

  const openBookingPopover = useCallback((bookingId: string, anchor: { x: number; y: number }) => {
    setSelectedBookingId(bookingId);
    setSelectedBookingAnchor(anchor);
  }, []);

  const openBookingDrawer = useCallback((bookingId: string) => {
    setSelectedBookingId(bookingId);
    setSelectedBookingAnchor(null);
  }, []);

  useEffect(() => {
    gridDataRef.current = gridData;
  }, [gridData]);

  const fetchServices = useCallback(async () => {
    try {
      const qs =
        bookingModel === 'table_reservation' && diningAreaId
          ? `?area_id=${encodeURIComponent(diningAreaId)}`
          : '';
      const res = await fetch(`/api/venue/services${qs}`);
      if (res.ok) {
        const data = await res.json();
        const svc = (data.services ?? []).filter((s: { is_active: boolean }) => s.is_active);
        setServices(svc);
      }
    } catch (err) {
      console.error('Fetch services failed:', err);
    }
  }, [bookingModel, diningAreaId]);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/venue')
      .then((res) => (res.ok ? res.json() : null))
      .then((v) => {
        if (cancelled || !v) return;
        if (v.opening_hours) setOpeningHours(v.opening_hours as OpeningHours);
        const tz = v.timezone;
        if (typeof tz === 'string' && tz.trim() !== '') setVenueTimezone(tz.trim());
      })
      .catch((e) => console.error('[TableGridView] /api/venue preload failed:', e));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setStartHourOverride(null);
    setEndHourOverride(null);
    setTimeRangeFilterActive(false);
  }, [date]);

  const fetchGrid = useCallback(async (options?: FetchGridOptions) => {
    const silent = options?.silent ?? false;
    const showBlockingLoader = !silent || !gridDataRef.current;
    if (showBlockingLoader) {
      setLoading(true);
    }
    try {
      const params = new URLSearchParams({ date });
      if (serviceId) params.set('service_id', serviceId);
      if (bookingModel === 'table_reservation' && diningAreaId) {
        params.set('area_id', diningAreaId);
      }

      const res = await fetch(`/api/venue/tables/availability?${params}`);
      if (res.ok) {
        const data = await res.json();
        setGridData(applyPendingVisuals(data as TableGridData));
      }
    } catch (err) {
      console.error('Failed to load grid data:', err);
    } finally {
      if (showBlockingLoader) {
        setLoading(false);
      }
    }
  }, [applyPendingVisuals, bookingModel, date, diningAreaId, serviceId]);

  const runSilentReconcile = useCallback(async () => {
    if (visualInteractionCountRef.current > 0) {
      pendingReconcileRef.current = true;
      if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current);
      reconcileTimerRef.current = setTimeout(() => {
        reconcileTimerRef.current = null;
        void runSilentReconcile();
      }, VISUAL_RECONCILE_DELAY_MS);
      return;
    }

    if (reconcileInFlightRef.current) {
      pendingReconcileRef.current = true;
      return;
    }
    const minIntervalMs = VISUAL_RECONCILE_MIN_INTERVAL_MS;
    const elapsed = Date.now() - lastReconcileAtRef.current;
    if (elapsed < minIntervalMs) {
      pendingReconcileRef.current = true;
      const waitMs = minIntervalMs - elapsed;
      if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current);
      reconcileTimerRef.current = setTimeout(() => {
        reconcileTimerRef.current = null;
        void runSilentReconcile();
      }, waitMs);
      return;
    }

    reconcileInFlightRef.current = true;
    try {
      await fetchGrid({ silent: true });
      lastReconcileAtRef.current = Date.now();
    } finally {
      reconcileInFlightRef.current = false;
      if (pendingReconcileRef.current) {
        pendingReconcileRef.current = false;
        if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current);
        reconcileTimerRef.current = setTimeout(() => {
          reconcileTimerRef.current = null;
          void runSilentReconcile();
        }, VISUAL_RECONCILE_FOLLOW_UP_DELAY_MS);
      }
    }
  }, [fetchGrid]);

  const scheduleReconcile = useCallback((delayMs = VISUAL_RECONCILE_DELAY_MS) => {
    pendingReconcileRef.current = true;
    if (reconcileTimerRef.current) {
      clearTimeout(reconcileTimerRef.current);
    }
    reconcileTimerRef.current = setTimeout(() => {
      reconcileTimerRef.current = null;
      pendingReconcileRef.current = false;
      void runSilentReconcile();
    }, delayMs);
  }, [runSilentReconcile]);

  useEffect(() => {
    const handleVisualInteraction = (event: Event) => {
      const detail = (event as CustomEvent<{ active?: boolean }>).detail;
      if (detail?.active) {
        visualInteractionCountRef.current += 1;
        return;
      }

      visualInteractionCountRef.current = Math.max(0, visualInteractionCountRef.current - 1);
      if (visualInteractionCountRef.current === 0 && pendingReconcileRef.current) {
        scheduleReconcile(VISUAL_RECONCILE_DELAY_MS);
      }
    };

    window.addEventListener(TABLE_GRID_VISUAL_INTERACTION_EVENT, handleVisualInteraction as EventListener);
    return () => {
      window.removeEventListener(TABLE_GRID_VISUAL_INTERACTION_EVENT, handleVisualInteraction as EventListener);
    };
  }, [scheduleReconcile]);

  const fetchCombinations = useCallback(async () => {
    try {
      const areaQs =
        bookingModel === 'table_reservation' && diningAreaId
          ? `?area_id=${encodeURIComponent(diningAreaId)}`
          : '';
      const res = await fetch(`/api/venue/tables/combinations${areaQs}`);
      if (res.ok) {
        const data = await res.json();
        const combos: CombinationInfo[] = (data.combinations ?? [])
          .filter((c: { is_active: boolean }) => c.is_active)
          .map((c: { id: string; name: string; combined_min_covers?: number; combined_max_covers: number; members?: Array<{ table_id: string }> }) => ({
            id: c.id,
            name: c.name,
            combined_min_covers: c.combined_min_covers,
            combined_max_covers: c.combined_max_covers,
            table_ids: (c.members ?? []).map((m) => m.table_id),
          }));
        setCombinations(combos);
      }
    } catch (err) {
      console.error('Fetch combinations failed:', err);
    }
  }, [bookingModel, diningAreaId]);

  useEffect(() => {
    const areaQs =
      bookingModel === 'table_reservation' && diningAreaId
        ? `?area_id=${encodeURIComponent(diningAreaId)}`
        : '';
    fetch(`/api/venue/tables${areaQs}`)
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setNoShowGraceMinutes(data.settings?.no_show_grace_minutes ?? 15);
          setCombinationThreshold(data.settings?.combination_threshold ?? 80);
        }
      })
      .catch((e) => console.error('[TableGridView] /api/venue/tables preload failed:', e));
  }, [bookingModel, diningAreaId]);
  useEffect(() => { fetchServices(); }, [fetchServices]);
  useEffect(() => { fetchGrid(); }, [fetchGrid]);
  useEffect(() => { fetchCombinations(); }, [fetchCombinations]);
  useEffect(() => {
    return () => {
      if (reconcileTimerRef.current) {
        clearTimeout(reconcileTimerRef.current);
      }
      reconcileInFlightRef.current = false;
      pendingReconcileRef.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const loadBlocks = async () => {
      try {
        const res = await fetch(`/api/venue/tables/blocks?date=${date}`);
        if (!res.ok) return;
        const payload = await res.json();
        if (!cancelled) setBlockDetails(payload.blocks ?? []);
      } catch {
        if (!cancelled) setBlockDetails([]);
      }
    };
    void loadBlocks();
    return () => { cancelled = true; };
  }, [date, gridData?.cells.length]);
  useEffect(() => {
    try {
      const savedPct = window.localStorage.getItem(TIMELINE_SCALE_STORAGE_KEY);
      if (savedPct != null) {
        const n = Number(savedPct);
        if (Number.isFinite(n)) {
          setTimelineScalePercent(
            Math.max(TIMELINE_SCALE_PERCENT_MIN, Math.min(TIMELINE_SCALE_PERCENT_MAX, Math.round(n))),
          );
          return;
        }
      }
      const legacyPx = window.localStorage.getItem(LEGACY_SLOT_WIDTH_STORAGE_KEY);
      if (legacyPx != null) {
        const px = Number(legacyPx);
        if (Number.isFinite(px) && px > 0) {
          const pct = Math.round((px / TIMELINE_SLOT_BASE_PX) * 100);
          setTimelineScalePercent(Math.max(TIMELINE_SCALE_PERCENT_MIN, Math.min(TIMELINE_SCALE_PERCENT_MAX, pct)));
        }
      }
    } catch {
      /* ignore storage errors */
    }
  }, []);

  useEffect(() => {
    if (skipNextTimelineScalePersist.current) {
      skipNextTimelineScalePersist.current = false;
      return;
    }
    try {
      window.localStorage.setItem(TIMELINE_SCALE_STORAGE_KEY, String(timelineScalePercent));
    } catch {
      /* ignore storage errors */
    }
  }, [timelineScalePercent]);

  const timelineSlotWidthPx = useMemo(
    () => timelinePercentToSlotWidthPx(timelineScalePercent),
    [timelineScalePercent],
  );

  const bumpTimelineScale = useCallback((deltaPercent: number) => {
    setTimelineScalePercent((prev) => {
      const stepped = Math.round((prev + deltaPercent) / TIMELINE_SCALE_STEP) * TIMELINE_SCALE_STEP;
      return Math.max(TIMELINE_SCALE_PERCENT_MIN, Math.min(TIMELINE_SCALE_PERCENT_MAX, stepped));
    });
  }, []);

  const allCombinations = useMemo(() => {
    if (!gridData) return combinations;

    const comboTables: CombinationTable[] = gridData.tables.map((t) => ({
      id: t.id,
      name: t.name,
      max_covers: t.max_covers,
      is_active: t.is_active,
      position_x: t.position_x,
      position_y: t.position_y,
      width: t.width,
      height: t.height,
      rotation: t.rotation,
    }));

    const adjacencyMap = detectAdjacentTables(comboTables, combinationThreshold);
    const autoCombos: CombinationInfo[] = [];
    const seen = new Set<string>();
    const tableMap = new Map(gridData.tables.map((t) => [t.id, t]));

    for (const [tableId, neighbors] of adjacencyMap) {
      for (const neighborId of neighbors) {
        const key = [tableId, neighborId].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        const t1 = tableMap.get(tableId);
        const t2 = tableMap.get(neighborId);
        if (!t1 || !t2) continue;
        autoCombos.push({
          id: `auto_${key}`,
          name: `${t1.name} + ${t2.name}`,
          combined_max_covers: t1.max_covers + t2.max_covers,
          table_ids: [tableId, neighborId].sort(),
        });
      }
    }

    for (const [tableId, neighbors] of adjacencyMap) {
      for (const neighbor1 of neighbors) {
        for (const neighbor2 of adjacencyMap.get(neighbor1) ?? []) {
          if (neighbor2 === tableId) continue;
          const key = [tableId, neighbor1, neighbor2].sort().join('|');
          if (seen.has(key)) continue;
          seen.add(key);
          const t1 = tableMap.get(tableId);
          const t2 = tableMap.get(neighbor1);
          const t3 = tableMap.get(neighbor2);
          if (!t1 || !t2 || !t3) continue;
          autoCombos.push({
            id: `auto_${key}`,
            name: `${t1.name} + ${t2.name} + ${t3.name}`,
            combined_max_covers: t1.max_covers + t2.max_covers + t3.max_covers,
            table_ids: [tableId, neighbor1, neighbor2].sort(),
          });
        }
      }
    }

    const manualKeys = new Set(combinations.map((c) => [...c.table_ids].sort().join('|')));
    const merged = [...combinations];
    for (const auto of autoCombos) {
      const key = auto.table_ids.join('|');
      if (!manualKeys.has(key)) {
        merged.push(auto);
      }
    }

    return merged;
  }, [gridData, combinations, combinationThreshold]);

  const handleLiveChange = useCallback(() => {
    scheduleReconcile(VISUAL_RECONCILE_DELAY_MS);
  }, [scheduleReconcile]);
  const liveState = useVenueLiveSync({ venueId, date, onChange: handleLiveChange });

  const zones = useMemo(() => {
    if (!gridData) return [];
    return [...new Set(gridData.tables.map((t) => t.zone).filter(Boolean))] as string[];
  }, [gridData]);

  const filteredTables = useMemo(() => {
    if (!gridData) return [];
    let tables = gridData.tables;
    if (zoneFilter) tables = tables.filter((t) => t.zone === zoneFilter);
    return tables;
  }, [gridData, zoneFilter]);

  useEffect(() => {
    const today = formatDateInput(new Date());
    if (date !== today) return;
    const id = window.setInterval(() => setCoversClockTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, [date]);

  const viewToolbarSummary = useMemo((): ViewToolbarSummary | null => {
    void coversClockTick;
    if (!gridData) return null;
    const today = formatDateInput(new Date());
    const isToday = date === today;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const visibleTableIds = new Set(filteredTables.map((t) => t.id));
    const coversInUse = isToday ? coversInUseAtTime(gridData, nowMin, visibleTableIds) : 0;
    const tablesInUse = isToday ? tablesInUseAtTime(gridData, nowMin, visibleTableIds) : 0;
    const refMin = isToday ? nowMin : 0;
    const next_bookings_slot = computeNextBookingsSlot(gridData, refMin);
    return { ...gridData.summary, covers_in_use_now: coversInUse, tables_in_use: tablesInUse, next_bookings_slot };
  }, [gridData, date, filteredTables, coversClockTick]);

  const highlightedBookingIds = useMemo(() => {
    if (!search.trim() || !gridData) return new Set<string>();
    const q = search.toLowerCase();
    const ids = new Set<string>();
    for (const cell of gridData.cells) {
      if (cell.booking_details?.guest_name.toLowerCase().includes(q)) {
        if (cell.booking_id) ids.add(cell.booking_id);
      }
    }
    for (const b of gridData.unassigned_bookings) {
      if (b.guest_name.toLowerCase().includes(q)) ids.add(b.id);
    }
    return ids;
  }, [search, gridData]);

  const computeValidTargets = useCallback((block: { party_size: number; start_time: string; end_time: string; id: string } | null) => {
    if (!block || !gridData) {
      setValidDropTargets(null);
      setValidDropCombos(null);
      return;
    }

    const context: BookingMoveContext = {
      id: block.id,
      party_size: block.party_size,
      start_time: block.start_time,
      end_time: block.end_time,
    };
    const tableInfos = gridData.tables.map((t) => ({ id: t.id, name: t.name, max_covers: t.max_covers, position_x: t.position_x, position_y: t.position_y, width: t.width, height: t.height, rotation: t.rotation }));
    const result = computeValidMoveTargets(context, tableInfos, gridData.cells, allCombinations);

    setValidDropTargets(result.validTableIds);
    setValidDropCombos(result.comboLabels.size > 0 ? result.comboLabels : null);
  }, [gridData, allCombinations]);

  const handleDragValidation = useCallback((block: { party_size: number; start_time: string; end_time: string; id: string } | null) => {
    computeValidTargets(block);
  }, [computeValidTargets]);

  const handleReassign = useCallback(async (bookingId: string, oldTableIds: string[], newTableIds: string[]) => {
    const isUndo = isUndoingRef.current;
    const rollback = gridData;
    const pendingId = rememberPendingVisualMutation({ type: 'move', bookingId, patch: { tableIds: newTableIds } });
    commitVisualGridUpdate((prev) => withOptimisticBookingMove(prev, bookingId, { tableIds: newTableIds }));

    try {
      const res = await fetch('/api/venue/tables/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reassign',
          booking_id: bookingId,
          old_table_ids: oldTableIds,
          new_table_ids: newTableIds,
        }),
      });

      if (res.ok) {
        if (!isUndo) {
          const action: UndoAction = {
            id: crypto.randomUUID(),
            type: 'reassign_table',
            description: 'Table reassigned',
            timestamp: Date.now(),
            previous_state: { bookingId, tableIds: oldTableIds },
            current_state: { bookingId, tableIds: newTableIds },
          };
          setUndoStack((prev) => [...prev.slice(-9), action]);
          setShowUndoToast(true);
        }
        addToast('Table reassigned', 'success');
        scheduleReconcile();
      } else {
        const data = await res.json().catch(() => ({}));
        rollbackPendingMutation(pendingId, bookingId, rollback);
        addToast(data.error ?? 'Failed to reassign table', 'error');
      }
    } catch (err) {
      console.error('Reassign failed:', err);
      rollbackPendingMutation(pendingId, bookingId, rollback);
      addToast('Failed to reassign table', 'error');
    }
  }, [commitVisualGridUpdate, rememberPendingVisualMutation, rollbackPendingMutation, scheduleReconcile, addToast, gridData]);

  const handleAssign = useCallback(async (bookingId: string, tableIds: string[]) => {
    const rollback = gridData;
    const pendingId = rememberPendingVisualMutation({ type: 'move', bookingId, patch: { tableIds } });
    commitVisualGridUpdate((prev) => withOptimisticBookingMove(prev, bookingId, { tableIds }));
    try {
      const res = await fetch('/api/venue/tables/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: bookingId, table_ids: tableIds }),
      });

      if (res.ok) {
        const action: UndoAction = {
          id: crypto.randomUUID(),
          type: 'unassign',
          description: 'Table assigned',
          timestamp: Date.now(),
          previous_state: { bookingId, tableIds: [] },
          current_state: { bookingId, tableIds },
        };
        setUndoStack((prev) => [...prev.slice(-9), action]);
        setShowUndoToast(true);
        addToast('Table assigned', 'success');
        scheduleReconcile();
      } else {
        const data = await res.json().catch(() => ({}));
        rollbackPendingMutation(pendingId, bookingId, rollback);
        addToast(data.error ?? 'Failed to assign table', 'error');
      }
    } catch (err) {
      console.error('Assign failed:', err);
      rollbackPendingMutation(pendingId, bookingId, rollback);
      addToast('Failed to assign table', 'error');
    }
  }, [commitVisualGridUpdate, gridData, rememberPendingVisualMutation, rollbackPendingMutation, scheduleReconcile, addToast]);

  const handleTimeChange = useCallback(async (bookingId: string, newTime: string) => {
    const rollback = gridData;
    const pendingId = rememberPendingVisualMutation({ type: 'move', bookingId, patch: { startTime: newTime } });
    commitVisualGridUpdate((prev) => withOptimisticBookingMove(prev, bookingId, { startTime: newTime }));
    try {
      const oldBlock = gridData?.cells.find((c) => c.booking_id === bookingId);
      const oldTime = oldBlock?.booking_details?.start_time ?? '';

      const oldStart = timeToMinutes(oldBlock?.booking_details?.start_time?.slice(0, 5) ?? newTime);
      const oldEnd = oldBlock?.booking_details?.end_time
        ? timeToMinutes(oldBlock.booking_details.end_time.slice(0, 5))
        : oldStart + 90;
      const durationMins = Math.max(15, oldEnd - oldStart);
      const newEndMins = timeToMinutes(newTime) + durationMins;
      const newEndTime = `${Math.floor(newEndMins / 60).toString().padStart(2, '0')}:${(newEndMins % 60).toString().padStart(2, '0')}`;

      const res = await fetch('/api/venue/tables/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'change_time',
          booking_id: bookingId,
          new_time: newTime,
          new_estimated_end_time: `${date}T${newEndTime}:00.000Z`,
        }),
      });

      if (res.ok) {
        const action: UndoAction = {
          id: crypto.randomUUID(),
          type: 'change_time',
          description: 'Booking time changed',
          timestamp: Date.now(),
          previous_state: { bookingId, time: oldTime },
          current_state: { bookingId, time: newTime },
        };
        setUndoStack((prev) => [...prev.slice(-9), action]);
        setShowUndoToast(true);
        addToast('Booking time updated', 'success');
        scheduleReconcile();
      } else {
        const data = await res.json().catch(() => ({}));
        rollbackPendingMutation(pendingId, bookingId, rollback);
        addToast(data.error ?? 'Failed to change time', 'error');
      }
    } catch (err) {
      console.error('Time change failed:', err);
      rollbackPendingMutation(pendingId, bookingId, rollback);
      addToast('Failed to change time', 'error');
    }
  }, [commitVisualGridUpdate, gridData, date, rememberPendingVisualMutation, rollbackPendingMutation, scheduleReconcile, addToast]);

  const handleUnassign = useCallback(async (bookingId: string) => {
    const rollback = gridData;
    const existingCells = gridData?.cells.filter((c) => c.booking_id === bookingId) ?? [];
    const existingTableIds = [...new Set(existingCells.map((c) => c.table_id))];
    const pendingId = rememberPendingVisualMutation({ type: 'move', bookingId, patch: { tableIds: [] } });
    commitVisualGridUpdate((prev) => withOptimisticBookingMove(prev, bookingId, { tableIds: [] }));

    try {
      const res = await fetch('/api/venue/tables/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unassign', booking_id: bookingId }),
      });

      if (res.ok) {
        const action: UndoAction = {
          id: crypto.randomUUID(),
          type: 'unassign',
          description: 'Table unassigned',
          timestamp: Date.now(),
          previous_state: { bookingId, tableIds: existingTableIds },
          current_state: { bookingId, tableIds: [] },
        };
        setUndoStack((prev) => [...prev.slice(-9), action]);
        setShowUndoToast(true);
        addToast('Table unassigned', 'success');
        scheduleReconcile();
      } else {
        rollbackPendingMutation(pendingId, bookingId, rollback);
        addToast('Failed to unassign table', 'error');
      }
    } catch (err) {
      console.error('Unassign failed:', err);
      rollbackPendingMutation(pendingId, bookingId, rollback);
      addToast('Failed to unassign table', 'error');
    }
  }, [commitVisualGridUpdate, gridData, rememberPendingVisualMutation, rollbackPendingMutation, scheduleReconcile, addToast]);

  const handleResizeBooking = useCallback(async (bookingId: string, newEndTime: string) => {
    const rollback = gridData;
    const anchorCell = gridData?.cells.find((c) => c.booking_id === bookingId);
    const startTime = anchorCell?.booking_details?.start_time?.slice(0, 5);
    if (!startTime) return;
    if (anchorCell?.booking_details?.status === 'Completed') return;
    const startMinutes = timeToMinutes(startTime);
    const requestedEnd = Math.max(startMinutes + 15, timeToMinutes(newEndTime));
    const bookingTableIds = Array.from(new Set(
      (gridData?.cells ?? []).filter((cell) => cell.booking_id === bookingId).map((cell) => cell.table_id),
    ));
    let nextBoundary: number | null = null;
    for (const cell of gridData?.cells ?? []) {
      if (!cell.booking_id || !cell.booking_details) continue;
      if (cell.booking_id === bookingId) continue;
      if (!bookingTableIds.includes(cell.table_id)) continue;
      const otherStart = timeToMinutes(cell.booking_details.start_time.slice(0, 5));
      if (otherStart > startMinutes && (nextBoundary === null || otherStart < nextBoundary)) {
        nextBoundary = otherStart;
      }
    }
    const clampedEnd = nextBoundary === null ? requestedEnd : Math.min(requestedEnd, nextBoundary);
    const clampedEndTime = `${Math.floor(clampedEnd / 60).toString().padStart(2, '0')}:${(clampedEnd % 60).toString().padStart(2, '0')}`;
    const pendingId = rememberPendingVisualMutation({ type: 'move', bookingId, patch: { endTime: clampedEndTime } });
    commitVisualGridUpdate((prev) => withOptimisticBookingMove(prev, bookingId, { endTime: clampedEndTime }));
    try {
      const res = await fetch('/api/venue/tables/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'change_time',
          booking_id: bookingId,
          new_time: startTime,
          new_estimated_end_time: `${date}T${clampedEndTime}:00.000Z`,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        rollbackPendingMutation(pendingId, bookingId, rollback);
        addToast(payload.error ?? 'Failed to resize booking', 'error');
        return;
      }
      addToast('Booking duration updated', 'success');
      scheduleReconcile();
    } catch (err) {
      console.error('Resize failed:', err);
      rollbackPendingMutation(pendingId, bookingId, rollback);
      addToast('Failed to resize booking', 'error');
    }
  }, [commitVisualGridUpdate, gridData, date, rememberPendingVisualMutation, rollbackPendingMutation, scheduleReconcile, addToast]);

  const handleBookingStatusChange = useCallback(async (
    bookingId: string,
    currentStatus: BookingStatus,
    nextStatus: BookingStatus,
  ) => {
    const isUndo = isUndoingRef.current;
    if (!canTransitionBookingStatus(currentStatus, nextStatus)) {
      addToast(`Cannot change from ${currentStatus} to ${nextStatus}`, 'error');
      return;
    }
    if (nextStatus === 'No-Show') {
      const startTime = gridDataRef.current?.cells.find((cell) => cell.booking_id === bookingId)?.booking_details?.start_time ?? '00:00';
      if (!canMarkNoShowForSlot(date, startTime, noShowGraceMinutes)) {
        addToast('No-show can only be marked after booking start time', 'error');
        return;
      }
    }
    const completedAtOverride = (() => {
      if (nextStatus !== 'Completed') return undefined;
      const data = gridDataRef.current;
      if (!data) return undefined;
      const bookingCells = data.cells.filter((cell) => cell.booking_id === bookingId && cell.booking_details);
      const booking = bookingCells[0]?.booking_details;
      if (!booking) return undefined;
      const bookingTableIds = Array.from(new Set(bookingCells.map((cell) => cell.table_id)));
      if (bookingTableIds.length === 0) return undefined;
      const bookingStart = timeToMinutes(booking.start_time.slice(0, 5));
      const bookingEffectiveEnd = effectiveBookingEndMinutes(booking.status, booking.start_time, booking.end_time, date === formatDateInput(new Date()));
      let nextStart: number | null = null;
      for (const cell of data.cells) {
        if (!cell.booking_id || !cell.booking_details) continue;
        if (cell.booking_id === bookingId) continue;
        if (!bookingTableIds.includes(cell.table_id)) continue;
        const otherStart = timeToMinutes(cell.booking_details.start_time.slice(0, 5));
        if (otherStart <= bookingStart) continue;
        if (bookingEffectiveEnd <= otherStart) continue;
        if (nextStart === null || otherStart < nextStart) nextStart = otherStart;
      }
      return nextStart === null ? undefined : localDateTimeIso(date, nextStart);
    })();
    const rollback = gridDataRef.current;
    const pendingId = rememberPendingVisualMutation({
      type: 'status',
      bookingId,
      status: nextStatus,
      actualDepartedTime: completedAtOverride,
    });
    commitVisualGridUpdate((prev) =>
      withOptimisticBookingStatus(prev, bookingId, nextStatus, { actualDepartedTime: completedAtOverride })
    );
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: nextStatus,
          ...(completedAtOverride ? { actual_departed_time: completedAtOverride } : {}),
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        forgetPendingVisualMutation(pendingId);
        setGridData(rollback);
        addToast(payload.error ?? 'Failed to update status', 'error');
        return;
      }
    } catch (err) {
      console.error('Booking status update failed:', err);
      forgetPendingVisualMutation(pendingId);
      setGridData(rollback);
      addToast('Failed to update status', 'error');
      return;
    }
    if (!isUndo) {
      const action: UndoAction = {
        id: crypto.randomUUID(),
        type: 'change_status',
        description: `Status changed to ${bookingStatusDisplayLabel(nextStatus, true)}`,
        timestamp: Date.now(),
        previous_state: { bookingId, status: currentStatus },
        current_state: { bookingId, status: nextStatus },
      };
      setUndoStack((prev) => [...prev.slice(-9), action]);
      setShowUndoToast(true);
    }
    addToast(nextStatus === 'Completed' ? 'Marked complete' : 'Booking status updated', 'success');
    scheduleReconcile();
  }, [addToast, commitVisualGridUpdate, forgetPendingVisualMutation, rememberPendingVisualMutation, scheduleReconcile, date, noShowGraceMinutes]);

  const handleAssignAllUnassigned = useCallback(async () => {
    if (assignAllUnassignedLoading) return;
    setAssignAllUnassignedLoading(true);
    try {
      const res = await fetch('/api/venue/tables/assignments/bulk-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: false }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        addToast(data.error ?? 'Failed to auto-assign unassigned bookings', 'error');
        return;
      }
      const assigned = Number(data.assigned ?? 0);
      const attempted = Number(data.attempted ?? 0);
      const failed = Number(data.failed ?? 0);
      if (failed > 0) {
        addToast(`Assigned ${assigned}/${attempted}. ${failed} still unassigned.`, 'success');
      } else {
        addToast(`Assigned ${assigned} booking${assigned !== 1 ? 's' : ''}.`, 'success');
      }
      scheduleReconcile();
    } catch (err) {
      console.error('Assign all unassigned failed:', err);
      addToast('Failed to auto-assign unassigned bookings', 'error');
    } finally {
      setAssignAllUnassignedLoading(false);
    }
  }, [assignAllUnassignedLoading, addToast, scheduleReconcile]);

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ bookingId: string; endTime: string }>;
      if (!custom.detail?.bookingId || !custom.detail?.endTime) return;
      void handleResizeBooking(custom.detail.bookingId, custom.detail.endTime);
    };
    window.addEventListener('timeline-resize-booking', handler as EventListener);
    return () => window.removeEventListener('timeline-resize-booking', handler as EventListener);
  }, [handleResizeBooking]);

  const handleUndo = useCallback(async () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;

    isUndoingRef.current = true;
    setUndoStack((s) => s.slice(0, -1));
    setShowUndoToast(false);

    try {
      if (last.type === 'reassign_table') {
        const prev = last.previous_state as { bookingId: string; tableIds: string[] };
        const curr = last.current_state as { bookingId: string; tableIds: string[] };
        await handleReassign(prev.bookingId, curr.tableIds, prev.tableIds);
      } else if (last.type === 'change_time') {
        const prev = last.previous_state as { bookingId: string; time: string };
        if (prev.time) {
          await handleTimeChange(prev.bookingId, prev.time);
        }
      } else if (last.type === 'unassign') {
        const prev = last.previous_state as { bookingId: string; tableIds: string[] };
        const curr = last.current_state as { bookingId: string; tableIds: string[] };
        if (prev.tableIds.length === 0 && curr.tableIds.length > 0) {
          await fetch('/api/venue/tables/assignments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'unassign', booking_id: prev.bookingId }),
          });
          scheduleReconcile();
        } else if (prev.tableIds.length > 0 && curr.tableIds.length === 0) {
          await fetch('/api/venue/tables/assignments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ booking_id: prev.bookingId, table_ids: prev.tableIds }),
          });
          scheduleReconcile();
        }
      } else if (last.type === 'change_status') {
        const prev = last.previous_state as { bookingId: string; status: BookingStatus };
        const curr = last.current_state as { bookingId: string; status: BookingStatus };
        if (prev.bookingId && prev.status && curr.status) {
          await handleBookingStatusChange(prev.bookingId, curr.status, prev.status);
        }
      }
    } finally {
      isUndoingRef.current = false;
    }
  }, [undoStack, handleReassign, handleTimeChange, scheduleReconcile, handleBookingStatusChange]);

  const uniqueBlocks = useMemo(() => {
    if (!gridData) return [];
    const byId = new Map<string, { id: string; table_id: string; start_time: string; end_time: string; reason: string | null }>();
    for (const cell of gridData.cells) {
      if (!cell.block_details || !cell.block_id) continue;
      if (!byId.has(cell.block_id)) {
        byId.set(cell.block_id, {
          id: cell.block_id,
          table_id: cell.table_id,
          start_time: cell.block_details.start_time,
          end_time: cell.block_details.end_time,
          reason: cell.block_details.reason,
        });
      }
    }
    return Array.from(byId.values());
  }, [gridData]);

  const openCreateBlock = useCallback((tableId: string, time: string) => {
    const [hh, mm] = time.split(':').map(Number);
    const start = `${date}T${time}:00.000Z`;
    const endMins = (hh ?? 0) * 60 + (mm ?? 0) + 60;
    const end = `${date}T${Math.floor(endMins / 60).toString().padStart(2, '0')}:${(endMins % 60).toString().padStart(2, '0')}:00.000Z`;
    setBlockForm({
      table_id: tableId,
      start_at: start,
      end_at: end,
      reason: '',
      repeat: 'none',
    });
  }, [date]);

  const openEditBlock = useCallback((blockId: string) => {
    const block = uniqueBlocks.find((b) => b.id === blockId);
    if (!block) return;
    setBlockForm({
      id: block.id,
      table_id: block.table_id,
      start_at: `${date}T${block.start_time}:00.000Z`,
      end_at: `${date}T${block.end_time}:00.000Z`,
      reason: block.reason ?? '',
      repeat: 'none',
    });
  }, [uniqueBlocks, date]);

  const { startHour: derivedStartHour, endHour: derivedEndHour } = useMemo(
    () => getCalendarGridBounds(date, openingHours ?? undefined, 7, 21, { timeZone: venueTimezone }),
    [date, openingHours, venueTimezone],
  );
  const pickerStartHour = startHourOverride ?? derivedStartHour;
  const pickerEndHour = endHourOverride ?? derivedEndHour;

  const selectedService = services.find((s) => s.id === serviceId);

  const timelineStartTime = useMemo(() => {
    if (timeRangeFilterActive) {
      return `${String(pickerStartHour).padStart(2, '0')}:00`;
    }
    if (serviceId && selectedService) {
      return selectedService.start_time;
    }
    return `${String(derivedStartHour).padStart(2, '0')}:00`;
  }, [timeRangeFilterActive, pickerStartHour, serviceId, selectedService, derivedStartHour]);

  const timelineEndTime = useMemo(() => {
    const today = formatDateInput(new Date());
    const isToday = date === today;
    const configuredEnd = (() => {
      if (timeRangeFilterActive) {
        return `${String(pickerEndHour).padStart(2, '0')}:00`;
      }
      if (serviceId && selectedService) {
        return selectedService.end_time;
      }
      return `${String(derivedEndHour).padStart(2, '0')}:00`;
    })();
    const configuredEndMinutes = timeToMinutes(configuredEnd);
    const latestBookingEndMinutes = Math.max(
      configuredEndMinutes,
      ...(gridData?.cells
        .filter((cell) => cell.booking_id && cell.booking_details)
        .map((cell) =>
          effectiveBookingEndMinutes(
            cell.booking_details!.status,
            cell.booking_details!.start_time,
            cell.booking_details!.end_time,
            isToday,
          )
        ) ?? []),
      ...(gridData?.unassigned_bookings
        .map((booking) =>
          effectiveBookingEndMinutes(booking.status, booking.start_time, booking.end_time, isToday)
        ) ?? []),
    );
    const slotInterval = gridData?.slot_interval_minutes ?? 15;
    return minutesToTime(Math.ceil(latestBookingEndMinutes / slotInterval) * slotInterval);
  }, [timeRangeFilterActive, pickerEndHour, serviceId, selectedService, derivedEndHour, gridData, date, coversClockTick]);

  const timelineCells = useMemo(() => {
    if (!gridData?.cells) return [];
    if (!timeRangeFilterActive) return gridData.cells;
    return gridData.cells.map((c) => {
      if (!c.booking_id || !c.booking_details) return c;
      const start = c.booking_details.start_time.slice(0, 5);
      if (!isBookingTimeInHourRange(start, pickerStartHour, pickerEndHour)) {
        return { ...c, booking_id: null, booking_details: null };
      }
      return c;
    });
  }, [gridData, timeRangeFilterActive, pickerStartHour, pickerEndHour]);

  const timelineUnassigned = useMemo(() => {
    if (!gridData?.unassigned_bookings) return [];
    if (!timeRangeFilterActive) return gridData.unassigned_bookings;
    return gridData.unassigned_bookings.filter((b) =>
      isBookingTimeInHourRange(b.start_time.slice(0, 5), pickerStartHour, pickerEndHour),
    );
  }, [gridData, timeRangeFilterActive, pickerStartHour, pickerEndHour]);

  return (
    <div className="flex min-h-[calc(100dvh-6rem)] flex-1 flex-col gap-1.5 sm:gap-2">
      {gridData && viewToolbarSummary ? (
        <OperationsWorkspaceToolbar
          title="Table grid"
          summary={viewToolbarSummary}
          date={date}
          onDateChange={setDate}
          liveState={liveState}
          onRefresh={() => { void fetchGrid(); }}
          onNewBooking={() => setNewBookingCell({ tableId: '', time: '' })}
          onWalkIn={() => {
            setWalkInCell({ tableId: '', time: '' });
          }}
          compact
          showControlsButton={false}
          timelineLabel={`${String(pickerStartHour).padStart(2, '0')}-${String(pickerEndHour).padStart(2, '0')}`}
          timelinePanel={(
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Visible hours</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="block min-w-0">
                  <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">From</span>
                  <select
                    value={pickerStartHour}
                    onChange={(e) => {
                      const start = Number(e.target.value);
                      const end = Math.max(pickerEndHour, start + 1);
                      setStartHourOverride(start);
                      setEndHourOverride(end);
                      setTimeRangeFilterActive(true);
                    }}
                    className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 py-0 pr-7 text-xs shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  >
                    {Array.from({ length: 24 }, (_, hour) => hour)
                      .filter((hour) => hour < pickerEndHour)
                      .map((hour) => (
                        <option key={hour} value={hour}>
                          {String(hour).padStart(2, '0')}:00
                        </option>
                      ))}
                  </select>
                </label>
                <label className="block min-w-0">
                  <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Until</span>
                  <select
                    value={pickerEndHour}
                    onChange={(e) => {
                      const end = Number(e.target.value);
                      const start = Math.min(pickerStartHour, end - 1);
                      setStartHourOverride(start);
                      setEndHourOverride(end);
                      setTimeRangeFilterActive(true);
                    }}
                    className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 py-0 pr-7 text-xs shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  >
                    {Array.from({ length: 24 }, (_, hour) => hour)
                      .filter((hour) => hour > pickerStartHour)
                      .map((hour) => (
                        <option key={hour} value={hour}>
                          {String(hour).padStart(2, '0')}:00
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              {timeRangeFilterActive ? (
                <button
                  type="button"
                  onClick={() => {
                    setStartHourOverride(null);
                    setEndHourOverride(null);
                    setTimeRangeFilterActive(false);
                  }}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  Clear time filter
                </button>
              ) : null}
            </div>
          )}
          datePickerPanel={(
            <div className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm sm:p-3">
              <CalendarDateTimePicker
                date={date}
                onDateChange={setDate}
                startHour={pickerStartHour}
                endHour={pickerEndHour}
                onTimeRangeChange={() => undefined}
              />
            </div>
          )}
          controlsPanel={(
            <div />
          )}
          summaryTools={(
            <div className="flex h-7 shrink-0 items-stretch rounded-lg border border-slate-200 bg-white text-[11px] shadow-sm sm:h-8">
                <button
                  type="button"
                  onClick={() => bumpTimelineScale(-TIMELINE_SCALE_STEP)}
                  disabled={timelineScalePercent <= TIMELINE_SCALE_PERCENT_MIN}
                  className="px-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Narrower time columns"
                  aria-label="Decrease timeline scale"
                >
                  −
                </button>
                <span className="flex min-w-[2.75rem] items-center justify-center border-x border-slate-200 px-1 font-medium tabular-nums text-slate-600 sm:min-w-[3.25rem]">
                  {timelineScalePercent}%
                </span>
                <button
                  type="button"
                  onClick={() => bumpTimelineScale(TIMELINE_SCALE_STEP)}
                  disabled={timelineScalePercent >= TIMELINE_SCALE_PERCENT_MAX}
                  className="px-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Wider time columns"
                  aria-label="Increase timeline scale"
                >
                  +
                </button>
              </div>
          )}
          toolbarTools={(toolbarPanelAnchorRef) => (
            <>
              <div ref={searchPopoverRef} className="relative shrink-0">
                <button
                  ref={searchTriggerRef}
                  type="button"
                  onClick={() => setSearchOpen((prev) => !prev)}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border shadow-sm transition-colors ${
                    search || searchOpen
                      ? 'border-brand-200 bg-brand-50 text-brand-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                  }`}
                  aria-label="Search guest"
                  aria-expanded={searchOpen}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                  </svg>
                </button>
                <ClampedFixedDropdown
                  open={searchOpen}
                  triggerRef={searchTriggerRef}
                  verticalAnchorRef={toolbarPanelAnchorRef}
                  horizontalCenter
                  gapPx={4}
                  align="start"
                  maxWidthPx={272}
                  className="animate-fade-in z-40 rounded-lg border border-slate-200 bg-white p-1 shadow-xl shadow-slate-900/10 ring-1 ring-slate-100"
                >
                  <div className="relative">
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search guest"
                      className="h-8 w-full rounded-md border border-slate-200 bg-white py-0 pl-7 pr-7 text-xs shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                    <svg className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                    </svg>
                    {search ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSearch('');
                          searchInputRef.current?.focus();
                        }}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        aria-label="Clear guest search"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                </ClampedFixedDropdown>
              </div>
              {showDiningAreaChrome && diningAreaId ? (
                <DiningAreaPicker
                  areas={diningAreas}
                  value={diningAreaId}
                  onChange={setDiningAreaFilter}
                  verticalAnchorRef={toolbarPanelAnchorRef}
                  compact
                />
              ) : null}
              <div ref={filterPopoverRef} className="relative shrink-0">
                <button
                  ref={filterTriggerRef}
                  type="button"
                  onClick={() => setFilterOpen((prev) => !prev)}
                  className={`inline-flex h-8 items-center justify-center gap-1 rounded-lg border px-2 text-[11px] font-semibold shadow-sm transition-colors ${
                    serviceId || statusFilter || filterOpen
                      ? 'border-brand-200 bg-brand-50 text-brand-700'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                  aria-label="Filter services and statuses"
                  aria-expanded={filterOpen}
                >
                  <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25h16.5M6.75 12h10.5M10 18.75h4" />
                  </svg>
                  <span>Filter</span>
                  {serviceId || statusFilter ? (
                    <span className="ml-0.5 rounded-full bg-brand-600 px-1.5 py-0.5 text-[9px] leading-none text-white">
                      {[serviceId, statusFilter].filter(Boolean).length}
                    </span>
                  ) : null}
                </button>
                <ClampedFixedDropdown
                  open={filterOpen}
                  triggerRef={filterTriggerRef}
                  verticalAnchorRef={toolbarPanelAnchorRef}
                  horizontalCenter
                  gapPx={4}
                  align="start"
                  maxWidthPx={272}
                  className="animate-fade-in z-40 rounded-xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10 ring-1 ring-slate-100"
                >
                  <div className="space-y-2">
                    <label className="block">
                      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Service</span>
                      <select
                        value={serviceId ?? ''}
                        onChange={(e) => setServiceId(e.target.value || null)}
                        className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 py-0 pr-7 text-xs font-medium text-slate-700 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        aria-label="Service filter"
                      >
                        <option value="">All services</option>
                        {services.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Status</span>
                      <select
                        value={statusFilter ?? ''}
                        onChange={(e) => setStatusFilter(e.target.value || null)}
                        className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 py-0 pr-7 text-xs font-medium text-slate-700 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        aria-label="Status filter"
                      >
                        <option value="">All statuses</option>
                        <option value="Booked">Booked</option>
                        <option value="Confirmed">Confirmed</option>
                        <option value="Pending">Pending</option>
                        <option value="Seated">Seated</option>
                        <option value="Completed">Completed</option>
                        <option value="Arrived">Arrived</option>
                      </select>
                    </label>
                    {(serviceId || statusFilter) ? (
                      <button
                        type="button"
                        onClick={() => {
                          setServiceId(null);
                          setStatusFilter(null);
                        }}
                        className="h-8 rounded-lg px-2 text-[11px] font-semibold text-brand-700 hover:bg-brand-50"
                      >
                        Clear filters
                      </button>
                    ) : null}
                  </div>
                </ClampedFixedDropdown>
              </div>
              {zones.length > 0 ? (
                <select
                  value={zoneFilter ?? ''}
                  onChange={(e) => setZoneFilter(e.target.value || null)}
                  className="h-8 w-[5.75rem] min-w-0 shrink-0 truncate rounded-lg border border-slate-200 bg-white px-1.5 py-0 pr-5 text-[11px] font-medium text-slate-700 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 sm:w-[6.25rem] sm:pr-6"
                  aria-label="Zone filter"
                >
                  <option value="">All zones</option>
                  {zones.map((z) => (
                    <option key={z} value={z}>{z}</option>
                  ))}
                </select>
              ) : null}
              {(serviceId || statusFilter || zoneFilter) ? (
                <button
                  type="button"
                  onClick={() => {
                    setServiceId(null);
                    setStatusFilter(null);
                    setZoneFilter(null);
                  }}
                  className="h-8 shrink-0 whitespace-nowrap rounded-lg px-2 text-[11px] font-semibold text-brand-700 hover:bg-brand-50"
                >
                  Clear
                </button>
              ) : null}
            </>
          )}
        />
      ) : null}
      <SectionCard elevated className="relative flex min-h-[calc(100dvh-12rem)] w-full flex-1 flex-col sm:min-h-[calc(100dvh-10.5rem)] lg:min-h-[calc(100dvh-8.5rem)]">
        <SectionCard.Body className="min-h-0 flex-1 p-0">
        {loading ? (
          <div className="min-h-[40vh] p-4 sm:p-5">
            <DashboardGridSkeleton />
          </div>
        ) : gridData && gridData.tables.length === 0 ? (
          <div className="min-h-[40vh] px-4 py-10">
            <EmptyState
              title="No active tables configured"
              description="Add and activate tables in Tables settings to use the grid."
            />
          </div>
        ) : gridData ? (
          <TimelineGrid
            tables={filteredTables}
            cells={timelineCells}
            unassignedBookings={timelineUnassigned}
            combinations={allCombinations}
            combinationThreshold={combinationThreshold}
            serviceStartTime={timelineStartTime}
            serviceEndTime={timelineEndTime}
            slotIntervalMinutes={gridData.slot_interval_minutes}
            statusFilter={statusFilter}
            highlightedBookingIds={highlightedBookingIds}
            validDropTargets={validDropTargets}
            validDropCombos={validDropCombos}
            currentDate={date}
            slotWidth={timelineSlotWidthPx}
            onReassign={handleReassign}
            onTimeChange={handleTimeChange}
            onAssign={handleAssign}
            onUnassign={handleUnassign}
            onResizeBooking={handleResizeBooking}
            onRefresh={fetchGrid}
            onDragValidation={handleDragValidation}
            onError={(msg) => addToast(msg, 'error')}
            onBookingClick={openBookingPopover}
            onEditBooking={openBookingDrawer}
            onSendMessage={openBookingDrawer}
            onCellClick={(tableId, time, anchor) => {
              if (moveBookingId) {
                const currentAssignments = gridData.cells.filter((c) => c.booking_id === moveBookingId).map((c) => c.table_id);
                const oldTableIds = Array.from(new Set(currentAssignments));
                const movingToNewTable = oldTableIds.length > 0 && !oldTableIds.includes(tableId);
                if (movingToNewTable) {
                  void handleReassign(moveBookingId, oldTableIds, [tableId]);
                } else if (oldTableIds.length > 0 && oldTableIds.includes(tableId)) {
                  const currentStart = gridData.cells.find((c) => c.booking_id === moveBookingId)?.booking_details?.start_time?.slice(0, 5);
                  if (currentStart && currentStart !== time) {
                    void handleTimeChange(moveBookingId, time);
                  }
                }
                setMoveBookingId(null);
                return;
              }
              setCellContext({ tableId, time, x: anchor.x, y: anchor.y });
            }}
            onBlockClick={(blockId) => setActiveBlockId(blockId)}
            onCellContextMenu={(tableId, time, x, y) => setCellContext({ tableId, time, x, y })}
            onBlockAfterBooking={(tableId, endTime) => openCreateBlock(tableId, endTime)}
            onMoveBooking={setMoveBookingId}
            onRescheduleBooking={(bookingId) => {
              const existing = gridData.cells.find((cell) => cell.booking_id === bookingId)?.booking_details?.start_time?.slice(0, 5) ?? '18:00';
              setRescheduleDialog({ bookingId, time: existing });
            }}
            onAssignAllUnassigned={() => {
              void handleAssignAllUnassigned();
            }}
            assignAllUnassignedLoading={assignAllUnassignedLoading}
            onBookingStatusChange={handleBookingStatusChange}
          />
        ) : (
          <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
              <svg className="h-7 w-7 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700">No bookings for this date</p>
              <p className="mt-1 text-xs text-slate-500">
                Select a different date or service, or create a booking to see it here.
              </p>
            </div>
          </div>
        )}
        </SectionCard.Body>
      </SectionCard>

      {showUndoToast && undoStack.length > 0 && (
        <UndoToast
          action={undoStack[undoStack.length - 1]!}
          onUndo={handleUndo}
          onDismiss={() => setShowUndoToast(false)}
        />
      )}
      {selectedBookingId && (
        <BookingDetailPanel
          bookingId={selectedBookingId}
          venueId={venueId}
          venueCurrency={currency}
          initialSnapshot={selectedBookingSnapshot}
          onStatusChange={handleBookingStatusChange}
          onClose={() => {
            setSelectedBookingId(null);
            setSelectedBookingAnchor(null);
          }}
          onUpdated={() => {
            fetchGrid({ silent: true });
          }}
          presentation={selectedBookingAnchor ? 'popover' : 'drawer'}
          anchor={selectedBookingAnchor}
        />
      )}
      {cellContext && cellContextMenuStyle ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCellContext(null)} />
          <div
            className="fixed z-50 rounded-2xl border border-slate-200/80 bg-white p-2 shadow-xl shadow-slate-900/15 ring-1 ring-slate-100"
            style={cellContextMenuStyle}
          >
            <p className="px-2 py-1 text-[11px] font-semibold text-slate-800">Slot actions</p>
            <p className="px-2 pb-1 text-[10px] text-slate-500">{cellContext.time}</p>
            <div className="grid gap-1">
              <button
                type="button"
                onClick={() => {
                  setNewBookingCell({ tableId: cellContext.tableId, time: cellContext.time });
                  setCellContext(null);
                }}
                className="rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
              >
                New Booking
              </button>
              <button
                type="button"
                onClick={() => {
                  openCreateBlock(cellContext.tableId, cellContext.time);
                  setCellContext(null);
                }}
                className="rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
              >
                Block This Slot
              </button>
              <button
                type="button"
                onClick={() => {
                  setWalkInCell({ tableId: cellContext.tableId, time: '' });
                  setCellContext(null);
                }}
                className="rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
              >
                Walk-in
              </button>
            </div>
          </div>
        </>
      ) : null}
      {moveBookingId && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-800 shadow">
          Move mode active: click a target cell, or{' '}
          <button type="button" onClick={() => setMoveBookingId(null)} className="font-semibold underline">
            cancel
          </button>
          .
        </div>
      )}
      {activeBlockId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100">
            {(() => {
              const block = blockDetails.find((item) => item.id === activeBlockId);
              const tableName = gridData?.tables.find((table) => table.id === block?.table_id)?.name ?? block?.table_id ?? 'Unknown';
              return (
                <>
                  <h3 className="text-base font-semibold text-slate-900">Block Details</h3>
                  <div className="mt-3 space-y-1 text-sm text-slate-700">
                    <p><span className="font-medium">Table:</span> {tableName}</p>
                    <p><span className="font-medium">Time:</span> {block ? `${new Date(block.start_at).toISOString().slice(11, 16)}-${new Date(block.end_at).toISOString().slice(11, 16)}` : '-'}</p>
                    <p><span className="font-medium">Reason:</span> {block?.reason ?? '-'}</p>
                    <p><span className="font-medium">Created:</span> {block ? new Date(block.created_at).toLocaleString() : '-'}</p>
                    <p><span className="font-medium">Created by:</span> {block?.created_by ?? '-'}</p>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        openEditBlock(activeBlockId);
                        setActiveBlockId(null);
                      }}
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Edit Block
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!confirm('Remove this block? This will make the slot available for bookings again.')) return;
                        const res = await fetch('/api/venue/tables/blocks', {
                          method: 'DELETE',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ id: activeBlockId }),
                        });
                        if (!res.ok) {
                          addToast('Failed to remove block', 'error');
                          return;
                        }
                        addToast('Block removed', 'success');
                        setActiveBlockId(null);
                        fetchGrid();
                      }}
                      className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                    >
                      Remove Block
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveBlockId(null)}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Close
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
      {rescheduleDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100">
            <h3 className="text-base font-semibold text-slate-900">Reschedule Booking</h3>
            <p className="mt-1 text-xs text-slate-500">Pick a new start time.</p>
            <input
              type="time"
              value={rescheduleDialog.time}
              onChange={(e) => setRescheduleDialog((prev) => prev ? { ...prev, time: e.target.value } : prev)}
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  void handleTimeChange(rescheduleDialog.bookingId, rescheduleDialog.time);
                  setRescheduleDialog(null);
                }}
                className="flex-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setRescheduleDialog(null)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {newBookingCell && (
        <DashboardStaffBookingModal
          open
          title="New booking"
          onClose={() => setNewBookingCell(null)}
          onCreated={() => {
            setNewBookingCell(null);
            fetchGrid();
          }}
          venueId={venueId}
          currency={currency ?? 'GBP'}
          bookingModel={bookingModel}
          enabledModels={enabledModels}
          advancedMode
          initialDate={date}
        />
      )}
      {walkInCell && (
        <DashboardStaffBookingModal
          open
          title="Walk-in"
          bookingIntent="walk-in"
          onClose={() => setWalkInCell(null)}
          onCreated={() => { setWalkInCell(null); fetchGrid(); }}
          venueId={venueId}
          currency={currency ?? 'GBP'}
          bookingModel={bookingModel}
          enabledModels={enabledModels}
          advancedMode
          initialDate={date}
          initialTime={walkInCell.time || undefined}
        />
      )}
      {blockForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100">
            <h3 className="text-base font-semibold text-slate-900">{blockForm.id ? 'Edit Table Block' : 'Block Table'}</h3>
            <div className="mt-4 space-y-3">
              <input
                type="datetime-local"
                value={blockForm.start_at.slice(0, 16)}
                onChange={(e) => setBlockForm((prev) => prev ? { ...prev, start_at: `${e.target.value}:00.000Z` } : prev)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="datetime-local"
                value={blockForm.end_at.slice(0, 16)}
                onChange={(e) => setBlockForm((prev) => prev ? { ...prev, end_at: `${e.target.value}:00.000Z` } : prev)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                value={blockForm.reason}
                onChange={(e) => setBlockForm((prev) => prev ? { ...prev, reason: e.target.value } : prev)}
                placeholder="Reason (optional)"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              {!blockForm.id && (
                <select
                  value={blockForm.repeat ?? 'none'}
                  onChange={(e) => setBlockForm((prev) => prev ? { ...prev, repeat: e.target.value as 'none' | 'week' } : prev)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="none">Repeat: None</option>
                  <option value="week">Repeat: Every day this week</option>
                </select>
              )}
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={blockSaving}
                onClick={async () => {
                  setBlockSaving(true);
                  const method = blockForm.id ? 'PATCH' : 'POST';
                  const body = blockForm.id
                    ? { id: blockForm.id, start_at: blockForm.start_at, end_at: blockForm.end_at, reason: blockForm.reason || null }
                    : {
                        table_id: blockForm.table_id,
                        start_at: blockForm.start_at,
                        end_at: blockForm.end_at,
                        reason: blockForm.reason || null,
                        repeat: blockForm.repeat ?? 'none',
                      };
                  const res = await fetch('/api/venue/tables/blocks', {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                  });
                  setBlockSaving(false);
                  if (!res.ok) {
                    const payload = await res.json().catch(() => ({}));
                    addToast(payload.error ?? 'Failed to save block', 'error');
                    return;
                  }
                  addToast(blockForm.id ? 'Block updated' : 'Block created', 'success');
                  setBlockForm(null);
                  setNewBookingCell(null);
                  fetchGrid();
                }}
                className="flex-1 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-60"
              >
                Save
              </button>
              {blockForm.id && (
                <button
                  type="button"
                  disabled={blockSaving}
                  onClick={async () => {
                    if (!confirm('Remove this block?')) return;
                    setBlockSaving(true);
                    const res = await fetch('/api/venue/tables/blocks', {
                      method: 'DELETE',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ id: blockForm.id }),
                    });
                    setBlockSaving(false);
                    if (!res.ok) {
                      const payload = await res.json().catch(() => ({}));
                      addToast(payload.error ?? 'Failed to remove block', 'error');
                      return;
                    }
                    addToast('Block removed', 'success');
                    setBlockForm(null);
                    fetchGrid();
                  }}
                  className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                >
                  Remove
                </button>
              )}
              <button
                type="button"
                onClick={() => setBlockForm(null)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

