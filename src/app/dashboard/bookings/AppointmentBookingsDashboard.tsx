'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';
import { DashboardStaffBookingModal } from '@/components/booking/DashboardStaffBookingModal';
import {
  ExpandedBookingContent,
  type BookingDetailLite,
  type BookingRow,
} from './ExpandedBookingContent';
import { BookingDetailPanel, type BookingDetailPanelSnapshot } from './BookingDetailPanel';
import { expandedBookingRowShellClass } from '@/app/dashboard/bookings/booking-expand-accordion-classes';
import { bindDetailPrefetchHandlers } from '@/lib/dashboard/detail-prefetch-intent';
import { bookingDetailLiteFromCachePayload } from '@/lib/booking/resolve-booking-detail-lite';
import { bookingDetailLiteFromListRow } from '@/lib/booking/booking-detail-from-row';
import { warmIdsWithConcurrency } from '@/lib/dashboard/venue-detail-swr';
import type { RegistryAppointment } from '@/components/booking/AppointmentRegistryCard';
import { OperationsWorkspaceToolbar } from '@/components/dashboard/OperationsWorkspaceToolbar';
import { OperationsToolbarGuestSearchPanel } from '@/components/dashboard/OperationsToolbarGuestSearchPanel';
import { PageFrame } from '@/components/ui/dashboard/PageFrame';
import { EmptyState } from '@/components/ui/dashboard/EmptyState';
import { currencySymbolFromCode } from '@/lib/money/currency-symbol';
import { useToast } from '@/components/ui/Toast';
import { readResponseJson } from '@/lib/http/read-response-json';
import { formatMoneyPence } from '@/lib/appointments-csv';
import type { BookingModel } from '@/types/booking-models';
import { BOOKING_MODEL_ORDER, venueExposesBookingModel } from '@/lib/booking/enabled-models';
import { inferBookingRowModel, bookingModelShortLabel, isTableReservationBooking } from '@/lib/booking/infer-booking-row-model';
import {
  isAttendanceConfirmed,
  showAttendanceConfirmedSupplementPill,
  showDepositPendingPill,
} from '@/lib/booking/booking-staff-indicators';
import {
  applyBookingRowOverlayFields,
  overlayFromPatchPayload,
} from '@/lib/booking/booking-row-overlay';
import { bookingStatusVisualForKey } from '@/lib/table-management/booking-status-visual';
import { BookingStatusPill } from '@/components/ui/dashboard/BookingStatusPill';
import { Pill, type PillVariant } from '@/components/ui/dashboard/Pill';
import { CalendarDateTimePicker } from '@/components/calendar/CalendarDateTimePicker';
import { getCalendarGridBounds } from '@/lib/venue-calendar-bounds';
import { isBookingTimeInHourRange } from '@/lib/booking-time-window';
import type { OpeningHours } from '@/types/availability';
import { BulkGuestMessageModal } from '@/components/booking/BulkGuestMessageModal';
import type { GuestMessageChannel, GuestMessageSendResult } from '@/lib/booking/guest-message-channel';
import { ClampedFixedDropdown } from '@/components/ui/ClampedFixedDropdown';
import { Skeleton } from '@/components/ui/Skeleton';
import { LinkedBookingsPanel } from '@/components/linked-accounts/LinkedBookingsPanel';
import {
  useDashboardDetailCache,
  type VenueBookingDetailPayload,
} from '@/components/providers/DashboardDetailCacheProvider';

type SourceScope = 'all' | 'own' | 'linked';

type ViewMode = 'day' | 'week' | 'month' | 'custom';

interface Practitioner {
  id: string;
  name: string;
  is_active: boolean;
}

interface AppointmentService {
  id: string;
  name: string;
  duration_minutes: number;
  price_pence: number | null;
  colour?: string;
}

interface StatusFilterOption {
  label: string;
  apiValue: string | null;
  attendanceConfirmed?: boolean;
  excludeAttendanceConfirmed?: boolean;
}

const STATUS_FILTERS: StatusFilterOption[] = [
  { label: 'All', apiValue: null },
  { label: 'Pending', apiValue: 'Pending' },
  { label: 'Booked', apiValue: 'Booked', excludeAttendanceConfirmed: true },
  /** Guest confirmed via link or staff confirmed attendance, including legacy `status = 'Confirmed'`. */
  { label: 'Confirmed', apiValue: null, attendanceConfirmed: true },
  { label: 'Started', apiValue: 'Seated' },
  { label: 'Completed', apiValue: 'Completed' },
  { label: 'Cancelled', apiValue: 'Cancelled' },
  { label: 'No show', apiValue: 'No-Show' },
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function endOfMonth(date: string): string {
  const [y, m] = date.split('-').map(Number);
  const last = new Date(y!, m!, 0).getDate();
  return `${date.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatDateLabel(date: string, mode: ViewMode): string {
  const d = new Date(`${date}T12:00:00`);
  if (mode === 'day') {
    return `${WEEKDAYS_LONG[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
  }
  if (mode === 'week') {
    const end = new Date(`${addDays(date, 6)}T12:00:00`);
    return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} \u2013 ${end.getDate()} ${MONTHS_SHORT[end.getMonth()]} ${end.getFullYear()}`;
  }
  if (mode === 'month') return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
  return '';
}

function formatDayHeader(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

function columnIdForRegistry(b: RegistryAppointment): string | null {
  return b.practitioner_id ?? b.calendar_id ?? null;
}

function serviceIdForRegistry(b: RegistryAppointment): string | null {
  return b.appointment_service_id ?? b.service_item_id ?? null;
}

function rowForInference(b: RegistryAppointment): Parameters<typeof inferBookingRowModel>[0] {
  return {
    booking_model: b.booking_model,
    experience_event_id: b.experience_event_id,
    class_instance_id: b.class_instance_id,
    resource_id: b.resource_id,
    event_session_id: b.event_session_id,
    calendar_id: b.calendar_id,
    service_item_id: b.service_item_id,
    practitioner_id: b.practitioner_id,
    appointment_service_id: b.appointment_service_id,
  };
}

function inferRegistryModel(b: RegistryAppointment): BookingModel {
  return inferBookingRowModel(rowForInference(b));
}

/** Left-edge status strip - same palette as table grid / main bookings list. */
function statusBorderClass(b: RegistryAppointment): string {
  return bookingStatusVisualForKey(b.status).listBorderLeft;
}

function bookingTypePillVariant(model: BookingModel): PillVariant {
  switch (model) {
    case 'unified_scheduling':
    case 'practitioner_appointment':
      return 'brand';
    case 'event_ticket':
      return 'info';
    case 'class_session':
      return 'success';
    case 'resource_booking':
      return 'warning';
    default:
      return 'neutral';
  }
}

function sourcePillVariant(source: string): PillVariant {
  if (source === 'online' || source === 'booking_page') return 'brand';
  if (source === 'walk-in') return 'warning';
  return 'neutral';
}

function sourceLabelShort(source: string): string {
  if (source === 'booking_page' || source === 'online') return 'Online';
  if (source === 'walk-in') return 'Walk-in';
  if (source === 'phone') return 'Phone';
  return source.replace(/_/g, ' ');
}

function depositPillVariant(status: string): PillVariant {
  const s = status.toLowerCase();
  if (s === 'paid' || s === 'captured') return 'success';
  if (s === 'pending' || s === 'requires_action') return 'warning';
  if (s === 'refunded' || s === 'cancelled' || s === 'failed') return 'danger';
  return 'neutral';
}

const CDE_MODELS = new Set<BookingModel>(['event_ticket', 'class_session', 'resource_booking']);

function isCdeModel(m: BookingModel): boolean {
  return CDE_MODELS.has(m);
}

/** When a staff member filter is set, still show event/class/resource rows (they are venue-wide, not tied to one practitioner). When service filter is set, still show those rows so enabled secondaries are not hidden. */
function filterRegistryAppointments(
  list: RegistryAppointment[],
  practitionerFilter: 'all' | string,
  serviceFilter: 'all' | string,
  searchQuery: string,
  primary: BookingModel,
  enabledModels: BookingModel[],
): RegistryAppointment[] {
  let result = list;
  if (practitionerFilter !== 'all') {
    result = result.filter((b) => {
      const inferred = inferRegistryModel(b);
      if (isCdeModel(inferred) && venueExposesBookingModel(primary, enabledModels, inferred)) {
        return true;
      }
      return columnIdForRegistry(b) === practitionerFilter;
    });
  }
  if (serviceFilter !== 'all') {
    result = result.filter((b) => {
      const inferred = inferRegistryModel(b);
      if (isCdeModel(inferred) && venueExposesBookingModel(primary, enabledModels, inferred)) {
        return true;
      }
      return serviceIdForRegistry(b) === serviceFilter;
    });
  }
  const q = searchQuery.trim().toLowerCase();
  if (!q) return result;
  return result.filter(
    (b) =>
      b.guest_name.toLowerCase().includes(q) ||
      (b.guest_phone ?? '').toLowerCase().includes(q) ||
      (b.guest_email ?? '').toLowerCase().includes(q) ||
      (b.booking_item_name ?? '').toLowerCase().includes(q) ||
      b.id.toLowerCase().includes(q) ||
      b.id.replace(/-/g, '').toLowerCase().includes(q.replace(/-/g, '')),
  );
}

function timeToMinutesHHMM(t: string): number {
  const [hh, mm] = t.slice(0, 5).split(':').map(Number);
  return (hh ?? 0) * 60 + (mm ?? 0);
}

/**
 * Collapsed list bar should match the slot wall times (and expanded detail), not only the catalogue default.
 * Aligns with practitioner grid `bookingDurationMinutes`: `booking_end_time` wins when present.
 */
function registryAppointmentDurationMinutes(
  b: RegistryAppointment,
  serviceDefaultMinutes: number | null,
): number | null {
  const endRaw = b.booking_end_time;
  if (typeof endRaw === 'string' && endRaw.trim().length >= 5) {
    const startM = timeToMinutesHHMM(b.booking_time);
    let endM = timeToMinutesHHMM(endRaw);
    if (endM <= startM) endM += 24 * 60;
    const span = endM - startM;
    return span > 0 ? span : null;
  }
  return serviceDefaultMinutes;
}

function registryToExpandedBookingRow(b: RegistryAppointment): BookingRow {
  return {
    id: b.id,
    booking_date: b.booking_date,
    booking_time: b.booking_time,
    estimated_end_time: b.booking_end_time ? `${b.booking_date}T${b.booking_end_time.slice(0, 5)}:00.000Z` : null,
    created_at: null,
    party_size: b.party_size,
    status: b.status,
    source: b.source,
    deposit_status: b.deposit_status,
    deposit_amount_pence: b.deposit_amount_pence,
    dietary_notes: null,
    occasion: null,
    guest_name: b.guest_name,
    guest_email: b.guest_email,
    guest_phone: b.guest_phone,
    guest_id: b.guest_id,
    client_arrived_at: b.client_arrived_at,
    guest_attendance_confirmed_at: b.guest_attendance_confirmed_at ?? null,
    staff_attendance_confirmed_at: b.staff_attendance_confirmed_at ?? null,
    practitioner_id: b.practitioner_id,
    calendar_id: b.calendar_id,
    appointment_service_id: b.appointment_service_id,
    experience_event_id: b.experience_event_id,
    class_instance_id: b.class_instance_id,
    resource_id: b.resource_id,
    event_session_id: b.event_session_id,
    service_item_id: b.service_item_id,
    booking_end_time: b.booking_end_time,
    service_variant_id: b.service_variant_id ?? null,
    processing_time_blocks: b.processing_time_blocks ?? null,
    inferred_booking_model: inferRegistryModel(b),
    booking_model: b.booking_model,
  };
}

type SortKey = 'date' | 'time' | 'type' | 'client' | 'service' | 'practitioner' | 'status' | 'deposit';

const GUEST_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function AppointmentBookingsDashboard({
  venueId,
  currency = 'GBP',
  primaryBookingModel = 'unified_scheduling',
  enabledModels = [],
  defaultPractitionerFilter = 'all',
  linkedPractitionerIds = [],
  initialTodayIso,
}: {
  venueId: string;
  currency?: string;
  primaryBookingModel?: BookingModel;
  enabledModels?: BookingModel[];
  /** Server-resolved: staff linked to a calendar default to their practitioner id; admins use `all`. */
  defaultPractitionerFilter?: 'all' | string;
  /** Bookable calendars this staff user manages. */
  linkedPractitionerIds?: string[];
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
  const myCalendarIds = useMemo(() => linkedPractitionerIds, [linkedPractitionerIds]);
  const sym = currencySymbolFromCode(currency);
  const todayIso = initialTodayIso ?? todayISO();
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [anchorDate, setAnchorDate] = useState(todayIso);
  const [customFrom, setCustomFrom] = useState(todayIso);
  const [customTo, setCustomTo] = useState(addDays(todayIso, 7));
  const [viewRangePopoverOpen, setViewRangePopoverOpen] = useState(false);
  const viewRangeTriggerRef = useRef<HTMLButtonElement>(null);
  const viewRangeWrapRef = useRef<HTMLDivElement>(null);
  const viewRangePanelId = useId();
  const [statusKey, setStatusKey] = useState<string>('All');
  const [practitionerFilter, setPractitionerFilter] = useState<'all' | string>(defaultPractitionerFilter);
  const [serviceFilter, setServiceFilter] = useState<'all' | string>('all');
  const [modelFilter, setModelFilter] = useState<'all' | BookingModel>('all');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [guestToolbarSearchQuery, setGuestToolbarSearchQuery] = useState('');
  const [bookings, setBookings] = useState<RegistryAppointment[]>([]);
  /** All statuses in range - used for summary tiles (list may be status-filtered). */
  const [allStatusBookings, setAllStatusBookings] = useState<RegistryAppointment[]>([]);
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [services, setServices] = useState<AppointmentService[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState<boolean | null>(null);
  /** Appointment rows expanded inline in the list. */
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [guestHistoryRevisionById, setGuestHistoryRevisionById] = useState<Record<string, number>>({});
  const [relatedGuestHistoryBooking, setRelatedGuestHistoryBooking] = useState<{
    bookingId: string;
    snapshot: BookingDetailPanelSnapshot;
    isAppointment: boolean;
  } | null>(null);
  const [detailById, setDetailById] = useState<Record<string, BookingDetailLite>>({});
  const [detailLoadingIds, setDetailLoadingIds] = useState<string[]>([]);
  const searchParams = useSearchParams();
  const router = useRouter();
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [newBookingOpen, setNewBookingOpen] = useState(false);
  const [openingHours, setOpeningHours] = useState<OpeningHours | null>(null);
  const [venueTimezone, setVenueTimezone] = useState<string>('Europe/London');
  const [startHourOverride, setStartHourOverride] = useState<number | null>(null);
  const [endHourOverride, setEndHourOverride] = useState<number | null>(null);
  /** When true, day view list/stats are filtered to the hour window from the time dropdown. */
  const [timeRangeFilterActive, setTimeRangeFilterActive] = useState(false);
  const [selectedBookingIds, setSelectedBookingIds] = useState<string[]>([]);
  const [bulkGuestMessageOpen, setBulkGuestMessageOpen] = useState(false);
  const [bulkGuestMessageSending, setBulkGuestMessageSending] = useState(false);
  const [messageDraftById, setMessageDraftById] = useState<Record<string, string>>({});
  const [sendingMessageIds, setSendingMessageIds] = useState<string[]>([]);
  /** Own / linked-in / all source filter (section 8.2). */
  const [sourceScope, setSourceScope] = useState<SourceScope>('all');
  /** True once the venue is known to hold at least one linked calendar. */
  const [linkedAvailable, setLinkedAvailable] = useState(false);

  const selectedStatusFilter = STATUS_FILTERS.find((f) => f.label === statusKey);

  const filterGuestId = useMemo(() => {
    const g = searchParams.get('guest');
    return g && GUEST_UUID_RE.test(g) ? g : null;
  }, [searchParams]);

  const showModelFilters = enabledModels.length > 0;
  const filterModels = useMemo(() => {
    const uniq = new Set<BookingModel>([primaryBookingModel, ...enabledModels]);
    return [...uniq].sort((a, b) => BOOKING_MODEL_ORDER.indexOf(a) - BOOKING_MODEL_ORDER.indexOf(b));
  }, [primaryBookingModel, enabledModels]);
  const statsPrimaryLabel = enabledModels.length > 0 ? 'Bookings' : 'Appointments';

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

  const clearGuestFilter = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete('guest');
    const qs = next.toString();
    router.replace(qs ? `/dashboard/bookings?${qs}` : '/dashboard/bookings', { scroll: false });
  }, [router, searchParams]);

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
        setDetailLoadingIds((prev) => (prev.includes(bookingId) ? prev : [...prev, bookingId]));
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
        setBookings((rows) =>
          rows.map((booking) =>
            booking.id === bookingId && data.inferred_booking_model
              ? { ...booking, booking_model: data.inferred_booking_model }
              : booking,
          ),
        );
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
        await warmVenueBookingDetail(bookingId);
        const lite = bookingDetailLiteFromCachePayload(bookingId, peekVenueBookingDetail(bookingId));
        if (!lite) return;
        setDetailById((prev) => (prev[bookingId] ? prev : { ...prev, [bookingId]: lite }));
      })();
    },
    [peekVenueBookingDetail, warmVenueBookingDetail],
  );

  /** Legacy filter label before "Started" rename. */
  useEffect(() => {
    if (statusKey === 'In progress') setStatusKey('Started');
  }, [statusKey]);

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

  const { from, to } = useMemo(() => {
    if (viewMode === 'day') return { from: anchorDate, to: anchorDate };
    if (viewMode === 'week') return { from: anchorDate, to: addDays(anchorDate, 6) };
    if (viewMode === 'month') return { from: startOfMonth(anchorDate), to: endOfMonth(anchorDate) };
    return { from: customFrom, to: customTo };
  }, [viewMode, anchorDate, customFrom, customTo]);

  const invalidCustomRange = viewMode === 'custom' && customFrom > customTo;

  const serviceMap = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const practitionerMap = useMemo(
    () => new Map(practitioners.filter((p) => p.is_active).map((p) => [p.id, p])),
    [practitioners],
  );

  const fetchBookings = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (invalidCustomRange) {
        setError('Custom date range is invalid. "From" must be before or equal to "To".');
        setLoading(false);
        return;
      }
      if (silent) setIsRefreshing(true);
      else setLoading(true);
      if (!silent) setError(null);
      try {
        const params = new URLSearchParams(
          viewMode === 'day' ? { date: from } : { from, to },
        );
        if (selectedStatusFilter?.attendanceConfirmed) {
          params.set('attendance_confirmed', '1');
        } else if (selectedStatusFilter?.apiValue) {
          params.set('status', selectedStatusFilter.apiValue);
        }
        if (filterGuestId) params.set('guest', filterGuestId);
        const res = await fetch(`/api/venue/bookings/list?${params}`);
        const data = await readResponseJson<{ error?: string; bookings?: unknown[] }>(res);
        if (!res.ok) {
          setError(data.error ?? 'Failed to load appointments');
          return;
        }
        const raw = (data.bookings ?? []) as RegistryAppointment[];
        let visible = raw.filter((b) =>
          venueExposesBookingModel(primaryBookingModel, enabledModels, inferRegistryModel(b)),
        );
        if (selectedStatusFilter?.excludeAttendanceConfirmed) {
          visible = visible.filter((booking) => !isAttendanceConfirmed(booking));
        }
        setBookings(visible);
      } catch {
        setError('Network error loading appointments');
      } finally {
        if (silent) setIsRefreshing(false);
        else setLoading(false);
      }
    },
    [filterGuestId, from, to, viewMode, invalidCustomRange, primaryBookingModel, enabledModels, selectedStatusFilter],
  );


  const fetchBookingsForStats = useCallback(async () => {
    if (invalidCustomRange) {
      setAllStatusBookings([]);
      return;
    }
    try {
      const params = new URLSearchParams(viewMode === 'day' ? { date: from } : { from, to });
      if (filterGuestId) params.set('guest', filterGuestId);
      const res = await fetch(`/api/venue/bookings/list?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      const raw = (data.bookings ?? []) as RegistryAppointment[];
      setAllStatusBookings(
        raw.filter((b) =>
          venueExposesBookingModel(primaryBookingModel, enabledModels, inferRegistryModel(b)),
        ),
      );
    } catch {
      setAllStatusBookings([]);
    }
  }, [filterGuestId, from, to, viewMode, invalidCustomRange, primaryBookingModel, enabledModels]);

  useEffect(() => {
    void fetchBookings();
  }, [fetchBookings]);

  useEffect(() => {
    void fetchBookingsForStats();
  }, [fetchBookingsForStats]);

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
      .catch((e) => console.error('[AppointmentBookingsDashboard] /api/venue preload failed:', e));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/venue/practitioners?roster=1')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setPractitioners(data.practitioners ?? []);
      })
      .catch(() => {
        if (!cancelled) setPractitioners([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/venue/appointment-services')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setServices(data.services ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setServices([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('appointments-registry')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `venue_id=eq.${venueId}` },
        () => {
          void fetchBookings({ silent: true });
          void fetchBookingsForStats();
        },
      )
      .subscribe((status) => {
        setRealtimeConnected(status === 'SUBSCRIBED');
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [venueId, fetchBookings, fetchBookingsForStats]);

  const registryFiltered = useMemo(
    () =>
      filterRegistryAppointments(
        bookings,
        practitionerFilter,
        serviceFilter,
        '',
        primaryBookingModel,
        enabledModels,
      ),
    [bookings, practitionerFilter, serviceFilter, primaryBookingModel, enabledModels],
  );

  const filteredBookings = useMemo(() => {
    let list = modelFilter === 'all' ? registryFiltered : registryFiltered.filter((b) => inferRegistryModel(b) === modelFilter);
    if (viewMode === 'day' && timeRangeFilterActive) {
      list = list.filter((b) => isBookingTimeInHourRange(b.booking_time, pickerStartHour, pickerEndHour));
    }
    return list;
  }, [
    registryFiltered,
    modelFilter,
    viewMode,
    timeRangeFilterActive,
    pickerStartHour,
    pickerEndHour,
  ]);

  const statsBookings = useMemo(() => {
    let reg = filterRegistryAppointments(
      allStatusBookings,
      practitionerFilter,
      serviceFilter,
      '',
      primaryBookingModel,
      enabledModels,
    );
    if (modelFilter !== 'all') reg = reg.filter((b) => inferRegistryModel(b) === modelFilter);
    if (viewMode === 'day' && timeRangeFilterActive) {
      reg = reg.filter((b) => isBookingTimeInHourRange(b.booking_time, pickerStartHour, pickerEndHour));
    }
    return reg;
  }, [
    allStatusBookings,
    practitionerFilter,
    serviceFilter,
    primaryBookingModel,
    enabledModels,
    modelFilter,
    viewMode,
    timeRangeFilterActive,
    pickerStartHour,
    pickerEndHour,
  ]);

  const sortedBookings = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const list = [...filteredBookings];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'date':
          cmp = a.booking_date.localeCompare(b.booking_date);
          if (cmp === 0) cmp = a.booking_time.localeCompare(b.booking_time);
          break;
        case 'time':
          cmp = a.booking_time.localeCompare(b.booking_time);
          if (cmp === 0) cmp = a.booking_date.localeCompare(b.booking_date);
          break;
        case 'type':
          cmp = bookingModelShortLabel(inferRegistryModel(a)).localeCompare(
            bookingModelShortLabel(inferRegistryModel(b)),
            undefined,
            { sensitivity: 'base' },
          );
          break;
        case 'client':
          cmp = a.guest_name.localeCompare(b.guest_name, undefined, { sensitivity: 'base' });
          break;
        case 'service': {
          const sa =
            a.booking_item_name?.trim() ||
            (() => {
              const id = serviceIdForRegistry(a);
              return id ? serviceMap.get(id)?.name ?? '' : '';
            })();
          const sb =
            b.booking_item_name?.trim() ||
            (() => {
              const id = serviceIdForRegistry(b);
              return id ? serviceMap.get(id)?.name ?? '' : '';
            })();
          cmp = sa.localeCompare(sb, undefined, { sensitivity: 'base' });
          break;
        }
        case 'practitioner': {
          const pa = (() => {
            const id = columnIdForRegistry(a);
            return id ? practitionerMap.get(id)?.name ?? '' : '';
          })();
          const pb = (() => {
            const id = columnIdForRegistry(b);
            return id ? practitionerMap.get(id)?.name ?? '' : '';
          })();
          cmp = pa.localeCompare(pb, undefined, { sensitivity: 'base' });
          break;
        }
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
        case 'deposit':
          cmp = (a.deposit_amount_pence ?? 0) - (b.deposit_amount_pence ?? 0);
          break;
        default:
          break;
      }
      return cmp * dir;
    });
    return list;
  }, [filteredBookings, sortKey, sortDir, serviceMap, practitionerMap]);

  useEffect(() => {
    if (sortedBookings.length === 0) return;
    const ids = sortedBookings
      .filter((b) => b.status !== 'Cancelled')
      .slice(0, 28)
      .map((b) => b.id);
    const scheduleIdle =
      typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback.bind(window)
        : (cb: IdleRequestCallback) =>
            window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 60);
    const idleHandle = scheduleIdle(() => {
      void warmIdsWithConcurrency(ids, warmVenueBookingDetail);
    });
    return () => {
      if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleHandle);
      } else {
        window.clearTimeout(idleHandle);
      }
    };
  }, [sortedBookings, warmVenueBookingDetail]);

  async function updateRowStatus(bookingId: string, nextStatus: string) {
    const prev = bookings.find((x) => x.id === bookingId);
    if (!prev) return;
    setBookings((rows) =>
      rows.map((r) => {
        if (r.id !== bookingId) return r;
        const updated: RegistryAppointment = { ...r, status: nextStatus };
        if (prev.status === 'Confirmed' && nextStatus === 'Booked') {
          updated.staff_attendance_confirmed_at = null;
          updated.guest_attendance_confirmed_at = null;
        } else if (nextStatus === 'Confirmed' && prev.status !== 'Confirmed') {
          updated.staff_attendance_confirmed_at = new Date().toISOString();
        }
        return updated;
      }),
    );
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        addToast((j as { error?: string }).error ?? 'Could not update status', 'error');
        setBookings((rows) => rows.map((r) => (r.id === bookingId ? prev : r)));
        return;
      }
      const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (payload && typeof payload === 'object' && !('error' in payload)) {
        setBookings((rows) =>
          rows.map((r) =>
            r.id === bookingId
              ? applyBookingRowOverlayFields(r, overlayFromPatchPayload(payload))
              : r,
          ),
        );
      }
      void fetchBookingsForStats();
    } catch {
      addToast('Could not update status', 'error');
      setBookings((rows) => rows.map((r) => (r.id === bookingId ? prev : r)));
    }
  }

  const groupedByDate = useMemo(() => {
    if (viewMode === 'day') return null;
    const groups: Record<string, RegistryAppointment[]> = {};
    for (const b of sortedBookings) {
      (groups[b.booking_date] ??= []).push(b);
    }
    return groups;
  }, [sortedBookings, viewMode]);

  const sortedDayEntries = useMemo(() => {
    if (!groupedByDate) return [];
    const dayOrder = sortKey === 'date' && sortDir === 'desc' ? -1 : 1;
    return Object.entries(groupedByDate).sort(([a], [b]) => a.localeCompare(b) * dayOrder);
  }, [groupedByDate, sortKey, sortDir]);

  const stats = useMemo(() => {
    const total = statsBookings.length;
    const confirmed = statsBookings.filter(isAttendanceConfirmed).length;
    const completed = statsBookings.filter((b) => b.status === 'Completed').length;
    const noShows = statsBookings.filter((b) => b.status === 'No-Show').length;
    return { total, confirmed, completed, noShows };
  }, [statsBookings]);

  function tableStatusLabel(s: string): string {
    if (s === 'Seated') return 'Started';
    if (s === 'No-Show') return 'No show';
    return s;
  }

  const navigate = (direction: -1 | 1) => {
    if (viewMode === 'day') setAnchorDate(addDays(anchorDate, direction));
    else if (viewMode === 'week') setAnchorDate(addDays(anchorDate, direction * 7));
    else if (viewMode === 'month') {
      const d = new Date(`${anchorDate}T12:00:00`);
      d.setMonth(d.getMonth() + direction);
      setAnchorDate(d.toISOString().slice(0, 10));
    }
  };

  const activePractitioners = useMemo(() => practitioners.filter((p) => p.is_active), [practitioners]);

  const toggleBookingSelected = useCallback((id: string, checked: boolean) => {
    setSelectedBookingIds((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
  }, []);

  const toggleAllInList = useCallback((list: RegistryAppointment[], checked: boolean) => {
    setSelectedBookingIds((prev) => {
      const ids = new Set(list.map((b) => b.id));
      if (checked) return [...new Set([...prev, ...ids])];
      return prev.filter((bid) => !ids.has(bid));
    });
  }, []);

  const runBulkGuestMessage = useCallback(
    async (message: string, channel: GuestMessageChannel) => {
      if (selectedBookingIds.length === 0) return;
      setBulkGuestMessageSending(true);
      setError(null);
      try {
        const ids = [...selectedBookingIds];
        const outcomes = await Promise.all(
          ids.map(async (bookingId) => {
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
          }),
        );
        const okCount = outcomes.filter((o) => o.sent).length;
        const failureSummaries = outcomes
          .map((o, idx) => (!o.sent && o.issues ? `Guest ${idx + 1}: ${o.issues}` : null))
          .filter((entry): entry is string => entry !== null);
        if (okCount === ids.length) {
          addToast(`Message sent to ${okCount} guest(s)`, 'success');
        } else if (okCount > 0) {
          setError(
            `Sent to ${okCount}/${ids.length}. ${failureSummaries.slice(0, 3).join(' Â· ')}`,
          );
          addToast(`Sent to ${okCount}/${ids.length}`, 'error');
        } else {
          const first = failureSummaries[0] ?? 'No messages were sent.';
          setError(first);
          addToast(first, 'error');
        }
        setSelectedBookingIds([]);
        setBulkGuestMessageOpen(false);
      } finally {
        setBulkGuestMessageSending(false);
      }
    },
    [addToast, selectedBookingIds],
  );

  const sendGuestMessage = useCallback(
    async (bookingId: string, message: string, channel: GuestMessageChannel): Promise<GuestMessageSendResult> => {
      const trimmed = message.trim();
      if (!trimmed) {
        return { ok: false, error: 'Message cannot be empty.' };
      }
      setSendingMessageIds((prev) => (prev.includes(bookingId) ? prev : [...prev, bookingId]));
      try {
        const res = await fetch(`/api/venue/bookings/${bookingId}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: trimmed, channel }),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
          errors?: string[];
        };
        if (!res.ok || !payload.success) {
          const issues = payload.errors?.join('; ') || payload.error || 'Could not send message';
          addToast(issues, 'error');
          return { ok: false, error: issues };
        }
        if (payload.errors && payload.errors.length > 0) {
          const w = payload.errors.join('; ');
          setMessageDraftById((prev) => ({ ...prev, [bookingId]: '' }));
          invalidateVenueBookingDetail(bookingId);
          setDetailById((prev) => {
            const next = { ...prev };
            delete next[bookingId];
            return next;
          });
          void loadBookingDetail(bookingId, true);
          addToast(`Sent with issues \u2014 ${w}`, 'error');
          return { ok: true, warning: `Sent with issues: ${w}` };
        }
        setMessageDraftById((prev) => ({ ...prev, [bookingId]: '' }));
        invalidateVenueBookingDetail(bookingId);
        setDetailById((prev) => {
          const next = { ...prev };
          delete next[bookingId];
          return next;
        });
        void loadBookingDetail(bookingId, true);
        addToast('Message sent', 'success');
        return { ok: true };
      } catch {
        addToast('Could not send message', 'error');
        return { ok: false, error: 'Could not send message.' };
      } finally {
        setSendingMessageIds((prev) => prev.filter((id) => id !== bookingId));
      }
    },
    [addToast, invalidateVenueBookingDetail, loadBookingDetail],
  );

  const toggleExpanded = useCallback(
    (id: string) => {
      setExpandedIds((prev) => {
        if (prev.includes(id)) return [];
        return [id];
      });
      const row = bookings.find((b) => b.id === id);
      const fromCache = bookingDetailLiteFromCachePayload(id, peekVenueBookingDetail(id));
      const fromRow = row ? bookingDetailLiteFromListRow(row) : undefined;
      const seed = fromCache ?? fromRow;
      if (seed) {
        setDetailById((prev) => (prev[id] ? prev : { ...prev, [id]: seed }));
      }
      void loadBookingDetail(id);
    },
    [bookings, loadBookingDetail, peekVenueBookingDetail],
  );

  function SortControl() {
    const options: Array<{ key: SortKey; label: string }> = [
      { key: 'date', label: 'Date' },
      { key: 'time', label: 'Time' },
      { key: 'client', label: 'Client' },
      { key: 'status', label: 'Status' },
      { key: 'service', label: 'Service' },
      { key: 'practitioner', label: 'Staff' },
      { key: 'deposit', label: 'Deposit' },
      { key: 'type', label: 'Type' },
    ];
    /** Matches OperationsWorkspaceToolbar compact "Today" control sizing and weight. */
    const sortTriggerClass =
      'min-h-8 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 sm:text-xs';
    return (
      <div className="flex w-full min-w-0 flex-col gap-1.5 sm:w-auto sm:flex-row sm:items-center sm:gap-2">
        <label htmlFor="appt-sort-key" className="shrink-0 text-[11px] font-semibold text-slate-500 sm:text-xs">
          Sort
        </label>
        <div className="flex min-w-0 flex-1 items-center gap-1 sm:flex-none">
          <select
            id="appt-sort-key"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className={`${sortTriggerClass} min-w-0 flex-1 sm:max-w-[10rem] sm:flex-none`}
            aria-label="Sort by"
          >
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            className={`${sortTriggerClass} inline-flex shrink-0 items-center gap-1`}
            aria-label={`Sort direction: ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
          >
            <span aria-hidden>{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>
            <span>{sortDir === 'asc' ? 'Asc' : 'Desc'}</span>
          </button>
        </div>
      </div>
    );
  }

  function renderAppointmentCards(
    list: RegistryAppointment[],
    opts?: { nested?: boolean; showSort?: boolean },
  ) {
    const nested = opts?.nested ?? false;
    const showSort = opts?.showSort ?? !nested;
    const allSelected =
      list.length > 0 && list.every((b) => selectedBookingIds.includes(b.id));
    return (
      <div
        className={
          nested
            ? 'overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5'
            : 'overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5'
        }
      >
        <div className="flex flex-col gap-2 border-b border-slate-200/90 bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4">
          <label className="inline-flex min-w-0 cursor-pointer items-center gap-2 text-[11px] font-semibold text-slate-600 hover:text-slate-800 sm:text-xs">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) => toggleAllInList(list, e.target.checked)}
              aria-label="Select all bookings in this list"
            />
            Select all
          </label>
          <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end sm:gap-3">
            {showSort ? <SortControl /> : null}
            <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-500 sm:text-xs">
              {list.length} {list.length === 1 ? 'booking' : 'bookings'}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-2.5 bg-slate-100 p-2 sm:gap-3 sm:p-3">
          {list.map((b) => renderAppointmentRow(b))}
        </div>
      </div>
    );
  }

  function renderAppointmentRow(b: RegistryAppointment) {
    const cid = columnIdForRegistry(b);
    const sid = serviceIdForRegistry(b);
    const pracName = cid ? practitionerMap.get(cid)?.name ?? '-' : '-';
    const svcName =
      b.booking_item_name?.trim() ||
      (sid ? serviceMap.get(sid)?.name ?? '' : '') ||
      '-';
    const svc = sid ? serviceMap.get(sid) ?? null : null;
    const bookingModel = inferRegistryModel(b);
    const typeLabel = bookingModelShortLabel(bookingModel);
    const expanded = expandedIds.includes(b.id);
    const startTime = b.booking_time.slice(0, 5);
    const endTime = b.booking_end_time ? b.booking_end_time.slice(0, 5) : null;
    const duration = registryAppointmentDurationMinutes(b, svc?.duration_minutes ?? null);
    const priceDisplay =
      b.deposit_amount_pence != null
        ? formatMoneyPence(b.deposit_amount_pence, sym)
        : null;
    const draftMessage = messageDraftById[b.id] ?? '';
    const sendingMessage = sendingMessageIds.includes(b.id);

    return (
      <div
        key={b.id}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls={`appt-expand-${b.id}`}
        onClick={() => toggleExpanded(b.id)}
        {...bindDetailPrefetchHandlers(b.id, prefetchBookingDetail)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleExpanded(b.id);
          }
        }}
        className={`cursor-pointer rounded-xl border border-slate-200 bg-white px-2 py-2 shadow-sm shadow-slate-900/[0.04] ring-1 ring-slate-900/[0.06] transition-[border-color,box-shadow,background-color] duration-150 sm:px-3 sm:py-3 border-l-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/35 focus-visible:ring-offset-2 ${statusBorderClass(b)} ${expanded ? 'border-slate-300 bg-brand-50/50 shadow-md ring-brand-900/15' : 'hover:border-slate-300 hover:bg-slate-50/90 hover:shadow-md hover:shadow-slate-900/[0.07] hover:ring-slate-900/[0.09]'}`}
      >
        <div className="flex min-h-[2.75rem] min-w-0 items-center gap-1.5 sm:min-h-[3rem] sm:gap-2">
          <div onClick={(e) => e.stopPropagation()} className="flex shrink-0 items-center">
            <input
              type="checkbox"
              checked={selectedBookingIds.includes(b.id)}
              onChange={(e) => toggleBookingSelected(b.id, e.target.checked)}
              aria-label={`Select booking for ${b.guest_name}`}
              className="h-4 w-4 rounded border-slate-300"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs sm:text-sm">
              <span className="min-w-0 max-w-[8.75rem] truncate font-semibold text-slate-900 sm:max-w-[14rem]">
                {b.guest_name}
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-slate-700">
                {startTime}
                {endTime ? <span className="text-slate-400">-{endTime}</span> : null}
              </span>
              <span
                className={
                  expanded
                    ? 'inline shrink-0 text-slate-300'
                    : 'hidden shrink-0 text-slate-300 sm:inline'
                }
              >
                Â·
              </span>
              <span
                className={
                  expanded
                    ? 'inline shrink-0 text-[11px] font-medium text-slate-500'
                    : 'hidden shrink-0 text-[11px] font-medium text-slate-500 sm:inline'
                }
              >
                {formatDayHeader(b.booking_date)}
              </span>
              <span
                className={
                  expanded
                    ? 'inline shrink-0 text-slate-300'
                    : 'hidden shrink-0 text-slate-300 sm:inline'
                }
              >
                Â·
              </span>
              <span
                className={
                  expanded
                    ? 'inline max-w-[10rem] truncate text-[11px] font-medium text-slate-600'
                    : 'hidden max-w-[10rem] truncate text-[11px] font-medium text-slate-600 sm:inline'
                }
              >
                {svcName}
              </span>
              <span
                className={
                  expanded
                    ? 'inline shrink-0 text-slate-300'
                    : 'hidden shrink-0 text-slate-300 md:inline'
                }
              >
                Â·
              </span>
              <span
                className={
                  expanded
                    ? 'inline max-w-[8rem] truncate text-[11px] text-slate-500'
                    : 'hidden max-w-[8rem] truncate text-[11px] text-slate-500 md:inline'
                }
              >
                {pracName}
              </span>
              <BookingStatusPill statusKey={b.status}>
                {tableStatusLabel(b.status)}
              </BookingStatusPill>
              {showDepositPendingPill(b) && (
                <Pill variant="warning" size="sm" dot>
                  <span className="sm:hidden">Deposit</span>
                  <span className="hidden sm:inline">Deposit pending</span>
                </Pill>
              )}
              {showAttendanceConfirmedSupplementPill(b) && (
                <BookingStatusPill statusKey="Confirmed" dot>
                  Confirmed
                </BookingStatusPill>
              )}
              <Pill variant={bookingTypePillVariant(bookingModel)} size="sm">
                {typeLabel}
              </Pill>
              {duration != null && (
                <span
                  className={
                    expanded
                      ? 'inline-block rounded bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500'
                      : 'hidden rounded bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500 sm:inline-block'
                  }
                >
                  {duration} min
                </span>
              )}
              {b.party_size > 1 && (
                <span
                  className={
                    expanded
                      ? 'inline-block rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700'
                      : 'hidden rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 sm:inline-block'
                  }
                >
                  {b.party_size} people
                </span>
              )}
              <span className={expanded ? 'inline-flex' : 'hidden sm:inline-flex'}>
                <Pill variant={sourcePillVariant(b.source)} size="sm">
                  {sourceLabelShort(b.source)}
                </Pill>
              </span>
              {priceDisplay && (
                <span className={expanded ? 'inline-flex' : 'hidden sm:inline-flex'}>
                  <Pill variant={depositPillVariant(b.deposit_status)} size="sm" dot>
                    {priceDisplay} Â· {b.deposit_status}
                  </Pill>
                </span>
              )}
            </div>
          </div>
          <svg
            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
        {expanded && (
          <div
            id={`appt-expand-${b.id}`}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            className={expandedBookingRowShellClass}
          >
            <ExpandedBookingContent
              booking={registryToExpandedBookingRow(b)}
              detail={detailById[b.id]}
              detailLoading={detailLoadingIds.includes(b.id)}
              tableManagementEnabled={bookingModel === 'table_reservation'}
              venueId={venueId}
              venueCurrency={currency}
              venueTimezone={venueTimezone}
              guestHistoryListRefresh={guestHistoryRevisionById[b.id] ?? 0}
              relatedBookingsStackDepth={0}
              onOpenRelatedGuestBooking={(payload) => {
                setRelatedGuestHistoryBooking({
                  bookingId: payload.bookingId,
                  snapshot: payload.snapshot,
                  isAppointment: !isTableReservationBooking(payload.row),
                });
              }}
              draftMessage={draftMessage}
              sendingMessage={sendingMessage}
              onMessageDraftChange={(value) => setMessageDraftById((prev) => ({ ...prev, [b.id]: value }))}
              onSendMessage={(channel) => sendGuestMessage(b.id, draftMessage, channel)}
              onStatusAction={(status) => { void updateRowStatus(b.id, status); }}
              onDetailUpdated={() => {
                invalidateVenueBookingDetail(b.id);
                setDetailById((prev) => {
                  const next = { ...prev };
                  delete next[b.id];
                  return next;
                });
                void loadBookingDetail(b.id, true);
                void fetchBookings({ silent: true });
                void fetchBookingsForStats();
              }}
              venueStaffBookingModel={primaryBookingModel}
              venueStaffEnabledBookingModels={enabledModels}
            />
          </div>
        )}
      </div>
    );
  }

  const filterCount =
    (statusKey !== 'All' ? 1 : 0) +
    (practitionerFilter !== 'all' ? 1 : 0) +
    (serviceFilter !== 'all' ? 1 : 0) +
    (modelFilter !== 'all' ? 1 : 0) +
    (timeRangeFilterActive ? 1 : 0);

  const toolbarSummary = {
    total_covers_booked: stats.total,
    total_covers_capacity: Math.max(stats.total, 1),
    tables_in_use: stats.confirmed,
    tables_total: Math.max(stats.total, 1),
    unassigned_count: stats.noShows,
    combos_in_use: stats.completed,
  };

  const appointmentSummaryContent = (
    <div className="flex flex-wrap items-center gap-1 text-[11px] sm:gap-1.5 sm:text-xs" aria-label="Bookings summary">
      <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200/90 bg-slate-50 px-1.5 py-0.5 font-medium text-slate-800">
        <span className="font-normal text-slate-500">{statsPrimaryLabel}</span>
        <span className="tabular-nums">{stats.total}</span>
      </span>
      <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-emerald-200/90 bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-900">
        <span className="font-normal text-emerald-700">Confirmed</span>
        <span className="tabular-nums">{stats.confirmed}</span>
      </span>
      <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-violet-200/90 bg-violet-50 px-1.5 py-0.5 font-medium text-violet-900">
        <span className="font-normal text-violet-700">Completed</span>
        <span className="tabular-nums">{stats.completed}</span>
      </span>
      <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200/90 bg-slate-50 px-1.5 py-0.5 font-medium text-slate-800">
        <span className="font-normal text-slate-500">No-shows</span>
        <span className="tabular-nums">{stats.noShows}</span>
      </span>
    </div>
  );

  const appointmentFilterPanel = (
    <div className="space-y-3">
      {showModelFilters && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Type</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setModelFilter('all')}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                modelFilter === 'all' ? 'bg-brand-600 text-white shadow-sm ring-1 ring-brand-600/20' : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-800'
              }`}
            >
              All
            </button>
            {filterModels.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModelFilter(m)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  modelFilter === m ? 'bg-brand-600 text-white shadow-sm ring-1 ring-brand-600/20' : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-800'
                }`}
              >
                {bookingModelShortLabel(m)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Calendar</span>
          <select
            value={practitionerFilter}
            onChange={(e) => setPractitionerFilter(e.target.value as 'all' | string)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          >
            <option value="all">All appointments</option>
            {myCalendarIds.length === 0 ? (
              activePractitioners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))
            ) : (
              <>
                {myCalendarIds.map((cid) => {
                  const p = activePractitioners.find((x) => x.id === cid);
                  const label = myCalendarIds.length === 1 ? (p?.name ?? 'Calendar') : `Mine - ${p?.name ?? 'Calendar'}`;
                  return (
                    <option key={cid} value={cid}>
                      {label}
                    </option>
                  );
                })}
                {activePractitioners
                  .filter((p) => !myCalendarIds.includes(p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </>
            )}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Service</span>
          <select
            value={serviceFilter}
            onChange={(e) => setServiceFilter(e.target.value as 'all' | string)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          >
            <option value="all">All services</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</p>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => setStatusKey(f.label)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                statusKey === f.label ? 'bg-brand-600 text-white shadow-sm ring-1 ring-brand-600/20' : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-800'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {filterCount > 0 ? (
        <button
          type="button"
          onClick={() => {
            setStatusKey('All');
            setPractitionerFilter(defaultPractitionerFilter);
            setServiceFilter('all');
            setModelFilter('all');
            setStartHourOverride(null);
            setEndHourOverride(null);
            setTimeRangeFilterActive(false);
          }}
          className="text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );

  const appointmentDatePanel = (
    <div className="space-y-3">
      {viewMode === 'custom' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">From</span>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="min-h-[40px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">To</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="min-h-[40px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </label>
          {invalidCustomRange ? <p className="text-sm font-medium text-red-600 sm:col-span-2">From must be on or before To.</p> : null}
        </div>
      ) : viewMode === 'day' ? (
        <>
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
          {timeRangeFilterActive ? (
            <button
              type="button"
              onClick={() => {
                setStartHourOverride(null);
                setEndHourOverride(null);
                setTimeRangeFilterActive(false);
              }}
              className="text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline"
            >
              Clear time filter
            </button>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-slate-600">Use the arrows to move through the selected {viewMode} view.</p>
      )}
    </div>
  );

  const appointmentToolbarLeadingTools = useCallback(
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
          aria-label="View - day, week, month, or custom range"
        >
          <span className="max-w-[4.75rem] truncate sm:max-w-none">
            {viewMode.charAt(0).toUpperCase() + viewMode.slice(1)}
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
            {(['day', 'week', 'month', 'custom'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={viewMode === mode}
                onClick={() => {
                  setViewMode(mode);
                  if (mode !== 'custom') setAnchorDate(todayISO());
                  setViewRangePopoverOpen(false);
                }}
                className={`flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm font-semibold ${
                  viewMode === mode ? 'bg-brand-50 text-brand-800 ring-1 ring-brand-200' : 'text-slate-800 hover:bg-slate-50'
                }`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </ClampedFixedDropdown>
      </div>
    ),
    [viewMode, viewRangePopoverOpen, viewRangePanelId],
  );

  return (
    <PageFrame>
      <div className="min-w-0 space-y-6">
      {realtimeConnected === false && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Updates may be delayed. Reconnecting&hellip;
        </div>
      )}
      {error && (
        <div className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <span className="min-w-0">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 self-start rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-100 sm:self-auto sm:py-1"
          >
            Dismiss
          </button>
        </div>
      )}

      {filterGuestId && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 sm:px-4">
          <span>Showing bookings for one client in the selected date range.</span>
          <button
            type="button"
            onClick={clearGuestFilter}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
          >
            Clear guest filter
          </button>
        </div>
      )}

      <OperationsWorkspaceToolbar
        title={statsPrimaryLabel}
        summary={toolbarSummary}
        summaryContent={appointmentSummaryContent}
        date={anchorDate}
        todayIso={todayIso}
        dateLabel={viewMode === 'custom' ? `${customFrom} - ${customTo}` : formatDateLabel(anchorDate, viewMode)}
        onDateChange={setAnchorDate}
        onPreviousDate={() => navigate(-1)}
        onNextDate={() => navigate(1)}
        liveState={realtimeConnected === false ? 'reconnecting' : 'live'}
        onRefresh={() => {
          void fetchBookings({ silent: true });
          void fetchBookingsForStats();
        }}
        onNewBooking={() => setNewBookingOpen(true)}
        onWalkIn={() => setWalkInOpen(true)}
        compact
        toolbarLeadingTools={appointmentToolbarLeadingTools}
        controlsLabel={filterCount > 0 ? `Filter (${filterCount})` : 'Filter'}
        controlsPanel={appointmentFilterPanel}
        datePickerPanel={appointmentDatePanel}
        searchActive={guestToolbarSearchQuery.trim().length > 0}
        searchAriaLabel="Search contacts"
        searchPanel={(
          <OperationsToolbarGuestSearchPanel
            onQueryChange={setGuestToolbarSearchQuery}
            initialDate={viewMode === 'day' ? anchorDate : undefined}
            onBookingCreated={() => {
              void fetchBookings({ silent: true });
              void fetchBookingsForStats();
            }}
          />
        )}
      />
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5">
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 bg-brand-500 transition-opacity duration-200 ease-out ${isRefreshing ? 'opacity-100' : 'opacity-0'}`}
          aria-hidden
        />
      </div>

      {linkedAvailable ? (
        <div
          className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 text-xs font-semibold shadow-sm"
          role="group"
          aria-label="Booking source"
        >
          {(['all', 'own', 'linked'] as SourceScope[]).map((scope) => (
            <button
              key={scope}
              type="button"
              onClick={() => setSourceScope(scope)}
              className={`rounded-lg px-3 py-1.5 transition-colors ${
                sourceScope === scope
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {scope === 'all' ? 'All' : scope === 'own' ? 'My venue' : 'Linked-in'}
            </button>
          ))}
        </div>
      ) : null}

      {sourceScope !== 'linked' && (loading ? (
        <div className="space-y-3" role="status" aria-label="Loading bookings">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton.Card key={i} className="py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton.Line className="w-40" />
                  <Skeleton.Line className="w-56 max-w-full" />
                </div>
                <Skeleton.Block className="h-9 w-24 shrink-0" />
              </div>
            </Skeleton.Card>
          ))}
        </div>
      ) : filteredBookings.length === 0 ? (
        <EmptyState
          title="No bookings match this view"
          description="Try another date range, clear search, or adjust filters."
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
        renderAppointmentCards(sortedBookings)
      ) : (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5">
            <div className="flex flex-col gap-2 border-b border-slate-200/90 bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3 sm:px-4">
              <SortControl />
              <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-500 sm:text-xs">
                {sortedBookings.length} {sortedBookings.length === 1 ? 'booking' : 'bookings'}
              </span>
            </div>
          </div>
          {sortedDayEntries.map(([date, dayBookings]) => (
              <section
                key={date}
                className="space-y-2"
                aria-label={`Bookings on ${date}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                  <h3 className="min-w-0 text-sm font-semibold text-slate-800">{formatDayHeader(date)}</h3>
                  <span className="shrink-0 text-xs tabular-nums text-slate-500">
                    {dayBookings.length} booking{dayBookings.length !== 1 ? 's' : ''}
                  </span>
                </div>
                {renderAppointmentCards(dayBookings, { nested: true, showSort: false })}
              </section>
            ))}
        </div>
      ))}

      {sourceScope !== 'own' ? (
        <LinkedBookingsPanel from={from} to={to} onAvailabilityChange={setLinkedAvailable} />
      ) : null}

      {bulkGuestMessageOpen && (
        <BulkGuestMessageModal
          onClose={() => setBulkGuestMessageOpen(false)}
          recipientCount={selectedBookingIds.length}
          sending={bulkGuestMessageSending}
          onSend={(message, channel) => {
            void runBulkGuestMessage(message, channel);
          }}
        />
      )}

      {relatedGuestHistoryBooking ? (
        <BookingDetailPanel
          key={relatedGuestHistoryBooking.bookingId}
          bookingId={relatedGuestHistoryBooking.bookingId}
          venueId={venueId}
          venueCurrency={currency}
          initialSnapshot={relatedGuestHistoryBooking.snapshot}
          isAppointment={relatedGuestHistoryBooking.isAppointment}
          presentation="popover"
          anchor={null}
          stackDepth={0}
          venueTimezone={venueTimezone}
          onClose={() => setRelatedGuestHistoryBooking(null)}
          onUpdated={() => {
            setGuestHistoryRevisionById((prev) => {
              const next = { ...prev };
              for (const id of expandedIds) {
                next[id] = (next[id] ?? 0) + 1;
              }
              return next;
            });
            void fetchBookings({ silent: true });
            void fetchBookingsForStats();
          }}
        />
      ) : null}

      <DashboardStaffBookingModal
        open={newBookingOpen}
        title="New booking"
        onClose={() => setNewBookingOpen(false)}
        onCreated={() => {
          setNewBookingOpen(false);
          void fetchBookings({ silent: true });
          void fetchBookingsForStats();
        }}
        venueId={venueId}
        currency={currency}
        bookingModel={primaryBookingModel}
        enabledModels={enabledModels}
        preselectedPractitionerId={practitionerFilter === 'all' ? undefined : practitionerFilter}
      />
      <DashboardStaffBookingModal
        open={walkInOpen}
        title="Walk-in"
        bookingIntent="walk-in"
        onClose={() => setWalkInOpen(false)}
        onCreated={() => {
          setWalkInOpen(false);
          void fetchBookings({ silent: true });
          void fetchBookingsForStats();
        }}
        venueId={venueId}
        currency={currency}
        bookingModel={primaryBookingModel}
        enabledModels={enabledModels}
        preselectedPractitionerId={practitionerFilter === 'all' ? undefined : practitionerFilter}
      />
      </div>
    </PageFrame>
  );
}
