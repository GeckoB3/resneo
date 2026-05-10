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
import { collectTableDayBookings } from '@/lib/floor-plan/table-day-timeline';
import { bookingStatusDisplayLabel } from '@/lib/booking/infer-booking-row-model';
import { CalendarDateTimePicker } from '@/components/calendar/CalendarDateTimePicker';
import {
  getCalendarGridBounds,
  getOpeningPeriodsForVenueDate,
  periodToCalendarGridHours,
} from '@/lib/venue-calendar-bounds';
import { getDayOfWeekForYmdInTimezone } from '@/lib/venue/venue-local-clock';
import type { VenueServiceRow } from '@/app/dashboard/availability/service-settings-types';
import { FloorPlanServicePicker } from '@/components/floor-plan/FloorPlanServicePicker';
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
import { BOOKING_ACTIVE_STATUSES } from '@/lib/table-management/constants';

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
  deposit_amount_pence?: number | null;
  internal_notes?: string | null;
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
  const wallMinutes = m % (24 * 60);
  const h = Math.floor(wallMinutes / 60);
  const min = wallMinutes % 60;
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
}

function localDateTimeIso(date: string, minutes: number): string {
  const dayOffset = Math.floor(minutes / (24 * 60));
  const wallMinutes = minutes % (24 * 60);
  const h = Math.floor(wallMinutes / 60);
  const m = wallMinutes % 60;
  const base = new Date(`${date}T00:00:00`);
  base.setDate(base.getDate() + dayOffset);
  return new Date(`${formatDateInput(base)}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).toISOString();
}

function estimatedEndIsoForDate(date: string, startTime: string, endMinutes: number): string {
  const startMinutes = timeToMinutesShort(startTime);
  const adjustedEnd = endMinutes <= startMinutes ? endMinutes + 24 * 60 : endMinutes;
  return localDateTimeIso(date, adjustedEnd);
}

function endMinutesAfterStartShort(start: string, end: string | null | undefined, fallbackMinutes = 90): number {
  const startMin = timeToMinutesShort(start);
  if (!end) return startMin + fallbackMinutes;
  let endMin = timeToMinutesShort(end);
  if (endMin <= startMin) {
    endMin += 24 * 60;
  }
  return endMin;
}

function bookingEndMinutes(booking: BookingOnTable, selectedDate: string, nowMinutes: number): number {
  const startHHmm = booking.start_time.includes('T')
    ? new Date(booking.start_time).toISOString().slice(11, 16)
    : booking.start_time.slice(0, 5);
  const startMin = minutesFromTime(startHHmm);
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

  /** Unassigned bookings sheet + tap-a-table assign flow */
  const [unassignedSheetOpen, setUnassignedSheetOpen] = useState(false);
  const [pendingAssignBookingId, setPendingAssignBookingId] = useState<string | null>(null);
  /** Host search / quick filters — highlights matching tables on the canvas */
  const [floorSearchQuery, setFloorSearchQuery] = useState('');
  const [filterDietaryOnly, setFilterDietaryOnly] = useState(false);
  const [filterOccasionOnly, setFilterOccasionOnly] = useState(false);
  const [filterOverdueOnly, setFilterOverdueOnly] = useState(false);
  const [filterPartySizeMin, setFilterPartySizeMin] = useState('');

  const [openingHours, setOpeningHours] = useState<OpeningHours | null>(null);
  const [venueTimezone, setVenueTimezone] = useState<string>('Europe/London');
  const [venueServices, setVenueServices] = useState<VenueServiceRow[]>([]);
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

  useEffect(() => {
    let cancelled = false;
    const qs =
      bookingModel === 'table_reservation' && diningAreaId
        ? `?area_id=${encodeURIComponent(diningAreaId)}`
        : '';

    async function loadServices(): Promise<void> {
      try {
        const first = await fetch(`/api/venue/services${qs}`);
        const body = first.ok ? await first.json() : null;
        let list: VenueServiceRow[] = Array.isArray(body?.services) ? (body.services as VenueServiceRow[]) : [];

        if (list.length === 0 && qs !== '') {
          const fallback = await fetch('/api/venue/services');
          const fbBody = fallback.ok ? await fallback.json() : null;
          if (Array.isArray(fbBody?.services)) {
            list = fbBody.services as VenueServiceRow[];
          }
        }

        if (!cancelled) setVenueServices(list);
      } catch (e) {
        console.error('[FloorPlanLiveView] /api/venue/services failed:', e);
      }
    }

    void loadServices();
    return () => {
      cancelled = true;
    };
  }, [bookingModel, diningAreaId]);

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

  /** DB-backed services for the selected weekday, else one row per opening_hours period (floor-plan always has something to pick when hours exist). */
  const servicePickList = useMemo((): VenueServiceRow[] => {
    const wd = getDayOfWeekForYmdInTimezone(selectedDate, venueTimezone);
    const fromDb = venueServices.filter((s) => s.is_active && s.days_of_week.includes(wd));
    if (fromDb.length > 0) return fromDb;

    const periods = getOpeningPeriodsForVenueDate(selectedDate, openingHours ?? undefined, {
      timeZone: venueTimezone,
    });
    return periods.map((p, i) => ({
      id: `opening-hours:${i}`,
      name: `${p.open.slice(0, 5)}–${p.close.slice(0, 5)}`,
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      start_time: p.open.slice(0, 5),
      end_time: p.close.slice(0, 5),
      last_booking_time: p.close.slice(0, 5),
      is_active: true,
      sort_order: i,
    }));
  }, [venueServices, selectedDate, venueTimezone, openingHours]);

  const activeServiceId = useMemo(() => {
    if (startHourOverride == null || endHourOverride == null) return null;
    const t = selectedTime.slice(0, 5);
    for (const s of servicePickList) {
      const b = periodToCalendarGridHours(s.start_time, s.end_time);
      if (!b) continue;
      if (b.startHour === startHourOverride && b.endHour === endHourOverride && t === s.start_time.slice(0, 5)) {
        return s.id;
      }
    }
    return null;
  }, [servicePickList, startHourOverride, endHourOverride, selectedTime]);

  const applyVenueServiceToTimeline = useCallback((s: VenueServiceRow) => {
    const bounds = periodToCalendarGridHours(s.start_time, s.end_time);
    if (!bounds) return;
    setStartHourOverride(bounds.startHour);
    setEndHourOverride(bounds.endHour);
    setTimeRangeFilterActive(false);
    setSelectedTime(s.start_time.slice(0, 5));
  }, []);

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

  const applyFloorTimelineRangeStart = useCallback(
    (start: number) => {
      if (!Number.isFinite(start) || start < 0 || start > 23) return;
      const end = Math.max(pickerEndHour, start + 1);
      const clampedEnd = Math.min(24, end);
      setStartHourOverride(start);
      setEndHourOverride(clampedEnd);
      const minM = start * 60;
      const maxM = Math.max(minM, clampedEnd * 60 - 1);
      const cur = minutesFromTime(selectedTime);
      setSelectedTime(minutesToTimeShort(Math.min(Math.max(cur, minM), maxM)));
    },
    [pickerEndHour, selectedTime],
  );

  const applyFloorTimelineRangeEnd = useCallback(
    (end: number) => {
      if (!Number.isFinite(end) || end < 1 || end > 24) return;
      const start = Math.min(pickerStartHour, end - 1);
      setStartHourOverride(start);
      setEndHourOverride(end);
      const minM = start * 60;
      const maxM = Math.max(minM, end * 60 - 1);
      const cur = minutesFromTime(selectedTime);
      setSelectedTime(minutesToTimeShort(Math.min(Math.max(cur, minM), maxM)));
    },
    [pickerStartHour, selectedTime],
  );

  const resetFloorTimelineRangeToVenueHours = useCallback(() => {
    setStartHourOverride(null);
    setEndHourOverride(null);
    const minM = derivedStartHour * 60;
    const maxM = Math.max(minM, derivedEndHour * 60 - 1);
    const cur = minutesFromTime(selectedTime);
    setSelectedTime(minutesToTimeShort(Math.min(Math.max(cur, minM), maxM)));
  }, [derivedStartHour, derivedEndHour, selectedTime]);

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
              estimated_end_time: cell.booking_details.end_time
                ? estimatedEndIsoForDate(
                    selectedDate,
                    cell.booking_details.start_time.slice(0, 5),
                    endMinutesAfterStartShort(cell.booking_details.start_time, cell.booking_details.end_time),
                  )
                : null,
              status: cell.booking_details.status,
              deposit_status: cell.booking_details.deposit_status ?? null,
              deposit_amount_pence: cell.booking_details.deposit_amount_pence ?? null,
              dietary_notes: cell.booking_details.dietary_notes,
              occasion: cell.booking_details.occasion,
              internal_notes: cell.booking_details.internal_notes ?? null,
            });
          }
          const existing = groups.get(cell.booking_id) ?? [];
          if (!existing.includes(cell.table_id)) existing.push(cell.table_id);
          groups.set(cell.booking_id, existing);
        }
        for (const ub of grid.unassigned_bookings ?? []) {
          if (map.has(ub.id)) continue;
          map.set(ub.id, {
            id: ub.id,
            guest_name: ub.guest_name,
            party_size: ub.party_size,
            start_time: ub.start_time,
            estimated_end_time: ub.end_time
              ? estimatedEndIsoForDate(
                  selectedDate,
                  ub.start_time.slice(0, 5),
                  endMinutesAfterStartShort(ub.start_time, ub.end_time),
                )
              : null,
            status: ub.status,
            deposit_status: ub.deposit_status ?? null,
            deposit_amount_pence: ub.deposit_amount_pence ?? null,
            dietary_notes: ub.dietary_notes,
            occasion: ub.occasion,
            internal_notes: ub.internal_notes ?? null,
          });
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
            const startHHmm = candidate.start_time.includes('T')
              ? new Date(candidate.start_time).toISOString().slice(11, 16)
              : candidate.start_time.slice(0, 5);
            const startMin = minutesFromTime(startHHmm);
            const endMin = bookingEndMinutes(candidate, selectedDate, currentMin);
            return currentMin >= startMin && currentMin < endMin;
          }) ?? null;
      if (booking?.status === 'Seated' || booking?.status === 'Arrived') {
        tableStatus = 'seated';
      }

      let elapsedPct = 0;
      let turnProgressPct = 0;
      if (booking?.start_time && booking?.estimated_end_time) {
        const startHHmm = booking.start_time.includes('T')
          ? new Date(booking.start_time).toISOString().slice(11, 16)
          : booking.start_time.slice(0, 5);
        const [sh, sm] = startHHmm.split(':').map(Number);
        const [y, mo, d] = selectedDate.split('-').map(Number);
        const startMs = new Date(y!, mo! - 1, d!, sh!, sm!).getTime();
        const effectiveEndMin = bookingEndMinutes(booking, selectedDate, currentMin);
        const endMs = new Date(y!, mo! - 1, d!, Math.floor(effectiveEndMin / 60), effectiveEndMin % 60).getTime();
        const totalMs = endMs - startMs;
        if (totalMs > 0) {
          const raw = ((now - startMs) / totalMs) * 100;
          turnProgressPct = raw;
          elapsedPct = Math.min(100, Math.max(0, raw));
        }
      }

      return {
        ...t,
        service_status: tableStatus,
        booking,
        elapsed_pct: elapsedPct,
        turn_progress_pct: turnProgressPct,
      };
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

  const runningLongTableCount = useMemo(
    () => tablesWithState.filter((t) => t.booking && t.turn_progress_pct > 100).length,
    [tablesWithState],
  );

  const activeBookingStatusSet = useMemo(
    () => new Set<string>(BOOKING_ACTIVE_STATUSES as readonly string[]),
    [],
  );

  const tableGridHref = useMemo(() => {
    const p = new URLSearchParams();
    p.set('date', selectedDate);
    if (diningAreaId) p.set('area', diningAreaId);
    return `/dashboard/table-grid?${p.toString()}`;
  }, [selectedDate, diningAreaId]);

  const highlightFloorTableIds = useMemo(() => {
    const q = floorSearchQuery.trim().toLowerCase();
    const partyN = filterPartySizeMin.trim() === '' ? null : Number.parseInt(filterPartySizeMin, 10);
    const hasSearch = q.length > 0;
    const hasParty = partyN != null && Number.isFinite(partyN) && partyN > 0;
    if (!hasSearch && !filterDietaryOnly && !filterOccasionOnly && !filterOverdueOnly && !hasParty) {
      return new Set<string>();
    }

    const guestNameMatchOnTable = (tableId: string): boolean => {
      if (!gridData?.cells?.length || !q) return false;
      for (const c of gridData.cells) {
        if (c.table_id !== tableId || !c.booking_details?.guest_name || !c.booking_id) continue;
        if (!activeBookingStatusSet.has(c.booking_details.status)) continue;
        if (c.booking_details.guest_name.toLowerCase().includes(q)) return true;
      }
      return false;
    };

    const ids = new Set<string>();
    for (const t of tablesWithState) {
      let ok = true;
      if (hasSearch) {
        const nameMatch = t.name.toLowerCase().includes(q);
        const guestCur = t.booking ? t.booking.guest_name.toLowerCase().includes(q) : false;
        const guestAny = guestNameMatchOnTable(t.id);
        if (!nameMatch && !guestCur && !guestAny) ok = false;
      }
      if (ok && filterDietaryOnly) {
        if (!t.booking?.dietary_notes?.trim()) ok = false;
      }
      if (ok && filterOccasionOnly) {
        if (!t.booking?.occasion?.trim()) ok = false;
      }
      if (ok && filterOverdueOnly) {
        if (!t.booking || t.turn_progress_pct <= 100) ok = false;
      }
      if (ok && hasParty && partyN != null) {
        if (t.max_covers < partyN || t.service_status !== 'available' || t.booking) ok = false;
      }
      if (ok) ids.add(t.id);
    }
    return ids;
  }, [
    tablesWithState,
    gridData,
    floorSearchQuery,
    filterDietaryOnly,
    filterOccasionOnly,
    filterOverdueOnly,
    filterPartySizeMin,
    activeBookingStatusSet,
  ]);

  const floorSearchActive = Boolean(
    floorSearchQuery.trim() ||
      filterDietaryOnly ||
      filterOccasionOnly ||
      filterOverdueOnly ||
      filterPartySizeMin.trim(),
  );

  const jumpTimelineToNextBookings = useCallback(() => {
    const slot = summaryData.next_bookings_slot;
    if (!slot?.time) return;
    const { minM, maxM } = timelineScrubBounds;
    const raw = minutesFromTime(slot.time);
    setSelectedTime(minutesToTimeShort(Math.min(Math.max(raw, minM), maxM)));
  }, [summaryData.next_bookings_slot, timelineScrubBounds]);

  const onCoversChipClick = useCallback(() => {
    addToast('Live covers follow the timeline clock — open the clock button to adjust service time.', 'info');
  }, [addToast]);

  /** HH:mm for move-validation (cells use wall-clock strings; DB may return ISO). */
  const bookingStartHHmm = useCallback((startTime: string): string => {
    const s = startTime.trim();
    if (s.includes('T')) {
      try {
        return new Date(s).toISOString().slice(11, 16);
      } catch {
        return s.slice(0, 5);
      }
    }
    return s.slice(0, 5);
  }, []);

  const bookingEndHHmm = useCallback((booking: BookingOnTable): string => {
    if (booking.estimated_end_time) {
      try {
        return new Date(booking.estimated_end_time).toISOString().slice(11, 16);
      } catch {
        return '';
      }
    }
    return '';
  }, []);

  const getAssignCandidates = useCallback(
    (bookingId: string) => {
      const booking = bookingMap.get(bookingId);
      if (!booking || !gridData) return [] as { id: string; name: string; combo?: string }[];
      const context: BookingMoveContext = {
        id: bookingId,
        party_size: booking.party_size,
        start_time: bookingStartHHmm(booking.start_time),
        end_time: bookingEndHHmm(booking),
      };
      const tableInfos = gridData.tables.map((t) => ({
        id: t.id,
        name: t.name,
        max_covers: t.max_covers,
        position_x: t.position_x,
        position_y: t.position_y,
        width: t.width,
        height: t.height,
        rotation: t.rotation,
      }));
      const result = computeValidMoveTargets(context, tableInfos, gridData.cells, allCombinations);
      const ordered: { id: string; name: string; combo?: string }[] = [];
      const seen = new Set<string>();
      for (const id of result.validTableIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        ordered.push({
          id,
          name: tables.find((t) => t.id === id)?.name ?? id,
          combo: result.comboLabels.get(id),
        });
        if (ordered.length >= 14) break;
      }
      return ordered;
    },
    [bookingMap, gridData, allCombinations, tables, bookingStartHHmm, bookingEndHHmm],
  );

  const canvasTapMoveMode = useMemo(() => {
    if (reassignMode) return { bookingId: reassignMode.bookingId, guestName: reassignMode.guestName };
    if (!pendingAssignBookingId) return null;
    const name = bookingMap.get(pendingAssignBookingId)?.guest_name ?? 'Guest';
    return { bookingId: pendingAssignBookingId, guestName: name };
  }, [reassignMode, pendingAssignBookingId, bookingMap]);

  const resolveAssignTargetTableIds = useCallback(
    (bookingId: string, targetTableId: string): string[] | null => {
      const booking = bookingMap.get(bookingId);
      if (!booking || !gridData) return null;
      const startHHmm = booking.start_time.includes('T')
        ? new Date(booking.start_time).toISOString().slice(11, 16)
        : booking.start_time.slice(0, 5);
      const endHHmm = booking.estimated_end_time
        ? new Date(booking.estimated_end_time).toISOString().slice(11, 16)
        : '';
      const context: BookingMoveContext = {
        id: bookingId,
        party_size: booking.party_size,
        start_time: startHHmm,
        end_time: endHHmm,
      };
      const tableInfos = gridData.tables.map((t) => ({
        id: t.id,
        name: t.name,
        max_covers: t.max_covers,
        position_x: t.position_x,
        position_y: t.position_y,
        width: t.width,
        height: t.height,
        rotation: t.rotation,
      }));
      return resolveDropTarget(targetTableId, context, tableInfos, gridData.cells, allCombinations);
    },
    [bookingMap, gridData, allCombinations],
  );

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
      let requestedEnd = timeToMinutesShort(newEndTimeHHmm);
      if (requestedEnd <= startMinutes) {
        requestedEnd += 24 * 60;
      }
      requestedEnd = Math.max(startMinutes + 15, requestedEnd);
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
      try {
        const res = await fetch('/api/venue/tables/assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'change_time',
            booking_id: bookingId,
            new_time: startTime,
            new_estimated_end_time: estimatedEndIsoForDate(selectedDate, startTime, clampedEnd),
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
      const oldEnd = oldBlock?.booking_details
        ? endMinutesAfterStartShort(oldBlock.booking_details.start_time, oldBlock.booking_details.end_time)
        : oldStart + 90;
      const durationMins = Math.max(15, oldEnd - oldStart);
      const newEndMins = timeToMinutesShort(newTime) + durationMins;
      try {
        const res = await fetch('/api/venue/tables/assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'change_time',
            booking_id: bookingId,
            new_time: newTime,
            new_estimated_end_time: localDateTimeIso(selectedDate, newEndMins),
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
        if (res.status === 409) {
          addToast(data.error ?? 'Table conflict — refresh and try again.', 'error');
        } else {
          addToast(data.error ?? 'Failed to reassign table', 'error');
        }
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
        if (res.status === 409) {
          addToast(data.error ?? 'Table conflict — another booking may have taken this slot. Refresh and try again.', 'error');
        } else {
          addToast(data.error ?? 'Failed to assign table', 'error');
        }
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
    setPendingAssignBookingId((prev) => (prev && prev !== bookingId ? null : prev));
    setDragSourceTableIds(sourceTableIds);
    const startHHmm = booking.start_time.includes('T')
      ? new Date(booking.start_time).toISOString().slice(11, 16)
      : booking.start_time.slice(0, 5);
    const endHHmm = booking.estimated_end_time
      ? new Date(booking.estimated_end_time).toISOString().slice(11, 16)
      : '';
    const context: BookingMoveContext = {
      id: bookingId,
      party_size: booking.party_size,
      start_time: startHHmm,
      end_time: endHHmm,
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

  const cancelPendingTableAssign = useCallback(() => {
    setPendingAssignBookingId(null);
    clearDragValidation();
  }, [clearDragValidation]);

  const handleFloorDragEnd = useCallback((event: FloorDragEvent) => {
    const booking = bookingMap.get(event.bookingId);
    if (!booking || !gridData) {
      clearDragValidation();
      return;
    }
    const startHHmm = booking.start_time.includes('T')
      ? new Date(booking.start_time).toISOString().slice(11, 16)
      : booking.start_time.slice(0, 5);
    const endHHmm = booking.estimated_end_time
      ? new Date(booking.estimated_end_time).toISOString().slice(11, 16)
      : '';
    const context: BookingMoveContext = {
      id: event.bookingId,
      party_size: booking.party_size,
      start_time: startHHmm,
      end_time: endHHmm,
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
  const handleTableSelect = useCallback(
    (id: string | null) => {
      setFloorBookingMenu(null);
      if (pendingAssignBookingId && id) {
        const row = tablesWithState.find((t) => t.id === id);
        if (!row) return;
        if (row.booking || row.service_status !== 'available') {
          addToast('Choose an empty table that is available at the timeline time.', 'error');
          return;
        }
        const booking = bookingMap.get(pendingAssignBookingId);
        if (!booking || !gridData) return;
        const startHHmm = booking.start_time.includes('T')
          ? new Date(booking.start_time).toISOString().slice(11, 16)
          : booking.start_time.slice(0, 5);
        const endHHmm = booking.estimated_end_time
          ? new Date(booking.estimated_end_time).toISOString().slice(11, 16)
          : '';
        const context: BookingMoveContext = {
          id: pendingAssignBookingId,
          party_size: booking.party_size,
          start_time: startHHmm,
          end_time: endHHmm,
        };
        const tableInfos = gridData.tables.map((t) => ({
          id: t.id,
          name: t.name,
          max_covers: t.max_covers,
          position_x: t.position_x,
          position_y: t.position_y,
          width: t.width,
          height: t.height,
          rotation: t.rotation,
        }));
        const targetTableIds = resolveDropTarget(id, context, tableInfos, gridData.cells, allCombinations);
        if (!targetTableIds) {
          addToast('Cannot assign booking to that table', 'error');
          return;
        }
        void handleAssign(pendingAssignBookingId, targetTableIds);
        setPendingAssignBookingId(null);
        clearDragValidation();
        setUnassignedSheetOpen(false);
        setSelectedTableId(null);
        return;
      }
      if (reassignMode && id) {
        const booking = bookingMap.get(reassignMode.bookingId);
        if (!booking || !gridData) return;
        const startHHmm = booking.start_time.includes('T')
          ? new Date(booking.start_time).toISOString().slice(11, 16)
          : booking.start_time.slice(0, 5);
        const endHHmm = booking.estimated_end_time
          ? new Date(booking.estimated_end_time).toISOString().slice(11, 16)
          : '';
        const context: BookingMoveContext = {
          id: reassignMode.bookingId,
          party_size: booking.party_size,
          start_time: startHHmm,
          end_time: endHHmm,
        };
        const tableInfos = gridData.tables.map((t) => ({
          id: t.id,
          name: t.name,
          max_covers: t.max_covers,
          position_x: t.position_x,
          position_y: t.position_y,
          width: t.width,
          height: t.height,
          rotation: t.rotation,
        }));
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
    },
    [
      pendingAssignBookingId,
      tablesWithState,
      handleAssign,
      addToast,
      reassignMode,
      bookingMap,
      gridData,
      allCombinations,
      handleReassign,
      clearDragValidation,
    ],
  );

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

  const selectedTableDayBookings = useMemo(
    () => (selectedTableId ? collectTableDayBookings(gridData, selectedTableId) : []),
    [gridData, selectedTableId],
  );

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
        onCoversChipClick={onCoversChipClick}
        onUnassignedChipClick={() => setUnassignedSheetOpen(true)}
        onNextChipClick={jumpTimelineToNextBookings}
        searchActive={floorSearchActive}
        searchAriaLabel="Search and filter tables on the floor plan"
        searchPanel={(
          <div className="space-y-3">
            <div>
              <label htmlFor="floor-host-search" className="mb-1 block text-xs font-semibold text-slate-700">
                Guest or table
              </label>
              <input
                id="floor-host-search"
                type="search"
                value={floorSearchQuery}
                onChange={(e) => setFloorSearchQuery(e.target.value)}
                placeholder="Name, table…"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={filterDietaryOnly}
                  onChange={(e) => setFilterDietaryOnly(e.target.checked)}
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                Dietary notes
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={filterOccasionOnly}
                  onChange={(e) => setFilterOccasionOnly(e.target.checked)}
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                Occasion set
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={filterOverdueOnly}
                  onChange={(e) => setFilterOverdueOnly(e.target.checked)}
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                Past expected end
              </label>
              <div>
                <label htmlFor="floor-party-min" className="mb-1 block text-xs font-semibold text-slate-700">
                  Empty tables ≥ party
                </label>
                <input
                  id="floor-party-min"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={filterPartySizeMin}
                  onChange={(e) => setFilterPartySizeMin(e.target.value)}
                  placeholder="e.g. 6"
                  className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
            </div>
            <button
              type="button"
              className="text-xs font-semibold text-brand-700 hover:underline"
              onClick={() => {
                setFloorSearchQuery('');
                setFilterDietaryOnly(false);
                setFilterOccasionOnly(false);
                setFilterOverdueOnly(false);
                setFilterPartySizeMin('');
              }}
            >
              Clear filters
            </button>
          </div>
        )}
        infoPanelExtra={(
          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Service pulse</p>
              <p className="mt-2 text-[11px] leading-snug text-slate-700">
                <span className="font-semibold tabular-nums text-slate-900">{runningLongTableCount}</span>{' '}
                <span className="text-slate-600">
                  {runningLongTableCount === 1 ? 'table' : 'tables'} running long (past expected end for the timeline
                  time).
                </span>
              </p>
              <p className="mt-2 text-[10px] leading-snug text-slate-500">
                The first chip shows live covers when available, otherwise booked covers against capacity; the others
                show tables in use, unassigned bookings, and the next arrival window or combos in use.
              </p>
            </div>
            <div className="border-t border-slate-100 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Floor key</p>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-slate-600">
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-slate-500" aria-hidden />Available</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-700" aria-hidden />Booked</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-teal-700" aria-hidden />Seated</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-600" aria-hidden />Blocked</span>
              </div>
              <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Table progress</p>
              <div className="mt-2 grid gap-1.5 text-[11px] text-slate-600">
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-[3px] border-teal-600" aria-hidden />Within booking window</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-[3px] border-amber-600" aria-hidden />Approaching end time</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-[3px] border-red-600" aria-hidden />Past expected end time</span>
              </div>
              <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Table badges</p>
              <div className="mt-2 grid gap-1.5 text-[11px] text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-600 ring-1 ring-white" aria-hidden />Dietary note on the booking
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-green-600 ring-1 ring-white" aria-hidden />Other important info only (occasion, deposit pending, or staff note)
                </span>
              </div>
              <p className="mt-2 text-[10px] leading-snug text-slate-500">
                One dot per table. Red takes priority when a dietary note is present alongside other signals.
              </p>
            </div>
          </div>
        )}
        trailingActions={
          <div className="flex flex-wrap items-center gap-1">
            <Link
              href={tableGridHref}
              className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Table grid
            </Link>
            {isAdmin && editLayoutHref ? (
              <Link
                href={editLayoutHref}
                className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                Edit layout
              </Link>
            ) : null}
          </div>
        }
        timelineLabel={selectedTime}
        timelinePanel={(
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-100 bg-slate-50/90 px-3 py-2.5">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Slider range</p>
              <p className="mb-2 text-[11px] leading-snug text-slate-600">
                Widen or narrow the scrubber when bookings run outside your usual service window.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="block min-w-0">
                  <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">From (hour)</span>
                  <select
                    value={pickerStartHour}
                    onChange={(e) => applyFloorTimelineRangeStart(Number(e.target.value))}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 py-0 pr-7 text-xs shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    aria-label="Timeline slider start hour"
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
                  <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Until (hour)</span>
                  <select
                    value={pickerEndHour}
                    onChange={(e) => applyFloorTimelineRangeEnd(Number(e.target.value))}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 py-0 pr-7 text-xs shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    aria-label="Timeline slider end hour"
                  >
                    {Array.from({ length: 24 }, (_, i) => i + 1)
                      .filter((hour) => hour <= 24 && hour > pickerStartHour)
                      .map((hour) => (
                        <option key={hour} value={hour}>
                          {String(hour).padStart(2, '0')}:00
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              {startHourOverride != null || endHourOverride != null ? (
                <button
                  type="button"
                  onClick={resetFloorTimelineRangeToVenueHours}
                  className="mt-2 text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                >
                  Reset range to venue hours
                </button>
              ) : null}
            </div>
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
                  Drag to move forward or back. Range is {String(pickerStartHour).padStart(2, '0')}:00–{String(pickerEndHour).padStart(2, '0')}:00 (adjust above if needed).
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
        toolbarLeadingTools={(toolbarPanelAnchorRef: RefObject<HTMLDivElement | null>) => (
          <>
            {areaNav ? (
              <DiningAreaPicker
                areas={areaNav.areas}
                value={areaNav.value}
                onChange={areaNav.onChange}
                verticalAnchorRef={toolbarPanelAnchorRef}
                compact
              />
            ) : null}
            <FloorPlanServicePicker
              services={servicePickList}
              verticalAnchorRef={toolbarPanelAnchorRef}
              compact
              selectedServiceId={activeServiceId}
              onSelectService={applyVenueServiceToTimeline}
            />
          </>
        )}
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
        {!reassignMode && pendingAssignBookingId && (
          <div className="absolute left-2 right-2 top-2 z-30 flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-[11px] text-brand-950 shadow-sm sm:left-4 sm:right-4 sm:top-4 sm:px-4 sm:py-2 sm:text-xs">
            <span>
              Tap a highlighted table to assign <strong>{bookingMap.get(pendingAssignBookingId)?.guest_name ?? 'Guest'}</strong>
            </span>
            <button type="button" onClick={cancelPendingTableAssign} className="shrink-0 font-semibold text-brand-800 underline">
              Cancel
            </button>
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
            reassignMode={canvasTapMoveMode}
            highlightTableIds={highlightFloorTableIds}
            onSelect={handleTableSelect}
            onDragStart={startDragValidation}
            onDragEnd={handleFloorDragEnd}
            onDragCancel={clearDragValidation}
            onBookingClick={
              reassignMode || pendingAssignBookingId
                ? undefined
                : (bookingId, anchor) => {
                    openBookingPopoverFromCanvas(bookingId, anchor);
                  }
            }
            onBookedTableContextMenu={(bookingId, _tableId, x, y) => {
              if (reassignMode || pendingAssignBookingId) return;
              const row = toMenuBooking(bookingId);
              if (row) setFloorBookingMenu({ booking: row, x, y });
            }}
            floorBackgroundUrl={floorPlanBackgroundUrl}
          />
        </div>
      </div>

      {/* Unassigned bookings — compact host-stand panel */}
      {unassignedSheetOpen && gridData ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-2 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="floor-unassigned-title"
          onClick={() => setUnassignedSheetOpen(false)}
        >
          <div
            className="max-h-[min(85dvh,640px)] w-full max-w-lg overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 id="floor-unassigned-title" className="text-sm font-semibold text-slate-900">
                Unassigned bookings
              </h2>
              <button
                type="button"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close"
                onClick={() => setUnassignedSheetOpen(false)}
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="max-h-[min(70dvh,520px)] overflow-y-auto px-4 py-3">
              {gridData.unassigned_bookings.length === 0 ? (
                <p className="text-sm text-slate-600">No unassigned bookings for this day.</p>
              ) : (
                <ul className="space-y-3">
                  {gridData.unassigned_bookings.map((b) => {
                    const candidates = getAssignCandidates(b.id);
                    return (
                      <li key={b.id} className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-900">{b.guest_name}</p>
                          <p className="text-xs text-slate-500">
                            {b.party_size} ·{' '}
                            {typeof b.start_time === 'string' && b.start_time.includes('T')
                              ? new Date(b.start_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                              : String(b.start_time ?? '').slice(0, 5)}
                          </p>
                        </div>
                        {(b.dietary_notes?.trim() || b.occasion?.trim()) ? (
                          <p className="mt-1 text-xs text-amber-900">
                            {b.dietary_notes?.trim() ? <>Dietary: {b.dietary_notes}</> : null}
                            {b.dietary_notes?.trim() && b.occasion?.trim() ? ' · ' : null}
                            {b.occasion?.trim() ? <>Occasion: {b.occasion}</> : null}
                          </p>
                        ) : null}
                        {candidates.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {candidates.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-800 shadow-sm hover:bg-brand-50"
                                title={c.combo ? `Uses combo: ${c.combo}` : undefined}
                                onClick={() => {
                                  const ids = resolveAssignTargetTableIds(b.id, c.id);
                                  if (!ids?.length) {
                                    addToast('Cannot assign to that table', 'error');
                                    return;
                                  }
                                  void handleAssign(b.id, ids);
                                  setUnassignedSheetOpen(false);
                                }}
                              >
                                {c.name}
                                {c.combo ? <span className="ml-0.5 text-[10px] font-normal text-slate-500">+</span> : null}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-xs text-slate-500">No single-table match at this service time — use pick on floor for combinations.</p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                            onClick={() => {
                              setUnassignedSheetOpen(false);
                              setPendingAssignBookingId(b.id);
                              startDragValidation(b.id, []);
                            }}
                          >
                            Pick table on floor…
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            onClick={() => {
                              setUnassignedSheetOpen(false);
                              openBookingDrawer(b.id);
                            }}
                          >
                            Open booking
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

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
              <p className="text-[11px] text-slate-500 sm:text-xs">
                {selectedTable.max_covers} covers · {selectedTable.zone ?? 'No zone'}
                {selectedTable.server_section?.trim() ? (
                  <span className="text-slate-600"> · Section: {selectedTable.server_section}</span>
                ) : null}
              </p>
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

          {selectedTableDayBookings.length > 0 ? (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Today on this table</p>
              <ul className={`mt-2 space-y-1.5 overflow-y-auto text-xs text-slate-800 ${tableDetailSheetExpanded ? 'max-h-52' : 'max-h-28'}`}>
                {selectedTableDayBookings.map((row) => (
                  <li key={row.booking_id} className="flex flex-wrap justify-between gap-1 border-b border-slate-200/80 pb-1 last:border-0">
                    <span className="font-medium">{row.guest_name}</span>
                    <span className="text-slate-500">
                      {row.start_time}–{row.end_time} · {row.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

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
                <button
                  type="button"
                  onClick={() => {
                    setUnassignedSheetOpen(true);
                    addToast('Pick a guest, then a table chip or “Pick on floor”.', 'info');
                  }}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Unassigned list
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
