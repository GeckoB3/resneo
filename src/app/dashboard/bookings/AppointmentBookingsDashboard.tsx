'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';
import { DashboardStaffBookingModal } from '@/components/booking/DashboardStaffBookingModal';
import {
  AppointmentDetailSheet,
  type AppointmentDetailPrefetch,
} from '@/components/booking/AppointmentDetailSheet';
import type { RegistryAppointment } from '@/components/booking/AppointmentRegistryCard';
import { OperationsWorkspaceToolbar } from '@/components/dashboard/OperationsWorkspaceToolbar';
import { PageFrame } from '@/components/ui/dashboard/PageFrame';
import { EmptyState } from '@/components/ui/dashboard/EmptyState';
import { currencySymbolFromCode } from '@/lib/money/currency-symbol';
import { useToast } from '@/components/ui/Toast';
import { buildCsvFromRows, downloadCsvString, formatMoneyPence } from '@/lib/appointments-csv';
import { BOOKING_MUTABLE_STATUSES } from '@/lib/table-management/constants';
import type { BookingModel } from '@/types/booking-models';
import { BOOKING_MODEL_ORDER, venueExposesBookingModel } from '@/lib/booking/enabled-models';
import { inferBookingRowModel, bookingModelShortLabel } from '@/lib/booking/infer-booking-row-model';
import {
  isAttendanceConfirmed,
  showAttendanceConfirmedPill,
  showDepositPendingPill,
} from '@/lib/booking/booking-staff-indicators';
import { Pill, type PillVariant } from '@/components/ui/dashboard/Pill';
import { CalendarDateTimePicker } from '@/components/calendar/CalendarDateTimePicker';
import { getCalendarGridBounds } from '@/lib/venue-calendar-bounds';
import { isBookingTimeInHourRange } from '@/lib/booking-time-window';
import type { OpeningHours } from '@/types/availability';
import { BulkGuestMessageModal } from '@/components/booking/BulkGuestMessageModal';
import type { GuestMessageChannel } from '@/lib/booking/guest-message-channel';
import { GuestMessageChannelSelect } from '@/components/booking/GuestMessageChannelSelect';
import { ClampedFixedDropdown } from '@/components/ui/ClampedFixedDropdown';
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
    return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} – ${end.getDate()} ${MONTHS_SHORT[end.getMonth()]} ${end.getFullYear()}`;
  }
  if (mode === 'month') return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
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
  const [messageDraftById, setMessageDraftById] = useState<Record<string, string>>({});
  const [messageChannelById, setMessageChannelById] = useState<Record<string, GuestMessageChannel>>({});
  const [sendingMessageIds, setSendingMessageIds] = useState<string[]>([]);

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
        if (selectedStatusFilter?.attendanceConfirmed) {
          params.set('attendance_confirmed', '1');
        } else if (selectedStatusFilter?.apiValue) {
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
    const confirmed = statsBookings.filter(isAttendanceConfirmed).length;
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

  const sendGuestMessage = useCallback(
    async (bookingId: string, message: string, channel: GuestMessageChannel) => {
      const trimmed = message.trim();
      if (!trimmed) return;
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
          return;
        }
        setMessageDraftById((prev) => ({ ...prev, [bookingId]: '' }));
        addToast('Message sent', 'success');
      } catch {
        addToast('Could not send message', 'error');
      } finally {
        setSendingMessageIds((prev) => prev.filter((id) => id !== bookingId));
      }
    },
    [addToast],
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
    const bookingModel = inferRegistryModel(b);
    const typeLabel = bookingModelShortLabel(bookingModel);
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
    const draftMessage = messageDraftById[b.id] ?? '';
    const sendingMessage = sendingMessageIds.includes(b.id);
    const messageChannel = messageChannelById[b.id] ?? 'both';

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
        className={`cursor-pointer border-l-[3px] py-2 pl-2 pr-2 transition-colors sm:py-2.5 sm:pl-3 sm:pr-3 ${statusBorderClass(b.status)} ${expanded ? 'bg-brand-50/20' : 'hover:bg-slate-50/50'}`}
      >
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
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
              <span className="hidden shrink-0 text-slate-300 sm:inline">·</span>
              <span className="hidden shrink-0 text-[11px] font-medium text-slate-500 sm:inline">
                {formatDayHeader(b.booking_date)}
              </span>
              <span className="hidden shrink-0 text-slate-300 sm:inline">·</span>
              <span className="hidden max-w-[10rem] truncate text-[11px] font-medium text-slate-600 sm:inline">
                {svcName}
              </span>
              <span className="hidden shrink-0 text-slate-300 md:inline">·</span>
              <span className="hidden max-w-[8rem] truncate text-[11px] text-slate-500 md:inline">
                {pracName}
              </span>
              <Pill variant={statusPillVariant(b.status)} size="sm">
                {tableStatusLabel(b.status)}
              </Pill>
              {showDepositPendingPill(b) && (
                <Pill variant="warning" size="sm" dot>
                  <span className="sm:hidden">Deposit</span>
                  <span className="hidden sm:inline">Deposit pending</span>
                </Pill>
              )}
              {showAttendanceConfirmedPill(b) && (
                <Pill variant="success" size="sm" dot>
                  Confirmed
                </Pill>
              )}
              <Pill variant={bookingTypePillVariant(bookingModel)} size="sm">
                {typeLabel}
              </Pill>
              {duration != null && (
                <span className="hidden rounded bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500 sm:inline-block">
                  {duration} min
                </span>
              )}
              {b.party_size > 1 && (
                <span className="hidden rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 sm:inline-block">
                  {b.party_size} people
                </span>
              )}
              <span className="hidden sm:inline-flex">
                <Pill variant={sourcePillVariant(b.source)} size="sm">
                  {sourceLabelShort(b.source)}
                </Pill>
              </span>
              {priceDisplay && (
                <span className="hidden sm:inline-flex">
                  <Pill variant={depositPillVariant(b.deposit_status)} size="sm" dot>
                    {priceDisplay} · {b.deposit_status}
                  </Pill>
                </span>
              )}
            </div>
          </div>
          <div onClick={(e) => e.stopPropagation()} className="flex shrink-0 items-center justify-end gap-1">
            {showConfirm && (
              <button
                type="button"
                disabled={confirmAttendanceLoadingId === b.id}
                onClick={() => void confirmBookingAttendance(b.id)}
                className="inline-flex min-h-8 items-center justify-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-900 shadow-sm transition-colors duration-150 hover:bg-teal-100 focus:outline-none focus:ring-2 focus:ring-teal-400/30 disabled:opacity-60 sm:min-w-[4.75rem] sm:px-2.5 sm:text-xs"
                aria-label={`Confirm attendance for ${b.guest_name}`}
                aria-busy={confirmAttendanceLoadingId === b.id}
              >
                {confirmAttendanceLoadingId === b.id ? (
                  <span
                    className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-teal-700/25 border-t-teal-800"
                    aria-hidden
                  />
                ) : null}
                <span>Confirm</span>
              </button>
            )}
            {showCancelConfirm && (
              <button
                type="button"
                disabled={confirmAttendanceLoadingId === b.id}
                onClick={() => void cancelStaffAttendanceConfirmation(b.id)}
                className="inline-flex min-h-8 items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm transition-colors duration-150 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400/30 disabled:opacity-60 sm:min-w-[5.5rem] sm:px-2.5 sm:text-xs"
                aria-label={`Cancel staff attendance confirmation for ${b.guest_name}`}
                aria-busy={confirmAttendanceLoadingId === b.id}
              >
                {confirmAttendanceLoadingId === b.id ? (
                  <span
                    className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-slate-400/30 border-t-slate-600"
                    aria-hidden
                  />
                ) : null}
                <span className="sm:hidden">Undo</span>
                <span className="hidden sm:inline">Unconfirm</span>
              </button>
            )}
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
            className="mt-1.5 space-y-2 px-0.5 pb-2.5 sm:px-1"
          >
            {renderExpandedAppointment(b, {
              svcName,
              pracName,
              duration,
              priceDisplay,
              draftMessage,
              sendingMessage,
              messageChannel,
            })}
          </div>
        )}
      </div>
    );
  }

  function renderExpandedAppointment(
    b: RegistryAppointment,
    ctx: {
      svcName: string;
      pracName: string;
      duration: number | null;
      priceDisplay: string | null;
      draftMessage: string;
      sendingMessage: boolean;
      messageChannel: GuestMessageChannel;
    },
  ) {
    const { svcName, pracName, duration, priceDisplay, draftMessage, sendingMessage, messageChannel } = ctx;
    const showConfirm = canShowConfirmBookingAttendance(b);
    const showCancelConfirm = canShowCancelStaffAttendanceConfirmation(b);
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
    const firstName = b.guest_name.split(' ')[0] || 'guest';

    const infoTile = (label: string, value: ReactNode, tone = 'slate') => (
      <div className={`rounded-lg border px-2 py-1.5 ${
        tone === 'brand'
          ? 'border-brand-100 bg-brand-50/60'
          : tone === 'emerald'
            ? 'border-emerald-100 bg-emerald-50/60'
            : tone === 'amber'
              ? 'border-amber-100 bg-amber-50/60'
              : 'border-slate-200 bg-slate-50/70'
      }`}>
        <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">{label}</p>
        <div className="truncate text-xs font-bold text-slate-800">{value}</div>
      </div>
    );

    return (
      <div className="space-y-2">
        <section className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm shadow-slate-900/[0.03] sm:p-3">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-sm font-bold text-brand-700 ring-1 ring-brand-100">
                {b.guest_name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                  <p className="max-w-[12rem] truncate text-sm font-bold text-slate-900 sm:max-w-[18rem]">{b.guest_name}</p>
                  <Pill variant="neutral" size="sm">
                    {b.guest_visit_count && b.guest_visit_count > 0
                      ? `${b.guest_visit_count} visit${b.guest_visit_count === 1 ? '' : 's'}`
                      : 'First visit'}
                  </Pill>
                </div>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                  <span className="font-medium text-slate-700">{formatDayHeader(b.booking_date)}</span>
                  <span className="text-slate-300">·</span>
                  <span className="font-semibold tabular-nums text-slate-700">
                    {b.booking_time.slice(0, 5)}{endTime ? `-${endTime}` : ''}
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="max-w-[12rem] truncate">{svcName}</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:flex sm:shrink-0 sm:items-center">
              {b.guest_phone ? (
                <a href={`tel:${b.guest_phone}`} className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
                  Call
                </a>
              ) : null}
              {b.guest_email ? (
                <a href={`mailto:${b.guest_email}`} className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
                  Email
                </a>
              ) : null}
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {infoTile('Service', svcName, 'brand')}
            {infoTile('Staff', pracName)}
            {infoTile('Time', (
              <span className="tabular-nums">
                {b.booking_time.slice(0, 5)}{endTime ? `-${endTime}` : ''}
                {duration != null ? <span className="ml-1 text-slate-500">({duration}m)</span> : null}
              </span>
            ))}
            {infoTile('Payment', priceDisplay ? `${priceDisplay} · ${b.deposit_status}` : b.deposit_status, b.deposit_status === 'Paid' ? 'emerald' : b.deposit_status === 'Pending' ? 'amber' : 'slate')}
            {infoTile('Source', <Pill variant={sourcePillVariant(b.source)} size="sm">{sourceLabelShort(b.source)}</Pill>)}
            {arrivedAt ? infoTile('Arrived', arrivedAt, 'emerald') : null}
            {b.party_size > 1 ? infoTile('Party', `${b.party_size} people`) : null}
            {infoTile('Ref', (
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(b.id)}
                className="truncate text-left hover:text-brand-700"
                title="Copy booking reference"
              >
                #{b.id.slice(0, 8)}
              </button>
            ))}
          </div>
        </section>

        <details className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-900/[0.03]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-slate-700 marker:hidden">
            <span>SMS / email guest</span>
            <span className="text-[11px] font-medium text-slate-400 group-open:hidden">
              {b.guest_phone && b.guest_email ? 'SMS + email' : b.guest_phone ? 'SMS' : b.guest_email ? 'Email' : 'No contact'}
            </span>
            <svg className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </summary>
          <div className="border-t border-slate-100 bg-brand-50/20 p-2.5 sm:p-3">
            <textarea
              value={draftMessage}
              onChange={(e) => setMessageDraftById((prev) => ({ ...prev, [b.id]: e.target.value }))}
              rows={3}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
              placeholder={`Write a message to ${firstName}...`}
            />
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <label className="flex items-center justify-between gap-2 text-xs font-medium text-slate-500 sm:justify-start">
                Send via
                <GuestMessageChannelSelect
                  value={messageChannel}
                  onChange={(value) => setMessageChannelById((prev) => ({ ...prev, [b.id]: value }))}
                  disabled={sendingMessage}
                />
              </label>
              <button
                type="button"
                disabled={sendingMessage || draftMessage.trim().length === 0}
                onClick={() => void sendGuestMessage(b.id, draftMessage, messageChannel)}
                className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-white transition-colors duration-150 hover:bg-slate-900 disabled:opacity-50 sm:min-h-8 sm:py-1.5"
                aria-busy={sendingMessage}
              >
                {sendingMessage ? (
                  <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-white/25 border-t-white" aria-hidden />
                ) : null}
                Send
              </button>
            </div>
          </div>
        </details>

        <details className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-900/[0.03]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-slate-700 marker:hidden">
            <span>Appointment details</span>
            <span className="text-[11px] font-medium text-slate-400 group-open:hidden">{svcName}</span>
            <svg className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </summary>
          <div className="border-t border-slate-100 p-2.5">
            <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {infoTile('Client', b.guest_name)}
              {infoTile('Email', b.guest_email ? <a href={`mailto:${b.guest_email}`} className="hover:text-brand-700">{b.guest_email}</a> : 'Not provided')}
              {infoTile('Phone', b.guest_phone ? <a href={`tel:${b.guest_phone}`} className="hover:text-brand-700">{b.guest_phone}</a> : 'Not provided')}
              {infoTile('Status', <Pill variant={statusPillVariant(b.status)} size="sm">{tableStatusLabel(b.status)}</Pill>)}
            </dl>
          </div>
        </details>

        <details className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-900/[0.03]" open={Boolean(notes || internal)}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-slate-700 marker:hidden">
            <span>Notes and preferences</span>
            <span className="text-[11px] font-medium text-slate-400 group-open:hidden">
              {[notes, internal].filter(Boolean).length || 'None'}
            </span>
            <svg className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </summary>
          <section className="space-y-2 border-t border-slate-100 p-2.5">
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
            {!notes && !internal ? <p className="text-xs text-slate-400">No notes or preferences recorded.</p> : null}
          </section>
        </details>

        <section className="flex flex-wrap items-end gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2 shadow-sm shadow-slate-900/[0.03]">
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
              className="inline-flex min-h-9 min-w-[7rem] items-center justify-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-900 shadow-sm transition-colors duration-150 hover:bg-teal-100 focus:outline-none focus:ring-2 focus:ring-teal-400/30 disabled:opacity-60"
              aria-busy={confirmAttendanceLoadingId === b.id}
            >
              {confirmAttendanceLoadingId === b.id ? (
                <span
                  className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-teal-700/25 border-t-teal-800"
                  aria-hidden
                />
              ) : null}
              <span>Confirm</span>
            </button>
          )}
          {showCancelConfirm && (
            <button
              type="button"
              disabled={confirmAttendanceLoadingId === b.id}
              onClick={() => void cancelStaffAttendanceConfirmation(b.id)}
              className="inline-flex min-h-9 min-w-[7rem] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors duration-150 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400/30 disabled:opacity-60"
              aria-busy={confirmAttendanceLoadingId === b.id}
            >
              {confirmAttendanceLoadingId === b.id ? (
                <span
                  className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-slate-400/30 border-t-slate-600"
                  aria-hidden
                />
              ) : null}
              <span>Unconfirm</span>
            </button>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setDetailBookingId(b.id)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 shadow-sm transition-colors hover:bg-brand-100 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
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
        </section>
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
                  const label = myCalendarIds.length === 1 ? 'My appointments' : `Mine - ${p?.name ?? 'Calendar'}`;
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

  const appointmentSearchPanel = (
    <div className="space-y-2">
      <label htmlFor="appointment-toolbar-search" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Search
      </label>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
        </div>
        <input
          id="appointment-toolbar-search"
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search client, phone, email..."
          className="w-full rounded-xl border border-slate-200 bg-slate-50/60 py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-brand-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
          autoComplete="off"
        />
      </div>
      {searchQuery.trim() ? (
        <button
          type="button"
          onClick={() => setSearchQuery('')}
          className="text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline"
        >
          Clear search
        </button>
      ) : null}
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
        searchActive={searchQuery.trim().length > 0}
        searchPanel={appointmentSearchPanel}
        trailingActions={
          <button
            type="button"
            onClick={openCsvModal}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-800 sm:w-auto sm:px-2 sm:text-[11px] sm:font-semibold"
            aria-label="Export appointments"
          >
            <svg className="h-4 w-4 sm:hidden" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M7.5 12 12 16.5m0 0 4.5-4.5M12 16.5V3" />
            </svg>
            <span className="hidden sm:inline">Export</span>
          </button>
        }
      />
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5">
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 bg-brand-500 transition-opacity duration-200 ease-out ${isRefreshing ? 'opacity-100' : 'opacity-0'}`}
          aria-hidden
        />
      </div>

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
