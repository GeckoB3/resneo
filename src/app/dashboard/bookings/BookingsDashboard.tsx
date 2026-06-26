'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { TableSelector } from '@/components/table-tracking/TableSelector';
import type { OccupancyMap, TableForSelector } from '@/components/table-tracking/TableSelector';
import { createClient } from '@/lib/supabase/browser';
import { DashboardStaffBookingModal } from '@/components/booking/DashboardStaffBookingModal';
import { ExpandedBookingContent } from './ExpandedBookingContent';
import { BookingDetailPanel, type BookingDetailPanelSnapshot } from './BookingDetailPanel';
import { UndoToast } from '@/app/dashboard/table-grid/UndoToast';
import type { UndoAction } from '@/types/table-management';
import {
  BOOKING_REVERT_ACTIONS,
  canMarkNoShowForSlot,
  canTransitionBookingStatus,
  isDestructiveBookingStatus,
  isRevertTransition,
  isBookingInstantRevertTransition,
  type BookingStatus,
} from '@/lib/table-management/booking-status';
import { bookingStatusVisualForRow } from '@/lib/table-management/booking-status-visual';
import { useToast } from '@/components/ui/Toast';
import { readResponseJson } from '@/lib/http/read-response-json';
import { EmptyState as DashboardEmptyState } from '@/components/ui/dashboard/EmptyState';
import { TabBar } from '@/components/ui/dashboard/TabBar';
import { BookingStatusPill } from '@/components/ui/dashboard/BookingStatusPill';
import { Pill, type PillVariant } from '@/components/ui/dashboard/Pill';
import { OperationsWorkspaceToolbar } from '@/components/dashboard/OperationsWorkspaceToolbar';
import { OperationsToolbarGuestSearchPanel } from '@/components/dashboard/OperationsToolbarGuestSearchPanel';
import { ClampedFixedDropdown } from '@/components/ui/ClampedFixedDropdown';
import { ConfirmDialog } from '@/components/ui/primitives/ConfirmDialog';
import { Dialog } from '@/components/ui/primitives/Dialog';
import type { ViewToolbarSummary } from '@/components/dashboard/ViewToolbar';
import type { BookingModel } from '@/types/booking-models';
import { BOOKING_MODEL_ORDER } from '@/lib/booking/enabled-models';
import {
  bookingTypePillVariant,
  cdeDeepLinkEntityLabel,
  readCdeDeepLinkFilter,
  type CdeDeepLinkFilter,
} from './bookings-list-shared';
import {
  inferBookingRowModel,
  bookingModelShortLabel,
  isTableReservationBooking,
  bookingStatusDisplayLabel,
  showBookingModelTypePill,
} from '@/lib/booking/infer-booking-row-model';
import {
  isAttendanceConfirmed,
  showAttendanceConfirmedSupplementPill,
  showDepositPendingPill,
} from '@/lib/booking/booking-staff-indicators';
import {
  applyBookingRowOverlayFields,
  applyOptimisticStatusToBookingRows,
  overlayFromPatchPayload,
} from '@/lib/booking/booking-row-overlay';
import { CalendarDateTimePicker } from '@/components/calendar/CalendarDateTimePicker';
import { getCalendarGridBounds } from '@/lib/venue-calendar-bounds';
import { isBookingTimeInHourRange } from '@/lib/booking-time-window';
import type { OpeningHours } from '@/types/availability';
import { BulkGuestMessageModal } from '@/components/booking/BulkGuestMessageModal';
import { AddTagModal } from '@/components/booking/AddTagModal';
import type { GuestMessageChannel, GuestMessageSendResult } from '@/lib/booking/guest-message-channel';
import { DashboardListSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';
import { useDashboardVenueBootstrap } from '@/components/providers/DashboardVenueBootstrapProvider';
import {
  useDashboardDetailCache,
  type VenueBookingDetailPayload,
} from '@/components/providers/DashboardDetailCacheProvider';
import { readSessionPreference, writeSessionPreference } from '@/lib/ui/session-preferences';
import type { GuestHistoryRelatedBookingPayload } from '@/app/dashboard/bookings/GuestBookingsForGuestAccordion';
import { expandedBookingRowShellClass } from '@/app/dashboard/bookings/booking-expand-accordion-classes';
import { bindDetailPrefetchHandlers } from '@/lib/dashboard/detail-prefetch-intent';
import {
  primeGroupVisitBookingsFromListSeeds,
  resolveInitialGroupVisitBookings,
  warmGroupVisitBookings,
} from '@/lib/booking/group-visit-bookings';
import { scheduleWaitlistAlertsRefresh } from '@/lib/booking/waitlist-alerts-events';
import { bookingDetailLiteFromCachePayload } from '@/lib/booking/resolve-booking-detail-lite';
import { bookingDetailLiteFromListRow } from '@/lib/booking/booking-detail-from-row';
import { resolveBookingListBarSchedule } from '@/lib/booking/booking-list-row-schedule';
import { useDebouncedCallback } from '@/lib/hooks/use-debounced-callback';
import { REALTIME_BOOKINGS_DEBOUNCE_MS } from '@/lib/realtime/dashboard-sync-constants';

interface BookingRow {
  id: string;
  booking_date: string;
  booking_time: string;
  booking_end_time?: string | null;
  estimated_end_time: string | null;
  created_at: string | null;
  party_size: number;
  status: string;
  source: string;
  deposit_status: string;
  deposit_amount_pence: number | null;
  dietary_notes: string | null;
  occasion: string | null;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  guest_id?: string;
  guest_visit_count?: number | null;
  table_assignments?: Array<{ id: string; name: string }>;
  service_id?: string | null;
  practitioner_id?: string | null;
  appointment_service_id?: string | null;
  group_booking_id?: string | null;
  person_label?: string | null;
  experience_event_id?: string | null;
  class_instance_id?: string | null;
  resource_id?: string | null;
  event_session_id?: string | null;
  calendar_id?: string | null;
  service_item_id?: string | null;
  service_variant_id?: string | null;
  processing_time_blocks?: unknown | null;
  guest_attendance_confirmed_at?: string | null;
  staff_attendance_confirmed_at?: string | null;
  client_arrived_at?: string | null;
  area_id?: string | null;
  area_name?: string | null;
  /** Persisted model; drives {@link inferBookingRowModel} with FK fallbacks. */
  booking_model?: string | null;
  /** Resolved service / event / class / resource / dining-service label for the booking bar. */
  booking_item_name?: string | null;
  /** Number of add-ons booked; drives the "+N extras" chip. */
  addons_count?: number | null;
  addons_total_price_pence?: number | null;
  addons_total_duration_minutes?: number | null;
}

interface BookingDetailLite {
  id: string;
  special_requests: string | null;
  internal_notes: string | null;
  cancellation_deadline: string | null;
  checked_in_at?: string | null;
  table_assignments?: Array<{ id: string; name: string }>;
  guest: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    visit_count: number;
    last_visit_date?: string | null;
    tags?: string[];
    customer_profile_notes?: string | null;
  } | null;
  communications: Array<{ id: string; message_type: string; channel: string; status: string; created_at: string }>;
  events: Array<{ id: string; event_type: string; created_at: string }>;
  combination_staff_notes?: string | null;
  /** Populated for C/D/E rows (see GET /api/venue/bookings/[id]). */
  cde_context?: {
    inferred_model: BookingModel;
    title: string;
    subtitle?: string | null;
  } | null;
  inferred_booking_model?: BookingModel;
}

type ViewMode = 'day' | 'week' | 'month' | 'custom';

interface BookingsDashboardPreferences {
  viewMode?: ViewMode;
  anchorDate?: string;
  customFrom?: string;
  customTo?: string;
  statusFilter?: string;
  modelFilter?: 'all' | BookingModel;
  serviceFilterIds?: string[];
  calendarFilter?: string;
  areaId?: string | null;
  startHourOverride?: number | null;
  endHourOverride?: number | null;
  timeRangeFilterActive?: boolean;
}

const VIEW_MODE_OPTIONS: { id: ViewMode; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'custom', label: 'Custom' },
];

interface StatusFilterOption {
  label: string;
  apiStatus: string | null;
  attendanceConfirmed?: boolean;
  excludeAttendanceConfirmed?: boolean;
}

/**
 * Filter UI labels.
 *  - `Booked` - `status === 'Booked'` and not attendance-confirmed.
 *  - `Confirmed` - guest or staff confirmed attendance, including legacy `status === 'Confirmed'`.
 */
const STATUS_FILTER_OPTIONS: StatusFilterOption[] = [
  { label: 'All', apiStatus: null },
  { label: 'Pending', apiStatus: 'Pending' },
  { label: 'Booked', apiStatus: 'Booked', excludeAttendanceConfirmed: true },
  { label: 'Confirmed', apiStatus: null, attendanceConfirmed: true },
  { label: 'Started', apiStatus: 'Seated' },
  { label: 'Completed', apiStatus: 'Completed' },
  { label: 'Cancelled', apiStatus: 'Cancelled' },
  { label: 'No-Show', apiStatus: 'No-Show' },
];
const GUEST_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function bookingsPreferencesKey(venueId: string): string {
  return `reserve:dashboard:bookings:${venueId}:preferences`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableHour(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 24);
}

function isBookingsDashboardPreferences(value: unknown): value is BookingsDashboardPreferences {
  if (!isRecord(value)) return false;
  if (value.viewMode !== undefined && !VIEW_MODE_OPTIONS.some((option) => option.id === value.viewMode)) return false;
  if (value.anchorDate !== undefined && (typeof value.anchorDate !== 'string' || !ISO_DATE_RE.test(value.anchorDate))) return false;
  if (value.customFrom !== undefined && (typeof value.customFrom !== 'string' || !ISO_DATE_RE.test(value.customFrom))) return false;
  if (value.customTo !== undefined && (typeof value.customTo !== 'string' || !ISO_DATE_RE.test(value.customTo))) return false;
  if (value.statusFilter !== undefined && (typeof value.statusFilter !== 'string' || !STATUS_FILTER_OPTIONS.some((option) => option.label === value.statusFilter))) return false;
  if (value.modelFilter !== undefined && value.modelFilter !== 'all' && !BOOKING_MODEL_ORDER.includes(value.modelFilter as BookingModel)) return false;
  if (value.serviceFilterIds !== undefined && (!Array.isArray(value.serviceFilterIds) || !value.serviceFilterIds.every((id) => typeof id === 'string' && GUEST_UUID_RE.test(id)))) return false;
  if (value.calendarFilter !== undefined && (typeof value.calendarFilter !== 'string' || (value.calendarFilter !== 'all' && !GUEST_UUID_RE.test(value.calendarFilter)))) return false;
  if (value.areaId !== undefined && value.areaId !== null && (typeof value.areaId !== 'string' || !GUEST_UUID_RE.test(value.areaId))) return false;
  if (value.startHourOverride !== undefined && !isNullableHour(value.startHourOverride)) return false;
  if (value.endHourOverride !== undefined && !isNullableHour(value.endHourOverride)) return false;
  if (value.timeRangeFilterActive !== undefined && typeof value.timeRangeFilterActive !== 'boolean') return false;
  return true;
}

function bookingTypeFilterLabel(model: BookingModel): string {
  switch (model) {
    case 'table_reservation':
      return 'Table';
    case 'unified_scheduling':
    case 'practitioner_appointment':
      return 'Appointment';
    case 'event_ticket':
      return 'Event';
    case 'resource_booking':
      return 'Resource';
    case 'class_session':
      return 'Class';
    default:
      return bookingModelShortLabel(model);
  }
}

interface FetchBookingsOptions {
  silent?: boolean;
  ids?: string[];
}

interface DiningService {
  id: string;
  name: string;
  is_active: boolean;
  area_id?: string | null;
}

interface DiningServiceFilterOption extends DiningService {
  label: string;
}

interface BookingCalendarFilterOption {
  id: string;
  name: string;
  is_active?: boolean;
  calendar_type?: string | null;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function startOfMonth(date: string): string {
  return date.slice(0, 7) + '-01';
}

function endOfMonth(date: string): string {
  const [y, m] = date.split('-').map(Number);
  const last = new Date(y!, m!, 0).getDate();
  return `${date.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDateLabel(date: string, mode: ViewMode): string {
  const d = new Date(date + 'T12:00:00');
  if (mode === 'day') {
    return `${WEEKDAYS_LONG[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
  }
  if (mode === 'week') {
    const end = new Date(addDays(date, 6) + 'T12:00:00');
    return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} \u2013 ${end.getDate()} ${MONTHS_SHORT[end.getMonth()]} ${end.getFullYear()}`;
  }
  if (mode === 'month') return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
  return '';
}

function formatDayHeader(date: string): string {
  const d = new Date(date + 'T12:00:00');
  return `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

interface DaySheetForTableChange {
  periods: Array<{
    bookings: Array<{
      id: string;
      guest_name: string;
      status: string;
      table_assignments?: Array<{ id: string; name: string }>;
    }>;
  }>;
  active_tables: TableForSelector[];
}

function buildCoversOccupancyMap(dayData: DaySheetForTableChange | null, excludeBookingId: string): OccupancyMap {
  const map: OccupancyMap = {};
  if (!dayData) return map;
  const tables = dayData.active_tables ?? [];
  for (const t of tables) map[t.id] = null;
  for (const period of dayData.periods) {
    for (const b of period.bookings) {
      if (b.id === excludeBookingId) continue;
      if (b.status !== 'Seated' || !b.table_assignments?.length) continue;
      for (const ta of b.table_assignments) {
        map[ta.id] = { bookingId: b.id, guestName: b.guest_name };
      }
    }
  }
  return map;
}

export function BookingsDashboard({
  venueId,
  currency,
  primaryBookingModel = 'table_reservation',
  enabledModels = [],
  initialTodayIso,
}: {
  venueId: string;
  currency?: string;
  primaryBookingModel?: BookingModel;
  enabledModels?: BookingModel[];
  /** yyyy-mm-dd from the server render - keeps "today" aligned between SSR and hydration. */
  initialTodayIso?: string;
}) {
  const { addToast } = useToast();
  const {
    peekVenueBookingDetail,
    primeVenueBookingDetail,
    invalidateVenueBookingDetail,
    warmVenueBookingDetail,
  } = useDashboardDetailCache();
  const venueBootstrap = useDashboardVenueBootstrap();
  const todayIso = initialTodayIso ?? todayISO();
  const preferencesKey = bookingsPreferencesKey(venueId);
  const rememberedPreferences = useMemo(
    () => readSessionPreference<BookingsDashboardPreferences>(preferencesKey, {}, isBookingsDashboardPreferences),
    [preferencesKey],
  );
  const [viewMode, setViewMode] = useState<ViewMode>(rememberedPreferences.viewMode ?? 'day');
  const [anchorDate, setAnchorDate] = useState(rememberedPreferences.anchorDate ?? todayIso);
  const [customFrom, setCustomFrom] = useState(rememberedPreferences.customFrom ?? todayIso);
  const [customTo, setCustomTo] = useState(rememberedPreferences.customTo ?? todayIso);
  const [statusFilter, setStatusFilter] = useState<string>(rememberedPreferences.statusFilter ?? 'All');
  const [modelFilter, setModelFilter] = useState<'all' | BookingModel>(rememberedPreferences.modelFilter ?? 'all');
  const [guestToolbarSearchQuery, setGuestToolbarSearchQuery] = useState('');
  const [viewRangePopoverOpen, setViewRangePopoverOpen] = useState(false);
  const viewRangeTriggerRef = useRef<HTMLButtonElement>(null);
  const viewRangeWrapRef = useRef<HTMLDivElement>(null);
  const viewRangePanelId = useId();
  const [serviceFilterIds, setServiceFilterIds] = useState<string[]>(rememberedPreferences.serviceFilterIds ?? []);
  const [calendarFilter, setCalendarFilter] = useState<string>(rememberedPreferences.calendarFilter ?? 'all');
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [newBookingOpen, setNewBookingOpen] = useState(false);
  const [realtimeConnected, setRealtimeConnected] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkGuestMessageOpen, setBulkGuestMessageOpen] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [addTagOpen, setAddTagOpen] = useState(false);
  const [venueTags, setVenueTags] = useState<string[]>([]);
  const [venueTagsLoaded, setVenueTagsLoaded] = useState(false);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [guestHistoryRevisionById, setGuestHistoryRevisionById] = useState<Record<string, number>>({});
  const [relatedGuestHistoryBooking, setRelatedGuestHistoryBooking] = useState<{
    bookingId: string;
    snapshot: BookingDetailPanelSnapshot;
    isAppointment: boolean;
  } | null>(null);
  const [detailById, setDetailById] = useState<Record<string, BookingDetailLite>>({});
  const [detailLoadingIds, setDetailLoadingIds] = useState<string[]>([]);
  const [messageDraftById, setMessageDraftById] = useState<Record<string, string>>({});
  const [sendingMessageIds, setSendingMessageIds] = useState<string[]>([]);
  const [tableManagementEnabled, setTableManagementEnabled] = useState(false);
  const [coversActiveTables, setCoversActiveTables] = useState<TableForSelector[]>([]);
  const [noShowGraceMinutes, setNoShowGraceMinutes] = useState(15);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel: string; onConfirm: () => void } | null>(null);
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const [changeTableBooking, setChangeTableBooking] = useState<BookingRow | null>(null);
  const [changeTableDayData, setChangeTableDayData] = useState<DaySheetForTableChange | null>(null);
  const [changeTableDayLoading, setChangeTableDayLoading] = useState(false);
  const [changeTableSelectedIds, setChangeTableSelectedIds] = useState<string[]>([]);
  const [changeTableSaving, setChangeTableSaving] = useState(false);
  const [openingHours, setOpeningHours] = useState<OpeningHours | null>(null);
  const [venueTimezone, setVenueTimezone] = useState<string>('Europe/London');
  const [startHourOverride, setStartHourOverride] = useState<number | null>(rememberedPreferences.startHourOverride ?? null);
  const [endHourOverride, setEndHourOverride] = useState<number | null>(rememberedPreferences.endHourOverride ?? null);
  const [timeRangeFilterActive, setTimeRangeFilterActive] = useState(rememberedPreferences.timeRangeFilterActive ?? false);

  const { from, to } = useMemo(() => {
    if (viewMode === 'day') return { from: anchorDate, to: anchorDate };
    if (viewMode === 'week') return { from: anchorDate, to: addDays(anchorDate, 6) };
    if (viewMode === 'month') return { from: startOfMonth(anchorDate), to: endOfMonth(anchorDate) };
    return { from: customFrom, to: customTo };
  }, [viewMode, anchorDate, customFrom, customTo]);
  const invalidCustomRange = viewMode === 'custom' && customFrom > customTo;

  const { startHour: derivedStartHour, endHour: derivedEndHour } = useMemo(
    () =>
      getCalendarGridBounds(anchorDate, openingHours ?? undefined, 7, 21, {
        timeZone: venueTimezone,
      }),
    [anchorDate, openingHours, venueTimezone],
  );
  const pickerStartHour = startHourOverride ?? derivedStartHour;
  const pickerEndHour = endHourOverride ?? derivedEndHour;

  const anchorDateHydrated = useRef(false);
  useEffect(() => {
    if (!anchorDateHydrated.current) {
      anchorDateHydrated.current = true;
      return;
    }
    setStartHourOverride(null);
    setEndHourOverride(null);
    setTimeRangeFilterActive(false);
  }, [anchorDate]);

  useEffect(() => {
    if (viewMode !== 'day') {
      setStartHourOverride(null);
      setEndHourOverride(null);
      setTimeRangeFilterActive(false);
    }
  }, [viewMode]);

  const isRestaurantTablePrimary = primaryBookingModel === 'table_reservation';
  const showModelFilters = !isRestaurantTablePrimary && enabledModels.length > 0;
  const filterModels = useMemo(() => {
    const uniq = new Set<BookingModel>([primaryBookingModel, ...enabledModels]);
    return [...uniq].sort((a, b) => BOOKING_MODEL_ORDER.indexOf(a) - BOOKING_MODEL_ORDER.indexOf(b));
  }, [primaryBookingModel, enabledModels]);

  const filterGuestId = useMemo(() => {
    const g = searchParams.get('guest');
    return g && GUEST_UUID_RE.test(g) ? g : null;
  }, [searchParams]);

  const filterAreaId = useMemo(() => {
    const a = searchParams.get('area');
    return a && GUEST_UUID_RE.test(a) ? a : null;
  }, [searchParams]);

  /**
   * Calendar deep-link: `?experience_event_id=`/`?class_instance_id=`/`?resource_id=`.
   * The calendar event/class/resource sheets link here; the list is scoped to that
   * entity server-side (no date range needed) — review §5.5 F12.
   */
  const cdeDeepLink = useMemo<CdeDeepLinkFilter | null>(
    () => readCdeDeepLinkFilter((key) => searchParams.get(key)),
    [searchParams],
  );

  const clearGuestFilter = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete('guest');
    const qs = next.toString();
    router.replace(qs ? `/dashboard/bookings?${qs}` : '/dashboard/bookings', { scroll: false });
  }, [router, searchParams]);

  const clearCdeDeepLink = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete('experience_event_id');
    next.delete('class_instance_id');
    next.delete('resource_id');
    const qs = next.toString();
    router.replace(qs ? `/dashboard/bookings?${qs}` : '/dashboard/bookings', { scroll: false });
  }, [router, searchParams]);

  const [diningAreas, setDiningAreas] = useState<Array<{ id: string; name: string; colour: string; is_active: boolean }>>([]);
  const [diningServices, setDiningServices] = useState<DiningService[]>([]);
  const [bookingCalendars, setBookingCalendars] = useState<BookingCalendarFilterOption[]>([]);
  useEffect(() => {
    if (primaryBookingModel !== 'table_reservation') return;
    let cancelled = false;
    void Promise.all([
      fetch('/api/venue/areas').then((res) => (res.ok ? res.json() : null)),
      fetch('/api/venue/services').then((res) => (res.ok ? res.json() : null)),
      enabledModels.length > 0
        ? fetch('/api/venue/practitioners?active_only=1').then((res) => (res.ok ? res.json() : null))
        : Promise.resolve(null),
    ])
      .then(([areasJson, servicesJson, calendarsJson]) => {
        if (cancelled) return;
        if (areasJson?.areas) setDiningAreas(areasJson.areas as typeof diningAreas);
        if (servicesJson?.services) setDiningServices(servicesJson.services as DiningService[]);
        if (calendarsJson?.practitioners) {
          setBookingCalendars(calendarsJson.practitioners as BookingCalendarFilterOption[]);
        }
      })
      .catch((e) => console.error('[BookingsDashboard] table filter preload failed:', e));
    return () => {
      cancelled = true;
    };
  }, [enabledModels.length, primaryBookingModel]);

  const showAreaBookingsChrome = primaryBookingModel === 'table_reservation' && diningAreas.filter((a) => a.is_active).length > 1;
  const activeDiningServices = useMemo(
    () => diningServices.filter((service) => service.is_active),
    [diningServices],
  );
  const activeAreaNameById = useMemo(
    () => new Map(diningAreas.filter((area) => area.is_active).map((area) => [area.id, area.name])),
    [diningAreas],
  );
  const activeDiningServiceOptions = useMemo<DiningServiceFilterOption[]>(() => {
    const showArea = activeAreaNameById.size > 1;
    return activeDiningServices.map((service) => {
      const areaName = service.area_id ? activeAreaNameById.get(service.area_id) : null;
      return {
        ...service,
        label: showArea && areaName ? `${service.name} (${areaName})` : service.name,
      };
    });
  }, [activeAreaNameById, activeDiningServices]);
  const activeBookingCalendars = useMemo(
    () => bookingCalendars.filter((calendar) => calendar.is_active !== false),
    [bookingCalendars],
  );
  const showServiceBookingsChrome = primaryBookingModel === 'table_reservation' && activeDiningServices.length > 1;
  const showCalendarBookingsChrome =
    primaryBookingModel === 'table_reservation' && enabledModels.length > 0 && activeBookingCalendars.length > 0;

  const setAreaFilter = useCallback(
    (value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (!value) next.delete('area');
      else next.set('area', value);
      writeSessionPreference<BookingsDashboardPreferences>(preferencesKey, {
        ...rememberedPreferences,
        areaId: value || null,
      });
      try {
        window.localStorage.setItem(`bookingsArea:${venueId}`, value || '');
      } catch {
        /* ignore */
      }
      const qs = next.toString();
      router.replace(qs ? `/dashboard/bookings?${qs}` : '/dashboard/bookings', { scroll: false });
    },
    [preferencesKey, rememberedPreferences, router, searchParams, venueId],
  );

  const areaHydrated = useRef(false);
  useEffect(() => {
    if (!showAreaBookingsChrome || areaHydrated.current) return;
    const fromUrl = searchParams.get('area');
    if (fromUrl && GUEST_UUID_RE.test(fromUrl)) {
      areaHydrated.current = true;
      return;
    }
    try {
      const rememberedAreaId = rememberedPreferences.areaId;
      const saved = window.localStorage.getItem(`bookingsArea:${venueId}`);
      const areaId = rememberedAreaId && GUEST_UUID_RE.test(rememberedAreaId)
        ? rememberedAreaId
        : saved && GUEST_UUID_RE.test(saved)
          ? saved
          : null;
      if (areaId) {
        const next = new URLSearchParams(searchParams.toString());
        next.set('area', areaId);
        router.replace(`/dashboard/bookings?${next}`, { scroll: false });
      }
    } catch {
      /* ignore */
    }
    areaHydrated.current = true;
  }, [rememberedPreferences.areaId, router, searchParams, showAreaBookingsChrome, venueId]);

  useEffect(() => {
    writeSessionPreference<BookingsDashboardPreferences>(preferencesKey, {
      viewMode,
      anchorDate,
      customFrom,
      customTo,
      statusFilter,
      modelFilter,
      serviceFilterIds,
      calendarFilter,
      areaId: filterAreaId,
      startHourOverride,
      endHourOverride,
      timeRangeFilterActive,
    });
  }, [
    preferencesKey,
    viewMode,
    anchorDate,
    customFrom,
    customTo,
    statusFilter,
    modelFilter,
    serviceFilterIds,
    calendarFilter,
    filterAreaId,
    startHourOverride,
    endHourOverride,
    timeRangeFilterActive,
  ]);

  useEffect(() => {
    if (serviceFilterIds.length === 0) return;
    const activeIds = new Set(activeDiningServices.map((service) => service.id));
    const next = serviceFilterIds.filter((id) => activeIds.has(id));
    if (next.length !== serviceFilterIds.length) setServiceFilterIds(next);
  }, [activeDiningServices, serviceFilterIds]);

  useEffect(() => {
    if (calendarFilter === 'all') return;
    if (activeBookingCalendars.some((calendar) => calendar.id === calendarFilter)) return;
    setCalendarFilter('all');
  }, [activeBookingCalendars, calendarFilter]);

  useEffect(() => {
    if (filterModels.length > 1) return;
    if (modelFilter === 'all') return;
    setModelFilter('all');
  }, [filterModels.length, modelFilter]);

  useEffect(() => {
    if (venueBootstrap) {
      if (venueBootstrap.openingHours) setOpeningHours(venueBootstrap.openingHours);
      setVenueTimezone(venueBootstrap.timezone);
      setNoShowGraceMinutes(venueBootstrap.noShowGraceMinutes);
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
      .catch((e) => console.error('[BookingsDashboard] /api/venue preload failed:', e));
    return () => {
      cancelled = true;
    };
  }, [venueBootstrap]);

  const fetchModeData = useCallback(async () => {
    try {
      const res = await fetch('/api/venue/tables');
      if (!res.ok) return;
      const data = await res.json();
      setTableManagementEnabled(Boolean(data.settings?.table_management_enabled));
      setNoShowGraceMinutes(data.settings?.no_show_grace_minutes ?? 15);
      const rawTables = (data.tables ?? []) as Array<{
        id: string;
        name: string;
        max_covers: number;
        sort_order: number;
        is_active: boolean;
      }>;
      setCoversActiveTables(
        rawTables
          .filter((t) => t.is_active)
          .map((t) => ({
            id: t.id,
            name: t.name,
            max_covers: t.max_covers,
            sort_order: t.sort_order ?? 0,
          })),
      );
    } catch {
      setTableManagementEnabled(false);
      setCoversActiveTables([]);
    }
  }, []);

  const coversChangeTableEnabled = !tableManagementEnabled && coversActiveTables.length > 0;

  const openChangeTableModal = useCallback(async (booking: BookingRow) => {
    setChangeTableBooking(booking);
    setChangeTableSelectedIds((booking.table_assignments ?? []).map((t) => t.id));
    setChangeTableDayData(null);
    setChangeTableDayLoading(true);
    try {
      const dsQs = new URLSearchParams({ date: booking.booking_date });
      if (filterAreaId) dsQs.set('area', filterAreaId);
      const res = await fetch(`/api/venue/day-sheet?${dsQs}`);
      if (res.ok) {
        const json = (await res.json()) as DaySheetForTableChange;
        setChangeTableDayData(json);
      }
    } catch {
      setChangeTableDayData(null);
    } finally {
      setChangeTableDayLoading(false);
    }
  }, [filterAreaId]);

  const closeChangeTableModal = useCallback(() => {
    setChangeTableBooking(null);
    setChangeTableDayData(null);
    setChangeTableSelectedIds([]);
    setChangeTableDayLoading(false);
    setChangeTableSaving(false);
  }, []);

  const changeTableSelectorTables = useMemo(() => {
    const fromDay = changeTableDayData?.active_tables;
    if (fromDay && fromDay.length > 0) return fromDay;
    return coversActiveTables;
  }, [changeTableDayData, coversActiveTables]);

  const changeTableOccupancyMap = useMemo(() => {
    if (!changeTableBooking || !changeTableDayData) return {};
    return buildCoversOccupancyMap(changeTableDayData, changeTableBooking.id);
  }, [changeTableBooking, changeTableDayData]);

  const fetchBookings = useCallback(async (options?: FetchBookingsOptions) => {
    const silent = options?.silent ?? false;
    const ids = options?.ids;
    // A CDE deep-link ignores the date range, so its (in)validity is irrelevant there.
    if (invalidCustomRange && !cdeDeepLink) {
      setError('Custom date range is invalid. "From" must be before or equal to "To".');
      setLoading(false);
      return;
    }

    if (silent) setIsRefreshing(true);
    else setLoading(true);

    if (!silent) setError(null);
    try {
      // `ids` is a targeted single-row refresh and always wins; otherwise, a CDE
      // deep-link scopes to one session/event/resource (no date range or other
      // dashboard filters) and falls back to the normal date-range query.
      const useDeepLink = (!ids || ids.length === 0) && cdeDeepLink != null;
      const params = ids && ids.length > 0
        ? new URLSearchParams({ ids: ids.join(',') })
        : useDeepLink
          ? new URLSearchParams({ [cdeDeepLink!.param]: cdeDeepLink!.id })
          : (viewMode === 'day' ? new URLSearchParams({ date: from }) : new URLSearchParams({ from, to }));
      if (!ids && !useDeepLink && statusFilter !== 'All') {
        const opt = STATUS_FILTER_OPTIONS.find((o) => o.label === statusFilter);
        if (opt?.attendanceConfirmed) params.set('attendance_confirmed', '1');
        else if (opt?.apiStatus) params.set('status', opt.apiStatus);
      }
      if (!ids && filterGuestId) params.set('guest', filterGuestId);
      if (!ids && !useDeepLink && filterAreaId) params.set('area', filterAreaId);
      if (!ids && !useDeepLink && serviceFilterIds.length > 0) params.set('service', serviceFilterIds.join(','));
      if (!ids && !useDeepLink && calendarFilter !== 'all') params.set('calendar', calendarFilter);
      const res = await fetch(`/api/venue/bookings/list?${params}`);
      const data = await readResponseJson<{ error?: string; bookings?: BookingRow[] }>(res);
      if (!res.ok) {
        setError(data.error ?? 'Failed to load reservations');
        return;
      }
      const opt = STATUS_FILTER_OPTIONS.find((o) => o.label === statusFilter);
      const loaded: BookingRow[] = data.bookings ?? [];
      const next = !ids && !useDeepLink && opt?.excludeAttendanceConfirmed
        ? loaded.filter((booking) => !isAttendanceConfirmed(booking))
        : loaded;
      setBookings((prev) => {
        if (!ids || ids.length === 0) {
          primeGroupVisitBookingsFromListSeeds(next);
          return next;
        }
        const map = new Map(prev.map((b) => [b.id, b]));
        for (const row of next) map.set(row.id, row);
        const merged = Array.from(map.values())
          .filter((b) => !ids.includes(b.id) || next.some((n) => n.id === b.id))
          .sort((a, b) => `${a.booking_date}${a.booking_time}`.localeCompare(`${b.booking_date}${b.booking_time}`));
        primeGroupVisitBookingsFromListSeeds(merged);
        return merged;
      });
      setSelectedIds((prev) => prev.filter((id) => next.some((b: BookingRow) => b.id === id) || !ids));
    } catch {
      setError('Network error loading reservations');
    } finally {
      if (silent) setIsRefreshing(false);
      else setLoading(false);
    }
  }, [calendarFilter, cdeDeepLink, filterAreaId, filterGuestId, from, invalidCustomRange, serviceFilterIds, statusFilter, to, viewMode]);

  const changeTableSaveLock = useRef(false);

  const confirmChangeTableAssignment = useCallback(async (ids: string[]) => {
    if (!changeTableBooking || changeTableSaveLock.current) return;
    changeTableSaveLock.current = true;
    const bookingId = changeTableBooking.id;
    const oldIds = (changeTableBooking.table_assignments ?? []).map((t) => t.id);
    setChangeTableSaving(true);
    try {
      const res = oldIds.length > 0
        ? await fetch('/api/venue/tables/assignments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'reassign',
              booking_id: bookingId,
              old_table_ids: oldIds,
              new_table_ids: ids,
            }),
          })
        : await fetch('/api/venue/tables/assignments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ booking_id: bookingId, table_ids: ids }),
          });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError((j as { error?: string }).error ?? 'Failed to update table assignment.');
        return;
      }
      addToast('Table assignment updated', 'success');
      closeChangeTableModal();
      void fetchBookings({ silent: true, ids: [bookingId] });
    } catch {
      setError('Failed to update table assignment.');
    } finally {
      changeTableSaveLock.current = false;
      setChangeTableSaving(false);
    }
  }, [addToast, changeTableBooking, closeChangeTableModal, fetchBookings]);

  useEffect(() => {
    void fetchModeData();
  }, [fetchModeData]);
  useEffect(() => { void fetchBookings(); }, [fetchBookings]);

  const debouncedSilentFetchBookings = useDebouncedCallback(() => {
    void fetchBookings({ silent: true });
  }, REALTIME_BOOKINGS_DEBOUNCE_MS);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('bookings')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `venue_id=eq.${venueId}` },
        () => {
          debouncedSilentFetchBookings();
        },
      )
      .subscribe((status) => { setRealtimeConnected(status === 'SUBSCRIBED'); });
    return () => { void supabase.removeChannel(channel); };
  }, [venueId, debouncedSilentFetchBookings]);

  const loadBookingDetail = useCallback(
    async (bookingId: string, force = false) => {
      if (!force && detailById[bookingId]) return;

      const cachedRaw = !force ? peekVenueBookingDetail(bookingId) : undefined;
      const fromCache =
        cachedRaw &&
        typeof cachedRaw === 'object' &&
        typeof (cachedRaw as unknown as BookingDetailLite).id === 'string' &&
        (cachedRaw as unknown as BookingDetailLite).id === bookingId
          ? (cachedRaw as unknown as BookingDetailLite)
          : undefined;

      if (fromCache && !detailById[bookingId]) {
        setDetailById((prev) => ({ ...prev, [bookingId]: fromCache }));
      }

      const blockingSpinner = force || !fromCache;
      if (detailLoadingIds.includes(bookingId)) return;
      if (blockingSpinner) {
        setDetailLoadingIds((prev) => [...prev, bookingId]);
      }
      try {
        const res = await fetch(`/api/venue/bookings/${bookingId}`);
        if (!res.ok) return;
        const data = (await res.json()) as BookingDetailLite;
        primeVenueBookingDetail(bookingId, data as unknown as VenueBookingDetailPayload);
        setDetailById((prev) => ({ ...prev, [bookingId]: data }));
        setGuestHistoryRevisionById((prev) => ({
          ...prev,
          [bookingId]: (prev[bookingId] ?? 0) + 1,
        }));
      } finally {
        if (blockingSpinner) {
          setDetailLoadingIds((prev) => prev.filter((id) => id !== bookingId));
        }
      }
    },
    [detailById, detailLoadingIds, peekVenueBookingDetail, primeVenueBookingDetail],
  );

  const prefetchBookingDetail = useCallback(
    (bookingId: string) => {
      void (async () => {
        const row = bookings.find((b) => b.id === bookingId);
        if (row?.group_booking_id) warmGroupVisitBookings(row.group_booking_id);
        await warmVenueBookingDetail(bookingId);
        const lite = bookingDetailLiteFromCachePayload(bookingId, peekVenueBookingDetail(bookingId));
        if (!lite) return;
        setDetailById((prev) => (prev[bookingId] ? prev : { ...prev, [bookingId]: lite }));
      })();
    },
    [bookings, peekVenueBookingDetail, warmVenueBookingDetail],
  );

  const toggleExpand = useCallback(
    (bookingId: string) => {
      setExpandedIds((prev) => {
        if (prev.includes(bookingId)) return [];
        return [bookingId];
      });
      const row = bookings.find((b) => b.id === bookingId);
      const fromCache = bookingDetailLiteFromCachePayload(bookingId, peekVenueBookingDetail(bookingId));
      const fromRow = row ? bookingDetailLiteFromListRow(row) : undefined;
      const seed = fromCache ?? fromRow;
      if (seed) {
        setDetailById((prev) => (prev[bookingId] ? prev : { ...prev, [bookingId]: seed }));
      }
      void loadBookingDetail(bookingId);
    },
    [bookings, loadBookingDetail, peekVenueBookingDetail],
  );

  useEffect(() => {
    const ob = searchParams.get('openBooking');
    if (ob && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ob)) {
      setExpandedIds((prev) => (prev.includes(ob) ? prev : [ob]));
      void loadBookingDetail(ob);
      const next = new URLSearchParams(searchParams.toString());
      next.delete('openBooking');
      const qs = next.toString();
      router.replace(qs ? `/dashboard/bookings?${qs}` : '/dashboard/bookings', { scroll: false });
    }
  }, [loadBookingDetail, searchParams, router]);

  const handleWalkInCreated = useCallback(() => {
    setWalkInOpen(false);
    void fetchBookings({ silent: true });
  }, [fetchBookings]);

  const handleNewBookingCreated = useCallback(() => {
    setNewBookingOpen(false);
    void fetchBookings({ silent: true });
  }, [fetchBookings]);

  const handleDetailUpdated = useCallback(
    (bookingId: string) => {
      invalidateVenueBookingDetail(bookingId);
      setDetailById((prev) => {
        const next = { ...prev };
        delete next[bookingId];
        return next;
      });
      void loadBookingDetail(bookingId, true);
      void fetchBookings({ silent: true, ids: [bookingId] });
    },
    [invalidateVenueBookingDetail, loadBookingDetail, fetchBookings],
  );

  const updateBookingStatus = useCallback(async (bookingId: string, newStatus: BookingStatus) => {
    const previous = bookings.find((b) => b.id === bookingId)?.status;
    if (!previous || previous === newStatus || !canTransitionBookingStatus(previous, newStatus)) return;
    setBookings((prev) =>
      applyOptimisticStatusToBookingRows(prev, bookingId, newStatus, isTableReservationBooking),
    );
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        throw new Error('Failed to update booking status');
      }
      const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (payload && typeof payload === 'object' && !('error' in payload)) {
        const groupId = bookings.find((row) => row.id === bookingId)?.group_booking_id;
        const patchOverlay = overlayFromPatchPayload(payload);
        setBookings((prev) =>
          prev.map((row) => {
            const inGroup = Boolean(groupId && row.group_booking_id === groupId);
            if (row.id !== bookingId && !inGroup) return row;
            return applyBookingRowOverlayFields(row, patchOverlay);
          }),
        );
      }
      const row = bookings.find((x) => x.id === bookingId);
      const displayNew = bookingStatusDisplayLabel(newStatus, row ? isTableReservationBooking(row) : true);
      setUndoAction({
        id: crypto.randomUUID(),
        type: 'change_status',
        description: `Status changed to ${displayNew}`,
        timestamp: Date.now(),
        previous_state: { bookingId, status: previous },
        current_state: { bookingId, status: newStatus },
      });
      addToast('Booking status updated', 'success');
      if (newStatus === 'Cancelled') {
        scheduleWaitlistAlertsRefresh();
      }
    } catch {
      void fetchBookings({ silent: true });
      setError(`Could not update booking status for ${bookingId.slice(0, 8).toUpperCase()}.`);
    }
  }, [bookings, fetchBookings, addToast]);

  const sendMessageToBooking = useCallback(
    async (bookingId: string, message: string, channel: GuestMessageChannel = 'both'): Promise<GuestMessageSendResult> => {
      const trimmedMessage = message.trim();
      if (trimmedMessage.length === 0) {
        return { ok: false, error: 'Message cannot be empty.' };
      }
      setSendingMessageIds((prev) => [...prev, bookingId]);
      try {
        const res = await fetch(`/api/venue/bookings/${bookingId}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: trimmedMessage, channel }),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
          errors?: string[];
        };
        if (!res.ok || !payload.success) {
          const detail =
            (payload.errors && payload.errors.length > 0
              ? payload.errors.join('; ')
              : payload.error) ?? 'Failed to send message.';
          setError(detail);
          addToast(detail, 'error');
          return { ok: false, error: detail };
        }
        if (payload.errors && payload.errors.length > 0) {
          const w = payload.errors.join('; ');
          addToast(`Sent with issues \u2014 ${w}`, 'error');
          setMessageDraftById((prev) => ({ ...prev, [bookingId]: '' }));
          invalidateVenueBookingDetail(bookingId);
          setDetailById((prev) => {
            const next = { ...prev };
            delete next[bookingId];
            return next;
          });
          void loadBookingDetail(bookingId, true);
          return { ok: true, warning: `Sent with issues: ${w}` };
        }
        addToast('Message sent', 'success');
        setMessageDraftById((prev) => ({ ...prev, [bookingId]: '' }));
        invalidateVenueBookingDetail(bookingId);
        setDetailById((prev) => {
          const next = { ...prev };
          delete next[bookingId];
          return next;
        });
        void loadBookingDetail(bookingId, true);
        return { ok: true };
      } catch {
        const msg = 'Failed to send message.';
        setError(msg);
        addToast(msg, 'error');
        return { ok: false, error: msg };
      } finally {
        setSendingMessageIds((prev) => prev.filter((id) => id !== bookingId));
      }
    },
    [addToast, invalidateVenueBookingDetail, loadBookingDetail],
  );

  const executeBulkNoShow = useCallback(async () => {
    const previousMap = new Map(bookings.map((b) => [b.id, b.status]));
    setBulkLoading(true);
    setError(null);
    setBookings((prev) => prev.map((booking) => selectedIds.includes(booking.id) ? { ...booking, status: 'No-Show' } : booking));
    try {
      const outcomes = await Promise.all(selectedIds.map(async (bookingId) => {
        const res = await fetch(`/api/venue/bookings/${bookingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'No-Show' }),
        });
        return res.ok;
      }));
      const okCount = outcomes.filter(Boolean).length;
      if (okCount !== selectedIds.length) {
        setError(`Updated ${okCount}/${selectedIds.length} bookings as no-show.`);
        setBookings((prev) => prev.map((booking) => ({
          ...booking,
          status: outcomes[selectedIds.indexOf(booking.id)] ? booking.status : (previousMap.get(booking.id) ?? booking.status),
        })));
      }
      if (okCount > 0) {
        setUndoAction({
          id: crypto.randomUUID(),
          type: 'change_status',
          description: `${okCount} booking(s) marked no-show`,
          timestamp: Date.now(),
          previous_state: {
            items: selectedIds
              .filter((bookingId, index) => outcomes[index])
              .map((bookingId) => ({ bookingId, status: previousMap.get(bookingId) ?? 'Booked' })),
          },
          current_state: { status: 'No-Show' },
        });
      }
      setSelectedIds([]);
      void fetchBookings({ silent: true });
    } finally {
      setBulkLoading(false);
    }
  }, [bookings, fetchBookings, selectedIds]);

  const runBulkNoShow = useCallback(() => {
    if (selectedIds.length === 0) return;
    const affected = bookings.filter((b) => selectedIds.includes(b.id));
    const preview = affected.slice(0, 3).map((b) => `${b.guest_name} at ${b.booking_time.slice(0, 5)}`).join(', ');
    const suffix = affected.length > 3 ? ` and ${affected.length - 3} more` : '';
    setConfirmDialog({
      title: 'Bulk No-Show',
      message: `Mark ${selectedIds.length} booking(s) as no-show? ${preview}${suffix}`,
      confirmLabel: `Mark ${selectedIds.length} No-Show`,
      onConfirm: () => { void executeBulkNoShow(); },
    });
  }, [bookings, selectedIds, executeBulkNoShow]);

  const undoLastStatusChange = useCallback(async () => {
    if (!undoAction || undoAction.type !== 'change_status') return;
    setUndoAction(null);
    const items = undoAction.previous_state.items as Array<{ bookingId: string; status: BookingStatus }> | undefined;
    if (items && items.length > 0) {
      await Promise.all(items.map((item) => updateBookingStatus(item.bookingId, item.status)));
      return;
    }
    const bookingId = String(undoAction.previous_state.bookingId ?? '');
    const previousStatus = String(undoAction.previous_state.status ?? '') as BookingStatus;
    if (!bookingId || !previousStatus) return;
    await updateBookingStatus(bookingId, previousStatus);
  }, [undoAction, updateBookingStatus]);

  const requestStatusChange = useCallback((booking: BookingRow, nextStatus: BookingStatus) => {
    if (!canTransitionBookingStatus(booking.status, nextStatus)) return;
    if (nextStatus === 'No-Show' && !canMarkNoShowForSlot(booking.booking_date, booking.booking_time, noShowGraceMinutes, venueTimezone)) {
      setError(`No-show can only be marked ${noShowGraceMinutes} minutes after the booking start time.`);
      return;
    }
    const tableStyle = isTableReservationBooking(booking);
    const partyLabel = `${booking.party_size} ${
      tableStyle ? `cover${booking.party_size === 1 ? '' : 's'}` : `person${booking.party_size === 1 ? '' : 's'}`
    }`;
    if (isRevertTransition(booking.status, nextStatus)) {
      if (isBookingInstantRevertTransition(booking.status, nextStatus, tableStyle)) {
        void updateBookingStatus(booking.id, nextStatus);
        return;
      }
      const revertAction = BOOKING_REVERT_ACTIONS[booking.status as BookingStatus];
      const confirmLabel =
        booking.status === 'Seated' && (nextStatus === 'Booked' || nextStatus === 'Confirmed') && !tableStyle
          ? 'Undo Start'
          : revertAction?.label ?? `Revert to ${nextStatus}`;
      setConfirmDialog({
        title: confirmLabel,
        message: `${booking.guest_name} (${partyLabel}) at ${booking.booking_time.slice(0, 5)} will be changed from ${booking.status} back to ${nextStatus}.`,
        confirmLabel,
        onConfirm: () => { void updateBookingStatus(booking.id, nextStatus); },
      });
      return;
    }
    if (isDestructiveBookingStatus(nextStatus)) {
      setConfirmDialog({
        title: `Mark ${nextStatus}`,
        message: `${booking.guest_name} (${partyLabel}) at ${booking.booking_time.slice(0, 5)} will be marked ${nextStatus}.`,
        confirmLabel: `Mark ${nextStatus}`,
        onConfirm: () => { void updateBookingStatus(booking.id, nextStatus); },
      });
      return;
    }
    void updateBookingStatus(booking.id, nextStatus);
  }, [updateBookingStatus, noShowGraceMinutes, venueTimezone]);

  const runBulkMessage = useCallback(async (message: string, channel: GuestMessageChannel) => {
    if (selectedIds.length === 0) return;
    setBulkLoading(true);
    setError(null);
    try {
      const outcomes = await Promise.all(selectedIds.map(async (bookingId) => {
        try {
          const res = await fetch(`/api/venue/bookings/${bookingId}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, channel }),
          });
          const payload = (await res.json().catch(() => ({}))) as {
            success?: boolean;
            error?: string;
            errors?: string[];
          };
          const sent = Boolean(res.ok && payload.success);
          const issues =
            payload.errors && payload.errors.length > 0
              ? payload.errors.join('; ')
              : payload.error ?? null;
          return { sent, issues };
        } catch {
          return { sent: false, issues: 'Request failed' };
        }
      }));
      const okCount = outcomes.filter((o) => o.sent).length;
      const failureSummaries = outcomes
        .map((o, idx) => (!o.sent && o.issues ? `Booking ${idx + 1}: ${o.issues}` : null))
        .filter((entry): entry is string => entry !== null);
      if (okCount === selectedIds.length) {
        addToast(`Message sent to ${okCount} booking(s)`, 'success');
      } else if (okCount > 0) {
        setError(
          `Sent to ${okCount}/${selectedIds.length}. ${failureSummaries.slice(0, 3).join(' · ')}`,
        );
        addToast(`Sent to ${okCount}/${selectedIds.length}`, 'error');
      } else {
        const first = failureSummaries[0] ?? 'No messages were sent.';
        setError(first);
        addToast(first, 'error');
      }
      setSelectedIds([]);
      setBulkGuestMessageOpen(false);
    } finally {
      setBulkLoading(false);
    }
  }, [addToast, selectedIds]);

  // Open the tag modal and lazily load existing venue tags for the suggestions.
  const openAddTag = useCallback(() => {
    setAddTagOpen(true);
    if (venueTagsLoaded) return;
    setVenueTagsLoaded(true);
    void fetch('/api/venue/guests/tags')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { tags?: string[] } | null) => {
        if (d?.tags && Array.isArray(d.tags)) setVenueTags(d.tags);
      })
      .catch(() => {});
  }, [venueTagsLoaded]);

  // Tags live on the contact, so map the selected bookings to their unique guest
  // ids and reuse the contacts bulk endpoint (mirrors the Contacts page action).
  const runBulkAddTag = useCallback(
    async (tag: string) => {
      const trimmed = tag.trim();
      if (!trimmed || selectedIds.length === 0) return;
      const byId = new Map<string, BookingRow>();
      for (const b of bookings) byId.set(b.id, b);
      const guestIds = [
        ...new Set(
          selectedIds
            .map((id) => byId.get(id))
            .filter((b): b is BookingRow => !!b && !!b.guest_id)
            .map((b) => b.guest_id as string),
        ),
      ];
      if (guestIds.length === 0) {
        addToast('Selected bookings have no contact record to tag.', 'error');
        setAddTagOpen(false);
        return;
      }
      setBulkLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/venue/contacts/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'add_tag', guest_ids: guestIds, tag: trimmed }),
        });
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Could not add tag');
        addToast(`Tag added to ${guestIds.length} ${guestIds.length === 1 ? 'guest' : 'guests'}`, 'success');
        setVenueTags((prev) => (prev.some((t) => t.toLowerCase() === trimmed.toLowerCase()) ? prev : [...prev, trimmed]));
        setSelectedIds([]);
        setAddTagOpen(false);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Could not add tag';
        setError(msg);
        addToast(msg, 'error');
      } finally {
        setBulkLoading(false);
      }
    },
    [selectedIds, bookings, addToast],
  );

  /** Selected rows that can still transition to Cancelled (for bulk cancel). */
  const bulkCancelEligibleIds = useMemo(() => {
    return selectedIds.filter((id) => {
      const b = bookings.find((x) => x.id === id);
      return b != null && canTransitionBookingStatus(b.status, 'Cancelled');
    });
  }, [bookings, selectedIds]);

  /** Selected rows that are already cancelled (for bulk permanent delete). */
  const bulkDeleteEligibleIds = useMemo(() => {
    return selectedIds.filter((id) => bookings.find((x) => x.id === id)?.status === 'Cancelled');
  }, [bookings, selectedIds]);

  const executeBulkCancel = useCallback(async () => {
    const ids = [...bulkCancelEligibleIds];
    if (ids.length === 0) return;
    const previousMap = new Map(bookings.map((b) => [b.id, b.status]));
    setBulkLoading(true);
    setError(null);
    setBookings((prev) => prev.map((b) => (ids.includes(b.id) ? { ...b, status: 'Cancelled' } : b)));
    try {
      const outcomes = await Promise.all(
        ids.map(async (bookingId) => {
          const res = await fetch(`/api/venue/bookings/${bookingId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'Cancelled' }),
          });
          return res.ok;
        }),
      );
      const okCount = outcomes.filter(Boolean).length;
      if (okCount !== ids.length) {
        setError(`Cancelled ${okCount}/${ids.length} bookings.`);
        setBookings((prev) =>
          prev.map((booking) => {
            const idx = ids.indexOf(booking.id);
            if (idx === -1) return booking;
            return outcomes[idx] ? booking : { ...booking, status: previousMap.get(booking.id) ?? booking.status };
          }),
        );
      } else {
        addToast(`${okCount} booking(s) cancelled`, 'success');
        scheduleWaitlistAlertsRefresh();
      }
      setSelectedIds([]);
      void fetchBookings({ silent: true });
    } finally {
      setBulkLoading(false);
    }
  }, [addToast, bookings, bulkCancelEligibleIds, fetchBookings]);

  const runBulkCancel = useCallback(() => {
    if (bulkCancelEligibleIds.length === 0) return;
    const affected = bookings.filter((b) => bulkCancelEligibleIds.includes(b.id));
    const preview = affected.slice(0, 3).map((b) => `${b.guest_name} at ${b.booking_time.slice(0, 5)}`).join(', ');
    const suffix = affected.length > 3 ? ` and ${affected.length - 3} more` : '';
    const skipped = selectedIds.length - bulkCancelEligibleIds.length;
    const skipNote =
      skipped > 0
        ? ` (${skipped} selected ${skipped === 1 ? 'booking cannot' : 'bookings cannot'} be cancelled \u2014 only active bookings will be updated).`
        : '';
    setConfirmDialog({
      title: 'Cancel bookings',
      message: `Cancel ${bulkCancelEligibleIds.length} booking(s)? ${preview}${suffix}.${skipNote}`,
      confirmLabel: `Cancel ${bulkCancelEligibleIds.length} booking(s)`,
      onConfirm: () => {
        void executeBulkCancel();
      },
    });
  }, [bookings, bulkCancelEligibleIds, executeBulkCancel, selectedIds.length]);

  const executeBulkDelete = useCallback(async () => {
    const ids = [...bulkDeleteEligibleIds];
    if (ids.length === 0) return;
    setBulkLoading(true);
    setError(null);
    try {
      const outcomes = await Promise.all(
        ids.map(async (bookingId) => {
          const res = await fetch(`/api/venue/bookings/${bookingId}`, { method: 'DELETE' });
          const errPayload = !res.ok
            ? ((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText
            : null;
          return { ok: res.ok, error: errPayload };
        }),
      );
      const okIds = ids.filter((_, i) => outcomes[i]?.ok);
      const okCount = okIds.length;
      if (okCount !== ids.length) {
        const firstErr = outcomes.find((o) => !o.ok)?.error;
        setError(
          firstErr
            ? `Removed ${okCount}/${ids.length}. ${firstErr}`
            : `Removed ${okCount}/${ids.length} bookings from the diary.`,
        );
      } else {
        addToast(`${okCount} booking(s) removed from the diary`, 'success');
      }
      setBookings((prev) => prev.filter((b) => !okIds.includes(b.id)));
      setDetailById((prev) => {
        const next = { ...prev };
        okIds.forEach((id) => {
          delete next[id];
        });
        return next;
      });
      setExpandedIds((prev) => prev.filter((id) => !okIds.includes(id)));
      setSelectedIds((prev) => prev.filter((id) => !okIds.includes(id)));
      void fetchBookings({ silent: true });
    } finally {
      setBulkLoading(false);
    }
  }, [addToast, bulkDeleteEligibleIds, fetchBookings]);

  const runBulkDelete = useCallback(() => {
    if (bulkDeleteEligibleIds.length === 0) return;
    const affected = bookings.filter((b) => bulkDeleteEligibleIds.includes(b.id));
    const preview = affected.slice(0, 3).map((b) => `${b.guest_name} at ${b.booking_time.slice(0, 5)}`).join(', ');
    const suffix = affected.length > 3 ? ` and ${affected.length - 3} more` : '';
    const skipped = selectedIds.length - bulkDeleteEligibleIds.length;
    const skipNote =
      skipped > 0
        ? ` (${skipped} selected ${skipped === 1 ? 'booking is' : 'bookings are'} not cancelled \u2014 only cancelled bookings will be removed).`
        : '';
    setConfirmDialog({
      title: 'Delete bookings permanently?',
      message: `Permanently remove ${bulkDeleteEligibleIds.length} cancelled booking(s) from the system? This cannot be undone. ${preview}${suffix}.${skipNote}`,
      confirmLabel: `Delete ${bulkDeleteEligibleIds.length} permanently`,
      onConfirm: () => {
        void executeBulkDelete();
      },
    });
  }, [bookings, bulkDeleteEligibleIds, executeBulkDelete, selectedIds.length]);

  const navigate = (direction: -1 | 1) => {
    if (viewMode === 'day') setAnchorDate(addDays(anchorDate, direction));
    else if (viewMode === 'week') setAnchorDate(addDays(anchorDate, direction * 7));
    else if (viewMode === 'month') {
      const d = new Date(anchorDate + 'T12:00:00');
      d.setMonth(d.getMonth() + direction);
      setAnchorDate(d.toISOString().slice(0, 10));
    }
  };

  const toggleServiceFilter = useCallback((serviceId: string) => {
    setServiceFilterIds((current) =>
      current.includes(serviceId)
        ? current.filter((id) => id !== serviceId)
        : [...current, serviceId],
    );
  }, []);

  const modelScopedBookings = useMemo(() => {
    if (modelFilter === 'all') return bookings;
    return bookings.filter((b) => inferBookingRowModel(b) === modelFilter);
  }, [bookings, modelFilter]);

  const filteredBookings = useMemo(() => {
    let list = modelScopedBookings;
    if (viewMode === 'day' && timeRangeFilterActive) {
      list = list.filter((b) => isBookingTimeInHourRange(b.booking_time, pickerStartHour, pickerEndHour));
    }
    return list;
  }, [
    modelScopedBookings,
    viewMode,
    timeRangeFilterActive,
    pickerStartHour,
    pickerEndHour,
  ]);

  const groupedByDate = useMemo(() => {
    if (viewMode === 'day') return null;
    const groups: Record<string, BookingRow[]> = {};
    for (const b of filteredBookings) {
      (groups[b.booking_date] ??= []).push(b);
    }
    return groups;
  }, [filteredBookings, viewMode]);

  // One "Select all" governs every booking on screen across all day groups
  // (week / month / custom range) instead of a separate toggle per day.
  const allFilteredSelected =
    filteredBookings.length > 0 && filteredBookings.every((b) => selectedIds.includes(b.id));

  const stats = useMemo(() => {
    const total = filteredBookings.length;
    const totalCovers = filteredBookings.reduce(
      (sum, b) => sum + (isTableReservationBooking(b) ? b.party_size : 0),
      0,
    );
    /** Active = anything not pending/cancelled/no-show. Includes Booked, Confirmed, Seated, Completed. */
    const active = filteredBookings.filter(
      (b) => b.status === 'Booked' || b.status === 'Confirmed' || b.status === 'Seated' || b.status === 'Completed',
    ).length;
    const confirmed = filteredBookings.filter(isAttendanceConfirmed).length;
    const pending = filteredBookings.filter((b) => b.status === 'Pending').length;
    return { total, totalCovers, active, confirmed, pending };
  }, [filteredBookings]);

  const bookingToolbarSummary: ViewToolbarSummary = useMemo(() => ({
    total_covers_booked: stats.totalCovers,
    total_covers_capacity: stats.totalCovers,
    tables_in_use: stats.confirmed,
    tables_total: stats.total,
    unassigned_count: stats.pending,
    combos_in_use: stats.active,
  }), [stats]);

  const bookingSummaryContent = useMemo(() => {
    const chip =
      'inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200/90 bg-slate-50 px-1.5 py-0.5 font-medium text-slate-800';
    const label = 'text-slate-500 font-normal';
    return (
      <div className="flex flex-wrap items-center gap-1 text-[11px] sm:gap-1.5 sm:text-xs" aria-label="Booking summary">
        <span className={chip}>
          <span className={label}>Bookings</span>
          <span className="tabular-nums">{stats.total}</span>
        </span>
        <span className={chip}>
          <span className={label}>Covers</span>
          <span className="tabular-nums">{stats.totalCovers}</span>
        </span>
        <span className={chip}>
          <span className={label}>Confirmed</span>
          <span className="tabular-nums">{stats.confirmed}/{stats.total}</span>
        </span>
        <span className={chip}>
          <span className={label}>Pending</span>
          <span className="tabular-nums">{stats.pending}</span>
        </span>
      </div>
    );
  }, [stats]);

  const filterCount =
    (statusFilter !== 'All' ? 1 : 0) +
    (modelFilter !== 'all' ? 1 : 0) +
    (serviceFilterIds.length > 0 ? 1 : 0) +
    (calendarFilter !== 'all' ? 1 : 0) +
    (filterAreaId ? 1 : 0);

  const bookingsDatePanel = (
    viewMode === 'custom' ? (
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">From</label>
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">To</label>
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500" />
        </div>
        {invalidCustomRange && (
          <p className="text-xs font-medium text-red-600">From date must be before or equal to To date.</p>
        )}
      </div>
    ) : (
      <div className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm sm:p-3">
        <CalendarDateTimePicker
          date={anchorDate}
          onDateChange={setAnchorDate}
          startHour={pickerStartHour}
          endHour={pickerEndHour}
          onTimeRangeChange={(start, end) => {
            setStartHourOverride(start);
            setEndHourOverride(end);
            setTimeRangeFilterActive(viewMode === 'day');
          }}
        />
        {viewMode === 'day' && timeRangeFilterActive && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
            <p className="text-xs text-slate-600">
              Showing bookings from <span className="font-medium text-slate-800">{String(pickerStartHour).padStart(2, '0')}:00</span> to{' '}
              <span className="font-medium text-slate-800">{String(pickerEndHour).padStart(2, '0')}:00</span>.
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
    )
  );

  const bookingsFilterPanel = (
    <div className="space-y-4">
      {filterModels.length > 1 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Booking type</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setModelFilter('all')}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors duration-150 ease-out ${
                modelFilter === 'all'
                  ? 'bg-brand-600 text-white shadow-sm ring-1 ring-brand-600/20'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-800'
              }`}
            >
              All
            </button>
            {filterModels.map((model) => (
              <button
                key={model}
                type="button"
                onClick={() => setModelFilter(model)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors duration-150 ease-out ${
                  modelFilter === model
                    ? 'bg-brand-600 text-white shadow-sm ring-1 ring-brand-600/20'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-800'
                }`}
              >
                {bookingTypeFilterLabel(model)}
              </button>
            ))}
          </div>
        </div>
      )}
      {showServiceBookingsChrome && (
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Service</span>
            {serviceFilterIds.length > 0 ? (
              <button
                type="button"
                onClick={() => setServiceFilterIds([])}
                className="text-[11px] font-semibold text-brand-600 hover:text-brand-700 hover:underline"
              >
                All services
              </button>
            ) : null}
          </div>
          <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1.5">
            {activeDiningServiceOptions.map((service) => {
              const checked = serviceFilterIds.includes(service.id);
              return (
                <label
                  key={service.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                    checked ? 'bg-brand-50 text-brand-800' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleServiceFilter(service.id)}
                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span className="min-w-0 truncate">{service.label}</span>
                </label>
              );
            })}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            {serviceFilterIds.length === 0
              ? 'Showing all services.'
              : `${serviceFilterIds.length} service${serviceFilterIds.length === 1 ? '' : 's'} selected.`}
          </p>
        </div>
      )}
      {showAreaBookingsChrome && (
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Area</span>
          <select
            value={filterAreaId ?? ''}
            onChange={(e) => setAreaFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          >
            <option value="">All areas</option>
            {diningAreas
              .filter((a) => a.is_active)
              .map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
          </select>
        </label>
      )}
      {showCalendarBookingsChrome && (
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Calendar</span>
          <select
            value={calendarFilter}
            onChange={(e) => setCalendarFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          >
            <option value="all">All calendars</option>
            {activeBookingCalendars.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>{calendar.name}</option>
            ))}
          </select>
        </label>
      )}
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</p>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTER_OPTIONS.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => setStatusFilter(s.label)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors duration-150 ease-out ${
                statusFilter === s.label
                  ? 'bg-brand-600 text-white shadow-sm ring-1 ring-brand-600/20'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-800'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {filterCount > 0 ? (
        <button
          type="button"
          onClick={() => {
            setStatusFilter('All');
            setModelFilter('all');
            setServiceFilterIds([]);
            setCalendarFilter('all');
            if (filterAreaId) setAreaFilter('');
          }}
          className="text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );

  useEffect(() => {
    if (!viewRangePopoverOpen) return;
    const handler = (event: PointerEvent) => {
      if (viewRangeWrapRef.current?.contains(event.target as Node)) return;
      setViewRangePopoverOpen(false);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [viewRangePopoverOpen]);

  useEffect(() => {
    if (!viewRangePopoverOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setViewRangePopoverOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewRangePopoverOpen]);

  const bookingsToolbarLeadingTools = useCallback(
    (toolbarPanelAnchorRef: RefObject<HTMLDivElement | null>) => (
      <div ref={viewRangeWrapRef} className="relative shrink-0">
        <button
          ref={viewRangeTriggerRef}
          type="button"
          onClick={() => setViewRangePopoverOpen((openNow) => !openNow)}
          className={`inline-flex min-h-8 shrink-0 items-center gap-0.5 rounded-lg border px-2 py-1 text-[11px] font-semibold shadow-sm hover:bg-slate-50 sm:text-xs ${
            viewRangePopoverOpen
              ? 'border-brand-300 bg-brand-50 text-brand-800 ring-1 ring-brand-200'
              : 'border-slate-200 bg-white text-slate-700'
          }`}
          aria-expanded={viewRangePopoverOpen}
          aria-haspopup="dialog"
          aria-controls={viewRangePanelId}
          aria-label="View \u2014 Day, week, month, or custom range"
        >
          <span className="max-w-[4.75rem] truncate sm:max-w-none">
            {VIEW_MODE_OPTIONS.find((o) => o.id === viewMode)?.label ?? 'Day'}
          </span>
          <svg className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        <ClampedFixedDropdown
          open={viewRangePopoverOpen}
          triggerRef={viewRangeTriggerRef}
          verticalAnchorRef={toolbarPanelAnchorRef}
          horizontalCenter
          gapPx={4}
          align="start"
          maxWidthPx={288}
          id={viewRangePanelId}
          onDismiss={() => setViewRangePopoverOpen(false)}
          aria-label="Choose view range"
          className="animate-fade-in z-50 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/10 ring-1 ring-slate-100"
        >
          <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">View</p>
          <div role="radiogroup" aria-label="Date range view" className="space-y-0.5">
            {VIEW_MODE_OPTIONS.map(({ id: modeId, label }) => (
              <button
                key={modeId}
                type="button"
                role="radio"
                aria-checked={viewMode === modeId}
                onClick={() => {
                  setViewMode(modeId);
                  if (modeId !== 'custom') setAnchorDate(todayISO());
                  setViewRangePopoverOpen(false);
                }}
                className={`flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm font-semibold ${
                  viewMode === modeId
                    ? 'bg-brand-50 text-brand-800 ring-1 ring-brand-200'
                    : 'text-slate-800 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </ClampedFixedDropdown>
      </div>
    ),
    [viewMode, viewRangePopoverOpen, viewRangePanelId],
  );

  return (
    <div className="min-w-0 space-y-6">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {filterGuestId && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <span>Showing bookings for one guest in the selected date range.</span>
          <button
            type="button"
            onClick={clearGuestFilter}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
          >
            Clear guest filter
          </button>
        </div>
      )}

      {cdeDeepLink && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <span>Showing all bookings for this {cdeDeepLinkEntityLabel(cdeDeepLink.param)}.</span>
          <button
            type="button"
            onClick={clearCdeDeepLink}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
          >
            Back to all bookings
          </button>
        </div>
      )}

      <OperationsWorkspaceToolbar
        title="Bookings"
        summary={bookingToolbarSummary}
        summaryContent={bookingSummaryContent}
        date={anchorDate}
        todayIso={todayIso}
        dateLabel={viewMode === 'custom' ? `${customFrom} \u2013 ${customTo}` : formatDateLabel(anchorDate, viewMode)}
        onDateChange={setAnchorDate}
        onPreviousDate={() => navigate(-1)}
        onNextDate={() => navigate(1)}
        liveState={realtimeConnected === false ? 'reconnecting' : 'live'}
        onRefresh={() => { void fetchBookings({ silent: true }); }}
        onNewBooking={() => setNewBookingOpen(true)}
        onWalkIn={() => setWalkInOpen(true)}
        compact
        hideTitle
        toolbarLeadingTools={bookingsToolbarLeadingTools}
        controlsLabel={filterCount > 0 ? `Filter (${filterCount})` : 'Filter'}
        controlsPanel={bookingsFilterPanel}
        datePickerPanel={bookingsDatePanel}
        searchActive={guestToolbarSearchQuery.trim().length > 0}
        searchAriaLabel="Search contacts"
        searchPanel={(
          <OperationsToolbarGuestSearchPanel
            onQueryChange={setGuestToolbarSearchQuery}
            initialDate={viewMode === 'day' ? anchorDate : undefined}
            onBookingCreated={() => void fetchBookings()}
          />
        )}
        inlineTools={
          showModelFilters ? (
            <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div className="overflow-x-auto pb-0.5">
                <TabBar<'all' | BookingModel>
                  mobileNote={null}
                  tabs={[
                    { id: 'all', label: 'All types' },
                    ...filterModels.map((m) => ({ id: m as 'all' | BookingModel, label: bookingModelShortLabel(m) })),
                  ]}
                  value={modelFilter}
                  onChange={setModelFilter}
                />
              </div>
            </div>
          ) : undefined
        }
      />
      {/* Confirmed means staff-confirmed, guest-confirmed, or legacy rows with status === 'Confirmed'. */}

      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5">
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 bg-brand-500 transition-opacity duration-200 ease-out ${isRefreshing ? 'opacity-100' : 'opacity-0'}`}
          aria-hidden
        />

      {loading ? (
        <DashboardListSkeleton rowCount={6} />
      ) : filteredBookings.length === 0 ? (
        <DashboardEmptyState
          title="No reservations for this period"
          description="Try another date range, clear filters, or take your first booking."
          action={
            <button
              type="button"
              onClick={() => setNewBookingOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
            >
              New booking
            </button>
          }
        />
      ) : viewMode === 'day' ? (
        <BookingsAccordionList
          bookings={filteredBookings}
          allBookingsForSchedule={bookings}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          expandedIds={expandedIds}
          detailById={detailById}
          detailLoadingIds={detailLoadingIds}
          messageDraftById={messageDraftById}
          setMessageDraftById={setMessageDraftById}
          sendingMessageIds={sendingMessageIds}
          tableManagementEnabled={tableManagementEnabled}
          coversChangeTableEnabled={coversChangeTableEnabled}
          onRequestChangeTable={(b) => { void openChangeTableModal(b); }}
          venueId={venueId}
          venueCurrency={currency ?? 'GBP'}
          venueTimezone={venueTimezone}
          guestHistoryRevisionById={guestHistoryRevisionById}
          onOpenRelatedGuestBooking={(payload) => {
            setRelatedGuestHistoryBooking({
              bookingId: payload.bookingId,
              snapshot: payload.snapshot,
              isAppointment: !isTableReservationBooking(payload.row),
            });
          }}
          onToggleExpand={toggleExpand}
          onSendMessage={sendMessageToBooking}
          onStatusAction={requestStatusChange}
          onDetailUpdated={handleDetailUpdated}
          showAreaBadge={showAreaBookingsChrome && !filterAreaId}
          onPrefetchBookingDetail={prefetchBookingDetail}
          venueStaffBookingModel={primaryBookingModel}
          venueStaffEnabledBookingModels={enabledModels}
        />
      ) : (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5">
            <div className="border-b border-slate-200/90 bg-slate-50 px-3 py-2 sm:px-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <label className="inline-flex min-w-0 cursor-pointer items-center gap-2 text-[11px] font-semibold text-slate-600 hover:text-slate-800 sm:text-xs">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={(event) => {
                      if (event.target.checked) setSelectedIds((prev) => Array.from(new Set([...prev, ...filteredBookings.map((b) => b.id)])));
                      else setSelectedIds((prev) => prev.filter((id) => !filteredBookings.some((b) => b.id === id)));
                    }}
                    aria-label="Select all bookings in list"
                    disabled={filteredBookings.length === 0}
                  />
                  Select all
                </label>
                <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-500 sm:text-xs">
                  {filteredBookings.length} {filteredBookings.length === 1 ? 'booking' : 'bookings'}
                </span>
              </div>
            </div>
          </div>
          {Object.entries(groupedByDate ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([date, dayBookings]) => (
            <div key={date} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200/90 bg-slate-50 px-5 py-3">
                <h3 className="text-sm font-semibold text-slate-700">{formatDayHeader(date)}</h3>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>
                    {dayBookings.length} booking{dayBookings.length !== 1 ? 's' : ''}
                  </span>
                  {dayBookings.some(isTableReservationBooking) ? (
                    <span>
                      {dayBookings.reduce((s, b) => s + (isTableReservationBooking(b) ? b.party_size : 0), 0)} covers
                    </span>
                  ) : null}
                </div>
              </div>
              <BookingsAccordionList
                bookings={dayBookings}
                allBookingsForSchedule={bookings}
                selectedIds={selectedIds}
                setSelectedIds={setSelectedIds}
                expandedIds={expandedIds}
                detailById={detailById}
                detailLoadingIds={detailLoadingIds}
                messageDraftById={messageDraftById}
                setMessageDraftById={setMessageDraftById}
                sendingMessageIds={sendingMessageIds}
                tableManagementEnabled={tableManagementEnabled}
                coversChangeTableEnabled={coversChangeTableEnabled}
                onRequestChangeTable={(b) => { void openChangeTableModal(b); }}
                venueId={venueId}
                venueCurrency={currency ?? 'GBP'}
                venueTimezone={venueTimezone}
                guestHistoryRevisionById={guestHistoryRevisionById}
                onOpenRelatedGuestBooking={(payload) => {
                  setRelatedGuestHistoryBooking({
                    bookingId: payload.bookingId,
                    snapshot: payload.snapshot,
                    isAppointment: !isTableReservationBooking(payload.row),
                  });
                }}
                onToggleExpand={toggleExpand}
                onSendMessage={sendMessageToBooking}
                onStatusAction={requestStatusChange}
                onDetailUpdated={handleDetailUpdated}
                showAreaBadge={showAreaBookingsChrome && !filterAreaId}
                onPrefetchBookingDetail={prefetchBookingDetail}
                venueStaffBookingModel={primaryBookingModel}
                venueStaffEnabledBookingModels={enabledModels}
                showSelectAllHeader={false}
              />
            </div>
          ))}
        </div>
      )}
      </div>

      {addTagOpen ? (
        <AddTagModal
          recipientCount={selectedIds.length}
          busy={bulkLoading}
          existingTags={venueTags}
          onClose={() => setAddTagOpen(false)}
          onSubmit={(tag) => void runBulkAddTag(tag)}
        />
      ) : null}

      {bulkGuestMessageOpen && (
        <BulkGuestMessageModal
          onClose={() => setBulkGuestMessageOpen(false)}
          recipientCount={selectedIds.length}
          sending={bulkLoading}
          onSend={(message, channel) => { void runBulkMessage(message, channel); }}
        />
      )}

      {relatedGuestHistoryBooking ? (
        <BookingDetailPanel
          key={relatedGuestHistoryBooking.bookingId}
          bookingId={relatedGuestHistoryBooking.bookingId}
          venueId={venueId}
          venueCurrency={currency ?? 'GBP'}
          initialSnapshot={relatedGuestHistoryBooking.snapshot}
          isAppointment={relatedGuestHistoryBooking.isAppointment}
          presentation="popover"
          anchor={null}
          stackDepth={0}
          venueTimezone={venueTimezone}
          onClose={() => setRelatedGuestHistoryBooking(null)}
          onUpdated={() => {
            const id = expandedIds[0];
            if (id) {
              setGuestHistoryRevisionById((prev) => ({
                ...prev,
                [id]: (prev[id] ?? 0) + 1,
              }));
            }
            void fetchBookings({ silent: true });
          }}
        />
      ) : null}

      {walkInOpen && (
        <DashboardStaffBookingModal
          open
          title="Walk-in"
          bookingIntent="walk-in"
          onClose={() => setWalkInOpen(false)}
          onCreated={handleWalkInCreated}
          venueId={venueId}
          currency={currency ?? 'GBP'}
          bookingModel={primaryBookingModel}
          enabledModels={enabledModels}
          advancedMode={tableManagementEnabled}
        />
      )}
      {newBookingOpen && (
        <DashboardStaffBookingModal
          open
          title="New booking"
          onClose={() => setNewBookingOpen(false)}
          onCreated={handleNewBookingCreated}
          venueId={venueId}
          currency={currency ?? 'GBP'}
          bookingModel={primaryBookingModel}
          enabledModels={enabledModels}
          advancedMode={tableManagementEnabled}
        />
      )}
      <Dialog
        open={changeTableBooking != null}
        onOpenChange={(open) => {
          if (!open && !changeTableSaving) closeChangeTableModal();
        }}
        title="Change table"
        size="md"
        contentClassName="max-w-md"
      >
        {changeTableBooking ? (
          <>
            <p className="text-sm text-slate-600">
              Select table(s) for {changeTableBooking.guest_name}. Tables already assigned to this booking are treated as free so you can move or keep them.
            </p>
            {changeTableDayLoading && (
              <p className="mt-2 text-xs text-slate-500">Loading table occupancy for this date&hellip;</p>
            )}
            {changeTableSelectorTables.length === 0 ? (
              <p className="mt-4 text-sm text-amber-700">No active tables are configured. Add tables in venue settings.</p>
            ) : (
              <div className={changeTableSaving ? 'pointer-events-none opacity-60' : ''}>
                <TableSelector
                  tables={changeTableSelectorTables}
                  occupancyMap={changeTableOccupancyMap}
                  partySize={changeTableBooking.party_size}
                  selectedIds={changeTableSelectedIds}
                  onChange={setChangeTableSelectedIds}
                  confirmLabel={changeTableSaving ? 'Saving\u2026' : 'Save'}
                  skipLabel="Cancel"
                  onConfirm={(ids) => { void confirmChangeTableAssignment(ids); }}
                  onSkip={() => { if (!changeTableSaving) closeChangeTableModal(); }}
                />
              </div>
            )}
            {changeTableSelectorTables.length === 0 ? (
              <button
                type="button"
                onClick={closeChangeTableModal}
                className="mt-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            ) : null}
          </>
        ) : null}
      </Dialog>
      {undoAction && (
        <UndoToast
          action={undoAction}
          onUndo={() => { void undoLastStatusChange(); }}
          onDismiss={() => setUndoAction(null)}
        />
      )}
      <ConfirmDialog
        open={confirmDialog != null}
        onOpenChange={(open) => {
          if (!open) setConfirmDialog(null);
        }}
        title={confirmDialog?.title ?? ''}
        message={confirmDialog?.message ?? ''}
        confirmLabel={confirmDialog?.confirmLabel ?? 'Confirm'}
        onConfirm={() => confirmDialog?.onConfirm()}
        destructive
      />
      {/* Floating bulk-actions tray - appears when rows are selected */}
      {selectedIds.length > 0 && (
        <div className="fixed left-1/2 z-40 max-w-[calc(100vw-1rem)] -translate-x-1/2 px-2 bottom-[max(1rem,env(safe-area-inset-bottom,0px))]">
          <div className="flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-slate-200/80 bg-white px-3 py-2 shadow-xl shadow-slate-900/15 ring-1 ring-slate-100 sm:flex-nowrap sm:px-4 sm:py-2.5">
            <span className="mr-1 w-full shrink-0 text-center text-sm font-semibold text-slate-800 sm:w-auto sm:text-left">
              {selectedIds.length} selected
            </span>
            <div className="hidden h-4 w-px shrink-0 bg-slate-200 sm:block" />
            <button
              type="button"
              disabled={bulkLoading}
              onClick={() => void runBulkNoShow()}
              className="min-h-10 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
            >
              No-show
            </button>
            <button
              type="button"
              disabled={bulkLoading || bulkCancelEligibleIds.length === 0}
              onClick={() => void runBulkCancel()}
              className="min-h-10 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-amber-50 hover:text-amber-800 disabled:opacity-40"
            >
              Cancel {bulkCancelEligibleIds.length > 0 && bulkCancelEligibleIds.length < selectedIds.length ? `(${bulkCancelEligibleIds.length})` : ''}
            </button>
            <button
              type="button"
              disabled={bulkLoading || bulkDeleteEligibleIds.length === 0}
              onClick={() => void runBulkDelete()}
              className="min-h-10 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
            >
              Delete
            </button>
            <div className="hidden h-4 w-px shrink-0 bg-slate-200 sm:block" />
            <button
              type="button"
              disabled={bulkLoading}
              onClick={openAddTag}
              className="min-h-10 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
            >
              Add tag
            </button>
            <button
              type="button"
              disabled={bulkLoading}
              onClick={() => setBulkGuestMessageOpen(true)}
              className="min-h-10 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
            >
              Message
            </button>
            <div className="hidden h-4 w-px shrink-0 bg-slate-200 sm:block" />
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="flex min-h-10 min-w-10 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              aria-label="Clear selection"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function statusBorderClass(booking: BookingRow): string {
  return bookingStatusVisualForRow(booking).listBorderLeft;
}

function depositBadge(status: string, amountPence: number | null) {
  if (status === 'Not Required') return null;
  const amt = amountPence ? `£${(amountPence / 100).toFixed(2)}` : null;
  const variantMap: Record<string, PillVariant> = {
    Paid: 'success',
    Refunded: 'brand',
    Pending: 'warning',
  };
  const labelMap: Record<string, string> = {
    Paid: amt ? `${amt} paid` : 'Deposit paid',
    Refunded: amt ? `${amt} refunded` : 'Refunded',
    Pending: 'Deposit pending',
  };
  const variant = variantMap[status] ?? 'neutral';
  const label = labelMap[status] ?? status;
  return <Pill variant={variant} size="sm" dot={status === 'Pending'}>{label}</Pill>;
}

function BookingsAccordionList({
  bookings,
  allBookingsForSchedule,
  selectedIds,
  setSelectedIds,
  expandedIds,
  detailById,
  detailLoadingIds,
  messageDraftById,
  setMessageDraftById,
  sendingMessageIds,
  tableManagementEnabled,
  coversChangeTableEnabled,
  onRequestChangeTable,
  venueId,
  venueCurrency = 'GBP',
  venueTimezone,
  guestHistoryRevisionById,
  onOpenRelatedGuestBooking,
  onToggleExpand,
  onSendMessage,
  onStatusAction,
  onDetailUpdated,
  showAreaBadge = false,
  onPrefetchBookingDetail,
  venueStaffBookingModel,
  venueStaffEnabledBookingModels,
  showSelectAllHeader = true,
}: {
  bookings: BookingRow[];
  /** Full loaded list (for multi-service visit duration across filtered siblings). */
  allBookingsForSchedule: BookingRow[];
  selectedIds: string[];
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  expandedIds: string[];
  detailById: Record<string, BookingDetailLite>;
  detailLoadingIds: string[];
  messageDraftById: Record<string, string>;
  setMessageDraftById: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  sendingMessageIds: string[];
  tableManagementEnabled: boolean;
  coversChangeTableEnabled: boolean;
  onRequestChangeTable: (booking: BookingRow) => void;
  venueId: string;
  venueCurrency?: string;
  venueTimezone: string;
  guestHistoryRevisionById: Record<string, number>;
  onOpenRelatedGuestBooking: (payload: GuestHistoryRelatedBookingPayload) => void;
  onToggleExpand: (id: string) => void;
  onSendMessage: (id: string, message: string, channel?: GuestMessageChannel) => Promise<GuestMessageSendResult>;
  onStatusAction: (booking: BookingRow, status: BookingStatus) => void;
  onDetailUpdated: (bookingId: string) => void;
  showAreaBadge?: boolean;
  onPrefetchBookingDetail?: (bookingId: string) => void;
  venueStaffBookingModel: BookingModel;
  venueStaffEnabledBookingModels: BookingModel[];
  /** Hidden in grouped multi-day view, where a single "Select all" sits above all day groups. */
  showSelectAllHeader?: boolean;
}) {
  const allSelected = bookings.length > 0 && bookings.every((b) => selectedIds.includes(b.id));
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5">
      {showSelectAllHeader ? (
        <div className="border-b border-slate-200/90 bg-slate-50 px-3 py-2 sm:px-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <label className="inline-flex min-w-0 cursor-pointer items-center gap-2 text-[11px] font-semibold text-slate-600 hover:text-slate-800 sm:text-xs">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(event) => {
                  if (event.target.checked) setSelectedIds((prev) => Array.from(new Set([...prev, ...bookings.map((b) => b.id)])));
                  else setSelectedIds((prev) => prev.filter((id) => !bookings.some((b) => b.id === id)));
                }}
                aria-label="Select all bookings in list"
              />
              Select all
            </label>
            <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-500 sm:text-xs">
              {bookings.length} {bookings.length === 1 ? 'booking' : 'bookings'}
            </span>
          </div>
        </div>
      ) : null}
      <div className="flex flex-col gap-2.5 bg-slate-100 p-2 sm:gap-3 sm:p-3">
        {bookings.map((booking) => {
          const expanded = expandedIds.includes(booking.id);
          const detail = detailById[booking.id];
          const detailLoading = detailLoadingIds.includes(booking.id);
          const draftMessage = messageDraftById[booking.id] ?? '';
          const sendingMessage = sendingMessageIds.includes(booking.id);
          const inferredModel = inferBookingRowModel(booking);
          const isTableBooking = inferredModel === 'table_reservation';
          const tableLabel = isTableBooking && booking.table_assignments && booking.table_assignments.length > 0
            ? booking.table_assignments.length === 1
              ? booking.table_assignments[0]!.name
              : booking.table_assignments.map((t) => t.name).join(', ')
            : null;
          const displayStatus = bookingStatusDisplayLabel(booking.status, inferredModel === 'table_reservation');
          const barSchedule = resolveBookingListBarSchedule(
            booking,
            allBookingsForSchedule,
          );
          const { timeRangeLabel, durationBarLabel, durationDetailLabel } = barSchedule;
          return (
            <div
              key={booking.id}
              role="button"
              tabIndex={0}
              aria-expanded={expanded}
              aria-controls={`booking-expand-${booking.id}`}
              onClick={() => onToggleExpand(booking.id)}
              {...(onPrefetchBookingDetail
                ? bindDetailPrefetchHandlers(booking.id, onPrefetchBookingDetail)
                : {})}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleExpand(booking.id); } }}
              className={`cursor-pointer rounded-xl border border-slate-200 bg-white px-2 py-2 shadow-sm shadow-slate-900/[0.04] ring-1 ring-slate-900/[0.06] transition-[border-color,box-shadow,background-color] duration-150 sm:px-3 sm:py-3 border-l-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/35 focus-visible:ring-offset-2 ${statusBorderClass(booking)} ${expanded ? 'border-slate-300 bg-brand-50/50 shadow-md ring-brand-900/15' : 'hover:border-slate-300 hover:bg-slate-50/90 hover:shadow-md hover:shadow-slate-900/[0.07] hover:ring-slate-900/[0.09]'}`}
            >
              <div className="flex min-h-[2.75rem] min-w-0 items-center gap-1.5 sm:min-h-[3rem] sm:gap-2">
                <div onClick={(e) => e.stopPropagation()} className="flex shrink-0 items-center">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(booking.id)}
                    onChange={(event) => {
                      setSelectedIds((prev) => event.target.checked ? [...prev, booking.id] : prev.filter((id) => id !== booking.id));
                    }}
                    aria-label={`Select booking for ${booking.guest_name}`}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs sm:text-sm">
                    <span className="min-w-0 max-w-[9.5rem] truncate font-semibold text-slate-900 sm:max-w-[14rem]">
                      {booking.guest_name}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-slate-700">
                      {timeRangeLabel.includes('–') ? (
                        <>
                          {timeRangeLabel.slice(0, 5)}
                          <span className="text-slate-400">{timeRangeLabel.slice(5)}</span>
                        </>
                      ) : (
                        timeRangeLabel
                      )}
                    </span>
                    {durationBarLabel ? (
                      <span
                        className={
                          expanded
                            ? 'inline-block rounded bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500'
                            : 'hidden rounded bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500 sm:inline-block'
                        }
                        title={durationDetailLabel ?? durationBarLabel}
                      >
                        {durationBarLabel}
                      </span>
                    ) : null}
                    {booking.booking_item_name?.trim() ? (
                      <>
                        <span className="shrink-0 text-slate-300">·</span>
                        <span className="min-w-0 max-w-[11rem] truncate text-[11px] font-semibold text-slate-800 sm:max-w-[16rem] sm:text-xs">
                          {booking.booking_item_name.trim()}
                        </span>
                      </>
                    ) : null}
                    {isTableBooking ? (
                      <>
                        <span className="shrink-0 text-slate-300">·</span>
                        <span className="shrink-0 text-[11px] font-medium text-slate-600 sm:text-xs">
                          {booking.party_size} {booking.party_size === 1 ? 'cover' : 'covers'}
                        </span>
                      </>
                    ) : booking.party_size > 1 ? (
                      <>
                        <span className="shrink-0 text-slate-300">·</span>
                        <span className="shrink-0 text-[11px] font-medium text-slate-600 sm:text-xs">
                          {booking.party_size} people
                        </span>
                      </>
                    ) : null}
                    <BookingStatusPill statusKey={booking.status}>{displayStatus}</BookingStatusPill>
                    {isTableBooking && showAreaBadge && booking.area_name && (
                      <span className={expanded ? 'inline-flex' : 'hidden sm:inline-flex'}>
                        <Pill variant="neutral" size="sm">{booking.area_name}</Pill>
                      </span>
                    )}
                    {showDepositPendingPill(booking) && (
                      <Pill variant="warning" size="sm" dot>
                        <span className="sm:hidden">Deposit</span>
                        <span className="hidden sm:inline">Deposit pending</span>
                      </Pill>
                    )}
                    {showAttendanceConfirmedSupplementPill(booking) && (
                      <BookingStatusPill statusKey="Confirmed" dot>Confirmed</BookingStatusPill>
                    )}
                    {showBookingModelTypePill(inferredModel) ? (
                      <span className={expanded ? 'inline-flex shrink-0' : 'hidden shrink-0 md:inline-flex'}>
                        <Pill variant={bookingTypePillVariant(inferredModel)} size="sm">
                          {bookingTypeFilterLabel(inferredModel)}
                        </Pill>
                      </span>
                    ) : null}
                    {(booking.addons_count ?? 0) > 0 && (
                      <span className={expanded ? 'inline-flex shrink-0' : 'hidden shrink-0 sm:inline-flex'}>
                        <Pill variant="info" size="sm">
                          +{booking.addons_count} {booking.addons_count === 1 ? 'extra' : 'extras'}
                        </Pill>
                      </span>
                    )}
                    {booking.dietary_notes && (
                      <span className={expanded ? 'inline-flex' : 'hidden sm:inline-flex'}>
                        <Pill variant="warning" size="sm" dot>Dietary</Pill>
                      </span>
                    )}
                    {tableLabel && (
                      <span
                        className={
                          expanded
                            ? 'inline-block max-w-[10rem] truncate rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700'
                            : 'hidden max-w-[10rem] truncate rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 sm:inline-block'
                        }
                      >
                        {tableLabel}
                      </span>
                    )}
                    {booking.group_booking_id && (
                      <span className={expanded ? 'inline-flex' : 'hidden sm:inline-flex'}>
                        <Pill variant="neutral" size="sm">
                          {booking.person_label ? `Group · ${booking.person_label}` : 'Group'}
                        </Pill>
                      </span>
                    )}
                    <span className={expanded ? 'inline-flex shrink-0' : 'hidden sm:inline-flex'}>
                      {depositBadge(booking.deposit_status, booking.deposit_amount_pence)}
                    </span>
                  </div>
                </div>
                <svg className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </div>
              {expanded && (
                <div
                  className={expandedBookingRowShellClass}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <ExpandedBookingContent
                    booking={booking}
                    initialGroupVisitBookings={resolveInitialGroupVisitBookings(bookings, booking.group_booking_id)}
                    detail={detail}
                    detailLoading={detailLoading}
                    tableManagementEnabled={tableManagementEnabled}
                    venueId={venueId}
                    venueCurrency={venueCurrency}
                    venueTimezone={venueTimezone}
                    guestHistoryListRefresh={guestHistoryRevisionById[booking.id] ?? 0}
                    relatedBookingsStackDepth={0}
                    onOpenRelatedGuestBooking={onOpenRelatedGuestBooking}
                    draftMessage={draftMessage}
                    sendingMessage={sendingMessage}
                    onMessageDraftChange={(value) => setMessageDraftById((prev) => ({ ...prev, [booking.id]: value }))}
                    onSendMessage={(ch) => onSendMessage(booking.id, draftMessage, ch)}
                    onStatusAction={(status) => { onStatusAction(booking, status); }}
                    onDetailUpdated={() => onDetailUpdated(booking.id)}
                    onRequestChangeTable={isTableBooking && coversChangeTableEnabled && booking.status === 'Seated' ? () => onRequestChangeTable(booking) : undefined}
                    venueStaffBookingModel={venueStaffBookingModel}
                    venueStaffEnabledBookingModels={venueStaffEnabledBookingModels}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

