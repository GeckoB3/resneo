'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback, useMemo, useRef, type RefObject } from 'react';
import dynamic from 'next/dynamic';
import type { VenueTable, TableGridData, TableBlock, UndoAction } from '@/types/table-management';
import { useVenueLiveSync } from '@/lib/realtime/useVenueLiveSync';
import { getTableStatus, type TableOperationalStatus } from '@/lib/table-management/table-status';
import { DashboardStaffBookingModal } from '@/components/booking/DashboardStaffBookingModal';
import type { BookingModel } from '@/types/booking-models';
import { UndoToast } from '@/app/dashboard/table-grid/UndoToast';
import { BookingDetailPanel, type BookingDetailPanelSnapshot } from '@/app/dashboard/bookings/BookingDetailPanel';
import { OperationsWorkspaceToolbar } from '@/components/dashboard/OperationsWorkspaceToolbar';
import { DiningAreaPicker } from '@/components/dashboard/DiningAreaPicker';
import { useToast } from '@/components/ui/Toast';
import { detectAdjacentTables, type CombinationTable } from '@/lib/table-management/combination-engine';
import {
  BOOKING_REVERT_ACTIONS,
  canMarkNoShowForSlot,
  canTransitionBookingStatus,
  isBookingStatus,
  isDestructiveBookingStatus,
  isRevertTransition,
  type BookingStatus,
} from '@/lib/table-management/booking-status';
import { BookingActionMenu, type BookingActionMenuBooking } from '@/components/table-management/BookingActionMenu';
import { computePointAnchoredMenuStyle } from '@/lib/ui/clamped-floating-styles';
import { useViewportBounds } from '@/lib/ui/use-viewport-bounds';
import { coversInUseAtTime } from '@/lib/table-management/covers-at-time';
import { computeNextBookingsSlot } from '@/lib/table-management/next-bookings-slot';
import { computeValidMoveTargets, resolveDropTarget, type CombinationInfo, type BookingMoveContext } from '@/lib/table-management/move-validation';
import type { FloorDragEvent } from './LiveFloorCanvas';
import { bookingStatusDisplayLabel } from '@/lib/booking/infer-booking-row-model';
import { CalendarDateTimePicker } from '@/components/calendar/CalendarDateTimePicker';
import { getCalendarGridBounds } from '@/lib/venue-calendar-bounds';
import type { OpeningHours } from '@/types/availability';
import type { VenueArea } from '@/types/areas';
import {
  FLOOR_PLAN_DEFAULT_LAYOUT_HEIGHT,
  FLOOR_PLAN_DEFAULT_LAYOUT_WIDTH,
} from '@/lib/floor-plan/fit-view';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { EmptyState } from '@/components/ui/dashboard/EmptyState';
import { DashboardGridSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';
import { useDashboardVenueBootstrap } from '@/components/providers/DashboardVenueBootstrapProvider';
import { readSessionPreference, writeSessionPreference } from '@/lib/ui/session-preferences';

const LiveFloorCanvas = dynamic(() => import('./LiveFloorCanvas'), { ssr: false });
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

interface FloorPlanLivePreferences {
  selectedDate?: string;
  selectedTime?: string;
  startHourOverride?: number | null;
  endHourOverride?: number | null;
  timeRangeFilterActive?: boolean;
}

function floorPlanLivePreferencesKey(venueId: string): string {
  return `reserve:dashboard:floor-plan:${venueId}:live-preferences`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableHour(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 24);
}

function isFloorPlanLivePreferences(value: unknown): value is FloorPlanLivePreferences {
  if (!isRecord(value)) return false;
  if (value.selectedDate !== undefined && (typeof value.selectedDate !== 'string' || !ISO_DATE_RE.test(value.selectedDate))) return false;
  if (value.selectedTime !== undefined && (typeof value.selectedTime !== 'string' || !TIME_RE.test(value.selectedTime))) return false;
  if (value.startHourOverride !== undefined && !isNullableHour(value.startHourOverride)) return false;
  if (value.endHourOverride !== undefined && !isNullableHour(value.endHourOverride)) return false;
  if (value.timeRangeFilterActive !== undefined && typeof value.timeRangeFilterActive !== 'boolean') return false;
  return true;
}

interface BookingOnTable {
  id: string;
  guest_name: string;
  party_size: number;
  start_time: string;
  estimated_end_time: string | null;
  status: string;
  dietary_notes: string | null;
  occasion: string | null;
  deposit_status?: string | null;
}

interface TableWithState extends VenueTable {
  service_status: TableOperationalStatus;
  booking: BookingOnTable | null;
  elapsed_pct: number;
  /** Uncapped % through booking window (100 = end); &gt;100 overdue. */
  turn_progress_pct: number;
}

function formatDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatIsoTimeUk(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso.slice(11, 16);
  }
}

function minutesFromTime(value: string): number {
  const [h, m] = value.slice(0, 5).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function timeToMinutesShort(t: string): number {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function minutesToTimeShort(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
}

function bookingEndMinutes(booking: BookingOnTable, selectedDate: string, nowMinutes: number): number {
  const startMin = minutesFromTime(booking.start_time);
  let endMin = booking.estimated_end_time
    ? minutesFromTime(new Date(booking.estimated_end_time).toISOString().slice(11, 16))
    : startMin + 90;
  if (endMin <= startMin) {
    endMin += 24 * 60;
  }
  if (
    (booking.status === 'Seated' || booking.status === 'Arrived') &&
    selectedDate === formatDateInput(new Date()) &&
    nowMinutes > startMin
  ) {
    endMin = Math.max(endMin, nowMinutes);
  }
  return endMin;
}

const BLOCK_DURATION_PRESETS = [30, 45, 60, 90, 120, 180] as const;

export interface FloorPlanAreaNavConfig {
  areas: VenueArea[];
  value: string;
  onChange: (id: string) => void;
}

export function FloorPlanLiveView({
  isAdmin = false,
  venueId,
  currency,
  bookingModel = 'table_reservation',
  enabledModels = [],
  diningAreaId = null,
  areaNav = null,
  editLayoutHref,
}: {
  isAdmin?: boolean;
  venueId: string;
  currency?: string;
  bookingModel?: BookingModel;
  enabledModels?: BookingModel[];
  /** Scope tables, grid, and combinations to this dining area (multi-area venues). */
  diningAreaId?: string | null;
  /** Multi-area dining: tabs + change handler (rendered in compact toolbar). */
  areaNav?: FloorPlanAreaNavConfig | null;
  /** Admin link to layout editor in Dining Availability. */
  editLayoutHref?: string;
}) {
  const viewportBounds = useViewportBounds();
  const venueBootstrap = useDashboardVenueBootstrap();
  const { addToast } = useToast();
  const preferencesKey = floorPlanLivePreferencesKey(venueId);
  const rememberedPreferences = useMemo(
    () => readSessionPreference<FloorPlanLivePreferences>(preferencesKey, {}, isFloorPlanLivePreferences),
    [preferencesKey],
  );
  const [tables, setTables] = useState<VenueTable[]>([]);
  const [gridData, setGridData] = useState<TableGridData | null>(null);
  const [blocks, setBlocks] = useState<TableBlock[]>([]);
  const [bookingMap, setBookingMap] = useState<Map<string, BookingOnTable>>(new Map());
  const [loading, setLoading] = useState(true);
  const [viewportRefreshing, setViewportRefreshing] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  /** Mobile/tablet: expand table detail sheet for full actions. */
  const [tableDetailSheetExpanded, setTableDetailSheetExpanded] = useState(false);
  const [combinedTableGroups, setCombinedTableGroups] = useState<Map<string, string[]>>(new Map());
  const [manualCombinations, setManualCombinations] = useState<CombinationInfo[]>([]);
  const [selectedDate, setSelectedDate] = useState(rememberedPreferences.selectedDate ?? formatDateInput(new Date()));
  const [selectedTime, setSelectedTime] = useState(() => {
    if (rememberedPreferences.selectedTime) return rememberedPreferences.selectedTime;
    const now = new Date();
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  });
  const [debouncedTime, setDebouncedTime] = useState(selectedTime);
  const [clockTick, setClockTick] = useState(0);
  const [noShowGraceMinutes, setNoShowGraceMinutes] = useState(15);
  const [combinationThreshold, setCombinationThreshold] = useState(80);
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel: string; onConfirm: () => void } | null>(null);

  // Booking detail panel
  const [detailBookingId, setDetailBookingId] = useState<string | null>(null);

  // Booking creation / walk-in
  const [showNewBookingForm, setShowNewBookingForm] = useState(false);
  const [showWalkInModal, setShowWalkInModal] = useState(false);

  /** Block table: modal with start time + duration */
  const [floorBlockModal, setFloorBlockModal] = useState<{ tableId: string; tableName: string } | null>(null);
  const [floorBlockStartTime, setFloorBlockStartTime] = useState('12:00');
  const [floorBlockDurationMins, setFloorBlockDurationMins] = useState<number>(60);
  const [floorBlockReason, setFloorBlockReason] = useState('');
  const [floorBlockSaving, setFloorBlockSaving] = useState(false);

  const [openingHours, setOpeningHours] = useState<OpeningHours | null>(null);
  const [venueTimezone, setVenueTimezone] = useState<string>('Europe/London');
  const [startHourOverride, setStartHourOverride] = useState<number | null>(rememberedPreferences.startHourOverride ?? null);
  const [endHourOverride, setEndHourOverride] = useState<number | null>(rememberedPreferences.endHourOverride ?? null);
  const [timeRangeFilterActive, setTimeRangeFilterActive] = useState(rememberedPreferences.timeRangeFilterActive ?? false);

  // Drag/drop & reassign
  const [reassignMode, setReassignMode] = useState<{ bookingId: string; guestName: string; oldTableIds: string[] } | null>(null);
  const [validDropTargets, setValidDropTargets] = useState<Set<string> | null>(null);
  const [validDropComboLabels, setValidDropComboLabels] = useState<Map<string, string> | null>(null);
  const [dragSourceTableIds, setDragSourceTableIds] = useState<string[]>([]);
  const [floorPlanLayout, setFloorPlanLayout] = useState({
    width: FLOOR_PLAN_DEFAULT_LAYOUT_WIDTH,
    height: FLOOR_PLAN_DEFAULT_LAYOUT_HEIGHT,
  });
  const [floorPlanBackgroundUrl, setFloorPlanBackgroundUrl] = useState<string | null>(null);
  const [detailBookingAnchor, setDetailBookingAnchor] = useState<{ x: number; y: number } | null>(null);
  const [floorBookingMenu, setFloorBookingMenu] = useState<{
    booking: BookingActionMenuBooking;
    x: number;
    y: number;
  } | null>(null);
  const [rescheduleDialog, setRescheduleDialog] = useState<{ bookingId: string; time: string } | null>(null);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedTime(selectedTime), 300);
    return () => clearTimeout(timeout);
  }, [selectedTime]);

  useEffect(() => {
    if (selectedDate !== formatDateInput(new Date())) return;
    const interval = window.setInterval(() => setClockTick((n) => n + 1), 60_000);
    return () => window.clearInterval(interval);
  }, [selectedDate]);

  useEffect(() => {
    if (venueBootstrap) {
      setOpeningHours(venueBootstrap.openingHours);
      setVenueTimezone(venueBootstrap.timezone);
      return;
    }
    let cancelled = false;
    void fetch('/api/venue')
      .then((res) => (res.ok ? res.json() : null))
      .then((v) => {
        if (cancelled || !v) return;
        if (v.opening_hours) setOpeningHours(v.opening_hours as OpeningHours);
        const tz = v.timezone;
        if (typeof tz === 'string' && tz.trim() !== '') setVenueTimezone(tz.trim());
      })
      .catch((e) => console.error('[FloorPlanLiveView] /api/venue preload failed:', e));
    return () => {
      cancelled = true;
    };
  }, [venueBootstrap]);

  const selectedDateHydrated = useRef(false);
  useEffect(() => {
    if (!selectedDateHydrated.current) {
      selectedDateHydrated.current = true;
      return;
    }
    setStartHourOverride(null);
    setEndHourOverride(null);
    setTimeRangeFilterActive(false);
  }, [selectedDate]);

  useEffect(() => {
    writeSessionPreference<FloorPlanLivePreferences>(preferencesKey, {
      selectedDate,
      selectedTime,
      startHourOverride,
      endHourOverride,
      timeRangeFilterActive,
    });
  }, [preferencesKey, selectedDate, selectedTime, startHourOverride, endHourOverride, timeRangeFilterActive]);

  const { startHour: derivedStartHour, endHour: derivedEndHour } = useMemo(
    () => getCalendarGridBounds(selectedDate, openingHours ?? undefined, 7, 21, { timeZone: venueTimezone }),
    [selectedDate, openingHours, venueTimezone],
  );
  const pickerStartHour = startHourOverride ?? derivedStartHour;
  const pickerEndHour = endHourOverride ?? derivedEndHour;

  /** Inclusive minute range for timeline scrubber (end hour matches calendar: exclusive upper bound). */
  const timelineScrubBounds = useMemo(() => {
    const minM = pickerStartHour * 60;
    const maxM = Math.max(minM, pickerEndHour * 60 - 1);
    return { minM, maxM };
  }, [pickerStartHour, pickerEndHour]);

  const timelineScrubMinutes = useMemo(() => {
    const raw = minutesFromTime(selectedTime);
    const { minM, maxM } = timelineScrubBounds;
    return Math.min(Math.max(raw, minM), maxM);
  }, [selectedTime, timelineScrubBounds]);

  const jumpTimelineToCurrentTime = useCallback(() => {
    const today = formatDateInput(new Date());
    const now = new Date();
    const rawM = now.getHours() * 60 + now.getMinutes();

    if (selectedDate === today) {
      const { minM, maxM } = timelineScrubBounds;
      setSelectedTime(minutesToTimeShort(Math.min(Math.max(rawM, minM), maxM)));
      return;
    }

    const { startHour, endHour } = getCalendarGridBounds(
      today,
      openingHours ?? undefined,
      7,
      21,
      { timeZone: venueTimezone },
    );
    const minM = startHour * 60;
    const maxM = Math.max(minM, endHour * 60 - 1);
    setSelectedDate(today);
    setSelectedTime(minutesToTimeShort(Math.min(Math.max(rawM, minM), maxM)));
  }, [selectedDate, timelineScrubBounds, openingHours, venueTimezone]);

  const fetchData = useCallback(async () => {
    setViewportRefreshing(true);
    try {
      const areaQs =
        bookingModel === 'table_reservation' && diningAreaId
          ? `?area_id=${encodeURIComponent(diningAreaId)}`
          : '';
      const availParams = new URLSearchParams({ date: selectedDate });
      if (bookingModel === 'table_reservation' && diningAreaId) {
        availParams.set('area_id', diningAreaId);
      }
      const [tablesRes, gridRes, combosRes, blocksRes] = await Promise.all([
        fetch(`/api/venue/tables${areaQs}`),
        fetch(`/api/venue/tables/availability?${availParams}`),
        fetch(`/api/venue/tables/combinations${areaQs}`),
        fetch(`/api/venue/tables/blocks?date=${selectedDate}`),
      ]);

      if (combosRes.ok) {
        const cData = await combosRes.json();
        const manual: CombinationInfo[] = (cData.combinations ?? []).map(
          (c: { id: string; name: string; combined_min_covers?: number; combined_max_covers?: number; members?: { table_id: string }[] }) => ({
            id: c.id,
            name: c.name,
            combined_min_covers: c.combined_min_covers,
            combined_max_covers: c.combined_max_covers ?? 0,
            table_ids: (c.members ?? []).map((m: { table_id: string }) => m.table_id),
          })
        );
        setManualCombinations(manual);
      }

      if (tablesRes.ok) {
        const data = await tablesRes.json();
        setTables((data.tables ?? []).filter((t: VenueTable) => t.is_active));
        setNoShowGraceMinutes(data.settings?.no_show_grace_minutes ?? 15);
        setCombinationThreshold(data.settings?.combination_threshold ?? 80);
        setFloorPlanBackgroundUrl(
          typeof data.settings?.floor_plan_background_url === 'string'
            ? data.settings.floor_plan_background_url
            : null,
        );
        const layout = data.floor_plan_layout as { width?: number; height?: number } | undefined;
        if (
          layout &&
          typeof layout.width === 'number' &&
          typeof layout.height === 'number' &&
          layout.width > 0 &&
          layout.height > 0
        ) {
          setFloorPlanLayout({ width: Math.round(layout.width), height: Math.round(layout.height) });
        }
      }

      if (gridRes.ok) {
        const grid = await gridRes.json();
        setGridData(grid);

        const map = new Map<string, BookingOnTable>();
        const groups = new Map<string, string[]>();
        for (const cell of grid.cells ?? []) {
          if (!cell.booking_id || !cell.booking_details) continue;
          if (!map.has(cell.booking_id)) {
            map.set(cell.booking_id, {
              id: cell.booking_id,
              guest_name: cell.booking_details.guest_name,
              party_size: cell.booking_details.party_size,
              start_time: cell.booking_details.start_time,
              estimated_end_time: cell.booking_details.end_time ? `${selectedDate}T${cell.booking_details.end_time}:00.000Z` : null,
              status: cell.booking_details.status,
              deposit_status: cell.booking_details.deposit_status ?? null,
              dietary_notes: cell.booking_details.dietary_notes,
              occasion: cell.booking_details.occasion,
            });
          }
          const existing = groups.get(cell.booking_id) ?? [];
          if (!existing.includes(cell.table_id)) existing.push(cell.table_id);
          groups.set(cell.booking_id, existing);
        }
        setBookingMap(map);
        const multiGroups = new Map<string, string[]>();
        groups.forEach((tids, bid) => {
          if (tids.length > 1) multiGroups.set(bid, tids);
        });
        setCombinedTableGroups(multiGroups);
      } else {
        setGridData(null);
      }

      if (blocksRes.ok) {
        const blockPayload = await blocksRes.json();
        setBlocks(blockPayload.blocks ?? []);
      }
    } catch (err) {
      console.error('Failed to load floor plan data:', err);
    } finally {
      setLoading(false);
      setViewportRefreshing(false);
    }
  }, [bookingModel, diningAreaId, selectedDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const liveState = useVenueLiveSync({ venueId, date: selectedDate, onChange: fetchData });

  useEffect(() => {
    setSelectedTableId((id) => (id && tables.some((t) => t.id === id) ? id : null));
  }, [tables]);

  useEffect(() => {
    setDetailBookingId((id) => (id && bookingMap.has(id) ? id : null));
  }, [bookingMap]);

  useEffect(() => {
    if (!detailBookingId) setDetailBookingAnchor(null);
  }, [detailBookingId]);

  useEffect(() => {
    if (!floorBookingMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFloorBookingMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [floorBookingMenu]);

  const openBookingDrawer = useCallback((bookingId: string) => {
    setDetailBookingId(bookingId);
    setDetailBookingAnchor(null);
  }, []);

  const openBookingPopoverFromCanvas = useCallback((bookingId: string, anchor: { x: number; y: number }) => {
    const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
    setSelectedTableId(null);
    setFloorBookingMenu(null);
    setDetailBookingId(bookingId);
    setDetailBookingAnchor(coarse ? null : anchor);
  }, []);

  const toMenuBooking = useCallback(
    (bookingId: string): BookingActionMenuBooking | null => {
      const b = bookingMap.get(bookingId);
      if (!b) return null;
      const fromCombo = combinedTableGroups.get(bookingId);
      const tableIds =
        fromCombo && fromCombo.length > 0
          ? fromCombo
          : [...new Set((gridData?.cells ?? []).filter((c) => c.booking_id === bookingId).map((c) => c.table_id))];
      const sampleCell = (gridData?.cells ?? []).find((c) => c.booking_id === bookingId && c.booking_details);
      const endFromGrid = sampleCell?.booking_details?.end_time?.slice(0, 5);
      const endTime =
        endFromGrid ??
        (b.estimated_end_time ? new Date(b.estimated_end_time).toISOString().slice(11, 16) : null);
      const primaryTableId = tableIds[0] ?? sampleCell?.table_id ?? null;
      return {
        id: bookingId,
        guest_name: b.guest_name,
        party_size: b.party_size,
        status: b.status,
        start_time: b.start_time.slice(0, 5),
        end_time: endTime,
        table_id: primaryTableId,
        table_ids: tableIds,
      };
    },
    [bookingMap, combinedTableGroups, gridData],
  );

  const floorBookingMenuStyle = useMemo(() => {
    if (!floorBookingMenu) return undefined;
    return computePointAnchoredMenuStyle({
      anchorX: floorBookingMenu.x,
      anchorY: floorBookingMenu.y,
      viewportWidth: viewportBounds.width,
      viewportHeight: viewportBounds.height,
      minWidth: Math.min(224, viewportBounds.width - 24),
      maxWidth: Math.min(288, viewportBounds.width - 16),
    });
  }, [floorBookingMenu, viewportBounds.width, viewportBounds.height]);

  const floorBookingDetailSnapshot = useMemo((): BookingDetailPanelSnapshot | null => {
    if (!detailBookingId) return null;
    const b = bookingMap.get(detailBookingId);
    if (!b) return null;
    const fromCombo = combinedTableGroups.get(detailBookingId);
    const tableIds =
      fromCombo && fromCombo.length > 0
        ? fromCombo
        : [...new Set((gridData?.cells ?? []).filter((c) => c.booking_id === detailBookingId).map((c) => c.table_id))];
    const tableNames = tableIds
      .map((tid) => tables.find((t) => t.id === tid)?.name)
      .filter((n): n is string => Boolean(n));
    const sampleCell = (gridData?.cells ?? []).find((c) => c.booking_id === detailBookingId && c.booking_details);
    const endFromGrid = sampleCell?.booking_details?.end_time?.slice(0, 5);
    const endTime =
      endFromGrid ??
      (b.estimated_end_time ? new Date(b.estimated_end_time).toISOString().slice(11, 16) : b.start_time.slice(0, 5));
    return {
      bookingDate: selectedDate,
      guestName: b.guest_name,
      partySize: b.party_size,
      status: b.status,
      startTime: b.start_time.slice(0, 5),
      endTime,
      dietaryNotes: b.dietary_notes,
      occasion: b.occasion,
      depositStatus: b.deposit_status ?? undefined,
      tableNames: tableNames.length > 0 ? tableNames : undefined,
    };
  }, [detailBookingId, bookingMap, combinedTableGroups, gridData, tables, selectedDate]);

  const tablesWithState: TableWithState[] = useMemo(() => {
    void clockTick;
    const now = Date.now();
    const dateTime = `${selectedDate}T${debouncedTime}:00.000Z`;
    const bookingsForStatus = Array.from(bookingMap.values()).map((booking) => ({
      id: booking.id,
      status: booking.status as 'Pending' | 'Booked' | 'Confirmed' | 'Seated' | 'Completed' | 'No-Show' | 'Cancelled',
      booking_time: booking.start_time,
      estimated_end_time: booking.estimated_end_time,
    }));
    const assignmentPairs: Array<{ booking_id: string; table_id: string }> = [];
    const seenAssignment = new Set<string>();
    for (const cell of gridData?.cells ?? []) {
      if (!cell.booking_id) continue;
      const key = `${cell.booking_id}::${cell.table_id}`;
      if (seenAssignment.has(key)) continue;
      seenAssignment.add(key);
      assignmentPairs.push({ booking_id: cell.booking_id, table_id: cell.table_id });
    }
    const currentMin = minutesFromTime(debouncedTime);
    return tables.map((t) => {
      let tableStatus = getTableStatus(t.id, dateTime, bookingsForStatus, assignmentPairs, blocks);
      const assignedBookingIds = assignmentPairs
        .filter((assignment) => assignment.table_id === t.id)
        .map((assignment) => assignment.booking_id);
      const booking =
        assignedBookingIds
          .map((bookingId) => bookingMap.get(bookingId) ?? null)
          .find((candidate): candidate is BookingOnTable => {
            if (!candidate) return false;
            const startMin = minutesFromTime(candidate.start_time);
            const endMin = bookingEndMinutes(candidate, selectedDate, currentMin);
            return currentMin >= startMin && currentMin < endMin;
          }) ?? null;
      if (booking?.status === 'Seated' || booking?.status === 'Arrived') {
        tableStatus = 'seated';
      }

      let elapsedPct = 0;
      let turnProgressPct = 0;
      if (booking?.start_time && booking?.estimated_end_time) {
        const [y, mo, d] = selectedDate.split('-').map(Number);
        const [h, m] = booking.start_time.split(':').map(Number);
        const startMs = new Date(y!, mo! - 1, d!, h!, m!).getTime();
        const effectiveEndMin = bookingEndMinutes(booking, selectedDate, currentMin);
        const endMs = new Date(y!, mo! - 1, d!, Math.floor(effectiveEndMin / 60), effectiveEndMin % 60).getTime();
        const totalMs = endMs - startMs;
        if (totalMs > 0) {
          const raw = ((now - startMs) / totalMs) * 100;
          turnProgressPct = raw;
          elapsedPct = Math.min(100, Math.max(0, raw));
        }
      }

      return { ...t, service_status: tableStatus, booking, elapsed_pct: elapsedPct, turn_progress_pct: turnProgressPct };
    });
  }, [tables, bookingMap, selectedDate, debouncedTime, gridData, blocks, clockTick]);

  // Build all combinations (manual + auto-detected) -- same as table grid
  const allCombinations = useMemo((): CombinationInfo[] => {
    if (!gridData) return manualCombinations;
    const comboTables: CombinationTable[] = gridData.tables.map((t) => ({
      id: t.id, name: t.name, max_covers: t.max_covers, is_active: t.is_active,
      position_x: t.position_x, position_y: t.position_y, width: t.width, height: t.height, rotation: t.rotation,
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
        autoCombos.push({ id: `auto_${key}`, name: `${t1.name} + ${t2.name}`, combined_max_covers: t1.max_covers + t2.max_covers, table_ids: [tableId, neighborId].sort() });
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
          autoCombos.push({ id: `auto_${key}`, name: `${t1.name} + ${t2.name} + ${t3.name}`, combined_max_covers: t1.max_covers + t2.max_covers + t3.max_covers, table_ids: [tableId, neighbor1, neighbor2].sort() });
        }
      }
    }

    const manualKeys = new Set(manualCombinations.map((c) => [...c.table_ids].sort().join('|')));
    const merged = [...manualCombinations];
    for (const auto of autoCombos) {
      if (!manualKeys.has(auto.table_ids.join('|'))) merged.push(auto);
    }
    return merged;
  }, [gridData, manualCombinations, combinationThreshold]);

  const summaryData = useMemo(() => {
    if (!gridData) {
      return {
        total_covers_booked: 0,
        total_covers_capacity: 0,
        tables_in_use: 0,
        tables_total: 0,
        unassigned_count: 0,
        combos_in_use: 0,
        covers_in_use_now: 0,
        next_bookings_slot: null,
      };
    }
    const [th, tm] = debouncedTime.split(':').map(Number);
    const timeMin = (th ?? 0) * 60 + (tm ?? 0);
    const visibleTableIds = new Set(tables.map((t) => t.id));
    const liveCovers = coversInUseAtTime(gridData, timeMin, visibleTableIds);
    const next_bookings_slot = computeNextBookingsSlot(gridData, timeMin);
    const base = gridData.summary ?? {
      total_covers_booked: 0,
      total_covers_capacity: tablesWithState.reduce((s, t) => s + t.max_covers, 0),
      tables_in_use: tablesWithState.filter((t) => t.service_status !== 'available').length,
      tables_total: tablesWithState.length,
      unassigned_count: (gridData?.unassigned_bookings ?? []).length,
      combos_in_use: combinedTableGroups.size,
    };
    return { ...base, covers_in_use_now: liveCovers, next_bookings_slot };
  }, [gridData, tablesWithState, combinedTableGroups, debouncedTime, tables]);

  // --- Status change handlers ---
  const handleBookingStatusChange = useCallback(async (bookingId: string, currentStatus: BookingStatus, newStatus: BookingStatus) => {
    if (!canTransitionBookingStatus(currentStatus, newStatus)) {
      addToast(`Cannot change from ${currentStatus} to ${newStatus}`, 'error');
      return false;
    }
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        addToast(payload.error ?? 'Status change failed', 'error');
        return false;
      }
      setUndoAction({
        id: crypto.randomUUID(), type: 'change_status',
        description: `Status changed to ${bookingStatusDisplayLabel(newStatus, true)}`, timestamp: Date.now(),
        previous_state: { bookingId, status: currentStatus },
        current_state: { bookingId, status: newStatus },
      });
      addToast('Booking status updated', 'success');
      fetchData();
      return true;
    } catch (err) {
      console.error('Status change failed:', err);
      addToast('Status change failed', 'error');
      return false;
    }
  }, [fetchData, addToast]);

  const requestBookingStatusChange = useCallback(async (bookingId: string, currentStatus: BookingStatus, newStatus: BookingStatus) => {
    if (newStatus === 'No-Show') {
      const bookingStart = bookingMap.get(bookingId)?.start_time ?? '00:00';
      if (!canMarkNoShowForSlot(selectedDate, bookingStart, noShowGraceMinutes)) {
        addToast('No-show can only be marked after booking start time', 'error');
        return;
      }
    }
    const booking = bookingMap.get(bookingId);
    const guestName = booking?.guest_name ?? 'Guest';
    const partySize = booking?.party_size ?? '?';
    const time = booking?.start_time?.slice(0, 5) ?? '';
    if (isRevertTransition(currentStatus, newStatus)) {
      const revertAction = BOOKING_REVERT_ACTIONS[currentStatus];
      setConfirmDialog({
        title: revertAction?.label ?? `Revert to ${newStatus}`,
        message: `${guestName} (${partySize}) at ${time} will be changed from ${currentStatus} back to ${newStatus}.`,
        confirmLabel: revertAction?.label ?? `Revert to ${newStatus}`,
        onConfirm: () => { void handleBookingStatusChange(bookingId, currentStatus, newStatus); },
      });
      return;
    }
    if (isDestructiveBookingStatus(newStatus)) {
      setConfirmDialog({
        title: `Mark ${newStatus}`,
        message: `${guestName} (${partySize}) at ${time} will be marked ${newStatus}.`,
        confirmLabel: `Mark ${newStatus}`,
        onConfirm: () => { void handleBookingStatusChange(bookingId, currentStatus, newStatus); },
      });
      return;
    }
    await handleBookingStatusChange(bookingId, currentStatus, newStatus);
  }, [addToast, bookingMap, handleBookingStatusChange, selectedDate, noShowGraceMinutes]);

  const floorMenuStatusChange = useCallback(
    async (bookingId: string, currentStatus: string, newStatus: string) => {
      setFloorBookingMenu(null);
      if (!isBookingStatus(currentStatus) || !isBookingStatus(newStatus)) return;
      await requestBookingStatusChange(bookingId, currentStatus, newStatus);
    },
    [requestBookingStatusChange],
  );

  const handleFloorResizeBooking = useCallback(
    async (bookingId: string, newEndTimeHHmm: string) => {
      const anchorCell = gridData?.cells.find((c) => c.booking_id === bookingId);
      const startTime = anchorCell?.booking_details?.start_time?.slice(0, 5);
      if (!startTime) return;
      if (anchorCell?.booking_details?.status === 'Completed') return;
      const startMinutes = timeToMinutesShort(startTime);
      const requestedEnd = Math.max(startMinutes + 15, timeToMinutesShort(newEndTimeHHmm));
      const bookingTableIds = Array.from(
        new Set((gridData?.cells ?? []).filter((cell) => cell.booking_id === bookingId).map((cell) => cell.table_id)),
      );
      let nextBoundary: number | null = null;
      for (const cell of gridData?.cells ?? []) {
        if (!cell.booking_id || !cell.booking_details) continue;
        if (cell.booking_id === bookingId) continue;
        if (!bookingTableIds.includes(cell.table_id)) continue;
        const otherStart = timeToMinutesShort(cell.booking_details.start_time.slice(0, 5));
        if (otherStart > startMinutes && (nextBoundary === null || otherStart < nextBoundary)) {
          nextBoundary = otherStart;
        }
      }
      const clampedEnd = nextBoundary === null ? requestedEnd : Math.min(requestedEnd, nextBoundary);
      const clampedEndTime = minutesToTimeShort(clampedEnd);
      try {
        const res = await fetch('/api/venue/tables/assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'change_time',
            booking_id: bookingId,
            new_time: startTime,
            new_estimated_end_time: `${selectedDate}T${clampedEndTime}:00.000Z`,
          }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          addToast((payload as { error?: string }).error ?? 'Failed to resize booking', 'error');
          return;
        }
        addToast('Booking duration updated', 'success');
        await fetchData();
      } catch (err) {
        console.error('[FloorPlanLiveView] resize booking failed:', err);
        addToast('Failed to resize booking', 'error');
      }
    },
    [gridData, selectedDate, addToast, fetchData],
  );

  const handleFloorUnassign = useCallback(async (bookingId: string) => {
    try {
      const res = await fetch('/api/venue/tables/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unassign', booking_id: bookingId }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        addToast((payload as { error?: string }).error ?? 'Failed to unassign table', 'error');
        return;
      }
      addToast('Table unassigned', 'success');
      await fetchData();
    } catch (err) {
      console.error('[FloorPlanLiveView] unassign failed:', err);
      addToast('Failed to unassign table', 'error');
    }
  }, [addToast, fetchData]);

  const handleFloorTimeChange = useCallback(
    async (bookingId: string, newTime: string) => {
      const oldBlock = gridData?.cells.find((c) => c.booking_id === bookingId);
      const oldStart = timeToMinutesShort(oldBlock?.booking_details?.start_time?.slice(0, 5) ?? newTime);
      const oldEnd = oldBlock?.booking_details?.end_time
        ? timeToMinutesShort(oldBlock.booking_details.end_time.slice(0, 5))
        : oldStart + 90;
      const durationMins = Math.max(15, oldEnd - oldStart);
      const newEndMins = timeToMinutesShort(newTime) + durationMins;
      const newEndTime = minutesToTimeShort(newEndMins);
      try {
        const res = await fetch('/api/venue/tables/assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'change_time',
            booking_id: bookingId,
            new_time: newTime,
            new_estimated_end_time: `${selectedDate}T${newEndTime}:00.000Z`,
          }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          addToast((payload as { error?: string }).error ?? 'Failed to change time', 'error');
          return;
        }
        addToast('Booking time updated', 'success');
        await fetchData();
      } catch (err) {
        console.error('[FloorPlanLiveView] time change failed:', err);
        addToast('Failed to change time', 'error');
      }
    },
    [gridData, selectedDate, addToast, fetchData],
  );

  // --- Reassignment/assignment ---
  const handleReassign = useCallback(async (bookingId: string, oldTableIds: string[], newTableIds: string[]) => {
    try {
      const res = await fetch('/api/venue/tables/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reassign', booking_id: bookingId, old_table_ids: oldTableIds, new_table_ids: newTableIds }),
      });
      if (res.ok) {
        setUndoAction({
          id: crypto.randomUUID(), type: 'reassign_table',
          description: 'Table reassigned', timestamp: Date.now(),
          previous_state: { bookingId, tableIds: oldTableIds },
          current_state: { bookingId, tableIds: newTableIds },
        });
        addToast('Table reassigned', 'success');
        fetchData();
      } else {
        const data = await res.json().catch(() => ({}));
        addToast(data.error ?? 'Failed to reassign table', 'error');
      }
    } catch (err) {
      console.error('Reassign failed:', err);
      addToast('Failed to reassign table', 'error');
    }
  }, [fetchData, addToast]);

  const handleAssign = useCallback(async (bookingId: string, tableIds: string[]) => {
    try {
      const res = await fetch('/api/venue/tables/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: bookingId, table_ids: tableIds }),
      });
      if (res.ok) {
        addToast('Table assigned', 'success');
        fetchData();
      } else {
        const data = await res.json().catch(() => ({}));
        addToast(data.error ?? 'Failed to assign table', 'error');
      }
    } catch (err) {
      console.error('Assign failed:', err);
      addToast('Failed to assign table', 'error');
    }
  }, [fetchData, addToast]);

  const undoStatusChange = useCallback(async () => {
    if (!undoAction) return;
    if (undoAction.type === 'change_status') {
      const bookingId = String(undoAction.previous_state.bookingId ?? '');
      const previousStatus = String(undoAction.previous_state.status ?? '') as BookingStatus;
      const currentStatus = String(undoAction.current_state.status ?? '') as BookingStatus;
      if (bookingId && previousStatus && currentStatus) {
        setUndoAction(null);
        await handleBookingStatusChange(bookingId, currentStatus, previousStatus);
      }
    } else if (undoAction.type === 'reassign_table') {
      const bookingId = String(undoAction.previous_state.bookingId ?? '');
      const oldTableIds = (undoAction.previous_state.tableIds ?? []) as string[];
      const newTableIds = (undoAction.current_state.tableIds ?? []) as string[];
      if (bookingId && oldTableIds.length > 0) {
        setUndoAction(null);
        await handleReassign(bookingId, newTableIds, oldTableIds);
      }
    }
  }, [undoAction, handleBookingStatusChange, handleReassign]);

  // --- Drag/drop validation ---
  const startDragValidation = useCallback((bookingId: string, sourceTableIds: string[]) => {
    const booking = bookingMap.get(bookingId);
    if (!booking || !gridData) return;
    setDragSourceTableIds(sourceTableIds);
    const context: BookingMoveContext = {
      id: bookingId,
      party_size: booking.party_size,
      start_time: booking.start_time,
      end_time: booking.estimated_end_time
        ? new Date(booking.estimated_end_time).toISOString().slice(11, 16)
        : '',
    };
    const tableInfos = gridData.tables.map((t) => ({ id: t.id, name: t.name, max_covers: t.max_covers, position_x: t.position_x, position_y: t.position_y, width: t.width, height: t.height, rotation: t.rotation }));
    const result = computeValidMoveTargets(context, tableInfos, gridData.cells, allCombinations);
    setValidDropTargets(result.validTableIds);
    setValidDropComboLabels(result.comboLabels.size > 0 ? result.comboLabels : null);
  }, [bookingMap, gridData, allCombinations]);

  const clearDragValidation = useCallback(() => {
    setValidDropTargets(null);
    setValidDropComboLabels(null);
    setDragSourceTableIds([]);
  }, []);

  const handleFloorDragEnd = useCallback((event: FloorDragEvent) => {
    const booking = bookingMap.get(event.bookingId);
    if (!booking || !gridData) {
      clearDragValidation();
      return;
    }
    const context: BookingMoveContext = {
      id: event.bookingId,
      party_size: booking.party_size,
      start_time: booking.start_time,
      end_time: booking.estimated_end_time
        ? new Date(booking.estimated_end_time).toISOString().slice(11, 16)
        : '',
    };
    const tableInfos = gridData.tables.map((t) => ({ id: t.id, name: t.name, max_covers: t.max_covers, position_x: t.position_x, position_y: t.position_y, width: t.width, height: t.height, rotation: t.rotation }));
    const targetTableIds = resolveDropTarget(event.targetTableId, context, tableInfos, gridData.cells, allCombinations);
    clearDragValidation();

    if (!targetTableIds) {
      addToast('Cannot move booking to that table', 'error');
      return;
    }

    const oldTableIds = event.sourceTableIds.length > 0 ? event.sourceTableIds : dragSourceTableIds;
    if (oldTableIds.length > 0) {
      void handleReassign(event.bookingId, oldTableIds, targetTableIds);
    } else {
      void handleAssign(event.bookingId, targetTableIds);
    }
  }, [bookingMap, gridData, allCombinations, clearDragValidation, addToast, handleReassign, handleAssign, dragSourceTableIds]);

  // Click-based reassign mode
  const handleTableSelect = useCallback((id: string | null) => {
    setFloorBookingMenu(null);
    if (reassignMode && id) {
      const booking = bookingMap.get(reassignMode.bookingId);
      if (!booking || !gridData) return;
      const context: BookingMoveContext = {
        id: reassignMode.bookingId,
        party_size: booking.party_size,
        start_time: booking.start_time,
        end_time: booking.estimated_end_time
          ? new Date(booking.estimated_end_time).toISOString().slice(11, 16)
          : '',
      };
      const tableInfos = gridData.tables.map((t) => ({ id: t.id, name: t.name, max_covers: t.max_covers, position_x: t.position_x, position_y: t.position_y, width: t.width, height: t.height, rotation: t.rotation }));
      const targetTableIds = resolveDropTarget(id, context, tableInfos, gridData.cells, allCombinations);
      if (!targetTableIds) {
        addToast('Cannot move booking to that table', 'error');
        return;
      }
      void handleReassign(reassignMode.bookingId, reassignMode.oldTableIds, targetTableIds);
      setReassignMode(null);
      clearDragValidation();
      return;
    }
    setSelectedTableId(id);
  }, [reassignMode, bookingMap, gridData, allCombinations, addToast, handleReassign, clearDragValidation]);

  const startReassignMode = useCallback((bookingId: string) => {
    const booking = bookingMap.get(bookingId);
    if (!booking) return;
    const oldTableIds = Array.from(new Set(
      (gridData?.cells ?? []).filter((c) => c.booking_id === bookingId).map((c) => c.table_id)
    ));
    setReassignMode({ bookingId, guestName: booking.guest_name, oldTableIds });
    setSelectedTableId(null);
    startDragValidation(bookingId, oldTableIds);
  }, [bookingMap, gridData, startDragValidation]);

  const selectedTable = useMemo(() => {
    if (!selectedTableId) return null;
    return tablesWithState.find((t) => t.id === selectedTableId) ?? null;
  }, [selectedTableId, tablesWithState]);

  /** Blocks that cover the current timeline position for the selected table */
  const blocksAtScrubberForSelected = useMemo(() => {
    if (!selectedTableId || blocks.length === 0) return [];
    const t = Date.parse(`${selectedDate}T${debouncedTime}:00.000Z`);
    if (Number.isNaN(t)) return [];
    return blocks.filter(
      (b) =>
        b.table_id === selectedTableId &&
        Date.parse(b.start_at) <= t &&
        Date.parse(b.end_at) > t,
    );
  }, [blocks, selectedTableId, selectedDate, debouncedTime]);

  useEffect(() => {
    setTableDetailSheetExpanded(false);
  }, [selectedTableId]);

  const removeTableBlock = useCallback(
    async (blockId: string) => {
      try {
        const res = await fetch('/api/venue/tables/blocks', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: blockId }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          addToast((payload as { error?: string }).error ?? 'Failed to remove block', 'error');
          return;
        }
        addToast('Block removed', 'success');
        await fetchData();
      } catch (err) {
        console.error('Remove block failed:', err);
        addToast('Failed to remove block', 'error');
      }
    },
    [addToast, fetchData],
  );

  const submitFloorBlock = useCallback(async () => {
    if (!floorBlockModal) return;
    setFloorBlockSaving(true);
    try {
      const start = new Date(`${selectedDate}T${floorBlockStartTime}:00.000Z`);
      if (Number.isNaN(start.getTime())) {
        addToast('Invalid start time', 'error');
        return;
      }
      const end = new Date(start.getTime() + floorBlockDurationMins * 60 * 1000);
      const res = await fetch('/api/venue/tables/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table_id: floorBlockModal.tableId,
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          reason: floorBlockReason.trim() || null,
          repeat: 'none',
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        addToast((payload as { error?: string }).error ?? 'Failed to create block', 'error');
        return;
      }
      addToast('Table blocked', 'success');
      setFloorBlockModal(null);
      await fetchData();
    } catch (err) {
      console.error('Create block failed:', err);
      addToast('Failed to create block', 'error');
    } finally {
      setFloorBlockSaving(false);
    }
  }, [
    floorBlockModal,
    selectedDate,
    floorBlockStartTime,
    floorBlockDurationMins,
    floorBlockReason,
    addToast,
    fetchData,
  ]);

  // Walk-in handler

  // --- Render ---
  if (loading) {
    return (
      <SectionCard elevated>
        <SectionCard.Body className="p-4 sm:p-5">
          <DashboardGridSkeleton />
        </SectionCard.Body>
      </SectionCard>
    );
  }

  if (tables.length === 0) {
    return (
      <SectionCard elevated>
        <SectionCard.Body className="py-10">
          <EmptyState
            title="No active tables"
            description="Add tables first to start using the live floor plan."
          />
        </SectionCard.Body>
      </SectionCard>
    );
  }

  const hasPositions = tables.some((t) => t.position_x != null && t.position_y != null);
  if (!hasPositions) {
    return (
      <SectionCard elevated>
        <SectionCard.Body className="py-10">
          <EmptyState
            title="No floor plan layout"
            description={
              isAdmin
                ? 'Use Edit Layout in Dining Availability to arrange your tables on the canvas.'
                : 'Ask an admin to set up your floor plan in Dining Availability.'
            }
          />
        </SectionCard.Body>
      </SectionCard>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 sm:gap-2">
      <OperationsWorkspaceToolbar
        title="Live floor"
        summary={summaryData}
        date={selectedDate}
        onDateChange={setSelectedDate}
        liveState={liveState}
        onRefresh={fetchData}
        onNewBooking={() => setShowNewBookingForm(true)}
        onWalkIn={() => setShowWalkInModal(true)}
        compact
        showControlsButton={false}
        infoPanelExtra={(
          <div className="border-t border-slate-100 pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Floor key</p>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-slate-600">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-slate-500" aria-hidden />Available</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-700" aria-hidden />Booked</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-teal-700" aria-hidden />Seated</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-stone-600" aria-hidden />Blocked</span>
            </div>
            <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Table progress</p>
            <div className="mt-2 grid gap-1.5 text-[11px] text-slate-600">
              <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-[3px] border-teal-600" aria-hidden />Within booking window</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-[3px] border-amber-600" aria-hidden />Approaching end time</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-[3px] border-red-600" aria-hidden />Past expected end time</span>
            </div>
          </div>
        )}
        trailingActions={
          isAdmin && editLayoutHref ? (
            <Link
              href={editLayoutHref}
              className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Edit layout
            </Link>
          ) : null
        }
        timelineLabel={selectedTime}
        timelinePanel={(
          <div className="space-y-3">
            <div>
              <label htmlFor="floor-timeline-time" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Timeline time
              </label>
              <div className="flex gap-2">
                <input
                  id="floor-timeline-time"
                  type="time"
                  value={selectedTime}
                  onChange={(e) => setSelectedTime(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
                <button
                  type="button"
                  onClick={jumpTimelineToCurrentTime}
                  className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  title="Use the current clock time (and today if you are viewing another date)"
                  aria-label="Set timeline to current time"
                >
                  Now
                </button>
              </div>
              <div className="mt-3">
                <label htmlFor="floor-timeline-scrub" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Scrub time
                </label>
                <div className="flex items-center gap-2">
                  <span className="w-11 shrink-0 tabular-nums text-[11px] text-slate-500" title="Range start">
                    {minutesToTimeShort(timelineScrubBounds.minM)}
                  </span>
                  <input
                    id="floor-timeline-scrub"
                    type="range"
                    min={timelineScrubBounds.minM}
                    max={timelineScrubBounds.maxM}
                    step={1}
                    value={timelineScrubMinutes}
                    onChange={(e) => {
                      const next = Number.parseInt(e.target.value, 10);
                      if (Number.isNaN(next)) return;
                      setSelectedTime(minutesToTimeShort(next));
                    }}
                    className="h-2 w-full min-w-0 flex-1 cursor-pointer accent-brand-600"
                    aria-valuemin={timelineScrubBounds.minM}
                    aria-valuemax={timelineScrubBounds.maxM}
                    aria-valuenow={timelineScrubMinutes}
                    aria-valuetext={minutesToTimeShort(timelineScrubMinutes)}
                    aria-label="Adjust timeline time by dragging"
                  />
                  <span className="w-11 shrink-0 text-right tabular-nums text-[11px] text-slate-500" title="Last minute before range end hour">
                    {minutesToTimeShort(timelineScrubBounds.maxM)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Drag to move forward or back; range matches the calendar service window ({String(pickerStartHour).padStart(2, '0')}:00–{String(pickerEndHour).padStart(2, '0')}:00).
                </p>
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                Table status, drag targets, and live covers use this service clock.
              </p>
            </div>
            {timeRangeFilterActive ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Showing bookings from{' '}
                <span className="font-semibold">{String(pickerStartHour).padStart(2, '0')}:00</span>
                {' '}to{' '}
                <span className="font-semibold">{String(pickerEndHour).padStart(2, '0')}:00</span>.
                <button
                  type="button"
                  onClick={() => {
                    setStartHourOverride(null);
                    setEndHourOverride(null);
                    setTimeRangeFilterActive(false);
                  }}
                  className="mt-2 block font-semibold text-amber-800 underline"
                >
                  Clear time filter
                </button>
              </div>
            ) : null}
          </div>
        )}
        datePickerPanel={(
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <CalendarDateTimePicker
              date={selectedDate}
              onDateChange={setSelectedDate}
              startHour={pickerStartHour}
              endHour={pickerEndHour}
              onTimeRangeChange={(start, end) => {
                setStartHourOverride(start);
                setEndHourOverride(end);
                setTimeRangeFilterActive(true);
                setSelectedTime(`${String(start).padStart(2, '0')}:00`);
              }}
            />
            {timeRangeFilterActive && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
                <p className="text-xs text-slate-600">
                  Showing bookings with start times from{' '}
                  <span className="font-medium text-slate-800">
                    {String(pickerStartHour).padStart(2, '0')}:00
                  </span>{' '}
                  up to{' '}
                  <span className="font-medium text-slate-800">
                    {String(pickerEndHour).padStart(2, '0')}:00
                  </span>{' '}
                  (not including the end hour).
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setStartHourOverride(null);
                    setEndHourOverride(null);
                    setTimeRangeFilterActive(false);
                  }}
                  className="shrink-0 text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline"
                >
                  Clear time filter
                </button>
              </div>
            )}
          </div>
        )}
        controlsPanel={(
          <div />
        )}
        toolbarLeadingTools={(toolbarPanelAnchorRef: RefObject<HTMLDivElement | null>) =>
          areaNav ? (
            <DiningAreaPicker
              areas={areaNav.areas}
              value={areaNav.value}
              onChange={areaNav.onChange}
              verticalAnchorRef={toolbarPanelAnchorRef}
              compact
            />
          ) : null
        }
      />

      {/* Canvas area — fill remaining viewport under dashboard chrome */}
      <div className="relative min-h-[calc(100dvh-9.5rem)] w-full min-w-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm shadow-slate-900/5 sm:min-h-[calc(100dvh-8.5rem)] lg:min-h-[calc(100dvh-7rem)]">
        {viewportRefreshing && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-50/70 backdrop-blur-[1px]">
            <div className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
              Updating floor plan...
            </div>
          </div>
        )}
        {reassignMode && (
          <div className="absolute left-2 right-2 top-2 z-30 flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 shadow-sm sm:left-4 sm:right-4 sm:top-4 sm:px-4 sm:py-2 sm:text-xs">
            <span>Tap a highlighted table to move <strong>{reassignMode.guestName}</strong></span>
            <button type="button" onClick={() => { setReassignMode(null); clearDragValidation(); }} className="shrink-0 font-semibold text-amber-700 underline">Cancel</button>
          </div>
        )}
        <div className="absolute inset-0">
          <LiveFloorCanvas
            tables={tablesWithState}
            layoutWidth={floorPlanLayout.width}
            layoutHeight={floorPlanLayout.height}
            selectedId={selectedTableId}
            combinedTableGroups={combinedTableGroups}
            validDropTargets={validDropTargets}
            validDropComboLabels={validDropComboLabels}
            reassignMode={reassignMode ? { bookingId: reassignMode.bookingId, guestName: reassignMode.guestName } : null}
            onSelect={handleTableSelect}
            onDragStart={startDragValidation}
            onDragEnd={handleFloorDragEnd}
            onDragCancel={clearDragValidation}
            onBookingClick={
              reassignMode
                ? undefined
                : (bookingId, anchor) => {
                    openBookingPopoverFromCanvas(bookingId, anchor);
                  }
            }
            onBookedTableContextMenu={(bookingId, _tableId, x, y) => {
              if (reassignMode) return;
              const row = toMenuBooking(bookingId);
              if (row) setFloorBookingMenu({ booking: row, x, y });
            }}
            floorBackgroundUrl={floorPlanBackgroundUrl}
          />
        </div>
      </div>

      {/* Table detail bottom sheet */}
      {selectedTable && !selectedTable.booking && !detailBookingId && (
        <div
          className={`fixed bottom-0 left-0 right-0 z-40 mx-auto max-w-lg overflow-y-auto rounded-t-2xl border-t border-slate-200 bg-white p-2.5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-2xl shadow-slate-900/15 sm:p-3 lg:bottom-6 lg:left-auto lg:right-6 lg:max-h-[calc(100dvh-10rem)] lg:max-w-sm lg:rounded-2xl lg:border lg:p-4 ${
            tableDetailSheetExpanded
              ? 'max-h-[min(88dvh,900px)] lg:max-h-[calc(100dvh-10rem)]'
              : 'max-h-[min(46dvh,420px)] lg:max-h-[calc(100dvh-10rem)]'
          }`}
        >
          <div className="mx-auto mb-1.5 h-1 w-10 rounded-full bg-slate-300 lg:hidden" />
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-900 sm:text-base">{selectedTable.name}</h3>
              <p className="text-[11px] text-slate-500 sm:text-xs">{selectedTable.max_covers} covers · {selectedTable.zone ?? 'No zone'}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setTableDetailSheetExpanded((v) => !v)}
                className="rounded-lg px-2 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 lg:hidden"
                aria-expanded={tableDetailSheetExpanded}
              >
                {tableDetailSheetExpanded ? 'Less' : 'More'}
              </button>
              <button aria-label="Close" onClick={() => setSelectedTableId(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>

          {selectedTable.service_status === 'held' && (
            <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-600">Blocked</p>
              <p className="mt-1 text-xs text-stone-600">
                At the timeline time shown above, this table is not available for bookings.
              </p>
              {blocksAtScrubberForSelected.length === 0 ? (
                <p className="mt-2 text-xs text-amber-700">
                  Block details could not be loaded. Try refreshing.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {blocksAtScrubberForSelected.map((b) => (
                    <li
                      key={b.id}
                      className="flex flex-col gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="text-sm font-medium text-stone-900">
                          {formatIsoTimeUk(b.start_at)} – {formatIsoTimeUk(b.end_at)}
                        </p>
                        {b.reason ? (
                          <p className="text-xs text-stone-500">{b.reason}</p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => { void removeTableBlock(b.id); }}
                        className="shrink-0 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-800 hover:bg-stone-100"
                      >
                        Unblock
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedTable.service_status === 'available' && (
              <>
                <button onClick={() => { setShowNewBookingForm(true); }} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700">New Booking</button>
                <button onClick={() => { setShowWalkInModal(true); }} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700">Walk-in</button>
                <button
                  type="button"
                  onClick={() => {
                    setFloorBlockStartTime(selectedTime);
                    setFloorBlockDurationMins(60);
                    setFloorBlockReason('');
                    setFloorBlockModal({ tableId: selectedTable.id, tableName: selectedTable.name });
                  }}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Block table…
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Booking detail panel */}
      {detailBookingId && (
        <BookingDetailPanel
          bookingId={detailBookingId}
          venueId={venueId}
          venueCurrency={currency}
          initialSnapshot={floorBookingDetailSnapshot}
          presentation={detailBookingAnchor ? 'popover' : 'drawer'}
          anchor={detailBookingAnchor}
          onStatusChange={async (bookingId, currentStatus, nextStatus) => {
            await handleBookingStatusChange(bookingId, currentStatus, nextStatus);
          }}
          onClose={() => {
            setDetailBookingId(null);
            setDetailBookingAnchor(null);
          }}
          onUpdated={() => {
            fetchData();
          }}
        />
      )}

      {floorBookingMenu && floorBookingMenuStyle ? (
        <BookingActionMenu
          booking={floorBookingMenu.booking}
          menuStyle={floorBookingMenuStyle}
          onDismiss={() => setFloorBookingMenu(null)}
          onStatusChange={floorMenuStatusChange}
          onResizeBooking={handleFloorResizeBooking}
          onEditBooking={(id) => openBookingDrawer(id)}
          onSendMessage={(id) => openBookingDrawer(id)}
          onMoveBooking={(id) => {
            setFloorBookingMenu(null);
            startReassignMode(id);
          }}
          onRescheduleBooking={(id) => {
            const start =
              bookingMap.get(id)?.start_time?.slice(0, 5) ??
              floorBookingMenu.booking.start_time.slice(0, 5) ??
              '18:00';
            setRescheduleDialog({ bookingId: id, time: start });
          }}
          onBlockAfterBooking={(tableId, endTime) => {
            const name = tables.find((t) => t.id === tableId)?.name ?? 'Table';
            setFloorBlockStartTime(endTime);
            setFloorBlockDurationMins(60);
            setFloorBlockReason('');
            setFloorBlockModal({ tableId, tableName: name });
          }}
          onUnassign={handleFloorUnassign}
        />
      ) : null}

      {rescheduleDialog ? (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/25 p-4 backdrop-blur-[2px] sm:items-center"
          onClick={() => setRescheduleDialog(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-labelledby="floor-reschedule-title"
            className="w-full max-w-sm rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="floor-reschedule-title" className="text-base font-semibold text-slate-900">
              Reschedule booking
            </h3>
            <label htmlFor="floor-reschedule-time" className="mt-3 block text-xs font-medium text-slate-700">
              New start time
            </label>
            <input
              id="floor-reschedule-time"
              type="time"
              value={rescheduleDialog.time}
              onChange={(e) => setRescheduleDialog((prev) => (prev ? { ...prev, time: e.target.value } : null))}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRescheduleDialog(null)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const { bookingId, time } = rescheduleDialog;
                  setRescheduleDialog(null);
                  void handleFloorTimeChange(bookingId, time);
                }}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* New booking form */}
      {showNewBookingForm && (
        <DashboardStaffBookingModal
          open
          title="New booking"
          onClose={() => setShowNewBookingForm(false)}
          onCreated={() => {
            setShowNewBookingForm(false);
            fetchData();
          }}
          venueId={venueId}
          currency={currency ?? 'GBP'}
          bookingModel={bookingModel}
          enabledModels={enabledModels}
          advancedMode
          initialDate={selectedDate}
        />
      )}

      {/* Walk-in modal */}
      {showWalkInModal && (
        <DashboardStaffBookingModal
          open
          title="Walk-in"
          bookingIntent="walk-in"
          onClose={() => setShowWalkInModal(false)}
          onCreated={() => { setShowWalkInModal(false); fetchData(); }}
          venueId={venueId}
          currency={currency ?? 'GBP'}
          bookingModel={bookingModel}
          enabledModels={enabledModels}
          advancedMode
          initialDate={selectedDate}
          initialTime={debouncedTime}
        />
      )}

      {/* Block table - start time + duration */}
      {floorBlockModal && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/25 p-4 backdrop-blur-[2px] sm:items-center"
          onClick={() => !floorBlockSaving && setFloorBlockModal(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-labelledby="floor-block-title"
            className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="floor-block-title" className="text-base font-semibold text-slate-900">
              Block {floorBlockModal.tableName}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              The table will be unavailable for new bookings for the period you set. Existing bookings that overlap this time are not allowed-you’ll need to reschedule them first.
            </p>
            <p className="mt-2 text-xs font-medium text-slate-600">
              Date:{' '}
              <span className="tabular-nums text-slate-900">
                {new Date(`${selectedDate}T12:00:00`).toLocaleDateString('en-GB', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="floor-block-start" className="mb-1 block text-xs font-medium text-slate-700">
                  Start time
                </label>
                <input
                  id="floor-block-start"
                  type="time"
                  value={floorBlockStartTime}
                  onChange={(e) => setFloorBlockStartTime(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
              <div>
                <label htmlFor="floor-block-duration" className="mb-1 block text-xs font-medium text-slate-700">
                  Duration
                </label>
                <select
                  id="floor-block-duration"
                  value={floorBlockDurationMins}
                  onChange={(e) => setFloorBlockDurationMins(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                >
                  {BLOCK_DURATION_PRESETS.map((m) => (
                    <option key={m} value={m}>
                      {m} minutes
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="floor-block-reason" className="mb-1 block text-xs font-medium text-slate-700">
                  Reason <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <input
                  id="floor-block-reason"
                  type="text"
                  value={floorBlockReason}
                  onChange={(e) => setFloorBlockReason(e.target.value)}
                  placeholder="e.g. Private event, maintenance"
                  maxLength={300}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                disabled={floorBlockSaving}
                onClick={() => { void submitFloorBlock(); }}
                className="flex-1 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {floorBlockSaving ? 'Saving…' : 'Block table'}
              </button>
              <button
                type="button"
                disabled={floorBlockSaving}
                onClick={() => setFloorBlockModal(null)}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Undo toast */}
      {undoAction && (
        <UndoToast action={undoAction} onUndo={() => { void undoStatusChange(); }} onDismiss={() => setUndoAction(null)} />
      )}

      {/* Confirm dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setConfirmDialog(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900">{confirmDialog.title}</h3>
            <p className="mt-2 text-sm text-slate-600">{confirmDialog.message}</p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }} className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700">{confirmDialog.confirmLabel}</button>
              <button type="button" onClick={() => setConfirmDialog(null)} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
