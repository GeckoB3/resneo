'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';
import { parseDietaryNotes, hasAllergyKeywords } from '@/lib/day-sheet';
import { useToast } from '@/components/ui/Toast';
import {
  BOOKING_PRIMARY_ACTIONS,
  BOOKING_REVERT_ACTIONS,
  canMarkNoShowForSlot,
  canTransitionBookingStatus,
  isDestructiveBookingStatus,
  isRevertTransition,
  isTerminalBookingStatus,
  isBookingInstantRevertTransition,
  type BookingStatus,
} from '@/lib/table-management/booking-status';
import { UndoToast } from '@/app/dashboard/table-grid/UndoToast';
import type { UndoAction } from '@/types/table-management';
import { DashboardStaffBookingModal } from '@/components/booking/DashboardStaffBookingModal';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { ConfirmDialog } from '@/components/ui/primitives/ConfirmDialog';
import type { BookingModel } from '@/types/booking-models';
import { ExpandedBookingContent } from '@/app/dashboard/bookings/ExpandedBookingContent';
import { BookingDetailPanel, type BookingDetailPanelSnapshot } from '@/app/dashboard/bookings/BookingDetailPanel';
import { expandedBookingRowShellClass } from '@/app/dashboard/bookings/booking-expand-accordion-classes';
import { OperationsWorkspaceToolbar } from '@/components/dashboard/OperationsWorkspaceToolbar';
import { OperationsToolbarGuestSearchPanel } from '@/components/dashboard/OperationsToolbarGuestSearchPanel';
import type { ViewToolbarSummary } from '@/components/dashboard/ViewToolbar';
import { BookingStatusPill } from '@/components/ui/dashboard/BookingStatusPill';
import { Pill, type PillVariant } from '@/components/ui/dashboard/Pill';
import {
  bookingModelShortLabel,
  bookingStatusDisplayLabel,
  inferBookingRowModel,
  isTableReservationBooking,
} from '@/lib/booking/infer-booking-row-model';
import {
  canShowCancelStaffAttendanceConfirmationAction,
  canShowConfirmBookingAttendanceAction,
  isAttendanceConfirmed,
  showAttendanceConfirmedSupplementPill,
  showDepositPendingPill,
} from '@/lib/booking/booking-staff-indicators';
import {
  BOOKING_ATTENDANCE_CONFIRM_SOLID_BUTTON,
  BOOKING_ATTENDANCE_CONFIRM_SPINNER,
  BOOKING_ATTENDANCE_UNDO_OUTLINE_BUTTON,
  BOOKING_ATTENDANCE_UNDO_SPINNER,
  BOOKING_START_PRIMARY_BUTTON_CLASSES,
  bookingStatusVisualForKey,
} from '@/lib/table-management/booking-status-visual';
import {
  computeNextBookingsSlotFromBookingRows,
  nextBookingsTileContent,
} from '@/lib/table-management/next-bookings-slot';
import { TableSelector } from '@/components/table-tracking/TableSelector';
import type { OccupancyMap } from '@/components/table-tracking/TableSelector';
import type { GuestMessageChannel, GuestMessageSendResult } from '@/lib/booking/guest-message-channel';
import { CalendarDateTimePicker } from '@/components/calendar/CalendarDateTimePicker';
import { EmptyState } from '@/components/ui/dashboard/EmptyState';
import { getCalendarGridBounds } from '@/lib/venue-calendar-bounds';
import { isBookingTimeInHourRange } from '@/lib/booking-time-window';
import type { OpeningHours } from '@/types/availability';
import { Skeleton } from '@/components/ui/Skeleton';
import { LinkedCalendarView } from '@/components/linked-accounts/LinkedCalendarView';

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface DaySheetBooking {
  id: string;
  booking_time: string;
  estimated_end_time: string | null;
  party_size: number;
  status: string;
  source: string;
  deposit_status: string;
  deposit_amount_pence: number | null;
  dietary_notes: string | null;
  special_requests: string | null;
  internal_notes: string | null;
  occasion: string | null;
  guest_name: string;
  guest_phone: string | null;
  guest_email: string | null;
  guest_id: string;
  visit_count: number;
  no_show_count: number;
  last_visit_date: string | null;
  created_at: string;
  guest_tags?: string[];
  table_assignments?: Array<{ id: string; name: string }>;
  experience_event_id?: string | null;
  class_instance_id?: string | null;
  resource_id?: string | null;
  event_session_id?: string | null;
  calendar_id?: string | null;
  service_item_id?: string | null;
  practitioner_id?: string | null;
  appointment_service_id?: string | null;
  guest_attendance_confirmed_at?: string | null;
  staff_attendance_confirmed_at?: string | null;
  client_arrived_at?: string | null;
  area_name?: string | null;
  booking_model?: string | null;
}

interface DaySheetBookingRow extends DaySheetBooking {
  booking_date: string;
}

interface ActiveTable {
  id: string;
  name: string;
  max_covers: number;
  sort_order: number;
}

interface DaySheetPeriod {
  key: string;
  label: string;
  start_time: string;
  end_time: string;
  max_covers: number | null;
  booked_covers: number;
  bookings: DaySheetBooking[];
}

interface DaySheetData {
  date: string;
  venue_name: string;
  periods: DaySheetPeriod[];
  summary: {
    total_bookings: number;
    total_covers: number;
    covers_remaining: number | null;
    pending_count: number;
    seated_covers: number;
    completed_covers: number;
    no_show_covers: number;
    cancelled_covers: number;
    venue_max_capacity: number | null;
    covers_in_use: number;
    covers_available_now: number | null;
    freeing_soon: number;
    arriving_soon: number;
    is_today: boolean;
    default_duration_minutes: number;
  };
  dietary_summary: Array<{ label: string; count: number; isAllergy?: boolean }>;
  no_show_grace_minutes: number;
  capacity_configured: boolean;
  active_tables?: ActiveTable[];
  areas?: Array<{ id: string; name: string; colour: string }>;
  selected_area_id?: string | null;
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
  cde_context?: {
    inferred_model: BookingModel;
    title: string;
    subtitle?: string | null;
  } | null;
  inferred_booking_model?: BookingModel;
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

type ConnectionStatus = 'green' | 'amber' | 'red';

interface Filters {
  periodKey: string;
  statuses: Set<string>;
  search: string;
  showCancelled: boolean;
  showNoShow: boolean;
}

// â”€â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const POLL_INTERVAL_MS = 30_000;

const AREA_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_STATUSES = new Set(['Pending', 'Booked', 'Confirmed', 'Seated']);

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function formatDateFull(date: string): string {
  const d = new Date(date + 'T12:00:00');
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function statusBorderClass(status: string): string {
  return bookingStatusVisualForKey(status).listBorderLeft;
}

function sourceBadge(source: string) {
  const key = source.toLowerCase();
  const variantMap: Record<string, PillVariant> = {
    online: 'brand',
    phone: 'neutral',
    'walk-in': 'warning',
    staff: 'neutral',
    booking_page: 'brand',
  };
  const label = key === 'booking_page' ? 'online' : source;
  return <Pill variant={variantMap[key] ?? 'neutral'} size="sm">{label}</Pill>;
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

function depositBadge(status: string, amountPence: number | null) {
  if (status === 'Not Required' || status === 'N/A') return null;
  const amt = amountPence ? `£${(amountPence / 100).toFixed(2)}` : null;
  const variantMap: Record<string, PillVariant> = {
    Paid: 'success',
    Refunded: 'brand',
    Pending: 'warning',
    Requested: 'warning',
    Unpaid: 'warning',
  };
  const labelMap: Record<string, string> = {
    Paid: amt ? `${amt} paid` : 'Deposit paid',
    Refunded: amt ? `${amt} refunded` : 'Refunded',
    Pending: 'Deposit pending',
    Requested: 'Deposit requested',
    Unpaid: 'Deposit due',
    Waived: 'Waived',
  };
  const variant = variantMap[status] ?? 'neutral';
  const label = labelMap[status] ?? status;
  return <Pill variant={variant} size="sm" dot={status === 'Pending' || status === 'Requested' || status === 'Unpaid'}>{label}</Pill>;
}

/**
 * Confirm attendance when nobody has confirmed yet; "undo" clears guest + staff
 * attendance markers (same PATCH as bookings dashboard lists).
 */
function canShowDaySheetStaffAttendanceToggle(b: {
  status: string;
  source?: string | null;
  guest_attendance_confirmed_at?: string | null;
  staff_attendance_confirmed_at?: string | null;
}): boolean {
  if (b.source === 'walk-in' || b.source === 'Walk-in') return false;
  if (['Cancelled', 'No-Show', 'Completed'].includes(b.status)) return false;
  return (
    canShowConfirmBookingAttendanceAction(b) ||
    canShowCancelStaffAttendanceConfirmationAction(b)
  );
}

const isTerminal = isTerminalBookingStatus;

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]!);
}

// â”€â”€â”€ FillBar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function FillBar({ booked, capacity }: { booked: number; capacity: number }) {
  const pct = capacity > 0 ? Math.min(100, Math.round((booked / capacity) * 100)) : 0;
  const colour = pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full transition-all ${colour}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-semibold tabular-nums ${pct >= 90 ? 'text-red-600' : pct >= 75 ? 'text-amber-600' : 'text-emerald-600'}`}>
        {pct}%
      </span>
    </div>
  );
}

// â”€â”€â”€ Day sheet toolbar summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function DaySheetToolbarSummary({
  summary,
  periods,
}: {
  summary: DaySheetData['summary'];
  periods: DaySheetPeriod[];
}) {
  const isTodayView = summary.is_today;
  const bookingRows = periods.flatMap((p) =>
    p.bookings.map((b) => ({
      id: b.id,
      start_time: b.booking_time,
      party_size: b.party_size,
      status: b.status,
    })),
  );
  const refMinutes = isTodayView ? new Date().getHours() * 60 + new Date().getMinutes() : 0;
  const nextBookingsSlot = computeNextBookingsSlotFromBookingRows(bookingRows, refMinutes);
  const nextBookings = nextBookingsTileContent(nextBookingsSlot);

  const cap = summary.venue_max_capacity;
  const coversPct =
    cap != null && cap > 0 ? Math.round((summary.covers_in_use / cap) * 100) : 0;
  const coversValue = isTodayView
    ? cap != null
      ? `${summary.covers_in_use}/${cap}`
      : String(summary.covers_in_use)
    : String(summary.total_covers);
  const availableValue = isTodayView
    ? summary.covers_available_now != null
      ? String(summary.covers_available_now)
      : '-'
    : summary.covers_remaining != null
      ? String(summary.covers_remaining)
      : '-';
  const chip =
    'inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200/90 bg-slate-50 px-1.5 py-0.5 font-medium text-slate-800';
  const label = 'text-slate-500 font-normal';

  return (
    <div className="space-y-2" aria-label="Day sheet summary">
      <div className="flex flex-wrap items-center gap-1 text-[11px] sm:gap-1.5 sm:text-xs">
        <span className={chip}>
          <span className={label}>{isTodayView ? 'Live' : 'Covers'}</span>
          <span className="tabular-nums">{coversValue}</span>
          {isTodayView && cap != null && cap > 0 ? <span className="text-slate-400">({coversPct}%)</span> : null}
        </span>
        <span className={chip}>
          <span className={label}>{isTodayView ? 'Available' : 'Remaining'}</span>
          <span className="tabular-nums">{availableValue}</span>
        </span>
        <span className={chip}>
          <span className={label}>Bookings</span>
          <span className="tabular-nums">{summary.total_bookings}</span>
        </span>
        <span className={chip} title={`${nextBookings.guestsLine}; ${nextBookings.bookingsLine}`}>
          <span className={label}>Next</span>
          <span className="tabular-nums">{nextBookings.primaryValue}</span>
        </span>
        {summary.covers_available_now != null || cap != null ? (
          <span className={chip}>
            <span className={label}>Capacity</span>
            <span className="tabular-nums">{cap ?? '-'}</span>
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-1.5 text-[11px] text-slate-600 sm:grid-cols-4">
        <span>Pending <strong className="font-semibold text-slate-800">{summary.pending_count}</strong></span>
        <span>Seated <strong className="font-semibold text-slate-800">{summary.seated_covers}</strong></span>
        <span>Completed <strong className="font-semibold text-slate-800">{summary.completed_covers}</strong></span>
        <span>No-show <strong className="font-semibold text-slate-800">{summary.no_show_covers}</strong></span>
        <span>Cancelled <strong className="font-semibold text-slate-800">{summary.cancelled_covers}</strong></span>
      </div>
    </div>
  );
}

// â”€â”€â”€ ConfirmDialog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function DaySheetView({
  venueId,
  currency,
  bookingModel = 'table_reservation',
  enabledModels = [],
  linkFeature = false,
}: {
  venueId: string;
  currency?: string;
  bookingModel?: BookingModel;
  enabledModels?: BookingModel[];
  /** When true, linked calendars follow this page's selected date (section 8.2). */
  linkFeature?: boolean;
}) {
  const { addToast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Core state
  const [date, setDate] = useState(todayISO);
  const [data, setData] = useState<DaySheetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<ConnectionStatus>('amber');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // UI state
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmState | null>(null);
  const [showWalkIn, setShowWalkIn] = useState(false);
  const [showNewBooking, setShowNewBooking] = useState(false);
  const [dietaryOpen, setDietaryOpen] = useState(false);
  const [openingHours, setOpeningHours] = useState<OpeningHours | null>(null);
  const [venueTimezone, setVenueTimezone] = useState<string>('Europe/London');
  const [startHourOverride, setStartHourOverride] = useState<number | null>(null);
  const [endHourOverride, setEndHourOverride] = useState<number | null>(null);
  const [timeRangeFilterActive, setTimeRangeFilterActive] = useState(false);
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const [tableManagementEnabled, setTableManagementEnabled] = useState(false);
  const [seatWithTableBookingId, setSeatWithTableBookingId] = useState<string | null>(null);
  const [seatSelectedTableIds, setSeatSelectedTableIds] = useState<string[]>([]);
  const [changeTableBookingId, setChangeTableBookingId] = useState<string | null>(null);
  const [changeTableSelectedIds, setChangeTableSelectedIds] = useState<string[]>([]);
  const [staffAttendanceLoadingId, setStaffAttendanceLoadingId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/venue/tables');
        if (!res.ok) return;
        const payload = await res.json();
        setTableManagementEnabled(Boolean(payload.settings?.table_management_enabled));
      } catch (e) {
        console.error('[DaySheetView] /api/venue/tables load failed:', e);
      }
    })();
  }, []);

  // Fetch venue opening hours + timezone for the calendar/time picker bounds.
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
      .catch((e) => console.error('[DaySheetView] /api/venue preload failed:', e));
    return () => {
      cancelled = true;
    };
  }, []);

  // Derive default display window from opening hours, allow user overrides.
  const { startHour: derivedStartHour, endHour: derivedEndHour } = useMemo(
    () =>
      getCalendarGridBounds(date, openingHours ?? undefined, 7, 21, {
        timeZone: venueTimezone,
      }),
    [date, openingHours, venueTimezone],
  );
  const pickerStartHour = startHourOverride ?? derivedStartHour;
  const pickerEndHour = endHourOverride ?? derivedEndHour;

  // Reset the hour filter whenever the user changes the date.
  useEffect(() => {
    setStartHourOverride(null);
    setEndHourOverride(null);
    setTimeRangeFilterActive(false);
  }, [date]);

  // Filters
  const [filters, setFilters] = useState<Filters>({
    periodKey: 'all',
    statuses: new Set(DEFAULT_STATUSES),
    search: '',
    showCancelled: false,
    showNoShow: false,
  });

  const activeTables = useMemo(() => data?.active_tables ?? [], [data]);

  const occupancyMap = useMemo<OccupancyMap>(() => {
    const map: OccupancyMap = {};
    if (!data) return map;
    for (const t of activeTables) map[t.id] = null;
    for (const period of data.periods) {
      for (const b of period.bookings) {
        if (b.status !== 'Seated' || !b.table_assignments?.length) continue;
        for (const ta of b.table_assignments) {
          map[ta.id] = { bookingId: b.id, guestName: b.guest_name };
        }
      }
    }
    return map;
  }, [data, activeTables]);

  const changeTableOccupancyMap = useMemo<OccupancyMap>(() => {
    const map: OccupancyMap = {};
    if (!data || !changeTableBookingId) return map;
    for (const t of activeTables) map[t.id] = null;
    for (const period of data.periods) {
      for (const b of period.bookings) {
        if (b.id === changeTableBookingId) continue;
        if (b.status !== 'Seated' || !b.table_assignments?.length) continue;
        for (const ta of b.table_assignments) {
          map[ta.id] = { bookingId: b.id, guestName: b.guest_name };
        }
      }
    }
    return map;
  }, [data, activeTables, changeTableBookingId]);

  const setAreaFilter = useCallback(
    (value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (!value) next.delete('area');
      else next.set('area', value);
      try {
        window.localStorage.setItem(`daySheetArea:${venueId}`, value || '');
      } catch {
        /* ignore */
      }
      const qs = next.toString();
      router.replace(qs ? `/dashboard/day-sheet?${qs}` : '/dashboard/day-sheet', { scroll: false });
    },
    [router, searchParams, venueId],
  );

  const daySheetAreaHydrated = useRef(false);
  useEffect(() => {
    if (daySheetAreaHydrated.current) return;
    const fromUrl = searchParams.get('area');
    if (fromUrl && AREA_UUID_RE.test(fromUrl)) {
      daySheetAreaHydrated.current = true;
      return;
    }
    try {
      const saved = window.localStorage.getItem(`daySheetArea:${venueId}`);
      if (saved && AREA_UUID_RE.test(saved)) {
        const next = new URLSearchParams(searchParams.toString());
        next.set('area', saved);
        router.replace(`/dashboard/day-sheet?${next}`, { scroll: false });
      }
    } catch {
      /* ignore */
    }
    daySheetAreaHydrated.current = true;
  }, [router, searchParams, venueId]);

  // Fetch data
  const fetchDaySheet = useCallback(async (): Promise<boolean> => {
    try {
      const qs = new URLSearchParams({ date });
      const a = searchParams.get('area');
      if (a && AREA_UUID_RE.test(a)) qs.set('area', a);
      const res = await fetch(`/api/venue/day-sheet?${qs}`);
      if (!res.ok) return false;
      const json = await res.json();
      setData(json);
      setConnection((c) => (c === 'red' ? 'amber' : c));
      return true;
    } catch {
      return false;
    } finally {
      setLoading(false);
    }
  }, [date, searchParams]);

  useEffect(() => { setLoading(true); void fetchDaySheet(); }, [fetchDaySheet]);

  // Realtime subscription
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`day-sheet-${venueId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `venue_id=eq.${venueId}` }, () => { void fetchDaySheet(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'booking_table_assignments' }, () => { void fetchDaySheet(); })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnection('green');
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        } else {
          setConnection('amber');
        }
      });
    return () => {
      supabase.removeChannel(channel);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [venueId, fetchDaySheet]);

  // Polling fallback
  useEffect(() => {
    if (connection === 'amber' && !pollRef.current) {
      pollRef.current = setInterval(() => {
        fetchDaySheet().then((ok) => { if (!ok) setConnection('red'); });
      }, POLL_INTERVAL_MS);
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [connection, fetchDaySheet]);

  const loadBookingDetail = useCallback(async (bookingId: string, force = false) => {
    if (!force && detailById[bookingId]) return;
    if (detailLoadingIds.includes(bookingId)) return;
    setDetailLoadingIds((prev) => [...prev, bookingId]);
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}`);
      if (!res.ok) return;
      const detail = await res.json();
      setDetailById((prev) => ({ ...prev, [bookingId]: detail as BookingDetailLite }));
      setGuestHistoryRevisionById((prev) => ({
        ...prev,
        [bookingId]: (prev[bookingId] ?? 0) + 1,
      }));
    } finally {
      setDetailLoadingIds((prev) => prev.filter((id) => id !== bookingId));
    }
  }, [detailById, detailLoadingIds]);

  const prefetchBookingDetail = useCallback(
    (bookingId: string) => {
      if (detailById[bookingId] || detailLoadingIds.includes(bookingId)) return;
      void fetch(`/api/venue/bookings/${bookingId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((detail) => {
          if (!detail) return;
          setDetailById((prev) => (prev[bookingId] ? prev : { ...prev, [bookingId]: detail as BookingDetailLite }));
          setGuestHistoryRevisionById((prev) => ({
            ...prev,
            [bookingId]: (prev[bookingId] ?? 0) + 1,
          }));
        })
        .catch(() => {});
    },
    [detailById, detailLoadingIds],
  );

  const toggleExpand = useCallback(
    (bookingId: string) => {
      setExpandedId((current) => (current === bookingId ? null : bookingId));
      void loadBookingDetail(bookingId);
    },
    [loadBookingDetail],
  );

  const handleDetailUpdated = useCallback(
    (bookingId: string) => {
      setDetailById((prev) => {
        const next = { ...prev };
        delete next[bookingId];
        return next;
      });
      void loadBookingDetail(bookingId, true);
      void fetchDaySheet();
    },
    [fetchDaySheet, loadBookingDetail],
  );

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
          addToast(detail, 'error');
          return { ok: false, error: detail };
        }
        if (payload.errors && payload.errors.length > 0) {
          const w = payload.errors.join('; ');
          addToast(`Sent with issues - ${w}`, 'error');
          setMessageDraftById((prev) => ({ ...prev, [bookingId]: '' }));
          handleDetailUpdated(bookingId);
          return { ok: true, warning: `Sent with issues: ${w}` };
        }
        addToast('Message sent', 'success');
        setMessageDraftById((prev) => ({ ...prev, [bookingId]: '' }));
        handleDetailUpdated(bookingId);
        return { ok: true };
      } catch {
        addToast('Failed to send message.', 'error');
        return { ok: false, error: 'Failed to send message.' };
      } finally {
        setSendingMessageIds((prev) => prev.filter((id) => id !== bookingId));
      }
    },
    [addToast, handleDetailUpdated],
  );

  const patchStaffAttendance = useCallback(
    async (bookingId: string, unifiedAttendanceConfirmed: boolean) => {
      setStaffAttendanceLoadingId(bookingId);
      const snapshot = data;
      if (snapshot) {
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            periods: prev.periods.map((p) => ({
              ...p,
              bookings: p.bookings.map((b) => {
                if (b.id !== bookingId) return b;
                const updated = {
                  ...b,
                  staff_attendance_confirmed_at: unifiedAttendanceConfirmed ? null : new Date().toISOString(),
                  guest_attendance_confirmed_at: null,
                };
                if (!unifiedAttendanceConfirmed && b.status === 'Booked') {
                  updated.status = 'Confirmed';
                } else if (unifiedAttendanceConfirmed && b.status === 'Confirmed') {
                  updated.status = 'Booked';
                }
                return updated;
              }),
            })),
          };
        });
      }
      try {
        const res = await fetch(`/api/venue/bookings/${bookingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ staff_attendance_confirmed: !unifiedAttendanceConfirmed }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          addToast((j as { error?: string }).error ?? 'Update failed', 'error');
          if (snapshot) setData(snapshot);
          return;
        }
        await fetchDaySheet();
      } catch {
        addToast('Update failed', 'error');
        if (snapshot) setData(snapshot);
      } finally {
        setStaffAttendanceLoadingId(null);
      }
    },
    [addToast, data, fetchDaySheet],
  );

  // Status change with optimistic update
  const changeStatus = useCallback(async (bookingId: string, newStatus: BookingStatus) => {
    if (!data) return;
    const currentBooking = data.periods.flatMap((p) => p.bookings).find((b) => b.id === bookingId);
    if (!currentBooking) return;
    const fromStatus = currentBooking.status as BookingStatus;

    if (!canTransitionBookingStatus(fromStatus, newStatus)) {
      addToast(`Cannot change from ${fromStatus} to ${newStatus}`, 'error');
      return;
    }

    // Optimistic update - recalculate booked_covers and summary
    const snapshot = data;
    setData((prev) => {
      if (!prev) return prev;
      const activeStatuses = ['Pending', 'Booked', 'Confirmed', 'Seated'];
      const updatedPeriods = prev.periods.map((p) => {
        const updatedBookings = p.bookings.map((b) => {
          if (b.id !== bookingId) return b;
          const updated = { ...b, status: newStatus };
          if (fromStatus === 'Confirmed' && newStatus === 'Booked') {
            updated.staff_attendance_confirmed_at = null;
            updated.guest_attendance_confirmed_at = null;
          } else if (newStatus === 'Confirmed' && fromStatus !== 'Confirmed') {
            updated.staff_attendance_confirmed_at = new Date().toISOString();
          }
          return updated;
        });
        const bookedCovers = updatedBookings
          .filter((b) => activeStatuses.includes(b.status))
          .reduce((sum, b) => sum + b.party_size, 0);
        return { ...p, bookings: updatedBookings, booked_covers: bookedCovers };
      });
      const allBookings = updatedPeriods.flatMap((p) => p.bookings);
      const totalCovers = allBookings
        .filter((b) => activeStatuses.includes(b.status))
        .reduce((s, b) => s + b.party_size, 0);
      const seatedNow = allBookings
        .filter((b) => b.status === 'Seated')
        .reduce((s, b) => s + b.party_size, 0);
      const maxCap = prev.summary.venue_max_capacity;
      return {
        ...prev,
        periods: updatedPeriods,
        summary: {
          ...prev.summary,
          total_bookings: allBookings.filter((b) => b.status !== 'Cancelled').length,
          total_covers: totalCovers,
          covers_remaining: maxCap != null ? Math.max(0, maxCap - totalCovers) : null,
          pending_count: allBookings.filter((b) => b.status === 'Pending').length,
          seated_covers: seatedNow,
          covers_in_use: seatedNow,
          covers_available_now: maxCap != null ? Math.max(0, maxCap - seatedNow) : null,
          completed_covers: allBookings.filter((b) => b.status === 'Completed').reduce((s, b) => s + b.party_size, 0),
          no_show_covers: allBookings.filter((b) => b.status === 'No-Show').reduce((s, b) => s + b.party_size, 0),
          cancelled_covers: allBookings.filter((b) => b.status === 'Cancelled').reduce((s, b) => s + b.party_size, 0),
        },
      };
    });
    setActionLoading(bookingId);

    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setData(snapshot);
        addToast(j.error ?? 'Failed to update status', 'error');
        return;
      }
      const label = newStatus === 'Confirmed' ? 'Booking confirmed' :
                     newStatus === 'Booked' ? 'Booking saved' :
                     newStatus === 'Seated' ? 'Guest checked in' :
                     newStatus === 'Completed' ? 'Booking completed' :
                     newStatus === 'No-Show' ? 'Marked as no-show' :
                     newStatus === 'Cancelled' ? 'Booking cancelled' : 'Status updated';
      addToast(label, 'success');
      const tableStyle = isTableReservationBooking(currentBooking);
      setUndoAction({
        id: crypto.randomUUID(),
        type: 'change_status',
        description: `${currentBooking.guest_name}: ${bookingStatusDisplayLabel(fromStatus, tableStyle)} -> ${bookingStatusDisplayLabel(newStatus, tableStyle)}`,
        timestamp: Date.now(),
        previous_state: { bookingId, status: fromStatus },
        current_state: { bookingId, status: newStatus },
      });
      void fetchDaySheet();
    } catch {
      setData(snapshot);
      addToast('Failed to update status', 'error');
    } finally {
      setActionLoading(null);
    }
  }, [data, addToast, fetchDaySheet]);

  const requestStatusChange = useCallback(
    (booking: DaySheetBooking, nextStatus: BookingStatus) => {
      if (!canTransitionBookingStatus(booking.status, nextStatus)) return;
      if (nextStatus === 'No-Show' && data && !canMarkNoShowForSlot(date, booking.booking_time, data.no_show_grace_minutes)) {
        addToast(`No-show can only be marked ${data.no_show_grace_minutes} minutes after the booking start time.`, 'error');
        return;
      }
      if (nextStatus === 'Seated' && activeTables.length > 0 && isTableReservationBooking(booking)) {
        setSeatWithTableBookingId(booking.id);
        setSeatSelectedTableIds([]);
        return;
      }
      const tableStyle = isTableReservationBooking(booking);
      const partyLabel = `${booking.party_size} ${
        tableStyle ? `cover${booking.party_size === 1 ? '' : 's'}` : `person${booking.party_size === 1 ? '' : 's'}`
      }`;
      if (isRevertTransition(booking.status, nextStatus)) {
        if (isBookingInstantRevertTransition(booking.status, nextStatus, tableStyle)) {
          void changeStatus(booking.id, nextStatus);
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
          onConfirm: () => { void changeStatus(booking.id, nextStatus); },
        });
        return;
      }
      if (isDestructiveBookingStatus(nextStatus)) {
        setConfirmDialog({
          title: `Mark ${nextStatus}`,
          message: `${booking.guest_name} (${partyLabel}) at ${booking.booking_time.slice(0, 5)} will be marked ${nextStatus}.`,
          confirmLabel: `Mark ${nextStatus}`,
          onConfirm: () => { void changeStatus(booking.id, nextStatus); },
        });
        return;
      }
      void changeStatus(booking.id, nextStatus);
    },
    [activeTables.length, addToast, changeStatus, data, date],
  );

  const undoStatusChange = useCallback(async () => {
    if (!undoAction || undoAction.type !== 'change_status') return;
    const bookingId = String(undoAction.previous_state.bookingId ?? '');
    const previousStatus = String(undoAction.previous_state.status ?? '') as BookingStatus;
    if (!bookingId || !previousStatus) return;
    setUndoAction(null);
    await changeStatus(bookingId, previousStatus);
  }, [undoAction, changeStatus]);

  // Remaining capacity for walk-in - use time-aware API data
  const walkInCapacity = useMemo(() => {
    if (!data || !data.capacity_configured) return null;
    return data.summary.covers_available_now;
  }, [data]);

  // Filter bookings
  const filteredPeriods = useMemo(() => {
    if (!data) return [];
    return data.periods
      .filter((p) => filters.periodKey === 'all' || p.key === filters.periodKey)
      .map((p) => ({
        ...p,
        bookings: p.bookings.filter((b) => {
          if (b.status === 'Cancelled' && !filters.showCancelled && !filters.statuses.has('Cancelled')) return false;
          if (b.status === 'No-Show' && !filters.showNoShow && !filters.statuses.has('No-Show')) return false;
          if (!filters.statuses.has(b.status) && b.status !== 'Cancelled' && b.status !== 'No-Show') return false;
          if (filters.search) {
            const q = filters.search.toLowerCase();
            const nameMatch = b.guest_name.toLowerCase().includes(q);
            const sizeMatch = String(b.party_size) === q;
            if (!nameMatch && !sizeMatch) return false;
          }
          if (timeRangeFilterActive && !isBookingTimeInHourRange(b.booking_time, pickerStartHour, pickerEndHour)) {
            return false;
          }
          return true;
        }),
      }));
  }, [data, filters, timeRangeFilterActive, pickerStartHour, pickerEndHour]);

  // Loading skeleton
  if (loading && !data) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading day sheet">
        <Skeleton.Block className="h-16" />
        <Skeleton.Block className="h-14" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton.Card key={i} className="min-h-24 py-4">
              <Skeleton.Line className="w-1/2" />
              <Skeleton.Line className="mt-3 w-full" />
            </Skeleton.Card>
          ))}
        </div>
        <Skeleton.Block className="h-14" />
        {[...Array(2)].map((_, i) => (
          <Skeleton.Card key={i} className="py-4">
            <Skeleton.Line className="w-1/3" />
            <Skeleton.Line className="mt-2 w-full" />
          </Skeleton.Card>
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <EmptyState
        title="Unable to load day sheet"
        action={
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void fetchDaySheet();
            }}
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            Retry
          </button>
        }
      />
    );
  }

  const selectedAreaId =
    searchParams.get('area') && data.areas?.some((x) => x.id === searchParams.get('area'))
      ? searchParams.get('area')!
      : '';
  const settingsActive =
    Boolean(selectedAreaId) ||
    filters.periodKey !== 'all' ||
    filters.statuses.has('Completed') ||
    filters.showCancelled ||
    filters.showNoShow ||
    timeRangeFilterActive;
  const activeFilterCount =
    (selectedAreaId ? 1 : 0) +
    (filters.periodKey !== 'all' ? 1 : 0) +
    (filters.statuses.has('Completed') ? 1 : 0) +
    (filters.showCancelled ? 1 : 0) +
    (filters.showNoShow ? 1 : 0) +
    (timeRangeFilterActive ? 1 : 0);
  const daySheetToolbarSummary: ViewToolbarSummary = {
    total_covers_booked: data.summary.is_today ? data.summary.covers_in_use : data.summary.total_covers,
    total_covers_capacity: data.summary.venue_max_capacity ?? data.summary.total_covers,
    tables_in_use: activeTables.filter((table) => occupancyMap[table.id] !== null).length,
    tables_total: activeTables.length,
    unassigned_count: data.summary.pending_count,
    covers_in_use_now: data.summary.is_today ? data.summary.covers_in_use : undefined,
  };
  const daySheetDatePanel = (
    <div className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm sm:p-3">
      <CalendarDateTimePicker
        date={date}
        onDateChange={setDate}
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
  );
  const daySheetSettingsPanel = (
    <div className="space-y-4">
      {bookingModel === 'table_reservation' && data.areas && data.areas.length > 1 && (
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Area</span>
          <select
            value={selectedAreaId}
            onChange={(e) => setAreaFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          >
            <option value="">All areas</option>
            {data.areas.map((ar) => (
              <option key={ar.id} value={ar.id}>
                {ar.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Service period</span>
        <select
          value={filters.periodKey}
          onChange={(e) => setFilters((f) => ({ ...f, periodKey: e.target.value }))}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        >
          <option value="all">All periods</option>
          {data.periods.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Include statuses</p>
        <div className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-2">
          {[
            { key: 'Completed', label: 'Completed' },
            { key: 'Cancelled', label: 'Cancelled' },
            { key: 'No-Show', label: 'No-show' },
          ].map((option) => (
            <label key={option.key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={option.key === 'Completed' ? filters.statuses.has('Completed') : option.key === 'Cancelled' ? filters.showCancelled : filters.showNoShow}
                onChange={(e) => {
                  if (option.key === 'Completed') {
                    setFilters((f) => {
                      const s = new Set(f.statuses);
                      if (e.target.checked) s.add('Completed');
                      else s.delete('Completed');
                      return { ...f, statuses: s };
                    });
                    return;
                  }
                  if (option.key === 'Cancelled') {
                    setFilters((f) => ({ ...f, showCancelled: e.target.checked }));
                    return;
                  }
                  setFilters((f) => ({ ...f, showNoShow: e.target.checked }));
                }}
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>
      {settingsActive ? (
        <button
          type="button"
          onClick={() => {
            setAreaFilter('');
            setStartHourOverride(null);
            setEndHourOverride(null);
            setTimeRangeFilterActive(false);
            setFilters({
              periodKey: 'all',
              statuses: new Set(DEFAULT_STATUSES),
              search: filters.search,
              showCancelled: false,
              showNoShow: false,
            });
          }}
          className="text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline"
        >
          Clear settings
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="daysheet-root space-y-4">
      <div className="print:hidden">
        <OperationsWorkspaceToolbar
          title="Day sheet"
          summary={daySheetToolbarSummary}
          summaryContent={<DaySheetToolbarSummary summary={data.summary} periods={data.periods} />}
          date={date}
          dateLabel={formatDateFull(date)}
          onDateChange={setDate}
          liveState={connection === 'green' ? 'live' : 'reconnecting'}
          onRefresh={() => {
            setLoading(true);
            void fetchDaySheet();
          }}
          onNewBooking={() => setShowNewBooking(true)}
          onWalkIn={() => setShowWalkIn(true)}
          compact
          controlsLabel={activeFilterCount > 0 ? `Settings (${activeFilterCount})` : 'Settings'}
          controlsPanel={daySheetSettingsPanel}
          datePickerPanel={daySheetDatePanel}
          searchActive={filters.search.trim().length > 0}
          searchAriaLabel="Search contacts"
          searchPanel={(
            <OperationsToolbarGuestSearchPanel
              onQueryChange={(q) => setFilters((f) => ({ ...f, search: q }))}
              initialDate={date}
              onBookingCreated={() => {
                setLoading(true);
                void fetchDaySheet();
              }}
            />
          )}
          trailingActions={
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-800"
              aria-label="Print day sheet"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 9V3.75h10.5V9m-10.5 8.25h10.5v3H6.75v-3ZM6 17.25H4.5A1.5 1.5 0 0 1 3 15.75v-5.25A1.5 1.5 0 0 1 4.5 9h15a1.5 1.5 0 0 1 1.5 1.5v5.25a1.5 1.5 0 0 1-1.5 1.5H18" />
              </svg>
            </button>
          }
        />
      </div>

      {/* Connection warning */}
      {connection !== 'green' && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700 print:hidden">
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
          {connection === 'amber' ? 'Live updates paused - polling every 30 seconds' : 'Offline - showing last loaded data'}
        </div>
      )}

      {/* Capacity not configured banner */}
      {!data.capacity_configured && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 print:hidden">
          Set your venue capacity in Settings {'\u2192'} Availability for accurate cover tracking.
        </div>
      )}

      {/* â”€â”€ Print header â”€â”€ */}
      <div className="hidden print:block print:mb-4">
        <div className="flex items-baseline justify-between">
          <h1 className="text-lg font-bold text-slate-900">{data.venue_name || 'Venue'}</h1>
          <span className="text-sm text-slate-500">Day Sheet</span>
        </div>
        <p className="text-sm font-medium text-slate-700">{formatDateFull(date)}</p>
      </div>

      {/* â”€â”€ Dietary Summary â”€â”€ */}
      {data.dietary_summary.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5 print:border-slate-300 print:shadow-none">
          <button
            type="button"
            onClick={() => setDietaryOpen((o) => !o)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-slate-700 print:hidden"
          >
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>
              Dietary &amp; Allergy Notes ({data.dietary_summary.reduce((s, d) => s + d.count, 0)})
            </span>
            <svg className={`h-4 w-4 text-slate-400 transition-transform ${dietaryOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
          </button>
          {(dietaryOpen || false) && (
            <div className="border-t border-slate-100 px-4 py-3">
              <div className="flex flex-wrap gap-2">
                {data.dietary_summary.map(({ label, count, isAllergy }) => (
                  <span key={label} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${
                    isAllergy ? 'bg-red-50 text-red-800 ring-1 ring-red-200' : 'bg-amber-50 text-amber-800'
                  }`}>
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${isAllergy ? 'bg-red-200 text-red-900' : 'bg-amber-200 text-amber-900'}`}>{count}</span>
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}
          {/* Print version always shown */}
          <div className="hidden print:block px-4 py-3 border-t border-slate-200">
            <div className="flex flex-wrap gap-2">
              {data.dietary_summary.map(({ label, count, isAllergy }) => (
                <span key={label} className={`text-sm ${isAllergy ? 'font-bold' : ''}`}>{label}: {count}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* â”€â”€ Service Period Groups â”€â”€ */}
      {filteredPeriods.length === 0 && data.periods.length === 0 ? (
        <EmptyState
          title={`No bookings for ${formatDateFull(date)}`}
          description="Add a booking or choose another date."
          action={
            <button
              type="button"
              onClick={() => setShowNewBooking(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
            >
              New booking
            </button>
          }
        />
      ) : (
        <div className="space-y-4">
          {filteredPeriods.map((period) => (
            <div
              key={period.key}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5 print:break-inside-avoid print:shadow-none"
            >
              {/* Period header */}
              <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3 print:bg-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-slate-800">{period.label}</span>
                    <span className="text-xs text-slate-500">{period.start_time} {'\u2013'} {period.end_time}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {period.max_covers != null ? (
                      <>
                        <span className="text-xs font-medium tabular-nums text-slate-600">
                          {period.booked_covers} / {period.max_covers} covers
                        </span>
                        <FillBar booked={period.booked_covers} capacity={period.max_covers} />
                      </>
                    ) : (
                      <span className="text-xs text-slate-500">
                        {period.booked_covers} covers · {period.bookings.filter((b) => !isTerminal(b.status)).length} bookings
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Booking list */}
              {period.bookings.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-400">
                  No {period.label.toLowerCase()} bookings yet.
                </div>
              ) : (
                <ul className="flex flex-col gap-2.5 bg-slate-50/60 p-2 sm:gap-3 sm:p-3">
                  {period.bookings.map((b) => {
                    const hasAllergy = parseDietaryNotes(b.dietary_notes, b.occasion, b.special_requests).some((t) => t.isAllergy) || hasAllergyKeywords([b.dietary_notes, b.special_requests].filter(Boolean).join(' '));
                    const isExpanded = expandedId === b.id;
                    const isTerminalStatus = isTerminal(b.status);
                    const primaryAction = BOOKING_PRIMARY_ACTIONS[b.status as BookingStatus];
                    const isReturning = b.visit_count > 0;
                    const bookingRow: DaySheetBookingRow = { ...b, booking_date: date };
                    const inferredModel = inferBookingRowModel(bookingRow);
                    const isTableBooking = inferredModel === 'table_reservation';
                    const displayStatus = bookingStatusDisplayLabel(b.status, isTableBooking);
                    const primaryLabel =
                      primaryAction?.target === 'Seated' && !isTableBooking ? 'Start' : primaryAction?.label;
                    const showUndoStart = b.status === 'Seated' && !isTableBooking && !isTerminalStatus;
                    const tableLabel = isTableBooking && b.table_assignments && b.table_assignments.length > 0
                      ? b.table_assignments.length === 1
                        ? b.table_assignments[0]!.name
                        : b.table_assignments.map((t) => t.name).join(', ')
                      : null;

                    return (
                      <li
                        key={b.id}
                        id={`booking-row-${b.id}`}
                        className={`rounded-xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-900/[0.04] transition-[box-shadow,border-color,opacity] duration-150 overflow-hidden border-l-[3px] print:border print:shadow-none print:ring-0 ${hasAllergy ? 'border-l-red-500' : statusBorderClass(b.status)} ${isTerminalStatus ? 'opacity-[0.78] saturate-[0.92]' : ''}`}
                      >
                        {/* Collapsed row */}
                        <div
                          role="button"
                          tabIndex={0}
                          aria-expanded={isExpanded}
                          aria-controls={`booking-expand-${b.id}`}
                          onClick={() => toggleExpand(b.id)}
                          onPointerEnter={() => prefetchBookingDetail(b.id)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(b.id); } }}
                          className={`flex min-h-[2.75rem] w-full cursor-pointer items-center gap-1.5 py-2 pl-2 pr-2 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/35 focus-visible:ring-offset-2 sm:min-h-[3rem] sm:gap-2 sm:py-3 sm:pl-3 sm:pr-3 ${isExpanded ? 'bg-brand-50/40' : hasAllergy && !isTerminalStatus ? 'bg-red-50/25 hover:bg-red-50/35' : isTerminalStatus ? 'bg-slate-50/55 hover:bg-slate-50/70' : 'hover:bg-slate-50/60'}`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs sm:text-sm">
                              <span className={`min-w-0 max-w-[9.5rem] truncate font-semibold sm:max-w-[14rem] ${b.status === 'Cancelled' ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                                {b.guest_name}
                              </span>
                              <span className="shrink-0 font-semibold tabular-nums text-slate-700">{b.booking_time.slice(0, 5)}</span>
                              {isTableBooking ? (
                                <>
                                  <span className="shrink-0 text-slate-300">·</span>
                                  <span className="shrink-0 text-[11px] font-medium text-slate-600 sm:text-xs">
                                    {b.party_size} {b.party_size === 1 ? 'cover' : 'covers'}
                                  </span>
                                </>
                              ) : b.party_size > 1 ? (
                                <>
                                  <span className="shrink-0 text-slate-300">·</span>
                                  <span className="shrink-0 text-[11px] font-medium text-slate-600 sm:text-xs">
                                    {b.party_size} people
                                  </span>
                                </>
                              ) : null}
                              <span className="hidden shrink-0 text-slate-300 sm:inline">·</span>
                              <span className="hidden shrink-0 sm:inline-flex">{sourceBadge(b.source)}</span>
                              <BookingStatusPill statusKey={b.status}>{displayStatus}</BookingStatusPill>
                              {isTableBooking && b.area_name ? (
                                <span className="hidden sm:inline-flex">
                                  <Pill variant="neutral" size="sm">{b.area_name}</Pill>
                                </span>
                              ) : null}
                              {isReturning ? <Pill variant="warning" size="sm">{ordinal(b.visit_count + 1)} visit</Pill> : null}
                              {showDepositPendingPill(b) ? (
                                <Pill variant="warning" size="sm" dot>
                                  <span className="sm:hidden">Deposit</span>
                                  <span className="hidden sm:inline">Deposit pending</span>
                                </Pill>
                              ) : null}
                              {showAttendanceConfirmedSupplementPill(b) ? <BookingStatusPill statusKey="Confirmed" dot>Confirmed</BookingStatusPill> : null}
                              {!isTableBooking ? (
                                <Pill variant={bookingTypePillVariant(inferredModel)} size="sm">
                                  {bookingTypeFilterLabel(inferredModel)}
                                </Pill>
                              ) : null}
                              {b.dietary_notes || hasAllergy ? (
                                <span className="hidden sm:inline-flex">
                                  <Pill variant="warning" size="sm" dot>Dietary</Pill>
                                </span>
                              ) : null}
                              {tableLabel ? (
                                <span className="hidden max-w-[10rem] truncate rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 sm:inline-block">
                                  {tableLabel}
                                </span>
                              ) : null}
                              <span className="hidden sm:inline-flex">
                                {depositBadge(b.deposit_status, b.deposit_amount_pence)}
                              </span>
                            </div>
                          </div>

                          {/* Primary action */}
                          {primaryAction && !isTerminalStatus && (
                            <button
                              type="button"
                              disabled={actionLoading === b.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                requestStatusChange(b, primaryAction.target);
                              }}
                              className={`inline-flex min-h-8 min-w-[3.75rem] touch-manipulation items-center justify-center rounded-lg px-2 py-1 text-[11px] font-semibold shadow-sm transition-colors duration-150 focus:outline-none focus:ring-2 disabled:opacity-60 sm:min-w-[4.5rem] sm:px-2.5 sm:text-xs print:hidden ${primaryLabel === 'Start' ? BOOKING_START_PRIMARY_BUTTON_CLASSES : 'border border-transparent bg-brand-600 text-white hover:bg-brand-700 focus:ring-brand-500/40 active:bg-brand-800'}`}
                              aria-label={`${primaryLabel ?? primaryAction.label} booking for ${b.guest_name}`}
                              aria-busy={actionLoading === b.id}
                            >
                              {actionLoading === b.id ? '...' : (primaryLabel ?? primaryAction.label)}
                            </button>
                          )}
                          {showUndoStart && (
                            <button
                              type="button"
                              disabled={actionLoading === b.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                requestStatusChange(b, 'Booked');
                              }}
                              className="inline-flex min-h-8 touch-manipulation items-center justify-center rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900 shadow-sm transition-colors duration-150 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-400/30 active:bg-amber-100/80 disabled:opacity-60 sm:px-2.5 sm:text-xs print:hidden"
                              aria-label={`Undo start for ${b.guest_name}`}
                              aria-busy={actionLoading === b.id}
                            >
                              <span className="sm:hidden">Undo</span>
                              <span className="hidden sm:inline">Undo Start</span>
                            </button>
                          )}
                          {isTableBooking && !tableManagementEnabled && b.status === 'Seated' && activeTables.length > 0 && (
                            <button
                              type="button"
                              disabled={actionLoading === b.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setChangeTableBookingId(b.id);
                                setChangeTableSelectedIds((b.table_assignments ?? []).map((t) => t.id));
                              }}
                              className="inline-flex min-h-8 touch-manipulation items-center justify-center rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm transition-colors duration-150 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400/30 active:bg-slate-100 disabled:opacity-60 sm:px-2.5 sm:text-xs print:hidden"
                              aria-label={`Change table for ${b.guest_name}`}
                            >
                              <span className="sm:hidden">Table</span>
                              <span className="hidden sm:inline">Change table</span>
                            </button>
                          )}
                          {canShowDaySheetStaffAttendanceToggle(b) && (
                            <button
                              type="button"
                              disabled={staffAttendanceLoadingId === b.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                void patchStaffAttendance(b.id, isAttendanceConfirmed(b));
                              }}
                              className={`${isAttendanceConfirmed(b) ? BOOKING_ATTENDANCE_UNDO_OUTLINE_BUTTON : BOOKING_ATTENDANCE_CONFIRM_SOLID_BUTTON} inline-flex min-h-8 items-center justify-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold shadow-sm transition-colors duration-150 focus:outline-none focus:ring-2 disabled:opacity-60 sm:min-w-[8.75rem] sm:px-2.5 sm:text-xs print:hidden`}
                              aria-label={`${isAttendanceConfirmed(b) ? 'Undo confirm' : 'Confirm attendance'} for ${b.guest_name}`}
                              aria-busy={staffAttendanceLoadingId === b.id}
                            >
                              {staffAttendanceLoadingId === b.id ? (
                                <span
                                  className={`h-3 w-3 shrink-0 animate-spin rounded-full border-2 ${isAttendanceConfirmed(b) ? BOOKING_ATTENDANCE_UNDO_SPINNER : BOOKING_ATTENDANCE_CONFIRM_SPINNER}`}
                                  aria-hidden
                                />
                              ) : null}
                              {isAttendanceConfirmed(b) ? (
                                <>
                                  <span className="sm:hidden">Undo</span>
                                  <span className="hidden sm:inline">Undo confirm</span>
                                </>
                              ) : (
                                <>
                                  Confirm
                                </>
                              )}
                            </button>
                          )}

                          {/* Expand indicator */}
                          <svg className={`h-4 w-4 shrink-0 text-slate-400 transition-transform print:hidden ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                          </svg>
                        </div>

                        {isExpanded && (
                          <div
                            className={expandedBookingRowShellClass}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <ExpandedBookingContent
                              booking={bookingRow}
                              detail={detailById[b.id]}
                              detailLoading={detailLoadingIds.includes(b.id)}
                              tableManagementEnabled={tableManagementEnabled}
                              venueId={venueId}
                              venueCurrency={currency ?? 'GBP'}
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
                              draftMessage={messageDraftById[b.id] ?? ''}
                              sendingMessage={sendingMessageIds.includes(b.id)}
                              onMessageDraftChange={(value) => setMessageDraftById((prev) => ({ ...prev, [b.id]: value }))}
                              onSendMessage={(channel) => sendMessageToBooking(b.id, messageDraftById[b.id] ?? '', channel)}
                              onStatusAction={(status) => { requestStatusChange(b, status); }}
                              onDetailUpdated={() => handleDetailUpdated(b.id)}
                              onRequestChangeTable={isTableBooking && !tableManagementEnabled && b.status === 'Seated' && activeTables.length > 0 ? () => {
                                setChangeTableBookingId(b.id);
                                setChangeTableSelectedIds((b.table_assignments ?? []).map((t) => t.id));
                              } : undefined}
                              venueStaffBookingModel={bookingModel}
                              venueStaffEnabledBookingModels={enabledModels}
                            />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
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
            if (expandedId) {
              setGuestHistoryRevisionById((prev) => ({
                ...prev,
                [expandedId]: (prev[expandedId] ?? 0) + 1,
              }));
            }
            void fetchDaySheet();
          }}
        />
      ) : null}

      {/* â”€â”€ Modals â”€â”€ */}
      {showWalkIn && (
        <DashboardStaffBookingModal
          open
          title="Walk-in"
          bookingIntent="walk-in"
          onClose={() => setShowWalkIn(false)}
          onCreated={() => {
            setShowWalkIn(false);
            addToast('Walk-in added', 'success');
            void fetchDaySheet();
          }}
          venueId={venueId}
          currency={currency ?? 'GBP'}
          bookingModel={bookingModel}
          enabledModels={enabledModels}
          advancedMode={tableManagementEnabled}
          initialDate={date}
          walkInRemainingCapacity={walkInCapacity}
        />
      )}
      {showNewBooking && (
        <DashboardStaffBookingModal
          open
          title="New booking"
          onClose={() => setShowNewBooking(false)}
          onCreated={() => {
            setShowNewBooking(false);
            void fetchDaySheet();
          }}
          venueId={venueId}
          currency={currency ?? 'GBP'}
          bookingModel={bookingModel}
          enabledModels={enabledModels}
          advancedMode={tableManagementEnabled}
          initialDate={date}
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
      />
      {undoAction && (
        <UndoToast
          action={undoAction}
          onUndo={() => { void undoStatusChange(); }}
          onDismiss={() => setUndoAction(null)}
        />
      )}

      {/* â”€â”€ Table Selector (Seat flow) â”€â”€ */}
      <Dialog
        open={seatWithTableBookingId != null}
        onOpenChange={(open) => {
          if (!open) setSeatWithTableBookingId(null);
        }}
        title="Assign a table"
        size="md"
        contentClassName="max-w-md"
      >
        <TableSelector
          tables={activeTables}
          occupancyMap={occupancyMap}
          partySize={data?.periods.flatMap((p) => p.bookings).find((b) => b.id === seatWithTableBookingId)?.party_size ?? 2}
          selectedIds={seatSelectedTableIds}
          onChange={setSeatSelectedTableIds}
          confirmLabel="Seat"
          skipLabel="Seat without table"
          onConfirm={async (ids) => {
            const bookingId = seatWithTableBookingId;
            if (!bookingId) return;
            setSeatWithTableBookingId(null);
            setActionLoading(bookingId);
            try {
              const res = await fetch(`/api/venue/bookings/${bookingId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'Seated', table_ids: ids }),
              });
              if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                addToast(j.error ?? 'Failed to seat guest', 'error');
              } else {
                addToast('Guest checked in', 'success');
              }
              void fetchDaySheet();
            } catch {
              addToast('Failed to seat guest', 'error');
            } finally {
              setActionLoading(null);
            }
          }}
          onSkip={() => {
            const bookingId = seatWithTableBookingId;
            if (!bookingId) return;
            setSeatWithTableBookingId(null);
            void changeStatus(bookingId, 'Seated');
          }}
        />
      </Dialog>

      {changeTableBookingId && data && (() => {
        const changeBooking = data.periods.flatMap((p) => p.bookings).find((x) => x.id === changeTableBookingId);
        if (!changeBooking) return null;
        return (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open) setChangeTableBookingId(null);
            }}
            title="Change table"
            size="md"
            contentClassName="max-w-md"
          >
            <p className="mb-3 text-sm text-slate-600">
              Select table(s) for {changeBooking.guest_name}. Current booking tables are shown as free so you can move them.
            </p>
            <TableSelector
              tables={activeTables}
              occupancyMap={changeTableOccupancyMap}
              partySize={changeBooking.party_size}
              selectedIds={changeTableSelectedIds}
              onChange={setChangeTableSelectedIds}
              confirmLabel="Save"
              skipLabel="Cancel"
              onConfirm={async (ids) => {
                const bookingId = changeTableBookingId;
                if (!bookingId) return;
                const oldIds = (changeBooking.table_assignments ?? []).map((t) => t.id);
                setChangeTableBookingId(null);
                setActionLoading(bookingId);
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
                    addToast((j as { error?: string }).error ?? 'Failed to update tables', 'error');
                  } else {
                    addToast('Table assignment updated', 'success');
                  }
                  void fetchDaySheet();
                } catch {
                  addToast('Failed to update tables', 'error');
                } finally {
                  setActionLoading(null);
                }
              }}
              onSkip={() => setChangeTableBookingId(null)}
            />
          </Dialog>
        );
      })()}

      {linkFeature ? (
        <section className="mt-8 print:hidden">
          <LinkedCalendarView
            hideWhenEmpty
            title="Linked calendars"
            date={date}
            hideDatePicker
          />
          <p className="mt-2 text-xs text-slate-500">
            For column view and week/month overviews, use{' '}
            <a href="/dashboard/calendar" className="font-medium text-brand-600 hover:underline">
              Calendar
            </a>
            .
          </p>
        </section>
      ) : null}

      {/* â”€â”€ Print Footer (print only) â”€â”€ */}
      <div className="hidden print:block print:fixed print:bottom-0 print:left-0 print:right-0 print:border-t print:border-slate-200 print:py-2 print:px-6 print:text-xs print:text-slate-400 print:text-center">
        Printed {new Date().toLocaleString()} - ReserveNI
      </div>

      {/* â”€â”€ Print styles â”€â”€ */}
      <style>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          nav, .print\\:hidden, [data-sidebar], header {
            display: none !important;
          }
          .daysheet-root { padding: 0 !important; max-width: 100% !important; }
          .daysheet-root > * { break-inside: avoid; }
          .daysheet-root h1 { font-size: 16pt; letter-spacing: -0.02em; }
          .daysheet-root { color: #0f172a; }
          @page { margin: 1.5cm; size: A4 portrait; }
          @page :first { margin-top: 1cm; }
        }
      `}</style>
    </div>
  );
}
