'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  memo,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragCancelEvent,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  pointerWithin,
  rectIntersection,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { createClient } from '@/lib/supabase/browser';
import { ResourceBookingFlow } from '@/components/booking/ResourceBookingFlow';
import { CalendarStaffBookingModal } from '@/app/dashboard/practitioner-calendar/CalendarStaffBookingModal';
import { CalendarColumnsChecklist } from '@/app/dashboard/practitioner-calendar/CalendarColumnsFilter';
import {
  EditLinkedBookingModal,
  CreateLinkedBookingModal,
  LinkedBookingDetailModal,
} from '@/components/linked-accounts/LinkedCalendarView';
import type { LinkedVenueCalendar, LinkedBooking } from '@/lib/linked-accounts/calendar';
import { linkedBookingCountByDate } from '@/lib/linked-accounts/month-linked-counts';
import {
  BookingDetailPanel,
  type BookingDetailPanelSnapshot,
} from '@/app/dashboard/bookings/BookingDetailPanel';
import { ClassInstanceDetailSheet } from '@/components/practitioner-calendar/ClassInstanceDetailSheet';
import { EventInstanceDetailSheet } from '@/components/practitioner-calendar/EventInstanceDetailSheet';
import { EXP_BOOKING_LIFECYCLE_PRIMARY_SURFACE } from '@/lib/booking/expanded-booking-toolbar-surfaces';
import { EXP_BOOKING_ST_FOCUS } from '@/app/dashboard/bookings/expanded-booking-toolbar-classes';
import { useToast } from '@/components/ui/Toast';
import { useDashboardDetailCache } from '@/components/providers/DashboardDetailCacheProvider';
import { bindDetailPrefetchHandlers } from '@/lib/dashboard/detail-prefetch-intent';
import { warmIdsWithConcurrency } from '@/lib/dashboard/venue-detail-swr';
import {
  bookingDetailPanelSnapshotFromListRow,
  estimatedEndIsoFromSchedule,
} from '@/lib/booking/booking-detail-from-row';
import { DashboardCalendarSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';
import { getCalendarGridBounds } from '@/lib/venue-calendar-bounds';
import type { BookingStatus } from '@/lib/table-management/booking-status';
import type { OpeningHours } from '@/types/availability';
import type { BookingModel } from '@/types/booking-models';
import { venueExposesBookingModel } from '@/lib/booking/enabled-models';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import { getStaffBookingSurfaceTabs } from '@/lib/booking/staff-booking-modal-options';
import {
  computeResourceAvailability,
  type ResourceBooking as EngineResourceBooking,
} from '@/lib/availability/resource-booking-engine';
import { sameDaySlotCutoffForBookingDate } from '@/lib/venue/venue-local-clock';
import type { ClassPaymentRequirement, VenueResource, WorkingHours } from '@/types/booking-models';
import type { ScheduleBlockDTO } from '@/types/schedule-blocks';
import {
  addCalendarDays,
  monthGridDateRange,
  groupScheduleBlocksByDate,
  buildMonthDayScheduleCounts,
} from '@/lib/calendar/schedule-blocks-grouping';
import { formatWorkingHoursLineForDate } from '@/lib/calendar/format-working-hours-for-date';
import { formatEventUptakeLine } from '@/lib/calendar/event-block-label';
import {
  isAttendanceConfirmed,
  showAttendanceConfirmedSupplementPill,
  showDepositPendingPill,
} from '@/lib/booking/booking-staff-indicators';
import { BOOKING_ATTENDANCE_CONFIRM_SOLID_BUTTON } from '@/lib/table-management/booking-status-visual';
import {
  bookingStatusDisplayLabel,
  inferBookingRowModel,
  isTableReservationBooking,
} from '@/lib/booking/infer-booking-row-model';
import { ScheduleFeedColumn } from './ScheduleFeedColumn';
import { WeekScheduleCdeStrip } from './WeekScheduleCdeStrip';
import { MonthScheduleGrid } from './MonthScheduleGrid';
import { PractitionerCalendarToolbar } from './PractitionerCalendarToolbar';
import { OperationsToolbarGuestSearchPanel } from '@/components/dashboard/OperationsToolbarGuestSearchPanel';
import { BookingCardInfo } from './BookingCardInfo';
import { formatPhoneForDisplay } from '@/lib/phone/e164';
import { EmptyState } from '@/components/ui/dashboard/EmptyState';
import { HorizontalScrollHint } from '@/components/ui/HorizontalScrollHint';
import type { VenuePublic } from '@/components/booking/types';
import { mapApiVenueToVenuePublic } from '@/lib/booking/map-api-venue-to-public';
import { formatIsoDateInTimeZone } from '@/lib/date/format-iso-date-in-timezone';
import { readSessionPreference, writeSessionPreference } from '@/lib/ui/session-preferences';
import {
  customerOccupyMinutes,
  effectiveProcessingBlocksForTemplate,
  parseProcessingTimeBlocksFromDb,
  practitionerBusyMinuteOffsets,
} from '@/lib/appointments/processing-time';
import type { ProcessingTimeBlock } from '@/types/booking-models';

/** Same semantics as `minutesBetweenStartAndEnd` in appointment-engine (HH:mm span, wraps past midnight). */
function minutesBetweenStartAndEnd(startHHmm: string, endHHmm: string): number {
  const toMin = (s: string) => {
    const [h, m] = s.slice(0, 5).split(':').map((x) => Number.parseInt(x, 10));
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };
  const start = toMin(startHHmm);
  let end = toMin(endHHmm);
  if (end <= start) end += 24 * 60;
  return end - start;
}

interface Practitioner {
  id: string;
  name: string;
  is_active: boolean;
  colour?: string;
  calendar_type?: string;
  /** Left-to-right column order on the staff calendar grid. */
  sort_order?: number;
  /** Per-day template from Calendar availability (Settings). */
  working_hours?: WorkingHours;
}

interface CalendarVariantRow {
  id: string;
  processing_time_blocks?: ProcessingTimeBlock[];
}

/**
 * A read-only practitioner column belonging to a *linked* venue (§8.2). Linked
 * columns are kept entirely separate from the native `Practitioner` pipeline —
 * no droppables, drag, resource logic or availability maths touch them — so the
 * core calendar is unaffected. The `key` is namespaced to avoid colliding with
 * a native column id.
 */
interface LinkedColumn {
  key: string;
  venueId: string;
  venueName: string;
  linkId: string;
  practitionerId: string;
  practitionerName: string;
  practitionerActive: boolean;
  visibility: LinkedVenueCalendar['visibility'];
  action: LinkedVenueCalendar['action'];
}

function linkedColumnKey(venueId: string, practitionerId: string): string {
  return `linked:${venueId}:${practitionerId}`;
}

interface AppointmentService {
  id: string;
  name: string;
  duration_minutes: number;
  buffer_minutes?: number;
  processing_time_minutes?: number;
  processing_time_blocks?: ProcessingTimeBlock[];
  variants?: CalendarVariantRow[];
  colour: string;
  price_pence?: number | null;
}

interface Booking {
  id: string;
  booking_date: string;
  booking_time: string;
  booking_end_time: string | null;
  party_size: number;
  status: string;
  practitioner_id: string | null;
  /** Unified scheduling: column is `unified_calendars.id`; `practitioner_id` may be null. */
  calendar_id: string | null;
  appointment_service_id: string | null;
  service_item_id: string | null;
  service_variant_id?: string | null;
  processing_time_blocks?: unknown | null;
  guest_id?: string;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  guest_visit_count: number | null;
  booking_item_name?: string | null;
  estimated_end_time: string | null;
  special_requests: string | null;
  internal_notes: string | null;
  client_arrived_at: string | null;
  guest_attendance_confirmed_at?: string | null;
  staff_attendance_confirmed_at?: string | null;
  deposit_amount_pence: number | null;
  deposit_status: string;
  group_booking_id?: string | null;
  experience_event_id?: string | null;
  class_instance_id?: string | null;
  resource_id?: string | null;
  event_session_id?: string | null;
  /** Needed to hide attendance actions for walk-ins (same as bookings dashboard). */
  source?: string | null;
}

interface CalendarBlock {
  id: string;
  /** Legacy Model B blocks; null when block is from `calendar_blocks` (unified calendar). */
  practitioner_id: string | null;
  /** Unified calendar column id; set for `calendar_blocks` rows. */
  calendar_id: string | null;
  block_date: string;
  start_time: string;
  end_time: string;
  reason: string | null;
  block_type?: string;
  class_instance_id?: string | null;
}

interface VenueResourceRow {
  id: string;
  name: string;
  resource_type: string | null;
  display_on_calendar_id: string | null;
  slot_interval_minutes: number;
  min_booking_minutes: number;
  max_booking_minutes: number;
  price_per_slot_pence: number | null;
  payment_requirement: string;
  deposit_amount_pence: number | null;
  is_active: boolean;
  availability_hours: WorkingHours;
  availability_exceptions?: VenueResource['availability_exceptions'];
}

function apiResourceRowToVenueResource(r: VenueResourceRow, venueIdForRow: string): VenueResource {
  return {
    id: r.id,
    venue_id: venueIdForRow,
    name: r.name,
    resource_type: r.resource_type,
    min_booking_minutes: r.min_booking_minutes,
    max_booking_minutes: r.max_booking_minutes,
    slot_interval_minutes: r.slot_interval_minutes,
    price_per_slot_pence: r.price_per_slot_pence,
    payment_requirement: (r.payment_requirement as ClassPaymentRequirement) ?? 'none',
    deposit_amount_pence: r.deposit_amount_pence,
    availability_hours: r.availability_hours ?? {},
    availability_exceptions: r.availability_exceptions,
    is_active: r.is_active,
    sort_order: 0,
    created_at: '',
  };
}

/** Staff column: appointment anchor, or resource booking mapped onto its host calendar column. */
function resolveBookingColumnId(b: Booking, resourceParentById: Map<string, string>): string | null {
  const rid = b.resource_id ?? null;
  if (rid && resourceParentById.has(rid)) return resourceParentById.get(rid)!;
  if (b.calendar_id && resourceParentById.has(b.calendar_id)) return resourceParentById.get(b.calendar_id)!;
  return b.practitioner_id ?? b.calendar_id ?? null;
}

/** Normalise HH:mm or HH:mm:ss for booking PATCH bodies. */
function bookingTimeToStore(raw: string): string {
  const t = typeof raw === 'string' ? raw.trim() : '';
  if (t.length === 5 && /^\d{2}:\d{2}$/.test(t)) return `${t}:00`;
  if (t.length >= 8) return t;
  return `${t.slice(0, 5)}:00`;
}

function columnIdForBlock(bl: CalendarBlock): string | null {
  return bl.calendar_id ?? bl.practitioner_id ?? null;
}

/** Manual blocks staff can drag, resize, and edit (not class-tied blocks). */
function isManualEditableBlock(bl: CalendarBlock): boolean {
  return bl.block_type !== 'class_session' && !bl.class_instance_id;
}

function blockDurationMinutes(bl: CalendarBlock): number {
  return minutesBetweenStartAndEnd(bl.start_time, bl.end_time);
}

/** Aligns with dashboard/bookings filters: Confirmed = `bookings.status = 'Confirmed'` (set via guest/staff attendance confirm); Started = status Seated. */
function bookingMatchesCalendarStatusFilter(b: Booking, filterKey: string): boolean {
  if (filterKey === 'all') return true;
  if (filterKey === 'Seated') return b.status === 'Seated';
  return b.status === filterKey;
}

/**
 * Cancelled bookings are excluded from the calendar grid (the API hides them
 * from `view=calendar` responses), so there is no `Cancelled` pill here. Users
 * who need to see cancellations can do so from `/dashboard/bookings`.
 */
const CALENDAR_STATUS_FILTERS = [
  { value: 'all', label: 'All statuses' },
  { value: 'Pending', label: 'Pending' },
  { value: 'Booked', label: 'Booked' },
  { value: 'Confirmed', label: 'Confirmed' },
  { value: 'Seated', label: 'Started' },
  { value: 'Completed', label: 'Completed' },
  { value: 'No-Show', label: 'No Show' },
] as const;

function serviceIdForBooking(b: Booking): string | null {
  return b.appointment_service_id ?? b.service_item_id ?? null;
}

type ViewMode = 'day' | 'week' | 'month';

const SLOT_HEIGHT = 48;
const SLOT_MINUTES = 15;
const CALENDAR_MOVE_INCREMENT_MINUTES = 1;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface PractitionerCalendarPreferences {
  viewMode?: ViewMode;
  date?: string;
  weekStart?: string;
  monthAnchor?: string;
  visibleCalendarIdsState?: string[] | null;
  /** Linked-venue columns the user has opted into (§8.2). Default: none. */
  visibleLinkedColumnIds?: string[];
  filterStatus?: string;
  startHourOverride?: number | null;
  endHourOverride?: number | null;
}

function practitionerCalendarPreferencesKey(venueId: string): string {
  return `reserve:dashboard:calendar:${venueId}:preferences`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableHour(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 24);
}

function isPractitionerCalendarPreferences(value: unknown): value is PractitionerCalendarPreferences {
  if (!isRecord(value)) return false;
  if (value.viewMode !== undefined && value.viewMode !== 'day' && value.viewMode !== 'week' && value.viewMode !== 'month') return false;
  if (value.date !== undefined && (typeof value.date !== 'string' || !ISO_DATE_RE.test(value.date))) return false;
  if (value.weekStart !== undefined && (typeof value.weekStart !== 'string' || !ISO_DATE_RE.test(value.weekStart))) return false;
  if (value.monthAnchor !== undefined && (typeof value.monthAnchor !== 'string' || !ISO_DATE_RE.test(value.monthAnchor))) return false;
  if (value.visibleCalendarIdsState !== undefined && value.visibleCalendarIdsState !== null) {
    if (!Array.isArray(value.visibleCalendarIdsState) || !value.visibleCalendarIdsState.every((id) => typeof id === 'string' && UUID_RE.test(id))) return false;
  }
  if (value.visibleLinkedColumnIds !== undefined) {
    if (
      !Array.isArray(value.visibleLinkedColumnIds) ||
      !value.visibleLinkedColumnIds.every((id) => typeof id === 'string' && id.startsWith('linked:'))
    )
      return false;
  }
  /**
   * Accept any string here; unknown values (e.g. legacy `Cancelled`) are dropped
   * at hydration time below rather than invalidating the whole prefs blob.
   */
  if (value.filterStatus !== undefined && typeof value.filterStatus !== 'string') return false;
  if (value.startHourOverride !== undefined && !isNullableHour(value.startHourOverride)) return false;
  if (value.endHourOverride !== undefined && !isNullableHour(value.endHourOverride)) return false;
  return true;
}

/**
 * Staff calendar booking blocks — product palette (`accent` = left stripe; fill/text/border match {@link bookingStatusVisualForKey}).
 * Pending orange · Booked cyan-sky · Confirmed indigo · Arrived amber · Started emerald · Completed slate · No-show red · Cancelled slate.
 */
interface BookingBlockPalette {
  bg: string;
  text: string;
  border: string;
  accent: string;
}

const BOOKING_PALETTE_PENDING: BookingBlockPalette = {
  bg: '#FFEDD5',
  text: '#9A3412',
  border: '#FDBA74',
  accent: '#EA580C',
};
const BOOKING_PALETTE_BOOKED: BookingBlockPalette = {
  bg: '#E0F2FE',
  text: '#0C4A6E',
  border: '#38BDF8',
  accent: '#0369A1',
};
const BOOKING_PALETTE_CONFIRMED: BookingBlockPalette = {
  bg: '#E0E7FF',
  text: '#312E81',
  border: '#818CF8',
  accent: '#4338CA',
};
const BOOKING_PALETTE_ARRIVED_WAITING: BookingBlockPalette = {
  bg: '#FEF3C7',
  text: '#78350F',
  border: '#FBBF24',
  accent: '#D97706',
};
const BOOKING_PALETTE_STARTED: BookingBlockPalette = {
  bg: '#D1FAE5',
  text: '#064E3B',
  border: '#34D399',
  accent: '#047857',
};
const BOOKING_PALETTE_COMPLETED: BookingBlockPalette = {
  bg: '#E5E7EB',
  text: '#374151',
  border: '#9CA3AF',
  accent: '#4B5563',
};
const BOOKING_PALETTE_NO_SHOW: BookingBlockPalette = {
  bg: '#FEE2E2',
  text: '#991B1B',
  border: '#F87171',
  accent: '#DC2626',
};
const BOOKING_PALETTE_CANCELLED: BookingBlockPalette = {
  bg: '#E5E7EB',
  text: '#4B5563',
  border: '#D1D5DB',
  accent: '#4B5563',
};

function bookingBlockCardStyle(p: BookingBlockPalette): CSSProperties {
  return {
    backgroundColor: p.bg,
    color: p.text,
    borderTopColor: p.border,
    borderRightColor: p.border,
    borderBottomColor: p.border,
    borderLeftWidth: 4,
    borderLeftColor: p.accent,
    boxShadow: '0 10px 26px rgba(15, 23, 42, 0.11), inset 0 1px 0 rgba(255, 255, 255, 0.42)',
  };
}

function isArrivedWaitingDisplay(b: Pick<Booking, 'client_arrived_at' | 'status'>): boolean {
  if (!b.client_arrived_at) return false;
  return b.status === 'Pending' || b.status === 'Booked' || b.status === 'Confirmed';
}

function bookingCalendarBlockStyle(b: Booking): BookingBlockPalette {
  const status = b.status;
  if (status === 'Cancelled') return BOOKING_PALETTE_CANCELLED;
  if (status === 'No-Show') return BOOKING_PALETTE_NO_SHOW;
  if (status === 'Completed') return BOOKING_PALETTE_COMPLETED;
  if (status === 'Seated') return BOOKING_PALETTE_STARTED;
  if (isArrivedWaitingDisplay(b)) return BOOKING_PALETTE_ARRIVED_WAITING;
  if (status === 'Confirmed') return BOOKING_PALETTE_CONFIRMED;
  if (status === 'Pending' || status === 'Booked') {
    if (isAttendanceConfirmed(b)) return BOOKING_PALETTE_CONFIRMED;
    if (status === 'Pending') return BOOKING_PALETTE_PENDING;
    return BOOKING_PALETTE_BOOKED;
  }
  return BOOKING_PALETTE_BOOKED;
}

function calendarStatusLabel(b: Booking): string {
  if (isArrivedWaitingDisplay(b)) return 'Arrived';
  return bookingStatusDisplayLabel(b.status, isTableReservationBooking(b));
}

function calendarBookingServiceLabel(
  b: Booking,
  svc: AppointmentService | null | undefined,
  resourceName: string | null,
): string | null {
  const label = b.booking_item_name?.trim() || svc?.name?.trim() || null;
  return [resourceName, label].filter(Boolean).join(' · ') || null;
}

function CalendarBookingStatusBadge({ b }: { b: Booking }) {
  const p = bookingCalendarBlockStyle(b);
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold leading-tight shadow-sm ring-1 ring-black/5 backdrop-blur-sm"
      style={{ color: p.text }}
      title={calendarStatusLabel(b)}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.accent }} aria-hidden />
      <span className="truncate">{calendarStatusLabel(b)}</span>
    </span>
  );
}

function timeToMinutes(t: string): number {
  const [hh, mm] = t.slice(0, 5).split(':').map(Number);
  return (hh ?? 0) * 60 + (mm ?? 0);
}

function minutesToTime(m: number): string {
  const hh = Math.floor(m / 60) % 24;
  const mm = m % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function timelineMinutesToTime(m: number): string {
  const wallMinutes = m % (24 * 60);
  const hh = Math.floor(wallMinutes / 60);
  const mm = wallMinutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function minutesAfterStart(start: string, end: string): number {
  const startM = timeToMinutes(start);
  let endM = timeToMinutes(end);
  if (endM <= startM) {
    endM += 24 * 60;
  }
  return endM - startM;
}

/**
 * Duration for grid layout and collisions: wall-clock ends first, then ISO `estimated_end_time`
 * (same UTC-based delta as walk-in creation), then service default.
 */
function minutesBetweenBookingStartAndEstimatedEnd(b: Booking): number | null {
  if (!b.estimated_end_time) return null;
  const est = String(b.estimated_end_time);
  if (est.includes('T')) {
    const [year, month, day] = b.booking_date.split('-').map(Number);
    const [hour, minute] = b.booking_time.slice(0, 5).split(':').map(Number);
    if (!year || !month || !day || hour == null || minute == null) return null;
    const startMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    const endMs = Date.parse(est);
    if (!Number.isFinite(endMs)) return null;
    const diff = Math.round((endMs - startMs) / 60_000);
    return diff > 0 ? diff : null;
  }
  const wall = Math.max(0, timeToMinutes(est) - timeToMinutes(b.booking_time));
  return wall > 0 ? wall : null;
}

function bookingDurationMinutes(b: Booking, serviceMap: Map<string, AppointmentService>): number {
  if (b.booking_end_time) {
    return Math.max(
      SLOT_MINUTES,
      minutesAfterStart(b.booking_time, b.booking_end_time),
    );
  }
  const fromEstimated = minutesBetweenBookingStartAndEstimatedEnd(b);
  if (fromEstimated != null) {
    return Math.max(SLOT_MINUTES, fromEstimated);
  }
  const sid = serviceIdForBooking(b);
  if (sid) {
    return serviceMap.get(sid)?.duration_minutes ?? 30;
  }
  return 30;
}

/** Wall span for painting the block (core + buffer when using catalogue defaults). */
function bookingCalendarDisplaySpanMinutes(
  b: Booking,
  serviceMap: Map<string, AppointmentService>,
): number {
  if (b.booking_end_time) {
    return Math.max(
      SLOT_MINUTES,
      minutesAfterStart(b.booking_time, b.booking_end_time),
    );
  }
  if (minutesBetweenBookingStartAndEstimatedEnd(b) != null) {
    return bookingDurationMinutes(b, serviceMap);
  }
  const sid = serviceIdForBooking(b);
  const core = sid ? serviceMap.get(sid)?.duration_minutes ?? 30 : 30;
  const buf = sid ? serviceMap.get(sid)?.buffer_minutes ?? 0 : 0;
  return Math.max(SLOT_MINUTES, customerOccupyMinutes(core, buf));
}

function bookingCoreDurationForProcessing(
  b: Booking,
  serviceMap: Map<string, AppointmentService>,
): number {
  return bookingDurationMinutes(b, serviceMap);
}

function bookingBufferMinutes(
  b: Booking,
  serviceMap: Map<string, AppointmentService>,
): number {
  const sid = serviceIdForBooking(b);
  return Math.max(0, sid ? serviceMap.get(sid)?.buffer_minutes ?? 0 : 0);
}

function bookingProcessingBlocksForLayout(
  b: Booking,
  serviceMap: Map<string, AppointmentService>,
): ProcessingTimeBlock[] {
  const fromBooking = parseProcessingTimeBlocksFromDb(b.processing_time_blocks);
  if (fromBooking.length > 0) return fromBooking;
  const sid = serviceIdForBooking(b);
  const svc = sid ? serviceMap.get(sid) : undefined;
  if (!svc) return [];
  const vid = b.service_variant_id;
  const variant =
    typeof vid === 'string' && vid.trim().length > 0 ? svc.variants?.find((v) => v.id === vid) : undefined;
  return effectiveProcessingBlocksForTemplate({
    parentBlocks: svc.processing_time_blocks ?? [],
    variantBlocks: variant?.processing_time_blocks,
  });
}

function bookingLegacyProcessingTail(
  b: Booking,
  serviceMap: Map<string, AppointmentService>,
): number {
  if (bookingProcessingBlocksForLayout(b, serviceMap).length > 0) return 0;
  const sid = serviceIdForBooking(b);
  return Math.max(0, sid ? serviceMap.get(sid)?.processing_time_minutes ?? 0 : 0);
}

function practitionerWallBusyIntervalsForBooking(
  b: Booking,
  serviceMap: Map<string, AppointmentService>,
): Array<{ start: number; end: number }> {
  const wall0 = timeToMinutes(b.booking_time.slice(0, 5));
  const coreDur = bookingCoreDurationForProcessing(b, serviceMap);
  const buf = bookingBufferMinutes(b, serviceMap);
  const blocks = bookingProcessingBlocksForLayout(b, serviceMap);
  const legacy = bookingLegacyProcessingTail(b, serviceMap);
  const offsets = practitionerBusyMinuteOffsets({
    durationMinutes: coreDur,
    bufferMinutes: buf,
    processingBlocks: blocks,
    legacyProcessingTailMinutes: legacy,
  });
  return offsets.map((o) => ({ start: wall0 + o.start, end: wall0 + o.end }));
}

function practitionerWallBusyIntervalsForCandidateAtSlot(
  b: Booking,
  slotStartWallMin: number,
  serviceMap: Map<string, AppointmentService>,
): Array<{ start: number; end: number }> {
  const coreDur = bookingCoreDurationForProcessing(b, serviceMap);
  const buf = bookingBufferMinutes(b, serviceMap);
  const blocks = bookingProcessingBlocksForLayout(b, serviceMap);
  const legacy = bookingLegacyProcessingTail(b, serviceMap);
  const offsets = practitionerBusyMinuteOffsets({
    durationMinutes: coreDur,
    bufferMinutes: buf,
    processingBlocks: blocks,
    legacyProcessingTailMinutes: legacy,
  });
  return offsets.map((o) => ({ start: slotStartWallMin + o.start, end: slotStartWallMin + o.end }));
}

function BookingProcessingStrip({
  b,
  serviceMap,
  wallPaintMinutes,
}: {
  b: Booking;
  serviceMap: Map<string, AppointmentService>;
  /** When embedded in a multi-service segment, pass that segment's vertical span in minutes. */
  wallPaintMinutes?: number;
}) {
  const display = wallPaintMinutes ?? bookingCalendarDisplaySpanMinutes(b, serviceMap);
  const core = bookingCoreDurationForProcessing(b, serviceMap);
  if (display <= 0 || core <= 0) return null;
  const blocks = bookingProcessingBlocksForLayout(b, serviceMap);
  if (blocks.length === 0) return null;
  const corePct = Math.min(100, (core / display) * 100);
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-0 rounded-t-2xl"
      style={{ height: `${corePct}%` }}
      aria-hidden
    >
      {blocks.map((blk) => (
        <div
          key={blk.id}
          className="absolute inset-x-0 bg-sky-400/25"
          style={{
            top: `${(blk.start_minute / core) * 100}%`,
            height: `${(blk.duration_minutes / core) * 100}%`,
            backgroundImage:
              'repeating-linear-gradient(-45deg, transparent, transparent 5px, rgba(15,23,42,0.08) 5px 10px)',
          }}
        />
      ))}
    </div>
  );
}

function calendarGridLineClass(minutes: number): string {
  if (minutes % 60 === 0) return 'border-t-slate-400';
  if (minutes % 30 === 0) return 'border-t-slate-300';
  return 'border-t-slate-100';
}

function calendarSlotBandClass(minutes: number): string {
  const slotIndex = Math.max(0, Math.floor(minutes / SLOT_MINUTES));
  return slotIndex % 2 === 1 ? 'bg-slate-50/55' : 'bg-white';
}

/** Human-readable length for a same-day block (start → end). */
function formatBlockDurationLabel(totalMins: number): string {
  if (totalMins < 60) return `${totalMins} min`;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

const WEEK_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function weekDatesFrom(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addCalendarDays(start, i));
}

function overlapsRange(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

type BookingCluster = { kind: 'single'; booking: Booking } | { kind: 'group'; items: Booking[] };

interface BookingClusterLayout {
  laneIndex: number;
  laneCount: number;
}

/** Merge consecutive multi-service rows (same group_booking_id) into one visual stack. */
function clusterMultiServiceBookings(bookings: Booking[]): BookingCluster[] {
  const sorted = [...bookings].sort((a, b) => timeToMinutes(a.booking_time) - timeToMinutes(b.booking_time));
  const byGroup = new Map<string, Booking[]>();
  for (const b of bookings) {
    if (b.group_booking_id) {
      const g = byGroup.get(b.group_booking_id) ?? [];
      g.push(b);
      byGroup.set(b.group_booking_id, g);
    }
  }
  for (const [, arr] of byGroup) {
    arr.sort((a, b) => timeToMinutes(a.booking_time) - timeToMinutes(b.booking_time));
  }
  const seen = new Set<string>();
  const out: BookingCluster[] = [];
  for (const b of sorted) {
    if (!b.group_booking_id) {
      out.push({ kind: 'single', booking: b });
      continue;
    }
    if (seen.has(b.group_booking_id)) continue;
    seen.add(b.group_booking_id);
    const items = byGroup.get(b.group_booking_id) ?? [b];
    if (items.length <= 1) {
      out.push({ kind: 'single', booking: items[0]! });
    } else {
      out.push({ kind: 'group', items });
    }
  }
  return out;
}

function clusterKey(cluster: BookingCluster): string {
  return cluster.kind === 'single' ? cluster.booking.id : cluster.items[0]!.id;
}

function clusterTimeRange(cluster: BookingCluster, getDuration: (booking: Booking) => number): { start: number; end: number } {
  if (cluster.kind === 'single') {
    const start = timeToMinutes(cluster.booking.booking_time);
    return { start, end: start + getDuration(cluster.booking) };
  }

  const start = timeToMinutes(cluster.items[0]!.booking_time);
  const last = cluster.items[cluster.items.length - 1]!;
  const end = timeToMinutes(last.booking_time) + getDuration(last);
  return { start, end };
}

function computeBookingClusterLayouts(
  clusters: BookingCluster[],
  getDuration: (booking: Booking) => number,
): Map<string, BookingClusterLayout> {
  const layouts = new Map<string, BookingClusterLayout>();
  const sorted = clusters
    .map((cluster) => ({ cluster, key: clusterKey(cluster), ...clusterTimeRange(cluster, getDuration) }))
    .sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return a.end - b.end;
    });

  let groupItems: typeof sorted = [];
  let groupEnd = -Infinity;

  const flushGroup = () => {
    if (groupItems.length === 0) return;
    const laneEnds: number[] = [];
    const groupLayouts: Array<{ key: string; layout: BookingClusterLayout }> = [];
    for (const item of groupItems) {
      let laneIndex = laneEnds.findIndex((laneEnd) => laneEnd <= item.start);
      if (laneIndex === -1) {
        laneEnds.push(item.end);
        laneIndex = laneEnds.length - 1;
      } else {
        laneEnds[laneIndex] = item.end;
      }
      groupLayouts.push({ key: item.key, layout: { laneIndex, laneCount: 1 } });
    }
    const laneCount = Math.max(1, laneEnds.length);
    for (const item of groupLayouts) {
      item.layout.laneCount = laneCount;
      layouts.set(item.key, item.layout);
    }
    groupItems = [];
    groupEnd = -Infinity;
  };

  for (const item of sorted) {
    if (groupItems.length > 0 && item.start >= groupEnd) {
      flushGroup();
    }
    groupItems.push(item);
    groupEnd = Math.max(groupEnd, item.end);
  }
  flushGroup();

  return layouts;
}

/** Deposit + attendance “Confirmed” pill — bottom-left; pill uses white + indigo ring to read on any block hue. */
function BookingBlockPills({ b }: { b: Booking }) {
  return (
    <>
      {showDepositPendingPill(b) && ['Pending', 'Booked', 'Confirmed'].includes(b.status) && (
        <span
          className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-orange-600 ring-2 ring-white/80"
          aria-hidden
          title="Deposit pending"
        />
      )}
      {showAttendanceConfirmedSupplementPill(b) && ['Pending', 'Booked', 'Seated'].includes(b.status) && (
        <span
          className="inline-block max-w-[min(100%,6.5rem)] rounded-lg bg-white/95 px-1.5 py-0.5 text-center text-[8px] font-semibold leading-snug text-[#134E4A] shadow-sm ring-1 ring-[#0D9488] [overflow-wrap:anywhere] sm:max-w-[7.5rem] sm:text-[9px]"
          title="Confirmed"
        >
          Confirmed
        </span>
      )}
    </>
  );
}

/** Bottom strip for duration resize (hit target height). */
const BOOKING_RESIZE_HANDLE_HEIGHT_PX = 18;
/** Space kept between interactive booking chrome and resize gestures (paint + cushion so actions never butt the slider). */
const BOOKING_RESERVE_ABOVE_RESIZE_PX = BOOKING_RESIZE_HANDLE_HEIGHT_PX + 1;

/** Deferred guest modification notify after calendar drag: Confirm or timer end. */
const BOOKING_MODIFY_NOTIFY_DEFER_MS = 60_000;

/** Left strip for drag-to-reschedule; ~25% narrower than former w-6 / w-3. */
const BOOKING_DRAG_HANDLE_WIDTH_DEFAULT_PX = 18;
const BOOKING_DRAG_HANDLE_WIDTH_OVERLAP_PX = 9;

/** Gap between stacked corner action buttons (gap-0.5 ≈ 2px). */
const BOOKING_RIGHT_GAP_PX = 2;

/** Counts must mirror `collectBookingRightColumnActionNodes` render order. */
function countBookingRightColumnActions(b: Booking): number {
  if (b.status === 'Cancelled' || b.status === 'No-Show') return 0;

  let n = 0;

  if (b.status === 'Completed') return n + 1;

  if (b.status === 'Pending' || b.status === 'Booked' || b.status === 'Confirmed') n++;
  if (b.status === 'Pending') n++;
  if (b.status === 'Booked' || b.status === 'Confirmed') {
    n++;
  }
  if (b.status === 'Seated') n += 2;

  return n;
}

/** When true, the right column shows Arrived or Clear before Confirm/Start (short bars may omit this row). */
function bookingHasArrivalToggleInRightColumn(b: Booking): boolean {
  return b.status === 'Pending' || b.status === 'Booked' || b.status === 'Confirmed';
}

/** Started (Seated) rows show Undo start then Complete — short bars may omit Undo start like arrival toggles. */
function bookingShowsSeatedUndoInRightColumn(b: Booking): boolean {
  return b.status === 'Seated';
}

/** Horizontal inset so booking info does not run under bottom-right action buttons. */
const BOOKING_ACTIONS_CORNER_RIGHT_PX = 68;

/** Action buttons should stay compact on tall booking bars rather than stretching to fill the card. */
const BOOKING_ACTION_BUTTON_MAX_HEIGHT_CLASS = 'max-h-9';
/** Minimum gap between the booking bar top edge and the action stack. */
const BOOKING_ACTION_TRAY_TOP_GAP_PX = 8;
/** Gap between the action stack and the resize strip (or card bottom when not resizable). */
const BOOKING_ACTION_TRAY_BOTTOM_OFFSET_PX = 1;
/** Internal tray padding above / below buttons. */
const BOOKING_CORNER_TRAY_PAD_TOP_PX = 4;
const BOOKING_CORNER_TRAY_PAD_BOTTOM_PX = 2;
const BOOKING_CORNER_TRAY_PAD_Y_PX =
  BOOKING_CORNER_TRAY_PAD_TOP_PX + BOOKING_CORNER_TRAY_PAD_BOTTOM_PX;
/** Preferred per-button height in the corner stack; only shrink below when the bar cannot fit. */
const BOOKING_CORNER_BUTTON_COMFORT_HEIGHT_PX = 28;
/** When every action would get less than this, omit secondary rows (Arrived / Undo start). */
const BOOKING_CORNER_ACTION_OMIT_RAW_PER_ROW_PX = 22;

const BOOKING_CARD_ROW_PAD_RESERVE_PX = 8;

function narrowBookingActionsWidthPx(shellRowWidthPx: number | null | undefined): number | null {
  if (shellRowWidthPx == null || shellRowWidthPx <= 0) return null;
  const actionBudget = Math.max(64, Math.min(88, shellRowWidthPx - BOOKING_CARD_ROW_PAD_RESERVE_PX));
  return Math.min(shellRowWidthPx, actionBudget);
}

interface BookingRightColumnLayoutResult {
  compact: boolean;
  fontSizePx: number;
  baseClass: string;
  buttonMinHeightPx: number;
  stackHeightPx: number;
}

const BOOKING_CORNER_BUTTON_BASE_CLASS =
  `inline-flex w-auto min-w-0 shrink-0 ${BOOKING_ACTION_BUTTON_MAX_HEIGHT_CLASS} items-center justify-center whitespace-nowrap px-2 py-1 text-center font-semibold leading-tight [overflow-wrap:anywhere]`;

function bookingCornerLayoutBudgetPx(blockHeightPx: number): number {
  return Math.max(
    0,
    blockHeightPx - BOOKING_ACTION_TRAY_TOP_GAP_PX - BOOKING_ACTION_TRAY_BOTTOM_OFFSET_PX,
  );
}

function cornerActionRawPerRowPx(layoutBudgetPx: number, actionCount: number): number {
  if (actionCount <= 0) return layoutBudgetPx;
  const gapTotal = Math.max(0, actionCount - 1) * BOOKING_RIGHT_GAP_PX;
  return (layoutBudgetPx - BOOKING_CORNER_TRAY_PAD_Y_PX - gapTotal) / actionCount;
}

/** Sizes bottom-right corner actions: comfort height by default, shrink only when the bar cannot fit. */
function bookingCornerActionLayout(
  blockHeightPx: number,
  actionCount: number,
): BookingRightColumnLayoutResult {
  if (actionCount <= 0) {
    return {
      compact: false,
      fontSizePx: 10,
      baseClass: BOOKING_CORNER_BUTTON_BASE_CLASS,
      buttonMinHeightPx: 0,
      stackHeightPx: 0,
    };
  }

  const gapTotal = Math.max(0, actionCount - 1) * BOOKING_RIGHT_GAP_PX;
  const rawPer = cornerActionRawPerRowPx(blockHeightPx, actionCount);
  const buttonMinHeightPx = Math.min(
    BOOKING_CORNER_BUTTON_COMFORT_HEIGHT_PX,
    Math.max(0, Math.floor(rawPer)),
  );
  const stackHeightPx =
    actionCount * buttonMinHeightPx + gapTotal + BOOKING_CORNER_TRAY_PAD_Y_PX;
  const compact = buttonMinHeightPx < BOOKING_CORNER_BUTTON_COMFORT_HEIGHT_PX;
  const fontSizePx = buttonMinHeightPx < 22 ? 9 : 10;

  return {
    compact,
    fontSizePx,
    baseClass: BOOKING_CORNER_BUTTON_BASE_CLASS,
    buttonMinHeightPx,
    stackHeightPx,
  };
}

/** Measures guest+actions row width so multi-column actions never steal space needed for the contact name. */
function BookingGuestActionsRowMeasured({
  className,
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children: (shellRowWidthPx: number | null) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.getBoundingClientRect().width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className={className} style={style}>
      {children(width)}
    </div>
  );
}

/** Attendance / status action buttons in display order; used for single column or explicit grid placement. */
function collectBookingRightColumnActionNodes({
  b,
  busy,
  onStatus,
  onArrived,
  baseClass,
  fontSizePx,
  buttonMinHeightPx = 0,
  narrow = false,
  omitArrivalActions = false,
  omitSeatedUndoActions = false,
}: {
  b: Booking;
  busy: boolean;
  onStatus: (id: string, next: BookingStatus) => void;
  onArrived: (id: string, arrived: boolean) => void;
  baseClass: string;
  fontSizePx: number;
  buttonMinHeightPx?: number;
  narrow?: boolean;
  /** Hide Arrived / Clear so Confirm or Start stays readable on very short booking bars. */
  omitArrivalActions?: boolean;
  /** Hide Undo start so Complete stays readable on very short booking bars (mirrors omission of arrival toggle). */
  omitSeatedUndoActions?: boolean;
}): ReactElement[] {
  if (b.status === 'Cancelled' || b.status === 'No-Show') return [];

  const arrived = Boolean(b.client_arrived_at);

  const buttonStyle =
    buttonMinHeightPx > 0
      ? ({
          minHeight: `${buttonMinHeightPx}px`,
          fontSize: `${fontSizePx}px`,
          lineHeight: 1.2,
        } as const)
      : ({ fontSize: `${fontSizePx}px`, lineHeight: 1.2 } as const);

  const out: ReactElement[] = [];

  if (b.status === 'Completed') {
    out.push(
      <button
        key="reopen"
        type="button"
        disabled={busy}
        style={buttonStyle}
        onClick={() => onStatus(b.id, 'Seated')}
        className={`${baseClass} rounded-lg bg-emerald-600 font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50`}
      >
        Reopen
      </button>,
    );
  }
  if (b.status !== 'Completed') {
    if (
      !omitArrivalActions &&
      (b.status === 'Pending' || b.status === 'Booked' || b.status === 'Confirmed')
    ) {
      if (!arrived) {
        out.push(
          <button
            key="arrived"
            type="button"
            disabled={busy}
            style={buttonStyle}
            onClick={() => onArrived(b.id, true)}
            className={`${baseClass} rounded-lg border-2 border-[#F59E0B] bg-[#F59E0B]/20 font-semibold text-amber-950 shadow-sm transition hover:bg-[#F59E0B]/30 disabled:opacity-50`}
          >
            Arrived
          </button>,
        );
      } else {
        out.push(
          <button
            key="arrived-clear"
            type="button"
            disabled={busy}
            style={buttonStyle}
            onClick={() => onArrived(b.id, false)}
            className={`${baseClass} rounded-lg border border-slate-200 bg-white font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:opacity-50`}
          >
            Clear
          </button>,
        );
      }
    }
    if (b.status === 'Pending') {
      out.push(
        <button
          key="confirm-book"
          type="button"
          disabled={busy}
          style={buttonStyle}
          onClick={() => onStatus(b.id, 'Booked')}
          className={`${baseClass} rounded-lg bg-brand-600 font-semibold text-white shadow-sm shadow-brand-900/20 transition hover:bg-brand-700 disabled:opacity-50`}
        >
          Confirm
        </button>,
      );
    }
    if (b.status === 'Booked' || b.status === 'Confirmed') {
      out.push(
        <button
          key="start"
          type="button"
          disabled={busy}
          style={buttonStyle}
          onClick={() => onStatus(b.id, 'Seated')}
          className={`${baseClass} rounded-lg bg-emerald-600 font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50`}
        >
          Start
        </button>,
      );
    }
    if (b.status === 'Seated') {
      if (!omitSeatedUndoActions) {
        out.push(
          <button
            key="undo-start"
            type="button"
            disabled={busy}
            style={buttonStyle}
            onClick={() => onStatus(b.id, 'Booked')}
            aria-label="Undo start"
            className={`${baseClass} rounded-lg font-semibold transition disabled:opacity-50 ${BOOKING_ATTENDANCE_CONFIRM_SOLID_BUTTON}`}
            title="If you started by mistake, go back to booked (and waiting if they were marked arrived)"
          >
            {narrow ? 'Undo' : 'Undo start'}
          </button>,
        );
      }
      out.push(
        <button
          key="complete"
          type="button"
          disabled={busy}
          style={buttonStyle}
          onClick={() => onStatus(b.id, 'Completed')}
            className={`${baseClass} rounded-lg font-semibold shadow-sm outline-none transition-colors duration-150 disabled:opacity-50 ${EXP_BOOKING_ST_FOCUS} ${EXP_BOOKING_LIFECYCLE_PRIMARY_SURFACE}`}
        >
          Complete
        </button>,
      );
    }
  }

  return out;
}

/** Padding for booking info so text stays clear of the bottom-right action stack. */
function computeBookingActionCornerInset(
  b: Booking,
  blockHeightPx: number,
): { right: number; bottom: number; hasActions: boolean } {
  const fullActionCount = countBookingRightColumnActions(b);
  if (fullActionCount <= 0) {
    return { right: 0, bottom: 0, hasActions: false };
  }

  const layoutBudgetPx = bookingCornerLayoutBudgetPx(blockHeightPx);
  const rawPerAll = cornerActionRawPerRowPx(layoutBudgetPx, fullActionCount);

  const omitArrivalActions =
    bookingHasArrivalToggleInRightColumn(b) &&
    fullActionCount > 1 &&
    rawPerAll < BOOKING_CORNER_ACTION_OMIT_RAW_PER_ROW_PX;

  const omitSeatedUndoActions =
    bookingShowsSeatedUndoInRightColumn(b) &&
    fullActionCount > 1 &&
    rawPerAll < BOOKING_CORNER_ACTION_OMIT_RAW_PER_ROW_PX;

  const effectiveActionCount =
    fullActionCount - (omitArrivalActions ? 1 : 0) - (omitSeatedUndoActions ? 1 : 0);
  const layout = bookingCornerActionLayout(layoutBudgetPx, effectiveActionCount);

  return {
    right: BOOKING_ACTIONS_CORNER_RIGHT_PX,
    bottom: layout.stackHeightPx + BOOKING_ACTION_TRAY_BOTTOM_OFFSET_PX,
    hasActions: true,
  };
}

/** Transparent hit target at the bottom-right; only as tall/wide as its buttons. */
function CalendarBookingActionsTray({
  children,
  bottomPx,
  rightPx,
  maxWidthPx,
  topGapPx = BOOKING_ACTION_TRAY_TOP_GAP_PX,
}: {
  children: ReactNode;
  bottomPx: number;
  rightPx: number;
  maxWidthPx?: number;
  topGapPx?: number;
}) {
  return (
    <div
      className="pointer-events-none absolute z-20 flex h-auto w-auto flex-col justify-end gap-0.5 px-0.5 pb-0.5 pt-1"
      style={{
        bottom: bottomPx,
        right: rightPx,
        maxHeight: `calc(100% - ${topGapPx + bottomPx}px)`,
        maxWidth: maxWidthPx != null ? maxWidthPx : 'min(100%, calc(100% - 0.35rem))',
      }}
    >
      {children}
    </div>
  );
}

/** Bottom-right action stack (does not stretch to full bar height). */
function CalendarBookingRightColumn({
  b,
  busy,
  blockHeightPx,
  onStatus,
  onArrived,
  narrow = false,
  shellRowWidthPx,
  floating = false,
  bottomReservePx = 0,
}: {
  b: Booking;
  busy: boolean;
  blockHeightPx: number;
  onStatus: (id: string, next: BookingStatus) => void;
  onArrived: (id: string, arrived: boolean) => void;
  narrow?: boolean;
  /** Width of guest+actions row; constrains action columns so the contact name is not cropped. */
  shellRowWidthPx?: number | null;
  /** Overlap lanes should not reserve a full-width row below the booking content. */
  floating?: boolean;
  /** Space reserved below floating actions, e.g. the duration resize handle. */
  bottomReservePx?: number;
}) {
  const fullActionCount = countBookingRightColumnActions(b);
  const layoutBudgetPx = bookingCornerLayoutBudgetPx(blockHeightPx);
  const rawPerAll = cornerActionRawPerRowPx(layoutBudgetPx, fullActionCount);

  const omitArrivalActions =
    bookingHasArrivalToggleInRightColumn(b) &&
    fullActionCount > 1 &&
    rawPerAll < BOOKING_CORNER_ACTION_OMIT_RAW_PER_ROW_PX;

  const omitSeatedUndoActions =
    bookingShowsSeatedUndoInRightColumn(b) &&
    fullActionCount > 1 &&
    rawPerAll < BOOKING_CORNER_ACTION_OMIT_RAW_PER_ROW_PX;

  const effectiveActionCount =
    fullActionCount - (omitArrivalActions ? 1 : 0) - (omitSeatedUndoActions ? 1 : 0);
  const layout = bookingCornerActionLayout(layoutBudgetPx, effectiveActionCount);

  const actionNodes = collectBookingRightColumnActionNodes({
    b,
    busy,
    onStatus,
    onArrived,
    baseClass: layout.baseClass,
    fontSizePx: layout.fontSizePx,
    buttonMinHeightPx: layout.buttonMinHeightPx,
    narrow,
    omitArrivalActions,
    omitSeatedUndoActions,
  });

  if (actionNodes.length === 0) {
    return null;
  }

  const trayMaxWidthPx =
    narrow && shellRowWidthPx != null
      ? Math.max(56, shellRowWidthPx - 8)
      : undefined;

  return (
    <CalendarBookingActionsTray
      bottomPx={bottomReservePx + BOOKING_ACTION_TRAY_BOTTOM_OFFSET_PX}
      rightPx={4}
      maxWidthPx={trayMaxWidthPx}
    >
      <div
        className="pointer-events-auto flex h-auto w-auto max-w-full flex-col items-stretch gap-0.5 [&_button]:!h-auto [&_button]:!flex-none [&_button]:!basis-auto [&_button]:!grow-0"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {actionNodes}
      </div>
    </CalendarBookingActionsTray>
  );
}

function slotOccupied(
  slotStart: number,
  bookings: Booking[],
  blocks: CalendarBlock[],
  pracId: string,
  dateStr: string,
  serviceMap: Map<string, AppointmentService>,
  classScheduleBlocks: ScheduleBlockDTO[] = [],
  eventColumnBlocks: ScheduleBlockDTO[] = [],
  resourceParentById: Map<string, string>,
  excludeBookingId?: string | null,
  excludeBlockId?: string | null,
  options?: { ignoreBookings?: boolean },
): boolean {
  if (!options?.ignoreBookings) {
    const slotEnd = slotStart + SLOT_MINUTES;
    for (const b of bookings) {
      if (excludeBookingId && b.id === excludeBookingId) continue;
      if (resolveBookingColumnId(b, resourceParentById) !== pracId || b.booking_date !== dateStr) continue;
      if (['Cancelled', 'No-Show'].includes(b.status)) continue; // Completed still occupies the slot for scheduling
      const busyIv = practitionerWallBusyIntervalsForBooking(b, serviceMap);
      if (busyIv.some((iv) => overlapsRange(slotStart, slotEnd, iv.start, iv.end))) return true;
    }
  }
  for (const bl of blocks) {
    if (excludeBlockId && bl.id === excludeBlockId) continue;
    if (columnIdForBlock(bl) !== pracId || bl.block_date !== dateStr) continue;
    const b0 = timeToMinutes(bl.start_time);
    const b1 = b0 + minutesBetweenStartAndEnd(bl.start_time, bl.end_time);
    if (overlapsRange(slotStart, slotStart + SLOT_MINUTES, b0, b1)) return true;
  }
  for (const cb of classScheduleBlocks) {
    if (cb.kind !== 'class_session') continue;
    const b0 = timeToMinutes(cb.start_time);
    const b1 = b0 + minutesBetweenStartAndEnd(cb.start_time, cb.end_time);
    if (overlapsRange(slotStart, slotStart + SLOT_MINUTES, b0, b1)) return true;
  }
  for (const eb of eventColumnBlocks) {
    if (eb.kind !== 'event_ticket') continue;
    const b0 = timeToMinutes(eb.start_time);
    const b1 = b0 + minutesBetweenStartAndEnd(eb.start_time, eb.end_time);
    if (overlapsRange(slotStart, slotStart + SLOT_MINUTES, b0, b1)) return true;
  }
  return false;
}

/** True if [startMin, endMin) overlaps another booking, block, class, or event on this column (half-open end). */
function appointmentWindowCollides(
  startMin: number,
  endMin: number,
  pracId: string,
  dateStr: string,
  excludeBookingId: string | undefined,
  bookings: Booking[],
  blocks: CalendarBlock[],
  serviceMap: Map<string, AppointmentService>,
  classScheduleBlocks: ScheduleBlockDTO[],
  eventColumnBlocks: ScheduleBlockDTO[],
  resourceParentById: Map<string, string>,
  options?: {
    ignoreBookings?: boolean;
    excludeBlockId?: string;
    candidatePractitionerBusy?: Array<{ start: number; end: number }> | null;
  },
): boolean {
  if (endMin <= startMin) return true;
  const candIntervals =
    options?.candidatePractitionerBusy && options.candidatePractitionerBusy.length > 0
      ? options.candidatePractitionerBusy
      : [{ start: startMin, end: endMin }];
  if (!options?.ignoreBookings) {
    for (const b of bookings) {
      if (excludeBookingId && b.id === excludeBookingId) continue;
      if (resolveBookingColumnId(b, resourceParentById) !== pracId || b.booking_date !== dateStr) continue;
      if (['Cancelled', 'No-Show'].includes(b.status)) continue;
      const otherBusy = practitionerWallBusyIntervalsForBooking(b, serviceMap);
      for (const c of candIntervals) {
        for (const o of otherBusy) {
          if (overlapsRange(c.start, c.end, o.start, o.end)) return true;
        }
      }
    }
  }
  for (const bl of blocks) {
    if (options?.excludeBlockId && bl.id === options.excludeBlockId) continue;
    if (columnIdForBlock(bl) !== pracId || bl.block_date !== dateStr) continue;
    const b0 = timeToMinutes(bl.start_time);
    const b1 = b0 + minutesBetweenStartAndEnd(bl.start_time, bl.end_time);
    for (const c of candIntervals) {
      if (overlapsRange(c.start, c.end, b0, b1)) return true;
    }
  }
  for (const cb of classScheduleBlocks) {
    if (cb.kind !== 'class_session') continue;
    const b0 = timeToMinutes(cb.start_time);
    const b1 = b0 + minutesBetweenStartAndEnd(cb.start_time, cb.end_time);
    for (const c of candIntervals) {
      if (overlapsRange(c.start, c.end, b0, b1)) return true;
    }
  }
  for (const eb of eventColumnBlocks) {
    if (eb.kind !== 'event_ticket') continue;
    const b0 = timeToMinutes(eb.start_time);
    const b1 = b0 + minutesBetweenStartAndEnd(eb.start_time, eb.end_time);
    for (const c of candIntervals) {
      if (overlapsRange(c.start, c.end, b0, b1)) return true;
    }
  }
  return false;
}

const DroppableSlotButton = memo(function DroppableSlotButton({
  id,
  pracId,
  dateStr,
  slotStartMins,
  top,
  disabled,
  onEmptyClick,
}: {
  id: string;
  pracId: string;
  dateStr: string;
  slotStartMins: number;
  top: number;
  disabled: boolean;
  onEmptyClick: (e: MouseEvent, p: string, d: string, t: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    disabled,
    data: { pracId, dateStr, slotStartMins },
  });
  const tlabel = minutesToTime(slotStartMins);
  const gridLineClass = calendarGridLineClass(slotStartMins);
  const slotBandClass = calendarSlotBandClass(slotStartMins);
  return (
    <button
      type="button"
      ref={setNodeRef}
      disabled={disabled}
      data-calendar-pan-slot="true"
      onClick={(e) => {
        if (!disabled) onEmptyClick(e, pracId, dateStr, tlabel);
      }}
      className={`absolute left-0 right-0 z-0 [touch-action:pan-x_pan-y] border-t ${gridLineClass} ${slotBandClass} transition-colors ${
        disabled ? 'pointer-events-none cursor-default' : 'cursor-pointer hover:bg-brand-500/5'
      } ${isOver ? 'bg-brand-500/15' : ''}`}
      style={{ top, height: SLOT_HEIGHT }}
      aria-label={`Empty slot ${tlabel}`}
    />
  );
});

type DraggableHandleProps = {
  listeners: ReturnType<typeof useDraggable>['listeners'] | undefined;
  attributes: ReturnType<typeof useDraggable>['attributes'] | undefined;
  setActivatorNodeRef: (element: HTMLElement | null) => void;
};

function snapCalendarMoveMinutes(minutes: number): number {
  return Math.round(minutes / CALENDAR_MOVE_INCREMENT_MINUTES) * CALENDAR_MOVE_INCREMENT_MINUTES;
}

/** Prefer the slot under the cursor; fall back to rectangle overlap for tall booking cards. */
const calendarGridCollisionDetection: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args);
  if (pointerHits.length > 0) {
    return pointerHits;
  }
  return rectIntersection(args);
};

function DragBookingPreview({
  booking,
  movePreview,
}: {
  booking: Booking;
  /** Target time / column while dragging; shown on the preview card (not a global banner). */
  movePreview?: { label: string; invalid: boolean } | null;
}) {
  const p = bookingCalendarBlockStyle(booking);
  return (
    <div
      className="flex max-w-[min(90vw,20rem)] flex-col overflow-hidden rounded-xl border-2 border-dashed border-brand-200/90 bg-white/95 shadow-2xl shadow-slate-900/15 ring-1 ring-brand-100/70"
      style={{ borderLeftWidth: 4, borderLeftStyle: 'solid', borderLeftColor: p.accent }}
    >
      {movePreview ? (
        <div
          className={`border-b border-black/10 px-2 py-1 text-center text-[10px] font-bold leading-snug ${
            movePreview.invalid ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'
          }`}
          aria-live="polite"
        >
          <span className="line-clamp-3">{movePreview.label}</span>
        </div>
      ) : null}
      <div className="px-2.5 py-1.5 text-xs font-semibold text-slate-800">{booking.guest_name}</div>
    </div>
  );
}

const DraggableBookingShell = memo(function DraggableBookingShell({
  booking,
  top,
  height,
  heightExtraPx = 0,
  laneIndex = 0,
  laneCount = 1,
  canDrag,
  children,
}: {
  booking: Booking;
  top: number;
  height: number;
  /** Live vertical stretch while resizing (pixels). */
  heightExtraPx?: number;
  laneIndex?: number;
  laneCount?: number;
  canDrag: boolean;
  children: (handle: DraggableHandleProps) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({
    id: `booking-${booking.id}`,
    disabled: !canDrag,
    data: { booking },
  });
  const totalHeight = Math.max(SLOT_HEIGHT, height + heightExtraPx);
  const widthPct = 100 / Math.max(1, laneCount);
  const style = {
    top,
    height: totalHeight,
    left: `calc(${laneIndex * widthPct}% + 0.25rem)`,
    width: `calc(${widthPct}% - 0.5rem)`,
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 50 : 20 + laneIndex,
    opacity: isDragging ? 0.85 : 1,
    pointerEvents: isDragging ? 'none' : undefined,
  } as CSSProperties;
  const handleProps: DraggableHandleProps = canDrag
    ? { listeners, attributes, setActivatorNodeRef }
    : { listeners: undefined, attributes: undefined, setActivatorNodeRef: () => {} };
  return (
    <div ref={setNodeRef} className="absolute" style={style}>
      {children(handleProps)}
    </div>
  );
});

function DragBlockPreview({
  block,
  movePreview,
}: {
  block: CalendarBlock;
  movePreview?: { label: string; invalid: boolean } | null;
}) {
  const label = block.reason?.trim() ? `Blocked: ${block.reason}` : 'Blocked';
  return (
    <div
      className="flex max-w-[min(90vw,16rem)] flex-col overflow-hidden rounded-lg border-2 border-dashed border-slate-400 bg-slate-200/95 shadow-2xl shadow-slate-900/15"
      style={{ borderLeftWidth: 4, borderLeftColor: '#94a3b8' }}
    >
      {movePreview ? (
        <div
          className={`border-b border-black/10 px-2 py-1 text-center text-[10px] font-bold leading-snug ${
            movePreview.invalid ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'
          }`}
          aria-live="polite"
        >
          <span className="line-clamp-3">{movePreview.label}</span>
        </div>
      ) : null}
      <div className="px-2.5 py-1.5 text-xs font-semibold text-slate-800">{label}</div>
    </div>
  );
}

const DraggableBlockShell = memo(function DraggableBlockShell({
  block,
  top,
  height,
  heightExtraPx = 0,
  canDrag,
  children,
}: {
  block: CalendarBlock;
  top: number;
  height: number;
  heightExtraPx?: number;
  canDrag: boolean;
  children: (handle: DraggableHandleProps) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({
    id: `block-${block.id}`,
    disabled: !canDrag,
    data: { block },
  });
  const totalHeight = Math.max(SLOT_HEIGHT * 0.5, height + heightExtraPx);
  const style = {
    top,
    height: totalHeight,
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 50 : 15,
    opacity: isDragging ? 0.85 : 1,
    pointerEvents: isDragging ? 'none' : undefined,
  } as CSSProperties;
  const handleProps: DraggableHandleProps = canDrag
    ? { listeners, attributes, setActivatorNodeRef }
    : { listeners: undefined, attributes: undefined, setActivatorNodeRef: () => {} };
  return (
    <div ref={setNodeRef} className="absolute left-1 right-1" style={style}>
      {children(handleProps)}
    </div>
  );
});

function linkedTimeToMinutes(time: string): number {
  const [hh, mm] = (time ?? '').split(':');
  return (parseInt(hh, 10) || 0) * 60 + (parseInt(mm, 10) || 0);
}

function linkedSlotTop(time: string, startHour: number): number {
  return ((linkedTimeToMinutes(time) - startHour * 60) / SLOT_MINUTES) * SLOT_HEIGHT;
}

function linkedBlockHeight(start: string, end: string | null): number {
  if (!end) return SLOT_HEIGHT;
  const d = linkedTimeToMinutes(end) - linkedTimeToMinutes(start);
  return Math.max((d / SLOT_MINUTES) * SLOT_HEIGHT, SLOT_HEIGHT * 0.6);
}

function linkedBookingIsClickable(column: LinkedColumn, b: LinkedBooking): boolean {
  return (
    column.visibility === 'full_details' &&
    b.editable &&
    b.status !== 'Cancelled'
  );
}

/**
 * One read-only day-grid column for a linked venue's practitioner (§8.2).
 * Deliberately self-contained: no droppables, no drag, no resource maths — the
 * native calendar pipeline never sees this. Bookings render desaturated; only
 * `full_details` + editable links are clickable.
 */
const LinkedDayColumn = memo(function LinkedDayColumn({
  column,
  bookings,
  startHour,
  totalSlots,
  onBookingClick,
  onCreateAt,
}: {
  column: LinkedColumn;
  bookings: LinkedBooking[];
  startHour: number;
  totalSlots: number;
  onBookingClick: (b: LinkedBooking) => void;
  /** When set, empty slots are clickable to create a booking (§4.3). */
  onCreateAt?: (time: string) => void;
}) {
  const timeOnly = column.visibility === 'time_only';
  return (
    <div className="min-w-[min(16rem,calc(100vw-5.5rem))] flex-1 border-r border-slate-300 last:border-r-0 sm:min-w-[240px]">
      <div className="relative bg-slate-50/50" style={{ height: totalSlots * SLOT_HEIGHT }}>
        {Array.from({ length: totalSlots }, (_, i) => (
          <div
            key={i}
            className="absolute left-0 w-full border-t border-slate-100"
            style={{ top: i * SLOT_HEIGHT }}
            aria-hidden
          />
        ))}
        {onCreateAt
          ? Array.from({ length: totalSlots }, (_, i) => {
              const slotTime = minutesToTime(startHour * 60 + i * SLOT_MINUTES);
              return (
                <button
                  key={`slot-${i}`}
                  type="button"
                  onClick={() => onCreateAt(slotTime)}
                  className="absolute left-0 w-full transition-colors hover:bg-brand-50/60"
                  style={{ top: i * SLOT_HEIGHT, height: SLOT_HEIGHT }}
                  title={`New booking at ${slotTime}`}
                  aria-label={`New booking in ${column.venueName} at ${slotTime}`}
                />
              );
            })
          : null}
        {bookings.map((b) => {
          const top = linkedSlotTop(b.bookingTime, startHour);
          const height = linkedBlockHeight(b.bookingTime, b.bookingEndTime);
          const clickable = linkedBookingIsClickable(column, b);
          const timeLabel = `${b.bookingTime.slice(0, 5)}${
            b.bookingEndTime ? `–${b.bookingEndTime.slice(0, 5)}` : ''
          }`;
          const detail = timeOnly
            ? `${column.venueName} — busy`
            : b.guestName ?? b.serviceName ?? 'Booking';
          const inner = (
            <div
              className="flex h-full min-h-0 w-full flex-col gap-0.5 overflow-hidden rounded-lg border border-slate-300 bg-white/70 px-1.5 py-1 text-left text-[10px] text-slate-500 saturate-50"
              style={{ borderLeftWidth: 3, borderLeftColor: '#94a3b8' }}
            >
              <span className="font-semibold tabular-nums text-slate-600">{timeLabel}</span>
              <span className="truncate">{detail}</span>
              {!timeOnly ? (
                <span className="mt-auto text-[9px] uppercase tracking-wide text-slate-400">
                  {b.status}
                </span>
              ) : null}
            </div>
          );
          return (
            <div
              key={b.id}
              className="absolute left-1 right-1 z-[15]"
              style={{ top, height }}
            >
              <button
                type="button"
                onClick={() => onBookingClick(b)}
                className="block h-full w-full text-left transition hover:saturate-100 hover:opacity-90"
                title={
                  clickable
                    ? `Edit in ${column.venueName}`
                    : `View detail · ${column.venueName}`
                }
              >
                {inner}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export function PractitionerCalendarView({
  venueId,
  currency = 'GBP',
  defaultPractitionerFilter = 'all',
  linkedPractitionerIds,
  bookingModel = 'unified_scheduling',
  enabledModels = [],
  calendarTodayIso,
  linkFeature = false,
}: {
  venueId: string;
  currency?: string;
  defaultPractitionerFilter?: 'all' | string;
  /** Bookable calendars this staff user manages (unified scheduling). */
  linkedPractitionerIds?: string[];
  /** True when the venue is eligible for Linked Accounts (§8.2 grid columns). */
  linkFeature?: boolean;
  /** Primary bookable model (for merged schedule feeds §4.2). */
  bookingModel?: BookingModel;
  /** Secondary models; used to show Events / Classes lanes on the day grid. */
  enabledModels?: BookingModel[];
  /**
   * yyyy-mm-dd for “today” in the venue timezone, computed on the server.
   * Keeps the toolbar date label and initial navigation state aligned across SSR and hydration.
   */
  calendarTodayIso?: string;
}) {
  const { addToast } = useToast();
  const { warmVenueBookingDetail } = useDashboardDetailCache();
  const prefetchBookingDetail = useCallback(
    (bookingId: string) => warmVenueBookingDetail(bookingId),
    [warmVenueBookingDetail],
  );
  const myCalendarIds = useMemo(
    () => linkedPractitionerIds ?? [],
    [linkedPractitionerIds],
  );
  const preferencesKey = practitionerCalendarPreferencesKey(venueId);

  /** Stable default calendar date: venue-local when provided; UTC calendar date avoids SSR/client TZ mismatch. */
  const initialIsoDate =
    calendarTodayIso ?? formatIsoDateInTimeZone(new Date(), 'UTC');

  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [date, setDate] = useState(initialIsoDate);
  const [weekStart, setWeekStart] = useState(initialIsoDate);
  const [monthAnchor, setMonthAnchor] = useState(initialIsoDate);

  const [openingHours, setOpeningHours] = useState<OpeningHours | null>(null);
  const [venueTimezone, setVenueTimezone] = useState<string>('Europe/London');
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [services, setServices] = useState<AppointmentService[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [venueResources, setVenueResources] = useState<VenueResourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailBookingId, setDetailBookingId] = useState<string | null>(null);
  const [detailBookingAnchor, setDetailBookingAnchor] = useState<{ x: number; y: number } | null>(null);
  const [classInstanceSheet, setClassInstanceSheet] = useState<{
    instanceId: string;
    block: ScheduleBlockDTO;
  } | null>(null);
  const [classInstanceAnchor, setClassInstanceAnchor] = useState<{ x: number; y: number } | null>(null);
  const [eventInstanceSheet, setEventInstanceSheet] = useState<{
    eventId: string;
    block: ScheduleBlockDTO;
  } | null>(null);
  const [visibleCalendarIdsState, setVisibleCalendarIdsState] = useState<string[] | null>(() =>
    defaultPractitionerFilter === 'all' ? null : [defaultPractitionerFilter],
  );
  /** Linked-venue calendars (§8.2). Adjacent to the native pipeline, never merged. */
  const [linkedVenues, setLinkedVenues] = useState<LinkedVenueCalendar[]>([]);
  /** Linked columns the user has opted into. Default: none (opt-in). */
  const [visibleLinkedColumnIds, setVisibleLinkedColumnIds] = useState<string[]>([]);
  const [linkedEditing, setLinkedEditing] = useState<
    { column: LinkedColumn; booking: LinkedBooking } | null
  >(null);
  const [linkedViewing, setLinkedViewing] = useState<
    { column: LinkedColumn; booking: LinkedBooking } | null
  >(null);
  const [linkedCreating, setLinkedCreating] = useState<
    { venue: LinkedVenueCalendar; practitionerId?: string; time?: string } | null
  >(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [guestToolbarSearchQuery, setGuestToolbarSearchQuery] = useState('');
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState<boolean | null>(null);
  const [staffBookingModal, setStaffBookingModal] = useState<null | 'new' | 'walk-in'>(null);
  const [showResourceBooking, setShowResourceBooking] = useState(false);
  const [resourceBookingResourceId, setResourceBookingResourceId] = useState<string | undefined>();
  const [resourceBookingVenue, setResourceBookingVenue] = useState<VenuePublic | null>(null);
  const [resourceBookingVenueError, setResourceBookingVenueError] = useState<string | null>(null);
  const [prefillPractitionerId, setPrefillPractitionerId] = useState<string | undefined>();
  const [prefillTime, setPrefillTime] = useState<string | undefined>();
  const [prefillDate, setPrefillDate] = useState<string | undefined>();
  const [slotMenu, setSlotMenu] = useState<{
    pracId: string;
    dateStr: string;
    time: string;
    x: number;
    y: number;
  } | null>(null);
  const [blockModal, setBlockModal] = useState<{
    blockId?: string;
    pracId: string;
    dateStr: string;
    startTime: string;
    endTime: string;
    reason: string;
  } | null>(null);
  const [blockSaving, setBlockSaving] = useState(false);
  const [dragBooking, setDragBooking] = useState<Booking | null>(null);
  /** While dragging, droppable occupancy ignores this booking so slots under it stay valid targets. */
  const [dragExcludeBookingId, setDragExcludeBookingId] = useState<string | null>(null);
  const [dragBlock, setDragBlock] = useState<CalendarBlock | null>(null);
  const [dragExcludeBlockId, setDragExcludeBlockId] = useState<string | null>(null);
  const [calendarDragPreview, setCalendarDragPreview] = useState<{ label: string; invalid: boolean } | null>(null);
  const [calendarDragTarget, setCalendarDragTarget] = useState<{
    pracId: string;
    startMin: number;
    endMin: number;
    invalid: boolean;
  } | null>(null);
  const calendarDragTargetRef = useRef<typeof calendarDragTarget>(null);
  const [resizeVisual, setResizeVisual] = useState<{ bookingId: string; deltaYPx: number } | null>(null);
  const [resizePreviewEnd, setResizePreviewEnd] = useState<{ bookingId: string; endHm: string } | null>(null);
  const [blockResizeVisual, setBlockResizeVisual] = useState<{ blockId: string; deltaYPx: number } | null>(null);
  const [blockResizePreviewEnd, setBlockResizePreviewEnd] = useState<{ blockId: string; endHm: string } | null>(
    null,
  );
  const justResizedBookingIdRef = useRef<string | null>(null);
  const justResizedBlockIdRef = useRef<string | null>(null);
  const [flashIds, setFlashIds] = useState<Set<string>>(() => new Set());
  const [quickActionId, setQuickActionId] = useState<string | null>(null);
  /** Single-step undo for drag-move and duration resize on the day/week grid. */
  const [lastScheduleEditUndo, setLastScheduleEditUndo] = useState<{
    kind: 'move' | 'resize';
    prev: Booking;
  } | null>(null);
  const [scheduleUndoPending, setScheduleUndoPending] = useState(false);
  /** After a drag-reschedule succeeds, booking bar shows Confirm / Undo until timer or Confirm (toolbar undo may remain). */
  const [dragMoveConfirmBookingId, setDragMoveConfirmBookingId] = useState<string | null>(null);
  /** Guest modification notify for drag-reschedule fires after Confirm or {@link BOOKING_MODIFY_NOTIFY_DEFER_MS}. */
  const pendingDeferredModificationNotifyBookingIdRef = useRef<string | null>(null);
  const deferredModificationNotifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guestModificationNotifyInFlightRef = useRef(false);
  const [scheduleBlocks, setScheduleBlocks] = useState<ScheduleBlockDTO[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timelineRootRef = useRef<HTMLDivElement>(null);
  const suppressNextCalendarClick = useRef(false);
  const mousePanRef = useRef<{
    startX: number;
    startY: number;
    scrollLeft: number;
    mainScrollTop: number;
    main: HTMLElement | null;
    moved: boolean;
  } | null>(null);
  const [mousePanning, setMousePanning] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 12 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 450, tolerance: 4 },
    }),
  );

  useEffect(() => {
    calendarDragTargetRef.current = calendarDragTarget;
  }, [calendarDragTarget]);

  const clearDeferredModificationGuestNotifyTimer = useCallback(() => {
    if (deferredModificationNotifyTimerRef.current != null) {
      window.clearTimeout(deferredModificationNotifyTimerRef.current);
      deferredModificationNotifyTimerRef.current = null;
    }
  }, []);

  const cancelPendingDeferredModificationGuestNotify = useCallback(() => {
    clearDeferredModificationGuestNotifyTimer();
    pendingDeferredModificationNotifyBookingIdRef.current = null;
  }, [clearDeferredModificationGuestNotifyTimer]);

  const postGuestModificationNotify = useCallback(async (bookingId: string) => {
    if (guestModificationNotifyInFlightRef.current) return;
    guestModificationNotifyInFlightRef.current = true;
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}/guest-modification-notify`, {
        method: 'POST',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        addToast((j as { error?: string }).error ?? 'Could not send booking update to guest', 'error');
      }
    } catch {
      addToast('Could not send booking update to guest', 'error');
    } finally {
      guestModificationNotifyInFlightRef.current = false;
    }
  }, [addToast]);

  const scheduleDeferredModificationGuestNotify = useCallback(
    (bookingId: string) => {
      clearDeferredModificationGuestNotifyTimer();
      pendingDeferredModificationNotifyBookingIdRef.current = bookingId;
      deferredModificationNotifyTimerRef.current = setTimeout(() => {
        deferredModificationNotifyTimerRef.current = null;
        pendingDeferredModificationNotifyBookingIdRef.current = null;
        setDragMoveConfirmBookingId(null);
        void postGuestModificationNotify(bookingId);
      }, BOOKING_MODIFY_NOTIFY_DEFER_MS);
    },
    [clearDeferredModificationGuestNotifyTimer, postGuestModificationNotify],
  );

  const confirmInlineDragMove = useCallback(async () => {
    clearDeferredModificationGuestNotifyTimer();
    const bid = pendingDeferredModificationNotifyBookingIdRef.current;
    pendingDeferredModificationNotifyBookingIdRef.current = null;
    setDragMoveConfirmBookingId(null);
    setLastScheduleEditUndo(null);
    if (bid) await postGuestModificationNotify(bid);
  }, [
    clearDeferredModificationGuestNotifyTimer,
    postGuestModificationNotify,
  ]);

  useEffect(() => {
    return () => {
      clearDeferredModificationGuestNotifyTimer();
      pendingDeferredModificationNotifyBookingIdRef.current = null;
    };
  }, [clearDeferredModificationGuestNotifyTimer]);

  const handleCalendarMouseDown = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target instanceof Element ? e.target : null;
    const startedOnEmptySlot = Boolean(target?.closest('[data-calendar-pan-slot="true"]'));
    const startedOnControl = Boolean(
      target?.closest('a, button, input, select, textarea, [role="button"], [data-no-calendar-pan="true"]'),
    );
    if (startedOnControl && !startedOnEmptySlot) return;

    const scroller = scrollRef.current;
    if (!scroller) return;

    const main = scroller.closest('main') as HTMLElement | null;
    mousePanRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: scroller.scrollLeft,
      mainScrollTop: main?.scrollTop ?? 0,
      main,
      moved: false,
    };

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    const onMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const pan = mousePanRef.current;
      const currentScroller = scrollRef.current;
      if (!pan || !currentScroller) return;

      const dx = moveEvent.clientX - pan.startX;
      const dy = moveEvent.clientY - pan.startY;
      if (!pan.moved && Math.hypot(dx, dy) > 4) {
        pan.moved = true;
        setMousePanning(true);
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
      }
      if (!pan.moved) return;

      moveEvent.preventDefault();
      currentScroller.scrollLeft = pan.scrollLeft - dx;
      if (pan.main) {
        pan.main.scrollTop = pan.mainScrollTop - dy;
      }
    };

    const finishPan = () => {
      const pan = mousePanRef.current;
      if (pan?.moved) {
        suppressNextCalendarClick.current = true;
        window.setTimeout(() => {
          suppressNextCalendarClick.current = false;
        }, 0);
      }
      mousePanRef.current = null;
      setMousePanning(false);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', finishPan);
      window.removeEventListener('mouseleave', finishPan);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', finishPan);
    window.addEventListener('mouseleave', finishPan);
  }, []);

  const handleCalendarClickCapture = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (!suppressNextCalendarClick.current) return;
    suppressNextCalendarClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const showEventsColumn = venueExposesBookingModel(bookingModel, enabledModels, 'event_ticket');
  const showClassSessions = venueExposesBookingModel(bookingModel, enabledModels, 'class_session');
  const loadVenueResources = venueExposesBookingModel(bookingModel, enabledModels, 'resource_booking');

  const staffBookingSurfaceTabs = useMemo(
    () => getStaffBookingSurfaceTabs(bookingModel, enabledModels),
    [bookingModel, enabledModels],
  );
  const newBookingToolbarLabel =
    isUnifiedSchedulingVenue(bookingModel) && staffBookingSurfaceTabs.length === 1
      ? 'New appointment'
      : 'New booking';
  /** Fetch schedule feed for events strip (classes render on team columns via `calendar_id`). */
  const showMergedFeeds = showEventsColumn || showClassSessions;

  const activeDayDate = viewMode === 'day' ? date : viewMode === 'week' ? weekStart : monthAnchor;
  const { startHour: derivedStartHour, endHour: derivedEndHour } = useMemo(
    () => {
      const base = getCalendarGridBounds(activeDayDate, openingHours ?? undefined, 7, 21, {
        timeZone: venueTimezone,
      });
      if (viewMode !== 'day') return base;

      let minM = base.startHour * 60;
      let maxM = base.endHour * 60;
      const includeRange = (start: string | null | undefined, end: string | null | undefined, fallbackMinutes: number) => {
        if (!start) return;
        const startM = timeToMinutes(start);
        if (!Number.isFinite(startM)) return;
        const endM = end ? timeToMinutes(end) : startM + fallbackMinutes;
        if (!Number.isFinite(endM)) return;
        minM = Math.min(minM, startM);
        maxM = Math.max(maxM, endM <= startM ? startM + fallbackMinutes : endM);
      };

      const serviceMapForBounds = new Map(services.map((s) => [s.id, s]));
      for (const booking of bookings) {
        if (booking.booking_date !== activeDayDate) continue;
        const startM = timeToMinutes(booking.booking_time);
        const endM = startM + bookingCalendarDisplaySpanMinutes(booking, serviceMapForBounds);
        minM = Math.min(minM, startM);
        maxM = Math.max(maxM, endM);
      }
      for (const block of blocks) {
        if (block.block_date !== activeDayDate) continue;
        includeRange(block.start_time, block.end_time, 60);
      }
      for (const block of scheduleBlocks) {
        if (block.date !== activeDayDate) continue;
        includeRange(block.start_time, block.end_time, 60);
      }

      const startHour = Math.max(0, Math.floor(minM / 60));
      const endHour = Math.max(startHour + 1, Math.ceil(maxM / 60));
      return { startHour, endHour };
    },
    [activeDayDate, blocks, bookings, openingHours, scheduleBlocks, services, venueTimezone, viewMode],
  );
  const [startHourOverride, setStartHourOverride] = useState<number | null>(null);
  const [endHourOverride, setEndHourOverride] = useState<number | null>(null);

  /** Session preferences are applied after mount so the first paint matches SSR HTML. */
  const [calendarPrefsHydrated, setCalendarPrefsHydrated] = useState(false);

  useEffect(() => {
    const remembered = readSessionPreference<PractitionerCalendarPreferences>(
      preferencesKey,
      {},
      isPractitionerCalendarPreferences,
    );
    if (remembered.viewMode) setViewMode(remembered.viewMode);
    if (remembered.date) setDate(remembered.date);
    if (remembered.weekStart) setWeekStart(remembered.weekStart);
    if (remembered.monthAnchor) setMonthAnchor(remembered.monthAnchor);
    if (remembered.visibleCalendarIdsState !== undefined) {
      setVisibleCalendarIdsState(remembered.visibleCalendarIdsState);
    }
    if (remembered.visibleLinkedColumnIds !== undefined) {
      setVisibleLinkedColumnIds(remembered.visibleLinkedColumnIds);
    }
    if (
      remembered.filterStatus &&
      CALENDAR_STATUS_FILTERS.some((s) => s.value === remembered.filterStatus)
    ) {
      setFilterStatus(remembered.filterStatus);
    }
    if (remembered.startHourOverride !== undefined) setStartHourOverride(remembered.startHourOverride);
    if (remembered.endHourOverride !== undefined) setEndHourOverride(remembered.endHourOverride);
    setCalendarPrefsHydrated(true);
  }, [preferencesKey]);
  const startHour = startHourOverride ?? derivedStartHour;
  const endHour = endHourOverride ?? derivedEndHour;
  const TOTAL_SLOTS = (() => {
    const n = ((endHour - startHour) * 60) / SLOT_MINUTES;
    return Number.isFinite(n) && n > 0 ? n : ((21 - 7) * 60) / SLOT_MINUTES;
  })();

  useEffect(() => {
    if (!calendarPrefsHydrated) return;
    writeSessionPreference<PractitionerCalendarPreferences>(preferencesKey, {
      viewMode,
      date,
      weekStart,
      monthAnchor,
      visibleCalendarIdsState,
      visibleLinkedColumnIds,
      filterStatus,
      startHourOverride,
      endHourOverride,
    });
  }, [
    calendarPrefsHydrated,
    preferencesKey,
    viewMode,
    date,
    weekStart,
    monthAnchor,
    visibleCalendarIdsState,
    visibleLinkedColumnIds,
    filterStatus,
    startHourOverride,
    endHourOverride,
  ]);

  const listFromTo = useMemo(() => {
    if (viewMode === 'day') return { from: date, to: date };
    if (viewMode === 'week') return { from: weekStart, to: addCalendarDays(weekStart, 6) };
    return monthGridDateRange(monthAnchor);
  }, [viewMode, date, weekStart, monthAnchor]);

  const fetchData = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (!silent) {
        setLoading(true);
        setFetchError(null);
      }
      try {
        const { from, to } = listFromTo;
        const params = from === to ? `date=${from}` : `from=${from}&to=${to}`;
        const listQuery = `${params}&view=calendar`;
        const blockUrl =
          from === to
            ? `/api/venue/practitioner-calendar-blocks?date=${from}`
            : `/api/venue/practitioner-calendar-blocks?from=${from}&to=${to}`;
        const schQuery =
          listFromTo.from === listFromTo.to
            ? `date=${encodeURIComponent(listFromTo.from)}`
            : `from=${encodeURIComponent(listFromTo.from)}&to=${encodeURIComponent(listFromTo.to)}`;

        const parallel: Promise<Response>[] = [
          fetch('/api/venue/practitioners?roster=1'),
          fetch(`/api/venue/bookings/list?${listQuery}`),
          fetch('/api/venue/appointment-services'),
          fetch(blockUrl),
        ];
        if (!silent) {
          parallel.push(fetch('/api/venue'));
        }
        if (loadVenueResources) {
          parallel.push(fetch('/api/venue/resources'));
        }
        if (showMergedFeeds) {
          parallel.push(fetch(`/api/venue/schedule?${schQuery}`));
        }

        const responses = await Promise.all(parallel);
        let i = 0;
        const pracRes = responses[i++]!;
        const bookRes = responses[i++]!;
        const svcRes = responses[i++]!;
        const blockRes = responses[i++]!;
        const venueRes = !silent ? responses[i++] : undefined;
        const resourcesRes = loadVenueResources ? responses[i++] : undefined;
        const scheduleRes = showMergedFeeds ? responses[i++] : undefined;

        if (!pracRes.ok || !bookRes.ok || !svcRes.ok) {
          setFetchError('Failed to load calendar data. Please refresh the page.');
          return;
        }

        const [pracData, bookData, svcData, bjson] = await Promise.all([
          pracRes.json() as Promise<{ practitioners?: Practitioner[] }>,
          bookRes.json() as Promise<{ bookings?: Booking[] }>,
          svcRes.json() as Promise<{ services?: AppointmentService[] }>,
          blockRes.ok ? blockRes.json() : Promise.resolve({ blocks: [] }),
        ]);

        if (!silent && venueRes?.ok) {
          const v = (await venueRes.json()) as {
            opening_hours?: OpeningHours;
            timezone?: string | null;
          };
          if (v.opening_hours) setOpeningHours(v.opening_hours);
          const tz = v.timezone;
          if (typeof tz === 'string' && tz.trim() !== '') setVenueTimezone(tz.trim());
        }

        if (loadVenueResources) {
          if (resourcesRes?.ok) {
            const rj = (await resourcesRes.json()) as { resources?: VenueResourceRow[] };
            setVenueResources((rj.resources ?? []) as VenueResourceRow[]);
          } else {
            setVenueResources([]);
          }
        } else {
          setVenueResources([]);
        }

        if (showMergedFeeds) {
          if (scheduleRes?.ok) {
            const schJson = (await scheduleRes.json()) as { blocks?: ScheduleBlockDTO[] };
            setScheduleBlocks(schJson.blocks ?? []);
          } else {
            setScheduleBlocks([]);
          }
        } else {
          setScheduleBlocks([]);
        }

        setPractitioners(pracData.practitioners ?? []);
        setBookings((bookData.bookings ?? []) as Booking[]);
        setServices(svcData.services ?? []);
        setBlocks((bjson as { blocks?: CalendarBlock[] }).blocks ?? []);
      } catch {
        setFetchError('Failed to load calendar data. Please check your connection.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [listFromTo, showMergedFeeds, loadVenueResources],
  );

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  /**
   * Linked-venue calendars (§8.2) are loaded in a fully isolated effect: a
   * failure here never affects the core calendar — it just leaves the linked
   * data empty. Keyed off the same date range so linked data follows the
   * page's day/week selection automatically.
   */
  const loadLinkedData = useCallback(async () => {
    if (!linkFeature) {
      setLinkedVenues([]);
      return;
    }
    try {
      const { from, to } = listFromTo;
      const params = from === to ? `date=${from}` : `from=${from}&to=${to}`;
      const res = await fetch(`/api/venue/linked-calendar?${params}`);
      if (!res.ok) {
        setLinkedVenues([]);
        return;
      }
      const json = (await res.json()) as { venues?: LinkedVenueCalendar[] };
      setLinkedVenues(json.venues ?? []);
    } catch {
      setLinkedVenues([]);
    }
  }, [linkFeature, listFromTo]);

  /**
   * Debounced linked-data refetch. Date paging and realtime events both route
   * through here so rapid day changes (or a burst of linked-venue edits)
   * collapse into a single request rather than one fetch per tick.
   */
  const linkedRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleLinkedRefetch = useCallback(() => {
    if (linkedRefetchTimerRef.current) clearTimeout(linkedRefetchTimerRef.current);
    linkedRefetchTimerRef.current = setTimeout(() => {
      linkedRefetchTimerRef.current = null;
      void loadLinkedData();
    }, 400);
  }, [loadLinkedData]);

  useEffect(() => {
    scheduleLinkedRefetch();
    return () => {
      if (linkedRefetchTimerRef.current) clearTimeout(linkedRefetchTimerRef.current);
    };
  }, [scheduleLinkedRefetch]);

  useEffect(() => {
    if (!showResourceBooking || resourceBookingVenue) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/venue');
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          if (!cancelled) setResourceBookingVenueError(typeof data.error === 'string' ? data.error : 'Could not load venue');
          return;
        }
        if (!cancelled) {
          setResourceBookingVenue(mapApiVenueToVenuePublic(data));
          setResourceBookingVenueError(null);
        }
      } catch {
        if (!cancelled) setResourceBookingVenueError('Could not load venue');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showResourceBooking, resourceBookingVenue]);

  const silentRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSilentCalendarRefetch = useCallback(() => {
    if (silentRefetchTimerRef.current) clearTimeout(silentRefetchTimerRef.current);
    silentRefetchTimerRef.current = setTimeout(() => {
      silentRefetchTimerRef.current = null;
      void fetchData({ silent: true });
    }, 400);
  }, [fetchData]);

  useEffect(() => {
    if (loading || viewMode !== 'day') return;
    const el = scrollRef.current;
    if (!el?.closest('main')) return;

    const apply = () => {
      const m = scrollRef.current?.closest('main');
      if (!m) return;
      m.scrollTo({ top: 0, behavior: 'auto' });
    };
    const id = requestAnimationFrame(() => requestAnimationFrame(apply));
    return () => cancelAnimationFrame(id);
  }, [loading, viewMode, date, startHour, endHour]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`calendar-${venueId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `venue_id=eq.${venueId}` },
        (payload) => {
          const row = payload.new as { id?: string } | null;
          if (row?.id) {
            setFlashIds((prev) => new Set(prev).add(row.id!));
            window.setTimeout(() => {
              setFlashIds((prev) => {
                const n = new Set(prev);
                n.delete(row.id!);
                return n;
              });
            }, 2200);
          }
          scheduleSilentCalendarRefetch();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'practitioner_calendar_blocks', filter: `venue_id=eq.${venueId}` },
        () => {
          scheduleSilentCalendarRefetch();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'calendar_blocks', filter: `venue_id=eq.${venueId}` },
        () => {
          scheduleSilentCalendarRefetch();
        },
      )
      .subscribe((status) => {
        setRealtimeConnected(status === 'SUBSCRIBED');
      });
    return () => {
      if (silentRefetchTimerRef.current) clearTimeout(silentRefetchTimerRef.current);
      void supabase.removeChannel(channel);
    };
  }, [venueId, scheduleSilentCalendarRefetch]);

  /** Stable key for the set of linked venues — so realtime does not re-subscribe on a plain refetch. */
  const linkedVenueIdsKey = useMemo(
    () =>
      [...new Set(linkedVenues.map((v) => v.venueId))].sort().join(','),
    [linkedVenues],
  );

  /**
   * Linked-venue bookings (§8.2) get their own realtime channel so a change in
   * a linked venue surfaces live, not only on date change. RLS gates delivery —
   * the caller receives an event only for a row a link lets them see — and the
   * refetch is debounced. Keyed on the stable venue-id set so an ordinary
   * linked-data refetch never tears the subscription down.
   */
  useEffect(() => {
    const ids = linkedVenueIdsKey ? linkedVenueIdsKey.split(',') : [];
    if (!linkFeature || ids.length === 0) return;
    const supabase = createClient();
    const channel = supabase.channel(`linked-calendar-${venueId}`);
    for (const linkedVenueId of ids) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `venue_id=eq.${linkedVenueId}` },
        () => {
          scheduleLinkedRefetch();
        },
      );
    }
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [linkFeature, venueId, linkedVenueIdsKey, scheduleLinkedRefetch]);

  const activePractitioners = useMemo(
    () => practitioners.filter((p) => p.is_active),
    [practitioners],
  );

  /** Grid columns only: resources are merged into their host calendar column. */
  const columnPractitioners = useMemo(
    () =>
      activePractitioners
        .filter((p) => p.calendar_type !== 'resource')
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [activePractitioners],
  );

  /** `null` = all calendars; non-null = restrict to these column ids (may be a full explicit selection). */
  const calendarFilterIds = useMemo(() => {
    if (visibleCalendarIdsState === null) return null;
    const ids = columnPractitioners.map((p) => p.id);
    const valid = new Set(ids);
    const filtered = visibleCalendarIdsState.filter((id) => valid.has(id));
    if (filtered.length === 0) return null;
    return filtered;
  }, [visibleCalendarIdsState, columnPractitioners]);

  const filteredPractitioners = useMemo(() => {
    if (calendarFilterIds === null) return columnPractitioners;
    const allowed = new Set(calendarFilterIds);
    return columnPractitioners.filter((p) => allowed.has(p.id));
  }, [columnPractitioners, calendarFilterIds]);

  /** Every practitioner column exposed by a linked venue (§8.2). */
  const linkedColumns = useMemo<LinkedColumn[]>(() => {
    const out: LinkedColumn[] = [];
    for (const v of linkedVenues) {
      for (const p of v.practitioners) {
        out.push({
          key: linkedColumnKey(v.venueId, p.id),
          venueId: v.venueId,
          venueName: v.venueName,
          linkId: v.linkId,
          practitionerId: p.id,
          practitionerName: p.name,
          practitionerActive: p.isActive,
          visibility: v.visibility,
          action: v.action,
        });
      }
    }
    return out;
  }, [linkedVenues]);

  /** Linked columns the user has switched on — these render on the grid. */
  const visibleLinkedColumns = useMemo(
    () => linkedColumns.filter((c) => visibleLinkedColumnIds.includes(c.key)),
    [linkedColumns, visibleLinkedColumnIds],
  );

  const linkedVenueById = useMemo(() => {
    const m = new Map<string, LinkedVenueCalendar>();
    for (const v of linkedVenues) m.set(v.venueId, v);
    return m;
  }, [linkedVenues]);

  const linkedBookingsFor = useCallback(
    (column: LinkedColumn, dayDate: string): LinkedBooking[] => {
      const venue = linkedVenueById.get(column.venueId);
      if (!venue) return [];
      return venue.bookings.filter(
        (b) => b.practitionerId === column.practitionerId && b.bookingDate === dayDate,
      );
    },
    [linkedVenueById],
  );

  /**
   * A click on any linked booking opens the edit modal when the grant allows
   * it, or a read-only detail modal otherwise (§4.3) — so the grid never
   * swallows a click silently.
   */
  const openLinkedBooking = useCallback((column: LinkedColumn, booking: LinkedBooking) => {
    if (linkedBookingIsClickable(column, booking)) {
      setLinkedEditing({ column, booking });
    } else {
      setLinkedViewing({ column, booking });
    }
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
  }, [loading, viewMode, filteredPractitioners.length]);

  const resourceParentById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of venueResources) {
      if (r.display_on_calendar_id) m.set(r.id, r.display_on_calendar_id);
    }
    return m;
  }, [venueResources]);

  const resourceNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of venueResources) m.set(r.id, r.name);
    return m;
  }, [venueResources]);

  /** Free resource slots (day grid): mint blocks under host calendar column. */
  const resourceAvailabilityByPractitioner = useMemo(() => {
    if (viewMode !== 'day') {
      return new Map<string, Array<{ top: number; height: number; resourceName: string }>>();
    }
    const out = new Map<string, Array<{ top: number; height: number; resourceName: string }>>();
    for (const prac of filteredPractitioners) {
      const onColumn = venueResources.filter((r) => r.display_on_calendar_id === prac.id && r.is_active);
      if (onColumn.length === 0) continue;
      const mint: Array<{ top: number; height: number; resourceName: string }> = [];
      for (const r of onColumn) {
        const vr = apiResourceRowToVenueResource(r, venueId);
        const existingBookings: EngineResourceBooking[] = bookings
          .filter(
            (b) =>
              b.booking_date === date &&
              (b.resource_id === r.id || b.calendar_id === r.id) &&
              !['Cancelled', 'No-Show'].includes(b.status),
          )
          .map((b) => ({
            id: b.id,
            resource_id: r.id,
            booking_time: b.booking_time.slice(0, 5),
            booking_end_time: (b.booking_end_time ?? b.booking_time).slice(0, 5),
            status: b.status,
          }));
        const sameDaySlotCutoff = sameDaySlotCutoffForBookingDate(date, venueTimezone) ?? undefined;
        const results = computeResourceAvailability(
          { date, resources: [vr], existingBookings, sameDaySlotCutoff },
          vr.min_booking_minutes,
        );
        const res0 = results[0];
        if (!res0) continue;
        const dur = Math.max(
          vr.min_booking_minutes,
          Math.min(vr.min_booking_minutes, vr.max_booking_minutes),
        );
        for (const slot of res0.slots) {
          const startM = timeToMinutes(slot.start_time);
          const top = ((startM - startHour * 60) / SLOT_MINUTES) * SLOT_HEIGHT;
          const height = Math.max((dur / SLOT_MINUTES) * SLOT_HEIGHT, SLOT_HEIGHT);
          mint.push({ top, height, resourceName: r.name });
        }
      }
      if (mint.length > 0) out.set(prac.id, mint);
    }
    return out;
  }, [viewMode, date, filteredPractitioners, venueResources, bookings, startHour, venueId, venueTimezone]);

  const serviceMap = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);

  function bookingsForPractitioner(pracId: string, dayDate: string): Booking[] {
    return bookings.filter((b) => {
      if (b.booking_date !== dayDate) return false;
      if (resolveBookingColumnId(b, resourceParentById) !== pracId) return false;
      if (!bookingMatchesCalendarStatusFilter(b, filterStatus)) return false;
      return true;
    });
  }

  function getBookingDuration(b: Booking): number {
    return bookingCalendarDisplaySpanMinutes(b, serviceMap);
  }

  function slotTop(time: string): number {
    const mins = timeToMinutes(time);
    const offset = mins - startHour * 60;
    return (offset / SLOT_MINUTES) * SLOT_HEIGHT;
  }

  function slotHeightFromDuration(durationMins: number): number {
    /** At least one grid row so label + actions + optional resize strip do not overlap. */
    return Math.max((durationMins / SLOT_MINUTES) * SLOT_HEIGHT, SLOT_HEIGHT);
  }

  function clearTimeRangeOverridesForDayChange() {
    setStartHourOverride(null);
    setEndHourOverride(null);
  }

  function navigateDay(dir: -1 | 1) {
    if (viewMode === 'day') {
      clearTimeRangeOverridesForDayChange();
      setDate((d) => addCalendarDays(d, dir));
    } else if (viewMode === 'week') setWeekStart((d) => addCalendarDays(d, dir * 7));
    else {
      const som = startOfMonth(monthAnchor);
      const d = new Date(`${som}T12:00:00`);
      d.setMonth(d.getMonth() + dir);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      setMonthAnchor(`${y}-${m}-01`);
    }
  }

  function navigateDayDirect(iso: string) {
    clearTimeRangeOverridesForDayChange();
    setDate(iso);
    setWeekStart(iso);
    setMonthAnchor(iso);
  }

  function handleTimeRangeChange(start: number, end: number) {
    setStartHourOverride(start);
    setEndHourOverride(end);
  }

  function openNewAtSlot(pracId: string, dateStr: string, time: string) {
    setPrefillPractitionerId(pracId);
    setPrefillDate(dateStr);
    setPrefillTime(time);
    setStaffBookingModal('new');
    setSlotMenu(null);
  }

  function openWalkInAtSlot(pracId: string, dateStr: string, time: string) {
    setPrefillPractitionerId(pracId);
    setPrefillDate(dateStr);
    setPrefillTime(time);
    setStaffBookingModal('walk-in');
    setSlotMenu(null);
  }

  function openBlockModal(pracId: string, dateStr: string, startTime: string) {
    const sm = timeToMinutes(startTime);
    const endM = Math.min(sm + 60, endHour * 60);
    setBlockModal({
      pracId,
      dateStr,
      startTime,
      endTime: minutesToTime(endM),
      reason: '',
    });
    setSlotMenu(null);
  }

  function openEditBlockModal(bl: CalendarBlock) {
    if (!isManualEditableBlock(bl)) {
      return;
    }
    const colId = columnIdForBlock(bl);
    if (!colId) return;
    const st = bl.start_time.length >= 5 ? bl.start_time.slice(0, 5) : bl.start_time;
    const en = bl.end_time.length >= 5 ? bl.end_time.slice(0, 5) : bl.end_time;
    setBlockModal({
      blockId: bl.id,
      pracId: colId,
      dateStr: bl.block_date,
      startTime: st,
      endTime: en,
      reason: bl.reason ?? '',
    });
  }

  async function saveBlock() {
    if (!blockModal) return;
    if (timeToMinutes(blockModal.endTime) <= timeToMinutes(blockModal.startTime)) {
      addToast('End time must be after start time', 'error');
      return;
    }
    setBlockSaving(true);
    try {
      if (blockModal.blockId) {
        const res = await fetch(`/api/venue/practitioner-calendar-blocks/${blockModal.blockId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            start_time: blockModal.startTime,
            end_time: blockModal.endTime,
            reason: blockModal.reason.trim() || null,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          addToast((j as { error?: string }).error ?? 'Could not update block', 'error');
          return;
        }
      } else {
        const res = await fetch('/api/venue/practitioner-calendar-blocks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            practitioner_id: blockModal.pracId,
            block_date: blockModal.dateStr,
            start_time: blockModal.startTime,
            end_time: blockModal.endTime,
            reason: blockModal.reason.trim() || undefined,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          addToast((j as { error?: string }).error ?? 'Could not create block', 'error');
          return;
        }
      }
      setBlockModal(null);
      void fetchData({ silent: true });
    } catch {
      addToast(blockModal.blockId ? 'Could not update block' : 'Could not create block', 'error');
    } finally {
      setBlockSaving(false);
    }
  }

  const patchBlockResize = useCallback(
    async (block: CalendarBlock, newEndHm: string) => {
      const prev = { ...block };
      const startHm = block.start_time.slice(0, 5);
      if (timeToMinutes(newEndHm) <= timeToMinutes(startHm)) return;
      setBlocks((rows) =>
        rows.map((bl) => (bl.id === block.id ? { ...bl, end_time: newEndHm } : bl)),
      );
      try {
        const res = await fetch(`/api/venue/practitioner-calendar-blocks/${block.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ end_time: newEndHm }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          addToast((j as { error?: string }).error ?? 'Could not update block duration', 'error');
          setBlocks((rows) => rows.map((bl) => (bl.id === prev.id ? prev : bl)));
        } else {
          void fetchData({ silent: true });
        }
      } catch {
        addToast('Could not update block duration', 'error');
        setBlocks((rows) => rows.map((bl) => (bl.id === prev.id ? prev : bl)));
      }
    },
    [addToast, fetchData],
  );

  async function patchBlockMove(block: CalendarBlock, newDate: string, newStart: string, newColId: string) {
    const prev = { ...block };
    const duration = blockDurationMinutes(block);
    const newEnd = minutesToTime(timeToMinutes(newStart) + duration);
    const colId = columnIdForBlock(block);
    setBlocks((rows) =>
      rows.map((bl) => {
        if (bl.id !== block.id) return bl;
        const next: CalendarBlock = {
          ...bl,
          block_date: newDate,
          start_time: newStart,
          end_time: newEnd,
        };
        if (bl.calendar_id) next.calendar_id = newColId;
        else next.practitioner_id = newColId;
        return next;
      }),
    );
    try {
      const res = await fetch(`/api/venue/practitioner-calendar-blocks/${block.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          block_date: newDate,
          start_time: newStart,
          end_time: newEnd,
          practitioner_id: newColId,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        addToast((j as { error?: string }).error ?? 'Could not move block', 'error');
        setBlocks((rows) => rows.map((bl) => (bl.id === prev.id ? prev : bl)));
        return;
      }
      if (colId !== newColId || block.block_date !== newDate) {
        addToast('Block moved', 'success');
      }
      void fetchData({ silent: true });
    } catch {
      addToast('Could not move block', 'error');
      setBlocks((rows) => rows.map((bl) => (bl.id === prev.id ? prev : bl)));
    }
  }

  async function deleteBlockFromModal() {
    if (!blockModal?.blockId) return;
    if (!window.confirm('Remove this blocked time?')) return;
    setBlockSaving(true);
    try {
      const res = await fetch(`/api/venue/practitioner-calendar-blocks/${blockModal.blockId}`, { method: 'DELETE' });
      if (!res.ok) addToast('Could not remove block', 'error');
      else {
        setBlockModal(null);
        void fetchData({ silent: true });
      }
    } finally {
      setBlockSaving(false);
    }
  }

  async function patchBookingMove(booking: Booking, newDate: string, newTime: string, newPracId: string) {
    const prev = { ...booking };
    const timeHm = newTime.length === 5 ? newTime : newTime.slice(0, 5);
    const timeForStore = newTime.length === 5 ? `${newTime}:00` : newTime;
    const dur = getBookingDuration(booking);
    const endHm = minutesToTime(timeToMinutes(timeHm) + dur);
    const bookingEndForStore = `${endHm}:00`;
    const estimatedEndForStore = estimatedEndIsoFromSchedule(newDate, timeHm, endHm);
    setBookings((rows) =>
      rows.map((b) =>
        b.id === booking.id
          ? {
              ...b,
              booking_date: newDate,
              booking_time: timeForStore,
              booking_end_time: bookingEndForStore,
              estimated_end_time: estimatedEndForStore,
              ...(b.calendar_id != null ? { calendar_id: newPracId } : { practitioner_id: newPracId }),
            }
          : b,
      ),
    );
    try {
      const res = await fetch(`/api/venue/bookings/${booking.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_date: newDate,
          booking_time: timeForStore,
          practitioner_id: newPracId,
          booking_end_time: bookingEndForStore,
          allow_manual_overlap: true,
          defer_modification_guest_notification: true,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        addToast((j as { error?: string }).error ?? 'Could not move appointment', 'error');
        setBookings((rows) => rows.map((b) => (b.id === prev.id ? prev : b)));
        return;
      }
      setLastScheduleEditUndo({ kind: 'move', prev });
      setDragMoveConfirmBookingId(booking.id);
      scheduleDeferredModificationGuestNotify(booking.id);
      void fetchData({ silent: true });
    } catch {
      addToast('Could not move appointment', 'error');
      setBookings((rows) => rows.map((b) => (b.id === prev.id ? prev : b)));
    }
  }

  const patchBookingResize = useCallback(
    async (booking: Booking, newEndHm: string) => {
      const prev = { ...booking };
      const startHm = booking.booking_time.slice(0, 5);
      const endLen5 = minutesToTime(timeToMinutes(newEndHm));
      if (timeToMinutes(newEndHm) <= timeToMinutes(startHm)) return;
      const bookingEndForStore = `${endLen5}:00`;
      const estimatedEndForStore = estimatedEndIsoFromSchedule(
        booking.booking_date,
        startHm,
        endLen5,
      );
      setBookings((rows) =>
        rows.map((b) =>
          b.id === booking.id
            ? {
                ...b,
                booking_end_time: bookingEndForStore,
                estimated_end_time: estimatedEndForStore,
              }
            : b,
        ),
      );
      try {
        const res = await fetch(`/api/venue/bookings/${booking.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ booking_end_time: bookingEndForStore, allow_manual_overlap: true }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          addToast((j as { error?: string }).error ?? 'Could not update duration', 'error');
          setBookings((rows) => rows.map((b) => (b.id === prev.id ? prev : b)));
          return;
        }
        cancelPendingDeferredModificationGuestNotify();
        setDragMoveConfirmBookingId(null);
        setLastScheduleEditUndo({ kind: 'resize', prev });
        void fetchData({ silent: true });
      } catch {
        addToast('Could not update duration', 'error');
        setBookings((rows) => rows.map((b) => (b.id === prev.id ? prev : b)));
      }
    },
    [addToast, fetchData, cancelPendingDeferredModificationGuestNotify],
  );

  const undoLastScheduleEdit = useCallback(async () => {
    if (!lastScheduleEditUndo || scheduleUndoPending) return;
    const { kind, prev } = lastScheduleEditUndo;
    const colId = resolveBookingColumnId(prev, resourceParentById);
    if (!colId) {
      addToast('Cannot undo: calendar column is no longer available', 'error');
      return;
    }

    const bookingId = prev.id;
    const startHm = prev.booking_time.slice(0, 5);
    const bookingEndForStore =
      prev.booking_end_time && prev.booking_end_time.trim() !== ''
        ? bookingTimeToStore(prev.booking_end_time)
        : `${minutesToTime(timeToMinutes(startHm) + bookingDurationMinutes(prev, serviceMap))}:00`;

    setScheduleUndoPending(true);
    setBookings((rows) => rows.map((b) => (b.id === bookingId ? { ...prev } : b)));

    try {
      if (kind === 'resize') {
        const res = await fetch(`/api/venue/bookings/${bookingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ booking_end_time: bookingEndForStore, allow_manual_overlap: true }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          addToast((j as { error?: string }).error ?? 'Could not undo', 'error');
          void fetchData({ silent: true });
          return;
        }
      } else {
        const timeForStore = bookingTimeToStore(prev.booking_time);
        const skipBookingModificationGuestNotification =
          pendingDeferredModificationNotifyBookingIdRef.current === bookingId;
        const res = await fetch(`/api/venue/bookings/${bookingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            booking_date: prev.booking_date,
            booking_time: timeForStore,
            practitioner_id: colId,
            booking_end_time: bookingEndForStore,
            allow_manual_overlap: true,
            ...(skipBookingModificationGuestNotification
              ? { skip_booking_modification_guest_notification: true }
              : {}),
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          addToast((j as { error?: string }).error ?? 'Could not undo', 'error');
          void fetchData({ silent: true });
          return;
        }
      }
      cancelPendingDeferredModificationGuestNotify();
      setLastScheduleEditUndo(null);
      setDragMoveConfirmBookingId(null);
      addToast('Change undone', 'success');
      void fetchData({ silent: true });
    } catch {
      addToast('Could not undo', 'error');
      void fetchData({ silent: true });
    } finally {
      setScheduleUndoPending(false);
    }
  }, [
    addToast,
    fetchData,
    lastScheduleEditUndo,
    resourceParentById,
    scheduleUndoPending,
    serviceMap,
    cancelPendingDeferredModificationGuestNotify,
  ]);

  async function quickPatchBooking(bookingId: string, body: Record<string, unknown>) {
    setQuickActionId(bookingId);
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        addToast((j as { error?: string }).error ?? 'Update failed', 'error');
        return;
      }
      void fetchData({ silent: true });
    } catch {
      addToast('Update failed', 'error');
    } finally {
      setQuickActionId(null);
    }
  }

  function clearCalendarDragUi() {
    setDragBooking(null);
    setDragExcludeBookingId(null);
    setDragBlock(null);
    setDragExcludeBlockId(null);
    setCalendarDragPreview(null);
    setCalendarDragTarget(null);
    calendarDragTargetRef.current = null;
  }

  const scheduleBlocksInVisibleColumns = useMemo(() => {
    if (calendarFilterIds === null) return scheduleBlocks;
    const allowed = new Set(calendarFilterIds);
    return scheduleBlocks.filter((b) => !b.calendar_id || allowed.has(b.calendar_id));
  }, [scheduleBlocks, calendarFilterIds]);

  const classBlocksForGrid = useMemo(
    () =>
      scheduleBlocksInVisibleColumns.filter(
        (b) => b.kind === 'class_session' && b.status !== 'Cancelled' && b.calendar_id,
      ),
    [scheduleBlocksInVisibleColumns],
  );

  const eventBlocksForGrid = useMemo(
    () =>
      scheduleBlocksInVisibleColumns.filter(
        (b) => b.kind === 'event_ticket' && b.status !== 'Cancelled' && b.calendar_id,
      ),
    [scheduleBlocksInVisibleColumns],
  );

  function handleDragStart(e: DragStartEvent) {
    const b = e.active.data.current?.booking as Booking | undefined;
    const bl = e.active.data.current?.block as CalendarBlock | undefined;
    if (b) {
      setDragBooking(b);
      setDragExcludeBookingId(b.id);
      setDragBlock(null);
      setDragExcludeBlockId(null);
    } else if (bl) {
      setDragBlock(bl);
      setDragExcludeBlockId(bl.id);
      setDragBooking(null);
      setDragExcludeBookingId(null);
    } else {
      setDragBooking(null);
      setDragExcludeBookingId(null);
      setDragBlock(null);
      setDragExcludeBlockId(null);
    }
  }

  function handleDragMove(e: DragMoveEvent) {
    const b = e.active.data.current?.booking as Booking | undefined;
    const bl = e.active.data.current?.block as CalendarBlock | undefined;
    const over = e.over;
    if ((!b && !bl) || !over?.data?.current) {
      setCalendarDragPreview(null);
      setCalendarDragTarget(null);
      return;
    }
    if (bl) {
      const { pracId, dateStr } = over.data.current as {
        pracId: string;
        dateStr: string;
        slotStartMins: number;
      };
      const originalStartMins = timeToMinutes(bl.start_time.slice(0, 5));
      const deltaMinutes = snapCalendarMoveMinutes((e.delta.y / SLOT_HEIGHT) * SLOT_MINUTES);
      const targetStartMins = originalStartMins + deltaMinutes;
      const duration = blockDurationMinutes(bl);
      const endMin = targetStartMins + duration;
      const dayStartMin = startHour * 60;
      const dayEndMin = endHour * 60;
      const pracClassBlocks = classBlocksForGrid.filter((cbl) => cbl.calendar_id === pracId && cbl.date === dateStr);
      const pracEventBlocks = eventBlocksForGrid.filter((cbl) => cbl.calendar_id === pracId && cbl.date === dateStr);
      const invalid =
        targetStartMins < dayStartMin ||
        endMin > dayEndMin ||
        appointmentWindowCollides(
          targetStartMins,
          endMin,
          pracId,
          dateStr,
          undefined,
          bookings,
          blocks,
          serviceMap,
          pracClassBlocks,
          pracEventBlocks,
          resourceParentById,
          { ignoreBookings: true, excludeBlockId: bl.id },
        );
      const pracName = filteredPractitioners.find((p) => p.id === pracId)?.name ?? 'Staff';
      const timeLabel = minutesToTime(targetStartMins);
      const sameColumn = columnIdForBlock(bl) === pracId && bl.block_date === dateStr;
      const label = sameColumn ? `Move to ${timeLabel}` : `Move to ${pracName} · ${timeLabel}`;
      setCalendarDragPreview({ label, invalid });
      setCalendarDragTarget({ pracId, startMin: targetStartMins, endMin, invalid });
      return;
    }
    if (!b) {
      setCalendarDragPreview(null);
      setCalendarDragTarget(null);
      return;
    }
    const { pracId, dateStr } = over.data.current as {
      pracId: string;
      dateStr: string;
      slotStartMins: number;
    };
    const originalStartMins = timeToMinutes(b.booking_time.slice(0, 5));
    const deltaMinutes = snapCalendarMoveMinutes((e.delta.y / SLOT_HEIGHT) * SLOT_MINUTES);
    const targetStartMins = originalStartMins + deltaMinutes;
    const duration = getBookingDuration(b);
    const endMin = targetStartMins + duration;
    const dayStartMin = startHour * 60;
    const dayEndMin = endHour * 60;
    const pracClassBlocks = classBlocksForGrid.filter((bl) => bl.calendar_id === pracId && bl.date === dateStr);
    const pracEventBlocks = eventBlocksForGrid.filter((bl) => bl.calendar_id === pracId && bl.date === dateStr);
    const candBusy = practitionerWallBusyIntervalsForCandidateAtSlot(b, targetStartMins, serviceMap);
    const invalid =
      targetStartMins < dayStartMin ||
      endMin > dayEndMin ||
      appointmentWindowCollides(
        targetStartMins,
        endMin,
        pracId,
        dateStr,
        b.id,
        bookings,
        blocks,
        serviceMap,
        pracClassBlocks,
        pracEventBlocks,
        resourceParentById,
        { ignoreBookings: true, candidatePractitionerBusy: candBusy },
      );
    const pracName = filteredPractitioners.find((p) => p.id === pracId)?.name ?? 'Staff';
    const timeLabel = minutesToTime(targetStartMins);
    const sameColumn = resolveBookingColumnId(b, resourceParentById) === pracId && b.booking_date === dateStr;
    const label = sameColumn ? `Move to ${timeLabel}` : `Move to ${pracName} · ${timeLabel}`;
    setCalendarDragPreview({ label, invalid });
    setCalendarDragTarget({ pracId, startMin: targetStartMins, endMin, invalid });
  }

  function handleDragCancel(_e: DragCancelEvent) {
    clearCalendarDragUi();
  }

  function handleDragEnd(e: DragEndEvent) {
    const b = e.active.data.current?.booking as Booking | undefined;
    const bl = e.active.data.current?.block as CalendarBlock | undefined;
    const over = e.over;
    const target = calendarDragTargetRef.current;
    clearCalendarDragUi();
    if ((!b && !bl) || !over?.data?.current) return;
    if (target?.invalid) {
      addToast('That time is not available', 'error');
      return;
    }
    const { pracId, dateStr, slotStartMins } = over.data.current as {
      pracId: string;
      dateStr: string;
      slotStartMins: number;
    };
    const targetStartMins = target?.startMin ?? slotStartMins;
    const newTime = minutesToTime(targetStartMins);
    if (bl) {
      if (
        bl.block_date === dateStr &&
        columnIdForBlock(bl) === pracId &&
        bl.start_time.slice(0, 5) === newTime
      ) {
        return;
      }
      void patchBlockMove(bl, dateStr, newTime, pracId);
      return;
    }
    if (!b) return;
    if (
      b.booking_date === dateStr &&
      resolveBookingColumnId(b, resourceParentById) === pracId &&
      b.booking_time.slice(0, 5) === newTime
    ) {
      return;
    }
    if (!['Pending', 'Booked', 'Confirmed', 'Seated'].includes(b.status)) return;
    if (b.resource_id) return;
    void patchBookingMove(b, dateStr, newTime, pracId);
  }

  const beginAppointmentResize = useCallback(
    (booking: Booking) => (downEvent: ReactPointerEvent<HTMLSpanElement>) => {
      if (!['Pending', 'Booked', 'Confirmed', 'Seated'].includes(booking.status) || booking.resource_id) return;
      downEvent.stopPropagation();
      downEvent.preventDefault();
      if (downEvent.pointerType === 'mouse' && downEvent.button !== 0) return;

      const pointerId = downEvent.pointerId;
      const startY = downEvent.clientY;
      const startM = timeToMinutes(booking.booking_time.slice(0, 5));
      const dur0 = bookingDurationMinutes(booking, serviceMap);
      const endM0 = startM + dur0;
      const minEnd = startM + SLOT_MINUTES;
      const gridEndMax = endHour * 60;
      const target = downEvent.currentTarget;

      setResizeVisual({ bookingId: booking.id, deltaYPx: 0 });
      setResizePreviewEnd({ bookingId: booking.id, endHm: minutesToTime(endM0) });

      /** Max / min pointer delta (px) so implied end stays in [minEnd, gridEndMax]. */
      const deltaYMin = ((minEnd - endM0) / SLOT_MINUTES) * SLOT_HEIGHT;
      const deltaYMax = ((gridEndMax - endM0) / SLOT_MINUTES) * SLOT_HEIGHT;

      const clampDeltaY = (clientY: number) => {
        const raw = clientY - startY;
        return Math.max(deltaYMin, Math.min(deltaYMax, raw));
      };

      /** Continuous end (minutes); used while dragging for smooth height. */
      const endMinutesFromClientY = (clientY: number) => {
        const dY = clampDeltaY(clientY);
        return endM0 + (dY / SLOT_HEIGHT) * SLOT_MINUTES;
      };

      const applyFromClientY = (clientY: number) => {
        const dY = clampDeltaY(clientY);
        const endFloat = endM0 + (dY / SLOT_HEIGHT) * SLOT_MINUTES;
        setResizeVisual({ bookingId: booking.id, deltaYPx: dY });
        setResizePreviewEnd({
          bookingId: booking.id,
          endHm: minutesToTime(Math.round(endFloat)),
        });
      };

      try {
        target.setPointerCapture(pointerId);
      } catch {
        /* ignore */
      }

      const onMove = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        ev.preventDefault();
        applyFromClientY(ev.clientY);
      };

      const finish = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        try {
          target.releasePointerCapture(pointerId);
        } catch {
          /* ignore */
        }
        const endFloat = endMinutesFromClientY(ev.clientY);
        const committedEndMin = Math.min(gridEndMax, Math.max(minEnd, Math.round(endFloat)));
        const endStr = minutesToTime(committedEndMin);
        setResizeVisual(null);
        setResizePreviewEnd(null);
        if (committedEndMin === endM0) return;
        justResizedBookingIdRef.current = booking.id;
        window.setTimeout(() => {
          if (justResizedBookingIdRef.current === booking.id) justResizedBookingIdRef.current = null;
        }, 220);
        void patchBookingResize(booking, endStr);
      };

      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
    },
    [endHour, patchBookingResize, serviceMap],
  );

  const beginBlockResize = useCallback(
    (block: CalendarBlock) => (downEvent: ReactPointerEvent<HTMLSpanElement>) => {
      if (!isManualEditableBlock(block)) return;
      downEvent.stopPropagation();
      downEvent.preventDefault();
      if (downEvent.pointerType === 'mouse' && downEvent.button !== 0) return;

      const pointerId = downEvent.pointerId;
      const startY = downEvent.clientY;
      const startM = timeToMinutes(block.start_time.slice(0, 5));
      const endM0 = startM + blockDurationMinutes(block);
      const minEnd = startM + SLOT_MINUTES;
      const gridEndMax = endHour * 60;
      const target = downEvent.currentTarget;

      setBlockResizeVisual({ blockId: block.id, deltaYPx: 0 });
      setBlockResizePreviewEnd({ blockId: block.id, endHm: minutesToTime(endM0) });

      const deltaYMin = ((minEnd - endM0) / SLOT_MINUTES) * SLOT_HEIGHT;
      const deltaYMax = ((gridEndMax - endM0) / SLOT_MINUTES) * SLOT_HEIGHT;

      const clampDeltaY = (clientY: number) => {
        const raw = clientY - startY;
        return Math.max(deltaYMin, Math.min(deltaYMax, raw));
      };

      const endMinutesFromClientY = (clientY: number) => {
        const dY = clampDeltaY(clientY);
        return endM0 + (dY / SLOT_HEIGHT) * SLOT_MINUTES;
      };

      const applyFromClientY = (clientY: number) => {
        const dY = clampDeltaY(clientY);
        const endFloat = endM0 + (dY / SLOT_HEIGHT) * SLOT_MINUTES;
        setBlockResizeVisual({ blockId: block.id, deltaYPx: dY });
        setBlockResizePreviewEnd({
          blockId: block.id,
          endHm: minutesToTime(Math.round(endFloat)),
        });
      };

      try {
        target.setPointerCapture(pointerId);
      } catch {
        /* ignore */
      }

      const onMove = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        ev.preventDefault();
        applyFromClientY(ev.clientY);
      };

      const finish = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        try {
          target.releasePointerCapture(pointerId);
        } catch {
          /* ignore */
        }
        const endFloat = endMinutesFromClientY(ev.clientY);
        const committedEndMin = Math.min(gridEndMax, Math.max(minEnd, Math.round(endFloat)));
        const endStr = minutesToTime(committedEndMin);
        setBlockResizeVisual(null);
        setBlockResizePreviewEnd(null);
        if (committedEndMin === endM0) return;
        justResizedBlockIdRef.current = block.id;
        window.setTimeout(() => {
          if (justResizedBlockIdRef.current === block.id) justResizedBlockIdRef.current = null;
        }, 220);
        void patchBlockResize(block, endStr);
      };

      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
    },
    [endHour, patchBlockResize],
  );

  const timeLabels = Array.from({ length: TOTAL_SLOTS + 1 }, (_, i) => {
    const mins = startHour * 60 + i * SLOT_MINUTES;
    return timelineMinutesToTime(mins);
  });

  const [calendarClockTick, setCalendarClockTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setCalendarClockTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  /** Horizontal "now" indicator for day view when browsing today's date. */
  const dayViewNowLineTop = useMemo(() => {
    if (viewMode !== 'day') return null;
    void calendarClockTick;
    const t = new Date();
    const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    if (date !== iso) return null;
    const nowMins = t.getHours() * 60 + t.getMinutes() + t.getSeconds() / 60;
    const offset = nowMins - startHour * 60;
    const gridMins = TOTAL_SLOTS * SLOT_MINUTES;
    if (offset < 0 || offset > gridMins) return null;
    return (offset / SLOT_MINUTES) * SLOT_HEIGHT;
  }, [viewMode, date, startHour, TOTAL_SLOTS, calendarClockTick]);

  const bookingsMatchingFilters = useMemo(() => {
    return bookings.filter((b) => {
      if (calendarFilterIds !== null) {
        const colId = resolveBookingColumnId(b, resourceParentById);
        if (!colId || !calendarFilterIds.includes(colId)) return false;
      }
      if (!bookingMatchesCalendarStatusFilter(b, filterStatus)) return false;
      return true;
    });
  }, [bookings, calendarFilterIds, filterStatus, resourceParentById]);

  /** Toolbar + status counts: team-column bookings only (matches day/week grid), scoped to the visible period - not the 6-week fetch padding in month view. */
  const bookingsForToolbarStats = useMemo(() => {
    return bookingsMatchingFilters.filter((b) => {
      if (!resolveBookingColumnId(b, resourceParentById)) return false;
      if (viewMode === 'day') return b.booking_date === date;
      if (viewMode === 'week') {
        const weekEnd = addCalendarDays(weekStart, 6);
        return b.booking_date >= weekStart && b.booking_date <= weekEnd;
      }
      return b.booking_date.slice(0, 7) === monthAnchor.slice(0, 7);
    });
  }, [bookingsMatchingFilters, viewMode, date, weekStart, monthAnchor, resourceParentById]);

  const activeToolbarBookings = bookingsForToolbarStats.filter(
    (b) => !['Cancelled', 'No-Show'].includes(b.status),
  );
  const confirmedCount = bookingsForToolbarStats.filter((b) => b.status === 'Confirmed').length;
  const bookedCount = bookingsForToolbarStats.filter((b) => b.status === 'Booked').length;
  const completedCount = bookingsForToolbarStats.filter((b) => b.status === 'Completed').length;

  const calendarFilterCount =
    (calendarFilterIds === null ? 0 : 1) +
    (filterStatus !== 'all' ? 1 : 0) +
    (visibleLinkedColumnIds.length > 0 ? 1 : 0);
  const calendarControlsLabel = calendarFilterCount > 0 ? `Filter (${calendarFilterCount})` : 'Filter';
  const calendarSummaryContent = (
    <div
      className="flex flex-wrap items-center gap-1 text-[11px] sm:gap-1.5 sm:text-xs"
      title="Bookings on a team column in the visible date range (day, week, or calendar month). Excludes padding weeks around month view."
    >
      <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200/90 bg-slate-50 px-1.5 py-0.5 font-medium text-slate-800">
        <span className="font-normal text-slate-500">On grid</span>
        <span className="tabular-nums">{activeToolbarBookings.length}</span>
      </span>
      <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200/90 bg-slate-50 px-1.5 py-0.5 font-medium text-slate-800">
        <span className="font-normal text-slate-500">Booked</span>
        <span className="tabular-nums text-sky-800">{bookedCount}</span>
      </span>
      <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200/90 bg-slate-50 px-1.5 py-0.5 font-medium text-slate-800">
        <span className="font-normal text-slate-500">Confirmed</span>
        <span className="tabular-nums text-indigo-800">{confirmedCount}</span>
      </span>
      <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200/90 bg-slate-50 px-1.5 py-0.5 font-medium text-slate-800">
        <span className="font-normal text-slate-500">Completed</span>
        <span className="tabular-nums text-slate-600">{completedCount}</span>
      </span>
    </div>
  );

  const calendarFilterPanel = (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Calendars</p>
        <CalendarColumnsChecklist
          columns={columnPractitioners.map((p) => ({ id: p.id, name: p.name }))}
          myCalendarIds={myCalendarIds}
          value={visibleCalendarIdsState}
          onChange={setVisibleCalendarIdsState}
          maxHeightClass="max-h-56"
        />
      </div>

      {linkedColumns.length > 0 ? (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Linked venues
          </p>
          <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
            {[
              ...new Map(linkedColumns.map((c) => [c.venueId, c.venueName])).entries(),
            ].map(([venueId, venueName]) => (
              <div key={venueId}>
                <p className="px-1 py-0.5 text-[11px] font-semibold text-slate-600">
                  {venueName}
                </p>
                <div className="space-y-0.5">
                  {linkedColumns
                    .filter((c) => c.venueId === venueId)
                    .map((c) => {
                      const checked = visibleLinkedColumnIds.includes(c.key);
                      return (
                        <label
                          key={c.key}
                          className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5 text-sm text-slate-800"
                        >
                          <input
                            type="checkbox"
                            className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                            checked={checked}
                            onChange={(e) => {
                              setVisibleLinkedColumnIds((cur) => {
                                const next = new Set(cur);
                                if (e.target.checked) next.add(c.key);
                                else next.delete(c.key);
                                return [...next];
                              });
                            }}
                          />
                          <span className="truncate">
                            {c.practitionerName}
                            {c.practitionerActive ? '' : ' (inactive)'}
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</p>
        <div className="flex flex-wrap gap-1.5">
          {CALENDAR_STATUS_FILTERS.map((status) => (
            <button
              key={status.value}
              type="button"
              onClick={() => setFilterStatus(status.value)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors duration-150 ease-out ${
                filterStatus === status.value
                  ? 'bg-brand-600 text-white shadow-sm ring-1 ring-brand-600/20'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-800'
              }`}
            >
              {status.label}
            </button>
          ))}
        </div>
      </div>

      {calendarFilterCount > 0 ? (
        <button
          type="button"
          onClick={() => {
            setVisibleCalendarIdsState(null);
            setVisibleLinkedColumnIds([]);
            setFilterStatus('all');
          }}
          className="text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );

  const weekDays = useMemo(() => weekDatesFrom(weekStart), [weekStart]);

  const monthCells = useMemo(() => {
    const first = new Date(`${startOfMonth(monthAnchor)}T12:00:00`);
    const startPad = first.getDay();
    const from = addCalendarDays(startOfMonth(monthAnchor), -startPad);
    return Array.from({ length: 42 }, (_, i) => addCalendarDays(from, i));
  }, [monthAnchor]);

  /** Week strip: class sessions use instructor columns; events with a calendar column are on the grid. */
  const stripScheduleBlocksByDate = useMemo(
    () =>
      groupScheduleBlocksByDate(
        scheduleBlocks.filter(
          (b) =>
            b.kind !== 'class_session' &&
            b.kind !== 'resource_booking' &&
            !(b.kind === 'event_ticket' && b.calendar_id),
        ),
      ),
    [scheduleBlocks],
  );

  const stripHasBlocks = useMemo(() => {
    for (const [, arr] of stripScheduleBlocksByDate) {
      if (arr.some((b) => b.status !== 'Cancelled')) return true;
    }
    return false;
  }, [stripScheduleBlocksByDate]);

  const showWeekStripRow = showEventsColumn && stripHasBlocks;

  const monthDayScheduleCounts = useMemo(
    () =>
      buildMonthDayScheduleCounts(
        bookingsMatchingFilters,
        scheduleBlocksInVisibleColumns,
        monthCells,
        'all',
      ),
    [bookingsMatchingFilters, scheduleBlocksInVisibleColumns, monthCells],
  );

  /**
   * Linked bookings per day on the columns the user has opted into (§8.2).
   * Kept adjacent to `monthDayScheduleCounts` — never merged into the native
   * totals — and surfaced in the month grid as a separate desaturated marker.
   */
  const monthLinkedCountByDate = useMemo(
    () =>
      linkedBookingCountByDate(
        visibleLinkedColumns.map((c) => ({
          venueId: c.venueId,
          practitionerId: c.practitionerId,
        })),
        [...linkedVenueById.values()].map((v) => ({
          venueId: v.venueId,
          bookings: v.bookings,
        })),
      ),
    [visibleLinkedColumns, linkedVenueById],
  );

  const openBookingDetail = useCallback((id: string, anchor?: { x: number; y: number }) => {
    if (justResizedBookingIdRef.current === id) return;
    setClassInstanceSheet(null);
    setClassInstanceAnchor(null);
    setEventInstanceSheet(null);
    setDetailBookingId(id);
    setDetailBookingAnchor(anchor ?? null);
  }, []);

  const openClassInstanceDetail = useCallback((b: ScheduleBlockDTO, anchor?: { x: number; y: number }) => {
    if (!b.class_instance_id) return;
    setDetailBookingId(null);
    setDetailBookingAnchor(null);
    setEventInstanceSheet(null);
    setClassInstanceSheet({ instanceId: b.class_instance_id, block: b });
    setClassInstanceAnchor(anchor ?? null);
  }, []);

  const openEventInstanceDetail = useCallback((b: ScheduleBlockDTO) => {
    if (!b.experience_event_id) return;
    setDetailBookingId(null);
    setDetailBookingAnchor(null);
    setClassInstanceSheet(null);
    setClassInstanceAnchor(null);
    setEventInstanceSheet({ eventId: b.experience_event_id, block: b });
  }, []);

  const calendarBookingDetailSnapshot = useMemo((): BookingDetailPanelSnapshot | null => {
    if (!detailBookingId) return null;
    const b = bookings.find((x) => x.id === detailBookingId);
    if (!b) return null;
    return bookingDetailPanelSnapshotFromListRow({
      ...b,
      guest_name: b.guest_name,
      inferred_booking_model: inferBookingRowModel(b),
      service_name: (() => {
        const serviceId = serviceIdForBooking(b);
        return serviceId ? serviceMap.get(serviceId)?.name ?? null : null;
      })(),
    });
  }, [detailBookingId, bookings, serviceMap]);

  useEffect(() => {
    if (bookings.length === 0) return;
    const ids = bookings
      .filter((b) => b.status !== 'Cancelled')
      .slice(0, 28)
      .map((b) => b.id);
    const scheduleIdle =
      typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback.bind(window)
        : (cb: IdleRequestCallback) =>
            window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 60);
    const idleHandle = scheduleIdle(() => {
      void warmIdsWithConcurrency(ids, prefetchBookingDetail);
    });
    return () => {
      if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleHandle);
      } else {
        window.clearTimeout(idleHandle);
      }
    };
  }, [bookings, prefetchBookingDetail]);

  return (
    <div className="flex min-w-[320px] flex-col">
      <div className="flex-shrink-0 space-y-3 pb-3">
        {realtimeConnected === false && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Updates may be delayed. Reconnecting&hellip;
          </div>
        )}
        <PractitionerCalendarToolbar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onNavigateDay={navigateDay}
          onDateChange={navigateDayDirect}
          date={date}
          todayIso={initialIsoDate}
          weekStart={weekStart}
          monthAnchor={monthAnchor}
          startHour={startHour}
          endHour={endHour}
          onTimeRangeChange={handleTimeRangeChange}
          onRefresh={() => {
            void fetchData();
            void loadLinkedData();
          }}
          onNewBooking={() => {
            setPrefillDate(viewMode === 'day' ? date : undefined);
            setPrefillTime(undefined);
            setPrefillPractitionerId(
              calendarFilterIds?.length === 1 ? calendarFilterIds[0] : undefined,
            );
            setStaffBookingModal('new');
          }}
          onWalkIn={() => {
            setPrefillDate(viewMode === 'day' ? date : undefined);
            setPrefillTime(undefined);
            setPrefillPractitionerId(
              calendarFilterIds?.length === 1 ? calendarFilterIds[0] : undefined,
            );
            setStaffBookingModal('walk-in');
          }}
          controlsPanel={calendarFilterPanel}
          controlsLabel={calendarControlsLabel}
          summaryContent={calendarSummaryContent}
          scheduleUndo={{
            available: Boolean(lastScheduleEditUndo),
            pending: scheduleUndoPending,
            onUndo: () => void undoLastScheduleEdit(),
          }}
          liveState={realtimeConnected === false ? 'reconnecting' : 'live'}
          searchActive={guestToolbarSearchQuery.trim().length > 0}
          searchAriaLabel="Search contacts"
          searchPanel={(
            <OperationsToolbarGuestSearchPanel
              onQueryChange={setGuestToolbarSearchQuery}
              initialDate={viewMode === 'day' ? date : undefined}
              preselectedPractitionerId={
                calendarFilterIds?.length === 1 ? calendarFilterIds[0] : undefined
              }
              onBookingCreated={() => {
                void fetchData();
                void loadLinkedData();
              }}
            />
          )}
        />
      </div>

      {fetchError && (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{fetchError}</span>
          <button type="button" onClick={() => setFetchError(null)} className="ml-2 text-red-400 hover:text-red-600">
            &times;
          </button>
        </div>
      )}

      {loading ? (
        <div className="min-h-[40vh] py-2">
          <DashboardCalendarSkeleton />
        </div>
      ) : filteredPractitioners.length === 0 ? (
        <div className="flex min-h-[40vh] items-center justify-center px-4">
          <div className="w-full max-w-md">
            <EmptyState
              title="No calendars yet"
              description="Add team calendars in Calendar availability to see appointments on the grid."
            />
          </div>
        </div>
      ) : viewMode === 'month' ? (
        <MonthScheduleGrid
          monthAnchor={monthAnchor}
          monthCells={monthCells}
          monthDayScheduleCounts={monthDayScheduleCounts}
          linkedCountByDate={monthLinkedCountByDate}
          showMergedFeeds={showMergedFeeds}
          openingHours={openingHours}
          venueTimezone={venueTimezone}
          onSelectDay={(cell) => {
            clearTimeRangeOverridesForDayChange();
            setDate(cell);
            setWeekStart(cell);
            setMonthAnchor(cell);
            setViewMode('day');
          }}
        />
      ) : viewMode === 'week' ? (
        <div className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-900/[0.06] ring-1 ring-slate-900/[0.03]">
          <HorizontalScrollHint />
          <div className="overflow-x-auto [overflow-y:clip] [touch-action:pan-x_pan-y] [-webkit-overflow-scrolling:touch]">
            <div className="min-w-[920px]">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="sticky top-0 z-20 border-b border-slate-300 bg-gradient-to-br from-white via-slate-50 to-slate-100/90 shadow-sm shadow-slate-900/5">
                  <th className="sticky left-0 top-0 z-30 bg-gradient-to-br from-white via-slate-50 to-slate-100/95 px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-slate-500 shadow-[4px_0_14px_rgba(15,23,42,0.05)]">
                    Team
                  </th>
                  {weekDays.map((d) => {
                    const isToday = d === new Date().toISOString().slice(0, 10);
                    return (
                      <th
                        key={d}
                        className={`sticky top-0 z-20 border-l border-slate-300 px-2 py-2 text-center ${
                          isToday ? 'bg-brand-50/90 ring-1 ring-inset ring-brand-100' : ''
                        }`}
                      >
                        <div className={`text-[11px] font-semibold uppercase tracking-wide ${isToday ? 'text-brand-700' : 'text-slate-500'}`}>
                          {WEEK_SHORT[new Date(`${d}T12:00:00`).getDay()]}
                        </div>
                        <div className={`text-sm font-bold tabular-nums ${isToday ? 'text-brand-700' : 'text-slate-800'}`}>
                          {d.slice(8, 10)}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filteredPractitioners.map((prac) => (
                  <tr key={prac.id} className="border-b border-slate-100 transition-colors hover:bg-slate-50/70">
                    <td className="sticky left-0 bg-white/95 px-3 py-2 font-semibold text-slate-900 shadow-[4px_0_14px_rgba(15,23,42,0.035)]">
                      {prac.name}
                    </td>
                    {weekDays.map((d) => {
                      const dayBookings = bookingsForPractitioner(prac.id, d);
                      const dayClassBlocks = classBlocksForGrid.filter(
                        (b) => b.calendar_id === prac.id && b.date === d,
                      );
                      const dayEventBlocks = eventBlocksForGrid.filter(
                        (b) => b.calendar_id === prac.id && b.date === d,
                      );
                      return (
                        <td key={d} className="border-l border-slate-200 align-top px-1 py-2">
                          <div className="flex min-h-[80px] flex-col gap-1">
                            {dayBookings.map((b) => {
                              const p = bookingCalendarBlockStyle(b);
                              return (
                                <button
                                  key={b.id}
                                  type="button"
                                  onClick={(e) => openBookingDetail(b.id, { x: e.clientX, y: e.clientY })}
                                  {...bindDetailPrefetchHandlers(b.id, prefetchBookingDetail)}
                                  className="rounded-xl border border-solid px-2.5 py-2 text-left text-xs shadow-sm ring-1 ring-white/70 transition-shadow hover:shadow-lg hover:shadow-slate-900/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                                  style={bookingBlockCardStyle(p)}
                                >
                                  <div className="flex min-w-0 flex-col gap-1">
                                    <div className="min-w-0">
                                      <div className="truncate font-bold">{b.guest_name}</div>
                                      <div className="mt-0.5 text-[10px] font-medium text-slate-600">
                                        {b.booking_time.slice(0, 5)}
                                      </div>
                                    </div>
                                    <CalendarBookingStatusBadge b={b} />
                                  </div>
                                </button>
                              );
                            })}
                            {dayClassBlocks.map((cb) => {
                              const booked =
                                cb.class_booked_spots != null && cb.class_capacity != null
                                  ? `${cb.class_booked_spots}/${cb.class_capacity} booked`
                                  : cb.class_booked_spots != null
                                    ? `${cb.class_booked_spots} booked`
                                    : null;
                              const accent = cb.accent_colour ?? '#6366f1';
                              return (
                                <button
                                  key={cb.id}
                                  type="button"
                                  onClick={(e) => openClassInstanceDetail(cb, { x: e.clientX, y: e.clientY })}
                                  className="rounded-lg border border-slate-200 bg-gradient-to-br from-white to-slate-50 px-2 py-1 text-left text-xs shadow-sm ring-1 ring-white/70 transition-shadow hover:shadow-md"
                                  style={{ borderLeftWidth: 3, borderLeftColor: accent }}
                                >
                                  <div className="font-semibold text-slate-900">{cb.title}</div>
                                  {booked ? <div className="text-[10px] text-slate-600">{booked}</div> : null}
                                  <div className="text-[10px] text-slate-500">
                                    {cb.start_time.slice(0, 5)}–{cb.end_time.slice(0, 5)}
                                  </div>
                                </button>
                              );
                            })}
                            {dayEventBlocks.map((eb) => {
                              const accent = eb.accent_colour ?? '#F59E0B';
                              const uptake = formatEventUptakeLine(eb);
                              const emptyOccurrence =
                                (eb.event_booking_count ?? (eb.booking_id ? 1 : 0)) === 0;
                              const shell = eb.experience_event_id ? emptyOccurrence : !eb.booking_id;
                              const inner = (
                                <div
                                  className={`rounded-lg border px-2 py-1 text-left text-xs shadow-sm ring-1 ring-white/70 transition-shadow hover:shadow-md ${
                                    shell ? 'border-dashed border-amber-200 bg-amber-50/80' : 'border-slate-200 bg-gradient-to-br from-white to-slate-50'
                                  }`}
                                  style={{ borderLeftWidth: 3, borderLeftColor: accent }}
                                >
                                  <div className="font-semibold text-slate-900">{eb.title}</div>
                                  {uptake ? (
                                    <div className="text-[10px] text-slate-600">{uptake}</div>
                                  ) : null}
                                  <div className="text-[10px] text-slate-500">
                                    {eb.start_time.slice(0, 5)}–{eb.end_time.slice(0, 5)}
                                  </div>
                                </div>
                              );
                              if (eb.experience_event_id) {
                                return (
                                  <button
                                    key={eb.id}
                                    type="button"
                                    onClick={() => openEventInstanceDetail(eb)}
                                    className="block w-full text-left"
                                  >
                                    {inner}
                                  </button>
                                );
                              }
                              if (eb.booking_id) {
                                return (
                                  <button
                                    key={eb.id}
                                    type="button"
                                    onClick={(e) => openBookingDetail(eb.booking_id!, { x: e.clientX, y: e.clientY })}
                                    className="block w-full text-left"
                                  >
                                    {inner}
                                  </button>
                                );
                              }
                              return (
                                <Link key={eb.id} href="/dashboard/event-manager" className="block">
                                  {inner}
                                </Link>
                              );
                            })}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {visibleLinkedColumns.map((col) => (
                  <tr key={col.key} className="border-b border-slate-100 bg-slate-50/40">
                    <td className="sticky left-0 bg-slate-50/95 px-3 py-2 shadow-[4px_0_14px_rgba(15,23,42,0.035)]">
                      <span className="font-semibold text-slate-600">{col.practitionerName}</span>
                      <span className="mt-0.5 block text-[10px] font-medium text-slate-400">
                        Linked · {col.venueName}
                      </span>
                      {col.action === 'create_edit_cancel' ? (
                        <button
                          type="button"
                          onClick={() => {
                            const v = linkedVenueById.get(col.venueId);
                            if (v)
                              setLinkedCreating({
                                venue: v,
                                practitionerId: col.practitionerId,
                              });
                          }}
                          className="mt-1 text-[10px] font-semibold text-brand-600 hover:underline"
                        >
                          + New booking
                        </button>
                      ) : null}
                    </td>
                    {weekDays.map((d) => {
                      const dayBookings = linkedBookingsFor(col, d);
                      return (
                        <td key={d} className="border-l border-slate-200 align-top px-1 py-2">
                          <div className="flex min-h-[80px] flex-col gap-1">
                            {dayBookings.map((b) => {
                              const clickable = linkedBookingIsClickable(col, b);
                              const detail =
                                col.visibility === 'time_only'
                                  ? `${col.venueName} — busy`
                                  : b.guestName ?? b.serviceName ?? 'Booking';
                              const timeLabel = `${b.bookingTime.slice(0, 5)}${
                                b.bookingEndTime
                                  ? `–${b.bookingEndTime.slice(0, 5)}`
                                  : ''
                              }`;
                              const inner = (
                                <div
                                  className="rounded-lg border border-slate-300 bg-white/70 px-2 py-1 text-left text-[11px] text-slate-500 saturate-50"
                                  style={{ borderLeftWidth: 3, borderLeftColor: '#94a3b8' }}
                                >
                                  <div className="font-semibold tabular-nums text-slate-600">
                                    {timeLabel}
                                  </div>
                                  <div className="truncate">{detail}</div>
                                  {col.visibility !== 'time_only' ? (
                                    <div className="mt-0.5 text-[9px] uppercase tracking-wide text-slate-400">
                                      {b.status}
                                    </div>
                                  ) : null}
                                </div>
                              );
                              return (
                                <button
                                  key={b.id}
                                  type="button"
                                  onClick={() => openLinkedBooking(col, b)}
                                  className="block w-full text-left transition hover:opacity-90"
                                  title={
                                    clickable
                                      ? `Edit in ${col.venueName}`
                                      : `View detail · ${col.venueName}`
                                  }
                                >
                                  {inner}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {showWeekStripRow ? (
                  <WeekScheduleCdeStrip
                    weekDays={weekDays}
                    blocksByDate={stripScheduleBlocksByDate}
                    onBookingClick={openBookingDetail}
                    onClassInstanceClick={openClassInstanceDetail}
                    onEventInstanceClick={openEventInstanceDetail}
                  />
                ) : null}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      ) : (
        <div ref={timelineRootRef} className="flex min-w-0 w-full flex-col">
          <DndContext
            sensors={sensors}
            collisionDetection={calendarGridCollisionDetection}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragCancel={handleDragCancel}
            onDragEnd={handleDragEnd}
          >
            <div
              ref={scrollRef}
              className={`min-w-0 w-full [touch-action:pan-x_pan-y] overflow-x-auto [overflow-y:clip] overscroll-x-contain [-webkit-overflow-scrolling:touch] rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-900/[0.06] ring-1 ring-slate-900/[0.03] ${
                mousePanning ? 'cursor-grabbing' : 'cursor-grab'
              }`}
              onMouseDown={handleCalendarMouseDown}
              onClickCapture={handleCalendarClickCapture}
          >
            <div className="relative flex min-w-full">
              {dayViewNowLineTop != null ? (
                <div
                  className="pointer-events-none absolute left-0 right-0 z-[25]"
                  style={{ top: 58 + dayViewNowLineTop }}
                  aria-hidden
                >
                  <div className="flex items-center">
                    <div className="flex w-14 shrink-0 justify-center sm:w-16">
                      <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-white shadow-md shadow-brand-600/20 ring-2 ring-white">
                        Now
                      </span>
                    </div>
                    <div className="h-0.5 flex-1 bg-gradient-to-r from-brand-600/80 via-brand-400/55 to-transparent shadow-[0_0_12px_rgba(59,130,246,0.25)]" />
                  </div>
                </div>
              ) : null}
              <div className="w-14 flex-shrink-0 border-r border-slate-300 bg-gradient-to-r from-slate-100/90 to-slate-50/80 shadow-[4px_0_14px_rgba(15,23,42,0.05)] sm:w-16">
                <div
                  className="min-h-[58px] rounded-tl-xl border-b border-slate-300 bg-gradient-to-br from-white via-slate-50 to-slate-100/80"
                  aria-hidden
                />
                <div className="relative" style={{ height: TOTAL_SLOTS * SLOT_HEIGHT }}>
                  {timeLabels.map((t, i) =>
                    i % 4 === 0 ? (
                      <div
                        key={t}
                        className="absolute left-0 flex w-full justify-end pr-1.5"
                        style={{ top: i * SLOT_HEIGHT, transform: 'translateY(-50%)' }}
                      >
                        <span className="rounded-full border border-slate-200/80 bg-white/90 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-slate-600 shadow-sm shadow-slate-900/5">
                          {t}
                        </span>
                      </div>
                    ) : null,
                  )}
                </div>
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div
                  className="sticky top-0 z-20 flex w-full divide-x divide-slate-300 rounded-tr-xl border-b border-slate-300 border-l border-slate-300 bg-gradient-to-br from-white via-slate-50 to-slate-100/90 shadow-sm shadow-slate-900/5"
                  role="row"
                  aria-label="Calendar columns"
                >
                  {filteredPractitioners.map((prac) => {
                    const hoursLine = formatWorkingHoursLineForDate(prac.working_hours, date, venueTimezone);
                    return (
                      <div
                        key={`hdr-${prac.id}`}
                        className="flex min-h-[58px] min-w-[min(16rem,calc(100vw-5.5rem))] flex-1 flex-col items-center justify-center gap-0.5 px-3 py-1.5 sm:min-w-[240px]"
                      >
                        <span className="truncate text-center text-sm font-semibold text-slate-900" title={prac.name}>
                          {prac.name}
                        </span>
                        <span
                          className="line-clamp-2 w-full text-center text-[11px] leading-tight text-slate-600"
                          title={hoursLine}
                        >
                          {hoursLine}
                        </span>
                      </div>
                    );
                  })}
                  {showMergedFeeds &&
                  showEventsColumn &&
                  scheduleBlocks.some(
                    (b) => b.kind === 'event_ticket' && !b.calendar_id && b.status !== 'Cancelled',
                  ) ? (
                    <div className="flex min-h-[58px] min-w-[min(16rem,calc(100vw-5.5rem))] flex-1 flex-col items-center justify-center gap-0.5 px-3 py-1.5 sm:min-w-[240px]">
                      <span className="truncate text-center text-sm font-semibold text-slate-900">
                        Events (unassigned)
                      </span>
                      <span className="text-center text-[11px] leading-tight text-slate-500">—</span>
                    </div>
                  ) : null}
                  {visibleLinkedColumns.map((col) => (
                    <div
                      key={`hdr-${col.key}`}
                      className="flex min-h-[58px] min-w-[min(16rem,calc(100vw-5.5rem))] flex-1 flex-col items-center justify-center gap-0.5 bg-slate-50/70 px-3 py-1.5 sm:min-w-[240px]"
                    >
                      <span
                        className="truncate text-center text-sm font-semibold text-slate-600"
                        title={`${col.practitionerName} · ${col.venueName}`}
                      >
                        {col.practitionerName}
                      </span>
                      <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-200/70 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" aria-hidden />
                        <span className="truncate">Linked · {col.venueName}</span>
                      </span>
                      {col.action === 'create_edit_cancel' ? (
                        <button
                          type="button"
                          onClick={() => {
                            const v = linkedVenueById.get(col.venueId);
                            if (v)
                              setLinkedCreating({
                                venue: v,
                                practitionerId: col.practitionerId,
                              });
                          }}
                          className="mt-0.5 text-[10px] font-semibold text-brand-600 hover:underline"
                        >
                          + New booking
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="flex w-full min-w-0 border-l border-slate-300">
              {filteredPractitioners.map((prac) => {
                const pracBookings = bookingsForPractitioner(prac.id, date);
                const pracClassBlocks = classBlocksForGrid.filter(
                  (b) => b.calendar_id === prac.id && b.date === date,
                );
                const pracEventBlocks = eventBlocksForGrid.filter(
                  (b) => b.calendar_id === prac.id && b.date === date,
                );
                const pracBlocks = blocks.filter(
                  (bl) =>
                    columnIdForBlock(bl) === prac.id &&
                    bl.block_date === date &&
                    bl.block_type !== 'class_session',
                );
                return (
                  <div key={prac.id} className="min-w-[min(16rem,calc(100vw-5.5rem))] flex-1 border-r border-slate-300 last:border-r-0 sm:min-w-[240px]">
                    <div className="relative" style={{ height: TOTAL_SLOTS * SLOT_HEIGHT }}>
                      {timeLabels.map((_, i) => {
                        const slotStartMins = startHour * 60 + i * SLOT_MINUTES;
                        return (
                          <div
                            key={i}
                            className={`absolute left-0 w-full border-t ${calendarGridLineClass(slotStartMins)}`}
                            style={{ top: i * SLOT_HEIGHT }}
                          />
                        );
                      })}

                      {Array.from({ length: TOTAL_SLOTS }, (_, i) => {
                        const slotStartMins = startHour * 60 + i * SLOT_MINUTES;
                        const occ = slotOccupied(
                          slotStartMins,
                          bookings,
                          blocks,
                          prac.id,
                          date,
                          serviceMap,
                          pracClassBlocks,
                          pracEventBlocks,
                          resourceParentById,
                          dragExcludeBookingId,
                          dragExcludeBlockId,
                          { ignoreBookings: dragBooking != null },
                        );
                        const dropId = `drop-${prac.id}-${date}-${slotStartMins}`;
                        return (
                          <DroppableSlotButton
                            key={dropId}
                            id={dropId}
                            pracId={prac.id}
                            dateStr={date}
                            slotStartMins={slotStartMins}
                            top={i * SLOT_HEIGHT}
                            disabled={occ}
                            onEmptyClick={(ev, pid, dstr, t) => {
                              setSlotMenu({
                                pracId: pid,
                                dateStr: dstr,
                                time: t,
                                x: Math.max(8, Math.min(ev.clientX - 72, window.innerWidth - 200)),
                                y: Math.max(8, Math.min(ev.clientY - 8, window.innerHeight - 160)),
                              });
                            }}
                          />
                        );
                      })}

                      {calendarDragTarget && calendarDragTarget.pracId === prac.id ? (
                        <div
                          className={`pointer-events-none absolute left-0 right-0 z-[8] rounded-lg border-x-2 border-b-2 border-t-2 ${
                            calendarDragTarget.invalid
                              ? 'border-amber-500 bg-amber-200/35 ring-1 ring-inset ring-amber-400/50'
                              : 'border-emerald-500 bg-emerald-200/35 ring-1 ring-inset ring-emerald-400/50'
                          }`}
                          style={{
                            top: ((calendarDragTarget.startMin - startHour * 60) / SLOT_MINUTES) * SLOT_HEIGHT,
                            height:
                              ((calendarDragTarget.endMin - calendarDragTarget.startMin) / SLOT_MINUTES) *
                              SLOT_HEIGHT,
                          }}
                          aria-hidden
                        />
                      ) : null}

                      {resourceAvailabilityByPractitioner.get(prac.id)?.map((m, i) => (
                        <div
                          key={`mint-${prac.id}-${i}-${m.resourceName}`}
                          className="pointer-events-none absolute left-1 right-1 z-[5] rounded-md border border-emerald-200/90 bg-emerald-50/90"
                          style={{ top: m.top, height: m.height }}
                          title={`${m.resourceName} — available to book`}
                          aria-hidden
                        />
                      ))}

                      {pracBlocks.map((bl) => {
                        const top = slotTop(bl.start_time);
                        const baseH = Math.max(
                          (minutesBetweenStartAndEnd(bl.start_time, bl.end_time) / SLOT_MINUTES) * SLOT_HEIGHT,
                          SLOT_HEIGHT * 0.5,
                        );
                        const canDrag = isManualEditableBlock(bl);
                        const resizeExtra =
                          blockResizeVisual?.blockId === bl.id ? blockResizeVisual.deltaYPx : 0;
                        const displayEndHm =
                          blockResizePreviewEnd?.blockId === bl.id
                            ? blockResizePreviewEnd.endHm
                            : bl.end_time.slice(0, 5);
                        return (
                          <DraggableBlockShell
                            key={bl.id}
                            block={bl}
                            top={top}
                            height={baseH}
                            heightExtraPx={resizeExtra}
                            canDrag={canDrag}
                          >
                            {(handle) => (
                              <div
                                className="group relative flex h-full min-h-0 flex-row overflow-hidden rounded-lg border border-slate-300 bg-slate-200/90 text-left shadow-sm hover:bg-slate-300/90"
                                style={{ borderLeftWidth: 3, borderLeftColor: '#94a3b8' }}
                              >
                                {canDrag && handle.listeners && handle.attributes ? (
                                  <button
                                    ref={handle.setActivatorNodeRef}
                                    type="button"
                                    data-no-calendar-pan="true"
                                    className="relative z-[2] shrink-0 cursor-grab touch-none bg-black/[0.06] px-0.5 text-[10px] text-slate-500 transition hover:bg-black/[0.1] active:cursor-grabbing"
                                    style={{
                                      width: BOOKING_DRAG_HANDLE_WIDTH_DEFAULT_PX,
                                      minWidth: BOOKING_DRAG_HANDLE_WIDTH_DEFAULT_PX,
                                    }}
                                    aria-label="Drag to move block"
                                    {...handle.listeners}
                                    {...handle.attributes}
                                  >
                                    ⋮⋮
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (justResizedBlockIdRef.current === bl.id) return;
                                    openEditBlockModal(bl);
                                  }}
                                  className={`flex min-h-0 min-w-0 flex-1 flex-col justify-start overflow-hidden px-2.5 py-2 text-left ${
                                    canDrag ? 'pb-[19px]' : ''
                                  }`}
                                  title="Click to edit block"
                                >
                                  <span className="truncate text-[13px] font-extrabold tracking-tight text-slate-900">
                                    Blocked
                                  </span>
                                  {bl.reason ? (
                                    <span className="mt-0.5 block truncate text-[11px] font-medium leading-snug text-slate-600/90">
                                      {bl.reason}
                                    </span>
                                  ) : null}
                                  <span className="mt-0.5 block text-[11px] font-medium leading-snug tabular-nums text-slate-600/90">
                                    {bl.start_time.slice(0, 5)} – {displayEndHm}
                                  </span>
                                </button>
                                {canDrag ? (
                                  <>
                                    {blockResizePreviewEnd?.blockId === bl.id ? (
                                      <span
                                        className="pointer-events-none absolute left-1/2 z-20 max-w-[calc(100%-0.5rem)] -translate-x-1/2 truncate rounded-md bg-slate-900 px-2 py-0.5 text-center text-[10px] font-bold tabular-nums text-white shadow-md"
                                        style={{ bottom: BOOKING_RESERVE_ABOVE_RESIZE_PX }}
                                      >
                                        Until {blockResizePreviewEnd.endHm}
                                      </span>
                                    ) : null}
                                    <span
                                      role="separator"
                                      aria-orientation="horizontal"
                                      aria-label="Drag to change block duration"
                                      data-no-calendar-pan="true"
                                      className="absolute bottom-0 left-0 right-0 z-40 cursor-ns-resize touch-none rounded-b-lg border-t border-white/50 bg-black/[0.08] hover:bg-black/[0.14] active:bg-black/20"
                                      style={{ height: BOOKING_RESIZE_HANDLE_HEIGHT_PX }}
                                      onPointerDown={beginBlockResize(bl)}
                                      onMouseDown={(e) => e.stopPropagation()}
                                    />
                                  </>
                                ) : null}
                              </div>
                            )}
                          </DraggableBlockShell>
                        );
                      })}

                      {pracClassBlocks.map((cb) => {
                        const top = slotTop(cb.start_time);
                        const durMins = Math.max(minutesBetweenStartAndEnd(cb.start_time, cb.end_time), SLOT_MINUTES);
                        const height = slotHeightFromDuration(durMins);
                        const accent = cb.accent_colour ?? '#6366f1';
                        const uptake =
                          cb.class_booked_spots != null && cb.class_capacity != null
                            ? `${cb.class_booked_spots}/${cb.class_capacity} booked`
                            : cb.class_booked_spots != null
                              ? `${cb.class_booked_spots} booked`
                              : null;
                        return (
                          <div
                            key={cb.id}
                            className="absolute left-1 right-1 z-[20]"
                            style={{ top, height }}
                          >
                            <button
                              type="button"
                              onClick={(e) => openClassInstanceDetail(cb, { x: e.clientX, y: e.clientY })}
                              className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white px-1.5 py-1 text-left shadow-sm transition-shadow hover:shadow-md"
                              style={{ borderLeftWidth: 3, borderLeftColor: accent }}
                              title={cb.title}
                            >
                              <span className="truncate text-xs font-semibold text-slate-900">{cb.title}</span>
                              {uptake ? (
                                <span className="truncate text-[10px] font-medium text-slate-600">{uptake}</span>
                              ) : null}
                              <span className="mt-auto text-[10px] text-slate-400">
                                {cb.start_time.slice(0, 5)} – {cb.end_time.slice(0, 5)}
                              </span>
                            </button>
                          </div>
                        );
                      })}

                      {pracEventBlocks.map((eb) => {
                        const top = slotTop(eb.start_time);
                        const durMins = Math.max(minutesBetweenStartAndEnd(eb.start_time, eb.end_time), SLOT_MINUTES);
                        const height = slotHeightFromDuration(durMins);
                        const accent = eb.accent_colour ?? '#F59E0B';
                        const uptake = formatEventUptakeLine(eb);
                        const emptyOccurrence =
                          (eb.event_booking_count ?? (eb.booking_id ? 1 : 0)) === 0;
                        const shell = eb.experience_event_id ? emptyOccurrence : !eb.booking_id;
                        const body = (
                          <>
                            <span className="truncate text-xs font-semibold text-slate-900">{eb.title}</span>
                            {uptake ? (
                              <span className="truncate text-[10px] text-slate-600">{uptake}</span>
                            ) : null}
                            <span className="mt-auto text-[10px] text-slate-400">
                              {eb.start_time.slice(0, 5)} – {eb.end_time.slice(0, 5)}
                            </span>
                          </>
                        );
                        const cardClass = `flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border px-1.5 py-1 text-left shadow-sm transition-shadow hover:shadow-md ${
                          shell ? 'border-dashed border-amber-200 bg-amber-50/90' : 'border-slate-200 bg-white'
                        }`;
                        return (
                          <div
                            key={eb.id}
                            className="absolute left-1 right-1 z-[20]"
                            style={{ top, height }}
                          >
                            {eb.experience_event_id ? (
                              <button
                                type="button"
                                onClick={() => openEventInstanceDetail(eb)}
                                className={cardClass}
                                style={{ borderLeftWidth: 3, borderLeftColor: accent }}
                                title={eb.title}
                              >
                                {body}
                              </button>
                            ) : eb.booking_id ? (
                              <button
                                type="button"
                                onClick={(e) => openBookingDetail(eb.booking_id!, { x: e.clientX, y: e.clientY })}
                                className={cardClass}
                                style={{ borderLeftWidth: 3, borderLeftColor: accent }}
                                title={eb.title}
                              >
                                {body}
                              </button>
                            ) : (
                              <Link
                                href="/dashboard/event-manager"
                                className={`${cardClass} border-dashed border-amber-200 bg-amber-50/90`}
                                style={{ borderLeftWidth: 3, borderLeftColor: accent }}
                                title={eb.title}
                              >
                                {body}
                              </Link>
                            )}
                          </div>
                        );
                      })}

                      {(() => {
                        const bookingClusters = clusterMultiServiceBookings(pracBookings);
                        const durationForLayout = (booking: Booking) => {
                          const baseDuration = getBookingDuration(booking);
                          if (resizeVisual?.bookingId !== booking.id) return baseDuration;
                          const resizeDeltaMins = (resizeVisual.deltaYPx / SLOT_HEIGHT) * SLOT_MINUTES;
                          return Math.max(SLOT_MINUTES, baseDuration + resizeDeltaMins);
                        };
                        const clusterLayouts = computeBookingClusterLayouts(bookingClusters, durationForLayout);
                        return bookingClusters.map((cluster) => {
                          const layout = clusterLayouts.get(clusterKey(cluster)) ?? { laneIndex: 0, laneCount: 1 };
                        if (cluster.kind === 'single') {
                          const b = cluster.booking;
                          const duration = getBookingDuration(b);
                          const palette = bookingCalendarBlockStyle(b);
                          const sid = serviceIdForBooking(b);
                          const svc = sid ? serviceMap.get(sid) : null;
                          const top = slotTop(b.booking_time);
                          const height = slotHeightFromDuration(duration);
                          const canDrag =
                            !b.resource_id && ['Pending', 'Booked', 'Confirmed', 'Seated'].includes(b.status);
                          const flash = flashIds.has(b.id);
                          const qBusy = quickActionId === b.id;
                          const resName = b.resource_id ? resourceNameById.get(b.resource_id) : null;
                          const resizeExtra =
                            resizeVisual?.bookingId === b.id ? resizeVisual.deltaYPx : 0;
                          const displayEndHm =
                            resizePreviewEnd?.bookingId === b.id
                              ? resizePreviewEnd.endHm
                              : minutesToTime(timeToMinutes(b.booking_time) + duration);
                          const blockH = height + resizeExtra;
                          const showInlineMoveFollowUp =
                            dragMoveConfirmBookingId === b.id &&
                            lastScheduleEditUndo?.kind === 'move' &&
                            lastScheduleEditUndo.prev.id === b.id;
                          const isOverlapLane = layout.laneCount > 1;
                          const contentHeightPx =
                            blockH - (canDrag ? BOOKING_RESERVE_ABOVE_RESIZE_PX : 0);
                          const showPillsRow = !isOverlapLane && contentHeightPx >= 88;
                          return (
                            <DraggableBookingShell
                              key={b.id}
                              booking={b}
                              top={top}
                              height={height}
                              heightExtraPx={resizeExtra}
                              laneIndex={layout.laneIndex}
                              laneCount={layout.laneCount}
                              canDrag={canDrag}
                            >
                              {(handle) => (
                                <div
                                  className={`group relative flex h-full min-h-0 flex-row items-stretch overflow-hidden rounded-2xl border border-solid shadow-sm ring-1 ring-white/70 transition-shadow hover:shadow-xl hover:shadow-slate-900/12 focus-within:ring-2 focus-within:ring-brand-400/60 ${
                                    flash ? 'motion-safe:animate-pulse ring-2 ring-brand-400/60' : ''
                                  }`}
                                  style={bookingBlockCardStyle(palette)}
                                >
                                  <BookingProcessingStrip b={b} serviceMap={serviceMap} />
                                  {canDrag && handle.listeners && handle.attributes ? (
                                    <button
                                      ref={handle.setActivatorNodeRef}
                                      type="button"
                                      data-no-calendar-pan="true"
                                      className={`relative z-[2] shrink-0 cursor-grab touch-none bg-black/[0.04] px-0.5 text-slate-400 transition hover:bg-black/[0.08] active:cursor-grabbing ${
                                        isOverlapLane ? 'text-[0]' : 'text-[10px]'
                                      }`}
                                      style={{
                                        width: isOverlapLane
                                          ? BOOKING_DRAG_HANDLE_WIDTH_OVERLAP_PX
                                          : BOOKING_DRAG_HANDLE_WIDTH_DEFAULT_PX,
                                        minWidth: isOverlapLane
                                          ? BOOKING_DRAG_HANDLE_WIDTH_OVERLAP_PX
                                          : BOOKING_DRAG_HANDLE_WIDTH_DEFAULT_PX,
                                      }}
                                      aria-label="Drag to reschedule"
                                      {...handle.listeners}
                                      {...handle.attributes}
                                    >
                                      ⋮⋮
                                    </button>
                                  ) : null}
                                  <BookingGuestActionsRowMeasured className="relative z-[1] flex min-h-0 min-w-0 flex-1 flex-col">
                                      {(shellRowWidthPx) => {
                                        const actionBlockHeight = Math.max(
                                          0,
                                          height + resizeExtra - (canDrag ? BOOKING_RESERVE_ABOVE_RESIZE_PX : 0),
                                        );
                                        const actionInset = computeBookingActionCornerInset(b, actionBlockHeight);
                                        return (
                                          <>
                                            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                                            <button
                                              type="button"
                                              onClick={(e) => openBookingDetail(b.id, { x: e.clientX, y: e.clientY })}
                                              {...bindDetailPrefetchHandlers(b.id, prefetchBookingDetail)}
                                              className={`flex min-h-0 flex-1 flex-col justify-start overflow-hidden ${isOverlapLane ? 'px-1.5' : 'px-2.5'} text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                                                blockH < 56 ? 'py-1.5' : 'py-2'
                                              }`}
                                              style={{
                                                paddingRight: actionInset.hasActions
                                                  ? actionInset.right
                                                  : undefined,
                                                paddingBottom: actionInset.hasActions
                                                  ? actionInset.bottom +
                                                    (canDrag ? BOOKING_RESERVE_ABOVE_RESIZE_PX : 0)
                                                  : canDrag
                                                    ? BOOKING_RESERVE_ABOVE_RESIZE_PX
                                                    : undefined,
                                              }}
                                              aria-label={`Open booking details for ${b.guest_name}`}
                                            >
                                              <BookingCardInfo
                                                name={b.guest_name}
                                                service={calendarBookingServiceLabel(b, svc, resName ?? null)}
                                                phone={formatPhoneForDisplay(b.guest_phone)}
                                                start={b.booking_time.slice(0, 5)}
                                                end={displayEndHm}
                                                pill={<CalendarBookingStatusBadge b={b} />}
                                                contentHeightPx={contentHeightPx}
                                              />
                                              {showPillsRow ? (
                                                <div className="mt-1.5 flex w-full min-w-0 shrink-0 flex-col gap-1 border-t border-black/[0.06] pt-1.5">
                                                  <div className="flex flex-wrap content-start gap-x-1 gap-y-1">
                                                    <BookingBlockPills b={b} />
                                                  </div>
                                                </div>
                                              ) : null}
                                              <div className="min-h-0 min-w-0 flex-1" aria-hidden />
                                            </button>
                                            </div>
                                            <CalendarBookingRightColumn
                                              b={b}
                                              busy={qBusy}
                                              blockHeightPx={actionBlockHeight}
                                              onStatus={(id, s) => void quickPatchBooking(id, { status: s })}
                                              onArrived={(id, v) => void quickPatchBooking(id, { client_arrived: v })}
                                              narrow={isOverlapLane}
                                              shellRowWidthPx={shellRowWidthPx}
                                              floating={false}
                                              bottomReservePx={canDrag ? BOOKING_RESERVE_ABOVE_RESIZE_PX : 0}
                                            />
                                          </>
                                        );
                                      }}
                                    </BookingGuestActionsRowMeasured>
                                  {canDrag ? (
                                    <>
                                      {resizePreviewEnd?.bookingId === b.id ? (
                                        <span
                                          className="pointer-events-none absolute left-1/2 z-20 max-w-[calc(100%-0.5rem)] -translate-x-1/2 truncate rounded-md bg-slate-900 px-2 py-0.5 text-center text-[10px] font-bold tabular-nums text-white shadow-md"
                                          style={{ bottom: BOOKING_RESERVE_ABOVE_RESIZE_PX }}
                                        >
                                          Until {resizePreviewEnd.endHm}
                                        </span>
                                      ) : null}
                                      {showInlineMoveFollowUp ? (
                                        <div
                                          className="pointer-events-auto absolute left-1/2 z-[45] -translate-x-1/2"
                                          style={{ bottom: BOOKING_RESERVE_ABOVE_RESIZE_PX }}
                                          data-no-calendar-pan="true"
                                        >
                                          <div
                                            role="group"
                                            aria-label="Confirm or undo this move"
                                            className="flex items-center gap-1 rounded-xl border px-2 py-1 shadow-[0_12px_28px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.72)] ring-1 ring-black/[0.05] backdrop-blur-sm"
                                            style={{
                                              backgroundColor: palette.bg,
                                              backgroundImage: `linear-gradient(135deg, ${palette.bg} 0%, rgba(255,255,255,0.94) 100%)`,
                                              borderColor: palette.border,
                                              color: palette.text,
                                            }}
                                          >
                                            <span
                                              className="mr-0.5 h-3 w-[3px] shrink-0 rounded-full"
                                              style={{ backgroundColor: palette.accent }}
                                              aria-hidden
                                            />
                                            <button
                                              type="button"
                                              disabled={scheduleUndoPending}
                                              onClick={() => void confirmInlineDragMove()}
                                              className="rounded-lg bg-brand-600 px-2.5 py-1 text-[10px] font-semibold leading-none text-white shadow-sm shadow-brand-900/20 transition hover:bg-brand-700 disabled:opacity-50"
                                            >
                                              Confirm
                                            </button>
                                            <button
                                              type="button"
                                              disabled={scheduleUndoPending}
                                              onClick={() => void undoLastScheduleEdit()}
                                              className="rounded-lg border border-slate-300/90 bg-white/90 px-2.5 py-1 text-[10px] font-semibold leading-none text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                                            >
                                              Undo
                                            </button>
                                          </div>
                                        </div>
                                      ) : null}
                                      <span
                                        role="separator"
                                        aria-orientation="horizontal"
                                        aria-label="Drag to change duration"
                                        data-no-calendar-pan="true"
                                        className="absolute bottom-0 left-0 right-0 z-40 cursor-ns-resize touch-none rounded-b-2xl border-t border-white/50 bg-black/[0.07] hover:bg-black/[0.14] active:bg-black/20"
                                        style={{ height: BOOKING_RESIZE_HANDLE_HEIGHT_PX }}
                                        onPointerDown={beginAppointmentResize(b)}
                                        onMouseDown={(e) => e.stopPropagation()}
                                      />
                                    </>
                                  ) : null}
                                </div>
                              )}
                            </DraggableBookingShell>
                          );
                        }

                        const items = cluster.items;
                        const first = items[0]!;
                        const last = items[items.length - 1]!;
                        const spanMins =
                          timeToMinutes(last.booking_time) +
                          getBookingDuration(last) -
                          timeToMinutes(first.booking_time);
                        const top = slotTop(first.booking_time);
                        const height = slotHeightFromDuration(spanMins);
                        const palette = bookingCalendarBlockStyle(first);
                        const flash = items.some((x) => flashIds.has(x.id));
                        const qBusy = items.some((x) => quickActionId === x.id);
                        const isOverlapLane = layout.laneCount > 1;
                        const serviceTitle = items
                          .map((x) => {
                            const sid = serviceIdForBooking(x);
                            return sid ? serviceMap.get(sid)?.name : null;
                          })
                          .filter(Boolean)
                          .join(' → ');
                        return (
                          <DraggableBookingShell
                            key={first.id}
                            booking={first}
                            top={top}
                            height={height}
                            laneIndex={layout.laneIndex}
                            laneCount={layout.laneCount}
                            canDrag={false}
                          >
                            {() => (
                              <div
                                className={`group flex h-full min-h-0 flex-row items-stretch overflow-hidden rounded-2xl border border-solid shadow-sm ring-1 ring-white/70 transition-shadow hover:shadow-xl hover:shadow-slate-900/12 focus-within:ring-2 focus-within:ring-brand-400/60 ${
                                  flash ? 'motion-safe:animate-pulse ring-2 ring-brand-400/60' : ''
                                }`}
                                style={bookingBlockCardStyle(palette)}
                                title={serviceTitle || undefined}
                                {...bindDetailPrefetchHandlers(first.id, prefetchBookingDetail)}
                              >
                                <BookingGuestActionsRowMeasured className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                                  {(shellRowWidthPx) => {
                                    const actionInset = computeBookingActionCornerInset(first, height);
                                    return (
                                    <>
                                      <div
                                        className="flex min-h-0 min-w-0 flex-1 flex-col"
                                        style={{
                                          paddingRight: actionInset.hasActions ? actionInset.right : undefined,
                                          paddingBottom: actionInset.hasActions ? actionInset.bottom : undefined,
                                        }}
                                      >
                                        {items.map((b, segIdx) => {
                                          const dur = getBookingDuration(b);
                                          const sid = serviceIdForBooking(b);
                                          const svc = sid ? serviceMap.get(sid) : null;
                                          const segmentApproxPx = height * (dur / Math.max(spanMins, 1));
                                          const showSegPills = !isOverlapLane && segmentApproxPx >= 88;
                                          const resSeg = b.resource_id ? resourceNameById.get(b.resource_id) : null;
                                          const segServiceLabel = calendarBookingServiceLabel(b, svc, resSeg ?? null);
                                          return (
                                            <div
                                              key={b.id}
                                              className="relative flex min-h-0 flex-col overflow-hidden"
                                              style={{ flex: dur, backgroundColor: palette.bg }}
                                            >
                                              <BookingProcessingStrip b={b} serviceMap={serviceMap} wallPaintMinutes={dur} />
                                              <button
                                                type="button"
                                                onClick={(e) => openBookingDetail(b.id, { x: e.clientX, y: e.clientY })}
                                                className={`relative z-[1] flex min-h-0 min-w-0 flex-1 flex-col justify-start overflow-hidden ${isOverlapLane ? 'px-1.5' : 'px-2.5'} py-1 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500`}
                                                aria-label={`Open booking details for ${b.guest_name}`}
                                              >
                                                <BookingCardInfo
                                                  name={first.guest_name}
                                                  hideName={segIdx > 0}
                                                  service={segServiceLabel}
                                                  phone={formatPhoneForDisplay(b.guest_phone)}
                                                  start={b.booking_time.slice(0, 5)}
                                                  end={minutesToTime(timeToMinutes(b.booking_time) + dur)}
                                                  pill={
                                                    segIdx === 0 ? (
                                                      <CalendarBookingStatusBadge b={first} />
                                                    ) : null
                                                  }
                                                  contentHeightPx={segmentApproxPx}
                                                />
                                                {!isOverlapLane && showSegPills ? (
                                                  <div className="mt-1 flex w-full min-w-0 shrink-0 flex-col gap-1 border-t border-black/[0.06] pt-1">
                                                    <div className="flex flex-wrap content-start gap-x-1 gap-y-1">
                                                      <BookingBlockPills b={b} />
                                                    </div>
                                                  </div>
                                                ) : null}
                                                <div className="min-h-0 min-w-0 flex-1" aria-hidden />
                                              </button>
                                            </div>
                                          );
                                        })}
                                      </div>
                                      <CalendarBookingRightColumn
                                        b={first}
                                        busy={qBusy}
                                        blockHeightPx={height}
                                        onStatus={(id, s) => void quickPatchBooking(id, { status: s })}
                                        onArrived={(id, v) => void quickPatchBooking(id, { client_arrived: v })}
                                        narrow={isOverlapLane}
                                        shellRowWidthPx={shellRowWidthPx}
                                        floating={false}
                                        bottomReservePx={0}
                                      />
                                    </>
                                    );
                                  }}
                                </BookingGuestActionsRowMeasured>
                              </div>
                            )}
                          </DraggableBookingShell>
                        );
                        });
                      })()}
                    </div>
                  </div>
                );
              })}
              {viewMode === 'day' && showMergedFeeds ? (
                <>
                  {showEventsColumn &&
                  scheduleBlocks.some(
                    (b) => b.kind === 'event_ticket' && !b.calendar_id && b.status !== 'Cancelled',
                  ) ? (
                    <ScheduleFeedColumn
                      label="Events (unassigned)"
                      date={date}
                      blocks={scheduleBlocks.filter(
                        (b) => b.kind === 'event_ticket' && !b.calendar_id,
                      )}
                      startHour={startHour}
                      endHour={endHour}
                      onBookingClick={openBookingDetail}
                      hideHeader
                    />
                  ) : null}
                </>
              ) : null}
              {viewMode === 'day'
                ? visibleLinkedColumns.map((col) => (
                    <LinkedDayColumn
                      key={col.key}
                      column={col}
                      bookings={linkedBookingsFor(col, date)}
                      startHour={startHour}
                      totalSlots={TOTAL_SLOTS}
                      onBookingClick={(b) => openLinkedBooking(col, b)}
                      onCreateAt={
                        col.action === 'create_edit_cancel'
                          ? (time) => {
                              const v = linkedVenueById.get(col.venueId);
                              if (v)
                                setLinkedCreating({
                                  venue: v,
                                  practitionerId: col.practitionerId,
                                  time,
                                });
                            }
                          : undefined
                      }
                    />
                  ))
                : null}
            </div>
            </div>
            </div>
          </div>
          <DragOverlay dropAnimation={null}>
            {dragBooking ? (
              <DragBookingPreview booking={dragBooking} movePreview={calendarDragPreview} />
            ) : dragBlock ? (
              <DragBlockPreview block={dragBlock} movePreview={calendarDragPreview} />
            ) : null}
          </DragOverlay>
        </DndContext>
        </div>
      )}

      {slotMenu && (() => {
        const resourcesHere = venueResources.filter((r) => r.display_on_calendar_id === slotMenu.pracId);
        return (
          <>
            <button
              type="button"
              className="fixed inset-0 z-[55] cursor-default bg-transparent"
              aria-label="Close menu"
              onClick={() => setSlotMenu(null)}
            />
            <div
              className="fixed z-[60] min-w-[11rem] max-w-[min(18rem,calc(100vw-1rem))] rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
              style={{ left: slotMenu.x, top: slotMenu.y }}
            >
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => openNewAtSlot(slotMenu.pracId, slotMenu.dateStr, slotMenu.time)}
              >
                New appointment
              </button>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => openWalkInAtSlot(slotMenu.pracId, slotMenu.dateStr, slotMenu.time)}
              >
                Walk-in
              </button>
              {resourcesHere.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => {
                    setResourceBookingResourceId(r.id);
                    setPrefillDate(slotMenu.dateStr);
                    setPrefillTime(slotMenu.time);
                    setShowResourceBooking(true);
                    setSlotMenu(null);
                  }}
                >
                  Book {r.name}
                </button>
              ))}
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => openBlockModal(slotMenu.pracId, slotMenu.dateStr, slotMenu.time)}
              >
                Block time
              </button>
            </div>
          </>
        );
      })()}

      {blockModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setBlockModal(null)}
        >
          <div
            role="dialog"
            aria-labelledby="block-modal-title"
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="block-modal-title" className="text-base font-semibold text-slate-900">
              {blockModal.blockId ? 'Edit block' : 'Block time'}
            </h3>
            <p className="mt-1 text-xs text-slate-500">{blockModal.dateStr}</p>
            {(() => {
              const durationMins = timeToMinutes(blockModal.endTime) - timeToMinutes(blockModal.startTime);
              if (durationMins <= 0) {
                return (
                  <p className="mt-2 text-xs font-medium text-amber-800" role="status">
                    Choose an end time after {blockModal.startTime} to set a duration.
                  </p>
                );
              }
              return (
                <p className="mt-2 text-sm text-slate-600" role="status">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Duration </span>
                  <span className="font-semibold tabular-nums text-slate-900">{formatBlockDurationLabel(durationMins)}</span>
                </p>
              );
            })()}
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600">Start time</label>
                <input
                  type="time"
                  value={blockModal.startTime}
                  onChange={(e) => setBlockModal((m) => (m ? { ...m, startTime: e.target.value } : m))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">End time</label>
                <input
                  type="time"
                  value={blockModal.endTime}
                  onChange={(e) => setBlockModal((m) => (m ? { ...m, endTime: e.target.value } : m))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Reason (optional)</label>
                <input
                  type="text"
                  value={blockModal.reason}
                  onChange={(e) => setBlockModal((m) => (m ? { ...m, reason: e.target.value } : m))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="e.g. Break, leave, hold"
                />
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
              {blockModal.blockId ? (
                <button
                  type="button"
                  disabled={blockSaving}
                  onClick={() => void deleteBlockFromModal()}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                >
                  Delete
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setBlockModal(null)}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={blockSaving}
                  onClick={() => void saveBlock()}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {blockSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {(
        <button
          type="button"
          onClick={() => {
            setPrefillDate(date);
            setPrefillTime(undefined);
            setPrefillPractitionerId(
              calendarFilterIds?.length === 1 ? calendarFilterIds[0] : undefined,
            );
            setStaffBookingModal('new');
          }}
          className="fixed right-[max(1rem,env(safe-area-inset-right,0px))] z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg hover:bg-brand-700 bottom-[max(1.5rem,env(safe-area-inset-bottom,0px))] md:hidden"
          aria-label={newBookingToolbarLabel}
        >
          <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
      )}

      <ClassInstanceDetailSheet
        selection={classInstanceSheet}
        onClose={() => {
          setClassInstanceSheet(null);
          setClassInstanceAnchor(null);
        }}
        currency={currency}
        presentation="popover"
        anchor={classInstanceAnchor}
      />

      <EventInstanceDetailSheet
        selection={eventInstanceSheet}
        onClose={() => setEventInstanceSheet(null)}
        currency={currency}
      />

      {detailBookingId ? (
        <BookingDetailPanel
          key={detailBookingId}
          bookingId={detailBookingId}
          venueId={venueId}
          venueCurrency={currency}
          initialSnapshot={calendarBookingDetailSnapshot}
          isAppointment
          presentation="popover"
          anchor={detailBookingAnchor}
          venueTimezone={venueTimezone}
          onClose={() => {
            setDetailBookingId(null);
            setDetailBookingAnchor(null);
          }}
          onUpdated={() => void fetchData({ silent: true })}
        />
      ) : null}

      {staffBookingModal ? (
        <CalendarStaffBookingModal
          open
          intent={staffBookingModal}
          onClose={() => {
            setStaffBookingModal(null);
            setPrefillDate(undefined);
            setPrefillPractitionerId(undefined);
            setPrefillTime(undefined);
          }}
          onCreated={() => {
            setStaffBookingModal(null);
            setPrefillDate(undefined);
            setPrefillPractitionerId(undefined);
            setPrefillTime(undefined);
            void fetchData({ silent: true });
          }}
          venueId={venueId}
          currency={currency}
          bookingModel={bookingModel}
          enabledModels={enabledModels}
          preselectedDate={prefillDate ?? (viewMode === 'day' ? date : undefined)}
          preselectedPractitionerId={prefillPractitionerId}
          preselectedTime={prefillTime}
        />
      ) : null}
      {showResourceBooking && resourceBookingResourceId ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            setShowResourceBooking(false);
            setResourceBookingResourceId(undefined);
            setPrefillDate(undefined);
            setPrefillTime(undefined);
          }}
        >
          <div
            role="dialog"
            aria-label="Book resource"
            className="max-h-[min(90vh,720px)] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-slate-900">Book resource</h3>
              <button
                type="button"
                onClick={() => {
                  setShowResourceBooking(false);
                  setResourceBookingResourceId(undefined);
                  setPrefillDate(undefined);
                  setPrefillTime(undefined);
                }}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {resourceBookingVenueError ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {resourceBookingVenueError}
              </p>
            ) : resourceBookingVenue ? (
              <ResourceBookingFlow
                key={`${resourceBookingResourceId}-${prefillDate ?? ''}-${prefillTime ?? ''}`}
                venue={resourceBookingVenue}
                bookingAudience="staff"
                staffBookingSource="phone"
                onBookingCreated={() => void fetchData({ silent: true })}
                initialResourceId={resourceBookingResourceId}
                initialDate={prefillDate ?? (viewMode === 'day' ? date : undefined)}
                initialTime={prefillTime}
              />
            ) : (
              <div className="flex items-center justify-center py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
              </div>
            )}
          </div>
        </div>
      ) : null}

      {linkedEditing ? (
        <EditLinkedBookingModal
          venueName={linkedEditing.column.venueName}
          booking={linkedEditing.booking}
          canCancel={linkedEditing.column.action === 'create_edit_cancel'}
          onClose={() => setLinkedEditing(null)}
          onSaved={() => {
            setLinkedEditing(null);
            void loadLinkedData();
          }}
        />
      ) : null}

      {linkedViewing ? (
        <LinkedBookingDetailModal
          venueName={linkedViewing.column.venueName}
          visibility={linkedViewing.column.visibility}
          booking={linkedViewing.booking}
          onClose={() => setLinkedViewing(null)}
        />
      ) : null}

      {linkedCreating ? (
        <CreateLinkedBookingModal
          venue={linkedCreating.venue}
          practitionerId={linkedCreating.practitionerId}
          time={linkedCreating.time}
          date={viewMode === 'day' ? date : weekStart}
          onClose={() => setLinkedCreating(null)}
          onSaved={() => {
            setLinkedCreating(null);
            void loadLinkedData();
          }}
        />
      ) : null}
    </div>
  );
}
