'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';
import { DashboardStaffBookingModal } from '@/components/booking/DashboardStaffBookingModal';
import {
  AppointmentDetailSheet,
  type AppointmentDetailPrefetch,
} from '@/components/booking/AppointmentDetailSheet';
import type { RegistryAppointment } from '@/components/booking/AppointmentRegistryCard';
import { DashboardStatCard } from '@/components/dashboard/DashboardStatCard';
import { PageFrame } from '@/components/ui/dashboard/PageFrame';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { EmptyState } from '@/components/ui/dashboard/EmptyState';
import { currencySymbolFromCode } from '@/lib/money/currency-symbol';
import { useToast } from '@/components/ui/Toast';
import { buildCsvFromRows, downloadCsvString, formatMoneyPence } from '@/lib/appointments-csv';
import { BOOKING_MUTABLE_STATUSES } from '@/lib/table-management/constants';
import type { BookingModel } from '@/types/booking-models';
import { BOOKING_MODEL_ORDER, venueExposesBookingModel } from '@/lib/booking/enabled-models';
import { inferBookingRowModel, bookingModelShortLabel } from '@/lib/booking/infer-booking-row-model';
import { showAttendanceConfirmedPill, showDepositPendingPill } from '@/lib/booking/booking-staff-indicators';
import { Pill, type PillVariant } from '@/components/ui/dashboard/Pill';
import { CalendarDateTimePicker } from '@/components/calendar/CalendarDateTimePicker';
import { getCalendarGridBounds } from '@/lib/venue-calendar-bounds';
import { isBookingTimeInHourRange } from '@/lib/booking-time-window';
import type { OpeningHours } from '@/types/availability';
import { BulkGuestMessageModal } from '@/components/booking/BulkGuestMessageModal';
import type { GuestMessageChannel } from '@/lib/booking/guest-message-channel';
import { Skeleton } from '@/components/ui/Skeleton';

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

interface PractitionerServiceLink {
  practitioner_id: string;
  service_id: string;
  custom_price_pence: number | null;
  custom_duration_minutes: number | null;
}

const STATUS_FILTERS: Array<{ label: string; apiValue: string | null }> = [
  { label: 'All', apiValue: null },
  { label: 'Pending', apiValue: 'Pending' },
  { label: 'Booked', apiValue: 'Booked' },
  /** Guest tapped confirm/cancel link or staff confirmed attendance — `bookings.status = 'Confirmed'`. */
  { label: 'Confirmed', apiValue: 'Confirmed' },
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
    return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} – ${end.getDate()} ${MONTHS_SHORT[end.getMonth()]} ${end.getFullYear()}`;
  }
  if (mode === 'month') return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
  return '';
}

/** Shorter label for narrow screens (avoids truncation in date navigator). */
function formatDateLabelCompact(date: string, mode: ViewMode): string {
  const d = new Date(`${date}T12:00:00`);
  if (mode === 'day') {
    return `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  }
  if (mode === 'week') {
    const end = new Date(`${addDays(date, 6)}T12:00:00`);
    return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} – ${end.getDate()} ${MONTHS_SHORT[end.getMonth()]} ${String(end.getFullYear()).slice(-2)}`;
  }
  if (mode === 'month') return `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  return '';
}

function formatDayHeader(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

function statusLabelForCsv(status: string): string {
  if (status === 'Seated') return 'Started';
  if (status === 'No-Show') return 'No show';
  return status;
}

function sourceLabelForCsv(source: string): string {
  if (source === 'booking_page' || source === 'online') return 'Online';
  if (source === 'walk-in') return 'Walk-in';
  if (source === 'phone') return 'Phone';
  return source;
}

function columnIdForRegistry(b: RegistryAppointment): string | null {
  return b.practitioner_id ?? b.calendar_id ?? null;
}

function serviceIdForRegistry(b: RegistryAppointment): string | null {
  return b.appointment_service_id ?? b.service_item_id ?? null;
}

function rowForInference(b: RegistryAppointment): Parameters<typeof inferBookingRowModel>[0] {
  return {
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

/** Left-edge status strip color — mirrors the main BookingsDashboard for visual parity. */
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
      b.id.toLowerCase().includes(q) ||
      b.id.replace(/-/g, '').toLowerCase().includes(q.replace(/-/g, '')),
  );
}

function registryToPrefetch(b: RegistryAppointment): AppointmentDetailPrefetch {
  return {
    id: b.id,
    booking_date: b.booking_date,
    booking_time: b.booking_time,
    booking_end_time: b.booking_end_time,
    status: b.status,
    practitioner_id: b.practitioner_id,
    appointment_service_id: serviceIdForRegistry(b),
    special_requests: b.special_requests,
    internal_notes: b.internal_notes,
    client_arrived_at: b.client_arrived_at,
    guest_attendance_confirmed_at: b.guest_attendance_confirmed_at ?? null,
    staff_attendance_confirmed_at: b.staff_attendance_confirmed_at ?? null,
    deposit_amount_pence: b.deposit_amount_pence,
    deposit_status: b.deposit_status,
    party_size: b.party_size,
    guest_name: b.guest_name,
    guest_email: b.guest_email,
    guest_phone: b.guest_phone,
    guest_visit_count: b.guest_visit_count,
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
}: {
  venueId: string;
  currency?: string;
  primaryBookingModel?: BookingModel;
  enabledModels?: BookingModel[];
  /** Server-resolved: staff linked to a calendar default to their practitioner id; admins use `all`. */
  defaultPractitionerFilter?: 'all' | string;
  /** Bookable calendars this staff user manages. */
  linkedPractitionerIds?: string[];
}) {
  const { addToast } = useToast();
  const myCalendarIds = useMemo(() => linkedPractitionerIds, [linkedPractitionerIds]);
  const sym = currencySymbolFromCode(currency);
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [anchorDate, setAnchorDate] = useState(todayISO);
  const [customFrom, setCustomFrom] = useState(todayISO);
  const [customTo, setCustomTo] = useState(addDays(todayISO(), 7));
  const [statusKey, setStatusKey] = useState<string>('All');
  const [practitionerFilter, setPractitionerFilter] = useState<'all' | string>(defaultPractitionerFilter);
  const [serviceFilter, setServiceFilter] = useState<'all' | string>('all');
  const [modelFilter, setModelFilter] = useState<'all' | BookingModel>('all');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [searchQuery, setSearchQuery] = useState('');
  const [bookings, setBookings] = useState<RegistryAppointment[]>([]);
  /** All statuses in range - used for summary tiles (list may be status-filtered). */
  const [allStatusBookings, setAllStatusBookings] = useState<RegistryAppointment[]>([]);
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [services, setServices] = useState<AppointmentService[]>([]);
  const [practitionerServiceLinks, setPractitionerServiceLinks] = useState<PractitionerServiceLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState<boolean | null>(null);
  const [detailBookingId, setDetailBookingId] = useState<string | null>(null);
  /** Appointment rows expanded inline in the list. */
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const searchParams = useSearchParams();
  const router = useRouter();
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [confirmAttendanceLoadingId, setConfirmAttendanceLoadingId] = useState<string | null>(null);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [newBookingOpen, setNewBookingOpen] = useState(false);
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [csvFrom, setCsvFrom] = useState(todayISO);
  const [csvTo, setCsvTo] = useState(addDays(todayISO(), 30));
  const [csvExporting, setCsvExporting] = useState(false);
  const [openingHours, setOpeningHours] = useState<OpeningHours | null>(null);
  const [venueTimezone, setVenueTimezone] = useState<string>('Europe/London');
  const [startHourOverride, setStartHourOverride] = useState<number | null>(null);
  const [endHourOverride, setEndHourOverride] = useState<number | null>(null);
  /** When true, day view list/stats are filtered to the hour window from the time dropdown. */
  const [timeRangeFilterActive, setTimeRangeFilterActive] = useState(false);
  const [selectedBookingIds, setSelectedBookingIds] = useState<string[]>([]);
  const [bulkGuestMessageOpen, setBulkGuestMessageOpen] = useState(false);
  const [bulkGuestMessageSending, setBulkGuestMessageSending] = useState(false);

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

  /** Legacy filter label before "Started" rename. */
  useEffect(() => {
    if (statusKey === 'In progress') setStatusKey('Started');
  }, [statusKey]);

  useEffect(() => {
    const ob = searchParams.get('openBooking');
    if (ob && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ob)) {
      setDetailBookingId(ob);
      const next = new URLSearchParams(searchParams.toString());
      next.delete('openBooking');
      const qs = next.toString();
      router.replace(qs ? `/dashboard/bookings?${qs}` : '/dashboard/bookings', { scroll: false });
    }
  }, [searchParams, router]);

  const { from, to } = useMemo(() => {
    if (viewMode === 'day') return { from: anchorDate, to: anchorDate };
    if (viewMode === 'week') return { from: anchorDate, to: addDays(anchorDate, 6) };
    if (viewMode === 'month') return { from: startOfMonth(anchorDate), to: endOfMonth(anchorDate) };
    return { from: customFrom, to: customTo };
  }, [viewMode, anchorDate, customFrom, customTo]);

  const invalidCustomRange = viewMode === 'custom' && customFrom > customTo;
  const invalidCsvRange = csvFrom > csvTo;

  const serviceMap = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const practitionerMap = useMemo(
    () => new Map(practitioners.filter((p) => p.is_active).map((p) => [p.id, p])),
    [practitioners],
  );

  const linkPriceKey = useMemo(() => {
    const m = new Map<string, PractitionerServiceLink>();
    for (const l of practitionerServiceLinks) {
      m.set(`${l.practitioner_id}:${l.service_id}`, l);
    }
    return m;
  }, [practitionerServiceLinks]);

  const effectivePricePence = useCallback(
    (b: RegistryAppointment): number | null => {
      const sid = serviceIdForRegistry(b);
      if (!sid) return null;
      const cid = columnIdForRegistry(b);
      const link = cid ? linkPriceKey.get(`${cid}:${sid}`) : undefined;
      const svc = serviceMap.get(sid);
      if (link?.custom_price_pence != null) return link.custom_price_pence;
      return svc?.price_pence ?? null;
    },
    [linkPriceKey, serviceMap],
  );

  const fetchBookings = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (invalidCustomRange) {
        setError('Custom date range is invalid. “From” must be before or equal to “To”.');
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
        if (selectedStatusFilter?.apiValue) {
          params.set('status', selectedStatusFilter.apiValue);
        }
        if (filterGuestId) params.set('guest', filterGuestId);
        const res = await fetch(`/api/venue/bookings/list?${params}`);
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          setError((json as { error?: string }).error ?? 'Failed to load appointments');
          return;
        }
        const data = await res.json();
        const raw = (data.bookings ?? []) as RegistryAppointment[];
        const visible = raw.filter((b) =>
          venueExposesBookingModel(primaryBookingModel, enabledModels, inferRegistryModel(b)),
        );
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
        setPractitionerServiceLinks(data.practitioner_services ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setServices([]);
          setPractitionerServiceLinks([]);
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
        searchQuery,
        primaryBookingModel,
        enabledModels,
      ),
    [bookings, practitionerFilter, serviceFilter, searchQuery, primaryBookingModel, enabledModels],
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
      searchQuery,
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
    searchQuery,
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
          const sa = (() => {
            const id = serviceIdForRegistry(a);
            return id ? serviceMap.get(id)?.name ?? '' : '';
          })();
          const sb = (() => {
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

  function canShowConfirmBookingAttendance(b: RegistryAppointment): boolean {
    if (b.source === 'walk-in') return false;
    if (showAttendanceConfirmedPill(b)) return false;
    return !['Cancelled', 'No-Show', 'Completed'].includes(b.status);
  }

  function canShowCancelStaffAttendanceConfirmation(b: RegistryAppointment): boolean {
    if (b.source === 'walk-in') return false;
    if (!b.staff_attendance_confirmed_at) return false;
    return !['Cancelled', 'No-Show', 'Completed'].includes(b.status);
  }

  async function confirmBookingAttendance(bookingId: string) {
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
      void fetchBookings({ silent: true });
      void fetchBookingsForStats();
    } catch {
      addToast('Could not confirm attendance', 'error');
    } finally {
      setConfirmAttendanceLoadingId(null);
    }
  }

  async function cancelStaffAttendanceConfirmation(bookingId: string) {
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
      void fetchBookings({ silent: true });
      void fetchBookingsForStats();
    } catch {
      addToast('Could not cancel confirmation', 'error');
    } finally {
      setConfirmAttendanceLoadingId(null);
    }
  }

  async function updateRowStatus(bookingId: string, nextStatus: string) {
    const prev = bookings.find((x) => x.id === bookingId);
    if (!prev) return;
    setStatusUpdatingId(bookingId);
    setBookings((rows) => rows.map((r) => (r.id === bookingId ? { ...r, status: nextStatus } : r)));
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
      void fetchBookings({ silent: true });
      void fetchBookingsForStats();
    } catch {
      addToast('Could not update status', 'error');
      setBookings((rows) => rows.map((r) => (r.id === bookingId ? prev : r)));
    } finally {
      setStatusUpdatingId(null);
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

  const stats = useMemo(() => {
    const total = statsBookings.length;
    const confirmed = statsBookings.filter((b) => b.status === 'Confirmed').length;
    const completed = statsBookings.filter((b) => b.status === 'Completed').length;
    const noShows = statsBookings.filter((b) => b.status === 'No-Show').length;
    return { total, confirmed, completed, noShows };
  }, [statsBookings]);

  const detailPrefetch = useMemo((): AppointmentDetailPrefetch | null => {
    if (!detailBookingId) return null;
    const b = bookings.find((x) => x.id === detailBookingId);
    if (!b) return null;
    if (isCdeModel(inferRegistryModel(b))) return null;
    return registryToPrefetch(b);
  }, [detailBookingId, bookings]);

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

  const goToday = () => setAnchorDate(todayISO());
  const goTomorrow = () => setAnchorDate(addDays(todayISO(), 1));

  const openCsvModal = () => {
    setCsvFrom(from);
    setCsvTo(to);
    setCsvModalOpen(true);
  };

  const runCsvExport = async () => {
    if (invalidCsvRange) return;
    setCsvExporting(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from: csvFrom, to: csvTo });
      const res = await fetch(`/api/venue/bookings/list?${params}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError((json as { error?: string }).error ?? 'Failed to load appointments for export');
        return;
      }
      const data = await res.json();
      const rows = ((data.bookings ?? []) as RegistryAppointment[]).filter((b) =>
        venueExposesBookingModel(primaryBookingModel, enabledModels, inferRegistryModel(b)),
      );

      const header = [
        'Date',
        'Time',
        'Type',
        'Booking ref (full)',
        'Status',
        'Source',
        'Client',
        'Phone',
        'Email',
        'Practitioner',
        'Service',
        'Service price',
        'Deposit status',
        'Deposit amount',
        'Customer comments',
        'Staff notes',
      ];

      const csvRows = rows.map((b) => {
        const cid = columnIdForRegistry(b);
        const sid = serviceIdForRegistry(b);
        const prac = cid ? practitionerMap.get(cid)?.name ?? '' : '';
        const svc = sid ? serviceMap.get(sid)?.name ?? '' : '';
        const price = effectivePricePence(b);
        return [
          b.booking_date,
          b.booking_time.slice(0, 5),
          bookingModelShortLabel(inferRegistryModel(b)),
          b.id,
          statusLabelForCsv(b.status),
          sourceLabelForCsv(b.source),
          b.guest_name,
          b.guest_phone ?? '',
          b.guest_email ?? '',
          prac,
          svc,
          formatMoneyPence(price, sym),
          b.deposit_status,
          b.deposit_amount_pence != null ? formatMoneyPence(b.deposit_amount_pence, sym) : '',
          b.special_requests?.replace(/\r\n/g, '\n') ?? '',
          b.internal_notes?.replace(/\r\n/g, '\n') ?? '',
        ];
      });

      const csv = buildCsvFromRows(header, csvRows);
      downloadCsvString(csv, `bookings_${csvFrom}_to_${csvTo}.csv`);
      setCsvModalOpen(false);
    } catch {
      setError('Failed to export CSV');
    } finally {
      setCsvExporting(false);
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
            `Sent to ${okCount}/${ids.length}. ${failureSummaries.slice(0, 3).join(' · ')}`,
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

  function toggleExpanded(id: string) {
    setExpandedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

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
    return (
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <label htmlFor="appt-sort-key" className="font-medium">
          Sort
        </label>
        <select
          id="appt-sort-key"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="min-h-[32px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
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
          className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          aria-label={`Sort direction: ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
        >
          <span aria-hidden>{sortDir === 'asc' ? '↑' : '↓'}</span>
          <span>{sortDir === 'asc' ? 'Asc' : 'Desc'}</span>
        </button>
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
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-3 py-2 sm:px-4">
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-500 hover:text-slate-700">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) => toggleAllInList(list, e.target.checked)}
              aria-label="Select all bookings in this list"
            />
            Select all
          </label>
          <div className="flex items-center gap-3">
            {showSort && <SortControl />}
            <span className="text-[11px] font-medium text-slate-400">
              {list.length} {list.length === 1 ? 'booking' : 'bookings'}
            </span>
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {list.map((b) => renderAppointmentRow(b))}
        </div>
      </div>
    );
  }

  function renderAppointmentRow(b: RegistryAppointment) {
    const cid = columnIdForRegistry(b);
    const sid = serviceIdForRegistry(b);
    const pracName = cid ? practitionerMap.get(cid)?.name ?? '-' : '-';
    const svcName = sid ? serviceMap.get(sid)?.name ?? '-' : '-';
    const svc = sid ? serviceMap.get(sid) ?? null : null;
    const typeLabel = bookingModelShortLabel(inferRegistryModel(b));
    const expanded = expandedIds.includes(b.id);
    const startTime = b.booking_time.slice(0, 5);
    const endTime = b.booking_end_time ? b.booking_end_time.slice(0, 5) : null;
    const showConfirm = canShowConfirmBookingAttendance(b);
    const showCancelConfirm = canShowCancelStaffAttendanceConfirmation(b);
    const duration = svc?.duration_minutes ?? null;
    const priceDisplay =
      b.deposit_amount_pence != null
        ? formatMoneyPence(b.deposit_amount_pence, sym)
        : null;

    return (
      <div
        key={b.id}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls={`appt-expand-${b.id}`}
        onClick={() => toggleExpanded(b.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleExpanded(b.id);
          }
        }}
        className={`cursor-pointer border-l-[3px] py-3 pl-3 pr-3 transition-colors sm:pl-4 sm:pr-4 ${statusBorderClass(b.status)} ${expanded ? 'bg-brand-50/20' : 'hover:bg-slate-50/50'}`}
      >
        <div className="flex items-start gap-3">
          <div onClick={(e) => e.stopPropagation()} className="pt-1">
            <input
              type="checkbox"
              checked={selectedBookingIds.includes(b.id)}
              onChange={(e) => toggleBookingSelected(b.id, e.target.checked)}
              aria-label={`Select booking for ${b.guest_name}`}
            />
          </div>
          <div className="flex w-20 flex-none flex-col items-start leading-tight sm:w-24">
            <span className="font-semibold tabular-nums text-slate-900">
              {startTime}
            </span>
            {endTime && (
              <span className="text-[11px] tabular-nums text-slate-400">
                → {endTime}
              </span>
            )}
            <span className="mt-0.5 text-[11px] tabular-nums text-slate-400">
              {formatDayHeader(b.booking_date)}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-slate-900">{b.guest_name}</span>
              <Pill variant={statusPillVariant(b.status)} size="sm">
                {tableStatusLabel(b.status)}
              </Pill>
              {showDepositPendingPill(b) && (
                <Pill variant="warning" size="sm" dot>
                  Deposit pending
                </Pill>
              )}
              {showAttendanceConfirmedPill(b) && (
                <Pill variant="success" size="sm" dot>
                  Confirmed
                </Pill>
              )}
              <Pill variant="neutral" size="sm">
                {typeLabel}
              </Pill>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
              <span className="truncate font-medium text-slate-600">{svcName}</span>
              <span className="text-slate-300">·</span>
              <span className="truncate">{pracName}</span>
              {duration != null && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className="tabular-nums">{duration} min</span>
                </>
              )}
              {b.party_size > 1 && (
                <>
                  <span className="text-slate-300">·</span>
                  <span>
                    {b.party_size} {b.party_size === 1 ? 'person' : 'people'}
                  </span>
                </>
              )}
              <span className="text-slate-300">·</span>
              <Pill variant={sourcePillVariant(b.source)} size="sm">
                {sourceLabelShort(b.source)}
              </Pill>
              {priceDisplay && (
                <Pill variant={depositPillVariant(b.deposit_status)} size="sm" dot>
                  {priceDisplay} · {b.deposit_status}
                </Pill>
              )}
            </div>
          </div>
          <div onClick={(e) => e.stopPropagation()} className="flex flex-shrink-0 items-center gap-1.5">
            {showConfirm && (
              <button
                type="button"
                disabled={confirmAttendanceLoadingId === b.id}
                onClick={() => void confirmBookingAttendance(b.id)}
                className="hidden items-center rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-900 shadow-sm transition-colors hover:bg-teal-100 focus:outline-none focus:ring-2 focus:ring-teal-400/30 disabled:opacity-50 sm:inline-flex"
                aria-label={`Confirm attendance for ${b.guest_name}`}
              >
                {confirmAttendanceLoadingId === b.id ? '…' : 'Confirm'}
              </button>
            )}
            {showCancelConfirm && (
              <button
                type="button"
                disabled={confirmAttendanceLoadingId === b.id}
                onClick={() => void cancelStaffAttendanceConfirmation(b.id)}
                className="hidden items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400/30 disabled:opacity-50 sm:inline-flex"
                aria-label={`Cancel staff attendance confirmation for ${b.guest_name}`}
              >
                {confirmAttendanceLoadingId === b.id ? '…' : 'Unconfirm'}
              </button>
            )}
          </div>
          <svg
            className={`mt-1 h-4 w-4 flex-shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
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
            className="mt-3 rounded-xl border border-slate-200 bg-white p-3 sm:p-4"
          >
            {renderExpandedAppointment(b, { svcName, pracName, duration })}
          </div>
        )}
      </div>
    );
  }

  function renderExpandedAppointment(
    b: RegistryAppointment,
    ctx: { svcName: string; pracName: string; duration: number | null },
  ) {
    const { svcName, pracName, duration } = ctx;
    const showConfirm = canShowConfirmBookingAttendance(b);
    const showCancelConfirm = canShowCancelStaffAttendanceConfirmation(b);
    const priceDisplay =
      b.deposit_amount_pence != null
        ? formatMoneyPence(b.deposit_amount_pence, sym)
        : null;
    const endTime = b.booking_end_time ? b.booking_end_time.slice(0, 5) : null;
    const notes = b.special_requests?.trim() || null;
    const internal = b.internal_notes?.trim() || null;
    const arrivedAt = b.client_arrived_at
      ? new Date(b.client_arrived_at).toLocaleString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          day: '2-digit',
          month: 'short',
        })
      : null;
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Guest
            </h4>
            <p className="mt-1.5 font-semibold text-slate-900">{b.guest_name}</p>
            {b.guest_visit_count != null && (
              <p className="mt-0.5 text-xs text-slate-500">
                {b.guest_visit_count === 0
                  ? 'First visit'
                  : `${b.guest_visit_count} previous ${b.guest_visit_count === 1 ? 'visit' : 'visits'}`}
              </p>
            )}
            <div className="mt-2 flex flex-col gap-1 text-sm">
              {b.guest_email && (
                <a
                  href={`mailto:${b.guest_email}`}
                  className="inline-flex w-fit items-center gap-1.5 text-brand-700 hover:underline"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.25 6.75A2.25 2.25 0 0 1 4.5 4.5h15a2.25 2.25 0 0 1 2.25 2.25v10.5A2.25 2.25 0 0 1 19.5 19.5h-15a2.25 2.25 0 0 1-2.25-2.25V6.75Z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m3 7 9 6 9-6"
                    />
                  </svg>
                  <span className="break-all">{b.guest_email}</span>
                </a>
              )}
              {b.guest_phone && (
                <a
                  href={`tel:${b.guest_phone}`}
                  className="inline-flex w-fit items-center gap-1.5 text-brand-700 hover:underline"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.25 6.75A4.5 4.5 0 0 1 6.75 2.25h.5c.8 0 1.5.56 1.66 1.35l.83 4.16a1.5 1.5 0 0 1-.74 1.62l-1.65.82a13.5 13.5 0 0 0 6.06 6.06l.82-1.65a1.5 1.5 0 0 1 1.62-.74l4.16.83c.79.16 1.35.86 1.35 1.66v.5a4.5 4.5 0 0 1-4.5 4.5A15 15 0 0 1 2.25 6.75Z"
                    />
                  </svg>
                  <span>{b.guest_phone}</span>
                </a>
              )}
              {!b.guest_email && !b.guest_phone && (
                <span className="text-xs text-slate-400">No contact details on file</span>
              )}
            </div>
          </section>

          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Appointment
            </h4>
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-slate-500">Service</dt>
              <dd className="font-medium text-slate-800">{svcName}</dd>
              <dt className="text-slate-500">Staff</dt>
              <dd className="font-medium text-slate-800">{pracName}</dd>
              <dt className="text-slate-500">Date</dt>
              <dd className="font-medium tabular-nums text-slate-800">{b.booking_date}</dd>
              <dt className="text-slate-500">Time</dt>
              <dd className="font-medium tabular-nums text-slate-800">
                {b.booking_time.slice(0, 5)}
                {endTime && <span className="text-slate-400"> → {endTime}</span>}
                {duration != null && (
                  <span className="ml-1.5 text-xs text-slate-400">({duration} min)</span>
                )}
              </dd>
              {b.party_size > 1 && (
                <>
                  <dt className="text-slate-500">Party</dt>
                  <dd className="font-medium text-slate-800">
                    {b.party_size} {b.party_size === 1 ? 'person' : 'people'}
                  </dd>
                </>
              )}
              <dt className="text-slate-500">Deposit</dt>
              <dd>
                {priceDisplay ? (
                  <Pill variant={depositPillVariant(b.deposit_status)} size="sm" dot>
                    {priceDisplay} · {b.deposit_status}
                  </Pill>
                ) : (
                  <Pill variant={depositPillVariant(b.deposit_status)} size="sm">
                    {b.deposit_status}
                  </Pill>
                )}
              </dd>
              <dt className="text-slate-500">Source</dt>
              <dd>
                <Pill variant={sourcePillVariant(b.source)} size="sm">
                  {sourceLabelShort(b.source)}
                </Pill>
              </dd>
              {arrivedAt && (
                <>
                  <dt className="text-slate-500">Arrived</dt>
                  <dd className="font-medium text-emerald-700">{arrivedAt}</dd>
                </>
              )}
            </dl>
          </section>
        </div>

        {(notes || internal) && (
          <section className="space-y-2 rounded-lg bg-slate-50/70 p-3 ring-1 ring-slate-200/70">
            {notes && (
              <div>
                <h5 className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                  Special requests
                </h5>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{notes}</p>
              </div>
            )}
            {internal && (
              <div>
                <h5 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Internal notes
                </h5>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{internal}</p>
              </div>
            )}
          </section>
        )}

        <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Status
            </span>
            <select
              value={b.status}
              disabled={statusUpdatingId === b.id}
              onChange={(e) => void updateRowStatus(b.id, e.target.value)}
              className="min-h-[36px] rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
            >
              {BOOKING_MUTABLE_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {tableStatusLabel(st)}
                </option>
              ))}
            </select>
          </label>
          {showConfirm && (
            <button
              type="button"
              disabled={confirmAttendanceLoadingId === b.id}
              onClick={() => void confirmBookingAttendance(b.id)}
              className="inline-flex min-h-[36px] items-center rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-900 shadow-sm transition-colors hover:bg-teal-100 focus:outline-none focus:ring-2 focus:ring-teal-400/30 disabled:opacity-50"
            >
              {confirmAttendanceLoadingId === b.id ? 'Confirming…' : 'Confirm booking'}
            </button>
          )}
          {showCancelConfirm && (
            <button
              type="button"
              disabled={confirmAttendanceLoadingId === b.id}
              onClick={() => void cancelStaffAttendanceConfirmation(b.id)}
              className="inline-flex min-h-[36px] items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400/30 disabled:opacity-50"
            >
              {confirmAttendanceLoadingId === b.id ? '…' : 'Cancel confirmation'}
            </button>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setDetailBookingId(b.id)}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-semibold text-brand-700 shadow-sm transition-colors hover:bg-brand-100 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            >
              Open full view
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <PageFrame>
      <PageHeader
        eyebrow="Operations"
        title={statsPrimaryLabel}
        subtitle={`Filter, sort, and export your ${statsPrimaryLabel.toLowerCase()}. Expand cards for full client details.`}
      />
      <div className="min-w-0 space-y-5">
      {realtimeConnected === false && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800 sm:px-4">
          Updates may be delayed. Reconnecting…
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
      {showModelFilters && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-4">
          <span className="text-xs font-medium text-slate-600">Type:</span>
          <button
            type="button"
            onClick={() => setModelFilter('all')}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              modelFilter === 'all'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            All
          </button>
          {filterModels.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModelFilter(m)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                modelFilter === m
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {bookingModelShortLabel(m)}
            </button>
          ))}
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

      {/* Grid keeps columns in separate tracks so intrinsic widths cannot overlap (flex + w-max on the period control caused overflow into the actions column). */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-x-8 lg:gap-y-4">
        <div className="min-w-0 max-w-full">
          <p className="mb-2 text-xs font-medium text-slate-500">View period</p>
          <div className="grid w-full max-w-full grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm sm:grid-cols-4">
            {(['day', 'week', 'month', 'custom'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setViewMode(mode);
                  if (mode !== 'custom') setAnchorDate(todayISO());
                }}
                className={`min-w-0 touch-manipulation rounded-lg px-2 py-3 text-sm font-medium capitalize transition-all sm:px-3 sm:py-2.5 md:px-4 ${
                  viewMode === mode ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 max-w-full flex-col gap-3 lg:max-w-none lg:shrink-0">
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={goToday}
              className="touch-manipulation min-h-[44px] rounded-lg border border-slate-200 bg-white px-2 py-2.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 sm:px-3 sm:text-sm"
            >
              Today
            </button>
            <button
              type="button"
              onClick={goTomorrow}
              className="touch-manipulation min-h-[44px] rounded-lg border border-slate-200 bg-white px-2 py-2.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 sm:px-3 sm:text-sm"
            >
              Tomorrow
            </button>
            <button
              type="button"
              onClick={openCsvModal}
              className="touch-manipulation min-h-[44px] rounded-lg border border-slate-200 bg-white px-2 py-2.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 sm:px-3 sm:text-sm"
            >
              Export
            </button>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
            <button
              type="button"
              onClick={() => setNewBookingOpen(true)}
              className="flex min-h-[48px] touch-manipulation items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-sm font-medium text-white shadow-sm active:bg-brand-800 sm:min-h-[44px] hover:bg-brand-700"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              New Booking
            </button>
            <button
              type="button"
              onClick={() => setWalkInOpen(true)}
              className="flex min-h-[48px] touch-manipulation items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white shadow-sm active:bg-emerald-800 sm:min-h-[44px] hover:bg-emerald-700"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Walk-in
            </button>
          </div>
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
          <div className="flex items-stretch justify-between gap-1 rounded-xl border border-slate-200 bg-white px-1 py-2 shadow-sm sm:px-4 sm:py-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="flex min-h-[48px] min-w-[48px] shrink-0 touch-manipulation items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50 hover:text-slate-700 active:bg-slate-100 sm:min-h-[44px] sm:min-w-[44px]"
              aria-label="Previous period"
            >
              <svg className="h-6 w-6 sm:h-5 sm:w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
            </button>
            <div className="min-w-0 flex-1 px-1 text-center sm:px-2">
              <h2 className="text-sm font-semibold leading-snug text-slate-900 sm:text-base">
                <span className="sm:hidden">{formatDateLabelCompact(anchorDate, viewMode)}</span>
                <span className="hidden sm:inline">{formatDateLabel(anchorDate, viewMode)}</span>
              </h2>
              {anchorDate === todayISO() && (
                <span className="mt-0.5 inline-block text-xs font-medium text-brand-600">Today</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => navigate(1)}
              className="flex min-h-[48px] min-w-[48px] shrink-0 touch-manipulation items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50 hover:text-slate-700 active:bg-slate-100 sm:min-h-[44px] sm:min-w-[44px]"
              aria-label="Next period"
            >
              <svg className="h-6 w-6 sm:h-5 sm:w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex flex-col gap-1">
            <label htmlFor="appt-custom-from" className="text-xs font-medium text-slate-600">
              From
            </label>
            <input
              id="appt-custom-from"
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="appt-custom-to" className="text-xs font-medium text-slate-600">
              To
            </label>
            <input
              id="appt-custom-to"
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>
          {invalidCustomRange && (
            <p className="w-full text-sm font-medium text-red-600">“From” must be on or before “To”.</p>
          )}
        </div>
      )}

      <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <DashboardStatCard label={statsPrimaryLabel} value={stats.total} color="brand" />
        <DashboardStatCard label="Confirmed" value={stats.confirmed} color="emerald" />
        <DashboardStatCard label="Completed" value={stats.completed} color="violet" />
        <DashboardStatCard label="No-shows" value={stats.noShows} color="slate" />
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <p className="text-xs font-medium text-slate-500">Status</p>
        <div className="-mx-0.5 flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain pb-1 pt-0.5 [scrollbar-width:thin] touch-pan-x sm:-mx-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => setStatusKey(f.label)}
              className={`snap-start flex-shrink-0 touch-manipulation rounded-full px-3.5 py-2.5 text-xs font-medium transition-colors sm:py-2 sm:text-sm ${
                statusKey === f.label
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-100 pt-3 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-xs">
            <span className="text-xs font-medium text-slate-600">Calendar</span>
            <select
              value={practitionerFilter}
              onChange={(e) => setPractitionerFilter(e.target.value as 'all' | string)}
              className="min-h-[48px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 sm:min-h-[44px] sm:text-sm"
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
                    const label =
                      myCalendarIds.length === 1
                        ? 'My appointments'
                        : `Mine — ${p?.name ?? 'Calendar'}`;
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
          <label className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-xs">
            <span className="text-xs font-medium text-slate-600">Service</span>
            <select
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value as 'all' | string)}
              className="min-h-[48px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 sm:min-h-[44px] sm:text-sm"
            >
              <option value="all">All services</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-md">
            <span className="text-xs font-medium text-slate-600">Search</span>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Name, phone, email, or booking reference"
              className="min-h-[48px] w-full rounded-lg border border-slate-200 px-3 py-2.5 text-base text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 sm:min-h-[44px] sm:text-sm"
              autoComplete="off"
            />
          </label>
        </div>
        {isRefreshing && <p className="text-xs text-slate-500">Syncing…</p>}
      </div>

      {selectedBookingIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
          <span className="text-xs font-medium text-slate-600">
            {selectedBookingIds.length} selected
          </span>
          <button
            type="button"
            disabled={bulkGuestMessageSending}
            onClick={() => setBulkGuestMessageOpen(true)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Send message…
          </button>
          <button
            type="button"
            onClick={() => setSelectedBookingIds([])}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
          >
            Clear selection
          </button>
        </div>
      )}

      {loading ? (
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
          {Object.entries(groupedByDate ?? {})
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, dayBookings]) => (
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
      )}

      {csvModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          role="presentation"
          onClick={() => !csvExporting && setCsvModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="csv-export-title"
            className="max-h-[min(90vh,100dvh)] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6 shadow-2xl sm:rounded-2xl sm:p-6 sm:pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="csv-export-title" className="text-lg font-semibold text-slate-900">
              Export bookings (CSV)
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              Choose a date range. All booking statuses are included in the file.
            </p>
            <div className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">From</span>
                <input
                  type="date"
                  value={csvFrom}
                  onChange={(e) => setCsvFrom(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">To</span>
                <input
                  type="date"
                  value={csvTo}
                  onChange={(e) => setCsvTo(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              {invalidCsvRange && (
                <p className="text-sm text-red-600">“From” must be on or before “To”.</p>
              )}
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={csvExporting}
                onClick={() => setCsvModalOpen(false)}
                className="min-h-[44px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={csvExporting || invalidCsvRange}
                onClick={() => void runCsvExport()}
                className="min-h-[44px] rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {csvExporting ? 'Preparing…' : 'Download CSV'}
              </button>
            </div>
          </div>
        </div>
      )}

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

      <AppointmentDetailSheet
        open={detailBookingId !== null}
        bookingId={detailBookingId}
        onClose={() => setDetailBookingId(null)}
        onUpdated={() => {
          void fetchBookings({ silent: true });
          void fetchBookingsForStats();
        }}
        currency={currency}
        practitioners={activePractitioners}
        prefetchedBooking={detailPrefetch}
        services={services.map((s) => ({
          id: s.id,
          name: s.name,
          duration_minutes: s.duration_minutes,
          colour: s.colour ?? '#6366f1',
          price_pence: s.price_pence ?? null,
        }))}
      />
      </div>
    </PageFrame>
  );
}
