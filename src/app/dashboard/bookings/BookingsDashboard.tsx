'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { TableSelector } from '@/components/table-tracking/TableSelector';
import type { OccupancyMap, TableForSelector } from '@/components/table-tracking/TableSelector';
import { createClient } from '@/lib/supabase/browser';
import { BookingDetailPanel } from './BookingDetailPanel';
import { DashboardStaffBookingModal } from '@/components/booking/DashboardStaffBookingModal';
import { ExpandedBookingContent } from './ExpandedBookingContent';
import { UndoToast } from '@/app/dashboard/table-grid/UndoToast';
import type { UndoAction } from '@/types/table-management';
import {
  BOOKING_PRIMARY_ACTIONS,
  BOOKING_REVERT_ACTIONS,
  canMarkNoShowForSlot,
  canTransitionBookingStatus,
  isDestructiveBookingStatus,
  isRevertTransition,
  type BookingStatus,
} from '@/lib/table-management/booking-status';
import { useToast } from '@/components/ui/Toast';
import { DashboardStatCard } from '@/components/dashboard/DashboardStatCard';
import { PageFrame } from '@/components/ui/dashboard/PageFrame';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { EmptyState as DashboardEmptyState } from '@/components/ui/dashboard/EmptyState';
import { TabBar } from '@/components/ui/dashboard/TabBar';
import { Pill, type PillVariant } from '@/components/ui/dashboard/Pill';
import type { BookingModel } from '@/types/booking-models';
import { BOOKING_MODEL_ORDER } from '@/lib/booking/enabled-models';
import {
  inferBookingRowModel,
  bookingModelShortLabel,
  isTableReservationBooking,
  bookingStatusDisplayLabel,
} from '@/lib/booking/infer-booking-row-model';
import {
  isAttendanceConfirmed,
  showAttendanceConfirmedPill,
  showDepositPendingPill,
} from '@/lib/booking/booking-staff-indicators';
import { CalendarDateTimePicker } from '@/components/calendar/CalendarDateTimePicker';
import { getCalendarGridBounds } from '@/lib/venue-calendar-bounds';
import { isBookingTimeInHourRange } from '@/lib/booking-time-window';
import type { OpeningHours } from '@/types/availability';
import { BulkGuestMessageModal } from '@/components/booking/BulkGuestMessageModal';
import type { GuestMessageChannel } from '@/lib/booking/guest-message-channel';
import { DashboardListSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';
import { useDashboardVenueBootstrap } from '@/components/providers/DashboardVenueBootstrapProvider';

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
  guest_attendance_confirmed_at?: string | null;
  staff_attendance_confirmed_at?: string | null;
  area_id?: string | null;
  area_name?: string | null;
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
    name: string | null;
    email: string | null;
    phone: string | null;
    visit_count: number;
    customer_profile_notes?: string | null;
  } | null;
  communications: Array<{ id: string; message_type: string; channel: string; status: string; created_at: string }>;
  events: Array<{ id: string; event_type: string; created_at: string }>;
  /** Populated for C/D/E rows (see GET /api/venue/bookings/[id]). */
  cde_context?: {
    inferred_model: BookingModel;
    title: string;
    subtitle?: string | null;
  } | null;
  inferred_booking_model?: BookingModel;
}

type ViewMode = 'day' | 'week' | 'month' | 'custom';

interface StatusFilterOption {
  label: string;
  apiStatus: string | null;
  attendanceConfirmed?: boolean;
  excludeAttendanceConfirmed?: boolean;
}

/**
 * Filter UI labels.
 *  - `Booked`    — `status === 'Booked'` and not attendance-confirmed.
 *  - `Confirmed` — guest or staff confirmed attendance, including legacy `status === 'Confirmed'`.
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
    return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} – ${end.getDate()} ${MONTHS_SHORT[end.getMonth()]} ${end.getFullYear()}`;
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
}: {
  venueId: string;
  currency?: string;
  primaryBookingModel?: BookingModel;
  enabledModels?: BookingModel[];
}) {
  const { addToast } = useToast();
  const venueBootstrap = useDashboardVenueBootstrap();
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [anchorDate, setAnchorDate] = useState(todayISO);
  const [customFrom, setCustomFrom] = useState(todayISO);
  const [customTo, setCustomTo] = useState(todayISO);
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [modelFilter, setModelFilter] = useState<'all' | BookingModel>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [serviceFilter, setServiceFilter] = useState<string>('all');
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [newBookingOpen, setNewBookingOpen] = useState(false);
  const [realtimeConnected, setRealtimeConnected] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkGuestMessageOpen, setBulkGuestMessageOpen] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
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
  const [confirmAttendanceLoadingId, setConfirmAttendanceLoadingId] = useState<string | null>(null);
  const [openingHours, setOpeningHours] = useState<OpeningHours | null>(null);
  const [venueTimezone, setVenueTimezone] = useState<string>('Europe/London');
  const [startHourOverride, setStartHourOverride] = useState<number | null>(null);
  const [endHourOverride, setEndHourOverride] = useState<number | null>(null);
  const [timeRangeFilterActive, setTimeRangeFilterActive] = useState(false);

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

  useEffect(() => {
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

  const showModelFilters = enabledModels.length > 0;
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

  const clearGuestFilter = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete('guest');
    const qs = next.toString();
    router.replace(qs ? `/dashboard/bookings?${qs}` : '/dashboard/bookings', { scroll: false });
  }, [router, searchParams]);

  const [diningAreas, setDiningAreas] = useState<Array<{ id: string; name: string; colour: string; is_active: boolean }>>([]);
  const [diningServices, setDiningServices] = useState<DiningService[]>([]);
  useEffect(() => {
    if (primaryBookingModel !== 'table_reservation') return;
    let cancelled = false;
    void Promise.all([
      fetch('/api/venue/areas').then((res) => (res.ok ? res.json() : null)),
      fetch('/api/venue/services').then((res) => (res.ok ? res.json() : null)),
    ])
      .then(([areasJson, servicesJson]) => {
        if (cancelled) return;
        if (areasJson?.areas) setDiningAreas(areasJson.areas as typeof diningAreas);
        if (servicesJson?.services) setDiningServices(servicesJson.services as DiningService[]);
      })
      .catch((e) => console.error('[BookingsDashboard] table filter preload failed:', e));
    return () => {
      cancelled = true;
    };
  }, [primaryBookingModel]);

  const showAreaBookingsChrome = primaryBookingModel === 'table_reservation' && diningAreas.filter((a) => a.is_active).length > 1;
  const activeDiningServices = useMemo(
    () => diningServices.filter((service) => service.is_active),
    [diningServices],
  );
  const showServiceBookingsChrome = primaryBookingModel === 'table_reservation' && activeDiningServices.length > 1;

  const setAreaFilter = useCallback(
    (value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (!value) next.delete('area');
      else next.set('area', value);
      try {
        window.localStorage.setItem(`bookingsArea:${venueId}`, value || '');
      } catch {
        /* ignore */
      }
      const qs = next.toString();
      router.replace(qs ? `/dashboard/bookings?${qs}` : '/dashboard/bookings', { scroll: false });
    },
    [router, searchParams, venueId],
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
      const saved = window.localStorage.getItem(`bookingsArea:${venueId}`);
      if (saved && GUEST_UUID_RE.test(saved)) {
        const next = new URLSearchParams(searchParams.toString());
        next.set('area', saved);
        router.replace(`/dashboard/bookings?${next}`, { scroll: false });
      }
    } catch {
      /* ignore */
    }
    areaHydrated.current = true;
  }, [router, searchParams, showAreaBookingsChrome, venueId]);

  useEffect(() => {
    if (serviceFilter === 'all') return;
    if (activeDiningServices.some((service) => service.id === serviceFilter)) return;
    setServiceFilter('all');
  }, [activeDiningServices, serviceFilter]);

  useEffect(() => {
    const ob = searchParams.get('openBooking');
    if (ob && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ob)) {
      setSelectedId(ob);
      const next = new URLSearchParams(searchParams.toString());
      next.delete('openBooking');
      const qs = next.toString();
      router.replace(qs ? `/dashboard/bookings?${qs}` : '/dashboard/bookings', { scroll: false });
    }
  }, [searchParams, router]);

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
    if (invalidCustomRange) {
      setError('Custom date range is invalid. "From" must be before or equal to "To".');
      setLoading(false);
      return;
    }

    if (silent) setIsRefreshing(true);
    else setLoading(true);

    if (!silent) setError(null);
    try {
      const params = ids && ids.length > 0
        ? new URLSearchParams({ ids: ids.join(',') })
        : (viewMode === 'day' ? new URLSearchParams({ date: from }) : new URLSearchParams({ from, to }));
      if (!ids && statusFilter !== 'All') {
        const opt = STATUS_FILTER_OPTIONS.find((o) => o.label === statusFilter);
        if (opt?.attendanceConfirmed) params.set('attendance_confirmed', '1');
        else if (opt?.apiStatus) params.set('status', opt.apiStatus);
      }
      if (!ids && filterGuestId) params.set('guest', filterGuestId);
      if (!ids && filterAreaId) params.set('area', filterAreaId);
      if (!ids && serviceFilter !== 'all') params.set('service', serviceFilter);
      const res = await fetch(`/api/venue/bookings/list?${params}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? 'Failed to load reservations');
        return;
      }
      const data = await res.json();
      const opt = STATUS_FILTER_OPTIONS.find((o) => o.label === statusFilter);
      const loaded: BookingRow[] = data.bookings ?? [];
      const next = !ids && opt?.excludeAttendanceConfirmed
        ? loaded.filter((booking) => !isAttendanceConfirmed(booking))
        : loaded;
      setBookings((prev) => {
        if (!ids || ids.length === 0) return next;
        const map = new Map(prev.map((b) => [b.id, b]));
        for (const row of next) map.set(row.id, row);
        return Array.from(map.values())
          .filter((b) => !ids.includes(b.id) || next.some((n) => n.id === b.id))
          .sort((a, b) => `${a.booking_date}${a.booking_time}`.localeCompare(`${b.booking_date}${b.booking_time}`));
      });
      setSelectedIds((prev) => prev.filter((id) => next.some((b: BookingRow) => b.id === id) || !ids));
    } catch {
      setError('Network error loading reservations');
    } finally {
      if (silent) setIsRefreshing(false);
      else setLoading(false);
    }
  }, [filterAreaId, filterGuestId, from, invalidCustomRange, serviceFilter, statusFilter, to, viewMode]);

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

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('bookings')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `venue_id=eq.${venueId}` },
        () => { void fetchBookings({ silent: true }); }
      )
      .subscribe((status) => { setRealtimeConnected(status === 'SUBSCRIBED'); });
    return () => { void supabase.removeChannel(channel); };
  }, [venueId, fetchBookings]);

  const loadBookingDetail = useCallback(async (bookingId: string, force = false) => {
    if (!force && detailById[bookingId]) return;
    if (detailLoadingIds.includes(bookingId)) return;
    setDetailLoadingIds((prev) => [...prev, bookingId]);
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}`);
      if (!res.ok) return;
      const data = await res.json();
      setDetailById((prev) => ({ ...prev, [bookingId]: data as BookingDetailLite }));
    } finally {
      setDetailLoadingIds((prev) => prev.filter((id) => id !== bookingId));
    }
  }, [detailById, detailLoadingIds]);

  const prefetchBookingDetail = useCallback(
    (bookingId: string) => {
      if (detailById[bookingId]) return;
      if (detailLoadingIds.includes(bookingId)) return;
      void fetch(`/api/venue/bookings/${bookingId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data) return;
          setDetailById((prev) => (prev[bookingId] ? prev : { ...prev, [bookingId]: data as BookingDetailLite }));
        })
        .catch(() => {});
    },
    [detailById, detailLoadingIds],
  );

  const toggleExpand = useCallback((bookingId: string) => {
    setExpandedIds((prev) => {
      if (prev.includes(bookingId)) return [];
      return [bookingId];
    });
    void loadBookingDetail(bookingId);
  }, [loadBookingDetail]);

  const handleWalkInCreated = useCallback(() => {
    setWalkInOpen(false);
    void fetchBookings({ silent: true });
  }, [fetchBookings]);

  const handleNewBookingCreated = useCallback(() => {
    setNewBookingOpen(false);
    void fetchBookings({ silent: true });
  }, [fetchBookings]);

  const handleDetailUpdated = useCallback((bookingId: string) => {
    setDetailById((prev) => { const next = { ...prev }; delete next[bookingId]; return next; });
    void loadBookingDetail(bookingId, true);
    void fetchBookings({ silent: true, ids: [bookingId] });
  }, [loadBookingDetail, fetchBookings]);

  const confirmBookingAttendance = useCallback(
    async (bookingId: string) => {
      setConfirmAttendanceLoadingId(bookingId);
      try {
        const res = await fetch(`/api/venue/bookings/${bookingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ staff_attendance_confirmed: true }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          addToast((j as { error?: string }).error ?? 'Could not confirm attendance', 'error');
          return;
        }
        addToast('Attendance confirmed', 'success');
        void fetchBookings({ silent: true, ids: [bookingId] });
      } catch {
        addToast('Could not confirm attendance', 'error');
      } finally {
        setConfirmAttendanceLoadingId(null);
      }
    },
    [addToast, fetchBookings],
  );

  const cancelStaffAttendanceConfirmation = useCallback(
    async (bookingId: string) => {
      setConfirmAttendanceLoadingId(bookingId);
      try {
        const res = await fetch(`/api/venue/bookings/${bookingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ staff_attendance_confirmed: false }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          addToast((j as { error?: string }).error ?? 'Could not cancel confirmation', 'error');
          return;
        }
        addToast('Confirmation cancelled', 'success');
        void fetchBookings({ silent: true, ids: [bookingId] });
      } catch {
        addToast('Could not cancel confirmation', 'error');
      } finally {
        setConfirmAttendanceLoadingId(null);
      }
    },
    [addToast, fetchBookings],
  );

  const updateBookingStatus = useCallback(async (bookingId: string, newStatus: BookingStatus) => {
    const previous = bookings.find((b) => b.id === bookingId)?.status;
    if (!previous || previous === newStatus || !canTransitionBookingStatus(previous, newStatus)) return;
    setBookings((prev) => prev.map((booking) => booking.id === bookingId ? { ...booking, status: newStatus } : booking));
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        throw new Error('Failed to update booking status');
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
      void fetchBookings({ silent: true, ids: [bookingId] });
    } catch {
      setBookings((prev) => prev.map((booking) => booking.id === bookingId ? { ...booking, status: previous } : booking));
      setError(`Could not update booking status for ${bookingId.slice(0, 8).toUpperCase()}.`);
    }
  }, [bookings, fetchBookings, addToast]);

  const sendMessageToBooking = useCallback(async (bookingId: string, message: string, channel: GuestMessageChannel = 'both') => {
    const trimmedMessage = message.trim();
    if (trimmedMessage.length === 0) return;
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
      } else {
        if (payload.errors && payload.errors.length > 0) {
          addToast(`Sent with issues — ${payload.errors.join('; ')}`, 'error');
        } else {
          addToast('Message sent', 'success');
        }
        setMessageDraftById((prev) => ({ ...prev, [bookingId]: '' }));
        setDetailById((prev) => {
          const next = { ...prev };
          delete next[bookingId];
          return next;
        });
        void loadBookingDetail(bookingId, true);
      }
    } catch {
      setError('Failed to send message.');
      addToast('Failed to send message.', 'error');
    } finally {
      setSendingMessageIds((prev) => prev.filter((id) => id !== bookingId));
    }
  }, [addToast, loadBookingDetail]);

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
    if (nextStatus === 'No-Show' && !canMarkNoShowForSlot(booking.booking_date, booking.booking_time, noShowGraceMinutes)) {
      setError(`No-show can only be marked ${noShowGraceMinutes} minutes after the booking start time.`);
      return;
    }
    if (isRevertTransition(booking.status, nextStatus)) {
      const revertAction = BOOKING_REVERT_ACTIONS[booking.status as BookingStatus];
      const tableStyle = isTableReservationBooking(booking);
      const confirmLabel =
        booking.status === 'Seated' && (nextStatus === 'Booked' || nextStatus === 'Confirmed') && !tableStyle
          ? 'Undo Start'
          : revertAction?.label ?? `Revert to ${nextStatus}`;
      setConfirmDialog({
        title: confirmLabel,
        message: `${booking.guest_name} (${booking.party_size}) at ${booking.booking_time.slice(0, 5)} will be changed from ${booking.status} back to ${nextStatus}.`,
        confirmLabel,
        onConfirm: () => { void updateBookingStatus(booking.id, nextStatus); },
      });
      return;
    }
    if (isDestructiveBookingStatus(nextStatus)) {
      setConfirmDialog({
        title: `Mark ${nextStatus}`,
        message: `${booking.guest_name} (${booking.party_size}) at ${booking.booking_time.slice(0, 5)} will be marked ${nextStatus}.`,
        confirmLabel: `Mark ${nextStatus}`,
        onConfirm: () => { void updateBookingStatus(booking.id, nextStatus); },
      });
      return;
    }
    void updateBookingStatus(booking.id, nextStatus);
  }, [updateBookingStatus, noShowGraceMinutes]);

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
        ? ` (${skipped} selected ${skipped === 1 ? 'booking cannot' : 'bookings cannot'} be cancelled — only active bookings will be updated).`
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
      setSelectedId((cur) => (cur && okIds.includes(cur) ? null : cur));
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
        ? ` (${skipped} selected ${skipped === 1 ? 'booking is' : 'bookings are'} not cancelled — only cancelled bookings will be removed).`
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

  const goToToday = () => setAnchorDate(todayISO());

  const modelScopedBookings = useMemo(() => {
    if (modelFilter === 'all') return bookings;
    return bookings.filter((b) => inferBookingRowModel(b) === modelFilter);
  }, [bookings, modelFilter]);

  const filteredBookings = useMemo(() => {
    let list = modelScopedBookings;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((booking) =>
        booking.guest_name.toLowerCase().includes(q)
        || (booking.guest_phone ?? '').toLowerCase().includes(q)
        || (booking.guest_email ?? '').toLowerCase().includes(q)
        || booking.id.toLowerCase().includes(q)
        || booking.source.toLowerCase().includes(q)
      );
    }
    if (viewMode === 'day' && timeRangeFilterActive) {
      list = list.filter((b) => isBookingTimeInHourRange(b.booking_time, pickerStartHour, pickerEndHour));
    }
    return list;
  }, [
    modelScopedBookings,
    searchQuery,
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

  const stats = useMemo(() => {
    const total = filteredBookings.length;
    const totalCovers = filteredBookings.reduce((sum, b) => sum + b.party_size, 0);
    /** Active = anything not pending/cancelled/no-show. Includes Booked, Confirmed, Seated, Completed. */
    const active = filteredBookings.filter(
      (b) => b.status === 'Booked' || b.status === 'Confirmed' || b.status === 'Seated' || b.status === 'Completed',
    ).length;
    const confirmed = filteredBookings.filter(isAttendanceConfirmed).length;
    const pending = filteredBookings.filter((b) => b.status === 'Pending').length;
    return { total, totalCovers, active, confirmed, pending };
  }, [filteredBookings]);

  const exportCsv = useCallback(() => {
    const esc = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const rows = filteredBookings.map((b) => [
      b.booking_date,
      b.booking_time?.slice(0, 5) ?? '',
      b.guest_name,
      String(b.party_size),
      b.status,
      b.source,
      b.deposit_status,
      b.deposit_amount_pence != null ? (b.deposit_amount_pence / 100).toFixed(2) : '',
      b.dietary_notes ?? '',
      b.occasion ?? '',
      b.guest_phone ?? '',
      b.guest_email ?? '',
    ]);
    const header = [
      'Date', 'Time', 'Guest', 'Party Size', 'Status', 'Source', 'Deposit Status', 'Deposit Amount GBP',
      'Dietary Notes', 'Occasion', 'Phone', 'Email',
    ];
    const csv = [header, ...rows].map((row) => row.map((cell) => esc(String(cell))).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `reservations_${from}_to_${to}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [filteredBookings, from, to]);

  return (
    <PageFrame>
      <PageHeader
        eyebrow="Operations"
        title="Bookings"
        subtitle="Filter by date, status, service, and area. Expand any row for full guest details and actions."
      />
      <div className="space-y-6">
      {realtimeConnected === false && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Updates may be delayed. Reconnecting&hellip;
        </div>
      )}
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

      {showModelFilters && (
        <div className="overflow-x-auto pb-0.5">
          <TabBar<'all' | BookingModel>
            tabs={[
              { id: 'all', label: 'All types' },
              ...filterModels.map((m) => ({ id: m as 'all' | BookingModel, label: bookingModelShortLabel(m) })),
            ]}
            value={modelFilter}
            onChange={setModelFilter}
          />
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="overflow-x-auto pb-0.5">
          <TabBar<ViewMode>
            tabs={[
              { id: 'day', label: 'Day' },
              { id: 'week', label: 'Week' },
              { id: 'month', label: 'Month' },
              { id: 'custom', label: 'Custom' },
            ]}
            value={viewMode}
            onChange={(id) => { setViewMode(id); if (id !== 'custom') setAnchorDate(todayISO()); }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={goToToday} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 shadow-sm">
            Today
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 shadow-sm"
          >
            Export
          </button>
          <button type="button" onClick={() => setNewBookingOpen(true)} className="flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            New Booking
          </button>
          <button type="button" onClick={() => setWalkInOpen(true)} className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 14a7 7 0 0 0-7 7h14a7 7 0 0 0-7-7Z" /></svg>
            Walk-in
          </button>
        </div>
      </div>

      {viewMode !== 'custom' ? (
        viewMode === 'day' ? (
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <CalendarDateTimePicker
              date={anchorDate}
              onDateChange={setAnchorDate}
              startHour={pickerStartHour}
              endHour={pickerEndHour}
              onTimeRangeChange={(start, end) => {
                setStartHourOverride(start);
                setEndHourOverride(end);
                setTimeRangeFilterActive(true);
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
        ) : (
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-4">
            <button type="button" onClick={() => navigate(-1)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-600">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
            </button>
            <div className="min-w-0 flex-1 px-2 text-center">
              <h2 className="truncate text-sm font-semibold text-slate-900 sm:text-base">{formatDateLabel(anchorDate, viewMode)}</h2>
              {anchorDate === todayISO() && <span className="text-xs font-medium text-brand-600">Today</span>}
            </div>
            <button type="button" onClick={() => navigate(1)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-600">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
            </button>
          </div>
        )
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600">From</label>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600">To</label>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500" />
          </div>
          {invalidCustomRange && (
            <p className="text-sm font-medium text-red-600">From date must be before or equal to To date.</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
        <DashboardStatCard label="Bookings" value={stats.total} color="brand" />
        <DashboardStatCard label="Total covers" value={stats.totalCovers} color="violet" />
        <DashboardStatCard label="Confirmed" value={`${stats.confirmed}/${stats.total}`} color="emerald" />
        <DashboardStatCard label="Pending" value={stats.pending} color="amber" />
      </div>
      {/* Confirmed means staff-confirmed, guest-confirmed, or legacy rows with status === 'Confirmed'. */}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5">
        <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex flex-wrap items-center gap-1.5">
            {showServiceBookingsChrome && (
              <select
                value={serviceFilter}
                onChange={(e) => setServiceFilter(e.target.value)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                aria-label="Filter by booking service"
              >
                <option value="all">All services</option>
                {activeDiningServices.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>
            )}
            {showAreaBookingsChrome && (
              <select
                value={filterAreaId ?? ''}
                onChange={(e) => setAreaFilter(e.target.value)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                aria-label="Filter by dining area"
              >
                <option value="">All areas</option>
                {diningAreas
                  .filter((a) => a.is_active)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            )}
            {STATUS_FILTER_OPTIONS.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => setStatusFilter(s.label)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                  statusFilter === s.label
                    ? 'bg-brand-600 text-white shadow-sm ring-1 ring-brand-600/20'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-800'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-64">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search guest, phone, email…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/60 py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-brand-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </div>
        </div>
        {isRefreshing && (
          <div className="border-t border-slate-100 px-5 py-1.5">
            <span className="text-[11px] text-slate-400">Syncing…</span>
          </div>
        )}
      </div>

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
          onToggleExpand={toggleExpand}
          onOpenPanel={setSelectedId}
          onSendMessage={sendMessageToBooking}
          onStatusAction={requestStatusChange}
          onDetailUpdated={handleDetailUpdated}
          showModelBadges={showModelFilters}
          showAreaBadge={showAreaBookingsChrome && !filterAreaId}
          confirmAttendanceLoadingId={confirmAttendanceLoadingId}
          onConfirmBookingAttendance={confirmBookingAttendance}
          onCancelStaffAttendanceConfirmation={cancelStaffAttendanceConfirmation}
          onPrefetchBookingDetail={prefetchBookingDetail}
        />
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedByDate ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([date, dayBookings]) => (
            <div key={date} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-5 py-3">
                <h3 className="text-sm font-semibold text-slate-700">{formatDayHeader(date)}</h3>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>
                    {dayBookings.length} booking{dayBookings.length !== 1 ? 's' : ''}
                  </span>
                  <span>{dayBookings.reduce((s, b) => s + b.party_size, 0)} covers</span>
                </div>
              </div>
              <BookingsAccordionList
                bookings={dayBookings}
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
                onToggleExpand={toggleExpand}
                onOpenPanel={setSelectedId}
                onSendMessage={sendMessageToBooking}
                onStatusAction={requestStatusChange}
                onDetailUpdated={handleDetailUpdated}
                showModelBadges={showModelFilters}
                showAreaBadge={showAreaBookingsChrome && !filterAreaId}
                confirmAttendanceLoadingId={confirmAttendanceLoadingId}
                onConfirmBookingAttendance={confirmBookingAttendance}
                onCancelStaffAttendanceConfirmation={cancelStaffAttendanceConfirmation}
                onPrefetchBookingDetail={prefetchBookingDetail}
              />
            </div>
          ))}
        </div>
      )}

      {bulkGuestMessageOpen && (
        <BulkGuestMessageModal
          onClose={() => setBulkGuestMessageOpen(false)}
          recipientCount={selectedIds.length}
          sending={bulkLoading}
          onSend={(message, channel) => { void runBulkMessage(message, channel); }}
        />
      )}

      {selectedId && (
        <BookingDetailPanel
          bookingId={selectedId}
          venueId={venueId}
          venueCurrency={currency}
          onClose={() => setSelectedId(null)}
          onUpdated={() => {
            if (!selectedId) return;
            setDetailById((prev) => {
              const next = { ...prev };
              delete next[selectedId];
              return next;
            });
            void fetchBookings({ silent: true, ids: [selectedId] });
          }}
        />
      )}
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
      {changeTableBooking && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 backdrop-blur-sm"
          onClick={() => { if (!changeTableSaving) closeChangeTableModal(); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Change table"
            className="my-16 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-slate-900">Change table</h3>
            <p className="mt-2 text-sm text-slate-600">
              Select table(s) for {changeTableBooking.guest_name}. Tables already assigned to this booking are treated as free so you can move or keep them.
            </p>
            {changeTableDayLoading && (
              <p className="mt-2 text-xs text-slate-500">Loading table occupancy for this date…</p>
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
                  confirmLabel={changeTableSaving ? 'Saving…' : 'Save'}
                  skipLabel="Cancel"
                  onConfirm={(ids) => { void confirmChangeTableAssignment(ids); }}
                  onSkip={() => { if (!changeTableSaving) closeChangeTableModal(); }}
                />
              </div>
            )}
            {changeTableSelectorTables.length === 0 && (
              <button
                type="button"
                onClick={closeChangeTableModal}
                className="mt-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            )}
          </div>
        </div>
      )}
      {undoAction && (
        <UndoToast
          action={undoAction}
          onUndo={() => { void undoLastStatusChange(); }}
          onDismiss={() => setUndoAction(null)}
        />
      )}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-[2px]" onClick={() => setConfirmDialog(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100" onClick={(event) => event.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900">{confirmDialog.title}</h3>
            <p className="mt-2 text-sm text-slate-600">{confirmDialog.message}</p>
            <div className="mt-5 flex gap-2.5">
              <button
                type="button"
                onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}
                className="flex-1 rounded-xl bg-red-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
              >
                {confirmDialog.confirmLabel}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      </div>

      {/* Floating bulk-actions tray — appears when rows are selected */}
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
    </PageFrame>
  );
}

function statusBorderClass(status: string): string {
  switch (status) {
    case 'Pending': return 'border-l-amber-400';
    case 'Booked': return 'border-l-sky-400';
    case 'Confirmed': return 'border-l-emerald-500';
    case 'Seated': return 'border-l-brand-500';
    case 'Completed': return 'border-l-slate-300';
    case 'Cancelled': return 'border-l-red-300';
    case 'No-Show': return 'border-l-rose-500';
    default: return 'border-l-transparent';
  }
}

function statusPillVariant(status: string): PillVariant {
  switch (status) {
    case 'Pending': return 'warning';
    case 'Booked': return 'info';
    case 'Confirmed': return 'success';
    case 'Seated': return 'brand';
    case 'Completed': return 'neutral';
    case 'Cancelled': return 'neutral';
    case 'No-Show': return 'danger';
    default: return 'neutral';
  }
}

function sourceBadge(s: string) {
  const variantMap: Record<string, PillVariant> = {
    online: 'brand',
    phone: 'neutral',
    'walk-in': 'warning',
    booking_page: 'brand',
  };
  const label = s === 'booking_page' ? 'online' : s;
  return <Pill variant={variantMap[s] ?? 'neutral'} size="sm">{label}</Pill>;
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

function canShowConfirmBookingAttendanceRow(b: BookingRow): boolean {
  if (b.source === 'walk-in') return false;
  if (showAttendanceConfirmedPill(b)) return false;
  return !['Cancelled', 'No-Show', 'Completed'].includes(b.status);
}

function canShowCancelStaffAttendanceConfirmationRow(b: BookingRow): boolean {
  if (b.source === 'walk-in') return false;
  if (!b.staff_attendance_confirmed_at) return false;
  return !['Cancelled', 'No-Show', 'Completed'].includes(b.status);
}

function BookingsAccordionList({
  bookings,
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
  onToggleExpand,
  onOpenPanel,
  onSendMessage,
  onStatusAction,
  onDetailUpdated,
  showModelBadges = false,
  showAreaBadge = false,
  confirmAttendanceLoadingId,
  onConfirmBookingAttendance,
  onCancelStaffAttendanceConfirmation,
  onPrefetchBookingDetail,
}: {
  bookings: BookingRow[];
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
  onToggleExpand: (id: string) => void;
  onOpenPanel: (id: string) => void;
  onSendMessage: (id: string, message: string, channel?: GuestMessageChannel) => void;
  onStatusAction: (booking: BookingRow, status: BookingStatus) => void;
  onDetailUpdated: (bookingId: string) => void;
  showModelBadges?: boolean;
  showAreaBadge?: boolean;
  confirmAttendanceLoadingId: string | null;
  onConfirmBookingAttendance: (bookingId: string) => void;
  onCancelStaffAttendanceConfirmation: (bookingId: string) => void;
  onPrefetchBookingDetail?: (bookingId: string) => void;
}) {
  const allSelected = bookings.length > 0 && bookings.every((b) => selectedIds.includes(b.id));
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5">
      <div className="border-b border-slate-100 bg-slate-50/60 px-3 py-2 sm:px-4">
        <div className="flex items-center justify-between">
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-500 hover:text-slate-700">
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
          <span className="text-[11px] font-medium text-slate-400">{bookings.length} {bookings.length === 1 ? 'booking' : 'bookings'}</span>
        </div>
      </div>
      <div className="divide-y divide-slate-100">
        {bookings.map((booking) => {
          const expanded = expandedIds.includes(booking.id);
          const detail = detailById[booking.id];
          const detailLoading = detailLoadingIds.includes(booking.id);
          const draftMessage = messageDraftById[booking.id] ?? '';
          const sendingMessage = sendingMessageIds.includes(booking.id);
          return (
            <div
              key={booking.id}
              role="button"
              tabIndex={0}
              aria-expanded={expanded}
              aria-controls={`booking-expand-${booking.id}`}
              onClick={() => onToggleExpand(booking.id)}
              onPointerEnter={() => {
                onPrefetchBookingDetail?.(booking.id);
              }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleExpand(booking.id); } }}
              className={`cursor-pointer border-l-[3px] py-3 pl-3 pr-3 transition-colors sm:pl-4 sm:pr-4 ${statusBorderClass(booking.status)} ${expanded ? 'bg-brand-50/20' : 'hover:bg-slate-50/50'}`}
            >
              <div className="flex items-center gap-2">
                <div onClick={(e) => e.stopPropagation()} className="pt-0.5">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(booking.id)}
                    onChange={(event) => {
                      setSelectedIds((prev) => event.target.checked ? [...prev, booking.id] : prev.filter((id) => id !== booking.id));
                    }}
                    aria-label={`Select booking for ${booking.guest_name}`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-slate-900">{booking.guest_name}</span>
                    <Pill variant={statusPillVariant(booking.status)} size="sm">{booking.status}</Pill>
                    {showAreaBadge && booking.area_name && (
                      <Pill variant="neutral" size="sm">{booking.area_name}</Pill>
                    )}
                    {showDepositPendingPill(booking) && (
                      <Pill variant="warning" size="sm" dot>Deposit pending</Pill>
                    )}
                    {showAttendanceConfirmedPill(booking) && (
                      <Pill variant="success" size="sm" dot>Confirmed</Pill>
                    )}
                    {showModelBadges && (
                      <Pill variant="neutral" size="sm">{bookingModelShortLabel(inferBookingRowModel(booking))}</Pill>
                    )}
                    {booking.dietary_notes && (
                      <span className="hidden sm:inline-flex">
                        <Pill variant="warning" size="sm" dot>Dietary</Pill>
                      </span>
                    )}
                    {booking.table_assignments && booking.table_assignments.length > 0 && (
                      <span className="hidden rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 sm:inline-block">
                        {booking.table_assignments.length === 1
                          ? booking.table_assignments[0]!.name
                          : booking.table_assignments.map((t) => t.name).join(', ')}
                      </span>
                    )}
                    {booking.group_booking_id && (
                      <span className="hidden sm:inline-flex">
                        <Pill variant="neutral" size="sm" className="hidden sm:inline-flex">{booking.person_label ? `Group · ${booking.person_label}` : 'Group'}</Pill>
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    <span className="font-semibold tabular-nums text-slate-700">{booking.booking_time.slice(0, 5)}</span>
                    <span className="text-slate-300">·</span>
                    <span>{booking.party_size} {booking.party_size === 1 ? 'cover' : 'covers'}</span>
                    <span className="text-slate-300">·</span>
                    {sourceBadge(booking.source)}
                    {depositBadge(booking.deposit_status, booking.deposit_amount_pence)}
                  </div>
                </div>
                {(() => {
                  const action = BOOKING_PRIMARY_ACTIONS[booking.status as BookingStatus];
                  const tableStyle = isTableReservationBooking(booking);
                  const primaryLabel =
                    action && action.target === 'Seated' && !tableStyle ? 'Start' : action?.label;
                  const showUndoStart =
                    booking.status === 'Seated' && !tableStyle;
                  const showChangeTable = coversChangeTableEnabled && booking.status === 'Seated';
                  const showAttendanceConfirm = canShowConfirmBookingAttendanceRow(booking);
                  const showAttendanceCancel = canShowCancelStaffAttendanceConfirmationRow(booking);
                  if (!action && !showChangeTable && !showUndoStart && !showAttendanceConfirm && !showAttendanceCancel) {
                    return null;
                  }
                  return (
                     
                    <div onClick={(e) => e.stopPropagation()} className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1.5">
                      {showAttendanceConfirm && (
                        <button
                          type="button"
                          disabled={confirmAttendanceLoadingId === booking.id}
                          onClick={() => onConfirmBookingAttendance(booking.id)}
                          className="inline-flex items-center rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-900 shadow-sm transition-colors hover:bg-teal-100 focus:outline-none focus:ring-2 focus:ring-teal-400/30 disabled:opacity-50"
                          aria-label={`Confirm attendance for ${booking.guest_name}`}
                        >
                          {confirmAttendanceLoadingId === booking.id ? '…' : 'Confirm Booking'}
                        </button>
                      )}
                      {showAttendanceCancel && (
                        <button
                          type="button"
                          disabled={confirmAttendanceLoadingId === booking.id}
                          onClick={() => onCancelStaffAttendanceConfirmation(booking.id)}
                          className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400/30 disabled:opacity-50"
                          aria-label={`Cancel staff attendance confirmation for ${booking.guest_name}`}
                        >
                          {confirmAttendanceLoadingId === booking.id ? '…' : 'Cancel confirmation'}
                        </button>
                      )}
                      {action && (
                        <button
                          type="button"
                          onClick={() => onStatusAction(booking, action.target)}
                          className="inline-flex items-center rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                          aria-label={`${primaryLabel ?? action.label} booking for ${booking.guest_name}`}
                        >
                          {primaryLabel}
                        </button>
                      )}
                      {showUndoStart && (
                        <button
                          type="button"
                          onClick={() => onStatusAction(booking, 'Booked')}
                          className="inline-flex items-center rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 shadow-sm transition-colors hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
                          aria-label={`Undo start for ${booking.guest_name}`}
                        >
                          Undo Start
                        </button>
                      )}
                      {showChangeTable && (
                        <button
                          type="button"
                          onClick={() => onRequestChangeTable(booking)}
                          className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
                          aria-label={`Change table for ${booking.guest_name}`}
                        >
                          Change table
                        </button>
                      )}
                    </div>
                  );
                })()}
                <svg className={`h-4 w-4 flex-shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </div>
              {expanded && (
                <ExpandedBookingContent
                  booking={booking}
                  detail={detail}
                  detailLoading={detailLoading}
                  tableManagementEnabled={tableManagementEnabled}
                  venueId={venueId}
                  draftMessage={draftMessage}
                  sendingMessage={sendingMessage}
                  onMessageDraftChange={(value) => setMessageDraftById((prev) => ({ ...prev, [booking.id]: value }))}
                  onSendMessage={(ch) => { void onSendMessage(booking.id, draftMessage, ch); }}
                  onStatusAction={(status) => { onStatusAction(booking, status); }}
                  onOpenPanel={() => onOpenPanel(booking.id)}
                  onDetailUpdated={() => onDetailUpdated(booking.id)}
                  onRequestChangeTable={coversChangeTableEnabled && booking.status === 'Seated' ? () => onRequestChangeTable(booking) : undefined}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

