'use client';

import {
  DEFAULT_CALENDAR_FILTERS,
  calendarFiltersAreDefault,
  readCalendarFilterPreferences,
  writeCalendarFilterPreferences,
  type PractitionerCalendarFilters,
} from '@/lib/calendar/calendar-filter-preferences';
import {
  ownSiblingOverlapCount,
  visitChipLabel,
  visitSiblingIndex,
  visitTouchingEdges,
} from '@/lib/calendar/visit-siblings';
import {
  calendarHasAvailableHoursOnDate,
  calendarWorksOnDate,
} from '@/lib/calendar/calendar-works-on-date';
import {
  Fragment,
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
import { createClient } from '@/lib/supabase/browser';
import { ResourceBookingFlow } from '@/components/booking/ResourceBookingFlow';
import { CalendarStaffBookingModal } from '@/app/dashboard/practitioner-calendar/CalendarStaffBookingModal';
import { CalendarColumnsChecklist } from '@/app/dashboard/practitioner-calendar/CalendarColumnsFilter';
import {
  LinkedBookingDetailModal,
} from '@/components/linked-accounts/LinkedCalendarView';
import { linkedNewBookingButtonClass } from '@/components/linked-accounts/linked-accounts-ui';
import type { LinkedVenueCalendar, LinkedBooking, LinkedResource } from '@/lib/linked-accounts/calendar';
import {
  linkedBookingToGridBooking,
  linkedColumnKey,
  linkedColumnUsesNativeGrid,
  linkedGrantActForOwnerVenue,
  linkedVenueScheduleBlocksForColumn,
  resolveLinkedGridPractitionerIdForPatch,
} from '@/lib/linked-accounts/calendar';
import { linkedBookingCountByDate } from '@/lib/linked-accounts/month-linked-counts';
import {
  BookingDetailPanel,
  type BookingDetailPanelSnapshot,
} from '@/app/dashboard/bookings/BookingDetailPanel';
import { ClassInstanceDetailSheet } from '@/components/practitioner-calendar/ClassInstanceDetailSheet';
import { EventInstanceDetailSheet, type EventInstanceSheetSelection } from '@/components/practitioner-calendar/EventInstanceDetailSheet';
import { ResourceInstanceDetailSheet } from '@/components/practitioner-calendar/ResourceInstanceDetailSheet';
import { useToast } from '@/components/ui/Toast';
import { useAcceptUnpaidGuard } from '@/components/booking/AcceptUnpaidBookingDialog';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { CalendarHoursQuickEdit } from './CalendarHoursQuickEdit';
import { Button } from '@/components/ui/primitives/Button';
import { useDashboardDetailCache } from '@/components/providers/DashboardDetailCacheProvider';
import { bindDetailPrefetchHandlers } from '@/lib/dashboard/detail-prefetch-intent';
import { useDebouncedCallback } from '@/lib/hooks/use-debounced-callback';
import {
  CALENDAR_CATALOG_STALE_MS,
  REALTIME_BOOKINGS_DEBOUNCE_MS,
} from '@/lib/realtime/dashboard-sync-constants';
import {
  bookingDetailPanelSnapshotFromListRow,
  estimatedEndIsoFromSchedule,
} from '@/lib/booking/booking-detail-from-row';
import {
  primeGroupVisitBookingsFromListSeeds,
  warmGroupVisitBookings,
} from '@/lib/booking/group-visit-bookings';
import {
  calendarBookingServiceDisplayLine,
} from '@/lib/booking/calendar-booking-service-label';
import { DashboardCalendarSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';
import { Skeleton } from '@/components/ui/Skeleton';
import { getCalendarGridBounds } from '@/lib/venue-calendar-bounds';
import type { BookingStatus } from '@/lib/table-management/booking-status';
import type { AvailabilityBlock, OpeningHours } from '@/types/availability';
import type { BookingModel } from '@/types/booking-models';
import { venueExposesBookingModel } from '@/lib/booking/enabled-models';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import { getStaffBookingSurfaceTabs } from '@/lib/booking/staff-booking-modal-options';
import type { StaffRebookBootstrapPayloadV1 } from '@/lib/booking/staff-rebook-bootstrap';
import { warmStaffBookingSurface } from '@/lib/booking/staff-surface-warm';
import type { StaffCollectiveSummary } from '@/lib/linked-accounts/collective-staff-scope';
import {
  RESOURCE_BOOKING_CAPACITY_STATUSES,
  type ResourceBooking as EngineResourceBooking,
} from '@/lib/availability/resource-booking-engine';
import { MIN_APPOINTMENT_CORE_DURATION_MINUTES } from '@/lib/availability/appointment-engine';
import {
  computeResourceAvailabilityMintSlots,
  type ResourceAvailabilityMintSlot,
} from '@/lib/calendar/resource-availability-mint-slots';
import type {
  ClassPaymentRequirement,
  Practitioner as VenuePractitioner,
  VenueResource,
  WorkingHours,
} from '@/types/booking-models';
import type { ScheduleBlockDTO } from '@/types/schedule-blocks';
import {
  addCalendarDays,
  monthGridDateRange,
  groupScheduleBlocksByDate,
  buildMonthDayScheduleCounts,
} from '@/lib/calendar/schedule-blocks-grouping';
import { buildPractitionerBreakBlocks } from '@/lib/calendar/practitioner-break-blocks';
import {
  buildLinkedColumnClosureBlocks,
  buildPractitionerScheduleClosureBlocks,
  buildVenueScheduleClosureBlocks,
  calendarWorkingBoundsForDates,
  isScheduleClosureBlockType,
  partitionScheduleClosureBlocks,
  scheduleClosureBlockLabel,
} from '@/lib/calendar/schedule-closure-blocks';
import { isNonWorkingBlock, isOccupyingBlock } from '@/lib/calendar/occupying-blocks';
import { type PractitionerLeavePeriodInput } from '@/lib/calendar/schedule-closure-blocks';
import { formatResolvedHoursLineForDate, formatWorkingHoursLineForDate } from '@/lib/calendar/format-working-hours-for-date';
import { calendarHours } from '@/lib/availability/calendar-hours';
import { formatEventUptakeLine } from '@/lib/calendar/event-block-label';
import { bookingMoveFootprintMinutes } from '@/lib/calendar/booking-move-footprint';
import {
  type BookingBlockPalette,
  bookingCalendarBlockCardStyle,
  bookingCalendarBlockPalette,
  bookingCalendarBlockPaletteForDisplayRow,
  bookingCalendarBlockPaletteWithOverlay,
  CalendarBookingStatusStripe,
  isArrivedWaitingDisplay,
} from '@/lib/calendar/booking-calendar-block-style';
import {
  clusterLayoutHorizontalStyle,
  hostRegionsAroundNested,
  layoutOverlapClusters,
  type BookingClusterLayout,
  type MinuteRange,
} from '@/lib/calendar/booking-cluster-layout';
import {
  BOOKING_ACTIONS_CORNER_RIGHT_PX,
  BOOKING_ACTION_BUTTON_WIDTH_PX,
  BOOKING_ACTION_TRAY_TOP_GAP_PX,
  BOOKING_CORNER_BUTTON_FLOOR_HEIGHT_PX,
  BOOKING_CORNER_TRAY_RIGHT_PX,
  bookingCornerTraySpacing,
  planBookingActionClearance,
  planBookingCornerActions,
  type BookingActionClearance,
  type BookingCornerActionInput,
} from '@/lib/calendar/booking-corner-actions';
import {
  applyBookingRowOverlayFields,
  mergeBookingRowOverlay,
  overlayFromClientArrivedPatch,
  overlayFromPatchBody,
  overlayFromPatchPayload,
  visitSiblingOverlay,
  overlayFromStatusTransition,
  retainBookingRowOverlay,
  type BookingRowOverlay,
} from '@/lib/booking/booking-row-overlay';
import {
  isAttendanceConfirmed,
  showAttendanceConfirmedSupplementPill,
  showDepositPendingPill,
} from '@/lib/booking/booking-staff-indicators';
import { bookingTransitionButtonSurface } from '@/lib/table-management/booking-status-visual';
import {
  bookingStatusDisplayLabel,
  inferBookingRowModel,
  isTableReservationBooking,
} from '@/lib/booking/infer-booking-row-model';
import { ScheduleFeedColumn } from './ScheduleFeedColumn';
import { WeekScheduleCdeStrip } from './WeekScheduleCdeStrip';
import { MonthScheduleGrid } from './MonthScheduleGrid';
import { PractitionerCalendarToolbar } from './PractitionerCalendarToolbar';
import { ScheduleEditFollowUpBar, type ScheduleEditFollowUpChange } from './ScheduleEditFollowUpBar';
import { OperationsToolbarGuestSearchPanel } from '@/components/dashboard/OperationsToolbarGuestSearchPanel';
import { BookingCard } from './BookingCard';
import { useAppointmentsFeatureFlag } from '@/components/providers/VenueFeatureFlagsProvider';
import {
  ComplianceBarIcon,
  useComplianceBookingFlags,
} from '@/components/dashboard/compliance/ComplianceBookingIndicator';
import { formatBookingModificationNotifyToast } from '@/lib/booking/modification-notify-result';
import { formatPhoneForDisplay } from '@/lib/phone/e164';
import { EmptyState } from '@/components/ui/dashboard/EmptyState';
import { HorizontalScrollHint } from '@/components/ui/HorizontalScrollHint';
import type { VenuePublic } from '@/components/booking/types';
import { mapApiVenueToVenuePublic } from '@/lib/booking/map-api-venue-to-public';
import { scheduleWaitlistAlertsRefresh } from '@/lib/booking/waitlist-alerts-events';
import { formatIsoDateInTimeZone } from '@/lib/date/format-iso-date-in-timezone';
import { readSessionPreference, writeSessionPreference } from '@/lib/ui/session-preferences';
import {
  processingActiveEndMinutes,
  processingTailMinutes,
  fitProcessingBlocksToDuration,
  customerOccupyMinutes,
  effectiveProcessingBlocksForTemplate,
  parseProcessingTimeBlocksFromDb,
  practitionerBusyMinuteOffsets,
  processingBlocksForDurationChange,
} from '@/lib/appointments/processing-time';
import type { ProcessingTimeBlock } from '@/types/booking-models';
import { resolveVenueWideAllowedMinuteRanges } from '@/lib/availability/venue-wide-business-hours';

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
  /** Schedule periods and the older rota; the header line resolves them per date. */
  schedule_periods?: unknown;
  working_hours_rota?: unknown;
  break_times?: Array<{ start: string; end: string }>;
  break_times_by_day?: WorkingHours | null;
  days_off?: string[];
}

interface CalendarVariantRow {
  id: string;
  name?: string;
  duration_minutes?: number;
  processing_time_blocks?: ProcessingTimeBlock[];
}

/**
 * A read-only practitioner column belonging to a *linked* venue (§8.2). Linked
 * columns are kept entirely separate from the native `Practitioner` pipeline —
 * no droppables, drag, resource logic or availability maths touch them — so the
 * core calendar is unaffected. The `key` is namespaced to avoid colliding with
 * a native column id.
 */
/** "Tue 8 Sep" for the cross-account move dialog; the ISO date if it cannot be parsed. */
function formatDateNice(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** What the cross-account move dialog needs to say and to do. */
interface CrossVenueMoveDialog {
  booking: Booking;
  sourceCalendarName: string;
  /** Null when the dragged booking is on this venue. */
  sourceVenueName: string | null;
  targetColumnKey: string;
  targetCalendarName: string;
  /** Null when the drop column is this venue's own. */
  targetVenueName: string | null;
  targetLinkedColumn: LinkedColumn | null;
  dateStr: string;
  time: string;
}

interface CrossVenueRebook {
  bookingId: string;
  guestName: string;
  originalLabel: string;
  targetLabel: string;
  bootstrap: StaffRebookBootstrapPayloadV1;
}

interface LinkedColumn {
  key: string;
  venueId: string;
  venueName: string;
  /** Owner venue timezone — used for working-hours labels on the selected date. */
  venueTimezone: string;
  linkId: string;
  practitionerId: string;
  practitionerName: string;
  practitionerActive: boolean;
  workingHours?: WorkingHours;
  visibility: LinkedVenueCalendar['visibility'];
  action: LinkedVenueCalendar['action'];
}

type DayGridColumn =
  | { kind: 'native'; practitioner: Practitioner }
  | { kind: 'linked'; column: LinkedColumn };

function dayGridColumnId(col: DayGridColumn): string {
  return col.kind === 'native' ? col.practitioner.id : col.column.key;
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
  /**
   * Names as the booking recorded them. Both outlive the catalogue, so a bar
   * still says what the appointment was for after the service is deleted and
   * the ids above are nulled.
   */
  service_name_snapshot?: string | null;
  service_variant_name_snapshot?: string | null;
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
  /** Set on a party's rows, which share a group id but are not a visit. */
  person_label?: string | null;
  experience_event_id?: string | null;
  class_instance_id?: string | null;
  resource_id?: string | null;
  event_session_id?: string | null;
  /** Needed to hide attendance actions for walk-ins (same as bookings dashboard). */
  source?: string | null;
  /** Aggregate add-on totals; drives the "+N extras" badge on the calendar card. */
  addons_total_price_pence?: number | null;
  addons_total_duration_minutes?: number | null;
  addons_count?: number | null;
  /** Snapshot names from `booking_addons` for calendar bar labels. */
  booking_addon_labels?: string[];
  /** Set for editable linked-venue bookings rendered on the native day grid. */
  _linkedOwnerVenueId?: string;
  _linkedColumnKey?: string;
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
  /** A calendar closure's Label, on `practitioner_leave` stripes (`schedule-closure-blocks`). */
  leave_type?: string | null;
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

function apiResourceRowToVenueResource(
  r: VenueResourceRow,
  venueIdForRow: string,
  hostPractitioner?: Practitioner | null,
): VenueResource {
  const hostCalendar = r.display_on_calendar_id
    ? hostPractitioner
      ? {
          id: hostPractitioner.id,
          working_hours: hostPractitioner.working_hours ?? {},
          schedule_periods: hostPractitioner.schedule_periods ?? null,
          working_hours_rota: hostPractitioner.working_hours_rota ?? null,
          days_off: hostPractitioner.days_off ?? [],
          break_times: hostPractitioner.break_times ?? [],
          break_times_by_day: hostPractitioner.break_times_by_day ?? null,
        }
      : null
    : undefined;
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
    display_on_calendar_id: r.display_on_calendar_id,
    host_calendar: hostCalendar,
  };
}

function linkedResourceToVenueResource(
  r: LinkedResource,
  venueIdForRow: string,
  hostWorkingHours?: WorkingHours,
): VenueResource {
  return {
    id: r.id,
    venue_id: venueIdForRow,
    name: r.name,
    resource_type: null,
    min_booking_minutes: r.minBookingMinutes,
    max_booking_minutes: r.maxBookingMinutes,
    slot_interval_minutes: r.slotIntervalMinutes,
    price_per_slot_pence: null,
    payment_requirement: 'none',
    deposit_amount_pence: null,
    availability_hours: r.availabilityHours,
    availability_exceptions: r.availabilityExceptions,
    is_active: r.isActive,
    sort_order: 0,
    created_at: '',
    display_on_calendar_id: r.displayOnCalendarId,
    host_calendar: hostWorkingHours
      ? {
          id: r.displayOnCalendarId,
          working_hours: hostWorkingHours,
          days_off: [],
          break_times: [],
          break_times_by_day: null,
        }
      : undefined,
  };
}

function ResourceAvailabilityMintBlock({ slot }: { slot: ResourceAvailabilityMintSlot }) {
  return (
    <div
      className="pointer-events-none absolute left-1 right-1 z-[5] overflow-hidden rounded-md border border-dashed border-emerald-300/90 bg-emerald-50/80 px-1 py-0.5"
      style={{ top: slot.top, height: slot.height }}
      title={`${slot.resourceName}: available to book`}
      aria-label={`${slot.resourceName} available to book`}
    >
      <span className="block truncate text-[10px] font-semibold leading-tight text-emerald-900">
        {slot.resourceName}
      </span>
    </div>
  );
}

/** Staff column: appointment anchor, or resource booking mapped onto its host calendar column. */
function resolveBookingColumnId(b: Booking, resourceParentById: Map<string, string>): string | null {
  if (b._linkedColumnKey) return b._linkedColumnKey;
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

function isBreakCalendarBlock(bl: CalendarBlock): boolean {
  return bl.block_type === 'break';
}

function isScheduleClosureBlock(bl: CalendarBlock): boolean {
  return isScheduleClosureBlockType(bl.block_type);
}


/** Manual blocks staff can drag, resize, and edit (not class-tied or schedule breaks). */
function isManualEditableBlock(bl: CalendarBlock): boolean {
  return (
    !isBreakCalendarBlock(bl) &&
    !isScheduleClosureBlock(bl) &&
    bl.block_type !== 'class_session' &&
    !bl.class_instance_id
  );
}

function calendarBlockHeading(bl: CalendarBlock, columnName?: string | null): string {
  if (isBreakCalendarBlock(bl)) return 'Break';
  if (isScheduleClosureBlock(bl)) {
    return scheduleClosureBlockLabel(bl.block_type, {
      columnName,
      startTime: bl.start_time,
      endTime: bl.end_time,
      leaveType: bl.leave_type,
    });
  }
  if (isManualEditableBlock(bl)) return 'Time blocked';
  return 'Blocked';
}

function calendarBlockShellClass(bl: CalendarBlock): string {
  if (isBreakCalendarBlock(bl)) {
    return 'border-amber-200 bg-amber-50/95 hover:bg-amber-50';
  }
  // Two single-cause tints: rose when the business is shut but the calendar
  // would work, sky when the business is open but the calendar is not. Slate
  // means both, or a linked venue's own closed hours.
  if (bl.block_type === 'venue_closed') {
    return 'border-rose-200 bg-rose-50/95';
  }
  if (bl.block_type === 'practitioner_closed') {
    return 'border-sky-200 bg-sky-50/95';
  }
  if (bl.block_type === 'practitioner_leave') {
    return 'border-violet-200 bg-violet-50/95';
  }
  if (bl.block_type === 'venue_and_calendar_closed' || bl.block_type === 'linked_venue_closed') {
    return 'border-slate-300 bg-slate-200/90';
  }
  return 'border-slate-300 bg-slate-200/90 hover:bg-slate-300/90';
}

/** Heading text colour that matches {@link calendarBlockShellClass}. */
function calendarBlockHeadingTextClass(bl: CalendarBlock): string {
  if (isBreakCalendarBlock(bl)) return 'text-amber-950';
  if (bl.block_type === 'venue_closed') return 'text-rose-950';
  if (bl.block_type === 'practitioner_closed') return 'text-sky-950';
  if (bl.block_type === 'practitioner_leave') return 'text-violet-950';
  return 'text-slate-900';
}

function calendarBlockAccentColor(bl: CalendarBlock): string {
  if (isBreakCalendarBlock(bl)) return '#d97706';
  if (bl.block_type === 'venue_closed') return '#e11d48';
  if (bl.block_type === 'practitioner_closed') return '#0284c7';
  if (bl.block_type === 'practitioner_leave') return '#7c3aed';
  if (bl.block_type === 'venue_and_calendar_closed' || bl.block_type === 'linked_venue_closed') {
    return '#94a3b8';
  }
  return '#94a3b8';
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

/** Comfortable (default) pixel height for one {@link SLOT_MINUTES} slot. */
const COMFORTABLE_SLOT_PX = 48;
/**
 * Floor for the compact day view's runtime slot height. Below this the client name
 * stops being legible, so we clamp here (per the "stay legible" product decision) and
 * let a very long day overflow slightly rather than shrink rows into illegibility.
 */
const MIN_SLOT_PX = 16;
/** In compact mode, ignore drag nudges smaller than this so a few px of jitter can't reschedule. */
const COMPACT_DRAG_DEADZONE_PX = 6;
const SLOT_MINUTES = 15;
/**
 * Shortest a booking bar may be drawn, whatever its duration.
 *
 * Set by the one thing a bar must always carry: a quick-action button, plus a
 * pixel of clearance top and bottom. Real durations are drawn to scale above it.
 */
const BOOKING_BLOCK_MIN_RENDER_HEIGHT_PX = BOOKING_CORNER_BUTTON_FLOOR_HEIGHT_PX + 2;
/**
 * Height a booking bar spends on things OTHER than the info card, so the card is
 * given an honest budget to lay itself out in.
 *
 * `BookingCard` picks how many rows to show from the height it is told it has.
 * Both bar layouts were handing it the RAW bar height while the same box also
 * held the button's vertical padding and, when present, the pills row rendered
 * underneath the card. The card then chose a row count that could not fit: on a
 * multi-service visit the phone line was sliced in half and the time line
 * disappeared behind the next segment.
 *
 * Measured against the real styles rather than estimated.
 */
const BOOKING_CARD_PADDING_TALL_PX = 16;
const BOOKING_CARD_PADDING_SHORT_PX = 12;
const BOOKING_PILLS_ROW_PX = 32;
/**
 * One line of card text. A segment never gives up so much room to the action
 * tray that it cannot show even this: the tray is bottom-RIGHT and the stack
 * already reserves `paddingRight` beside it, so a short segment is better off
 * letting the tray overlap its empty right-hand side than rendering nothing.
 */
const BOOKING_CARD_MIN_ROW_PX = 20;
/**
 * The bar's own 1px top and bottom border. `border-box` means it is inside the
 * height every budget starts from, and no budget was subtracting it, so all of
 * them ran 2px optimistic. Harmless where thresholds carry slack; not harmless in
 * compact, whose thresholds sit exactly on the measured row heights.
 */
const BOOKING_CARD_BORDER_PX = 2;
/**
 * Height assumed for the day grid's column-header row until it is measured.
 * Matches the native header cell's own `min-h`, so the first paint lines the time
 * gutter up correctly for the common case (no linked columns, hours on one line).
 */
const DAY_HEADER_FALLBACK_PX = 58;
const CALENDAR_MOVE_INCREMENT_MINUTES = 1;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface PractitionerCalendarPreferences {
  viewMode?: ViewMode;
  date?: string;
  weekStart?: string;
  monthAnchor?: string;
  visibleCalendarIdsState?: string[] | null;
  /** Linked-venue columns to show (§8.2). `null` = all linked columns; otherwise a subset. */
  visibleLinkedColumnIds?: string[] | null;
  filterStatus?: string;
  startHourOverride?: number | null;
  endHourOverride?: number | null;
  /** Day-view "Compact" toggle: shrink rows so the whole day fits one vertical screen. */
  compactDay?: boolean;
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
  if (value.visibleLinkedColumnIds !== undefined && value.visibleLinkedColumnIds !== null) {
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
  if (value.compactDay !== undefined && typeof value.compactDay !== 'boolean') return false;
  return true;
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
  return calendarBookingServiceDisplayLine({
    booking: b,
    catalogService: svc ?? null,
    resourceName,
  });
}

function CalendarBookingStatusBadge({
  b,
  palette,
}: {
  b: Booking;
  /** When set, matches the parent bar stripe (avoids a second palette resolve). */
  palette?: ReturnType<typeof bookingCalendarBlockPalette>;
}) {
  const p = palette ?? bookingCalendarBlockPalette(b);
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/92 px-2 py-[3px] text-[10px] font-bold leading-none shadow-[0_1px_3px_rgba(15,23,42,0.18)] ring-1 ring-black/[0.06] backdrop-blur-md"
      // Frosted near-white chip on a saturated bar → label uses the deep status hue (accent),
      // not the bar's (now white) text colour, so it stays legible on the chip.
      style={{ color: p.accent }}
      title={calendarStatusLabel(b)}
    >
      <span className="h-1.5 w-1.5 rounded-full ring-2 ring-white/70" style={{ backgroundColor: p.accent }} aria-hidden />
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
      MIN_APPOINTMENT_CORE_DURATION_MINUTES,
      minutesAfterStart(b.booking_time, b.booking_end_time),
    );
  }
  const fromEstimated = minutesBetweenBookingStartAndEstimatedEnd(b);
  if (fromEstimated != null) {
    return Math.max(MIN_APPOINTMENT_CORE_DURATION_MINUTES, fromEstimated);
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
      MIN_APPOINTMENT_CORE_DURATION_MINUTES,
      minutesAfterStart(b.booking_time, b.booking_end_time),
    );
  }
  if (minutesBetweenBookingStartAndEstimatedEnd(b) != null) {
    return bookingDurationMinutes(b, serviceMap);
  }
  const sid = serviceIdForBooking(b);
  const core = sid ? serviceMap.get(sid)?.duration_minutes ?? 30 : 30;
  const buf = sid ? serviceMap.get(sid)?.buffer_minutes ?? 0 : 0;
  return Math.max(MIN_APPOINTMENT_CORE_DURATION_MINUTES, customerOccupyMinutes(core, buf));
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

/** The catalogue pattern for this booking's service (and variant, when it has one). */
function bookingTemplateProcessingBlocks(
  b: Booking,
  serviceMap: Map<string, AppointmentService>,
): ProcessingTimeBlock[] {
  const sid = serviceIdForBooking(b);
  const svc = sid ? serviceMap.get(sid) : undefined;
  if (!svc) return [];
  const vid = b.service_variant_id;
  const variant =
    typeof vid === 'string' && vid.trim().length > 0 ? svc.variants?.find((v) => v.id === vid) : undefined;
  const template = effectiveProcessingBlocksForTemplate({
    parentBlocks: svc.processing_time_blocks ?? [],
    variantBlocks: variant?.processing_time_blocks,
  });
  // The pattern belongs to the catalogue length it was drawn against; a booking
  // of another length (add-ons, a staff duration) has the wait after the service
  // moved to follow its own end, the way the server resolves it.
  const templateDuration = bookingTemplateDurationMinutes(b, serviceMap);
  const bookingDuration = bookingCoreDurationForProcessing(b, serviceMap);
  if (templateDuration == null || templateDuration === bookingDuration) return template;
  return fitProcessingBlocksToDuration(template, {
    fromDurationMinutes: templateDuration,
    toDurationMinutes: bookingDuration,
  }).blocks;
}

/** The catalogue length this booking's pattern was drawn against: the option's when it has its own pattern, else the service's. */
function bookingTemplateDurationMinutes(
  b: Booking,
  serviceMap: Map<string, AppointmentService>,
): number | null {
  const sid = serviceIdForBooking(b);
  const svc = sid ? serviceMap.get(sid) : undefined;
  if (!svc) return null;
  const vid = b.service_variant_id;
  const variant =
    typeof vid === 'string' && vid.trim().length > 0 ? svc.variants?.find((v) => v.id === vid) : undefined;
  if (variant && (variant.processing_time_blocks?.length ?? 0) > 0) {
    return variant.duration_minutes ?? svc.duration_minutes;
  }
  return svc.duration_minutes;
}

/**
 * What the grid paints. Resolved the same way the SERVER resolves it: a stored
 * snapshot wins even when empty, and only a missing one falls back to the
 * catalogue.
 *
 * This used to treat an EMPTY snapshot as missing and paint the service
 * template, so a booking whose gap had deliberately been removed still showed a
 * hatched free band, and staff dragging a client into it got "Conflicts with
 * another booking" from a server that did not believe the gap existed.
 */
function bookingProcessingBlocksForLayout(
  b: Booking,
  serviceMap: Map<string, AppointmentService>,
): ProcessingTimeBlock[] {
  const raw = b.processing_time_blocks;
  if (raw !== null && raw !== undefined) return parseProcessingTimeBlocksFromDb(raw);
  return bookingTemplateProcessingBlocks(b, serviceMap);
}

/**
 * The blocks to send when a drag changes this booking's duration. Resolution is
 * deliberately not what the grid paints (see
 * {@link processingBlocksForDurationChange}): a stored snapshot wins even when
 * empty, and only a missing one falls back to the catalogue.
 */
function bookingProcessingBlocksForPatch(
  b: Booking,
  serviceMap: Map<string, AppointmentService>,
  durationMinutes: number,
): ProcessingTimeBlock[] | null {
  return processingBlocksForDurationChange({
    snapshot: b.processing_time_blocks,
    currentDurationMinutes: bookingCoreDurationForProcessing(b, serviceMap),
    // Already fitted to the booking's current length above, so re-fit from there.
    templateBlocks: bookingTemplateProcessingBlocks(b, serviceMap),
    templateDurationMinutes: bookingCoreDurationForProcessing(b, serviceMap),
    durationMinutes,
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

/**
 * Wall-clock ranges this booking leaves its column free: its processing blocks,
 * including any that run past its end (the wait before the next service of a
 * visit). These are the ranges another booking may share a lane with it in.
 */
function bookingProcessingWallGaps(
  b: Booking,
  serviceMap: Map<string, AppointmentService>,
): MinuteRange[] {
  const wall0 = timeToMinutes(b.booking_time.slice(0, 5));
  if (!Number.isFinite(wall0)) return [];
  return bookingProcessingBlocksForLayout(b, serviceMap)
    .map((blk) => ({
      start: wall0 + blk.start_minute,
      end: wall0 + blk.start_minute + blk.duration_minutes,
    }))
    .filter((g) => g.end > g.start);
}

/**
 * The wait after this booking: processing that runs past its end, in minutes.
 * The next service of a visit stands behind it, so the visit planner needs it
 * alongside the buffer.
 */
function bookingProcessingTailMinutes(b: Booking, serviceMap: Map<string, AppointmentService>): number {
  return processingTailMinutes(
    bookingProcessingBlocksForLayout(b, serviceMap),
    bookingCoreDurationForProcessing(b, serviceMap),
  );
}

/**
 * A host bar's text and tray spans in pixels from its top edge, once nested
 * bars have taken their share. A bar with nothing nested keeps the whole box.
 */
interface HostRegionsPx {
  textTopPx: number;
  textBottomPx: number;
  trayTopPx: number;
  trayBottomPx: number;
  traySharesText: boolean;
}

function hostRegionsPx(
  layout: BookingClusterLayout,
  hostStartMin: number,
  blockHeightPx: number,
  slotHeightPx: number,
  /**
   * The bar's own free bands (processing in the middle of the appointment),
   * wall-clock. The card's text and tray keep off them exactly as they keep off
   * a nested bar: nothing about the booking is written on time the practitioner
   * is free for.
   */
  freeBands: MinuteRange[] = [],
): HostRegionsPx {
  const whole: HostRegionsPx = {
    textTopPx: 0,
    textBottomPx: blockHeightPx,
    trayTopPx: 0,
    trayBottomPx: blockHeightPx,
    traySharesText: true,
  };
  const nested = [...(layout.nestedRanges ?? []), ...freeBands];
  if (nested.length === 0 || blockHeightPx <= 0) return whole;
  const pxPerMin = slotHeightPx / SLOT_MINUTES;
  const hostEndMin = hostStartMin + blockHeightPx / pxPerMin;
  // A tray needs at least its smallest button plus a pixel each side.
  const minTraySpanMin = (BOOKING_CORNER_BUTTON_FLOOR_HEIGHT_PX + 4) / pxPerMin;
  const r = hostRegionsAroundNested({ start: hostStartMin, end: hostEndMin }, nested, minTraySpanMin);
  if (!r) return whole;
  const px = (m: number) => Math.max(0, Math.min(blockHeightPx, Math.round((m - hostStartMin) * pxPerMin)));
  return {
    textTopPx: px(r.textStart),
    textBottomPx: px(r.textEnd),
    trayTopPx: px(r.trayStart),
    trayBottomPx: px(r.trayEnd),
    traySharesText: r.traySharesText,
  };
}

/**
 * The booking's processing bands in wall-clock minutes, split the way the grid
 * treats them: `middle` bands sit before the practitioner's last busy stretch
 * and are painted pale on the card; `trailing` is the stretch from that last
 * busy minute to the booking's end, which the card does not paint at all (the
 * practitioner is free for good from there), and `tail` runs on past the
 * booking's end.
 */
function bookingFreeRegions(
  b: Booking,
  serviceMap: Map<string, AppointmentService>,
): { core: number; activeEnd: number; middle: MinuteRange[]; wall0: number } {
  const wall0 = timeToMinutes(b.booking_time.slice(0, 5));
  const core = bookingCoreDurationForProcessing(b, serviceMap);
  const blocks = bookingProcessingBlocksForLayout(b, serviceMap);
  const activeEnd = processingActiveEndMinutes(blocks, core);
  const middle = blocks
    .map((blk) => ({
      start: wall0 + blk.start_minute,
      end: wall0 + Math.min(activeEnd, blk.start_minute + blk.duration_minutes),
    }))
    .filter((g) => g.end > g.start && g.start < wall0 + activeEnd);
  return { core, activeEnd, middle, wall0 };
}

/**
 * The stretches of a bar that are painted, once its free time (the holes) is
 * taken out, in minutes from the bar's top. Each comes out as its own lozenge.
 */
function paintedPiecesMinutes(totalMinutes: number, holes: MinuteRange[]): MinuteRange[] {
  const total = Math.max(0, totalMinutes);
  const sorted = [...holes].filter((h) => h.end > h.start).sort((a, b) => a.start - b.start);
  const pieces: MinuteRange[] = [];
  let cursor = 0;
  for (const h of sorted) {
    const start = Math.max(0, Math.min(total, h.start));
    const end = Math.max(0, Math.min(total, h.end));
    if (start > cursor) pieces.push({ start: cursor, end: start });
    cursor = Math.max(cursor, end);
  }
  if (cursor < total) pieces.push({ start: cursor, end: total });
  return pieces;
}

/**
 * A bar's paint: one rounded lozenge per stretch the practitioner is busy,
 * each with the full card finish (fill, gloss, border, hairline, shadow) and
 * its own glass edge on the left. Processing time in the middle of the
 * appointment is a hole between two lozenges, so the boundary either side of
 * it looks exactly like the end of any booking bar, and the grid shows through
 * to say the time is bookable. The bar's box itself paints nothing.
 */
function BookingBarPieces({
  pieces,
  totalMinutes,
  palette,
  flash,
  guestName,
  labelledStarts = [0],
  labelLeftPx = 14,
  totalHeightPx,
}: {
  pieces: MinuteRange[];
  totalMinutes: number;
  palette: BookingBlockPalette;
  flash?: boolean;
  /**
   * Written on any lozenge that does not begin where a card's text does, so a
   * stretch cut off by a processing period still says whose it is.
   */
  guestName?: string | null;
  /** Bar minutes at which a card already carries its text (the top of the bar, each visit segment). */
  labelledStarts?: number[];
  /** Where the card's text starts from the left, so the name lines up with it. */
  labelLeftPx?: number;
  /** The bar's height, to skip the name on a piece too short to hold a line. */
  totalHeightPx?: number;
}) {
  const total = Math.max(1, totalMinutes);
  return (
    <>
      {pieces.map((piece) => {
        const heightPx =
          totalHeightPx != null ? (totalHeightPx * (piece.end - piece.start)) / total : Number.POSITIVE_INFINITY;
        const showName =
          Boolean(guestName) && !labelledStarts.includes(piece.start) && heightPx >= 20;
        return (
        <div
          key={`${piece.start}-${piece.end}`}
          className="pointer-events-none absolute inset-x-0 z-0 overflow-hidden rounded-2xl"
          style={{
            top: `${(piece.start / total) * 100}%`,
            height: `${((piece.end - piece.start) / total) * 100}%`,
            ...bookingCalendarBlockCardStyle(palette, { flash }),
          }}
          aria-hidden
        >
          {showName ? (
            <div
              className="absolute right-2 top-0 truncate pt-1 text-[12px] font-extrabold leading-tight tracking-tight"
              style={{ left: labelLeftPx }}
            >
              {guestName}
            </div>
          ) : null}
          <div
            className="absolute inset-y-0 left-0 rounded-l-[15px]"
            style={{
              width: 4,
              backgroundColor: 'rgba(255,255,255,0.22)',
              backgroundImage:
                'linear-gradient(180deg, rgba(255,255,255,0.70) 0%, rgba(255,255,255,0.30) 45%, rgba(255,255,255,0.08) 100%)',
              boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.30), 1px 0 0 rgba(0,0,0,0.06)',
            }}
          />
        </div>
        );
      })}
    </>
  );
}

/** Holds the 4px the glass edge used to take in the row, so the grip and text keep their place. */
/** "1/2": one service of a multi-service visit, drawn as its own bar. */
function VisitChip({ label }: { label: string }) {
  return (
    <span
      className="mr-1 inline-flex shrink-0 items-center rounded-full bg-white/25 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide leading-tight"
      title="One service of a multi-service visit. Move, resize, start and complete it on its own; the visit's other services have their own bars."
    >
      {label}
    </span>
  );
}

function BookingBarEdgeSpacer() {
  return <div className="shrink-0 self-stretch" style={{ width: 4, minWidth: 4 }} aria-hidden />;
}

/** Snap a clicked minute down to the diary's five minute grain, never before the band's start. */
function snapFreeClickMinute(bandStartMin: number, minuteAt: number): number {
  return Math.max(bandStartMin, Math.floor(minuteAt / 5) * 5);
}

/**
 * The bands over processing time in the MIDDLE of the appointment. The bar
 * paints nothing there (see `BookingBarPieces`), so the grid's own shading
 * shows through a faint tint, nothing about the booking is written on them,
 * and, when `onFreeClick` is given, they take the click themselves so it opens
 * the empty-slot menu for that minute rather than the booking's detail sheet.
 *
 * Processing that runs to the booking's end, or past it, is not a band: the
 * card simply stops where the practitioner's last busy stretch ends (see the
 * bar renderers), so that time reads as the empty grid it effectively is.
 */
function ProcessingFreeBands({
  b,
  serviceMap,
  wallPaintMinutes,
  onFreeClick,
}: {
  b: Booking;
  serviceMap: Map<string, AppointmentService>;
  /** When embedded in a multi-service segment, pass that segment's vertical span in minutes. */
  wallPaintMinutes?: number;
  /** Receives the wall-clock minute clicked (snapped to five minutes) and the event. */
  onFreeClick?: (wallMinute: number, e: MouseEvent) => void;
}) {
  const display = wallPaintMinutes ?? bookingCalendarDisplaySpanMinutes(b, serviceMap);
  const { middle, wall0 } = bookingFreeRegions(b, serviceMap);
  if (display <= 0 || middle.length === 0) return null;
  return (
    <>
      {middle.map((band) => {
        const topPct = ((band.start - wall0) / display) * 100;
        const heightPct = ((band.end - band.start) / display) * 100;
        const label = `Free from ${minutesToTime(band.start)} to ${minutesToTime(band.end)}: click to book`;
        return onFreeClick ? (
          <button
            key={`${band.start}-${band.end}`}
            type="button"
            className="pointer-events-auto absolute inset-x-0 z-[3] cursor-pointer bg-slate-900/[0.06] transition-colors hover:bg-brand-500/10 focus-visible:outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-300"
            style={{ top: `${topPct}%`, height: `${heightPct}%` }}
            aria-label={label}
            title="Processing time: click to book someone else in"
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              const frac = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0;
              const minuteAt = band.start + frac * (band.end - band.start);
              onFreeClick(snapFreeClickMinute(band.start, minuteAt), e);
            }}
            onMouseDown={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            key={`${band.start}-${band.end}`}
            className="pointer-events-none absolute inset-x-0 z-[3] bg-slate-900/[0.06]"
            style={{ top: `${topPct}%`, height: `${heightPct}%` }}
            aria-hidden
          />
        );
      })}
    </>
  );
}

/**
 * The invisible stretch at the foot of a card: processing that runs to the
 * booking's end. Nothing is painted there (the grid shows through), and a click
 * opens the empty-slot menu for that minute, so staff can book someone else in
 * exactly as they would on empty grid.
 */
function ProcessingFreeTail({
  heightPx,
  startWallMin,
  endWallMin,
  onFreeClick,
}: {
  heightPx: number;
  startWallMin: number;
  endWallMin: number;
  onFreeClick?: (wallMinute: number, e: MouseEvent) => void;
}) {
  if (heightPx <= 0) return null;
  const label = `Free from ${minutesToTime(startWallMin)} to ${minutesToTime(endWallMin)}: click to book`;
  return (
    <button
      type="button"
      className={`absolute inset-x-0 bottom-0 z-[3] ${
        onFreeClick ? 'cursor-pointer hover:bg-brand-500/5' : 'cursor-default'
      } focus-visible:outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-300`}
      style={{ height: heightPx }}
      aria-label={label}
      title={onFreeClick ? 'Processing time: click to book someone else in' : undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (!onFreeClick) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const frac = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0;
        onFreeClick(snapFreeClickMinute(startWallMin, startWallMin + frac * (endWallMin - startWallMin)), e);
      }}
      onMouseDown={(e) => e.stopPropagation()}
    />
  );
}

/**
 * Where a booking's turnover sits: it starts once the practitioner's time with
 * the client, and any processing that runs on past it, has ended. Null when
 * the service has no buffer.
 */
function bookingBufferBandMinutes(
  b: Booking,
  serviceMap: Map<string, AppointmentService>,
): { startWallMin: number; minutes: number } | null {
  const minutes = bookingBufferMinutes(b, serviceMap);
  if (minutes <= 0) return null;
  const wall0 = timeToMinutes(b.booking_time.slice(0, 5));
  if (!Number.isFinite(wall0)) return null;
  const core = bookingCoreDurationForProcessing(b, serviceMap);
  const tail = processingTailMinutes(bookingProcessingBlocksForLayout(b, serviceMap), core);
  return { startWallMin: wall0 + core + tail, minutes };
}

/**
 * A booking's buffer, drawn as blocked time directly under its bar (after any
 * processing that runs on past the service). Nothing can be booked into it,
 * and that was invisible: the slots were simply dead to the mouse, so staff
 * saw empty grid they could not use. Hatched like a block, with no card text,
 * so it reads as turnover rather than as another appointment. It takes no
 * clicks; the slot under it is disabled anyway.
 */
function BookingBufferBand({
  topPx,
  heightPx,
  left,
  width,
}: {
  topPx: number;
  heightPx: number;
  left: string;
  width: string;
}) {
  if (heightPx <= 0) return null;
  return (
    <div
      className="pointer-events-none absolute z-[12] overflow-hidden rounded-b-lg border-t border-dashed border-slate-400/80 bg-slate-300/40"
      style={{
        top: topPx,
        height: heightPx,
        left,
        width,
        backgroundImage:
          'repeating-linear-gradient(-45deg, transparent 0 4px, rgba(15,23,42,0.10) 4px 8px)',
      }}
      aria-hidden
    >
      {heightPx >= 14 ? (
        <span className="absolute left-2 top-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-600">
          Buffer
        </span>
      ) : null}
    </div>
  );
}


/**
 * Grid lines, one step darker per weight than they were: the hour line reads
 * as a rule, the half hour as a clear division, and the quarter hour is
 * visible rather than a hint (staff asked for a grid they could see).
 */
function calendarGridLineClass(minutes: number): string {
  if (minutes % 60 === 0) return 'border-t-slate-500';
  if (minutes % 30 === 0) return 'border-t-slate-400';
  return 'border-t-slate-200';
}

/** Alternate 15 minute slots carry a tint strong enough to count by. */
function calendarSlotBandClass(minutes: number): string {
  const slotIndex = Math.max(0, Math.floor(minutes / SLOT_MINUTES));
  return slotIndex % 2 === 1 ? 'bg-slate-100/80' : 'bg-white';
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

type BookingCluster = { kind: 'single'; booking: Booking };

/**
 * One bar per booking row, in time order.
 *
 * Rows of a multi-service visit used to be merged into one bar here; they are now drawn
 * as independent bars (Docs/visit-services-independent-plan.md), each with its own grip,
 * handle and tray, and the visit shows as identity (chip, shared colour, hover) instead.
 */
function clusterMultiServiceBookings(bookings: Booking[]): BookingCluster[] {
  return [...bookings]
    .sort((a, b) => timeToMinutes(a.booking_time) - timeToMinutes(b.booking_time))
    .map((booking) => ({ kind: 'single' as const, booking }));
}

function clusterKey(cluster: BookingCluster): string {
  return cluster.booking.id;
}

function clusterTimeRange(cluster: BookingCluster, getDuration: (booking: Booking) => number): { start: number; end: number } {
  const start = timeToMinutes(cluster.booking.booking_time);
  return { start, end: start + getDuration(cluster.booking) };
}

/**
 * Lane and nesting layout for one column's clusters. A cluster that fits
 * entirely inside another's processing gap nests in it (drawn indented over the
 * host's band) rather than forcing both into half-width lanes; see
 * `layoutOverlapClusters`. `getProcessingGaps` supplies each booking's free
 * wall-clock ranges; a visit's gaps are the union of its segments'.
 */
function computeBookingClusterLayouts(
  clusters: BookingCluster[],
  getDuration: (booking: Booking) => number,
  getProcessingGaps: (booking: Booking) => MinuteRange[],
): Map<string, BookingClusterLayout> {
  return layoutOverlapClusters(
    clusters.map((cluster) => {
      const members = [cluster.booking];
      return {
        key: clusterKey(cluster),
        ...clusterTimeRange(cluster, getDuration),
        gaps: members.flatMap(getProcessingGaps),
      };
    }),
  );
}

/** Deposit + attendance “Confirmed” pill — bottom-left; pill uses white + indigo ring to read on any block hue. */
/**
 * True when {@link BookingBlockPills} would render at least one pill. Used to gate
 * the pills row (and its top divider) so an empty row — which would otherwise show
 * just a thin separator line across the bar — never renders.
 */
function bookingHasBlockPills(b: Booking): boolean {
  return (
    (showDepositPendingPill(b) && ['Pending', 'Booked', 'Confirmed'].includes(b.status)) ||
    (showAttendanceConfirmedSupplementPill(b) && ['Pending', 'Booked', 'Seated'].includes(b.status)) ||
    ((b.addons_count ?? 0) > 0 && (b.booking_addon_labels?.length ?? 0) === 0)
  );
}

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
      {(b.addons_count ?? 0) > 0 && (b.booking_addon_labels?.length ?? 0) === 0 && (
        <span
          className="inline-block rounded-lg bg-white/95 px-1.5 py-0.5 text-center text-[8px] font-semibold leading-snug text-sky-800 shadow-sm ring-1 ring-sky-300 sm:text-[9px]"
          title={`${b.addons_count} add-on${b.addons_count === 1 ? '' : 's'} on this booking`}
        >
          +{b.addons_count} extra{b.addons_count === 1 ? '' : 's'}
        </span>
      )}
    </>
  );
}

/** Bottom strip for duration resize (hit target height). */
const BOOKING_RESIZE_HANDLE_HEIGHT_PX = 18;
/** Space kept between interactive booking chrome and resize gestures (paint + cushion so actions never butt the slider). */
const BOOKING_RESERVE_ABOVE_RESIZE_PX = BOOKING_RESIZE_HANDLE_HEIGHT_PX + 1;

/**
 * A duration resize must be deliberately *armed* by pressing and holding the slider
 * for this long before height drags take effect. Without it a stray touch — typically
 * brushing the thin handle while scrolling the calendar on mobile — could nudge a
 * booking's end time. Keep in sync with the `animate-resize-hold` keyframe duration
 * in globals.css (the press-and-hold progress fill).
 */
const BOOKING_RESIZE_HOLD_MS = 1000;
/** Pointer travel (px) during the hold that aborts arming — i.e. the press was really a scroll/scrub, not a deliberate resize. */
const BOOKING_RESIZE_HOLD_TOLERANCE_PX = 10;
/**
 * How far into a press-and-hold the day grid stretches to the whole day for a
 * move or resize: well before the hold activates the drag, and later than any
 * click lasts.
 */
const GRID_EXTENSION_ARM_MS = 300;

/**
 * Press-and-hold affordance shown over a booking gesture handle while it is arming
 * (before {@link BOOKING_RESIZE_HOLD_MS} elapses). The filling bar mirrors the hold
 * timer so the user learns the handle must be held ~1s before it takes effect — the
 * cue that makes the accidental-edit guards (duration resize and drag-to-reschedule)
 * discoverable. `placement` is 'bottom' for the duration slider, 'center' for the
 * move grip (which spans the card's full height).
 */
function ResizeHoldHint({ label, placement = 'bottom' }: { label: string; placement?: 'bottom' | 'center' }) {
  return (
    <span
      role="status"
      className={`pointer-events-none absolute left-1/2 z-[44] flex -translate-x-1/2 select-none flex-col items-center gap-1 whitespace-nowrap rounded-md bg-slate-900/95 px-2 py-1 text-[10px] font-semibold leading-none text-white shadow-md ${
        placement === 'center' ? 'top-1/2 -translate-y-1/2' : ''
      }`}
      style={placement === 'bottom' ? { bottom: BOOKING_RESERVE_ABOVE_RESIZE_PX } : undefined}
    >
      <span>{label}</span>
      <span className="h-[3px] w-12 overflow-hidden rounded-full bg-white/25" aria-hidden>
        <span className="animate-resize-hold block h-full w-full origin-left rounded-full bg-white" />
      </span>
    </span>
  );
}

/** Deferred guest modification notify after calendar drag: Confirm or timer end. */
const BOOKING_MODIFY_NOTIFY_DEFER_MS = 60_000;

/** Left strip for drag-to-reschedule; ~25% narrower than former w-6 / w-3. */
const BOOKING_DRAG_HANDLE_WIDTH_DEFAULT_PX = 18;
const BOOKING_DRAG_HANDLE_WIDTH_OVERLAP_PX = 9;

/**
 * Outline separating an action button from whatever colour its bar is painted.
 *
 * Label-on-button contrast was always fine; the button's own EDGE was not. On a
 * started (Seated) bar "Complete" measured 1.02:1 against the fill behind it, so
 * the control read as text floating on the bar rather than as a button. One border
 * colour cannot fix this, because bar fills run from dark navy to light amber, so
 * the ring is two-tone: the white inner edge carries the dark fills, the dark outer
 * edge carries the light ones, and one of the two always clears WCAG 1.4.11's 3:1.
 */
const BOOKING_CORNER_BUTTON_OUTLINE =
  '0 0 0 1px rgba(255,255,255,0.92), 0 0 0 2.5px rgba(15,23,42,0.50), 0 1px 2px rgba(15,23,42,0.35)';

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

/** Action buttons should stay compact on tall booking bars rather than stretching to fill the card. */
const BOOKING_ACTION_BUTTON_MAX_HEIGHT_CLASS = 'max-h-9';
/**
 * Vertical padding inside a booking card, and the height budget that must match it.
 *
 * `paddingBottom` is set separately (the tray and resize strip own that edge), so
 * only the top is spent here. The shortest tier exists because a 19px bar was
 * spending 6px on padding and then clipping the single row it had room for: the
 * service name was sliced off at the bar's bottom edge.
 */
function bookingCardPadding(blockHeightPx: number): { topPx: number; budgetPx: number } {
  if (blockHeightPx >= 56) return { topPx: 8, budgetPx: BOOKING_CARD_PADDING_TALL_PX };
  if (blockHeightPx >= 32) return { topPx: 6, budgetPx: BOOKING_CARD_PADDING_SHORT_PX };
  return { topPx: 2, budgetPx: 4 };
}

const BOOKING_CARD_ROW_PAD_RESERVE_PX = 8;

function narrowBookingActionsWidthPx(shellRowWidthPx: number | null | undefined): number | null {
  if (shellRowWidthPx == null || shellRowWidthPx <= 0) return null;
  const actionBudget = Math.max(64, Math.min(88, shellRowWidthPx - BOOKING_CARD_ROW_PAD_RESERVE_PX));
  return Math.min(shellRowWidthPx, actionBudget);
}

const BOOKING_CORNER_BUTTON_BASE_CLASS =
  `inline-flex min-w-0 shrink-0 ${BOOKING_ACTION_BUTTON_MAX_HEIGHT_CLASS} items-center justify-center whitespace-nowrap px-2 py-1 text-center font-semibold leading-tight [overflow-wrap:anywhere]`;

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

  // On very short bars the button compresses its HEIGHT via tighter top/bottom padding
  // (overriding the base `py-1`) while its width is left untouched — a short bar must never
  // make the action buttons narrower.
  // A button cannot render shorter than its own line box plus padding, so the
  // padding has to come off too or the planned height is a number the DOM ignores:
  // a 16px bar asked for 14px and got 18px, overhanging the bar.
  const tightVertical = buttonMinHeightPx > 0 && buttonMinHeightPx < 22;
  const veryTightVertical = buttonMinHeightPx > 0 && buttonMinHeightPx <= 18;
  const buttonStyle: CSSProperties =
    buttonMinHeightPx > 0
      ? {
          minHeight: `${buttonMinHeightPx}px`,
          fontSize: `${fontSizePx}px`,
          lineHeight: veryTightVertical ? 1 : 1.2,
          boxShadow: BOOKING_CORNER_BUTTON_OUTLINE,
          ...(veryTightVertical
            ? { paddingTop: '1px', paddingBottom: '1px' }
            : tightVertical
              ? { paddingTop: '2px', paddingBottom: '2px' }
              : {}),
        }
      : {
          fontSize: `${fontSizePx}px`,
          lineHeight: 1.2,
          boxShadow: BOOKING_CORNER_BUTTON_OUTLINE,
        };

  const out: ReactElement[] = [];

  if (b.status === 'Completed') {
    out.push(
      <button
        key="reopen"
        type="button"
        disabled={busy}
        style={buttonStyle}
        onClick={() => onStatus(b.id, 'Seated')}
        className={`${baseClass} rounded-lg font-semibold shadow-sm transition disabled:opacity-50 ${bookingTransitionButtonSurface('Seated')}`}
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
            className={`${baseClass} rounded-lg border border-[#D97706] bg-[#FEF3C7] font-semibold text-[#78350F] shadow-sm transition hover:bg-[#FDE68A] disabled:opacity-50`}
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
          className={`${baseClass} rounded-lg font-semibold shadow-sm transition disabled:opacity-50 ${bookingTransitionButtonSurface('Booked')}`}
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
          className={`${baseClass} rounded-lg font-semibold shadow-sm transition disabled:opacity-50 ${bookingTransitionButtonSurface('Seated')}`}
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
            className={`${baseClass} rounded-lg font-semibold transition disabled:opacity-50 ${bookingTransitionButtonSurface('Booked')}`}
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
          className={`${baseClass} rounded-lg font-semibold shadow-sm outline-none transition-colors duration-150 disabled:opacity-50 ${bookingTransitionButtonSurface('Completed')}`}
        >
          Complete
        </button>,
      );
    }
  }

  return out;
}

/** Translates a booking's status into the shape the corner-action planner understands. */
function bookingCornerActionInput(b: Booking): BookingCornerActionInput {
  return {
    fullActionCount: countBookingRightColumnActions(b),
    hasArrivalToggle: bookingHasArrivalToggleInRightColumn(b),
    showsSeatedUndo: bookingShowsSeatedUndoInRightColumn(b),
  };
}

/**
 * Padding for booking info so text stays clear of the bottom-right action tray.
 *
 * Horizontal clearance by default. The tray is a fixed-width column pinned to
 * the bottom-right, so `right` keeps every text row out of its column for the
 * whole height of the bar, and the text can then run the full height without
 * ever reaching it. Reserving the stack's HEIGHT as well was reserving the same
 * space twice: on a 30 minute bar that took 84px of 94px and left 2px for text,
 * which rendered as a lone 10px name.
 *
 * Vertical clearance when the lane is narrow. In an overlap lane that same
 * 76px gutter took nearly the whole width, so every bar in a three-way cluster
 * showed "J..." above three rows of ellipsis. Once the row has been measured
 * and the column beside the tray would be too narrow to read, the tray drops
 * BELOW the text instead and `bottom` carries its footprint, so the text runs
 * the full lane. The decision lives in `planBookingActionClearance` so the
 * tray is drawn against the same height the gutter was planned from.
 *
 * @param shellRowWidthPx measured width of the text-plus-tray row; `null` until layout
 * @param textPaddingPx vertical padding the text button spends on itself
 */
function computeBookingActionCornerInset(
  b: Booking,
  blockHeightPx: number,
  shellRowWidthPx: number | null | undefined,
  textPaddingPx: number,
): BookingActionClearance {
  return planBookingActionClearance(
    bookingCornerActionInput(b),
    blockHeightPx,
    shellRowWidthPx,
    textPaddingPx,
    BOOKING_CARD_MIN_ROW_PX,
  );
}

/** Transparent hit target at the bottom-right; only as tall/wide as its buttons. */
function CalendarBookingActionsTray({
  children,
  bottomPx,
  rightPx,
  maxWidthPx,
  topGapPx = BOOKING_ACTION_TRAY_TOP_GAP_PX,
  padTopPx,
  padBottomPx,
}: {
  children: ReactNode;
  bottomPx: number;
  rightPx: number;
  maxWidthPx?: number;
  topGapPx?: number;
  /**
   * Tray padding, inline rather than fixed classes so a short bar can collapse it.
   * The planner sizes the stack against these exact values, so a class that says
   * otherwise would let `maxHeight` clip the button the plan just made room for.
   */
  padTopPx: number;
  padBottomPx: number;
}) {
  return (
    <div
      className="pointer-events-none absolute z-20 flex h-auto w-auto flex-col justify-end gap-1 px-0.5"
      style={{
        bottom: bottomPx,
        right: rightPx,
        paddingTop: padTopPx,
        paddingBottom: padBottomPx,
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
  bottomOffsetPx = 0,
}: {
  b: Booking;
  busy: boolean;
  blockHeightPx: number;
  /** Lifts the tray off the bar's bottom edge, when a nested bar covers it. */
  bottomOffsetPx?: number;
  onStatus: (id: string, next: BookingStatus) => void;
  onArrived: (id: string, arrived: boolean) => void;
  narrow?: boolean;
  /** Width of guest+actions row; constrains action columns so the contact name is not cropped. */
  shellRowWidthPx?: number | null;
  /** Overlap lanes should not reserve a full-width row below the booking content. */
  floating?: boolean;
}) {
  const { omitArrivalActions, omitSeatedUndoActions, layout, actionCount } =
    planBookingCornerActions(bookingCornerActionInput(b), blockHeightPx);

  const actionNodes = actionCount <= 0 ? [] : collectBookingRightColumnActionNodes({
    b,
    busy,
    onStatus,
    onArrived,
    baseClass: BOOKING_CORNER_BUTTON_BASE_CLASS,
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

  // A short bar spends its height on the button, not on the spacing around it.
  // These are the exact values `planBookingCornerActions` budgeted against.
  const spacing = bookingCornerTraySpacing(blockHeightPx);

  return (
    <CalendarBookingActionsTray
      padTopPx={spacing.padTopPx}
      padBottomPx={spacing.padBottomPx}
      // The spacing already carries the corner inset the resize strip needs, and
      // taking the larger of the two put the tray 3px above where the plan sized
      // it, so the button overhung the top edge of every short bar.
      bottomPx={spacing.bottomInsetPx + bottomOffsetPx}
      rightPx={BOOKING_CORNER_TRAY_RIGHT_PX}
      maxWidthPx={trayMaxWidthPx}
      topGapPx={spacing.topGapPx}
    >
      <div
        // Always a stack, always this wide: every button on every bar matches
        // regardless of its label or its bar's height. Only the button HEIGHT
        // adapts, which `bookingCornerActionLayout` handles.
        style={{ width: BOOKING_ACTION_BUTTON_WIDTH_PX }}
        className="pointer-events-auto flex h-auto max-w-full flex-col items-stretch gap-1 [&_button]:!h-auto [&_button]:!flex-none [&_button]:!basis-auto [&_button]:!grow-0"
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
  getServiceMap: (b: Booking) => Map<string, AppointmentService>,
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
      const busyIv = practitionerWallBusyIntervalsForBooking(b, getServiceMap(b));
      if (busyIv.some((iv) => overlapsRange(slotStart, slotEnd, iv.start, iv.end))) return true;
    }
  }
  for (const bl of blocks) {
    if (excludeBlockId && bl.id === excludeBlockId) continue;
    if (!isOccupyingBlock(bl.block_type)) continue;
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

/**
 * True if the window lands on hours the venue or the person does not normally
 * work. Drives the amber "moved outside opening hours" note; see
 * `isNonWorkingBlock` for which types count and why (SA-H5).
 */
function windowCrossesNonWorkingBlock(
  startMin: number,
  endMin: number,
  pracId: string,
  dateStr: string,
  blocks: CalendarBlock[],
): boolean {
  for (const bl of blocks) {
    if (!isNonWorkingBlock(bl.block_type)) continue;
    if (columnIdForBlock(bl) !== pracId || bl.block_date !== dateStr) continue;
    const b0 = timeToMinutes(bl.start_time);
    const b1 = b0 + minutesBetweenStartAndEnd(bl.start_time, bl.end_time);
    if (overlapsRange(startMin, endMin, b0, b1)) return true;
  }
  return false;
}

/**
 * True if the window lands on a staff break.
 *
 * Tracked apart from `windowCrossesNonWorkingBlock` because the server keeps
 * the two permissions apart: `allow_outside_hours` has never relaxed the
 * engine's break gate, so a move over a break needs `allow_during_breaks` sent
 * with it or the PATCH comes back 409 "Conflicts with a break" (SA-H5).
 */
function windowCrossesBreakBlock(
  startMin: number,
  endMin: number,
  pracId: string,
  dateStr: string,
  blocks: CalendarBlock[],
): boolean {
  for (const bl of blocks) {
    if (!isBreakCalendarBlock(bl)) continue;
    if (columnIdForBlock(bl) !== pracId || bl.block_date !== dateStr) continue;
    const b0 = timeToMinutes(bl.start_time);
    const b1 = b0 + minutesBetweenStartAndEnd(bl.start_time, bl.end_time);
    if (overlapsRange(startMin, endMin, b0, b1)) return true;
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
  getServiceMap: (b: Booking) => Map<string, AppointmentService>,
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
      const otherBusy = practitionerWallBusyIntervalsForBooking(b, getServiceMap(b));
      for (const c of candIntervals) {
        for (const o of otherBusy) {
          if (overlapsRange(c.start, c.end, o.start, o.end)) return true;
        }
      }
    }
  }
  for (const bl of blocks) {
    if (options?.excludeBlockId && bl.id === options.excludeBlockId) continue;
    if (!isOccupyingBlock(bl.block_type)) continue;
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
  slotHeightPx,
  disabled,
  onEmptyClick,
}: {
  id: string;
  pracId: string;
  dateStr: string;
  slotStartMins: number;
  top: number;
  slotHeightPx: number;
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
      // The global `button { transition: all }` rule would also animate `top`,
      // and a slot that is still gliding into place when dnd-kit measures the
      // drop targets (the grid stretches while a hold arms) is measured wrong.
      style={{ top, height: slotHeightPx, transitionProperty: 'background-color, border-color' }}
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
  movePreview?: { label: string; invalid: boolean; outsideHours?: boolean } | null;
}) {
  const p = bookingCalendarBlockPalette(booking);
  return (
    <div
      className="flex max-w-[min(90vw,20rem)] flex-col overflow-hidden rounded-xl border-2 border-dashed border-brand-200/90 bg-white/95 shadow-2xl shadow-slate-900/15 ring-1 ring-brand-100/70"
      style={{ borderLeftWidth: 4, borderLeftStyle: 'solid', borderLeftColor: p.accent }}
    >
      {movePreview ? (
        <div
          className={`border-b border-black/10 px-2 py-1 text-center text-[10px] font-bold leading-snug ${
            movePreview.invalid
              ? 'bg-red-600 text-white'
              : movePreview.outsideHours
                ? 'bg-amber-500 text-white'
                : 'bg-slate-900 text-white'
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

const SINGLE_LANE_LAYOUT: BookingClusterLayout = { laneIndex: 0, laneCount: 1 };

/** Lights (or clears) every bar of a visit; see `.calendar-visit-hover` in globals.css. */
function setVisitHover(groupId: string, on: boolean): void {
  if (typeof document === 'undefined') return;
  for (const el of document.querySelectorAll<HTMLElement>(`[data-visit="${CSS.escape(groupId)}"]`)) {
    el.classList.toggle('calendar-visit-hover', on);
  }
}

const DraggableBookingShell = memo(function DraggableBookingShell({
  booking,
  top,
  height,
  slotHeightPx,
  heightExtraPx = 0,
  layout = SINGLE_LANE_LAYOUT,
  canDrag,
  raised = false,
  visitGroupId = null,
  spineTop = null,
  spineBottom = null,
  children,
}: {
  booking: Booking;
  top: number;
  height: number;
  /** Runtime slot height (comfortable 48px, or the smaller compact-fit value). */
  slotHeightPx: number;
  /** Live vertical stretch while resizing (pixels). */
  heightExtraPx?: number;
  /** Lane, or the host it nests inside; see `layoutOverlapClusters`. */
  layout?: BookingClusterLayout;
  canDrag: boolean;
  /**
   * Outlines and lifts the bar while the screen-bottom notify / skip / undo
   * bar is about it, so staff can see which booking that prompt refers to.
   */
  raised?: boolean;
  /**
   * The visit this bar is one service of. Hovering any bar of a visit lights every
   * bar of it, so siblings that have drifted apart still read as one booking.
   */
  visitGroupId?: string | null;
  /**
   * Colour of a short spine drawn at the top / bottom edge where this bar touches a
   * sibling of the same visit in the same column; null draws none.
   */
  spineTop?: string | null;
  spineBottom?: string | null;
  children: (handle: DraggableHandleProps) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: `booking-${booking.id}`,
    disabled: !canDrag,
    data: { booking },
  });
  /**
   * The last place a bar's height was rounded up to a whole grid slot.
   *
   * `slotHeightFromDuration` draws to scale and the drag handle clamps to the
   * engine's 5 minute minimum, but this clamp sat above both and quietly restored
   * a full slot: dragging a booking shorter moved the time label and left the bar
   * exactly the same size, and a saved 5 minute appointment still painted 15.
   */
  const totalHeight = Math.max(BOOKING_BLOCK_MIN_RENDER_HEIGHT_PX, height + heightExtraPx);
  const horizontal = clusterLayoutHorizontalStyle(layout);
  /**
   * The bar stays where it was while it is dragged, faded, as the origin
   * marker; the DragOverlay card and the drop outline are the moving parts.
   * dnd-kit hands a node only the pointer's viewport delta while an overlay is
   * mounted (`appliedTranslate`), so translating the bar as well had it drift
   * by exactly the scroll distance whenever the diary scrolled mid-drag, away
   * from the outline that marks where the booking will land.
   */
  const style = {
    top,
    height: totalHeight,
    left: horizontal.left,
    width: horizontal.width,
    zIndex: isDragging ? 50 : raised ? 48 : horizontal.zIndex,
    opacity: isDragging ? 0.4 : 1,
    pointerEvents: isDragging ? 'none' : undefined,
  } as CSSProperties;
  const handleProps: DraggableHandleProps = canDrag
    ? { listeners, attributes, setActivatorNodeRef }
    : { listeners: undefined, attributes: undefined, setActivatorNodeRef: () => {} };
  return (
    <div
      ref={setNodeRef}
      // Lane and nesting changes glide rather than snap: a resize that carries a
      // booking out of a processing gap re-lanes it mid-drag, and a drop that
      // lands one in a gap tucks it in. Top and height are deliberately NOT
      // animated; both are under the pointer's direct control during a drag.
      className={`absolute motion-safe:transition-[left,width] motion-safe:duration-200 motion-safe:ease-out ${
        raised ? 'rounded-2xl ring-2 ring-brand-500 ring-offset-2 ring-offset-white' : ''
      }`}
      style={style}
      data-visit={visitGroupId ?? undefined}
      // Plain DOM class toggling on purpose: hover must not re-render the grid.
      onMouseEnter={visitGroupId ? () => setVisitHover(visitGroupId, true) : undefined}
      onMouseLeave={visitGroupId ? () => setVisitHover(visitGroupId, false) : undefined}
    >
      {children(handleProps)}
      {spineTop ? (
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 z-[4] h-1.5 w-1.5 -translate-x-1/2 rounded-b-full"
          style={{ backgroundColor: spineTop }}
        />
      ) : null}
      {spineBottom ? (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-1/2 z-[4] h-1.5 w-1.5 -translate-x-1/2 rounded-t-full"
          style={{ backgroundColor: spineBottom }}
        />
      ) : null}
    </div>
  );
});

function DragBlockPreview({
  block,
  movePreview,
}: {
  block: CalendarBlock;
  movePreview?: { label: string; invalid: boolean; outsideHours?: boolean } | null;
}) {
  const heading = calendarBlockHeading(block);
  const label = block.reason?.trim() ? `${heading}: ${block.reason.trim()}` : heading;
  const accent = isBreakCalendarBlock(block) ? '#d97706' : '#94a3b8';
  const shellClass = isBreakCalendarBlock(block)
    ? 'border-amber-300 bg-amber-50/95'
    : 'border-slate-400 bg-slate-200/95';
  return (
    <div
      className={`flex max-w-[min(90vw,16rem)] flex-col overflow-hidden rounded-lg border-2 border-dashed shadow-2xl shadow-slate-900/15 ${shellClass}`}
      style={{ borderLeftWidth: 4, borderLeftColor: accent }}
    >
      {movePreview ? (
        <div
          className={`border-b border-black/10 px-2 py-1 text-center text-[10px] font-bold leading-snug ${
            movePreview.invalid
              ? 'bg-red-600 text-white'
              : movePreview.outsideHours
                ? 'bg-amber-500 text-white'
                : 'bg-slate-900 text-white'
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
  slotHeightPx,
  heightExtraPx = 0,
  canDrag,
  clickThrough = false,
  children,
}: {
  block: CalendarBlock;
  top: number;
  height: number;
  /** Runtime slot height (comfortable 48px, or the smaller compact-fit value). */
  slotHeightPx: number;
  heightExtraPx?: number;
  canDrag: boolean;
  /**
   * Let clicks reach the empty-slot button underneath.
   *
   * The shell is an overlay at z-index 15 and the slot buttons sit at z-0, so
   * whatever the availability rules say, a block physically covers the slots it
   * spans: its inner button is `disabled` for closures and breaks, which
   * swallows the click rather than passing it down. Making a closure block
   * non-occupying therefore fixed the rule and changed nothing a receptionist
   * could do, because every minute under it was covered by the block and dead
   * to the mouse (SA-H3, first found on the since-retired amended-hours band).
   *
   * Drag and drop never had the problem: dnd-kit resolves a drop by pointer
   * collision against registered droppable rects, which ignores z-order, so the
   * drag path exercised the fixed rule and the click path could not.
   */
  clickThrough?: boolean;
  children: (handle: DraggableHandleProps) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: `block-${block.id}`,
    disabled: !canDrag,
    data: { block },
  });
  const totalHeight = Math.max(slotHeightPx * 0.5, height + heightExtraPx);
  // Stays put while dragged, as DraggableBookingShell does and for the same reason.
  const style = {
    top,
    height: totalHeight,
    zIndex: isDragging ? 50 : 15,
    opacity: isDragging ? 0.4 : 1,
    pointerEvents: isDragging || clickThrough ? 'none' : undefined,
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

function linkedSlotTop(time: string, startHour: number, slotHeightPx: number): number {
  return ((linkedTimeToMinutes(time) - startHour * 60) / SLOT_MINUTES) * slotHeightPx;
}

function linkedBlockHeight(start: string, end: string | null, slotHeightPx: number): number {
  if (!end) return slotHeightPx;
  const d = linkedTimeToMinutes(end) - linkedTimeToMinutes(start);
  return Math.max((d / SLOT_MINUTES) * slotHeightPx, slotHeightPx * 0.6);
}

function linkedBookingUsesExpandedDetail(column: LinkedColumn): boolean {
  return column.visibility === 'full_details';
}

function linkedBookingIsClickable(column: LinkedColumn, b: LinkedBooking): boolean {
  return column.visibility === 'full_details' && b.status !== 'Cancelled';
}

function linkedBookingStatusBooking(
  b: LinkedBooking,
  overlay: BookingRowOverlay = {},
): Booking {
  return applyBookingRowOverlayFields(
    {
      status: b.status,
      client_arrived_at: b.clientArrivedAt ?? null,
      booking_model: b.bookingModel ?? null,
      guest_attendance_confirmed_at: b.guestAttendanceConfirmedAt ?? null,
      staff_attendance_confirmed_at: b.staffAttendanceConfirmedAt ?? null,
    } as unknown as Booking,
    overlay,
  );
}

function linkedBookingCardContent(
  b: LinkedBooking,
  visibility: LinkedColumn['visibility'],
  venueName: string,
) {
  const timeOnly = visibility === 'time_only';
  const start = b.bookingTime.slice(0, 5);
  const end = (b.bookingEndTime ?? b.estimatedEndTime ?? b.bookingTime).slice(0, 5);
  if (timeOnly) {
    return {
      name: `${venueName}: busy`,
      service: null as string | null,
      phone: null as string | null,
      start,
      end,
      showStatus: false,
    };
  }
  return {
    name: b.guestName?.trim() || 'Guest',
    service: b.serviceName?.trim() || null,
    phone: b.guestPhone ? formatPhoneForDisplay(b.guestPhone) : null,
    start,
    end,
    showStatus: true,
  };
}

/** Linked booking bar — mirrors native day-grid {@link BookingCard} and week-grid chip layout. */
const LinkedBookingCalendarBar = memo(function LinkedBookingCalendarBar({
  booking,
  visibility,
  venueName,
  venueId,
  columnKey,
  serviceMap,
  variant,
  blockHeightPx = COMFORTABLE_SLOT_PX,
  rowOverlay = {},
}: {
  booking: LinkedBooking;
  visibility: LinkedColumn['visibility'];
  venueName: string;
  /** Owner venue and column, for the grid-shape conversion the processing strip reads. */
  venueId?: string;
  columnKey?: string;
  /** The owner venue's services, so the strip can fall back to the catalogue pattern. */
  serviceMap?: Map<string, AppointmentService>;
  variant: 'day-grid' | 'week-grid';
  blockHeightPx?: number;
  rowOverlay?: BookingRowOverlay;
}) {
  const content = linkedBookingCardContent(booking, visibility, venueName);
  const statusBooking = linkedBookingStatusBooking(booking, rowOverlay);
  const palette = bookingCalendarBlockPaletteWithOverlay(statusBooking, rowOverlay);
  const statusPill = content.showStatus ? (
    <CalendarBookingStatusBadge b={statusBooking} palette={palette} />
  ) : null;
  // Read-only when the link is time-only or this venue wasn't granted edit rights.
  const readOnly = visibility === 'time_only' || !booking.editable || booking.status === 'Cancelled';

  if (variant === 'week-grid') {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        {/* §19.1 — week columns are days, so each card carries its source-venue chip. */}
        <LinkedVenueChip venueName={venueName} readOnly={readOnly} />
        <div className="min-w-0">
          <div className="truncate font-bold">{content.name}</div>
          {content.service ? (
            <div className="truncate text-[10px] font-medium opacity-80">{content.service}</div>
          ) : null}
          <div className="mt-0.5 text-[10px] font-medium opacity-80">{content.start}</div>
        </div>
        {statusPill}
      </div>
    );
  }

  /**
   * The linked bar's own padding and border come out first. This handed the card
   * the RAW block height, which is the same mistake the native bars made: at 48px
   * the card laid out two rows into a 34px box and the bottom line was sliced
   * through its descenders.
   */
  const contentHeightPx = Math.max(
    0,
    blockHeightPx - BOOKING_CARD_BORDER_PX - (blockHeightPx < 56 ? 12 : 16),
  );
  const cardDensity = contentHeightPx < 56 ? 'compact' : 'comfortable';
  const blockH = blockHeightPx;

  /**
   * The same processing strip an own booking paints. A read-only linked bar
   * showed none, so a colour service on a linked column looked like one solid
   * block of time while the same booking on its own venue showed the gap.
   */
  const linkedGrid =
    venueId && columnKey ? (linkedBookingToGridBooking(booking, venueId, columnKey) as Booking) : null;
  const linkedFree = linkedGrid && serviceMap ? bookingFreeRegions(linkedGrid, serviceMap) : null;
  // The bar's own span, less the foot the column leaves unpainted (see the column below).
  const paintMinutes =
    linkedGrid && serviceMap && linkedFree
      ? Math.max(1, bookingCalendarDisplaySpanMinutes(linkedGrid, serviceMap) - (linkedFree.core - linkedFree.activeEnd))
      : undefined;
  const processingStrip =
    venueId && columnKey && serviceMap && visibility === 'full_details' ? (
      <ProcessingFreeBands
        b={linkedBookingToGridBooking(booking, venueId, columnKey) as Booking}
        serviceMap={serviceMap}
        wallPaintMinutes={paintMinutes}
      />
    ) : null;

  const linkedPaintMinutes = paintMinutes ?? 1;
  return (
    <div
      className="group relative flex h-full min-h-0 flex-row items-stretch overflow-hidden rounded-2xl"
      style={{ color: palette.text }}
    >
      <BookingBarPieces
        pieces={paintedPiecesMinutes(
          linkedPaintMinutes,
          linkedFree ? linkedFree.middle.map((m) => ({ start: m.start - linkedFree.wall0, end: m.end - linkedFree.wall0 })) : [],
        )}
        totalMinutes={linkedPaintMinutes}
        palette={palette}
        guestName={content.name}
        labelLeftPx={14}
        totalHeightPx={blockHeightPx}
      />
      <BookingBarEdgeSpacer />
      {processingStrip}
      <div
        className={`relative z-[1] flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-2.5 text-left ${
          blockH < 56 ? 'py-1.5' : 'py-2'
        }`}
      >
        <BookingCard
          name={content.name}
          service={content.service}
          phone={content.phone}
          start={content.start}
          end={content.end}
          pill={statusPill}
          contentHeightPx={contentHeightPx}
          density={cardDensity}
        />
      </div>
      {readOnly ? (
        <span
          className="pointer-events-none absolute right-1.5 top-1.5 z-[4] inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/75 text-slate-500 shadow-sm ring-1 ring-slate-900/5"
          title={`View-only: ${venueName} hasn't granted edit rights for this booking.`}
          aria-label={`Read-only linked booking from ${venueName}`}
        >
          <LinkedReadOnlyLockIcon />
        </span>
      ) : null}
    </div>
  );
});

/** Padlock glyph for read-only linked cards (§19.1 — a real icon, not an emoji). */
function LinkedReadOnlyLockIcon({ className = 'h-2.5 w-2.5' }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

/**
 * Source-venue chip for a linked booking card (§19.1): a link glyph + the venue
 * name, with a padlock appended when the booking is read-only. Conveys "linked,
 * and from whom" without relying on colour alone.
 */
function LinkedVenueChip({ venueName, readOnly }: { venueName: string; readOnly: boolean }) {
  return (
    <span
      className="linked-chip inline-flex max-w-full items-center gap-1 self-start rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
      title={
        readOnly
          ? `Linked from ${venueName} · view-only`
          : `Linked from ${venueName}`
      }
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-2.5 w-2.5 shrink-0"
      >
        <path d="M9 17H7A5 5 0 0 1 7 7h2" />
        <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
        <path d="M8 12h8" />
      </svg>
      <span className="truncate">{venueName}</span>
      {readOnly ? <LinkedReadOnlyLockIcon className="h-2.5 w-2.5 shrink-0" /> : null}
    </span>
  );
}

/**
 * One read-only day-grid column for a linked venue's practitioner (§8.2).
 * Deliberately self-contained: no droppables, no drag, no resource maths — the
 * native calendar pipeline never sees this. Visual treatment matches native columns
 * except for the linked note in the column header.
 */
const LinkedDayColumn = memo(function LinkedDayColumn({
  column,
  bookings,
  eventBlocks = [],
  classBlocks = [],
  resourceMintSlots = [],
  startHour,
  totalSlots,
  slotHeightPx,
  onBookingClick,
  onEventBlockClick,
  onClassBlockClick,
  onCreateAt,
  bookingRowOverlayForId,
  serviceMap,
}: {
  column: LinkedColumn;
  bookings: LinkedBooking[];
  /** The owner venue's services, for processing strips on this column's bars. */
  serviceMap?: Map<string, AppointmentService>;
  eventBlocks?: ScheduleBlockDTO[];
  classBlocks?: ScheduleBlockDTO[];
  resourceMintSlots?: ResourceAvailabilityMintSlot[];
  startHour: number;
  totalSlots: number;
  /** Runtime slot height (comfortable 48px, or the smaller compact-fit value). */
  slotHeightPx: number;
  onBookingClick: (b: LinkedBooking, anchor?: { x: number; y: number }) => void;
  onEventBlockClick?: (block: ScheduleBlockDTO) => void;
  onClassBlockClick?: (block: ScheduleBlockDTO, anchor: { x: number; y: number }) => void;
  /** When set, empty slots are clickable to create a booking (§4.3). */
  /** Carries the event so the caller can anchor its slot menu at the pointer. */
  onCreateAt?: (time: string, ev: MouseEvent) => void;
  bookingRowOverlayForId?: (id: string) => BookingRowOverlay;
}) {
  /**
   * The same lane and nesting layout the native grid uses. This column stacked
   * every overlap on top of the last one, so two bookings at once were one bar.
   */
  const layouts = useMemo(() => {
    const map = serviceMap ?? new Map<string, AppointmentService>();
    return layoutOverlapClusters(
      bookings.map((lb) => {
        const asGrid = linkedBookingToGridBooking(lb, column.venueId, column.key) as Booking;
        const start = linkedTimeToMinutes(lb.bookingTime);
        const end = lb.bookingEndTime
          ? linkedTimeToMinutes(lb.bookingEndTime)
          : start + bookingCalendarDisplaySpanMinutes(asGrid, map);
        return {
          key: lb.id,
          start,
          end: Math.max(end, start + 1),
          gaps: bookingProcessingWallGaps(asGrid, map),
        };
      }),
    );
  }, [bookings, column.key, column.venueId, serviceMap]);

  return (
    <div className="min-w-[min(16rem,calc(100vw-5.5rem))] flex-1 border-r border-slate-300 last:border-r-0 sm:min-w-[240px]">
      <div className="relative" style={{ height: totalSlots * slotHeightPx }}>
        {Array.from({ length: totalSlots }, (_, i) => {
          const slotStartMins = startHour * 60 + i * SLOT_MINUTES;
          return (
            <div
              key={i}
              className={`absolute left-0 w-full border-t ${calendarGridLineClass(slotStartMins)}`}
              style={{ top: i * slotHeightPx }}
              aria-hidden
            />
          );
        })}
        {resourceMintSlots.map((m, i) => (
          <ResourceAvailabilityMintBlock
            key={`linked-mint-${column.key}-${i}-${m.resourceName}`}
            slot={m}
          />
        ))}
        {onCreateAt
          ? Array.from({ length: totalSlots }, (_, i) => {
              const slotTime = minutesToTime(startHour * 60 + i * SLOT_MINUTES);
              return (
                <button
                  key={`slot-${i}`}
                  type="button"
                  onClick={(ev) => onCreateAt(slotTime, ev)}
                  className="absolute left-0 w-full transition-colors hover:bg-brand-50/60"
                  style={{ top: i * slotHeightPx, height: slotHeightPx }}
                  title={`New booking at ${slotTime}`}
                  aria-label={`New booking in ${column.venueName} at ${slotTime}`}
                />
              );
            })
          : null}
        {classBlocks.map((cb) => {
          const top = linkedSlotTop(cb.start_time, startHour, slotHeightPx);
          const height = linkedBlockHeight(cb.start_time, cb.end_time, slotHeightPx);
          const uptake =
            cb.class_booked_spots != null && cb.class_capacity != null
              ? `${cb.class_booked_spots}/${cb.class_capacity} booked`
              : cb.class_booked_spots != null
                ? `${cb.class_booked_spots} booked`
                : null;
          const accent = cb.accent_colour ?? '#6366f1';
          return (
            <div
              key={cb.id}
              className="absolute left-1 right-1 z-[18]"
              style={{ top, height }}
            >
              <button
                type="button"
                onClick={(e) => onClassBlockClick?.(cb, { x: e.clientX, y: e.clientY })}
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
        {eventBlocks.map((eb) => {
          const top = linkedSlotTop(eb.start_time, startHour, slotHeightPx);
          const height = linkedBlockHeight(eb.start_time, eb.end_time, slotHeightPx);
          const accent = eb.accent_colour ?? '#F59E0B';
          const uptake = formatEventUptakeLine(eb);
          const emptyOccurrence =
            (eb.event_booking_count ?? (eb.booking_id ? 1 : 0)) === 0;
          const shell = eb.experience_event_id ? emptyOccurrence : !eb.booking_id;
          return (
            <div
              key={eb.id}
              className="absolute left-1 right-1 z-[20]"
              style={{ top, height }}
            >
              <button
                type="button"
                onClick={() => onEventBlockClick?.(eb)}
                className={`flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border px-1.5 py-1 text-left shadow-sm transition-shadow hover:shadow-md ${
                  shell ? 'border-dashed border-amber-200 bg-amber-50/90' : 'border-slate-200 bg-white'
                }`}
                style={{ borderLeftWidth: 3, borderLeftColor: accent }}
                title={eb.title}
              >
                <span className="truncate text-xs font-semibold text-slate-900">{eb.title}</span>
                {uptake ? (
                  <span className="truncate text-[10px] text-slate-600">{uptake}</span>
                ) : null}
                <span className="mt-auto text-[10px] text-slate-400">
                  {eb.start_time.slice(0, 5)} – {eb.end_time.slice(0, 5)}
                </span>
              </button>
            </div>
          );
        })}
        {bookings.map((b) => {
          const top = linkedSlotTop(b.bookingTime, startHour, slotHeightPx);
          const height = linkedBlockHeight(b.bookingTime, b.bookingEndTime, slotHeightPx);
          const layout = layouts.get(b.id) ?? SINGLE_LANE_LAYOUT;
          const horizontal = clusterLayoutHorizontalStyle(layout, { baseZIndex: 15 });
          // Processing that runs to the booking's end is free time: the card stops
          // there, and a click on that foot does not open the booking.
          const linkedFree = serviceMap
            ? bookingFreeRegions(linkedBookingToGridBooking(b, column.venueId, column.key) as Booking, serviceMap)
            : null;
          const trailingFreePx = linkedFree
            ? Math.max(0, Math.min(height, ((linkedFree.core - linkedFree.activeEnd) / SLOT_MINUTES) * slotHeightPx))
            : 0;
          return (
            <div
              key={b.id}
              className="absolute motion-safe:transition-[left,width] motion-safe:duration-200 motion-safe:ease-out"
              style={{ top, height, left: horizontal.left, width: horizontal.width, zIndex: horizontal.zIndex }}
            >
              <button
                type="button"
                onClick={(e) =>
                  onBookingClick(b, { x: e.clientX, y: e.clientY })
                }
                className="block w-full text-left"
                style={{ height: height - trailingFreePx }}
                title={
                  linkedBookingIsClickable(column, b)
                    ? linkedBookingUsesExpandedDetail(column)
                      ? b.editable
                        ? `Edit in ${column.venueName}`
                        : `View booking · ${column.venueName}`
                      : `View booking · ${column.venueName}`
                    : `View detail · ${column.venueName}`
                }
              >
                <LinkedBookingCalendarBar
                  booking={b}
                  visibility={column.visibility}
                  venueName={column.venueName}
                  venueId={column.venueId}
                  columnKey={column.key}
                  serviceMap={serviceMap}
                  variant="day-grid"
                  blockHeightPx={height - trailingFreePx}
                  rowOverlay={bookingRowOverlayForId?.(b.id) ?? {}}
                />
              </button>
              {trailingFreePx > 0 && linkedFree ? (
                <ProcessingFreeTail
                  heightPx={trailingFreePx}
                  startWallMin={linkedFree.wall0 + linkedFree.activeEnd}
                  endWallMin={linkedFree.wall0 + linkedFree.core}
                />
              ) : null}
            </div>
          );
        })}
        {bookings.flatMap((b) => {
          if (!serviceMap || b.status === 'Cancelled') return [];
          const band = bookingBufferBandMinutes(
            linkedBookingToGridBooking(b, column.venueId, column.key) as Booking,
            serviceMap,
          );
          if (!band) return [];
          const horizontal = clusterLayoutHorizontalStyle(layouts.get(b.id) ?? SINGLE_LANE_LAYOUT, {
            baseZIndex: 15,
          });
          return [
            <BookingBufferBand
              key={`buffer-${b.id}`}
              topPx={linkedSlotTop(minutesToTime(band.startWallMin), startHour, slotHeightPx)}
              heightPx={(band.minutes / SLOT_MINUTES) * slotHeightPx}
              left={horizontal.left}
              width={horizontal.width}
            />,
          ];
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
  initialStaffCollective,
  isAdmin = false,
  currentStaffId = null,
}: {
  venueId: string;
  /** Venue admin: may amend business hours from the diary's clock button. */
  isAdmin?: boolean;
  /** For the calendar-hours dialog, which limits staff to their allocated calendars. */
  currentStaffId?: string | null;
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
  /**
   * The live collective this venue books for, resolved on the server (null when
   * there is none). When supplied the diary knows before its first paint which
   * linked columns book through the collective; when omitted it asks the API and
   * holds back the linked columns' own "New booking" buttons until it hears.
   */
  initialStaffCollective?: StaffCollectiveSummary | null;
}) {
  const { addToast } = useToast();
  const acceptUnpaidGuard = useAcceptUnpaidGuard();
  const { warmVenueBookingDetail } = useDashboardDetailCache();
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
  /**
   * Latest rendered `date`, so a value-or-updater from the toolbar can be
   * resolved ONCE. `navigateDayDirect` points all three anchors at the same day,
   * and week/month hold week-start and month-start values, so an updater cannot
   * simply be handed to each of their setters.
   */
  const dateRef = useRef(date);
  dateRef.current = date;

  const [openingHours, setOpeningHours] = useState<OpeningHours | null>(null);
  const [venueWideBlocks, setVenueWideBlocks] = useState<AvailabilityBlock[]>([]);
  const [leavePeriods, setLeavePeriods] = useState<PractitionerLeavePeriodInput[]>([]);
  const [venueTimezone, setVenueTimezone] = useState<string>('Europe/London');
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [services, setServices] = useState<AppointmentService[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  // Per-booking compliance status → at-a-glance icon on each booking bar (gated on the flag).
  const complianceRecordsEnabled = useAppointmentsFeatureFlag('compliance_records_enabled');
  const complianceBookingIds = useMemo(() => bookings.map((b) => b.id), [bookings]);
  const complianceFlags = useComplianceBookingFlags(complianceBookingIds, complianceRecordsEnabled);
  /** Optimistic status / arrived overlays until list refetch catches up (calendar bars). */
  const [calendarBookingOverlays, setCalendarBookingOverlays] = useState<Record<string, BookingRowOverlay>>(
    {},
  );
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [venueResources, setVenueResources] = useState<VenueResourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailBookingId, setDetailBookingId] = useState<string | null>(null);
  const [detailBookingOwnerVenueId, setDetailBookingOwnerVenueId] = useState<string | null>(null);
  const [detailBookingLinkedAct, setDetailBookingLinkedAct] = useState<
    LinkedVenueCalendar['action'] | null
  >(null);
  const [detailBookingAnchor, setDetailBookingAnchor] = useState<{ x: number; y: number } | null>(null);
  const [classInstanceSheet, setClassInstanceSheet] = useState<{
    instanceId: string;
    block: ScheduleBlockDTO;
  } | null>(null);
  const [classInstanceAnchor, setClassInstanceAnchor] = useState<{ x: number; y: number } | null>(null);
  const [eventInstanceSheet, setEventInstanceSheet] = useState<EventInstanceSheetSelection | null>(null);
  const [resourceInstanceSheet, setResourceInstanceSheet] = useState<{
    bookingId: string;
    resourceId: string;
    block: ScheduleBlockDTO;
  } | null>(null);
  const [resourceInstanceAnchor, setResourceInstanceAnchor] = useState<{ x: number; y: number } | null>(null);
  const [visibleCalendarIdsState, setVisibleCalendarIdsState] = useState<string[] | null>(() =>
    defaultPractitionerFilter === 'all' ? null : [defaultPractitionerFilter],
  );
  /** Linked-venue calendars (§8.2). Adjacent to the native pipeline, never merged. */
  const [linkedVenues, setLinkedVenues] = useState<LinkedVenueCalendar[]>([]);
  /** §19.3 — true when the linked-calendar fetch failed, so we show a retry notice rather than a silent empty state. */
  const [linkedLoadError, setLinkedLoadError] = useState(false);
  /** True once the first linked-calendar fetch has resolved (so zero links shows "none" not a perpetual "Loading…"). */
  const [linkedLoaded, setLinkedLoaded] = useState(false);
  /** Linked columns to show. `null` = all linked columns (default). */
  const [visibleLinkedColumnIds, setVisibleLinkedColumnIds] = useState<string[] | null>(null);
  const [linkedViewing, setLinkedViewing] = useState<
    { column: LinkedColumn; booking: LinkedBooking } | null
  >(null);
  const [linkedCreating, setLinkedCreating] = useState<
    {
      venue: LinkedVenueCalendar;
      practitionerId?: string;
      time?: string;
      /** Mirrors the own-venue slot menu: a walk-in is the same booking with `source: 'walk-in'`. */
      intent: 'new' | 'walk-in';
    } | null
  >(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  /** Filter menu: in day view, show only the columns with working hours on the selected date. */
  const [workingHoursOnly, setWorkingHoursOnly] = useState(false);
  const [guestToolbarSearchQuery, setGuestToolbarSearchQuery] = useState('');
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState<boolean | null>(null);
  const [staffBookingModal, setStaffBookingModal] = useState<null | 'new' | 'walk-in'>(null);
  /**
   * A booking dropped on a calendar that belongs to another ResNeo account. A
   * booking cannot be transferred between accounts (every row belongs to one
   * venue; the database refuses a change of venue), so the dialog says so and
   * offers the two steps that do the job: book the client on the target
   * calendar, prefilled from this booking, then cancel this one.
   */
  const [crossVenueMove, setCrossVenueMove] = useState<CrossVenueMoveDialog | null>(null);
  /** The prefill handed to the booking modal by the dialog, and the booking to offer to cancel. */
  const [crossVenueRebook, setCrossVenueRebook] = useState<CrossVenueRebook | null>(null);
  /** After the new booking is made: offer to cancel the original. */
  const [cancelOriginalPrompt, setCancelOriginalPrompt] = useState<CrossVenueRebook | null>(null);
  /**
   * The live venue collective this venue books for as one business, or null.
   * A click on a column that is one of the collective's calendars opens the
   * staff form for the collective with that calendar preselected; New and
   * Walk-in open it over the whole collective; a column outside the collective
   * (a calendar with no combined offering, or a link with no collective) keeps
   * the per-venue form it has today.
   */
  const [staffCollective, setStaffCollective] = useState<{
    id: string;
    name: string;
    memberVenueIds: string[];
    calendarIds: string[];
  } | null>(() =>
    initialStaffCollective
      ? {
          id: initialStaffCollective.id,
          name: initialStaffCollective.name,
          memberVenueIds: initialStaffCollective.memberVenueIds,
          calendarIds: initialStaffCollective.calendarIds,
        }
      : null,
  );
  /**
   * False until the collective lookup has answered either way. A linked column's
   * own "New booking" button waits for it: shown and then taken away is worse
   * than shown a moment late.
   */
  const [staffCollectiveResolved, setStaffCollectiveResolved] = useState(initialStaffCollective !== undefined);
  useEffect(() => {
    // The server answered already; nothing to ask.
    if (initialStaffCollective !== undefined) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/venue/staff-collective');
        if (!res.ok) return;
        const json = (await res.json()) as {
          collective?: { id: string; name: string; member_venue_ids: string[]; calendar_ids: string[] } | null;
        };
        if (cancelled) return;
        setStaffCollective(
          json.collective
            ? {
                id: json.collective.id,
                name: json.collective.name,
                memberVenueIds: json.collective.member_venue_ids,
                calendarIds: json.collective.calendar_ids,
              }
            : null,
        );
      } catch {
        /* the per-venue form is the fallback */
      } finally {
        if (!cancelled) setStaffCollectiveResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venueId, initialStaffCollective]);
  /**
   * Where a new booking for `calendarId` on `columnVenueId` goes: the collective, or
   * null for the venue itself. A partner column that answers with the collective
   * also loses its own "New booking" header button: New, Walk-in and a slot click
   * already book that calendar through the collective form, so the button would
   * only duplicate them. A partner outside the collective keeps its button.
   */
  const collectiveTargetFor = useCallback(
    (columnVenueId: string, calendarId: string | null): { id: string; name: string } | null => {
      if (!staffCollective) return null;
      if (!staffCollective.memberVenueIds.includes(columnVenueId)) return null;
      if (calendarId && !staffCollective.calendarIds.includes(calendarId)) return null;
      return { id: staffCollective.id, name: staffCollective.name };
    },
    [staffCollective],
  );
  const [showResourceBooking, setShowResourceBooking] = useState(false);
  const [resourceBookingResourceId, setResourceBookingResourceId] = useState<string | undefined>();
  const [resourceBookingVenue, setResourceBookingVenue] = useState<VenuePublic | null>(null);
  const [resourceBookingVenueError, setResourceBookingVenueError] = useState<string | null>(null);
  const [prefillPractitionerId, setPrefillPractitionerId] = useState<string | undefined>();
  const [prefillTime, setPrefillTime] = useState<string | undefined>();
  const [prefillDate, setPrefillDate] = useState<string | undefined>();
  /** Pre-fill staff event booking from calendar event detail (Book now). */
  const [eventBookPrefill, setEventBookPrefill] = useState<{
    eventId: string;
    date: string;
    time?: string;
    linkedOwnerVenueId?: string;
    linkedVenueName?: string;
  } | null>(null);
  const [slotMenu, setSlotMenu] = useState<{
    pracId: string;
    dateStr: string;
    time: string;
    x: number;
    y: number;
    /**
     * Set when the slot belongs to a LINKED venue's column. The menu then offers
     * only the two booking actions: "Block time" is deliberately absent, because
     * blocking an independent venue's diary is a statement about when it may
     * trade, and the §5.3 grant ladder only ever speaks about bookings.
     */
    linked?: { venue: LinkedVenueCalendar; practitionerId?: string };
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
  const [calendarDragPreview, setCalendarDragPreview] = useState<{
    label: string;
    invalid: boolean;
    /** Allowed, but lands outside opening hours — shown as an amber warning, not blocked. */
    outsideHours?: boolean;
  } | null>(null);
  const [calendarDragTarget, setCalendarDragTarget] = useState<{
    pracId: string;
    startMin: number;
    endMin: number;
    invalid: boolean;
    outsideHours?: boolean;
    /** Allowed, but lands on a break, which the server gates separately. */
    overBreak?: boolean;
  } | null>(null);
  const calendarDragTargetRef = useRef<typeof calendarDragTarget>(null);
  const [resizeVisual, setResizeVisual] = useState<{ bookingId: string; deltaYPx: number } | null>(null);
  const [resizePreviewEnd, setResizePreviewEnd] = useState<{ bookingId: string; endHm: string } | null>(null);
  const [blockResizeVisual, setBlockResizeVisual] = useState<{ blockId: string; deltaYPx: number } | null>(null);
  const [blockResizePreviewEnd, setBlockResizePreviewEnd] = useState<{ blockId: string; endHm: string } | null>(
    null,
  );
  /**
   * Which slider is mid press-and-hold, before {@link BOOKING_RESIZE_HOLD_MS} elapses and the
   * resize arms. Drives the "Hold to adjust" hint so the user knows the handle must be held
   * (and so a stray scroll-touch does not silently change a duration). Cleared on arm/cancel.
   */
  const [resizeArming, setResizeArming] = useState<{ kind: 'booking' | 'block'; id: string } | null>(null);
  /**
   * Same as {@link resizeArming} but for the drag-to-reschedule grip: which card is mid
   * press-and-hold before the dnd-kit sensor's activation delay elapses. Drives the
   * "Hold to move" hint only — real activation gating lives in the sensor constraints.
   */
  const [moveArming, setMoveArming] = useState<{ kind: 'booking' | 'block'; id: string } | null>(null);
  /** Non-passive touchmove blocker active while a dnd-kit move drag is live; grips stay pannable at rest. */
  const dragTouchScrollBlockerRef = useRef<((e: TouchEvent) => void) | null>(null);
  const justResizedBookingIdRef = useRef<string | null>(null);
  const justResizedBlockIdRef = useRef<string | null>(null);
  const [flashIds, setFlashIds] = useState<Set<string>>(() => new Set());
  const [quickActionId, setQuickActionId] = useState<string | null>(null);
  /** Single-step undo for drag-move and duration resize on the day/week grid. */
  const [lastScheduleEditUndo, setLastScheduleEditUndo] = useState<{
    kind: 'move' | 'resize';
    /** The row the toolbar and the bar's pill are keyed on. */
    prev: Booking;
  } | null>(null);
  const [scheduleUndoPending, setScheduleUndoPending] = useState(false);
  /** In-flight PATCH for drag-move / resize; undo awaits this to avoid racing the save. */
  const scheduleEditSaveRef = useRef<{
    bookingId: string;
    promise: Promise<'ok' | 'failed'>;
  } | null>(null);
  /** After a drag-reschedule succeeds, booking bar shows Confirm / Undo until timer or Confirm (toolbar undo may remain). */
  const [dragMoveConfirmBookingId, setDragMoveConfirmBookingId] = useState<string | null>(null);
  /** Seconds until deferred guest notify fires (drag-reschedule confirm strip). */
  const [modificationNotifyCountdownSec, setModificationNotifyCountdownSec] = useState<number | null>(
    null,
  );
  /** Guest modification notify for drag-reschedule fires after Confirm or {@link BOOKING_MODIFY_NOTIFY_DEFER_MS}. */
  const pendingDeferredModificationNotifyBookingIdRef = useRef<string | null>(null);
  const deferredModificationNotifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modificationNotifyCountdownIntervalRef = useRef<ReturnType<typeof globalThis.setInterval> | null>(
    null,
  );
  const guestModificationNotifyInFlightRef = useRef(false);
  const [scheduleBlocks, setScheduleBlocks] = useState<ScheduleBlockDTO[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timelineRootRef = useRef<HTMLDivElement>(null);
  /** The day grid's slot canvas (time-gutter body). Measured to fit the compact day on one screen. */
  const slotCanvasRef = useRef<HTMLDivElement>(null);
  /**
   * The day grid's sticky column-header row. Measured because the time gutter
   * beside it has to start at exactly the same y, and the header's height is
   * content-driven.
   */
  const dayHeaderRowRef = useRef<HTMLDivElement>(null);
  /** True while a drag/resize is in flight — pauses compact re-measurement so the slot ratio can't shift mid-gesture. */
  const interactingRef = useRef(false);
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

  /**
   * Drag-to-reschedule must be deliberately armed the same way as the duration slider:
   * press and hold the grip for {@link BOOKING_RESIZE_HOLD_MS} before the booking starts
   * moving. Movement past the tolerance during the hold (i.e. a scroll) aborts activation,
   * so brushing the grip while scrolling on mobile no longer changes a start time.
   */
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { delay: BOOKING_RESIZE_HOLD_MS, tolerance: BOOKING_RESIZE_HOLD_TOLERANCE_PX },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: BOOKING_RESIZE_HOLD_MS, tolerance: BOOKING_RESIZE_HOLD_TOLERANCE_PX },
    }),
  );

  useEffect(() => {
    calendarDragTargetRef.current = calendarDragTarget;
  }, [calendarDragTarget]);

  const clearModificationNotifyCountdown = useCallback(() => {
    if (modificationNotifyCountdownIntervalRef.current != null) {
      window.clearInterval(modificationNotifyCountdownIntervalRef.current);
      modificationNotifyCountdownIntervalRef.current = null;
    }
    setModificationNotifyCountdownSec(null);
  }, []);

  const clearDeferredModificationGuestNotifyTimer = useCallback(() => {
    if (deferredModificationNotifyTimerRef.current != null) {
      window.clearTimeout(deferredModificationNotifyTimerRef.current);
      deferredModificationNotifyTimerRef.current = null;
    }
    clearModificationNotifyCountdown();
  }, [clearModificationNotifyCountdown]);

  const cancelPendingDeferredModificationGuestNotify = useCallback(() => {
    clearDeferredModificationGuestNotifyTimer();
    pendingDeferredModificationNotifyBookingIdRef.current = null;
  }, [clearDeferredModificationGuestNotifyTimer]);

  /** Keep the schedule change; cancel the deferred guest email/SMS only. */
  const dismissPendingModificationGuestNotify = useCallback(() => {
    clearDeferredModificationGuestNotifyTimer();
    pendingDeferredModificationNotifyBookingIdRef.current = null;
    setDragMoveConfirmBookingId(null);
  }, [clearDeferredModificationGuestNotifyTimer]);

  const postGuestModificationNotify = useCallback(
    async (bookingId: string): Promise<boolean> => {
      if (guestModificationNotifyInFlightRef.current) return false;
      guestModificationNotifyInFlightRef.current = true;
      try {
        const res = await fetch(`/api/venue/bookings/${bookingId}/guest-modification-notify`, {
          method: 'POST',
        });
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          emailSent?: boolean;
          smsSent?: boolean;
          skipped?: boolean;
          skippedReason?: string;
        };
        if (!res.ok) {
          addToast(j.error ?? 'Could not send booking update to guest', 'error');
          return false;
        }
        const toastMessage = formatBookingModificationNotifyToast({
          emailSent: Boolean(j.emailSent),
          smsSent: Boolean(j.smsSent),
          skipped: Boolean(j.skipped),
          skippedReason: j.skippedReason,
        });
        addToast(toastMessage, j.skipped ? 'info' : 'success');
        return true;
      } catch {
        addToast('Could not send booking update to guest', 'error');
        return false;
      } finally {
        guestModificationNotifyInFlightRef.current = false;
      }
    },
    [addToast],
  );

  const scheduleDeferredModificationGuestNotify = useCallback(
    (bookingId: string) => {
      clearDeferredModificationGuestNotifyTimer();
      pendingDeferredModificationNotifyBookingIdRef.current = bookingId;
      const totalSec = Math.ceil(BOOKING_MODIFY_NOTIFY_DEFER_MS / 1000);
      setModificationNotifyCountdownSec(totalSec);
      modificationNotifyCountdownIntervalRef.current = setInterval(() => {
        setModificationNotifyCountdownSec((prev) => {
          if (prev == null || prev <= 1) return null;
          return prev - 1;
        });
      }, 1000);
      deferredModificationNotifyTimerRef.current = setTimeout(() => {
        deferredModificationNotifyTimerRef.current = null;
        pendingDeferredModificationNotifyBookingIdRef.current = null;
        setDragMoveConfirmBookingId(null);
        clearModificationNotifyCountdown();
        void postGuestModificationNotify(bookingId);
      }, BOOKING_MODIFY_NOTIFY_DEFER_MS);
    },
    [
      clearDeferredModificationGuestNotifyTimer,
      clearModificationNotifyCountdown,
      postGuestModificationNotify,
    ],
  );

  /** Show notify / skip / undo on the booking bar immediately after a move or resize (before PATCH returns). */
  const beginScheduleEditFollowUp = useCallback(
    (bookingId: string) => {
      setDragMoveConfirmBookingId(bookingId);
      scheduleDeferredModificationGuestNotify(bookingId);
    },
    [scheduleDeferredModificationGuestNotify],
  );

  const clearScheduleEditFollowUpForBooking = useCallback(
    (bookingId: string) => {
      setDragMoveConfirmBookingId((current) => (current === bookingId ? null : current));
      if (pendingDeferredModificationNotifyBookingIdRef.current === bookingId) {
        cancelPendingDeferredModificationGuestNotify();
      }
    },
    [cancelPendingDeferredModificationGuestNotify],
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
  /** Fetch schedule feed for events/classes strip and month C/D/E dots (resources on grid also need feed for strip-only rows). */
  const showMergedFeeds = showEventsColumn || showClassSessions || loadVenueResources;

  const listFromTo = useMemo(() => {
    if (viewMode === 'day') return { from: date, to: date };
    if (viewMode === 'week') return { from: weekStart, to: addCalendarDays(weekStart, 6) };
    return monthGridDateRange(monthAnchor);
  }, [viewMode, date, weekStart, monthAnchor]);

  const practitionerBreakBlocks = useMemo(
    () =>
      buildPractitionerBreakBlocks(
        practitioners.filter((p) => p.is_active && p.calendar_type !== 'resource'),
        listFromTo.from,
        listFromTo.to,
      ),
    [practitioners, listFromTo.from, listFromTo.to],
  );

  // `scheduleClosureBlocks` and `displayBlocks` are built further down, once the
  // day's drawn bounds are known: the closed stripes cover the drawn range.

  const activeDayDate = viewMode === 'day' ? date : viewMode === 'week' ? weekStart : monthAnchor;

  /**
   * Venue hours for the day on screen, for the column headers (decision (K), step 6).
   *
   * The header printed the calendar's RAW working hours while the grid beside it drew the
   * effective ones, so on a Tuesday where the venue closes at 18:00 and a calendar runs to
   * 22:00 the two halves of the same screen disagreed, and only the grid was right.
   *
   * `unrestricted` means no opening hours are set, so there is nothing to constrain by and
   * the headers keep their raw line. `closed` yields an empty list, which reads as closed.
   */
  const venueRangesForHeader = useMemo(() => {
    const res = resolveVenueWideAllowedMinuteRanges(openingHours, activeDayDate, venueWideBlocks);
    if (res.kind === 'unrestricted') return null;
    if (res.kind === 'closed') return [];
    return res.ranges;
  }, [openingHours, activeDayDate, venueWideBlocks]);
  /**
   * Each linked venue's services in the native `AppointmentService` shape, so a
   * linked booking paints its duration and processing gap exactly as an own
   * booking does. Every linked venue is included, not only those on the native
   * grid: the read-only column paints processing strips too, and the day range
   * below needs a service duration for a linked booking with no stored end.
   */
  const linkedServiceMapsByVenue = useMemo(() => {
    const out = new Map<string, Map<string, AppointmentService>>();
    for (const v of linkedVenues) {
      const m = new Map<string, AppointmentService>();
      for (const s of v.services) {
        m.set(s.id, {
          id: s.id,
          name: s.name,
          duration_minutes: s.durationMinutes ?? 60,
          buffer_minutes: s.bufferMinutes ?? 0,
          processing_time_blocks: s.processingTimeBlocks ?? [],
          colour: s.colour ?? '#6366f1',
          price_pence: s.pricePence ?? null,
          variants: (s.variants ?? []).map((v) => ({
            id: v.id,
            name: v.name,
            processing_time_blocks: v.processingTimeBlocks,
          })),
        });
      }
      out.set(v.venueId, m);
    }
    return out;
  }, [linkedVenues]);

  const { startHour: derivedStartHour, endHour: derivedEndHour } = useMemo(
    () => {
      // Pass the blocks so the grid follows the venue's RESOLVED hours for this date. An
      // amended window running past the weekly close used to leave the grid at the weekly
      // bounds, and schedule-closure-blocks then clipped the stripe away -- so the hours
      // the owner had just entered were the ones they could neither see nor drag into.
      const venueBase = getCalendarGridBounds(activeDayDate, openingHours ?? undefined, 7, 21, {
        timeZone: venueTimezone,
        venueWideBlocks,
      });
      // The grid always shows the widest span anything is scheduled open: the
      // venue's hours OR any visible calendar's own hours. A calendar working
      // 08:00-20:00 in a venue open 09:00-18:00 draws 08:00-20:00, with the
      // stripes saying which side is closed in each hour.
      const calendarBounds = calendarWorkingBoundsForDates(
        practitioners.filter((p) => p.is_active && p.calendar_type !== 'resource'),
        viewMode === 'day' ? activeDayDate : listFromTo.from,
        viewMode === 'day' ? activeDayDate : listFromTo.to,
      );
      const base = calendarBounds
        ? {
            startHour: Math.min(venueBase.startHour, Math.floor(calendarBounds.start / 60)),
            endHour: Math.min(24, Math.max(venueBase.endHour, Math.ceil(calendarBounds.end / 60))),
          }
        : venueBase;
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
      /**
       * Linked columns' bookings widen the day the same way. Only own bookings
       * were counted, so a linked venue's 09:30 booking on a grid that opened at
       * 10:00 was drawn above the top of the grid, over the column header, with
       * no way to reach it. Hidden linked columns are left out: a booking the
       * user has filtered off the page should not stretch it.
       */
      const shownLinkedColumnKeys =
        visibleLinkedColumnIds === null ? null : new Set(visibleLinkedColumnIds);
      for (const v of linkedVenues) {
        const linkedServiceMap = linkedServiceMapsByVenue.get(v.venueId) ?? new Map();
        for (const lb of v.bookings) {
          if (lb.bookingDate !== activeDayDate || !lb.practitionerId) continue;
          if (lb.experienceEventId && v.visibility === 'full_details') continue;
          const key = linkedColumnKey(v.venueId, lb.practitionerId);
          if (shownLinkedColumnKeys && !shownLinkedColumnKeys.has(key)) continue;
          const asGrid = linkedBookingToGridBooking(lb, v.venueId, key) as Booking;
          const startM = timeToMinutes(asGrid.booking_time);
          if (!Number.isFinite(startM)) continue;
          const endM = startM + bookingCalendarDisplaySpanMinutes(asGrid, linkedServiceMap);
          minM = Math.min(minM, startM);
          maxM = Math.max(maxM, endM);
        }
      }
      /**
       * REAL blocks only. `displayBlocks` also carries `scheduleClosureBlocks`, which are
       * generated FROM these bounds by buildVenueScheduleClosureBlocks and then clipped to
       * them. Feeding those back in makes the computation circular: on a day amended to
       * 09:00-11:00 and 15:00-17:00, the generated "Closed 17:00-22:00" stripe dragged the
       * grid back out to 22:00, so the bounds could never follow the amended hours no
       * matter what getCalendarGridBounds returned. An output cannot be an input.
       */
      for (const block of blocks) {
        if (block.block_date !== activeDayDate) continue;
        includeRange(block.start_time, block.end_time, 60);
      }
      for (const block of practitionerBreakBlocks) {
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
    [activeDayDate, blocks, practitionerBreakBlocks, bookings, linkedServiceMapsByVenue, linkedVenues, listFromTo.from, listFromTo.to, openingHours, practitioners, scheduleBlocks, services, venueTimezone, venueWideBlocks, viewMode, visibleLinkedColumnIds],
  );
  const [startHourOverride, setStartHourOverride] = useState<number | null>(null);
  const [endHourOverride, setEndHourOverride] = useState<number | null>(null);
  /** The clock button's dialog (amend calendar hours / business hours). */
  const [hoursQuickEditOpen, setHoursQuickEditOpen] = useState(false);
  /**
   * "Compact" day view. `compactDay` is the user's persisted toggle; `measuredSlotHeight`
   * is the px-per-slot computed each layout to fit the whole day on one screen. Until the
   * measurement runs we fall back to the comfortable height, so the first paint matches SSR.
   */
  const [compactDay, setCompactDay] = useState(false);
  const [measuredSlotHeight, setMeasuredSlotHeight] = useState<number | null>(null);
  /**
   * Measured height of the day grid's column-header row.
   *
   * The time gutter is a sibling of the column stack, so its own top spacer has
   * to be exactly as tall as that header or every time label sits off its
   * gridline. The spacer was a hardcoded 58px while the header grows with its
   * content: a linked column's header has a third line (min 70px), and a native
   * header's working-hours line can wrap to two. The whole gutter then rode ~12px
   * or more high against the grid.
   *
   * `DAY_HEADER_FALLBACK_PX` matches the native header's own minimum, so the
   * first paint (before measurement) is right for the common case.
   */
  const [dayHeaderHeightPx, setDayHeaderHeightPx] = useState<number>(DAY_HEADER_FALLBACK_PX);

  /** Session preferences are applied after mount so the first paint matches SSR HTML. */
  const [calendarPrefsHydrated, setCalendarPrefsHydrated] = useState(false);

  useEffect(() => {
    const remembered = readSessionPreference<PractitionerCalendarPreferences>(
      preferencesKey,
      {},
      isPractitionerCalendarPreferences,
    );
    if (remembered.viewMode) setViewMode(remembered.viewMode);
    // Date navigation resets to venue-local today on each visit (see initialIsoDate).
    //
    // The Filter menu is kept in a per-venue cookie so it stays until the user
    // changes it, across tabs, restarts and sign-out. The session copy is only
    // read when no cookie exists yet, so a tab open from before the cookie was
    // introduced keeps its filters for the rest of that session.
    const persistedFilters = readCalendarFilterPreferences(venueId);
    const filters: Partial<PractitionerCalendarFilters> = persistedFilters ?? {
      visibleCalendarIdsState: remembered.visibleCalendarIdsState,
      visibleLinkedColumnIds: remembered.visibleLinkedColumnIds,
      filterStatus: remembered.filterStatus,
    };
    if (filters.visibleCalendarIdsState !== undefined) {
      setVisibleCalendarIdsState(filters.visibleCalendarIdsState);
    }
    if (filters.visibleLinkedColumnIds !== undefined) {
      setVisibleLinkedColumnIds(filters.visibleLinkedColumnIds);
    }
    if (
      filters.filterStatus &&
      CALENDAR_STATUS_FILTERS.some((s) => s.value === filters.filterStatus)
    ) {
      setFilterStatus(filters.filterStatus);
    }
    if (filters.workingHoursOnly !== undefined) setWorkingHoursOnly(filters.workingHoursOnly);
    if (remembered.startHourOverride !== undefined) setStartHourOverride(remembered.startHourOverride);
    if (remembered.endHourOverride !== undefined) setEndHourOverride(remembered.endHourOverride);
    if (remembered.compactDay !== undefined) setCompactDay(remembered.compactDay);
    setCalendarPrefsHydrated(true);
  }, [preferencesKey, venueId]);
  const baseStartHour = startHourOverride ?? derivedStartHour;
  const baseEndHour = endHourOverride ?? derivedEndHour;
  /**
   * Rows beyond the day's hours while a booking is being moved or resized, so a
   * bar can be dragged before opening, after close, or into a closed gap. See
   * `armGridExtension` below for when it is set and cleared.
   */
  const [gridExtension, setGridExtension] = useState<{ startHour: number; endHour: number } | null>(null);
  const startHour = gridExtension ? Math.min(baseStartHour, gridExtension.startHour) : baseStartHour;
  const endHour = gridExtension ? Math.max(baseEndHour, gridExtension.endHour) : baseEndHour;
  const TOTAL_SLOTS = (() => {
    const n = ((endHour - startHour) * 60) / SLOT_MINUTES;
    return Number.isFinite(n) && n > 0 ? n : ((21 - 7) * 60) / SLOT_MINUTES;
  })();

  /**
   * The runtime per-slot pixel height. Comfortable view (and any view that isn't the day
   * grid) keeps the full {@link COMFORTABLE_SLOT_PX}; compact view uses the measured
   * fit-to-viewport height once it's been computed. `compactActive` is the boolean form
   * (true only once a measurement exists), used to gate the resize affordance and drag dead-zone.
   */
  const compactActive = compactDay && measuredSlotHeight != null;
  const slotHeightPx =
    compactDay && measuredSlotHeight != null ? measuredSlotHeight : COMFORTABLE_SLOT_PX;
  /** Resize handles + their reserved strip are hidden in compact (rows are too short to grab precisely). */
  const resizeAffordanceOn = !compactActive;

  /**
   * Live extension of the day grid for a move or a resize.
   *
   * A booking may be dragged before opening, after close, or into a closed gap,
   * and the grid needs rows there for the bar to land on. The rows are added
   * part way through the press-and-hold, before dnd-kit activates: adding them
   * during an active drag would move the bar's own origin and the page under
   * the pointer at once, and dnd-kit counts that scroll into the drag. The main
   * pane is scrolled by exactly the height added above the grid, so nothing on
   * screen appears to move. The extension is cleared when the interaction ends;
   * a booking that landed outside keeps the grid wide through the derived
   * bounds, which follow every booking on the day, and the closed stripes
   * (built below over the drawn range) then cover that time. Compact view keeps
   * its fit-to-screen rows and is not stretched.
   */
  const gridTopHourRef = useRef(startHour);
  const compensateGridTopShiftRef = useRef(false);
  /**
   * The pane's scroll position as it was BEFORE the rows changed, taken when the
   * stretch or fold is requested. The layout effect cannot read it itself: by
   * then the rows above the grid are gone, the pane is shorter, and the browser
   * has already clamped `scrollTop` to the new maximum. Subtracting the removed
   * height from that clamped value overshot, and every drop landed the page near
   * the top of the diary.
   */
  const scrollTopBeforeGridShiftRef = useRef<number | null>(null);
  const noteScrollTopBeforeGridShift = useCallback(() => {
    const main = scrollRef.current?.closest('main');
    scrollTopBeforeGridShiftRef.current = main ? main.scrollTop : null;
  }, []);
  useLayoutEffect(() => {
    const prev = gridTopHourRef.current;
    gridTopHourRef.current = startHour;
    const compensate = compensateGridTopShiftRef.current;
    compensateGridTopShiftRef.current = false;
    const before = scrollTopBeforeGridShiftRef.current;
    scrollTopBeforeGridShiftRef.current = null;
    if (!compensate || prev === startHour) return;
    const main = scrollRef.current?.closest('main');
    if (!main) return;
    main.scrollTop = (before ?? main.scrollTop) + ((prev - startHour) * 60 * slotHeightPx) / SLOT_MINUTES;
  }, [startHour, gridExtension, slotHeightPx]);
  const gridExtensionRef = useRef(gridExtension);
  gridExtensionRef.current = gridExtension;
  const gridExtensionArmTimerRef = useRef<number | null>(null);
  /** Set once dnd-kit or a resize has the pointer, so a release does not fold the grid mid-drag. */
  const dragActivatedRef = useRef(false);
  const extendGridForInteraction = useCallback(
    (edges: 'both' | 'bottom') => {
      if (viewMode !== 'day' || compactActive) return;
      compensateGridTopShiftRef.current = edges === 'both';
      if (edges === 'both') noteScrollTopBeforeGridShift();
      setGridExtension({ startHour: edges === 'both' ? 0 : baseStartHour, endHour: 24 });
    },
    [viewMode, compactActive, baseStartHour, noteScrollTopBeforeGridShift],
  );
  const clearGridExtension = useCallback(() => {
    if (gridExtensionArmTimerRef.current != null) {
      window.clearTimeout(gridExtensionArmTimerRef.current);
      gridExtensionArmTimerRef.current = null;
    }
    if (!gridExtensionRef.current) return;
    compensateGridTopShiftRef.current = true;
    noteScrollTopBeforeGridShift();
    setGridExtension(null);
  }, [noteScrollTopBeforeGridShift]);
  /**
   * Called on the pointer-down that begins a hold: stretches the grid once the
   * hold has lasted longer than a click, and folds it back if the pointer is
   * released without a drag or resize having taken over.
   */
  const armGridExtension = useCallback(
    (edges: 'both' | 'bottom', pointerId: number) => {
      if (viewMode !== 'day' || compactActive) return;
      if (gridExtensionArmTimerRef.current != null) window.clearTimeout(gridExtensionArmTimerRef.current);
      dragActivatedRef.current = false;
      gridExtensionArmTimerRef.current = window.setTimeout(() => {
        gridExtensionArmTimerRef.current = null;
        extendGridForInteraction(edges);
      }, GRID_EXTENSION_ARM_MS);
      const release = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        window.removeEventListener('pointerup', release);
        window.removeEventListener('pointercancel', release);
        if (!dragActivatedRef.current) clearGridExtension();
      };
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);
    },
    [viewMode, compactActive, extendGridForInteraction, clearGridExtension],
  );
  const armGridExtensionRef = useRef(armGridExtension);
  armGridExtensionRef.current = armGridExtension;
  const clearGridExtensionRef = useRef(clearGridExtension);
  clearGridExtensionRef.current = clearGridExtension;

  const scheduleClosureBlocks = useMemo((): CalendarBlock[] => {
    const nativeColumnIds = practitioners
      .filter((p) => p.is_active && p.calendar_type !== 'resource')
      .map((p) => p.id);
    // The day grid may be wider than the venue's hours (a booking outside them,
    // or a drag stretching the day); the stripes then cover the drawn range so
    // every minute outside the open windows reads as closed.
    const gridBounds = viewMode === 'day' ? { start: startHour * 60, end: endHour * 60 } : undefined;
    const venueBlocks = buildVenueScheduleClosureBlocks({
      openingHours,
      venueWideBlocks,
      fromDate: listFromTo.from,
      toDate: listFromTo.to,
      columnIds: nativeColumnIds,
      timeZone: venueTimezone,
      gridBounds,
    });
    const practitionerBlocks = buildPractitionerScheduleClosureBlocks({
      practitioners: practitioners.filter((p) => p.is_active && p.calendar_type !== 'resource'),
      leavePeriods,
      fromDate: listFromTo.from,
      toDate: listFromTo.to,
      openingHours,
      timeZone: venueTimezone,
      gridBounds,
    });
    // One explanation per minute: venue-only, calendar-only, or both.
    return partitionScheduleClosureBlocks([...venueBlocks, ...practitionerBlocks]) as CalendarBlock[];
  }, [practitioners, openingHours, venueWideBlocks, leavePeriods, listFromTo.from, listFromTo.to, venueTimezone, viewMode, startHour, endHour]);

  /** Column id to display name, for "<calendar> unavailable" stripes. */
  const columnNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of practitioners) m.set(p.id, p.name);
    return m;
  }, [practitioners]);
  const blockColumnName = useCallback(
    (bl: CalendarBlock) => columnNameById.get(bl.calendar_id ?? bl.practitioner_id ?? '') ?? null,
    [columnNameById],
  );

  const displayBlocks = useMemo(
    () => [...scheduleClosureBlocks, ...blocks, ...practitionerBreakBlocks],
    [scheduleClosureBlocks, blocks, practitionerBreakBlocks],
  );

  const calendarPrefsSnapshot = useMemo(
    (): PractitionerCalendarPreferences => ({
      viewMode,
      startHourOverride,
      endHourOverride,
      compactDay,
    }),
    [viewMode, startHourOverride, endHourOverride, compactDay],
  );

  useEffect(() => {
    if (!calendarPrefsHydrated) return;
    writeSessionPreference<PractitionerCalendarPreferences>(preferencesKey, calendarPrefsSnapshot);
  }, [calendarPrefsHydrated, preferencesKey, calendarPrefsSnapshot]);

  const calendarFilters = useMemo(
    (): PractitionerCalendarFilters => ({
      visibleCalendarIdsState,
      visibleLinkedColumnIds,
      filterStatus,
      workingHoursOnly,
    }),
    [visibleCalendarIdsState, visibleLinkedColumnIds, filterStatus, workingHoursOnly],
  );

  useEffect(() => {
    if (!calendarPrefsHydrated) return;
    writeCalendarFilterPreferences(venueId, calendarFilters);
  }, [calendarPrefsHydrated, venueId, calendarFilters]);

  const resetCalendarFilters = useCallback(() => {
    setVisibleCalendarIdsState(DEFAULT_CALENDAR_FILTERS.visibleCalendarIdsState);
    setVisibleLinkedColumnIds(DEFAULT_CALENDAR_FILTERS.visibleLinkedColumnIds);
    setFilterStatus(DEFAULT_CALENDAR_FILTERS.filterStatus);
    setWorkingHoursOnly(DEFAULT_CALENDAR_FILTERS.workingHoursOnly);
  }, []);

  /**
   * Compact day view: measure how much vertical room the slot canvas has inside the page's
   * scroll container and shrink each slot so the whole day (open → close) fits one screen.
   *
   * We measure the canvas's own offset within `<main>` (which folds in the toolbar, page
   * padding, safe-area insets, and the sticky column header automatically — no hard-coded
   * header constant) and divide the remaining height by the slot count. The result is clamped
   * to {@link MIN_SLOT_PX} (legibility floor — a long day may then overflow slightly rather
   * than become unreadable) and {@link COMFORTABLE_SLOT_PX} (never grow past the default).
   * Recomputed on viewport/orientation/content changes; paused mid drag/resize so the slot
   * ratio can't shift under an in-flight gesture. Cleared when compact is off.
   */
  useLayoutEffect(() => {
    if (!compactDay || viewMode !== 'day') {
      setMeasuredSlotHeight(null);
      return;
    }
    const main = scrollRef.current?.closest('main');
    if (!main) return;
    const measure = () => {
      if (interactingRef.current) return;
      const canvas = slotCanvasRef.current;
      if (!canvas || TOTAL_SLOTS <= 0) return;
      const mainRect = main.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      // Canvas offset from the top of main's scrollable content (scroll-independent).
      const canvasOffsetWithinMain = canvasRect.top - mainRect.top + main.scrollTop;
      const BOTTOM_GUTTER_PX = 16;
      const available = main.clientHeight - canvasOffsetWithinMain - BOTTOM_GUTTER_PX;
      const next = Math.max(
        MIN_SLOT_PX,
        Math.min(COMFORTABLE_SLOT_PX, Math.floor(available / TOTAL_SLOTS)),
      );
      if (Number.isFinite(next) && next > 0) {
        setMeasuredSlotHeight((prev) => (prev === next ? prev : next));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(main);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
    // `loading` is included so the measurement re-runs once the day grid mounts after the
    // initial fetch (the slot canvas isn't in the DOM while loading, so the first pass bails).
  }, [compactDay, viewMode, TOTAL_SLOTS, loading]);

  /**
   * Keep the time gutter's top spacer exactly as tall as the column-header row it
   * sits beside, so each label lands on its own gridline. Measured rather than
   * assumed because the header grows with its content (a linked column adds a
   * third line; a long working-hours line wraps).
   */
  useLayoutEffect(() => {
    const header = dayHeaderRowRef.current;
    if (!header) {
      setDayHeaderHeightPx(DAY_HEADER_FALLBACK_PX);
      return;
    }
    const measure = () => {
      // Border-box, so this includes the header's own bottom border and the
      // spacer's height can be set from it directly.
      const next = Math.round(header.getBoundingClientRect().height);
      if (Number.isFinite(next) && next > 0) {
        setDayHeaderHeightPx((prev) => (prev === next ? prev : next));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(header);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
    // Only needs to re-bind when the header element itself mounts or unmounts.
    // A column set that changes the header's height (a linked column adds a
    // line) resizes the same element, which the observer already catches.
  }, [viewMode, loading]);

  const calendarListQuery = useMemo(() => {
    const { from, to } = listFromTo;
    const params = from === to ? `date=${from}` : `from=${from}&to=${to}`;
    return `${params}&view=calendar`;
  }, [listFromTo]);

  const calendarBlockUrl = useMemo(() => {
    const { from, to } = listFromTo;
    return from === to
      ? `/api/venue/practitioner-calendar-blocks?date=${from}`
      : `/api/venue/practitioner-calendar-blocks?from=${from}&to=${to}`;
  }, [listFromTo]);

  const calendarScheduleQuery = useMemo(() => {
    return listFromTo.from === listFromTo.to
      ? `date=${encodeURIComponent(listFromTo.from)}`
      : `from=${encodeURIComponent(listFromTo.from)}&to=${encodeURIComponent(listFromTo.to)}`;
  }, [listFromTo]);

  const applyBookingsList = useCallback((nextBookings: Booking[]) => {
    primeGroupVisitBookingsFromListSeeds(nextBookings);
    setBookings(nextBookings);
    setCalendarBookingOverlays((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      const next: Record<string, BookingRowOverlay> = { ...prev };
      for (const row of nextBookings) {
        const pruned = retainBookingRowOverlay(prev[row.id] ?? {}, row);
        if (Object.keys(pruned).length === 0) delete next[row.id];
        else next[row.id] = pruned;
      }
      return next;
    });
  }, []);

  const prefetchBookingDetail = useCallback(
    (bookingId: string) => {
      const row = bookings.find((b) => b.id === bookingId);
      if (row?.group_booking_id) warmGroupVisitBookings(row.group_booking_id);
      void warmVenueBookingDetail(bookingId);
    },
    [bookings, warmVenueBookingDetail],
  );

  const refetchBookingsList = useCallback(async () => {
    const bookRes = await fetch(`/api/venue/bookings/list?${calendarListQuery}`);
    if (!bookRes.ok) return;
    const bookData = (await bookRes.json()) as { bookings?: Booking[] };
    applyBookingsList((bookData.bookings ?? []) as Booking[]);
  }, [applyBookingsList, calendarListQuery]);

  const refetchBlocks = useCallback(async () => {
    const blockRes = await fetch(calendarBlockUrl);
    const bjson = blockRes.ok
      ? ((await blockRes.json()) as { blocks?: CalendarBlock[] })
      : { blocks: [] as CalendarBlock[] };
    setBlocks(bjson.blocks ?? []);
  }, [calendarBlockUrl]);

  const refetchSchedule = useCallback(async () => {
    if (!showMergedFeeds) {
      setScheduleBlocks([]);
      return;
    }
    const scheduleRes = await fetch(`/api/venue/schedule?${calendarScheduleQuery}`);
    if (!scheduleRes.ok) {
      setScheduleBlocks([]);
      return;
    }
    const schJson = (await scheduleRes.json()) as { blocks?: ScheduleBlockDTO[] };
    setScheduleBlocks(schJson.blocks ?? []);
  }, [calendarScheduleQuery, showMergedFeeds]);

  const catalogLoadedAtRef = useRef(0);

  const fetchCalendarCatalog = useCallback(async (force = false): Promise<boolean> => {
    const now = Date.now();
    if (
      !force &&
      catalogLoadedAtRef.current > 0 &&
      now - catalogLoadedAtRef.current < CALENDAR_CATALOG_STALE_MS
    ) {
      return true;
    }

    const [pracRes, svcRes] = await Promise.all([
      fetch('/api/venue/practitioners?roster=1'),
      fetch('/api/venue/appointment-services'),
    ]);
    if (!pracRes.ok || !svcRes.ok) return false;

    const [pracData, svcData] = await Promise.all([
      pracRes.json() as Promise<{ practitioners?: Practitioner[] }>,
      svcRes.json() as Promise<{ services?: AppointmentService[] }>,
    ]);
    setPractitioners(pracData.practitioners ?? []);
    setServices(svcData.services ?? []);
    catalogLoadedAtRef.current = now;
    return true;
  }, []);

  const fetchData = useCallback(
    async (options?: { silent?: boolean; refreshCatalog?: boolean }) => {
      const silent = options?.silent ?? false;
      if (!silent) {
        setLoading(true);
        setFetchError(null);
      }
      try {
        const catalogOk = await fetchCalendarCatalog(options?.refreshCatalog ?? false);

        const parallel: Promise<Response>[] = [
          fetch(`/api/venue/bookings/list?${calendarListQuery}`),
          fetch(calendarBlockUrl),
          fetch('/api/venue/availability-blocks'),
          fetch(
            `/api/venue/practitioner-leave?from=${encodeURIComponent(listFromTo.from)}&to=${encodeURIComponent(listFromTo.to)}`,
          ),
        ];
        if (!silent) {
          parallel.push(fetch('/api/venue'));
        }
        if (loadVenueResources) {
          parallel.push(fetch('/api/venue/resources'));
        }
        if (showMergedFeeds) {
          parallel.push(fetch(`/api/venue/schedule?${calendarScheduleQuery}`));
        }

        const responses = await Promise.all(parallel);
        let i = 0;
        const bookRes = responses[i++]!;
        const blockRes = responses[i++]!;
        const venueWideBlocksRes = responses[i++]!;
        const leaveRes = responses[i++]!;
        const venueRes = !silent ? responses[i++] : undefined;
        const resourcesRes = loadVenueResources ? responses[i++] : undefined;
        const scheduleRes = showMergedFeeds ? responses[i++] : undefined;

        if (!catalogOk || !bookRes.ok) {
          setFetchError('Failed to load calendar data. Please refresh the page.');
          return;
        }

        const [bookData, bjson, venueWideJson, leaveJson] = await Promise.all([
          bookRes.json() as Promise<{ bookings?: Booking[] }>,
          blockRes.ok ? blockRes.json() : Promise.resolve({ blocks: [] }),
          venueWideBlocksRes.ok
            ? venueWideBlocksRes.json()
            : Promise.resolve({ blocks: [] as AvailabilityBlock[] }),
          leaveRes.ok
            ? leaveRes.json()
            : Promise.resolve({ periods: [] as PractitionerLeavePeriodInput[] }),
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

        applyBookingsList((bookData.bookings ?? []) as Booking[]);
        setBlocks((bjson as { blocks?: CalendarBlock[] }).blocks ?? []);
        const wideRows = (venueWideJson as { blocks?: AvailabilityBlock[] }).blocks ?? [];
        setVenueWideBlocks(wideRows.filter((row) => row.service_id == null));
        setLeavePeriods((leaveJson as { periods?: PractitionerLeavePeriodInput[] }).periods ?? []);
      } catch {
        setFetchError('Failed to load calendar data. Please check your connection.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [
      applyBookingsList,
      calendarBlockUrl,
      calendarListQuery,
      calendarScheduleQuery,
      fetchCalendarCatalog,
      listFromTo.from,
      listFromTo.to,
      loadVenueResources,
      showMergedFeeds,
    ],
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
      setLinkedLoadError(false);
      return;
    }
    try {
      const { from, to } = listFromTo;
      const params = from === to ? `date=${from}` : `from=${from}&to=${to}`;
      const res = await fetch(`/api/venue/linked-calendar?${params}`);
      if (!res.ok) {
        // §19.3 — a load failure must be distinguishable from "no linked columns",
        // not silently collapse to an empty calendar.
        setLinkedVenues([]);
        setLinkedLoadError(true);
        return;
      }
      const json = (await res.json()) as { venues?: LinkedVenueCalendar[] };
      setLinkedVenues(json.venues ?? []);
      setLinkedLoadError(false);
    } catch {
      setLinkedVenues([]);
      setLinkedLoadError(true);
    } finally {
      // Mark the first load complete so a venue with zero links shows an explicit
      // "no linked venues" state instead of a perpetual "Loading…" (§19.3).
      setLinkedLoaded(true);
    }
  }, [linkFeature, listFromTo]);

  const shouldSyncLinkedCalendar =
    linkFeature &&
    (visibleLinkedColumnIds === null || visibleLinkedColumnIds.length > 0);

  const requestLinkedCalendarSync = useCallback(() => {
    if (!shouldSyncLinkedCalendar) return;
    void loadLinkedData();
  }, [loadLinkedData, shouldSyncLinkedCalendar]);

  useEffect(() => {
    if (!linkFeature) {
      setLinkedVenues([]);
      return;
    }
    if (visibleLinkedColumnIds !== null && visibleLinkedColumnIds.length === 0) {
      setLinkedVenues([]);
      return;
    }
    void loadLinkedData();
  }, [linkFeature, visibleLinkedColumnIds, listFromTo, loadLinkedData]);

  const debouncedLoadLinkedData = useDebouncedCallback(() => {
    requestLinkedCalendarSync();
  }, REALTIME_BOOKINGS_DEBOUNCE_MS);

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

  const debouncedSilentFetchBookings = useDebouncedCallback(() => {
    void refetchBookingsList();
  }, REALTIME_BOOKINGS_DEBOUNCE_MS);

  const debouncedSilentFetchBlocks = useDebouncedCallback(() => {
    void refetchBlocks();
    void refetchSchedule();
  }, REALTIME_BOOKINGS_DEBOUNCE_MS);

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
    // Only a new day or the end of loading: the grid's bounds also change when
    // it stretches for a drag or follows a booking moved outside hours, and
    // neither may yank the page to the top.
  }, [loading, viewMode, date]);

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
          debouncedSilentFetchBookings();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'practitioner_calendar_blocks', filter: `venue_id=eq.${venueId}` },
        () => {
          debouncedSilentFetchBlocks();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'calendar_blocks', filter: `venue_id=eq.${venueId}` },
        () => {
          debouncedSilentFetchBlocks();
        },
      )
      .subscribe((status) => {
        setRealtimeConnected(status === 'SUBSCRIBED');
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [venueId, debouncedSilentFetchBookings, debouncedSilentFetchBlocks]);

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
          debouncedLoadLinkedData();
        },
      );
    }
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [linkFeature, venueId, linkedVenueIdsKey, debouncedLoadLinkedData]);

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

  const calendarFilteredPractitioners = useMemo(() => {
    if (calendarFilterIds === null) return columnPractitioners;
    const allowed = new Set(calendarFilterIds);
    return columnPractitioners.filter((p) => allowed.has(p.id));
  }, [columnPractitioners, calendarFilterIds]);

  /**
   * "Only calendars working on the selected day" applies to the day grid alone:
   * week and month views lay days out, not columns, so every calendar stays.
   */
  const workingHoursFilterActive = viewMode === 'day' && workingHoursOnly;

  const filteredPractitioners = useMemo(() => {
    if (!workingHoursFilterActive) return calendarFilteredPractitioners;
    // "Working" means the column has bookable hours left on the date: its hours
    // for that day minus recorded leave and the venue's closures. A calendar on
    // leave all day, or a day the venue is closed, is off even though its weekly
    // template has hours.
    return calendarFilteredPractitioners.filter((p) =>
      calendarHasAvailableHoursOnDate({
        practitioner: p as unknown as VenuePractitioner,
        dateYmd: date,
        leavePeriods,
        openingHours,
        venueWideBlocks,
      }),
    );
  }, [calendarFilteredPractitioners, workingHoursFilterActive, date, leavePeriods, openingHours, venueWideBlocks]);

  /** Columns the working-hours filter is hiding today, so their bookings leave the counts too. */
  const workingHoursHiddenColumnIds = useMemo(() => {
    if (!workingHoursFilterActive) return null;
    const shown = new Set(filteredPractitioners.map((p) => p.id));
    return new Set(calendarFilteredPractitioners.filter((p) => !shown.has(p.id)).map((p) => p.id));
  }, [workingHoursFilterActive, calendarFilteredPractitioners, filteredPractitioners]);

  /** Every practitioner column exposed by a linked venue (§8.2). */
  const linkedColumns = useMemo<LinkedColumn[]>(() => {
    const out: LinkedColumn[] = [];
    for (const v of linkedVenues) {
      for (const p of v.practitioners) {
        out.push({
          key: linkedColumnKey(v.venueId, p.id),
          venueId: v.venueId,
          venueName: v.venueName,
          venueTimezone: v.venueTimezone?.trim() || venueTimezone,
          linkId: v.linkId,
          practitionerId: p.id,
          practitionerName: p.name,
          practitionerActive: p.isActive,
          workingHours: p.workingHours,
          visibility: v.visibility,
          action: v.action,
        });
      }
    }
    return out;
  }, [linkedVenues, venueTimezone]);

  /** Linked columns visible on the grid. */
  const visibleLinkedColumns = useMemo(() => {
    const chosen =
      visibleLinkedColumnIds === null
        ? linkedColumns
        : linkedColumns.filter((c) => new Set(visibleLinkedColumnIds).has(c.key));
    if (!workingHoursFilterActive) return chosen;
    // A linked column carries its owner's weekly template only (no rota or days
    // off), read in the owner venue's timezone as its header line is.
    return chosen.filter((c) =>
      calendarWorksOnDate({ working_hours: c.workingHours ?? null }, date, c.venueTimezone),
    );
  }, [linkedColumns, visibleLinkedColumnIds, workingHoursFilterActive, date]);

  /** Read-only linked columns (time_only or view-only full_details). */
  const readOnlyLinkedColumns = useMemo(
    () => visibleLinkedColumns.filter((c) => !linkedColumnUsesNativeGrid(c)),
    [visibleLinkedColumns],
  );

  /** Linked columns that share the native interactive day grid (drag, resize, actions). */
  const nativeGridLinkedColumns = useMemo(
    () => visibleLinkedColumns.filter((c) => linkedColumnUsesNativeGrid(c)),
    [visibleLinkedColumns],
  );

  const linkedNativeGridColumnByKey = useMemo(() => {
    const m = new Map<string, LinkedColumn>();
    for (const c of nativeGridLinkedColumns) m.set(c.key, c);
    return m;
  }, [nativeGridLinkedColumns]);

  const dayGridColumns = useMemo((): DayGridColumn[] => {
    const native: DayGridColumn[] = filteredPractitioners.map((practitioner) => ({
      kind: 'native',
      practitioner,
    }));
    const linked: DayGridColumn[] = nativeGridLinkedColumns.map((column) => ({
      kind: 'linked',
      column,
    }));
    return [...native, ...linked];
  }, [filteredPractitioners, nativeGridLinkedColumns]);

  const linkedNativeBookings = useMemo((): Booking[] => {
    const out: Booking[] = [];
    for (const v of linkedVenues) {
      if (!linkedColumnUsesNativeGrid(v)) continue;
      for (const lb of v.bookings) {
        if (!lb.practitionerId) continue;
        if (lb.experienceEventId && v.visibility === 'full_details') continue;
        out.push(
          linkedBookingToGridBooking(
            lb,
            v.venueId,
            linkedColumnKey(v.venueId, lb.practitionerId),
          ) as Booking,
        );
      }
    }
    return out;
  }, [linkedVenues]);

  const allGridBookings = useMemo(
    () => [...bookings, ...linkedNativeBookings],
    [bookings, linkedNativeBookings],
  );
  /** Each live service of a visit on the grid: its place in the visit, for the chip and the shared colour. */
  const visitPositions = useMemo(() => visitSiblingIndex(allGridBookings), [allGridBookings]);

  const linkedVenueById = useMemo(() => {
    const m = new Map<string, LinkedVenueCalendar>();
    for (const v of linkedVenues) m.set(v.venueId, v);
    return m;
  }, [linkedVenues]);

  const linkedBookingsFor = useCallback(
    (column: LinkedColumn, dayDate: string): LinkedBooking[] => {
      const venue = linkedVenueById.get(column.venueId);
      if (!venue) return [];
      return venue.bookings.filter((b) => {
        if (b.practitionerId !== column.practitionerId || b.bookingDate !== dayDate) return false;
        if (b.experienceEventId && venue.visibility === 'full_details') return false;
        return true;
      });
    },
    [linkedVenueById],
  );

  const linkedScheduleForColumn = useCallback(
    (column: LinkedColumn, dayDate: string) => {
      const venue = linkedVenueById.get(column.venueId);
      if (!venue?.scheduleBlocks?.length) {
        return { classBlocks: [] as ScheduleBlockDTO[], eventBlocks: [] as ScheduleBlockDTO[] };
      }
      return linkedVenueScheduleBlocksForColumn(
        venue.scheduleBlocks,
        column.practitionerId,
        dayDate,
      );
    },
    [linkedVenueById],
  );

  /**
   * Editable full-details linked bookings open the native booking detail panel.
   * Full booking detail opens ExpandedBookingContent via BookingDetailPanel.
   * Time-only links use the lightweight read-only modal.
   */
  const openLinkedBooking = useCallback(
    (column: LinkedColumn, booking: LinkedBooking, anchor?: { x: number; y: number }) => {
      void fetch('/api/venue/linked-calendar/booking/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id }),
      }).catch(() => undefined);

      if (linkedBookingUsesExpandedDetail(column)) {
        setLinkedViewing(null);
        setDetailBookingLinkedAct(column.action);
        setDetailBookingOwnerVenueId(column.venueId);
        setDetailBookingId(booking.id);
        setDetailBookingAnchor(anchor ?? null);
        return;
      }
      setDetailBookingId(null);
      setDetailBookingOwnerVenueId(null);
      setDetailBookingLinkedAct(null);
      setDetailBookingAnchor(null);
      setLinkedViewing({ column, booking });
    },
    [],
  );

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
    if (viewMode !== 'day' || !loadVenueResources) {
      return new Map<string, ResourceAvailabilityMintSlot[]>();
    }
    const out = new Map<string, ResourceAvailabilityMintSlot[]>();
    for (const prac of filteredPractitioners) {
      const onColumn = venueResources.filter((r) => r.display_on_calendar_id === prac.id && r.is_active);
      if (onColumn.length === 0) continue;
      const existingBookings: EngineResourceBooking[] = bookings
        .filter(
          (b) =>
            b.booking_date === date &&
            onColumn.some((r) => b.resource_id === r.id || b.calendar_id === r.id) &&
            (RESOURCE_BOOKING_CAPACITY_STATUSES as readonly string[]).includes(b.status),
        )
        .map((b) => ({
          id: b.id,
          resource_id: (b.resource_id ?? b.calendar_id)!,
          booking_time: b.booking_time.slice(0, 5),
          booking_end_time: (b.booking_end_time ?? b.booking_time).slice(0, 5),
          status: b.status,
        }));
      const vrList = onColumn.map((r) => apiResourceRowToVenueResource(r, venueId, prac));
      const mint = computeResourceAvailabilityMintSlots({
        date,
        venueTimezone,
        resources: vrList,
        existingBookings,
        startHour,
        slotHeightPx: slotHeightPx,
        slotMinutes: SLOT_MINUTES,
      });
      if (mint.length > 0) out.set(prac.id, mint);
    }
    return out;
  }, [viewMode, loadVenueResources, date, filteredPractitioners, venueResources, bookings, startHour, venueId, venueTimezone, slotHeightPx]);

  /** Free resource slots on linked venue columns (read-only + native-grid linked). */
  const linkedResourceAvailabilityByColumnKey = useMemo(() => {
    if (viewMode !== 'day') {
      return new Map<string, ResourceAvailabilityMintSlot[]>();
    }
    const out = new Map<string, ResourceAvailabilityMintSlot[]>();
    for (const col of visibleLinkedColumns) {
      const venue = linkedVenueById.get(col.venueId);
      const resources = venue?.resources ?? [];
      if (resources.length === 0) continue;
      const onColumn = resources.filter(
        (r) => r.displayOnCalendarId === col.practitionerId && r.isActive,
      );
      if (onColumn.length === 0) continue;
      const resourceIds = new Set(onColumn.map((r) => r.id));
      const host = venue?.practitioners.find((p) => p.id === col.practitionerId);
      const existingBookings: EngineResourceBooking[] = (venue?.bookings ?? [])
        .filter(
          (b) =>
            b.bookingDate === date &&
            b.resourceId &&
            resourceIds.has(b.resourceId) &&
            (RESOURCE_BOOKING_CAPACITY_STATUSES as readonly string[]).includes(b.status),
        )
        .map((b) => ({
          id: b.id,
          resource_id: b.resourceId!,
          booking_time: b.bookingTime.slice(0, 5),
          booking_end_time: (b.bookingEndTime ?? b.bookingTime).slice(0, 5),
          status: b.status,
        }));
      const vrList = onColumn.map((r) =>
        linkedResourceToVenueResource(r, col.venueId, host?.workingHours),
      );
      const mint = computeResourceAvailabilityMintSlots({
        date,
        venueTimezone: col.venueTimezone,
        resources: vrList,
        existingBookings,
        startHour,
        slotHeightPx: slotHeightPx,
        slotMinutes: SLOT_MINUTES,
      });
      if (mint.length > 0) out.set(col.key, mint);
    }
    return out;
  }, [viewMode, visibleLinkedColumns, linkedVenueById, date, startHour, slotHeightPx]);

  const serviceMap = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);


  const serviceMapForBooking = useCallback(
    (b: Booking): Map<string, AppointmentService> => {
      if (b._linkedOwnerVenueId) {
        return linkedServiceMapsByVenue.get(b._linkedOwnerVenueId) ?? new Map();
      }
      return serviceMap;
    },
    [linkedServiceMapsByVenue, serviceMap],
  );

  const bookingRowOverlayForId = useCallback(
    (bookingId: string): BookingRowOverlay => calendarBookingOverlays[bookingId] ?? {},
    [calendarBookingOverlays],
  );

  const bookingForCalendarDisplay = useCallback(
    (b: Booking): Booking =>
      applyBookingRowOverlayFields(b, bookingRowOverlayForId(b.id)) as Booking,
    [bookingRowOverlayForId],
  );

  const calendarBlockPaletteForBooking = useCallback(
    (b: Booking): ReturnType<typeof bookingCalendarBlockPalette> =>
      bookingCalendarBlockPaletteForDisplayRow(b, bookingRowOverlayForId(b.id)),
    [bookingRowOverlayForId],
  );

  function bookingsForPractitioner(pracId: string, dayDate: string): Booking[] {
    return allGridBookings.filter((b) => {
      if (b.booking_date !== dayDate) return false;
      if (resolveBookingColumnId(b, resourceParentById) !== pracId) return false;
      if (!bookingMatchesCalendarStatusFilter(b, filterStatus)) return false;
      return true;
    });
  }

  function getBookingDuration(b: Booking): number {
    return bookingCalendarDisplaySpanMinutes(b, serviceMapForBooking(b));
  }

  function slotTop(time: string): number {
    const mins = timeToMinutes(time);
    const offset = mins - startHour * 60;
    return (offset / SLOT_MINUTES) * slotHeightPx;
  }

  function slotHeightFromDuration(durationMins: number): number {
    /**
     * Bars are drawn to scale, including below one grid slot.
     *
     * This used to floor at a whole slot, so a 5 or 10 minute appointment was
     * drawn the same size as a 15 minute one: the drag handle would let you take
     * a booking down to 5 minutes and the bar would not move. The floor existed
     * because the card's chrome used to need a slot's worth of room, which it no
     * longer does now that the tray and the card's padding both collapse on short
     * bars. A minimum of a couple of pixels keeps a bar clickable at any zoom.
     */
    return Math.max(
      (durationMins / SLOT_MINUTES) * slotHeightPx,
      BOOKING_BLOCK_MIN_RENDER_HEIGHT_PX,
    );
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
      // Functional, like the day and week branches above: reading `monthAnchor`
      // from this render let a burst of rapid clicks all step from the same
      // month and land short of where the user had clicked to.
      setMonthAnchor((previous) => {
        const d = new Date(`${startOfMonth(previous)}T12:00:00`);
        d.setMonth(d.getMonth() + dir);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        return `${y}-${m}-01`;
      });
    }
  }

  /**
   * Jump every anchor to one specific day (an explicit pick or "Today"), as
   * opposed to {@link navigateDay}, which steps the anchor for the current view
   * only. Accepts an updater for prop compatibility with the toolbar; it is
   * resolved once against the latest date so all three anchors agree.
   */
  function navigateDayDirect(next: string | ((previous: string) => string)) {
    const iso = typeof next === 'function' ? next(dateRef.current) : next;
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
    setEventBookPrefill(null);
    setPrefillPractitionerId(pracId);
    setPrefillDate(dateStr);
    setPrefillTime(time);
    setStaffBookingModal('new');
    setSlotMenu(null);
  }

  function openWalkInAtSlot(pracId: string, dateStr: string, time: string) {
    setEventBookPrefill(null);
    setPrefillPractitionerId(pracId);
    setPrefillDate(dateStr);
    setPrefillTime(time);
    setStaffBookingModal('walk-in');
    setSlotMenu(null);
  }

  /**
   * Step one of a cross-account move: open the booking form on the target
   * calendar at the dropped slot, with the client's details filled in from the
   * booking that was dragged. The service is chosen afresh: the target venue has
   * its own catalogue, so the dragged booking's service id means nothing there.
   */
  function startCrossVenueRebook(move: CrossVenueMoveDialog) {
    const b = move.booking;
    const [firstName, ...rest] = (b.guest_name ?? '').trim().split(/\s+/);
    const rebook: CrossVenueRebook = {
      bookingId: b.id,
      guestName: b.guest_name,
      originalLabel: `${b.booking_time.slice(0, 5)} on ${formatDateNice(b.booking_date)} with ${move.sourceCalendarName}`,
      targetLabel: `${move.targetCalendarName}'s calendar`,
      bootstrap: {
        v: 1,
        surface: 'unified_scheduling',
        guest: {
          firstName: firstName ?? '',
          lastName: rest.join(' '),
          email: b.guest_email ?? null,
          phone: b.guest_phone ?? null,
        },
        initialDate: move.dateStr,
      },
    };
    setCrossVenueMove(null);
    setCrossVenueRebook(rebook);
    if (move.targetLinkedColumn) {
      const venue = linkedVenueById.get(move.targetLinkedColumn.venueId);
      if (!venue) {
        setCrossVenueRebook(null);
        addToast('That calendar is no longer available.', 'error');
        return;
      }
      setLinkedCreating({
        venue,
        practitionerId: move.targetLinkedColumn.practitionerId,
        time: move.time,
        intent: 'new',
      });
      return;
    }
    openNewAtSlot(move.targetColumnKey, move.dateStr, move.time);
  }

  /** Step two: cancel the original through the ordinary cancel path (client told, deposit rules applied). */
  async function cancelOriginalAfterCrossVenueRebook(prompt: CrossVenueRebook) {
    const ok = await quickPatchBooking(prompt.bookingId, { status: 'Cancelled' });
    setCancelOriginalPrompt(null);
    if (ok) addToast(`Cancelled the original booking with ${prompt.guestName}.`, 'success');
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
      void refetchBlocks();
      void refetchSchedule();
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
          void refetchBlocks();
          void refetchSchedule();
        }
      } catch {
        addToast('Could not update block duration', 'error');
        setBlocks((rows) => rows.map((bl) => (bl.id === prev.id ? prev : bl)));
      }
    },
    [addToast, refetchBlocks, refetchSchedule],
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
      void refetchBlocks();
      void refetchSchedule();
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
        void refetchBlocks();
        void refetchSchedule();
      }
    } finally {
      setBlockSaving(false);
    }
  }

  /** A failed save takes its undo entry with it: there is nothing to put back. */
  function forgetUndoForFailedSave(bookingId: string) {
    setLastScheduleEditUndo((undo) => {
      if (!undo) return undo;
      return undo.prev.id === bookingId ? null : undo;
    });
  }

  /**
   * Move one booking row. A service of a multi-service visit moves on its own
   * (Docs/visit-services-independent-plan.md); the whole visit moves from the
   * booking's Modify form.
   */
  async function patchBookingMove(
    booking: Booking,
    newDate: string,
    newTime: string,
    newPracId: string,
    opts?: { allowDuringBreaks?: boolean },
  ): Promise<{ savePromise: Promise<'ok' | 'failed'> }> {
    const prev = { ...booking };
    const realPracId = resolveLinkedGridPractitionerIdForPatch(newPracId);
    const linkedOwnerVenueId = booking._linkedOwnerVenueId;
    const timeHm = newTime.length === 5 ? newTime : newTime.slice(0, 5);
    const timeForStore = newTime.length === 5 ? `${newTime}:00` : newTime;
    const dur = getBookingDuration(booking);
    const endHm = minutesToTime(timeToMinutes(timeHm) + dur);
    const bookingEndForStore = `${endHm}:00`;
    const estimatedEndForStore = estimatedEndIsoFromSchedule(newDate, timeHm, endHm);
    setLastScheduleEditUndo({ kind: 'move', prev });
    if (linkedOwnerVenueId) {
      setLinkedVenues((venues) =>
        venues.map((v) => {
          if (v.venueId !== linkedOwnerVenueId) return v;
          return {
            ...v,
            bookings: v.bookings.map((lb) => {
              if (lb.id !== booking.id) return lb;
              return {
                ...lb,
                bookingDate: newDate,
                bookingTime: timeHm,
                bookingEndTime: endHm,
                practitionerId: realPracId,
              };
            }),
          };
        }),
      );
    } else {
      setBookings((rows) =>
        rows.map((b) =>
          b.id === booking.id
            ? {
                ...b,
                booking_date: newDate,
                booking_time: timeForStore,
                booking_end_time: bookingEndForStore,
                estimated_end_time: estimatedEndForStore,
                ...(b.calendar_id != null
                  ? { calendar_id: newPracId }
                  : { practitioner_id: newPracId }),
              }
            : b,
        ),
      );
    }
    beginScheduleEditFollowUp(booking.id);

    const savePromise = (async (): Promise<'ok' | 'failed'> => {
      try {
        const res = await fetch(`/api/venue/bookings/${booking.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            booking_date: newDate,
            booking_time: timeForStore,
            practitioner_id: realPracId,
            booking_end_time: bookingEndForStore,
            allow_manual_overlap: true,
            // Always on for a diary edit: staff may put a booking anywhere on
            // the day, before open, after close or on a day the calendar does
            // not work. This used to follow the diary's own reading of the
            // closed stripes, which cannot see everything the server counts as
            // hours (a buffer or processing tail past close, a service's own
            // availability window, a stripe off the drawn grid), so a drag the
            // diary judged in-hours came back 409 "Outside working hours", and
            // a booking already sitting outside hours could not be resized at
            // all. The stripes still drive the amber note; they no longer
            // decide the permission. Leave, blocks and breaks are separate
            // gates and are not relaxed here.
            allow_outside_hours: true,
            allow_during_breaks: opts?.allowDuringBreaks === true,
            defer_modification_guest_notification: true,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          addToast((j as { error?: string }).error ?? 'Could not move appointment', 'error');
          if (linkedOwnerVenueId) {
            setLinkedVenues((venues) =>
              venues.map((v) => {
                if (v.venueId !== linkedOwnerVenueId) return v;
                return {
                  ...v,
                  bookings: v.bookings.map((lb) => {
                    if (lb.id !== prev.id) return lb;
                    return {
                      ...lb,
                      bookingDate: prev.booking_date,
                      bookingTime: prev.booking_time.slice(0, 5),
                      bookingEndTime: prev.booking_end_time?.slice(0, 5) ?? null,
                      practitionerId: resolveLinkedGridPractitionerIdForPatch(
                        prev._linkedColumnKey ?? prev.practitioner_id ?? '',
                      ),
                    };
                  }),
                };
              }),
            );
          } else {
            setBookings((rows) => rows.map((b) => (b.id === prev.id ? prev : b)));
          }
          forgetUndoForFailedSave(prev.id);
          clearScheduleEditFollowUpForBooking(booking.id);
          return 'failed';
        }
        void refetchBookingsList();
        if (linkedOwnerVenueId) void requestLinkedCalendarSync();
        return 'ok';
      } catch {
        addToast('Could not move appointment', 'error');
        if (linkedOwnerVenueId) {
          void requestLinkedCalendarSync();
        } else {
          setBookings((rows) => rows.map((b) => (b.id === prev.id ? prev : b)));
        }
        forgetUndoForFailedSave(prev.id);
        clearScheduleEditFollowUpForBooking(booking.id);
        return 'failed';
      }
    })();

    {
      scheduleEditSaveRef.current = { bookingId: booking.id, promise: savePromise };
      void savePromise.finally(() => {
        if (scheduleEditSaveRef.current?.bookingId === booking.id) {
          scheduleEditSaveRef.current = null;
        }
      });
    }
    return { savePromise };
  }

  const patchBookingResize = useCallback(
    async (
      booking: Booking,
      newEndHm: string,
      opts?: { allowDuringBreaks?: boolean },
    ) => {
      const prev = { ...booking };
      const linkedOwnerVenueId = booking._linkedOwnerVenueId;
      const startHm = booking.booking_time.slice(0, 5);
      const endLen5 = minutesToTime(timeToMinutes(newEndHm));
      if (timeToMinutes(newEndHm) <= timeToMinutes(startHm)) return;
      const bookingEndForStore = `${endLen5}:00`;
      const estimatedEndForStore = estimatedEndIsoFromSchedule(
        booking.booking_date,
        startHm,
        endLen5,
      );
      /**
       * A resize changes the core duration, so the booking's processing blocks
       * have to come with it. Without this the server validates the OLD blocks
       * against the NEW duration and refuses any shrink past the last gap's end
       * ("Processing blocks must lie within the service duration"), which the
       * grid could only surface as a failed drag.
       */
      const resizeBlocks = bookingProcessingBlocksForPatch(
        booking,
        serviceMapForBooking(booking),
        timeToMinutes(endLen5) - timeToMinutes(startHm),
      );
      setLastScheduleEditUndo({ kind: 'resize', prev });
      if (linkedOwnerVenueId) {
        setLinkedVenues((venues) =>
          venues.map((v) => {
            if (v.venueId !== linkedOwnerVenueId) return v;
            return {
              ...v,
              bookings: v.bookings.map((lb) => {
                if (lb.id !== booking.id) return lb;
                return {
                  ...lb,
                  bookingEndTime: endLen5,
                  estimatedEndTime: estimatedEndForStore,
                  // Repaint the gap with the resize; the old blocks would
                  // overflow the shortened block until the refetch lands.
                  ...(resizeBlocks ? { processingTimeBlocks: resizeBlocks } : {}),
                };
              }),
            };
          }),
        );
      } else {
        setBookings((rows) =>
          rows.map((b) =>
            b.id === booking.id
              ? {
                  ...b,
                  booking_end_time: bookingEndForStore,
                  estimated_end_time: estimatedEndForStore,
                  // Repaint the gap with the resize; the old blocks would
                  // overflow the shortened block until the refetch lands.
                  ...(resizeBlocks ? { processing_time_blocks: resizeBlocks } : {}),
                }
              : b,
          ),
        );
      }
      /**
       * No notify / skip / undo pill, and no guest notification.
       *
       * A resize changes the DURATION, not when the guest is due. The staff
       * Modify form has always treated a duration-only edit that way, and the
       * calendar armed the pill for it purely because it shares this code path
       * with the drag-to-move: changing a booking from 30 to 45 minutes offered
       * to tell the guest their appointment had moved, and told them so on its
       * own after a minute if nobody dismissed it. The move path (above) still
       * arms it, and the toolbar's Undo still covers a resize.
       */
      const savePromise = (async (): Promise<'ok' | 'failed'> => {
        try {
          const res = await fetch(`/api/venue/bookings/${booking.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              booking_end_time: bookingEndForStore,
              ...(resizeBlocks ? { processing_time_blocks: resizeBlocks } : {}),
              allow_manual_overlap: true,
              // Always on, as on the move: see patchBookingMove.
              allow_outside_hours: true,
              allow_during_breaks: opts?.allowDuringBreaks === true,
              skip_booking_modification_guest_notification: true,
            }),
          });
          if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            addToast((j as { error?: string }).error ?? 'Could not update duration', 'error');
            if (linkedOwnerVenueId) void requestLinkedCalendarSync();
            else setBookings((rows) => rows.map((b) => (b.id === prev.id ? prev : b)));
            setLastScheduleEditUndo((undo) => (undo?.prev.id === prev.id ? null : undo));
            clearScheduleEditFollowUpForBooking(booking.id);
            return 'failed';
          }
          void refetchBookingsList();
          if (linkedOwnerVenueId) void requestLinkedCalendarSync();
          return 'ok';
        } catch {
          addToast('Could not update duration', 'error');
          if (linkedOwnerVenueId) void requestLinkedCalendarSync();
          else setBookings((rows) => rows.map((b) => (b.id === prev.id ? prev : b)));
          setLastScheduleEditUndo((undo) => (undo?.prev.id === prev.id ? null : undo));
          clearScheduleEditFollowUpForBooking(booking.id);
          return 'failed';
        }
      })();

      scheduleEditSaveRef.current = { bookingId: booking.id, promise: savePromise };
      void savePromise.finally(() => {
        if (scheduleEditSaveRef.current?.bookingId === booking.id) {
          scheduleEditSaveRef.current = null;
        }
      });
    },
    [
      addToast,
      clearScheduleEditFollowUpForBooking,
      refetchBookingsList,
      requestLinkedCalendarSync,
      serviceMapForBooking,
    ],
  );

  /**
   * What the screen-bottom notify / skip / undo bar describes: the booking the
   * deferred notify is armed for as it stands now, against the row saved before
   * the edit. A visit is keyed on its first service, which `allGridBookings`
   * also holds. Null once the prompt is answered or times out.
   */
  const scheduleFollowUpChange = useMemo<ScheduleEditFollowUpChange | null>(() => {
    if (!dragMoveConfirmBookingId) return null;
    const current = allGridBookings.find((b) => b.id === dragMoveConfirmBookingId);
    if (!current) return null;
    const undo = lastScheduleEditUndo?.prev.id === current.id ? lastScheduleEditUndo : null;
    const prev = undo?.prev ?? current;
    const kind = undo?.kind ?? 'move';
    const endHm = (row: Booking): string =>
      row.booking_end_time && row.booking_end_time.trim() !== ''
        ? row.booking_end_time.slice(0, 5)
        : minutesToTime(
            timeToMinutes(row.booking_time.slice(0, 5)) +
              bookingDurationMinutes(row, serviceMapForBooking(row)),
          );
    const prevColumn = resolveBookingColumnId(prev, resourceParentById);
    const column = resolveBookingColumnId(current, resourceParentById);
    const staffName =
      column && prevColumn !== column
        ? (linkedNativeGridColumnByKey.get(column)?.practitionerName ??
          filteredPractitioners.find((p) => p.id === column)?.name ??
          null)
        : null;
    return {
      kind,
      guestName: current.guest_name,
      staffName,
      fromDate: prev.booking_date,
      fromTime: kind === 'resize' ? endHm(prev) : prev.booking_time.slice(0, 5),
      toDate: current.booking_date,
      toTime: kind === 'resize' ? endHm(current) : current.booking_time.slice(0, 5),
      accent: bookingCalendarBlockPalette(current).accent,
    };
  }, [
    dragMoveConfirmBookingId,
    allGridBookings,
    lastScheduleEditUndo,
    resourceParentById,
    linkedNativeGridColumnByKey,
    filteredPractitioners,
    serviceMapForBooking,
  ]);

  const undoLastScheduleEdit = useCallback(async () => {
    if (!lastScheduleEditUndo || scheduleUndoPending) return;
    const { kind, prev } = lastScheduleEditUndo;
    const bookingId = prev.id;
    const inflight = scheduleEditSaveRef.current;
    if (inflight?.bookingId === bookingId) {
      const saveResult = await inflight.promise;
      // A failed save has already been rolled back; there is nothing left to undo.
      if (saveResult === 'failed') return;
    }

    const colId = resolveBookingColumnId(prev, resourceParentById);
    if (!colId) {
      addToast('Cannot undo: calendar column is no longer available', 'error');
      return;
    }

    const startHm = prev.booking_time.slice(0, 5);
    const bookingEndForStore =
      prev.booking_end_time && prev.booking_end_time.trim() !== ''
        ? bookingTimeToStore(prev.booking_end_time)
        : `${minutesToTime(timeToMinutes(startHm) + bookingDurationMinutes(prev, serviceMapForBooking(prev)))}:00`;
    const linkedOwnerVenueId = prev._linkedOwnerVenueId;
    const undoPracId = resolveLinkedGridPractitionerIdForPatch(colId);
    /**
     * `prev` is the pre-edit row, so its blocks are the ones the booking had
     * before the resize trimmed them. Fitting them to the restored duration
     * hands back exactly that, rather than leaving the trim behind on a booking
     * that is its original length again.
     */
    const undoBlocks = bookingProcessingBlocksForPatch(
      prev,
      serviceMapForBooking(prev),
      timeToMinutes(bookingEndForStore.slice(0, 5)) - timeToMinutes(startHm),
    );

    setScheduleUndoPending(true);
    if (linkedOwnerVenueId) {
      setLinkedVenues((venues) =>
        venues.map((v) => {
          if (v.venueId !== linkedOwnerVenueId) return v;
          return {
            ...v,
            bookings: v.bookings.map((lb) => {
              if (lb.id !== bookingId) return lb;
              return {
                ...lb,
                bookingDate: prev.booking_date,
                bookingTime: prev.booking_time.slice(0, 5),
                bookingEndTime: prev.booking_end_time?.slice(0, 5) ?? null,
                practitionerId: undoPracId,
                estimatedEndTime: prev.estimated_end_time,
              };
            }),
          };
        }),
      );
    } else {
      setBookings((rows) => rows.map((b) => (b.id === bookingId ? { ...prev } : b)));
    }

    const skipBookingModificationGuestNotification =
      pendingDeferredModificationNotifyBookingIdRef.current === bookingId;

    try {
      if (kind === 'resize') {
        const res = await fetch(`/api/venue/bookings/${bookingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            booking_end_time: bookingEndForStore,
            ...(undoBlocks ? { processing_time_blocks: undoBlocks } : {}),
            allow_manual_overlap: true,
            // The booking may be going back to a slot outside hours, which is
            // where the diary let it sit (see patchBookingMove). Without this
            // an undo could be refused with "Outside working hours".
            allow_outside_hours: true,
            ...(skipBookingModificationGuestNotification
              ? { skip_booking_modification_guest_notification: true }
              : {}),
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          addToast((j as { error?: string }).error ?? 'Could not undo', 'error');
          void refetchBookingsList();
          return;
        }
      } else {
        const timeForStore = bookingTimeToStore(prev.booking_time);
        const res = await fetch(`/api/venue/bookings/${bookingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            booking_date: prev.booking_date,
            booking_time: timeForStore,
            practitioner_id: undoPracId,
            booking_end_time: bookingEndForStore,
            allow_manual_overlap: true,
            allow_outside_hours: true,
            ...(skipBookingModificationGuestNotification
              ? { skip_booking_modification_guest_notification: true }
              : {}),
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          addToast((j as { error?: string }).error ?? 'Could not undo', 'error');
          void refetchBookingsList();
          return;
        }
      }
      cancelPendingDeferredModificationGuestNotify();
      setLastScheduleEditUndo(null);
      setDragMoveConfirmBookingId(null);
      addToast('Change undone', 'success');
      void refetchBookingsList();
      if (linkedOwnerVenueId) void requestLinkedCalendarSync();
    } catch {
      addToast('Could not undo', 'error');
      void refetchBookingsList();
    } finally {
      setScheduleUndoPending(false);
    }
  }, [
    addToast,
    lastScheduleEditUndo,
    resourceParentById,
    scheduleUndoPending,
    serviceMapForBooking,
    cancelPendingDeferredModificationGuestNotify,
    refetchBookingsList,
    requestLinkedCalendarSync,
  ]);

  function applyCalendarBookingQuickPatch(b: Booking, body: Record<string, unknown>): Booking {
    if (typeof body.status === 'string') {
      const from = b.status as BookingStatus;
      const to = body.status as BookingStatus;
      return { ...b, ...overlayFromStatusTransition(from, to, isTableReservationBooking(b)) };
    }
    if (body.client_arrived !== undefined) {
      return { ...b, ...overlayFromClientArrivedPatch(Boolean(body.client_arrived)) };
    }
    return { ...b, ...overlayFromPatchBody(body, b) };
  }

  function applyLinkedBookingPatchFromPayload(lb: LinkedBooking, payload: Record<string, unknown>): LinkedBooking {
    const overlay = overlayFromPatchPayload(payload);
    return {
      ...lb,
      ...(overlay.status != null ? { status: overlay.status } : {}),
      ...(overlay.client_arrived_at !== undefined
        ? { clientArrivedAt: overlay.client_arrived_at }
        : {}),
      ...(overlay.staff_attendance_confirmed_at !== undefined
        ? { staffAttendanceConfirmedAt: overlay.staff_attendance_confirmed_at }
        : {}),
      ...(overlay.guest_attendance_confirmed_at !== undefined
        ? { guestAttendanceConfirmedAt: overlay.guest_attendance_confirmed_at }
        : {}),
    };
  }

  function applyCalendarBookingPatchFromPayload(b: Booking, payload: Record<string, unknown>): Booking {
    return { ...b, ...overlayFromPatchPayload(payload) };
  }

  function mergeCalendarBookingOverlay(bookingId: string, patch: BookingRowOverlay) {
    if (Object.keys(patch).length === 0) return;
    setCalendarBookingOverlays((prev) => ({
      ...prev,
      [bookingId]: mergeBookingRowOverlay(prev[bookingId] ?? {}, patch),
    }));
  }

  async function quickPatchBooking(
    bookingId: string,
    body: Record<string, unknown>,
    opts?: { skipRefetch?: boolean },
  ): Promise<boolean> {
    setQuickActionId(bookingId);
    const gridBooking = allGridBookings.find((b) => b.id === bookingId) ?? null;
    const linkedOwnerVenueId = gridBooking?._linkedOwnerVenueId ?? null;
    const nativeSnapshot = !linkedOwnerVenueId
      ? (bookings.find((b) => b.id === bookingId) ?? null)
      : null;
    const linkedSnapshot = linkedOwnerVenueId
      ? (linkedVenues
          .map((v) => v.bookings.find((lb) => lb.id === bookingId))
          .find((lb) => lb != null) ?? null)
      : null;
    const arrivedOnlyPatch = body.client_arrived !== undefined && body.status === undefined;
    const overlayRow = gridBooking ?? nativeSnapshot ?? linkedSnapshot ?? {};
    const optimisticOverlay =
      typeof body.status === 'string' && gridBooking
        ? overlayFromStatusTransition(
            gridBooking.status as BookingStatus,
            body.status as BookingStatus,
            isTableReservationBooking(gridBooking),
          )
        : body.client_arrived !== undefined
          ? overlayFromClientArrivedPatch(Boolean(body.client_arrived))
          : overlayFromPatchBody(body, overlayRow);
    if (Object.keys(optimisticOverlay).length > 0) {
      mergeCalendarBookingOverlay(bookingId, optimisticOverlay);
    }

    if (linkedOwnerVenueId && linkedSnapshot) {
      setLinkedVenues((venues) =>
        venues.map((v) => ({
          ...v,
          bookings: v.bookings.map((lb) => {
            if (lb.id !== bookingId) return lb;
            const next = { ...lb };
            if (typeof body.status === 'string') next.status = body.status as string;
            if (body.client_arrived !== undefined) {
              next.clientArrivedAt = body.client_arrived ? new Date().toISOString() : null;
            }
            return next;
          }),
        })),
      );
    } else if (nativeSnapshot || gridBooking) {
      setBookings((rows) =>
        rows.map((b) => (b.id === bookingId ? applyCalendarBookingQuickPatch(b, body) : b)),
      );
    }

    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        if (linkedSnapshot) {
          setLinkedVenues((venues) =>
            venues.map((v) => ({
              ...v,
              bookings: v.bookings.map((lb) => (lb.id === bookingId ? linkedSnapshot : lb)),
            })),
          );
        } else if (nativeSnapshot) {
          setBookings((rows) => rows.map((b) => (b.id === bookingId ? nativeSnapshot : b)));
        }
        setCalendarBookingOverlays((prev) => {
          const next = { ...prev };
          delete next[bookingId];
          return next;
        });
        // Unpaid promotion (plan 6.4): the accept dialog owns the decision.
        if (
          acceptUnpaidGuard.intercept(bookingId, res.status, payload, (extra) =>
            quickPatchBooking(bookingId, { ...body, ...extra }, opts),
          )
        ) {
          return false;
        }
        addToast((payload.error as string | undefined) ?? 'Update failed', 'error');
        return false;
      }
      if (payload && typeof payload === 'object' && !('error' in payload)) {
        mergeCalendarBookingOverlay(bookingId, overlayFromPatchPayload(payload));
        if (linkedOwnerVenueId) {
          setLinkedVenues((venues) =>
            venues.map((v) => ({
              ...v,
              bookings: v.bookings.map((lb) =>
                lb.id === bookingId ? applyLinkedBookingPatchFromPayload(lb, payload) : lb,
              ),
            })),
          );
        } else {
          setBookings((rows) =>
            rows.map((b) =>
              b.id === bookingId ? applyCalendarBookingPatchFromPayload(b, payload) : b,
            ),
          );
        }
      }
      if (body.status === 'Cancelled') {
        scheduleWaitlistAlertsRefresh();
      }
      if (!arrivedOnlyPatch && !opts?.skipRefetch) {
        void refetchBookingsList();
        if (linkedOwnerVenueId) void requestLinkedCalendarSync();
      } else if (linkedOwnerVenueId) {
        void requestLinkedCalendarSync();
      }
      return true;
    } catch {
      addToast('Update failed', 'error');
      if (linkedSnapshot) {
        setLinkedVenues((venues) =>
          venues.map((v) => ({
            ...v,
            bookings: v.bookings.map((lb) => (lb.id === bookingId ? linkedSnapshot : lb)),
          })),
        );
      } else if (nativeSnapshot) {
        setBookings((rows) => rows.map((b) => (b.id === bookingId ? nativeSnapshot : b)));
      }
      setCalendarBookingOverlays((prev) => {
        const next = { ...prev };
        delete next[bookingId];
        return next;
      });
      return false;
    } finally {
      setQuickActionId(null);
    }
  }

  function clearCalendarDragUi() {
    interactingRef.current = false;
    setDragBooking(null);
    setDragExcludeBookingId(null);
    setDragBlock(null);
    setDragExcludeBlockId(null);
    setCalendarDragPreview(null);
    setCalendarDragTarget(null);
    calendarDragTargetRef.current = null;
    if (dragTouchScrollBlockerRef.current) {
      document.removeEventListener('touchmove', dragTouchScrollBlockerRef.current);
      dragTouchScrollBlockerRef.current = null;
    }
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
    interactingRef.current = true;
    dragActivatedRef.current = true;
    // The hold elapsed and the sensor armed: clear the "Hold to move" hint, give the same
    // haptic tick as the duration slider, and suppress native scroll for the drag's
    // duration (the grip's touch-action stays pannable at rest so scrolls pass through).
    setMoveArming(null);
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(12);
      }
    } catch {
      /* ignore */
    }
    if (!dragTouchScrollBlockerRef.current) {
      const blockTouchScroll = (ev: TouchEvent) => ev.preventDefault();
      document.addEventListener('touchmove', blockTouchScroll, { passive: false });
      dragTouchScrollBlockerRef.current = blockTouchScroll;
    }
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
      const deltaMinutes =
        compactActive && Math.abs(e.delta.y) < COMPACT_DRAG_DEADZONE_PX
          ? 0
          : snapCalendarMoveMinutes((e.delta.y / slotHeightPx) * SLOT_MINUTES);
      const duration = blockDurationMinutes(bl);
      // The day ends at midnight: a bar dragged past either end stops there.
      const targetStartMins = Math.max(0, Math.min(originalStartMins + deltaMinutes, 24 * 60 - duration));
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
          allGridBookings,
          displayBlocks,
          serviceMapForBooking,
          pracClassBlocks,
          pracEventBlocks,
          resourceParentById,
          { ignoreBookings: true, excludeBlockId: bl.id },
        );
      const pracName =
        linkedNativeGridColumnByKey.get(pracId)?.practitionerName ??
        filteredPractitioners.find((p) => p.id === pracId)?.name ??
        'Staff';
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
    const deltaMinutes =
      compactActive && Math.abs(e.delta.y) < COMPACT_DRAG_DEADZONE_PX
        ? 0
        : snapCalendarMoveMinutes((e.delta.y / slotHeightPx) * SLOT_MINUTES);
    /**
     * The footprint the drop outline mirrors and the checks judge: the row's
     * card as it is painted (cut at the last busy minute, so processing that
     * runs into or past the end of the service is left out) and the buffer
     * band when it sits directly under the card. A service of a visit moves on
     * its own.
     */
    const movedRows = [b];
    const rowOffset = (row: Booking) => timeToMinutes(row.booking_time.slice(0, 5)) - originalStartMins;
    const duration = Math.max(
      MIN_APPOINTMENT_CORE_DURATION_MINUTES,
      bookingMoveFootprintMinutes(
        movedRows.map((row) => {
          const map = serviceMapForBooking(row);
          return {
            offsetMinutes: rowOffset(row),
            displayMinutes: getBookingDuration(row),
            coreMinutes: bookingCoreDurationForProcessing(row, map),
            activeMinutes: bookingFreeRegions(row, map).activeEnd,
            tailMinutes: bookingProcessingTailMinutes(row, map),
            bufferMinutes: bookingBufferMinutes(row, map),
          };
        }),
      ),
    );
    // The day ends at midnight: a bar dragged past either end stops there.
    const targetStartMins = Math.max(0, Math.min(originalStartMins + deltaMinutes, 24 * 60 - duration));
    const endMin = targetStartMins + duration;
    // The day's own bounds, not the stretched grid: landing on the stretched
    // rows is exactly what "outside hours" means.
    const dayStartMin = baseStartHour * 60;
    const dayEndMin = baseEndHour * 60;
    const pracClassBlocks = classBlocksForGrid.filter((bl) => bl.calendar_id === pracId && bl.date === dateStr);
    const pracEventBlocks = eventBlocksForGrid.filter((bl) => bl.calendar_id === pracId && bl.date === dateStr);
    const candBusy = movedRows.flatMap((row) =>
      practitionerWallBusyIntervalsForCandidateAtSlot(
        row,
        targetStartMins + rowOffset(row),
        serviceMapForBooking(row),
      ),
    );
    // Landing before open / after close is allowed (staff can book past opening
    // hours), surfaced as an amber warning rather than blocked. Only a genuine
    // conflict (a busy overlap, leave, class, event or hand-made block) blocks
    // the move. The canvas-bounds test alone almost never fired, because the
    // drawn grid is wider than opening hours; the closure blocks themselves are
    // the accurate source (SA-H5).
    const outsideHours =
      targetStartMins < dayStartMin ||
      endMin > dayEndMin ||
      windowCrossesNonWorkingBlock(targetStartMins, endMin, pracId, dateStr, displayBlocks);
    const overBreak = windowCrossesBreakBlock(
      targetStartMins,
      endMin,
      pracId,
      dateStr,
      displayBlocks,
    );
    const conflict = appointmentWindowCollides(
      targetStartMins,
      endMin,
      pracId,
      dateStr,
      b.id,
      allGridBookings,
      displayBlocks,
      serviceMapForBooking,
      pracClassBlocks,
      pracEventBlocks,
      resourceParentById,
      { ignoreBookings: true, candidatePractitionerBusy: candBusy },
    );
    const invalid = conflict;
    const pracName =
      linkedNativeGridColumnByKey.get(pracId)?.practitionerName ??
      filteredPractitioners.find((p) => p.id === pracId)?.name ??
      'Staff';
    const timeLabel = minutesToTime(targetStartMins);
    const sameColumn = resolveBookingColumnId(b, resourceParentById) === pracId && b.booking_date === dateStr;
    const label = sameColumn ? `Move to ${timeLabel}` : `Move to ${pracName} · ${timeLabel}`;
    setCalendarDragPreview({ label, invalid, outsideHours });
    setCalendarDragTarget({ pracId, startMin: targetStartMins, endMin, invalid, outsideHours, overBreak });
  }

  function handleDragCancel(_e: DragCancelEvent) {
    clearCalendarDragUi();
    clearGridExtension();
  }

  function handleDragEnd(e: DragEndEvent) {
    const b = e.active.data.current?.booking as Booking | undefined;
    const bl = e.active.data.current?.block as CalendarBlock | undefined;
    const over = e.over;
    const target = calendarDragTargetRef.current;
    clearCalendarDragUi();
    // Folded back in the same render as the move below, so a booking that landed
    // outside hours is drawn on a grid that already reaches it.
    clearGridExtension();
    if ((!b && !bl) || !over?.data?.current) return;
    // C9 — no resolved target means the pointer never moved, so this was a
    // press-and-hold, not a drag. dnd-kit's delay activation starts a drag on a
    // TIMER with no movement required (core 6.3.1), and its 10px tolerance is
    // Euclidean, so ordinary tremor does not cancel it. `onDragMove` is the only
    // handler wired to `calendarDragTargetRef` (there is no `onDragOver`), so it
    // never fired and the ref is still null.
    //
    // This used to fall through: `target?.invalid` was `undefined`, i.e. falsy,
    // so the availability gate was skipped, and `target?.startMin ?? slotStartMins`
    // then took the slot that happened to sit under the finger. The booking was
    // written there immediately with `allow_manual_overlap: true`, which disables
    // the server-side conflict check too, leaving only a 60-second undo window.
    //
    // A no-op is strictly safer than a distance-based guard, which would still
    // let a 1px twitch through the CALENDAR_MOVE_INCREMENT_MINUTES = 1 path.
    // Silent by design: from the user's point of view nothing happened.
    if (!target) return;
    if (target.invalid) {
      addToast('That time is not available', 'error');
      return;
    }
    const { pracId, dateStr } = over.data.current as {
      pracId: string;
      dateStr: string;
    };
    const targetStartMins = target.startMin;
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
    // A booking can only be moved within its OWN venue: a linked (other-venue)
    // booking must stay in that venue's columns, and an own booking must not land
    // on a linked column. Otherwise the move would PATCH a foreign practitioner /
    // calendar id onto the booking. (The drop column's owning venue is the linked
    // column's `venueId`, or this venue for a native column.)
    const draggedOwnerVenueId = b._linkedOwnerVenueId ?? venueId;
    const targetLinkedColumn = linkedNativeGridColumnByKey.get(pracId) ?? null;
    const targetOwnerVenueId = targetLinkedColumn?.venueId ?? venueId;
    if (draggedOwnerVenueId !== targetOwnerVenueId) {
      const sourceLinkedColumn = b._linkedColumnKey
        ? linkedNativeGridColumnByKey.get(b._linkedColumnKey) ?? null
        : null;
      const sourceColumnId = resolveBookingColumnId(b, resourceParentById);
      setCrossVenueMove({
        booking: b,
        sourceCalendarName:
          sourceLinkedColumn?.practitionerName ??
          practitioners.find((p) => p.id === sourceColumnId)?.name ??
          'its current calendar',
        sourceVenueName: sourceLinkedColumn?.venueName ?? null,
        targetColumnKey: pracId,
        targetCalendarName:
          targetLinkedColumn?.practitionerName ??
          practitioners.find((p) => p.id === pracId)?.name ??
          'that calendar',
        targetVenueName: targetLinkedColumn?.venueName ?? null,
        targetLinkedColumn,
        dateStr,
        // The booking form offers whole slots, so the dropped minute rounds to five.
        time: minutesToTime(Math.round(targetStartMins / 5) * 5),
      });
      return;
    }
    // The stripes only decide what to SAY. The save is always allowed outside
    // hours (see patchBookingMove); the break flag still has to be sent.
    const movedOutsideHours = target?.outsideHours === true;
    const movedOverBreak = target?.overBreak === true;
    if (movedOverBreak) {
      addToast('Moved over a break.', 'info');
    } else if (movedOutsideHours) {
      addToast('Moved outside opening hours.', 'info');
    }
    // A service of a visit moves alone; landing on one of its own siblings is
    // allowed, as any overlap is, but never silent.
    {
      const startMin = timeToMinutes(newTime.slice(0, 5));
      const ownClash = ownSiblingOverlapCount({
        moved: b,
        startMin,
        endMin: startMin + getBookingDuration(b),
        columnId: pracId,
        dateStr,
        rows: allGridBookings,
        columnIdOf: (row) => resolveBookingColumnId(row as Booking, resourceParentById),
        spanMinutesOf: (row) => getBookingDuration(row as Booking),
        toMinutes: timeToMinutes,
      });
      if (ownClash > 0) addToast('This now overlaps another service of the same visit.', 'info');
    }
    void patchBookingMove(b, dateStr, newTime, pracId, {
      allowDuringBreaks: movedOverBreak,
    });
  }

  /**
   * Wraps a duration-resize drag in a deliberate press-and-hold gate. On pointer down we
   * only *arm* — showing the "Hold to adjust" hint — and start a {@link BOOKING_RESIZE_HOLD_MS}
   * timer. The real `startDrag` fires only if the pointer stays roughly still for the whole
   * window; any travel past {@link BOOKING_RESIZE_HOLD_TOLERANCE_PX}, or an early release,
   * cancels it. Crucially we do NOT preventDefault on touch during the hold, so a scroll that
   * merely grazes the thin handle still pans the page (and that movement cancels the arm) —
   * fixing accidental duration changes while scrolling the calendar on mobile.
   */
  const withResizeHold = useCallback(
    (opts: {
      kind: 'booking' | 'block';
      id: string;
      eligible: boolean;
      startDrag: (startY: number, target: HTMLElement, pointerId: number) => void;
    }) =>
    (downEvent: ReactPointerEvent<HTMLSpanElement>) => {
      const { kind, id, eligible, startDrag } = opts;
      if (!eligible) return;
      if (downEvent.pointerType === 'mouse' && downEvent.button !== 0) return;
      downEvent.stopPropagation();
      // Leave touch unprevented so native scrolling stays live during the hold; for mouse/pen
      // suppress the default so the press doesn't begin a text selection over the booking.
      if (downEvent.pointerType !== 'touch') downEvent.preventDefault();

      const pointerId = downEvent.pointerId;
      const target = downEvent.currentTarget;
      const startX = downEvent.clientX;
      const startY = downEvent.clientY;
      const state = { lastY: startY, done: false, holdTimer: 0 };

      setResizeArming({ kind, id });
      // Rows past close appear while the hold arms, so the bar can grow to midnight.
      armGridExtensionRef.current('bottom', pointerId);

      const cleanup = () => {
        window.clearTimeout(state.holdTimer);
        window.removeEventListener('pointermove', onPreMove);
        window.removeEventListener('pointerup', onPreEnd);
        window.removeEventListener('pointercancel', onPreEnd);
      };
      const settle = (activate: boolean) => {
        if (state.done) return;
        state.done = true;
        cleanup();
        setResizeArming((cur) => (cur && cur.kind === kind && cur.id === id ? null : cur));
        if (activate) {
          try {
            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
              navigator.vibrate(12);
            }
          } catch {
            /* ignore */
          }
          dragActivatedRef.current = true;
          startDrag(state.lastY, target, pointerId);
        } else {
          clearGridExtensionRef.current();
        }
      };
      function onPreMove(ev: globalThis.PointerEvent) {
        if (ev.pointerId !== pointerId) return;
        state.lastY = ev.clientY;
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > BOOKING_RESIZE_HOLD_TOLERANCE_PX) {
          settle(false);
        }
      }
      function onPreEnd(ev: globalThis.PointerEvent) {
        if (ev.pointerId !== pointerId) return;
        settle(false);
      }

      state.holdTimer = window.setTimeout(() => settle(true), BOOKING_RESIZE_HOLD_MS);
      window.addEventListener('pointermove', onPreMove, { passive: true });
      window.addEventListener('pointerup', onPreEnd);
      window.addEventListener('pointercancel', onPreEnd);
    },
    [],
  );

  /**
   * Cosmetic twin of the dnd-kit sensor activation delay: shows the "Hold to move" hint
   * while a reschedule grip is pressed, and clears it on the same conditions the sensor
   * uses to abort (movement past tolerance, early release) or once the delay elapses and
   * the real drag activates. Activation gating itself lives in {@link sensors}.
   */
  const beginMoveHoldHint = useCallback(
    (kind: 'booking' | 'block', id: string) => (downEvent: ReactPointerEvent<HTMLButtonElement>) => {
      if (downEvent.pointerType === 'mouse' && downEvent.button !== 0) return;
      const pointerId = downEvent.pointerId;
      // Stretch the grid to the whole day while the hold arms, so the bar can
      // be carried before opening or past close.
      armGridExtensionRef.current('both', pointerId);
      const startX = downEvent.clientX;
      const startY = downEvent.clientY;
      const clear = () => {
        window.clearTimeout(timer);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        setMoveArming((cur) => (cur && cur.kind === kind && cur.id === id ? null : cur));
      };
      const onMove = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > BOOKING_RESIZE_HOLD_TOLERANCE_PX) {
          clear();
          clearGridExtensionRef.current();
        }
      };
      const onEnd = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        clear();
      };
      const timer = window.setTimeout(clear, BOOKING_RESIZE_HOLD_MS);
      setMoveArming({ kind, id });
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    },
    [],
  );

  /**
   * The empty-slot menu for a click on the grid. Shared by the slot buttons
   * and by the free bands a card paints over its processing time, so booking
   * someone else into a colour's developing time is the same gesture as
   * booking them into empty grid.
   */
  const openSlotMenuForEmptyClick = useCallback(
    (ev: MouseEvent, pid: string, dstr: string, t: string) => {
      const linkedCol = linkedNativeGridColumnByKey.get(pid);
      if (linkedCol) {
        // A linked column must never fall through to the own-venue
        // slot menu (it would create a booking on the wrong venue,
        // and offer Block time on a diary that is not ours). It gets
        // its own two-option menu instead.
        if (linkedCol.action === 'create_edit_cancel') {
          const v = linkedVenueById.get(linkedCol.venueId);
          if (v) {
            setSlotMenu({
              pracId: pid,
              dateStr: dstr,
              time: t,
              x: Math.max(8, Math.min(ev.clientX - 72, window.innerWidth - 200)),
              y: Math.max(8, Math.min(ev.clientY - 8, window.innerHeight - 160)),
              linked: { venue: v, practitionerId: linkedCol.practitionerId },
            });
          }
        } else {
          addToast(
            `${linkedCol.venueName} hasn’t granted permission to create bookings on this calendar.`,
            'info',
          );
        }
        return;
      }
      setSlotMenu({
        pracId: pid,
        dateStr: dstr,
        time: t,
        x: Math.max(8, Math.min(ev.clientX - 72, window.innerWidth - 200)),
        y: Math.max(8, Math.min(ev.clientY - 8, window.innerHeight - 160)),
      });
    },
    [linkedNativeGridColumnByKey, linkedVenueById, addToast],
  );


  /**
   * Bookings this window would land on, ignoring the visit's own rows.
   *
   * A single booking's resize passes `allow_manual_overlap` and permits an
   * overlap in silence. A visit can grow by an hour in one drag, so staff are
   * told when that happens. It stays allowed: deliberate double-booking is
   * legitimate, it just should not be silent.
   */
  const collidingBookingCount = useCallback(
    (params: {
      startMin: number;
      endMin: number;
      columnId: string | null;
      dateStr: string;
      excludeIds: Set<string>;
    }) => {
      if (!params.columnId) return 0;
      const { startMin, endMin, columnId, dateStr, excludeIds } = params;
      return bookings.filter((b) => {
        if (excludeIds.has(b.id)) return false;
        if (b.booking_date !== dateStr) return false;
        if (['Cancelled', 'No-Show'].includes(b.status)) return false;
        if (resolveBookingColumnId(b, resourceParentById) !== columnId) return false;
        const s = timeToMinutes(b.booking_time.slice(0, 5));
        const e = s + bookingCalendarDisplaySpanMinutes(b, serviceMapForBooking(b));
        return s < endMin && e > startMin;
      }).length;
    },
    [bookings, resourceParentById, serviceMapForBooking],
  );


  const beginAppointmentResize = useCallback(
    (booking: Booking) => {
      const eligible =
        ['Pending', 'Booked', 'Confirmed', 'Seated'].includes(booking.status) && !booking.resource_id;

      /** The actual height-drag, run only after the press-and-hold gate arms (see {@link withResizeHold}). */
      const startDrag = (startY: number, target: HTMLElement, pointerId: number) => {
        // A service of a visit resizes on its own (Docs/visit-services-independent-plan.md).
        const startM = timeToMinutes(booking.booking_time.slice(0, 5));
        const dur0 = bookingDurationMinutes(booking, serviceMapForBooking(booking));
        const endM0 = startM + dur0;
        // The grid draws in 15 minute slots but a booking is not obliged to be one.
        // The engine has allowed 5 minutes since services were allowed to be that
        // short; flooring the drag at a slot was the only thing making a 10 minute
        // appointment unresizable on the calendar. A visit floors at every one of
        // its services on that minimum, with its configured gaps still in place.
        const minEnd = startM + MIN_APPOINTMENT_CORE_DURATION_MINUTES;
        // The grid was stretched to midnight while the hold armed (see
        // armGridExtension), so the bar may grow that far; the portion past the
        // day's own close, or over a closed stripe, counts as outside hours.
        const gridEndMax = 24 * 60;

        setResizeVisual({ bookingId: booking.id, deltaYPx: 0 });
        setResizePreviewEnd({ bookingId: booking.id, endHm: minutesToTime(endM0) });

        /** Max / min pointer delta (px) so implied end stays in [minEnd, gridEndMax]. */
        const deltaYMin = ((minEnd - endM0) / SLOT_MINUTES) * slotHeightPx;
        const deltaYMax = ((gridEndMax - endM0) / SLOT_MINUTES) * slotHeightPx;

        const clampDeltaY = (clientY: number) => {
          const raw = clientY - startY;
          return Math.max(deltaYMin, Math.min(deltaYMax, raw));
        };

        /** Continuous end (minutes); used while dragging for smooth height. */
        const endMinutesFromClientY = (clientY: number) => {
          const dY = clampDeltaY(clientY);
          return endM0 + (dY / slotHeightPx) * SLOT_MINUTES;
        };

        const applyFromClientY = (clientY: number) => {
          const dY = clampDeltaY(clientY);
          const endFloat = endM0 + (dY / slotHeightPx) * SLOT_MINUTES;
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

        // The hold has armed: now this is a deliberate resize, so block native scroll for the
        // duration of the drag (touch-action stays pannable at rest so scrolls that only graze
        // the handle still work). Removed in `finish`.
        const blockTouchScroll = (e: TouchEvent) => e.preventDefault();
        document.addEventListener('touchmove', blockTouchScroll, { passive: false });

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
          document.removeEventListener('touchmove', blockTouchScroll);
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
          clearGridExtensionRef.current();
          if (committedEndMin === endM0) return;
          const resizeColumnId = resolveBookingColumnId(booking, resourceParentById);
          // For the note only: the save is always allowed outside hours (see
          // patchBookingMove), so a booking that already sits before open or
          // after close can be made longer or shorter like any other.
          const extendedOutsideHours =
            committedEndMin > baseEndHour * 60 ||
            (resizeColumnId != null &&
              windowCrossesNonWorkingBlock(
                startM,
                committedEndMin,
                resizeColumnId,
                booking.booking_date,
                displayBlocks,
              ));
          // Growing a booking into a break needs the same override a move into
          // one needs, or the PATCH refuses it (SA-H5).
          const extendedOverBreak =
            resizeColumnId != null &&
            windowCrossesBreakBlock(
              startM,
              committedEndMin,
              resizeColumnId,
              booking.booking_date,
              displayBlocks,
            );
          if (extendedOverBreak) {
            addToast('Extended over a break.', 'info');
          } else if (extendedOutsideHours) {
            addToast('Extended outside opening hours.', 'info');
          }
          // Overlaps stay allowed (deliberate double-booking is legitimate) but
          // are never silent: a visit can grow by an hour in a single drag.
          const clash = collidingBookingCount({
            startMin: startM,
            endMin: committedEndMin,
            columnId: resolveBookingColumnId(booking, resourceParentById),
            dateStr: booking.booking_date,
            excludeIds: new Set([booking.id]),
          });
          if (clash > 0) {
            addToast(
              clash === 1
                ? 'This now overlaps another booking.'
                : `This now overlaps ${clash} other bookings.`,
              'info',
            );
          }
          justResizedBookingIdRef.current = booking.id;
          window.setTimeout(() => {
            if (justResizedBookingIdRef.current === booking.id) justResizedBookingIdRef.current = null;
          }, 220);
          void patchBookingResize(booking, endStr, {
            allowDuringBreaks: extendedOverBreak,
          });
        };

        window.addEventListener('pointermove', onMove, { passive: false });
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', finish);
      };

      return withResizeHold({ kind: 'booking', id: booking.id, eligible, startDrag });
    },
    [
      addToast,
      collidingBookingCount,
      baseEndHour,
      patchBookingResize,
      resourceParentById,
      serviceMapForBooking,
      withResizeHold,
      slotHeightPx,
      displayBlocks,
    ],
  );

  const beginBlockResize = useCallback(
    (block: CalendarBlock) => {
      const eligible = isManualEditableBlock(block);

      /** The actual height-drag, run only after the press-and-hold gate arms (see {@link withResizeHold}). */
      const startDrag = (startY: number, target: HTMLElement, pointerId: number) => {
        const startM = timeToMinutes(block.start_time.slice(0, 5));
        const endM0 = startM + blockDurationMinutes(block);
        // The grid draws in 15 minute slots but a booking is not obliged to be one.
        // The engine has allowed 5 minutes since services were allowed to be that
        // short; flooring the drag at a slot was the only thing making a 10 minute
        // appointment unresizable on the calendar.
        const minEnd = startM + MIN_APPOINTMENT_CORE_DURATION_MINUTES;
        const gridEndMax = endHour * 60;

        setBlockResizeVisual({ blockId: block.id, deltaYPx: 0 });
        setBlockResizePreviewEnd({ blockId: block.id, endHm: minutesToTime(endM0) });

        const deltaYMin = ((minEnd - endM0) / SLOT_MINUTES) * slotHeightPx;
        const deltaYMax = ((gridEndMax - endM0) / SLOT_MINUTES) * slotHeightPx;

        const clampDeltaY = (clientY: number) => {
          const raw = clientY - startY;
          return Math.max(deltaYMin, Math.min(deltaYMax, raw));
        };

        const endMinutesFromClientY = (clientY: number) => {
          const dY = clampDeltaY(clientY);
          return endM0 + (dY / slotHeightPx) * SLOT_MINUTES;
        };

        const applyFromClientY = (clientY: number) => {
          const dY = clampDeltaY(clientY);
          const endFloat = endM0 + (dY / slotHeightPx) * SLOT_MINUTES;
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

        // The hold has armed: block native scroll for the duration of the drag (see the
        // booking resize for rationale). Removed in `finish`.
        const blockTouchScroll = (e: TouchEvent) => e.preventDefault();
        document.addEventListener('touchmove', blockTouchScroll, { passive: false });

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
          document.removeEventListener('touchmove', blockTouchScroll);
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
          clearGridExtensionRef.current();
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
      };

      return withResizeHold({ kind: 'block', id: block.id, eligible, startDrag });
    },
    [endHour, patchBlockResize, withResizeHold, slotHeightPx],
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
    return (offset / SLOT_MINUTES) * slotHeightPx;
  }, [viewMode, date, startHour, TOTAL_SLOTS, calendarClockTick, slotHeightPx]);

  const bookingsMatchingFilters = useMemo(() => {
    return bookings.filter((b) => {
      if (calendarFilterIds !== null) {
        const colId = resolveBookingColumnId(b, resourceParentById);
        if (!colId || !calendarFilterIds.includes(colId)) return false;
      }
      if (workingHoursHiddenColumnIds && workingHoursHiddenColumnIds.size > 0) {
        const colId = resolveBookingColumnId(b, resourceParentById);
        if (colId && workingHoursHiddenColumnIds.has(colId)) return false;
      }
      if (!bookingMatchesCalendarStatusFilter(b, filterStatus)) return false;
      return true;
    });
  }, [bookings, calendarFilterIds, workingHoursHiddenColumnIds, filterStatus, resourceParentById]);

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
    (visibleLinkedColumnIds !== null && linkedColumns.length > 0 ? 1 : 0) +
    (workingHoursOnly ? 1 : 0);
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
        <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg px-1 py-1.5 text-sm text-slate-800">
          <input
            type="checkbox"
            className="mt-0.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            checked={workingHoursOnly}
            onChange={(e) => setWorkingHoursOnly(e.target.checked)}
          />
          <span>
            <span className="font-medium">Only calendars working on the selected day</span>
            <span className="block text-xs text-slate-500">
              In day view, hides columns with no working hours on the date you are viewing.
            </span>
          </span>
        </label>
      </div>

      {linkFeature ? (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Linked venues
          </p>
          {linkedLoadError ? (
            // §19.3 — a load failure is visually distinct from "no linked columns".
            <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5">
              <span className="text-xs text-amber-800">Couldn’t load linked calendars.</span>
              <button
                type="button"
                className="shrink-0 text-xs font-semibold text-amber-900 underline hover:no-underline"
                onClick={() => void loadLinkedData()}
              >
                Retry
              </button>
            </div>
          ) : linkedColumns.length === 0 &&
          visibleLinkedColumnIds !== null &&
          visibleLinkedColumnIds.length === 0 ? (
            <button
              type="button"
              className="text-sm font-medium text-brand-700 hover:text-brand-800"
              onClick={() => setVisibleLinkedColumnIds(null)}
            >
              Show linked calendars
            </button>
          ) : linkedColumns.length === 0 ? (
            linkedLoaded ? (
              <p className="text-xs text-slate-500">No linked venues yet.</p>
            ) : (
              <p className="text-xs text-slate-500">Loading linked calendars…</p>
            )
          ) : (
          <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5 text-sm text-slate-800">
              <input
                type="checkbox"
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={visibleLinkedColumnIds === null}
                onChange={(e) => {
                  if (e.target.checked) {
                    setVisibleLinkedColumnIds(null);
                    void loadLinkedData();
                  } else {
                    setVisibleLinkedColumnIds(linkedColumns.map((c) => c.key));
                  }
                }}
              />
              <span className="font-medium">All linked calendars</span>
            </label>
            <div className="border-t border-slate-100" />
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
                      const allLinked = visibleLinkedColumnIds === null;
                      const checked =
                        allLinked ||
                        (visibleLinkedColumnIds !== null && visibleLinkedColumnIds.includes(c.key));
                      return (
                        <label
                          key={c.key}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5 text-sm ${
                            allLinked ? 'text-slate-400' : 'text-slate-800'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 disabled:opacity-40"
                            checked={checked}
                            disabled={allLinked}
                            onChange={(e) => {
                              if (allLinked) return;
                              setVisibleLinkedColumnIds((cur) => {
                                const next = new Set(cur ?? []);
                                if (e.target.checked) next.add(c.key);
                                else next.delete(c.key);
                                const ordered = linkedColumns
                                  .filter((col) => next.has(col.key))
                                  .map((col) => col.key);
                                if (ordered.length === 0) return [];
                                if (ordered.length === linkedColumns.length) return null;
                                return ordered;
                              });
                              if (e.target.checked) void loadLinkedData();
                            }}
                          />
                          <span className="truncate">
                            {c.practitionerName}
                            {c.practitionerActive ? '' : ' (inactive)'}
                            <span className="text-slate-500"> · linked</span>
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
          )}
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

      <button
        type="button"
        onClick={resetCalendarFilters}
        disabled={calendarFiltersAreDefault(calendarFilters)}
        className="text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline disabled:cursor-default disabled:text-slate-400 disabled:no-underline"
      >
        Reset filters
      </button>
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
            !(b.kind === 'event_ticket' && b.calendar_id) &&
            !(b.kind === 'resource_booking' && b.calendar_id),
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

  const showWeekStripRow = (showEventsColumn || loadVenueResources) && stripHasBlocks;

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

  const scheduleBlockFromResourceBooking = useCallback(
    (b: Booking): ScheduleBlockDTO => {
      const rid = b.resource_id!;
      const resName = resourceNameById.get(rid) ?? 'Resource';
      const endHm = (b.booking_end_time ?? b.estimated_end_time ?? b.booking_time).slice(0, 5);
      return {
        id: `bk-${b.id}`,
        kind: 'resource_booking',
        date: b.booking_date,
        start_time: b.booking_time.slice(0, 5),
        end_time: endHm,
        title: `${resName} · ${b.guest_name}`,
        subtitle: b.party_size > 1 ? `${b.party_size} guests` : null,
        booking_id: b.id,
        resource_id: rid,
        status: b.status,
        accent_colour: '#64748B',
        calendar_id: resourceParentById.get(rid) ?? null,
      };
    },
    [resourceNameById, resourceParentById],
  );

  const openResourceInstanceDetail = useCallback(
    (block: ScheduleBlockDTO, bookingId: string, resourceId: string, anchor?: { x: number; y: number }) => {
      setDetailBookingId(null);
      setDetailBookingAnchor(null);
      setDetailBookingOwnerVenueId(null);
      setDetailBookingLinkedAct(null);
      setClassInstanceSheet(null);
      setClassInstanceAnchor(null);
      setEventInstanceSheet(null);
      setLinkedViewing(null);
      setResourceInstanceSheet({ bookingId, resourceId, block });
      setResourceInstanceAnchor(anchor ?? null);
    },
    [],
  );

  const openBookingDetail = useCallback((id: string, anchor?: { x: number; y: number }) => {
    if (justResizedBookingIdRef.current === id) return;
    setClassInstanceSheet(null);
    setClassInstanceAnchor(null);
    setEventInstanceSheet(null);
    setResourceInstanceSheet(null);
    setResourceInstanceAnchor(null);
    setLinkedViewing(null);
    setDetailBookingOwnerVenueId(null);
    setDetailBookingLinkedAct(null);
    setDetailBookingId(id);
    setDetailBookingAnchor(anchor ?? null);
  }, []);

  const openGridBookingDetail = useCallback(
    (b: Booking, anchor?: { x: number; y: number }) => {
      if (justResizedBookingIdRef.current === b.id) return;
      setClassInstanceSheet(null);
      setClassInstanceAnchor(null);
      setEventInstanceSheet(null);
      setLinkedViewing(null);
      if (b.resource_id) {
        setDetailBookingId(null);
        setDetailBookingAnchor(null);
        setDetailBookingOwnerVenueId(null);
        setDetailBookingLinkedAct(null);
        openResourceInstanceDetail(
          scheduleBlockFromResourceBooking(b),
          b.id,
          b.resource_id,
          anchor,
        );
        return;
      }
      if (b._linkedOwnerVenueId) {
        void fetch('/api/venue/linked-calendar/booking/view', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: b.id }),
        }).catch(() => undefined);
        setDetailBookingOwnerVenueId(b._linkedOwnerVenueId);
        setDetailBookingLinkedAct(linkedGrantActForOwnerVenue(linkedVenues, b._linkedOwnerVenueId));
      } else {
        setDetailBookingOwnerVenueId(null);
        setDetailBookingLinkedAct(null);
      }
      setResourceInstanceSheet(null);
      setResourceInstanceAnchor(null);
      setDetailBookingId(b.id);
      setDetailBookingAnchor(anchor ?? null);
    },
    [linkedVenues, openResourceInstanceDetail, scheduleBlockFromResourceBooking],
  );

  const openClassInstanceDetail = useCallback((b: ScheduleBlockDTO, anchor?: { x: number; y: number }) => {
    if (!b.class_instance_id) return;
    setDetailBookingId(null);
    setDetailBookingAnchor(null);
    setEventInstanceSheet(null);
    setResourceInstanceSheet(null);
    setResourceInstanceAnchor(null);
    setClassInstanceSheet({ instanceId: b.class_instance_id, block: b });
    setClassInstanceAnchor(anchor ?? null);
  }, []);

  const openEventInstanceDetail = useCallback(
    (b: ScheduleBlockDTO, linkedColumn?: Pick<LinkedColumn, 'venueId' | 'venueName' | 'venueTimezone' | 'action'>) => {
      if (!b.experience_event_id) return;
      setDetailBookingId(null);
      setDetailBookingAnchor(null);
      setClassInstanceSheet(null);
      setClassInstanceAnchor(null);
      setResourceInstanceSheet(null);
      setResourceInstanceAnchor(null);

      const venue = linkedColumn ? linkedVenueById.get(linkedColumn.venueId) : null;
      const linked =
        linkedColumn && venue
          ? {
              ownerVenueId: linkedColumn.venueId,
              ownerVenueName: linkedColumn.venueName,
              ownerVenueTimezone: linkedColumn.venueTimezone,
              ownerCurrency: currency,
              linkedAct: linkedColumn.action,
              linkedPii: venue.pii,
            }
          : undefined;

      setEventInstanceSheet({ eventId: b.experience_event_id, block: b, linked });
    },
    [currency, linkedVenueById],
  );

  const eventDetailCanBook = useMemo(() => {
    if (!eventInstanceSheet) return false;
    const linked = eventInstanceSheet.linked;
    if (!linked) return true;
    return linked.linkedAct === 'create_edit_cancel';
  }, [eventInstanceSheet]);

  const openEventBookFromDetail = useCallback(() => {
    const sel = eventInstanceSheet;
    if (!sel?.eventId) return;
    setEventInstanceSheet(null);
    setPrefillPractitionerId(undefined);
    setPrefillTime(undefined);
    setPrefillDate(sel.block.date);
    setEventBookPrefill({
      eventId: sel.eventId,
      date: sel.block.date,
      time: sel.block.start_time.slice(0, 5),
      linkedOwnerVenueId: sel.linked?.ownerVenueId,
      linkedVenueName: sel.linked?.ownerVenueName,
    });
    setStaffBookingModal('new');
  }, [eventInstanceSheet]);

  const clearStaffBookingPrefill = useCallback(() => {
    setPrefillDate(undefined);
    setPrefillPractitionerId(undefined);
    setPrefillTime(undefined);
    setEventBookPrefill(null);
  }, []);

  const openResourceBookingFromStrip = useCallback(
    (b: ScheduleBlockDTO, anchor: { x: number; y: number }) => {
      if (!b.booking_id || !b.resource_id) return;
      openResourceInstanceDetail(b, b.booking_id, b.resource_id, anchor);
    },
    [openResourceInstanceDetail],
  );

  const calendarBookingDetailSnapshot = useMemo((): BookingDetailPanelSnapshot | null => {
    if (!detailBookingId) return null;
    const b =
      bookings.find((x) => x.id === detailBookingId) ??
      linkedNativeBookings.find((x) => x.id === detailBookingId);
    if (b) {
      return bookingDetailPanelSnapshotFromListRow({
        ...b,
        guest_name: b.guest_name,
        inferred_booking_model: inferBookingRowModel(b),
        service_name: (() => {
          const serviceId = serviceIdForBooking(b);
          return serviceId ? serviceMapForBooking(b).get(serviceId)?.name ?? null : null;
        })(),
      });
    }
    if (detailBookingOwnerVenueId) {
      const venue = linkedVenues.find((v) => v.venueId === detailBookingOwnerVenueId);
      const lb = venue?.bookings.find((x) => x.id === detailBookingId);
      if (lb) {
        return {
          bookingDate: lb.bookingDate,
          guestName: lb.guestName ?? 'Guest',
          partySize: 1,
          status: lb.status,
          startTime: lb.bookingTime.slice(0, 5),
          endTime: lb.bookingEndTime?.slice(0, 5) ?? lb.bookingTime.slice(0, 5),
          serviceName: lb.serviceName,
          practitionerId: lb.practitionerId,
          calendarId: lb.practitionerId,
          inferredBookingModel: inferBookingRowModel({
            booking_model: lb.bookingModel,
            experience_event_id: lb.experienceEventId,
            class_instance_id: lb.classInstanceId,
            resource_id: lb.resourceId,
            event_session_id: lb.eventSessionId,
            calendar_id: lb.calendarId ?? lb.practitionerId,
            practitioner_id: lb.practitionerIdRaw ?? lb.practitionerId,
            appointment_service_id: lb.appointmentServiceId,
            service_item_id: lb.serviceItemId,
          }),
        };
      }
    }
    return null;
  }, [detailBookingId, detailBookingOwnerVenueId, bookings, linkedNativeBookings, linkedVenues, serviceMapForBooking]);

  const detailBookingOwnerTimezone = useMemo(() => {
    if (!detailBookingOwnerVenueId || detailBookingOwnerVenueId === venueId) {
      return venueTimezone;
    }
    const linkedVenue = linkedVenues.find((v) => v.venueId === detailBookingOwnerVenueId);
    return linkedVenue?.venueTimezone?.trim() || venueTimezone;
  }, [detailBookingOwnerVenueId, venueId, venueTimezone, linkedVenues]);

  return (
    <div className="flex min-w-[320px] flex-col">
      <div className="flex-shrink-0 space-y-3 pb-3">
        <PractitionerCalendarToolbar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          compactDay={compactDay}
          onToggleCompactDay={() => setCompactDay((v) => !v)}
          onNavigateDay={navigateDay}
          onDateChange={navigateDayDirect}
          date={date}
          todayIso={initialIsoDate}
          weekStart={weekStart}
          monthAnchor={monthAnchor}
          startHour={startHour}
          endHour={endHour}
          onTimeRangeChange={handleTimeRangeChange}
          onAmendHours={() => setHoursQuickEditOpen(true)}
          onRefresh={() => {
            void fetchData({ refreshCatalog: true });
            void requestLinkedCalendarSync();
          }}
          onBookingActionsIntent={() =>
            warmStaffBookingSurface({ venueId, linkedOwnerVenueId: collectiveTargetFor(venueId, null)?.id })
          }
          onNewBooking={() => {
            setEventBookPrefill(null);
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
              }}
              onBookingSubmitted={() => void refetchBookingsList()}
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
      ) : calendarFilteredPractitioners.length === 0 ? (
        <div className="flex min-h-[40vh] items-center justify-center px-4">
          <div className="w-full max-w-md">
            <EmptyState
              title="No calendars yet"
              description="Add team calendars in Calendar availability to see appointments on the grid."
            />
          </div>
        </div>
      ) : workingHoursFilterActive && filteredPractitioners.length === 0 && visibleLinkedColumns.length === 0 ? (
        <div className="flex min-h-[40vh] items-center justify-center px-4">
          <div className="w-full max-w-md">
            <EmptyState
              title="No calendars working on this day"
              description="Every calendar is off on this date. Pick another day, or turn off 'Only calendars working on the selected day' in Filter to see them all."
              action={
                <button
                  type="button"
                  onClick={() => setWorkingHoursOnly(false)}
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-700"
                >
                  Show all calendars
                </button>
              }
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
          venueWideBlocks={venueWideBlocks}
          venueTimezone={venueTimezone}
          todayIso={initialIsoDate}
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
                    const isToday = d === initialIsoDate;
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
                      const dayManualBlocks = displayBlocks.filter(
                        (bl) =>
                          columnIdForBlock(bl) === prac.id &&
                          bl.block_date === d &&
                          bl.block_type !== 'class_session',
                      );
                      return (
                        <td key={d} className="border-l border-slate-200 align-top px-1 py-2">
                          <div className="flex min-h-[80px] flex-col gap-1">
                            {dayManualBlocks.map((bl) => {
                              const breakBlock = isBreakCalendarBlock(bl);
                              const closureBlock = isScheduleClosureBlock(bl);
                              const readOnlyBlock = breakBlock || closureBlock;
                              return (
                              <button
                                key={bl.id}
                                type="button"
                                onClick={() => openEditBlockModal(bl)}
                                disabled={readOnlyBlock}
                                className={`rounded-lg border px-2 py-1 text-left text-xs ${
                                  readOnlyBlock
                                    ? `cursor-default ${calendarBlockShellClass(bl)} text-slate-800`
                                    : 'border-slate-300 bg-slate-200/90 text-slate-800 hover:bg-slate-300/90'
                                }`}
                                title={
                                  breakBlock
                                    ? 'Break (set in Calendar availability)'
                                    : closureBlock
                                      ? calendarBlockHeading(bl, blockColumnName(bl))
                                      : bl.reason?.trim()
                                        ? `${calendarBlockHeading(bl)}: ${bl.reason.trim()}`
                                        : calendarBlockHeading(bl)
                                }
                              >
                                <span className={`font-semibold ${calendarBlockHeadingTextClass(bl)}`}>{calendarBlockHeading(bl, blockColumnName(bl))}</span>
                                <span className="mt-0.5 block text-[10px] tabular-nums text-slate-600">
                                  {bl.start_time.slice(0, 5)} – {bl.end_time.slice(0, 5)}
                                </span>
                              </button>
                              );
                            })}
                            {dayBookings.map((b) => {
                              const displayB = bookingForCalendarDisplay(b);
                              const p = calendarBlockPaletteForBooking(b);
                              const resName = b.resource_id ? resourceNameById.get(b.resource_id) : null;
                              const sid = serviceIdForBooking(b);
                              const svc = sid ? serviceMapForBooking(b).get(sid) : null;
                              const serviceLine = calendarBookingServiceLabel(b, svc, resName ?? null);
                              return (
                                <button
                                  key={b.id}
                                  type="button"
                                  onClick={(e) => openGridBookingDetail(b, { x: e.clientX, y: e.clientY })}
                                  {...bindDetailPrefetchHandlers(b.id, prefetchBookingDetail)}
                                  className="flex w-full rounded-xl px-0 py-0 text-left text-xs shadow-sm ring-1 ring-white/70 transition-shadow hover:shadow-lg hover:shadow-slate-900/10 focus-visible:outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-300"
                                  style={bookingCalendarBlockCardStyle(p)}
                                >
                                  <CalendarBookingStatusStripe palette={p} />
                                  <div className="flex min-w-0 flex-1 flex-col gap-1 px-2.5 py-2">
                                    <div className="min-w-0">
                                      <div className="truncate font-bold">{b.guest_name}</div>
                                      {serviceLine ? (
                                        <div className="truncate text-[10px] font-medium opacity-80">
                                          {serviceLine}
                                        </div>
                                      ) : null}
                                      <div className="mt-0.5 text-[10px] font-medium opacity-80">
                                        {b.booking_time.slice(0, 5)}
                                      </div>
                                    </div>
                                    <CalendarBookingStatusBadge b={displayB} palette={p} />
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
                {visibleLinkedColumns.map((col) => {
                  const linkedHoursLine = formatWorkingHoursLineForDate(
                    col.workingHours,
                    date,
                    col.venueTimezone,
                  );
                  return (
                  <tr key={col.key} className="border-b border-slate-100 transition-colors hover:bg-slate-50/70">
                    <td className="sticky left-0 bg-white/95 px-3 py-2 shadow-[4px_0_14px_rgba(15,23,42,0.035)]">
                      <span className="font-semibold text-slate-900" title={`${col.practitionerName} · ${col.venueName}`}>
                        {col.practitionerName}
                      </span>
                      <span
                        className="mt-0.5 block text-[11px] font-medium leading-tight text-sky-800"
                        title={`Linked calendar · ${col.venueName}`}
                      >
                        Linked · {col.venueName}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-tight text-slate-600" title={linkedHoursLine}>
                        {linkedHoursLine}
                      </span>
                      {col.action === 'create_edit_cancel' && staffCollectiveResolved && !collectiveTargetFor(col.venueId, col.practitionerId) ? (
                        <button
                          type="button"
                          onClick={() => {
                            const v = linkedVenueById.get(col.venueId);
                            if (v)
                              setLinkedCreating({
                                venue: v,
                                practitionerId: col.practitionerId,
                                intent: 'new',
                              });
                          }}
                          className={`mt-1.5 ${linkedNewBookingButtonClass}`}
                        >
                          New booking
                        </button>
                      ) : null}
                    </td>
                    {weekDays.map((d) => {
                      const dayBookings = linkedBookingsFor(col, d);
                      const { classBlocks: dayClassBlocks, eventBlocks: dayEventBlocks } =
                        linkedScheduleForColumn(col, d);
                      return (
                        <td key={d} className="border-l border-slate-200 align-top px-1 py-2">
                          <div className="flex min-h-[80px] flex-col gap-1">
                            {dayEventBlocks.map((eb) => {
                              const accent = eb.accent_colour ?? '#F59E0B';
                              const uptake = formatEventUptakeLine(eb);
                              return (
                                <button
                                  key={eb.id}
                                  type="button"
                                  onClick={() => openEventInstanceDetail(eb, col)}
                                  className="rounded-lg border border-slate-200 bg-gradient-to-br from-white to-amber-50/80 px-2 py-1 text-left text-xs shadow-sm ring-1 ring-white/70 transition-shadow hover:shadow-md"
                                  style={{ borderLeftWidth: 3, borderLeftColor: accent }}
                                >
                                  <div className="font-semibold text-slate-900">{eb.title}</div>
                                  {uptake ? <div className="text-[10px] text-slate-600">{uptake}</div> : null}
                                  <div className="text-[10px] text-slate-500">
                                    {eb.start_time.slice(0, 5)}–{eb.end_time.slice(0, 5)}
                                  </div>
                                </button>
                              );
                            })}
                            {dayClassBlocks.map((cb) => {
                              const accent = cb.accent_colour ?? '#6366f1';
                              const booked =
                                cb.class_booked_spots != null && cb.class_capacity != null
                                  ? `${cb.class_booked_spots}/${cb.class_capacity} booked`
                                  : cb.class_booked_spots != null
                                    ? `${cb.class_booked_spots} booked`
                                    : null;
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
                            {dayBookings.map((b) => {
                              const clickable = linkedBookingIsClickable(col, b);
                              return (
                                <button
                                  key={b.id}
                                  type="button"
                                  onClick={(e) =>
                                    openLinkedBooking(col, b, { x: e.clientX, y: e.clientY })
                                  }
                                  className="block w-full rounded-xl px-2.5 py-2 text-left text-xs shadow-sm ring-1 ring-white/70 transition-shadow hover:shadow-lg hover:shadow-slate-900/10 focus-visible:outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-300"
                                  style={bookingCalendarBlockCardStyle(
                                    bookingCalendarBlockPaletteWithOverlay(
                                      linkedBookingStatusBooking(b, bookingRowOverlayForId(b.id)),
                                      bookingRowOverlayForId(b.id),
                                    ),
                                  )}
                                  title={
                                    clickable
                                      ? linkedBookingUsesExpandedDetail(col)
                                        ? b.editable
                                          ? `Edit in ${col.venueName}`
                                          : `View booking · ${col.venueName}`
                                        : `View booking · ${col.venueName}`
                                      : `View detail · ${col.venueName}`
                                  }
                                >
                                  <LinkedBookingCalendarBar
                                    booking={b}
                                    visibility={col.visibility}
                                    venueName={col.venueName}
                                    variant="week-grid"
                                    rowOverlay={bookingRowOverlayForId(b.id)}
                                  />
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                  );
                })}
                {showWeekStripRow ? (
                  <WeekScheduleCdeStrip
                    weekDays={weekDays}
                    blocksByDate={stripScheduleBlocksByDate}
                    onBookingClick={openBookingDetail}
                    onClassInstanceClick={openClassInstanceDetail}
                    onEventInstanceClick={openEventInstanceDetail}
                    onResourceBookingClick={openResourceBookingFromStrip}
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
                  style={{ top: dayHeaderHeightPx + dayViewNowLineTop }}
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
                  // Exactly the header row's height, so the slot canvas below
                  // starts at the same y as the grid's and every label sits on
                  // its own gridline.
                  className="rounded-tl-xl border-b border-slate-300 bg-gradient-to-br from-white via-slate-50 to-slate-100/80"
                  style={{ height: dayHeaderHeightPx }}
                  aria-hidden
                />
                <div ref={slotCanvasRef} className="relative" style={{ height: TOTAL_SLOTS * slotHeightPx }}>
                  {timeLabels.map((t, i) => {
                    const isHour = i % 4 === 0;
                    const isHalfHour = i % 4 === 2;
                    if (!isHour && !isHalfHour) return null;
                    return (
                      <div
                        key={`time-label-${i}`}
                        className="absolute left-0 flex w-full justify-end pr-1.5"
                        style={{ top: i * slotHeightPx, transform: 'translateY(-50%)' }}
                      >
                        <span
                          className={
                            isHour
                              ? 'rounded-full border border-slate-200/80 bg-white/90 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-slate-600 shadow-sm shadow-slate-900/5'
                              : 'rounded-full bg-white/70 px-1 py-0.5 text-[9px] font-medium tabular-nums text-slate-400'
                          }
                        >
                          {t}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div
                  ref={dayHeaderRowRef}
                  className="sticky top-0 z-20 flex w-full divide-x divide-slate-300 rounded-tr-xl border-b border-slate-300 border-l border-slate-300 bg-gradient-to-br from-white via-slate-50 to-slate-100/90 shadow-sm shadow-slate-900/5"
                  role="row"
                  aria-label="Calendar columns"
                >
                  {dayGridColumns.map((col) => {
                    if (col.kind === 'native') {
                      // Resolved hours (per-date override, day off, schedule period, weekly),
                      // the same function the grid's closure stripes use, so on an amended
                      // day the header and the grid beside it read the same hours.
                      const hoursLine = formatResolvedHoursLineForDate(
                        calendarHours(col.practitioner, date),
                        // Native columns only. Linked columns belong to another venue with
                        // its own opening hours; constraining them by this venue's would be
                        // wrong, so they keep the unconstrained line.
                        venueRangesForHeader,
                      );
                      return (
                        <div
                          key={`hdr-${col.practitioner.id}`}
                          className="flex min-h-[58px] min-w-[min(16rem,calc(100vw-5.5rem))] flex-1 flex-col items-center justify-center gap-0.5 px-3 py-1.5 sm:min-w-[240px]"
                        >
                          <span
                            className="truncate text-center text-sm font-semibold text-slate-900"
                            title={col.practitioner.name}
                          >
                            {col.practitioner.name}
                          </span>
                          <span
                            className="line-clamp-2 w-full text-center text-[11px] leading-tight text-slate-600"
                            title={hoursLine}
                          >
                            {hoursLine}
                          </span>
                        </div>
                      );
                    }
                    const linkedCol = col.column;
                    const linkedHoursLine = formatWorkingHoursLineForDate(
                      linkedCol.workingHours,
                      date,
                      linkedCol.venueTimezone,
                    );
                    return (
                      <div
                        key={`hdr-${linkedCol.key}`}
                        className="flex min-h-[70px] min-w-[min(16rem,calc(100vw-5.5rem))] flex-1 flex-col items-center justify-center gap-0.5 px-3 py-1.5 sm:min-w-[240px]"
                      >
                        <span
                          className="truncate text-center text-sm font-semibold text-slate-900"
                          title={`${linkedCol.practitionerName} · ${linkedCol.venueName}`}
                        >
                          {linkedCol.practitionerName}
                        </span>
                        <span
                          className="line-clamp-1 w-full text-center text-[11px] font-medium leading-tight text-sky-800"
                          title={`Linked calendar · ${linkedCol.venueName}`}
                        >
                          Linked · {linkedCol.venueName}
                        </span>
                        <span
                          className="line-clamp-2 w-full text-center text-[11px] leading-tight text-slate-600"
                          title={linkedHoursLine}
                        >
                          {linkedHoursLine}
                        </span>
                        {linkedCol.action === 'create_edit_cancel' &&
                        staffCollectiveResolved && !collectiveTargetFor(linkedCol.venueId, linkedCol.practitionerId) ? (
                          <button
                            type="button"
                            onClick={() => {
                              const v = linkedVenueById.get(linkedCol.venueId);
                              if (v)
                                setLinkedCreating({
                                  venue: v,
                                  practitionerId: linkedCol.practitionerId,
                                  intent: 'new',
                                });
                            }}
                            className={`mt-1 self-center ${linkedNewBookingButtonClass}`}
                          >
                            New booking
                          </button>
                        ) : null}
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
                      <span className="text-center text-[11px] leading-tight text-slate-500">-</span>
                    </div>
                  ) : null}
                  {readOnlyLinkedColumns.map((col) => {
                    const linkedHoursLine = formatWorkingHoursLineForDate(
                      col.workingHours,
                      date,
                      col.venueTimezone,
                    );
                    return (
                    <div
                      key={`hdr-${col.key}`}
                      className="flex min-h-[70px] min-w-[min(16rem,calc(100vw-5.5rem))] flex-1 flex-col items-center justify-center gap-0.5 px-3 py-1.5 sm:min-w-[240px]"
                    >
                      <span
                        className="truncate text-center text-sm font-semibold text-slate-900"
                        title={`${col.practitionerName} · ${col.venueName}`}
                      >
                        {col.practitionerName}
                      </span>
                      <span
                        className="line-clamp-1 w-full text-center text-[11px] font-medium leading-tight text-sky-800"
                        title={`Linked calendar · ${col.venueName}`}
                      >
                        Linked · {col.venueName}
                      </span>
                      <span
                        className="line-clamp-2 w-full text-center text-[11px] leading-tight text-slate-600"
                        title={linkedHoursLine}
                      >
                        {linkedHoursLine}
                      </span>
                      {col.action === 'create_edit_cancel' && staffCollectiveResolved && !collectiveTargetFor(col.venueId, col.practitionerId) ? (
                        <button
                          type="button"
                          onClick={() => {
                            const v = linkedVenueById.get(col.venueId);
                            if (v)
                              setLinkedCreating({
                                venue: v,
                                practitionerId: col.practitionerId,
                                intent: 'new',
                              });
                          }}
                          className={`mt-1 self-center ${linkedNewBookingButtonClass}`}
                        >
                          New booking
                        </button>
                      ) : null}
                    </div>
                    );
                  })}
                </div>
                <div className="flex w-full min-w-0 border-l border-slate-300">
              {dayGridColumns.map((col) => {
                const pracId = dayGridColumnId(col);
                const isLinkedCol = col.kind === 'linked';
                const linkedCol = isLinkedCol ? col.column : null;
                const linkedSchedule =
                  linkedCol != null ? linkedScheduleForColumn(linkedCol, date) : null;
                const pracBookings = bookingsForPractitioner(pracId, date).map(bookingForCalendarDisplay);
                const pracClassBlocks = isLinkedCol
                  ? (linkedSchedule?.classBlocks ?? [])
                  : classBlocksForGrid.filter(
                      (b) => b.calendar_id === pracId && b.date === date,
                    );
                const pracEventBlocks = isLinkedCol
                  ? (linkedSchedule?.eventBlocks ?? [])
                  : eventBlocksForGrid.filter(
                      (b) => b.calendar_id === pracId && b.date === date,
                    );
                const pracBlocks = isLinkedCol
                  ? // §8.2 — a linked column reflects the LINKED venue's own opening
                    // hours: shade the hours it is closed (e.g. if it opens later than
                    // this venue) from its working-hours template in its own timezone.
                    (linkedCol
                      ? (buildLinkedColumnClosureBlocks({
                          columnId: pracId,
                          workingHours: linkedCol.workingHours,
                          dateYmd: date,
                          timeZone: linkedCol.venueTimezone || venueTimezone,
                          gridStartHour: startHour,
                          gridEndHour: endHour,
                        }) as unknown as CalendarBlock[])
                      : [])
                  : displayBlocks.filter(
                      (bl) =>
                        columnIdForBlock(bl) === pracId &&
                        bl.block_date === date &&
                        bl.block_type !== 'class_session',
                    );
                return (
                  <div key={pracId} className="min-w-[min(16rem,calc(100vw-5.5rem))] flex-1 border-r border-slate-300 last:border-r-0 sm:min-w-[240px]">
                    <div className="relative" style={{ height: TOTAL_SLOTS * slotHeightPx }}>
                      {timeLabels.map((_, i) => {
                        const slotStartMins = startHour * 60 + i * SLOT_MINUTES;
                        return (
                          <div
                            key={i}
                            className={`absolute left-0 w-full border-t ${calendarGridLineClass(slotStartMins)}`}
                            style={{ top: i * slotHeightPx }}
                          />
                        );
                      })}

                      {Array.from({ length: TOTAL_SLOTS }, (_, i) => {
                        const slotStartMins = startHour * 60 + i * SLOT_MINUTES;
                        const occ = slotOccupied(
                          slotStartMins,
                          allGridBookings,
                          displayBlocks,
                          pracId,
                          date,
                          serviceMapForBooking,
                          pracClassBlocks,
                          pracEventBlocks,
                          resourceParentById,
                          dragExcludeBookingId,
                          dragExcludeBlockId,
                          { ignoreBookings: dragBooking != null },
                        );
                        const dropId = `drop-${pracId}-${date}-${slotStartMins}`;
                        return (
                          <DroppableSlotButton
                            key={dropId}
                            id={dropId}
                            pracId={pracId}
                            dateStr={date}
                            slotStartMins={slotStartMins}
                            top={i * slotHeightPx}
                            slotHeightPx={slotHeightPx}
                            disabled={occ}
                            onEmptyClick={openSlotMenuForEmptyClick}
                          />
                        );
                      })}

                      {calendarDragTarget && calendarDragTarget.pracId === pracId ? (
                        <div
                          className={`pointer-events-none absolute left-0 right-0 z-[8] rounded-lg border-x-2 border-b-2 border-t-2 ${
                            calendarDragTarget.invalid
                              ? 'border-red-500 bg-red-200/35 ring-1 ring-inset ring-red-400/50'
                              : calendarDragTarget.outsideHours
                                ? 'border-amber-500 bg-amber-200/35 ring-1 ring-inset ring-amber-400/50'
                                : 'border-emerald-500 bg-emerald-200/35 ring-1 ring-inset ring-emerald-400/50'
                          }`}
                          style={{
                            top: ((calendarDragTarget.startMin - startHour * 60) / SLOT_MINUTES) * slotHeightPx,
                            height:
                              ((calendarDragTarget.endMin - calendarDragTarget.startMin) / SLOT_MINUTES) *
                              slotHeightPx,
                          }}
                          aria-hidden
                        />
                      ) : null}

                      {(col.kind === 'linked'
                        ? linkedResourceAvailabilityByColumnKey.get(pracId)
                        : resourceAvailabilityByPractitioner.get(pracId)
                      )?.map((m, i) => (
                        <ResourceAvailabilityMintBlock
                          key={`mint-${pracId}-${i}-${m.resourceName}`}
                          slot={m}
                        />
                      ))}

                      {pracBlocks.map((bl) => {
                        const top = slotTop(bl.start_time);
                        const baseH = Math.max(
                          (minutesBetweenStartAndEnd(bl.start_time, bl.end_time) / SLOT_MINUTES) * slotHeightPx,
                          slotHeightPx * 0.5,
                        );
                        const breakBlock = isBreakCalendarBlock(bl);
                        const closureBlock = isScheduleClosureBlock(bl);
                        const readOnlyBlock = breakBlock || closureBlock;
                        const canDrag = isManualEditableBlock(bl);
                        const blockAccent = calendarBlockAccentColor(bl);
                        const blockShellClass = calendarBlockShellClass(bl);
                        const resizeExtra =
                          blockResizeVisual?.blockId === bl.id ? blockResizeVisual.deltaYPx : 0;
                        const resizeArmingThis =
                          resizeArming?.kind === 'block' && resizeArming.id === bl.id;
                        const moveArmingThis = moveArming?.kind === 'block' && moveArming.id === bl.id;
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
                            slotHeightPx={slotHeightPx}
                            heightExtraPx={resizeExtra}
                            canDrag={canDrag}
                            clickThrough={!isOccupyingBlock(bl.block_type)}
                          >
                            {(handle) => (
                              <div
                                className={`group relative flex h-full min-h-0 flex-row overflow-hidden rounded-lg border text-left shadow-sm ${blockShellClass}`}
                                style={{ borderLeftWidth: 3, borderLeftColor: blockAccent }}
                              >
                                {canDrag && handle.listeners && handle.attributes ? (
                                  <button
                                    ref={handle.setActivatorNodeRef}
                                    type="button"
                                    data-no-calendar-pan="true"
                                    className={`relative z-[2] shrink-0 cursor-grab [touch-action:pan-x_pan-y] px-0.5 text-[10px] text-slate-500 transition active:cursor-grabbing ${
                                      moveArmingThis ? 'bg-black/[0.14]' : 'bg-black/[0.06] hover:bg-black/[0.1]'
                                    }`}
                                    style={{
                                      width: BOOKING_DRAG_HANDLE_WIDTH_DEFAULT_PX,
                                      minWidth: BOOKING_DRAG_HANDLE_WIDTH_DEFAULT_PX,
                                    }}
                                    aria-label="Press and hold, then drag to move block"
                                    {...handle.listeners}
                                    {...handle.attributes}
                                    onPointerDown={(e) => {
                                      handle.listeners?.onPointerDown?.(e);
                                      beginMoveHoldHint('block', bl.id)(e);
                                    }}
                                  >
                                    ⋮⋮
                                  </button>
                                ) : null}
                                {moveArmingThis ? <ResizeHoldHint label="Hold to move" placement="center" /> : null}
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (justResizedBlockIdRef.current === bl.id) return;
                                    openEditBlockModal(bl);
                                  }}
                                  disabled={readOnlyBlock}
                                  className={`flex min-h-0 min-w-0 flex-1 flex-col justify-start overflow-hidden px-2.5 py-2 text-left ${
                                    canDrag && resizeAffordanceOn ? 'pb-[19px]' : ''
                                  } ${readOnlyBlock ? 'cursor-default' : ''}`}
                                  title={
                                    breakBlock
                                      ? 'Break (set in Calendar availability)'
                                      : closureBlock
                                        ? calendarBlockHeading(bl, blockColumnName(bl))
                                        : 'Click to edit block'
                                  }
                                >
                                  <span
                                    className={`truncate text-[13px] font-extrabold tracking-tight ${calendarBlockHeadingTextClass(bl)}`}
                                  >
                                    {calendarBlockHeading(bl, blockColumnName(bl))}
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
                                    {resizeArmingThis ? <ResizeHoldHint label="Hold to adjust" /> : null}
                                    {/* See booking handle: pannable touch-action + ~1s hold gate. */}
                                    <span
                                      role="separator"
                                      aria-orientation="horizontal"
                                      aria-label="Press and hold, then drag to change block duration"
                                      data-no-calendar-pan="true"
                                      className={`${resizeAffordanceOn ? '' : 'hidden'} group/resize absolute bottom-0 left-0 z-40 flex cursor-ns-resize [touch-action:pan-x_pan-y] items-center justify-center rounded-b-lg transition-colors duration-150 ${
                                        resizeArmingThis
                                          ? 'bg-black/[0.12]'
                                          : 'bg-black/0 hover:bg-black/[0.06] active:bg-black/[0.12]'
                                      }`}
                                      style={{ height: BOOKING_RESIZE_HANDLE_HEIGHT_PX, right: 0 }}
                                      onPointerDown={beginBlockResize(bl)}
                                      onMouseDown={(e) => e.stopPropagation()}
                                    >
                                      <span
                                        className={`h-[3px] w-7 rounded-full bg-current transition-opacity duration-150 ${
                                          resizeArmingThis
                                            ? 'opacity-70'
                                            : 'opacity-0 group-hover:opacity-25 group-hover/resize:opacity-50'
                                        }`}
                                        aria-hidden
                                      />
                                    </span>
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
                                onClick={() => openEventInstanceDetail(eb, isLinkedCol ? linkedCol ?? undefined : undefined)}
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
                        const resizeTailBookingId = resizeVisual?.bookingId ?? null;
                        const durationForLayout = (booking: Booking) => {
                          const baseDuration = getBookingDuration(booking);
                          if (!resizeVisual || booking.id !== resizeTailBookingId) return baseDuration;
                          const resizeDeltaMins = (resizeVisual.deltaYPx / slotHeightPx) * SLOT_MINUTES;
                          return Math.max(MIN_APPOINTMENT_CORE_DURATION_MINUTES, baseDuration + resizeDeltaMins);
                        };
                        const clusterLayouts = computeBookingClusterLayouts(
                          bookingClusters,
                          durationForLayout,
                          (b) => bookingProcessingWallGaps(b, serviceMapForBooking(b)),
                        );
                        const bars = bookingClusters.map((cluster) => {
                          const layout = clusterLayouts.get(clusterKey(cluster)) ?? { laneIndex: 0, laneCount: 1 };
                        {
                          const b = cluster.booking;
                          // Each service of a visit is coloured by ITS OWN status: a started
                          // colour is green while the cut that has not begun stays booked.
                          // The bars used to share the earliest service's colour, which read
                          // as every service starting or finishing together. The chip and the
                          // spine still say the bars belong to one visit.
                          const visitPos = visitPositions.get(b.id) ?? null;
                          const palette = calendarBlockPaletteForBooking(b);
                          // A short spine where this service meets a sibling in the same column.
                          const visitEdges = visitPos
                            ? visitTouchingEdges({
                                row: b,
                                rows: allGridBookings,
                                columnIdOf: (r) => resolveBookingColumnId(r as Booking, resourceParentById),
                                spanMinutesOf: (r) => getBookingDuration(r as Booking),
                                toMinutes: timeToMinutes,
                              })
                            : null;
                          const duration = getBookingDuration(b);
                          const sid = serviceIdForBooking(b);
                          const svc = sid ? serviceMapForBooking(b).get(sid) : null;
                          const top = slotTop(b.booking_time);
                          const height = slotHeightFromDuration(duration);
                          const canDrag =
                            !b.resource_id && ['Pending', 'Booked', 'Confirmed', 'Seated'].includes(b.status);
                          const flash = flashIds.has(b.id);
                          const qBusy = quickActionId === b.id;
                          const resName = b.resource_id ? resourceNameById.get(b.resource_id) : null;
                          const resizeExtra =
                            resizeVisual?.bookingId === b.id ? resizeVisual.deltaYPx : 0;
                          const resizeArmingThis =
                            resizeArming?.kind === 'booking' && resizeArming.id === b.id;
                          const moveArmingThis = moveArming?.kind === 'booking' && moveArming.id === b.id;
                          const displayEndHm =
                            resizePreviewEnd?.bookingId === b.id
                              ? resizePreviewEnd.endHm
                              : minutesToTime(timeToMinutes(b.booking_time) + duration);
                          /**
                           * Processing that runs to the booking's end (or past it) is
                           * free time, so the card stops where the practitioner's last
                           * busy stretch ends and the foot of the shell stays unpainted:
                           * it reads as the empty grid it effectively is, and a click
                           * there books someone else in. Processing in the middle stays
                           * inside the card as a pale band. The shell keeps the full
                           * length, so drag and drop still see the whole booking.
                           */
                          const freeRegions = bookingFreeRegions(b, serviceMapForBooking(b));
                          const trailingFreeMins = Math.max(0, freeRegions.core - freeRegions.activeEnd);
                          const trailingFreePx = Math.max(
                            0,
                            Math.min(height + resizeExtra, (trailingFreeMins / SLOT_MINUTES) * slotHeightPx),
                          );
                          const blockH = height + resizeExtra - trailingFreePx;
                          const cardPaintMinutes = Math.max(1, duration - trailingFreeMins);
                          const openFreeSlot = (wallMinute: number, e: MouseEvent) =>
                            openSlotMenuForEmptyClick(e, pracId, date, minutesToTime(wallMinute));
                          const showInlineScheduleFollowUp = dragMoveConfirmBookingId === b.id;
                          const isOverlapLane = layout.laneCount > 1;
                          const reservePx =
                            canDrag && resizeAffordanceOn ? BOOKING_RESERVE_ABOVE_RESIZE_PX : 0;
                          /**
                           * The action tray's own footprint. The button below reserves this as
                           * `paddingBottom`, so it is not the card's to spend either. Computed
                           * here rather than inside the render prop so the height budget can
                           * account for it (the same value is reused down there).
                           */
                          /**
                           * Bars nested in this one (booked into its processing gap) cover
                           * everything under them but the left inset, so the text keeps to
                           * the span above the first of them and the tray sits below the
                           * lowest, or moves up beside the text when a nested bar runs to the
                           * bottom edge. A bar with nothing nested keeps the whole box.
                           */
                          const hostRegions = hostRegionsPx(
                            layout,
                            timeToMinutes(b.booking_time),
                            blockH,
                            slotHeightPx,
                            freeRegions.middle,
                          );
                          const trayBottomOffsetPx = blockH - hostRegions.trayBottomPx;
                          const traySpanPx = hostRegions.trayBottomPx - hostRegions.trayTopPx;
                          const actionBlockHeight = Math.max(
                            0,
                            traySpanPx - (trayBottomOffsetPx > 0 ? 0 : reservePx),
                          );
                          const textSpanPx = hostRegions.textBottomPx - hostRegions.textTopPx;
                          /**
                           * Where the actions go, decided PER BAR rather than per view mode.
                           *
                           * The corner tray stacks its buttons vertically and reserves that whole
                           * stack out of the bar, which only makes sense when the bar can spare it.
                           * It was gated on the global compact toggle alone, so in the default view
                           * a 30 minute booking still got the full stack: 84px of a 94px bar, which
                           * left 2px for text and rendered nothing but a shrunken guest name.
                           *
                           * Below the threshold the actions sit inline beside the text instead,
                           * costing no height at all, so a short bar spends its pixels on the
                           * booking rather than on chrome.
                           */
                          /**
                           * One action renderer for every bar. Compact used to swap in a
                           * horizontal row that sat vertically CENTRED against the right
                           * edge, so the buttons were neither stacked nor in the corner,
                           * and their widths came from their labels. The corner tray now
                           * costs no height (it clears the text via `right` alone) and
                           * shrinks its buttons to fit, so it serves short bars too.
                           */
                          // Width-agnostic: whether the bar carries any actions at all. The
                          // gutter itself is decided inside the measured row below, because
                          // in a narrow lane the tray drops under the text rather than
                          // beside it, and that needs the row's width.
                          const barHasActions =
                            planBookingCornerActions(bookingCornerActionInput(b), actionBlockHeight)
                              .actionCount > 0;
                          return (
                            <DraggableBookingShell
                              key={`${b.id}-${b.status}-${b.client_arrived_at ?? ''}`}
                              booking={b}
                              top={top}
                              height={height}
                              slotHeightPx={slotHeightPx}
                              heightExtraPx={resizeExtra}
                              layout={layout}
                              canDrag={canDrag}
                              raised={showInlineScheduleFollowUp}
                              visitGroupId={visitPos?.groupId ?? null}
                              spineTop={visitEdges?.top ? palette.accent : null}
                              spineBottom={visitEdges?.bottom ? palette.accent : null}
                            >
                              {(handle) => (
                                <>
                                <div
                                  className={`group relative flex h-full min-h-0 flex-row items-stretch overflow-hidden rounded-2xl ${
                                    flash ? 'motion-safe:animate-pulse' : ''
                                  }`}
                                  style={{
                                    color: palette.text,
                                    // Stops short of the shell when processing runs to the end.
                                    ...(trailingFreePx > 0 ? { height: blockH } : {}),
                                  }}
                                >
                                  {/* The paint, one lozenge per busy stretch; the box itself is clear. */}
                                  <BookingBarPieces
                                    pieces={paintedPiecesMinutes(
                                      cardPaintMinutes,
                                      freeRegions.middle.map((m) => ({
                                        start: m.start - freeRegions.wall0,
                                        end: m.end - freeRegions.wall0,
                                      })),
                                    )}
                                    totalMinutes={cardPaintMinutes}
                                    palette={palette}
                                    flash={flash}
                                    guestName={b.guest_name}
                                    labelLeftPx={
                                      4 +
                                      (canDrag && handle.listeners && handle.attributes
                                        ? isOverlapLane
                                          ? BOOKING_DRAG_HANDLE_WIDTH_OVERLAP_PX
                                          : BOOKING_DRAG_HANDLE_WIDTH_DEFAULT_PX
                                        : resName && !isOverlapLane
                                          ? BOOKING_DRAG_HANDLE_WIDTH_DEFAULT_PX
                                          : 0) +
                                      (isOverlapLane ? 6 : 10)
                                    }
                                    totalHeightPx={blockH}
                                  />
                                  <BookingBarEdgeSpacer />
                                  {/* The source venue is shown in the column header ("Linked · {venue}"),
                                      so no per-card venue chip here — it overlapped the action buttons
                                      on short bars. The dashed/hatch treatment still marks it as linked. */}
                                  <ProcessingFreeBands
                                    b={b}
                                    serviceMap={serviceMapForBooking(b)}
                                    wallPaintMinutes={cardPaintMinutes}
                                    onFreeClick={openFreeSlot}
                                  />
                                  {canDrag && handle.listeners && handle.attributes ? (
                                    <button
                                      ref={handle.setActivatorNodeRef}
                                      type="button"
                                      data-no-calendar-pan="true"
                                      className={`group/grip relative z-[2] flex shrink-0 cursor-grab [touch-action:pan-x_pan-y] items-center justify-center transition-colors duration-150 active:cursor-grabbing ${
                                        moveArmingThis ? 'bg-black/[0.12]' : 'bg-black/0 hover:bg-black/[0.06]'
                                      }`}
                                      style={{
                                        width: isOverlapLane
                                          ? BOOKING_DRAG_HANDLE_WIDTH_OVERLAP_PX
                                          : BOOKING_DRAG_HANDLE_WIDTH_DEFAULT_PX,
                                        minWidth: isOverlapLane
                                          ? BOOKING_DRAG_HANDLE_WIDTH_OVERLAP_PX
                                          : BOOKING_DRAG_HANDLE_WIDTH_DEFAULT_PX,
                                      }}
                                      aria-label="Press and hold, then drag to reschedule"
                                      {...handle.listeners}
                                      {...handle.attributes}
                                      onPointerDown={(e) => {
                                        handle.listeners?.onPointerDown?.(e);
                                        beginMoveHoldHint('booking', b.id)(e);
                                      }}
                                    >
                                      {!isOverlapLane && (
                                        <svg
                                          viewBox="0 0 10 18"
                                          className="h-3.5 w-2 opacity-50 transition-opacity duration-150 group-hover:opacity-90 group-hover/grip:opacity-100"
                                          fill="currentColor"
                                          aria-hidden
                                        >
                                          <circle cx="3" cy="4" r="1.1" />
                                          <circle cx="7" cy="4" r="1.1" />
                                          <circle cx="3" cy="9" r="1.1" />
                                          <circle cx="7" cy="9" r="1.1" />
                                          <circle cx="3" cy="14" r="1.1" />
                                          <circle cx="7" cy="14" r="1.1" />
                                        </svg>
                                      )}
                                    </button>
                                  ) : resName && !isOverlapLane ? (
                                    // Resource booking: not drag-reschedulable on the calendar. Render a
                                    // non-interactive "fixed slot" rail (a dot column, no grab cursor) in the
                                    // grip's place so the block reads as deliberately pinned rather than as a
                                    // draggable appointment that simply lost its handle. Slot changes go through
                                    // the detail sheet's engine-validated "Change slot" picker.
                                    <span
                                      aria-hidden
                                      title="Open to change slot"
                                      className="relative z-[1] flex shrink-0 cursor-default items-center justify-center text-slate-400/70"
                                      style={{
                                        width: BOOKING_DRAG_HANDLE_WIDTH_DEFAULT_PX,
                                        minWidth: BOOKING_DRAG_HANDLE_WIDTH_DEFAULT_PX,
                                      }}
                                    >
                                      <svg viewBox="0 0 10 18" className="h-3.5 w-2 opacity-60" fill="currentColor">
                                        <circle cx="5" cy="5" r="1.1" />
                                        <circle cx="5" cy="9" r="1.1" />
                                        <circle cx="5" cy="13" r="1.1" />
                                      </svg>
                                    </span>
                                  ) : null}
                                  {moveArmingThis ? <ResizeHoldHint label="Hold to move" placement="center" /> : null}
                                  <BookingGuestActionsRowMeasured
                                    className="relative z-[1] flex min-h-0 min-w-0 flex-1 flex-col"
                                  >
                                      {(shellRowWidthPx) => {
                                        const cardPad = bookingCardPadding(textSpanPx);
                                        // When the tray has a strip of its own under the nested
                                        // bars, the text needs no clearance from it: the row width
                                        // is withheld so the planner keeps its default (beside)
                                        // and the gutter is then zeroed below.
                                        const planned = computeBookingActionCornerInset(
                                          b,
                                          actionBlockHeight,
                                          hostRegions.traySharesText ? shellRowWidthPx : null,
                                          cardPad.budgetPx,
                                        );
                                        const actionInset = hostRegions.traySharesText
                                          ? planned
                                          : { ...planned, right: 0, bottom: 0 };
                                        // Room left for text once the resize affordance, the action
                                        // tray, nested bars and the button's own padding are taken
                                        // out. Density and the pills-row decision are made from
                                        // this, not the raw bar height.
                                        const barInnerHeightPx = Math.max(
                                          0,
                                          textSpanPx -
                                            BOOKING_CARD_BORDER_PX -
                                            (hostRegions.textBottomPx >= blockH ? reservePx : 0) -
                                            (actionInset.hasActions ? actionInset.bottom : 0) -
                                            cardPad.budgetPx,
                                        );
                                        const cardDensity =
                                          isOverlapLane || barInnerHeightPx < 56 ? 'compact' : 'comfortable';
                                        const showPillsRow =
                                          !isOverlapLane &&
                                          barInnerHeightPx >= (cardDensity === 'compact' ? 72 : 88) &&
                                          bookingHasBlockPills(b);
                                        // The pills row is a sibling of the card inside the same
                                        // box, so its height is not the card's to spend.
                                        const contentHeightPx = Math.max(
                                          0,
                                          barInnerHeightPx - (showPillsRow ? BOOKING_PILLS_ROW_PX : 0),
                                        );
                                        return (
                                          <>
                                            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                                            <button
                                              type="button"
                                              onClick={(e) => openGridBookingDetail(b, { x: e.clientX, y: e.clientY })}
                                              {...bindDetailPrefetchHandlers(b.id, prefetchBookingDetail)}
                                              // Resource bookings render in a practitioner column but are not
                                              // drag-reschedulable here (no grip/resize handle, unlike appointments).
                                              // Their slot is changed via the detail sheet's "Change slot" picker,
                                              // which runs engine validation. Signpost that with a tooltip so a CDE
                                              // block doesn't look like an identical-but-unresponsive appointment.
                                              title={resName ? 'Open to change slot' : undefined}
                                              className={`flex min-h-0 flex-1 flex-col justify-start overflow-hidden ${isOverlapLane ? 'px-1.5' : 'px-2.5'} text-left transition focus-visible:outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-300`}
                                              style={{
                                                paddingTop: cardPad.topPx + hostRegions.textTopPx,
                                                paddingRight: actionInset.hasActions && actionInset.right > 0
                                                  ? actionInset.right
                                                  : undefined,
                                                paddingBottom:
                                                  (blockH - hostRegions.textBottomPx) +
                                                    (actionInset.hasActions ? actionInset.bottom : 0) +
                                                    reservePx || undefined,
                                              }}
                                              aria-label={`Open booking details for ${b.guest_name}`}
                                            >
                                              <BookingCard
                                                name={b.guest_name}
                                                nameAccessory={
                                                  visitPos || complianceFlags[b.id] ? (
                                                    <>
                                                      {visitPos ? <VisitChip label={visitChipLabel(visitPos)} /> : null}
                                                      {complianceFlags[b.id] ? (
                                                        <ComplianceBarIcon flag={complianceFlags[b.id]!} />
                                                      ) : null}
                                                    </>
                                                  ) : undefined
                                                }
                                                service={calendarBookingServiceLabel(b, svc, resName ?? null)}
                                                phone={formatPhoneForDisplay(b.guest_phone)}
                                                start={b.booking_time.slice(0, 5)}
                                                end={displayEndHm}
                                                pill={<CalendarBookingStatusBadge b={b} palette={palette} />}
                                                contentHeightPx={contentHeightPx}
                                                density={cardDensity}
                                                /**
                                                 * Zero on purpose. The button above already carries
                                                 * the tray reserve as `paddingRight`, and this card
                                                 * is its direct child, so the width it measures is
                                                 * ALREADY the content box with that reserve removed.
                                                 * Passing the reserve again charged it twice: the
                                                 * card believed it had 63px of a real 131px and
                                                 * dropped the status chip, the time, and on shorter
                                                 * bars the phone, from any row it had to share.
                                                 * The multi-service branch has always passed 0 here.
                                                 */
                                                actionsReservePx={0}
                                              />
                                              {showPillsRow ? (
                                                <div className="mt-1.5 flex w-full min-w-0 shrink-0 flex-col gap-1 border-t border-white/25 pt-1.5">
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
                                              // The height the gutter was planned from: the bar's
                                              // own, or less when the tray sits below the text
                                              // and had to shrink to leave a row above it.
                                              blockHeightPx={actionInset.trayBlockHeightPx}
                                              bottomOffsetPx={trayBottomOffsetPx}
                                              onStatus={(id, s) => void quickPatchBooking(id, { status: s })}
                                              onArrived={(id, v) => void quickPatchBooking(id, { client_arrived: v })}
                                              narrow={isOverlapLane}
                                              shellRowWidthPx={shellRowWidthPx}
                                              floating={false}
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
                                      {resizeArmingThis ? <ResizeHoldHint label="Hold to adjust" /> : null}
                                      {/* touch-action stays pannable so a scroll that merely grazes this thin
                                          handle still pans the page; a deliberate ~1s hold (withResizeHold) is
                                          required before a height drag changes the duration. */}
                                      <span
                                        role="separator"
                                        aria-orientation="horizontal"
                                        aria-label="Press and hold, then drag to change duration"
                                        data-no-calendar-pan="true"
                                        className={`${resizeAffordanceOn ? '' : 'hidden'} group/resize absolute bottom-0 left-0 z-40 flex cursor-ns-resize [touch-action:pan-x_pan-y] items-center justify-center rounded-b-2xl transition-colors duration-150 ${
                                          resizeArmingThis
                                            ? 'bg-black/[0.12]'
                                            : 'bg-black/0 hover:bg-black/[0.06] active:bg-black/[0.12]'
                                        }`}
                                        style={{ height: BOOKING_RESIZE_HANDLE_HEIGHT_PX, right: barHasActions ? BOOKING_ACTIONS_CORNER_RIGHT_PX : 0 }}
                                        onPointerDown={beginAppointmentResize(b)}
                                        onMouseDown={(e) => e.stopPropagation()}
                                      >
                                        <span
                                          className={`h-[3px] w-7 rounded-full bg-current transition-opacity duration-150 ${
                                            resizeArmingThis
                                              ? 'opacity-70'
                                              : 'opacity-0 group-hover:opacity-25 group-hover/resize:opacity-50'
                                          }`}
                                          aria-hidden
                                        />
                                      </span>
                                    </>
                                  ) : null}
                                </div>
                                {trailingFreePx > 0 ? (
                                  <ProcessingFreeTail
                                    heightPx={trailingFreePx}
                                    startWallMin={freeRegions.wall0 + freeRegions.activeEnd}
                                    endWallMin={freeRegions.wall0 + freeRegions.core}
                                    onFreeClick={openFreeSlot}
                                  />
                                ) : null}
                                </>
                              )}
                            </DraggableBookingShell>
                          );
                        }

                        });
                        /**
                         * Each booking's buffer, under its bar in its own lane. Drawn
                         * after the bars so a visit's inter-service turnover sits in the
                         * gap between two lozenges, below them in the stacking order.
                         */
                        const bufferBands = bookingClusters.flatMap((cluster) => {
                          const layout = clusterLayouts.get(clusterKey(cluster)) ?? SINGLE_LANE_LAYOUT;
                          const horizontal = clusterLayoutHorizontalStyle(layout);
                          const members = [cluster.booking];
                          return members.flatMap((b) => {
                            if (['Cancelled', 'No-Show'].includes(b.status)) return [];
                            const band = bookingBufferBandMinutes(b, serviceMapForBooking(b));
                            if (!band) return [];
                            return [
                              <BookingBufferBand
                                key={`buffer-${b.id}`}
                                topPx={((band.startWallMin - startHour * 60) / SLOT_MINUTES) * slotHeightPx}
                                heightPx={(band.minutes / SLOT_MINUTES) * slotHeightPx}
                                left={horizontal.left}
                                width={horizontal.width}
                              />,
                            ];
                          });
                        });
                        return (
                          <>
                            {bars}
                            {bufferBands}
                          </>
                        );
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
                      slotHeightPx={slotHeightPx}
                      onBookingClick={openBookingDetail}
                      hideHeader
                    />
                  ) : null}
                </>
              ) : null}
              {viewMode === 'day'
                ? readOnlyLinkedColumns.map((col) => {
                    const linkedSchedule = linkedScheduleForColumn(col, date);
                    return (
                    <LinkedDayColumn
                      key={col.key}
                      column={col}
                      bookings={linkedBookingsFor(col, date)}
                      eventBlocks={linkedSchedule.eventBlocks}
                      classBlocks={linkedSchedule.classBlocks}
                      resourceMintSlots={linkedResourceAvailabilityByColumnKey.get(col.key) ?? []}
                      startHour={startHour}
                      totalSlots={TOTAL_SLOTS}
                      slotHeightPx={slotHeightPx}
                      bookingRowOverlayForId={bookingRowOverlayForId}
                      serviceMap={linkedServiceMapsByVenue.get(col.venueId)}
                      onBookingClick={(b, anchor) => openLinkedBooking(col, b, anchor)}
                      onEventBlockClick={(b) => openEventInstanceDetail(b, col)}
                      onClassBlockClick={openClassInstanceDetail}
                      onCreateAt={
                        col.action === 'create_edit_cancel'
                          ? (time, ev) => {
                              const v = linkedVenueById.get(col.venueId);
                              if (v)
                                setSlotMenu({
                                  pracId: col.key,
                                  dateStr: date,
                                  time,
                                  x: Math.max(8, Math.min(ev.clientX - 72, window.innerWidth - 200)),
                                  y: Math.max(8, Math.min(ev.clientY - 8, window.innerHeight - 160)),
                                  linked: { venue: v, practitionerId: col.practitionerId },
                                });
                            }
                          : undefined
                      }
                    />
                    );
                  })
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

      {scheduleFollowUpChange ? (
        <ScheduleEditFollowUpBar
          change={scheduleFollowUpChange}
          countdownSec={modificationNotifyCountdownSec}
          disabled={scheduleUndoPending}
          onNotifyNow={() => void confirmInlineDragMove()}
          onSkip={dismissPendingModificationGuestNotify}
          onUndo={() => void undoLastScheduleEdit()}
        />
      ) : null}

      {slotMenu && (() => {
        const linkedHere = slotMenu.linked;
        const resourcesHere =
          linkedHere ?
            []
          : venueResources.filter((r) => r.display_on_calendar_id === slotMenu.pracId);
        const openLinked = (intent: 'new' | 'walk-in') => {
          if (!linkedHere) return;
          setLinkedCreating({
            venue: linkedHere.venue,
            practitionerId: linkedHere.practitionerId,
            time: slotMenu.time,
            intent,
          });
          setSlotMenu(null);
        };
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
              {linkedHere ? (
                <p className="truncate px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  In {linkedHere.venue.venueName}
                </p>
              ) : null}
              <button
                type="button"
                className="block w-full px-3 py-2.5 text-left text-sm font-medium text-slate-800 hover:bg-slate-50"
                onClick={() =>
                  linkedHere ?
                    openLinked('new')
                  : openNewAtSlot(slotMenu.pracId, slotMenu.dateStr, slotMenu.time)
                }
              >
                New appointment
              </button>
              <button
                type="button"
                className="block w-full px-3 py-2.5 text-left text-sm font-medium text-slate-800 hover:bg-slate-50"
                onClick={() =>
                  linkedHere ?
                    openLinked('walk-in')
                  : openWalkInAtSlot(slotMenu.pracId, slotMenu.dateStr, slotMenu.time)
                }
              >
                Walk-in
              </button>
              {resourcesHere.length > 0 ? (
                <>
                  <div className="mx-3 my-1 border-t border-slate-100" />
                  <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Resources
                  </p>
                  {resourcesHere.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="block w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-emerald-50/80 hover:text-emerald-900"
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
                </>
              ) : null}
              {linkedHere ? null : (
                <>
                  <div className="mx-3 my-1 border-t border-slate-100" />
                  <button
                    type="button"
                    className="block w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                    onClick={() => openBlockModal(slotMenu.pracId, slotMenu.dateStr, slotMenu.time)}
                  >
                    Block time
                  </button>
                </>
              )}
            </div>
          </>
        );
      })()}

      {hoursQuickEditOpen ? (
        <CalendarHoursQuickEdit
          isAdmin={isAdmin}
          currentStaffId={currentStaffId}
          date={activeDayDate}
          bookingModel={bookingModel}
          onClose={() => {
            setHoursQuickEditOpen(false);
            // Hours may have changed: re-read venue hours and the calendar
            // catalogue so the grid range and stripes follow.
            void fetchData({ refreshCatalog: true });
          }}
        />
      ) : null}
      {blockModal ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setBlockModal(null);
          }}
          title={blockModal.blockId ? 'Edit block' : 'Block time'}
          description={blockModal.dateStr}
          size="sm"
          contentClassName="max-w-sm"
          footer={
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              {blockModal.blockId ? (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={blockSaving}
                  onClick={() => void deleteBlockFromModal()}
                >
                  Delete
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => setBlockModal(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={blockSaving}
                  onClick={() => void saveBlock()}
                >
                  {blockSaving ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
          }
        >
          <>
            {(() => {
              const durationMins = timeToMinutes(blockModal.endTime) - timeToMinutes(blockModal.startTime);
              if (durationMins <= 0) {
                return (
                  <p className="mb-3 text-xs font-medium text-amber-800" role="status">
                    Choose an end time after {blockModal.startTime} to set a duration.
                  </p>
                );
              }
              return (
                <p className="mb-3 text-sm text-slate-600" role="status">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Duration </span>
                  <span className="font-semibold tabular-nums text-slate-900">{formatBlockDurationLabel(durationMins)}</span>
                </p>
              );
            })()}
            <div className="space-y-3">
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
          </>
        </Dialog>
      ) : null}

      {/* Steps aside while the notify / skip / undo bar has the bottom of a phone screen. */}
      {scheduleFollowUpChange ? null : (
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
        venueId={venueId}
        currency={currency}
        venueTimezone={venueTimezone}
        canBook={eventDetailCanBook}
        onBookNow={openEventBookFromDetail}
        onUpdated={() => {
          void refetchBookingsList();
          void refetchSchedule();
        }}
      />

      <ResourceInstanceDetailSheet
        selection={resourceInstanceSheet}
        onClose={() => {
          setResourceInstanceSheet(null);
          setResourceInstanceAnchor(null);
        }}
        venueId={venueId}
        currency={currency}
        presentation="popover"
        anchor={resourceInstanceAnchor}
        onUpdated={() => {
          void refetchBookingsList();
          // The week CDE strip reads scheduleBlocks, so a resource slot change
          // (time/duration) leaves it stale unless we also refetch the schedule
          // feed. Mirrors the event sheet's onUpdated above.
          void refetchSchedule();
        }}
      />

      {detailBookingId ? (
        <BookingDetailPanel
          key={detailBookingId}
          bookingId={detailBookingId}
          venueId={detailBookingOwnerVenueId ?? venueId}
          venueCurrency={currency}
          initialSnapshot={calendarBookingDetailSnapshot}
          isAppointment
          presentation="popover"
          anchor={detailBookingAnchor}
          venueTimezone={detailBookingOwnerTimezone}
          linkedAct={
            detailBookingOwnerVenueId && detailBookingOwnerVenueId !== venueId
              ? (detailBookingLinkedAct ??
                linkedGrantActForOwnerVenue(linkedVenues, detailBookingOwnerVenueId))
              : undefined
          }
          onClose={() => {
            if (pendingDeferredModificationNotifyBookingIdRef.current === detailBookingId) {
              dismissPendingModificationGuestNotify();
            }
            setDetailBookingId(null);
            setDetailBookingOwnerVenueId(null);
            setDetailBookingLinkedAct(null);
            setDetailBookingAnchor(null);
          }}
          onStatusChange={async (bookingId, _previous, newStatus) => {
            // One row. A confirm still reaches the visit's other services on the
            // server; Start and Complete are that service's own.
            const ok = await quickPatchBooking(bookingId, { status: newStatus });
            if (!ok) throw new Error('Update failed');
          }}
          onUpdated={() => {
            if (detailBookingId) {
              const anchor =
                allGridBookings.find((x) => x.id === detailBookingId) ?? null;
              const groupIds = anchor?.group_booking_id
                ? allGridBookings
                    .filter((x) => x.group_booking_id === anchor.group_booking_id)
                    .map((x) => x.id)
                : [detailBookingId];
              void fetch(`/api/venue/bookings/${detailBookingId}`)
                .then((r) => (r.ok ? r.json() : null))
                .then((payload) => {
                  if (payload && typeof payload === 'object' && !('error' in payload)) {
                    const overlay = overlayFromPatchPayload(payload as Record<string, unknown>);
                    mergeCalendarBookingOverlay(detailBookingId, overlay);
                    // Siblings take the visit-wide facts only. Start and Complete
                    // are one service's: copying the status here painted every
                    // bar of the visit Started, and the overlay outlived the
                    // refetch because it never matched the row underneath.
                    const siblingOverlay = visitSiblingOverlay(overlay);
                    for (const id of groupIds) {
                      if (id !== detailBookingId) mergeCalendarBookingOverlay(id, siblingOverlay);
                    }
                  }
                })
                .catch(() => undefined);
            }
            void refetchBookingsList();
          }}
        />
      ) : null}

      {staffBookingModal
        ? (() => {
            // An own column inside the collective, or the toolbar's New and Walk-in,
            // book for the collective; an own column outside it books for the venue.
            const collectiveTarget = eventBookPrefill
              ? null
              : collectiveTargetFor(venueId, prefillPractitionerId ?? null);
            const ownerVenueId = eventBookPrefill?.linkedOwnerVenueId ?? collectiveTarget?.id;
            return (
              <CalendarStaffBookingModal
                open
                intent={staffBookingModal}
                onClose={() => {
                  setStaffBookingModal(null);
                  clearStaffBookingPrefill();
                  setCrossVenueRebook(null);
                }}
                onCreated={() => {
                  setStaffBookingModal(null);
                  clearStaffBookingPrefill();
                  void refetchBookingsList();
                  // A collective booking may have landed on a partner's calendar.
                  if (collectiveTarget) void loadLinkedData();
                  if (crossVenueRebook) {
                    setCancelOriginalPrompt(crossVenueRebook);
                    setCrossVenueRebook(null);
                  }
                }}
                staffRebookBootstrap={crossVenueRebook?.bootstrap ?? null}
                onBookingSubmitted={() => {
                  void refetchBookingsList();
                  if (collectiveTarget) void loadLinkedData();
                }}
                venueId={ownerVenueId ?? venueId}
                currency={currency}
                bookingModel={bookingModel}
                enabledModels={enabledModels}
                preselectedDate={prefillDate ?? eventBookPrefill?.date ?? (viewMode === 'day' ? date : undefined)}
                preselectedPractitionerId={prefillPractitionerId}
                preselectedTime={prefillTime}
                preselectedExperienceEventId={eventBookPrefill?.eventId}
                preselectedEventDate={eventBookPrefill?.date}
                preselectedEventTime={eventBookPrefill?.time}
                linkedOwnerVenueId={ownerVenueId}
                linkedVenueName={eventBookPrefill?.linkedVenueName ?? collectiveTarget?.name}
                stackKey={
                  eventBookPrefill
                    ? `event-${eventBookPrefill.eventId}-${eventBookPrefill.date}-${eventBookPrefill.time ?? ''}`
                    : collectiveTarget
                      ? `collective-${collectiveTarget.id}-${prefillPractitionerId ?? 'any'}`
                      : undefined
                }
              />
            );
          })()
        : null}
      {showResourceBooking && resourceBookingResourceId ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setShowResourceBooking(false);
              setResourceBookingResourceId(undefined);
              setPrefillDate(undefined);
              setPrefillTime(undefined);
            }
          }}
          title="Book resource"
          size="lg"
          contentClassName="max-w-xl overflow-y-auto"
        >
          {resourceBookingVenueError ? (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {resourceBookingVenueError}
            </div>
          ) : resourceBookingVenue ? (
            <ResourceBookingFlow
              key={`${resourceBookingResourceId}-${prefillDate ?? ''}-${prefillTime ?? ''}`}
              venue={resourceBookingVenue}
              bookingAudience="staff"
              staffBookingSource="phone"
              onBookingCreated={() => void refetchBookingsList()}
              onClose={() => {
                setShowResourceBooking(false);
                setResourceBookingResourceId(undefined);
                setPrefillDate(undefined);
                setPrefillTime(undefined);
              }}
              initialResourceId={resourceBookingResourceId}
              initialDate={prefillDate ?? (viewMode === 'day' ? date : undefined)}
              initialTime={prefillTime}
            />
          ) : (
            <div className="space-y-3 py-6" role="status" aria-label="Loading booking form">
              <Skeleton.Line className="w-1/3" />
              <Skeleton.Block className="h-16" />
              <Skeleton.Block className="h-32" />
            </div>
          )}
        </Dialog>
      ) : null}

      {linkedViewing ? (
        <LinkedBookingDetailModal
          venueName={linkedViewing.column.venueName}
          visibility={linkedViewing.column.visibility}
          booking={linkedViewing.booking}
          onClose={() => setLinkedViewing(null)}
        />
      ) : null}

      {crossVenueMove ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setCrossVenueMove(null);
          }}
          title={`${crossVenueMove.booking.guest_name}'s booking can't move to ${crossVenueMove.targetCalendarName}'s calendar`}
          size="sm"
          contentClassName="max-w-md"
          footer={
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setCrossVenueMove(null)}>
                Not now
              </Button>
              <Button type="button" variant="primary" size="sm" onClick={() => startCrossVenueRebook(crossVenueMove)}>
                Book on {crossVenueMove.targetCalendarName}&apos;s calendar
              </Button>
            </div>
          }
        >
          <div className="space-y-3 text-sm text-slate-700">
            <p>
              {crossVenueMove.targetCalendarName}
              {crossVenueMove.targetVenueName ? ` (${crossVenueMove.targetVenueName})` : ' (your venue)'} and{' '}
              {crossVenueMove.sourceCalendarName}
              {crossVenueMove.sourceVenueName ? ` (${crossVenueMove.sourceVenueName})` : ' (your venue)'} are on
              different ResNeo accounts, and a booking cannot be transferred between accounts.
            </p>
            <p>
              To move it, make a new booking on {crossVenueMove.targetCalendarName}&apos;s calendar and cancel this one.
              The button below opens the booking form for {crossVenueMove.targetCalendarName}. Choose the
              service, confirm, and you will be offered to cancel the original.
            </p>
          </div>
        </Dialog>
      ) : null}

      {cancelOriginalPrompt ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setCancelOriginalPrompt(null);
          }}
          title="Cancel the original booking?"
          description={`The new booking is on ${cancelOriginalPrompt.targetLabel}. ${cancelOriginalPrompt.guestName} still has the original at ${cancelOriginalPrompt.originalLabel}.`}
          size="sm"
          contentClassName="max-w-md"
          footer={
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setCancelOriginalPrompt(null)}>
                Keep both
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={quickActionId === cancelOriginalPrompt.bookingId}
                onClick={() => void cancelOriginalAfterCrossVenueRebook(cancelOriginalPrompt)}
              >
                Cancel the original
              </Button>
            </div>
          }
        >
          <p className="text-sm text-slate-700">
            This cancels it the usual way, so the client is told and any deposit follows the venue&apos;s cancellation rules.
          </p>
        </Dialog>
      ) : null}

      {linkedCreating
        ? (() => {
            // A partner's column inside the collective books for the collective with
            // that calendar preselected; a partner outside it keeps the single-venue
            // linked form (its own catalogue, its own grant).
            const collectiveTarget = collectiveTargetFor(
              linkedCreating.venue.venueId,
              linkedCreating.practitionerId ?? null,
            );
            const ownerVenueId = collectiveTarget?.id ?? linkedCreating.venue.venueId;
            return (
              <CalendarStaffBookingModal
                open
                intent={linkedCreating.intent}
                linkedOwnerVenueId={ownerVenueId}
                linkedVenueName={collectiveTarget?.name ?? linkedCreating.venue.venueName}
                stackKey={`linked-${ownerVenueId}-${linkedCreating.practitionerId ?? 'any'}`}
                onClose={() => {
                  setLinkedCreating(null);
                  setCrossVenueRebook(null);
                }}
                onCreated={() => {
                  setLinkedCreating(null);
                  void loadLinkedData();
                  // A collective booking may have landed on one of this venue's own calendars.
                  if (collectiveTarget) void refetchBookingsList();
                  if (crossVenueRebook) {
                    setCancelOriginalPrompt(crossVenueRebook);
                    setCrossVenueRebook(null);
                  }
                }}
                staffRebookBootstrap={crossVenueRebook?.bootstrap ?? null}
                onBookingSubmitted={() => {
                  void loadLinkedData();
                  if (collectiveTarget) void refetchBookingsList();
                }}
                venueId={ownerVenueId}
                currency={currency}
                bookingModel={bookingModel}
                enabledModels={enabledModels}
                preselectedDate={viewMode === 'day' ? date : weekStart}
                preselectedPractitionerId={linkedCreating.practitionerId}
                preselectedTime={linkedCreating.time}
              />
            );
          })()
        : null}
      {acceptUnpaidGuard.dialog}
    </div>
  );
}
