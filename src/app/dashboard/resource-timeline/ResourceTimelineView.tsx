'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { StripePaymentWarning } from '@/components/dashboard/StripePaymentWarning';
import { canAddCalendarColumn, useCalendarEntitlement } from '@/hooks/use-calendar-entitlement';
import { CalendarLimitMessage } from '@/components/dashboard/CalendarLimitMessage';
import { ResourceExceptionsCalendar } from './ResourceExceptionsCalendar';
import { NumericInput } from '@/components/ui/NumericInput';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { DashboardEntityRowActions } from '@/components/ui/dashboard/DashboardEntityRowActions';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { Pill, type PillVariant } from '@/components/ui/dashboard/Pill';
import { EmptyState } from '@/components/ui/dashboard/EmptyState';
import { StatTile } from '@/components/ui/dashboard/StatTile';
import { ScheduleRow } from '@/components/ui/dashboard/ScheduleRow';
import { Skeleton } from '@/components/ui/Skeleton';
import { defaultNewUnifiedCalendarWorkingHours } from '@/lib/availability/practitioner-defaults';
import { HelpTooltip } from '@/components/dashboard/HelpTooltip';
import {
  RESOURCE_MIN_BOOKING_HELP,
  RESOURCE_SLOT_INTERVAL_HELP,
} from '@/lib/help/resource-booking-tooltips';
import {
  DEFAULT_RESOURCE_MIN_BOOKING_MINUTES,
  DEFAULT_RESOURCE_SLOT_INTERVAL_MINUTES,
  syncedMinBookingMinutesFromSlot,
} from '@/lib/booking/resource-booking-defaults';
import type { WorkingHours } from '@/types/booking-models';
import { useVenuePostgresLiveSync } from '@/lib/realtime/useVenuePostgresLiveSync';
import { BookingDetailPanel } from '@/app/dashboard/bookings/BookingDetailPanel';
import { bookingDetailPanelSnapshotFromListRow } from '@/lib/booking/booking-detail-from-row';
import { ResourceBookingFlow } from '@/components/booking/ResourceBookingFlow';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { mapApiVenueToVenuePublic } from '@/lib/booking/map-api-venue-to-public';
import type { VenuePublic } from '@/components/booking/types';
import { Button } from '@/components/ui/primitives/Button';
import { cn } from '@/components/ui/primitives/cn';
import {
  BookingsDateToolbar,
  fieldHintClass,
  fieldInputClass,
  fieldLabelClass,
  fieldSelectClass,
  FormStickyActions,
  ResourceFormHeader,
  ResourceFormSection,
  ResourceMobileStrip,
  ResourcePaymentCards,
  WeekHoursEditor,
  type ResourceListItem,
} from './resource-timeline-ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ResourcePaymentRequirement = 'none' | 'deposit' | 'full_payment';

interface Resource {
  id: string;
  name: string;
  resource_type: string | null;
  /** Host unified calendar column (non-resource) where this resource appears on the staff calendar. */
  display_on_calendar_id: string | null;
  slot_interval_minutes: number;
  min_booking_minutes: number;
  max_booking_minutes: number;
  price_per_slot_pence: number | null;
  payment_requirement: ResourcePaymentRequirement;
  deposit_amount_pence: number | null;
  is_active: boolean;
  availability_hours: Record<string, Array<{ start: string; end: string }>> | null;
  availability_exceptions?: Record<string, { closed: true } | { periods: Array<{ start: string; end: string }> }> | null;
  sort_order: number;
  max_advance_booking_days?: number;
  min_booking_notice_hours?: number;
  cancellation_notice_hours?: number;
  allow_same_day_booking?: boolean;
}

interface ResourceBooking {
  id: string;
  booking_date: string;
  booking_time: string;
  booking_end_time: string | null;
  status: string;
  guest_name: string;
  guest_first_name?: string | null;
  guest_last_name?: string | null;
  guest_email?: string | null;
  guest_phone?: string | null;
  party_size: number;
  deposit_amount_pence: number | null;
  deposit_status: string | null;
  resource_payment_requirement: ResourcePaymentRequirement | null;
  resource_id?: string | null;
}

type DayHours = { enabled: boolean; start: string; end: string };
type WeekHours = Record<string, DayHours>;
type HostCalendar = { id: string; name: string; working_hours: WorkingHours };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAY_LABELS: Array<{ key: string; label: string }> = [
  { key: '1', label: 'Monday' },
  { key: '2', label: 'Tuesday' },
  { key: '3', label: 'Wednesday' },
  { key: '4', label: 'Thursday' },
  { key: '5', label: 'Friday' },
  { key: '6', label: 'Saturday' },
  { key: '0', label: 'Sunday' },
];

const RESOURCE_TYPE_SUGGESTIONS = ['Tennis Court', 'Meeting Room', 'Studio', 'Pitch', 'Equipment', 'Desk', 'Bay', 'Lane', 'Pod'];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const RESOURCE_CALENDAR_LIMIT_WARNING =
  'This resource has hours outside the selected calendar. It will only be bookable when venue, calendar, and resource hours all allow it.';

/** Aligned with GET/POST/PATCH /api/venue/resources zod schema */
const SLOT_INTERVAL_MIN = 5;
const SLOT_INTERVAL_MAX = 480;
const MIN_BOOKING_MIN = 15;
const MIN_BOOKING_MAX = 480;
const MAX_BOOKING_MIN = 15;
const MAX_BOOKING_MAX = 1440;

function resourceBookingStatusVariant(status: string): PillVariant {
  const s = status.toLowerCase();
  if (s.includes('cancel')) return 'danger';
  if (s === 'booked') return 'info';
  if (s.includes('confirm') || s.includes('complete')) return 'success';
  if (s.includes('pending')) return 'warning';
  return 'neutral';
}

function bookingScheduleStripClass(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('cancel')) return 'bg-slate-300';
  if (s.includes('pending')) return 'bg-amber-500';
  if (s === 'booked') return 'bg-sky-500';
  if (s.includes('confirm')) return 'bg-brand-600';
  return 'bg-slate-400';
}

function defaultWeekHours(): WeekHours {
  const h: WeekHours = {};
  for (const d of DAY_LABELS) {
    h[d.key] = d.key === '0' || d.key === '6'
      ? { enabled: false, start: '09:00', end: '17:00' }
      : { enabled: true, start: '09:00', end: '17:00' };
  }
  return h;
}

function weekHoursFromJSON(hours: Record<string, Array<{ start: string; end: string }>> | null | undefined): WeekHours {
  const result = defaultWeekHours();
  if (!hours) return result;
  for (const d of DAY_LABELS) {
    const ranges = hours[d.key];
    if (ranges && ranges.length > 0) {
      result[d.key] = { enabled: true, start: ranges[0].start, end: ranges[0].end };
    } else {
      result[d.key] = { ...result[d.key]!, enabled: false };
    }
  }
  return result;
}

function weekHoursToJSON(wh: WeekHours): Record<string, Array<{ start: string; end: string }>> {
  const result: Record<string, Array<{ start: string; end: string }>> = {};
  for (const d of DAY_LABELS) {
    const day = wh[d.key]!;
    if (day.enabled) {
      result[d.key] = [{ start: day.start, end: day.end }];
    }
  }
  return result;
}

function timeToMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return Number.NaN;
  return h * 60 + m;
}

function calendarRangesForDay(
  hours: WorkingHours,
  dayIndex0to6: number,
): Array<{ start: number; end: number }> {
  const key = String(dayIndex0to6);
  const ranges = hours[key] ?? hours[DAY_NAMES[dayIndex0to6]] ?? [];
  return ranges
    .map((r) => ({ start: timeToMinutes(r.start), end: timeToMinutes(r.end) }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .sort((a, b) => a.start - b.start);
}

function mergedCalendarRangesForDay(
  hours: WorkingHours,
  dayIndex0to6: number,
): Array<{ start: number; end: number }> {
  const ranges = calendarRangesForDay(hours, dayIndex0to6);
  if (ranges.length === 0) return [];
  const merged: Array<{ start: number; end: number }> = [{ ...ranges[0]! }];
  for (const range of ranges.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function resourceHoursOutsideCalendar(resourceHours: WeekHours, calendarHours: WorkingHours): boolean {
  for (const d of DAY_LABELS) {
    const day = resourceHours[d.key]!;
    if (!day.enabled) continue;
    const resourceStart = timeToMinutes(day.start);
    const resourceEnd = timeToMinutes(day.end);
    if (!Number.isFinite(resourceStart) || !Number.isFinite(resourceEnd) || resourceEnd <= resourceStart) continue;
    const calendarRanges = mergedCalendarRangesForDay(calendarHours, Number(d.key));
    if (calendarRanges.length === 0) return true;
    const fullyCovered = calendarRanges.some((range) => range.start <= resourceStart && resourceEnd <= range.end);
    if (!fullyCovered) return true;
  }
  return false;
}

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Local calendar YYYY-MM-DD (avoids UTC shift from toISOString). */
function formatYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Inclusive list of dates from start to end (YYYY-MM-DD). Empty if invalid or end before start. */
function eachDateInRangeInclusive(start: string, end: string): string[] {
  const p = (s: string) => {
    const [y, mo, da] = s.split('-').map(Number);
    return { y, mo, da, d: new Date(y, mo - 1, da) };
  };
  const a = p(start);
  const b = p(end);
  if (!a.y || !b.y || Number.isNaN(a.d.getTime()) || Number.isNaN(b.d.getTime())) return [];
  if (b.d < a.d) return [];
  const out: string[] = [];
  for (let cur = new Date(a.d); cur <= b.d; cur.setDate(cur.getDate() + 1)) {
    out.push(formatYmdLocal(cur));
  }
  return out;
}

const MAX_EXCEPTION_RANGE_DAYS = 366;

function resourcePaymentSummary(r: Resource, formatPrice: (pence: number) => string): string {
  if (r.payment_requirement === 'none') return 'Pay at venue';
  if (r.payment_requirement === 'full_payment') return 'Full payment online';
  const dep = r.deposit_amount_pence != null ? formatPrice(r.deposit_amount_pence) : '—';
  return `Deposit ${dep} online`;
}

function resourceBookingPaymentLine(b: ResourceBooking, formatPrice: (pence: number) => string): string | null {
  const mode = b.resource_payment_requirement;
  const pence = b.deposit_amount_pence;
  const st = b.deposit_status ?? '-';
  if (mode === 'none') return 'Pay at venue';
  if (pence != null && pence > 0) {
    if (mode === 'full_payment') return `Paid ${formatPrice(pence)} online (${st})`;
    if (mode === 'deposit') return `Deposit ${formatPrice(pence)} (${st})`;
    return `Payment ${formatPrice(pence)} (${st})`;
  }
  if (mode === 'full_payment' || mode === 'deposit') return `Online payment ${st}`;
  return null;
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function ResourceTimelineView({
  venueId,
  isAdmin = false,
  linkedPractitionerIds = [],
  currency = 'GBP',
  stripeConnected = false,
}: {
  venueId: string;
  isAdmin?: boolean;
  linkedPractitionerIds?: string[];
  currency?: string;
  stripeConnected?: boolean;
}) {
  const sym = currency === 'EUR' ? '\u20ac' : '\u00a3';
  function formatPrice(pence: number): string {
    return `${sym}${(pence / 100).toFixed(2)}`;
  }

  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Shown after save when API reports host calendar hours narrower than resource weekly hours. */
  const [availabilityWarning, setAvailabilityWarning] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('');
  const [formSlotStr, setFormSlotStr] = useState(String(DEFAULT_RESOURCE_SLOT_INTERVAL_MINUTES));
  const [formMinStr, setFormMinStr] = useState(String(DEFAULT_RESOURCE_MIN_BOOKING_MINUTES));
  const [formMaxStr, setFormMaxStr] = useState('180');
  const [formAdvancedMinBooking, setFormAdvancedMinBooking] = useState(false);
  const [formPrice, setFormPrice] = useState('');
  const [formPaymentReq, setFormPaymentReq] = useState<ResourcePaymentRequirement>('none');
  const [formDeposit, setFormDeposit] = useState('');
  const [formActive, setFormActive] = useState(true);
  const [formHours, setFormHours] = useState<WeekHours>(defaultWeekHours);
  const [formMatchCalendarHours, setFormMatchCalendarHours] = useState(false);
  const [formExceptions, setFormExceptions] = useState<Record<string, { closed: true } | { periods: Array<{ start: string; end: string }> }>>({});
  const [exceptionMonth, setExceptionMonth] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() + 1 };
  });
  const [exceptionRangeStart, setExceptionRangeStart] = useState<string | null>(null);
  const [exceptionRangeEnd, setExceptionRangeEnd] = useState<string | null>(null);
  const [exceptionEditingDay, setExceptionEditingDay] = useState<string | null>(null);
  const [formExceptionType, setFormExceptionType] = useState<'closed' | 'custom'>('closed');
  const [formExceptionStart, setFormExceptionStart] = useState('09:00');
  const [formExceptionEnd, setFormExceptionEnd] = useState('17:00');
  const [formDisplayCalendarId, setFormDisplayCalendarId] = useState('');
  const [formMaxAdvanceDays, setFormMaxAdvanceDays] = useState(90);
  const [formMinNoticeHours, setFormMinNoticeHours] = useState(1);
  const [formCancellationHours, setFormCancellationHours] = useState(48);
  const [formAllowSameDay, setFormAllowSameDay] = useState(true);
  const [hostCalendars, setHostCalendars] = useState<HostCalendar[]>([]);
  const [showInlineCalendarForm, setShowInlineCalendarForm] = useState(false);
  const [newCalendarName, setNewCalendarName] = useState('');
  const [creatingCalendar, setCreatingCalendar] = useState(false);
  const [inlineCalendarError, setInlineCalendarError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resourceToDelete, setResourceToDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleteResourceBusy, setDeleteResourceBusy] = useState(false);
  const [deleteResourceModalError, setDeleteResourceModalError] = useState<string | null>(null);

  const {
    entitlement: calendarEntitlement,
    entitlementLoaded,
    refresh: refreshCalendarEntitlement,
  } = useCalendarEntitlement(Boolean(isAdmin));
  const canAddCalendar = canAddCalendarColumn(calendarEntitlement, entitlementLoaded);

  // Bookings for selected resource
  const [bookingsDate, setBookingsDate] = useState(() => formatYmdLocal(new Date()));
  const [bookings, setBookings] = useState<ResourceBooking[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [detailBookingId, setDetailBookingId] = useState<string | null>(null);
  const [showResourceBooking, setShowResourceBooking] = useState(false);
  const [resourceBookingSessionKey, setResourceBookingSessionKey] = useState(0);
  const [resourceBookingVenue, setResourceBookingVenue] = useState<VenuePublic | null>(null);
  const [resourceBookingVenueError, setResourceBookingVenueError] = useState<string | null>(null);

  const selected = useMemo(() => resources.find((r) => r.id === selectedId) ?? null, [resources, selectedId]);

  const resourceListItems = useMemo((): ResourceListItem[] => {
    return resources.map((r) => ({
      id: r.id,
      name: r.name,
      resource_type: r.resource_type,
      is_active: r.is_active,
      hostLabel: hostCalendars.find((c) => c.id === r.display_on_calendar_id)?.name ?? 'Calendar',
      metaLine: [
        r.price_per_slot_pence != null ? `${formatPrice(r.price_per_slot_pence)}/slot` : 'Free',
        resourcePaymentSummary(r, formatPrice),
      ].join(' · '),
    }));
  }, [resources, hostCalendars, formatPrice]);
  const selectedHostCalendar = useMemo(
    () => hostCalendars.find((c) => c.id === formDisplayCalendarId) ?? null,
    [formDisplayCalendarId, hostCalendars],
  );
  const formCalendarRestrictionWarning = useMemo(
    () =>
      showForm && selectedHostCalendar && resourceHoursOutsideCalendar(formHours, selectedHostCalendar.working_hours)
        ? RESOURCE_CALENDAR_LIMIT_WARNING
        : null,
    [formHours, selectedHostCalendar, showForm],
  );

  const formSlotMinutesParsed = useMemo(() => {
    const n = parseInt(formSlotStr.trim(), 10);
    if (!Number.isFinite(n) || n < SLOT_INTERVAL_MIN || n > SLOT_INTERVAL_MAX) return null;
    return n;
  }, [formSlotStr]);

  // Fetch resources
  const fetchResources = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) {
      setLoading(true);
      setLoadError(null);
    }
    try {
      const res = await fetch('/api/venue/resources');
      const data = await res.json();
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? 'Could not load resources');
      }
      setResources(data.resources ?? []);
    } catch {
      if (!silent) {
        setLoadError('We couldn’t load your resources. Check your connection and try again.');
        setResources([]);
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => { void fetchResources(); }, [fetchResources]);

  const fetchResourceBookings = useCallback(async () => {
    if (!selectedId || showForm) {
      setBookings([]);
      return;
    }
    setBookingsLoading(true);
    try {
      const res = await fetch(`/api/venue/bookings/list?date=${bookingsDate}&resource_id=${selectedId}`);
      if (!res.ok) {
        setBookings([]);
        return;
      }
      const data = await res.json();
      const rows = (data.bookings ?? []) as Array<Record<string, unknown>>;
      setBookings(
        rows
          .filter((b) => (b.resource_id === selectedId || b.calendar_id === selectedId))
          .map((b) => ({
            id: b.id as string,
            booking_date: b.booking_date as string,
            booking_time: ((b.booking_time as string) ?? '').slice(0, 5),
            booking_end_time: b.booking_end_time ? (b.booking_end_time as string).slice(0, 5) : null,
            status: b.status as string,
            guest_name: (b.guest_name as string) ?? 'Guest',
            guest_first_name: (b.guest_first_name as string | null) ?? null,
            guest_last_name: (b.guest_last_name as string | null) ?? null,
            guest_email: (b.guest_email as string | null) ?? null,
            guest_phone: (b.guest_phone as string | null) ?? null,
            party_size: (b.party_size as number) ?? 1,
            deposit_amount_pence: (b.deposit_amount_pence as number | null) ?? null,
            deposit_status: (b.deposit_status as string | null) ?? null,
            resource_payment_requirement: (b.resource_payment_requirement as ResourcePaymentRequirement | null) ?? null,
            resource_id: (b.resource_id as string | null) ?? selectedId,
          }))
          .sort((a, b) => a.booking_time.localeCompare(b.booking_time)),
      );
    } catch {
      setBookings([]);
    } finally {
      setBookingsLoading(false);
    }
  }, [selectedId, bookingsDate, showForm]);

  const refreshResourceTimeline = useCallback(() => {
    void fetchResources({ silent: true });
    void fetchResourceBookings();
  }, [fetchResourceBookings, fetchResources]);

  useVenuePostgresLiveSync({
    venueId,
    onRefresh: refreshResourceTimeline,
    subscriptions: [
      { table: 'unified_calendars', filter: `venue_id=eq.${venueId}` },
      { table: 'bookings', filter: `venue_id=eq.${venueId}` },
    ],
  });

  const fetchHostCalendars = useCallback(async () => {
    try {
      const res = await fetch('/api/venue/practitioners?roster=1');
      if (!res.ok) return;
      const data = await res.json();
      const list = (data.practitioners ?? []).filter(
        (p: { calendar_type?: string }) => p.calendar_type !== 'resource',
      ) as Array<{ id: string; name: string }>;
      const pick = isAdmin ? list : list.filter((p) => linkedPractitionerIds.includes(p.id));
      setHostCalendars(
        pick.map((p) => ({
          id: p.id,
          name: p.name,
          working_hours: (p as { working_hours?: WorkingHours }).working_hours ?? {},
        })),
      );
    } catch {
      /* ignore */
    }
  }, [isAdmin, linkedPractitionerIds]);

  useEffect(() => {
    void fetchHostCalendars();
  }, [fetchHostCalendars]);

  const handleCreateInlineCalendar = useCallback(async () => {
    const name = newCalendarName.trim();
    if (!name) {
      setInlineCalendarError('Enter a calendar name.');
      return;
    }
    setCreatingCalendar(true);
    setInlineCalendarError(null);
    try {
      const res = await fetch('/api/venue/practitioners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          is_active: true,
          working_hours: defaultNewUnifiedCalendarWorkingHours(),
          break_times: [],
          days_off: [],
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        id?: string;
        name?: string;
        error?: string;
        upgrade_required?: boolean;
      };
      if (!res.ok) {
        if (res.status === 403 || json.upgrade_required) {
          void refreshCalendarEntitlement();
        }
        setInlineCalendarError(json.error ?? 'Could not create calendar.');
        return;
      }
      if (!json.id) {
        setInlineCalendarError('Calendar was created but no id was returned. Refresh the page.');
        return;
      }

      const created = { id: json.id, name: json.name ?? name, working_hours: defaultNewUnifiedCalendarWorkingHours() };
      setHostCalendars((prev) =>
        prev.some((c) => c.id === created.id)
          ? prev
          : [...prev, created].sort((a, b) => a.name.localeCompare(b.name)),
      );
      if (!formName.trim()) {
        setFormName(created.name);
      }
      setFormDisplayCalendarId(created.id);
      setNewCalendarName('');
      setShowInlineCalendarForm(false);
      void refreshCalendarEntitlement();
    } catch {
      setInlineCalendarError('Could not create calendar.');
    } finally {
      setCreatingCalendar(false);
    }
  }, [formName, newCalendarName, refreshCalendarEntitlement]);

  useEffect(() => {
    if (!showForm || !formMatchCalendarHours || !selectedHostCalendar) return;
    setFormHours(weekHoursFromJSON(selectedHostCalendar.working_hours));
  }, [formMatchCalendarHours, selectedHostCalendar, showForm]);

  // Fetch bookings for selected resource
  useEffect(() => {
    void fetchResourceBookings();
  }, [fetchResourceBookings]);

  useEffect(() => {
    if (!showResourceBooking || resourceBookingVenue) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/venue');
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          if (!cancelled) {
            setResourceBookingVenueError(typeof data.error === 'string' ? data.error : 'Could not load venue');
          }
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

  const detailBookingSnapshot = useMemo(() => {
    if (!detailBookingId) return null;
    const b = bookings.find((x) => x.id === detailBookingId);
    if (!b) return null;
    return bookingDetailPanelSnapshotFromListRow({
      id: b.id,
      booking_date: b.booking_date,
      booking_time: b.booking_time,
      booking_end_time: b.booking_end_time,
      party_size: b.party_size,
      status: b.status,
      guest_name: b.guest_name,
      guest_first_name: b.guest_first_name,
      guest_last_name: b.guest_last_name,
      guest_email: b.guest_email,
      guest_phone: b.guest_phone,
      deposit_status: b.deposit_status ?? undefined,
      resource_id: b.resource_id ?? selectedId,
      inferred_booking_model: 'resource_booking',
      booking_model: 'resource_booking',
      service_name: selected?.name ?? null,
    });
  }, [bookings, detailBookingId, selected, selectedId]);

  const openResourceBookingDialog = useCallback(() => {
    if (!selectedId) return;
    setResourceBookingVenueError(null);
    setResourceBookingSessionKey((k) => k + 1);
    setShowResourceBooking(true);
  }, [selectedId]);

  // Select first resource on load
  useEffect(() => {
    if (!selectedId && resources.length > 0) setSelectedId(resources[0].id);
  }, [resources, selectedId]);

  // Form helpers
  function openCreate() {
    setEditingId(null);
    setFormName('');
    setFormType('');
    setFormSlotStr(String(DEFAULT_RESOURCE_SLOT_INTERVAL_MINUTES));
    setFormMinStr(String(DEFAULT_RESOURCE_MIN_BOOKING_MINUTES));
    setFormMaxStr('180');
    setFormAdvancedMinBooking(false);
    setFormPrice('');
    setFormPaymentReq('none');
    setFormDeposit('');
    setFormActive(true);
    setFormHours(defaultWeekHours());
    setFormMatchCalendarHours(false);
    setFormExceptions({});
    const n = new Date();
    setExceptionMonth({ year: n.getFullYear(), month: n.getMonth() + 1 });
    setExceptionRangeStart(null);
    setExceptionRangeEnd(null);
    setExceptionEditingDay(null);
    setFormDisplayCalendarId('');
    setFormMaxAdvanceDays(90);
    setFormMinNoticeHours(1);
    setFormCancellationHours(48);
    setFormAllowSameDay(true);
    setError(null);
    setInlineCalendarError(null);
    setShowInlineCalendarForm(false);
    setNewCalendarName('');
    setShowForm(true);
  }

  function openEdit(r: Resource) {
    setEditingId(r.id);
    setFormName(r.name);
    setFormType(r.resource_type ?? '');
    setFormSlotStr(String(r.slot_interval_minutes));
    setFormMinStr(String(r.min_booking_minutes));
    setFormMaxStr(String(r.max_booking_minutes));
    setFormAdvancedMinBooking(
      r.min_booking_minutes !== syncedMinBookingMinutesFromSlot(r.slot_interval_minutes, MIN_BOOKING_MIN),
    );
    setFormPrice(r.price_per_slot_pence != null ? (r.price_per_slot_pence / 100).toFixed(2) : '');
    setFormPaymentReq(r.payment_requirement ?? 'none');
    setFormDeposit(r.deposit_amount_pence != null ? (r.deposit_amount_pence / 100).toFixed(2) : '');
    setFormActive(r.is_active);
    setFormHours(weekHoursFromJSON(r.availability_hours));
    setFormMatchCalendarHours(false);
    setFormExceptions(r.availability_exceptions ? { ...r.availability_exceptions } : {});
    const n = new Date();
    setExceptionMonth({ year: n.getFullYear(), month: n.getMonth() + 1 });
    setExceptionRangeStart(null);
    setExceptionRangeEnd(null);
    setExceptionEditingDay(null);
    setFormDisplayCalendarId(r.display_on_calendar_id ?? '');
    setFormMaxAdvanceDays(r.max_advance_booking_days ?? 90);
    setFormMinNoticeHours(r.min_booking_notice_hours ?? 1);
    setFormCancellationHours(r.cancellation_notice_hours ?? 48);
    setFormAllowSameDay(r.allow_same_day_booking ?? true);
    setError(null);
    setInlineCalendarError(null);
    setShowInlineCalendarForm(false);
    setNewCalendarName('');
    setShowForm(true);
  }

  function applyExceptionRange() {
    if (!exceptionRangeStart) {
      setError('Tap a day on the calendar to start a range, then tap another day (or use Apply for a single day).');
      return;
    }
    const end = exceptionRangeEnd ?? exceptionRangeStart;
    if (end < exceptionRangeStart) {
      setError('End date must be on or after the start date.');
      return;
    }
    const dates = eachDateInRangeInclusive(exceptionRangeStart, end);
    if (dates.length === 0) {
      setError('Invalid date range.');
      return;
    }
    if (dates.length > MAX_EXCEPTION_RANGE_DAYS) {
      setError(`Date range cannot exceed ${MAX_EXCEPTION_RANGE_DAYS} days.`);
      return;
    }
    const value =
      formExceptionType === 'closed'
        ? { closed: true as const }
        : { periods: [{ start: formExceptionStart, end: formExceptionEnd }] };
    setFormExceptions((prev) => {
      const next = { ...prev };
      for (const dateKey of dates) {
        next[dateKey] = value;
      }
      return next;
    });
    setExceptionRangeStart(null);
    setExceptionRangeEnd(null);
    setError(null);
  }

  function handleExceptionDayClick(ymd: string) {
    setError(null);
    const ex = formExceptions[ymd];
    if (ex) {
      setExceptionEditingDay(ymd);
      setExceptionRangeStart(null);
      setExceptionRangeEnd(null);
      if ('closed' in ex) {
        setFormExceptionType('closed');
      } else {
        setFormExceptionType('custom');
        setFormExceptionStart(ex.periods[0]?.start ?? '09:00');
        setFormExceptionEnd(ex.periods[0]?.end ?? '17:00');
      }
      return;
    }
    setExceptionEditingDay(null);
    if (!exceptionRangeStart) {
      setExceptionRangeStart(ymd);
      setExceptionRangeEnd(null);
      return;
    }
    if (!exceptionRangeEnd) {
      const [a, b] = ymd < exceptionRangeStart ? [ymd, exceptionRangeStart] : [exceptionRangeStart, ymd];
      setExceptionRangeStart(a);
      setExceptionRangeEnd(b);
      return;
    }
    setExceptionRangeStart(ymd);
    setExceptionRangeEnd(null);
  }

  function clearExceptionRangeSelection() {
    setExceptionRangeStart(null);
    setExceptionRangeEnd(null);
  }

  function saveExceptionEdit() {
    if (!exceptionEditingDay) return;
    const value =
      formExceptionType === 'closed'
        ? { closed: true as const }
        : { periods: [{ start: formExceptionStart, end: formExceptionEnd }] };
    setFormExceptions((prev) => ({ ...prev, [exceptionEditingDay]: value }));
    setExceptionEditingDay(null);
    setError(null);
  }

  function cancelExceptionEdit() {
    setExceptionEditingDay(null);
  }

  function exceptionPrevMonth() {
    setExceptionMonth((m) => (m.month <= 1 ? { year: m.year - 1, month: 12 } : { year: m.year, month: m.month - 1 }));
  }

  function exceptionNextMonth() {
    setExceptionMonth((m) => (m.month >= 12 ? { year: m.year + 1, month: 1 } : { year: m.year, month: m.month + 1 }));
  }

  function removeException(dateKey: string) {
    setFormExceptions((prev) => {
      const next = { ...prev };
      delete next[dateKey];
      return next;
    });
    if (exceptionEditingDay === dateKey) setExceptionEditingDay(null);
  }

  async function handleSave() {
    if (!isAdmin && !editingId && linkedPractitionerIds.length === 0) {
      setError('Ask an admin to assign at least one calendar before you can create resources.');
      return;
    }
    if (!formName.trim()) { setError('Resource name is required.'); return; }

    const formSlot = parseInt(formSlotStr.trim(), 10);
    const formMinRaw = parseInt(formMinStr.trim(), 10);
    const formMax = parseInt(formMaxStr.trim(), 10);
    if (!Number.isFinite(formSlot) || formSlot < SLOT_INTERVAL_MIN || formSlot > SLOT_INTERVAL_MAX) {
      setError(
        `Start-time step must be a whole number from ${SLOT_INTERVAL_MIN} to ${SLOT_INTERVAL_MAX} minutes.`,
      );
      return;
    }
    const effectiveFormMin = formAdvancedMinBooking
      ? formMinRaw
      : syncedMinBookingMinutesFromSlot(formSlot, MIN_BOOKING_MIN);
    if (formAdvancedMinBooking) {
      if (!Number.isFinite(formMinRaw) || formMinRaw < MIN_BOOKING_MIN || formMinRaw > MIN_BOOKING_MAX) {
        setError(
          `Shortest booking must be a whole number from ${MIN_BOOKING_MIN} to ${MIN_BOOKING_MAX} minutes.`,
        );
        return;
      }
      if (formMinRaw < formSlot) {
        setError(
          'Shortest booking must be at least the start-time step, or turn off Advanced to match the step automatically.',
        );
        return;
      }
    }
    if (!Number.isFinite(formMax) || formMax < MAX_BOOKING_MIN || formMax > MAX_BOOKING_MAX) {
      setError(`Max booking must be a whole number from ${MAX_BOOKING_MIN} to ${MAX_BOOKING_MAX} minutes.`);
      return;
    }
    if (effectiveFormMin > formMax) {
      setError('Shortest booking cannot be longer than the maximum booking.');
      return;
    }

    const pricePence = formPrice !== '' ? Math.round(parseFloat(formPrice) * 100) : 0;
    if ((formPaymentReq === 'deposit' || formPaymentReq === 'full_payment') && pricePence <= 0) {
      setError('Set a price for each start-time step before choosing deposit or full payment online.');
      return;
    }
    if (formPaymentReq === 'deposit') {
      const d = parseFloat(formDeposit);
      if (!Number.isFinite(d) || d <= 0) { setError('Enter a deposit amount greater than zero.'); return; }
      const depPence = Math.round(d * 100);
      const maxSlots = Math.max(1, Math.ceil(formMax / formSlot));
      const maxTotal = pricePence * maxSlots;
      if (pricePence > 0 && depPence > maxTotal) {
        setError('Deposit cannot exceed the maximum possible booking total for this resource.');
        return;
      }
    }
    if (!formDisplayCalendarId) {
      setError('Choose a calendar column to show this resource on.');
      return;
    }
    setSaving(true);
    setError(null);
    setAvailabilityWarning(null);
    try {
      const payload = {
        name: formName.trim(),
        ...(formType.trim() && { resource_type: formType.trim() }),
        display_on_calendar_id: formDisplayCalendarId,
        slot_interval_minutes: formSlot,
        min_booking_minutes: effectiveFormMin,
        max_booking_minutes: formMax,
        ...(formPrice !== '' && { price_per_slot_pence: pricePence }),
        payment_requirement: formPaymentReq,
        ...(formPaymentReq === 'deposit'
          ? { deposit_amount_pence: Math.round(parseFloat(formDeposit) * 100) }
          : { deposit_amount_pence: null }),
        is_active: formActive,
        availability_hours: weekHoursToJSON(formHours),
        availability_exceptions: formExceptions,
        max_advance_booking_days: formMaxAdvanceDays,
        min_booking_notice_hours: formMinNoticeHours,
        cancellation_notice_hours: formCancellationHours,
        allow_same_day_booking: formAllowSameDay,
      };
      const res = editingId
        ? await fetch('/api/venue/resources', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: editingId, ...payload }),
          })
        : await fetch('/api/venue/resources', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
      const json = await res.json();
      if (!res.ok) {
        const j = json as { error?: string; details?: string };
        const msg = [j.error, j.details].filter(Boolean).join(' — ');
        setError(msg || 'Save failed');
        return;
      }
      const j = json as { id?: string; availability_warning?: string };
      if (j.availability_warning) {
        setAvailabilityWarning(j.availability_warning);
      }
      const savedId = j.id ?? editingId;
      setShowForm(false);
      await fetchResources();
      if (savedId) setSelectedId(savedId);
    } catch {
      setError('Save failed');
    } finally {
      setSaving(false);
    }
  }

  function requestDeleteResource(id: string) {
    const r = resources.find((x) => x.id === id);
    setDeleteResourceModalError(null);
    setResourceToDelete({ id, name: r?.name ?? 'this resource' });
  }

  async function confirmDeleteResource() {
    const target = resourceToDelete;
    if (!target) return;
    setDeleteResourceBusy(true);
    setDeleteResourceModalError(null);
    try {
      const res = await fetch('/api/venue/resources', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: target.id }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setDeleteResourceModalError(j.error ?? 'Delete failed');
        return;
      }
      setResourceToDelete(null);
      if (selectedId === target.id) setSelectedId(null);
      await fetchResources();
    } catch {
      setDeleteResourceModalError('Delete failed');
    } finally {
      setDeleteResourceBusy(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const canManageResources = isAdmin || linkedPractitionerIds.length > 0;

  const pageChrome = (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Resources"
        title="Resource timeline"
        subtitle="Manage bookable assets, weekly hours, and upcoming reservations tied to team calendar columns."
        actions={
          canManageResources && !showForm ? (
            <Button type="button" size="lg" className="w-full sm:w-auto" onClick={openCreate}>
              + Add resource
            </Button>
          ) : null
        }
      />

      {!showForm ? (
        <>
          <SectionCard>
            <SectionCard.Body className="!py-3 text-sm text-slate-600">
              <p className="leading-relaxed">
                Resource bookings and free slots appear on the team calendar column you choose under{' '}
                <strong className="font-medium text-slate-800">Show on calendar</strong> when editing a resource.
              </p>
              <p className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
                <Link href="/dashboard/calendar" className="font-semibold text-brand-600 underline hover:text-brand-800">
                  Open dashboard calendar
                </Link>
                <Link
                  href="/dashboard/calendar-availability?tab=calendars"
                  className="font-semibold text-brand-600 underline hover:text-brand-800"
                >
                  Calendar availability
                </Link>
              </p>
            </SectionCard.Body>
          </SectionCard>

          {!isAdmin ? (
            <SectionCard>
              <SectionCard.Body className="!py-3 text-sm text-slate-600">
                {linkedPractitionerIds.length === 0
                  ? 'Your account is not linked to a calendar yet. Ask an admin to assign at least one calendar before you can create, edit, or delete resources.'
                  : 'You can create, edit, or delete resources when they are shown on a calendar column you control (choose under Show on calendar). Admins can assign any column.'}
              </SectionCard.Body>
            </SectionCard>
          ) : null}
        </>
      ) : null}
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        {pageChrome}
        <div className="flex min-h-0 min-w-0 flex-col gap-6 overflow-x-hidden lg:flex-row lg:items-start">
          <div className="hidden w-full shrink-0 lg:block lg:w-72 xl:w-80">
            <SectionCard>
              <SectionCard.Header eyebrow="Resources" title="All resources" />
              <SectionCard.Body className="space-y-3">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <Skeleton.Block key={i} className="h-14" />
                ))}
              </SectionCard.Body>
            </SectionCard>
          </div>
          <div className="min-w-0 flex-1 space-y-4">
            <Skeleton.Card>
              <Skeleton.Line className="w-1/3" />
              <Skeleton.Block className="mt-3 h-32" />
            </Skeleton.Card>
            <Skeleton.Card>
              <Skeleton.Line className="w-24" />
              <Skeleton.Block className="mt-3 h-28" />
            </Skeleton.Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-6 overflow-x-hidden">
      {pageChrome}
      {loadError ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <p>{loadError}</p>
          <button
            type="button"
            onClick={() => void fetchResources()}
            className="mt-2 text-sm font-semibold text-red-900 underline underline-offset-2 hover:text-red-950"
          >
            Try again
          </button>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
      {/* ─── Sidebar: resource list ─── */}
      <aside
        className={cn(
          'hidden min-w-0 shrink-0 lg:block lg:w-72 xl:w-80',
          showForm && 'lg:hidden',
        )}
        aria-label="Resource directory"
      >
        <div className="lg:sticky lg:top-4 lg:max-h-[calc(100dvh-5rem)] lg:overflow-y-auto lg:overscroll-contain">
          <SectionCard>
            <SectionCard.Header
              eyebrow="Directory"
              title="All resources"
              right={
                canManageResources ? (
                  <Button type="button" size="sm" onClick={openCreate}>
                    + Add
                  </Button>
                ) : null
              }
            />
            {resources.length === 0 ? (
              <SectionCard.Body className="!py-8">
                <EmptyState
                  title="No resources yet"
                  description="Create courts, rooms, or equipment your guests can book in fixed slots."
                  action={
                    canManageResources ? (
                      <button
                        type="button"
                        onClick={openCreate}
                        className="text-sm font-semibold text-brand-600 hover:text-brand-800"
                      >
                        Create your first resource
                      </button>
                    ) : undefined
                  }
                />
              </SectionCard.Body>
            ) : (
              <ul className="divide-y divide-slate-100">
                {resources.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(r.id);
                        setShowForm(false);
                      }}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                        selectedId === r.id && !showForm
                          ? 'bg-brand-50/40 ring-1 ring-inset ring-brand-200'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${r.is_active ? 'bg-emerald-500' : 'bg-slate-300'}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900">{r.name}</span>
                        <span className="block truncate text-xs text-slate-500">
                          {hostCalendars.find((c) => c.id === r.display_on_calendar_id)?.name ?? 'Calendar'}
                          {r.resource_type ? ` · ${r.resource_type}` : ''}
                          {r.price_per_slot_pence != null && ` · ${formatPrice(r.price_per_slot_pence)}/slot`}
                          {` · ${resourcePaymentSummary(r, formatPrice)}`}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
          {!isAdmin ? (
            <p className="mt-3 text-xs text-slate-500">Permission rules are explained in the note above.</p>
          ) : null}
        </div>
      </aside>

      {/* ─── Main panel ─── */}
      <div className="min-w-0 flex-1">
        <ResourceMobileStrip
          resources={resourceListItems}
          selectedId={selectedId}
          showForm={showForm}
          onSelect={(id) => {
            setSelectedId(id);
            setShowForm(false);
          }}
        />
        {availabilityWarning && (
          <div
            className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm"
            role="status"
          >
            <p className="font-medium text-amber-900">Calendar availability notice</p>
            <p className="mt-1 text-amber-900/95">{availabilityWarning}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Link
                href="/dashboard/calendar-availability?tab=availability"
                className="inline-flex min-h-10 items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
              >
                Open Calendar availability
              </Link>
              <button
                type="button"
                onClick={() => setAvailabilityWarning(null)}
                className="min-h-10 rounded-lg px-2 text-sm font-medium text-amber-800 underline underline-offset-2 hover:bg-amber-100/60 hover:text-amber-950"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
        {showForm ? (
          <div className="min-w-0 w-full space-y-5 pb-6">
            <ResourceFormHeader
              eyebrow={editingId ? 'Editing' : 'New resource'}
              title={editingId ? formName || 'Resource' : 'Add a bookable resource'}
              description="Courts, rooms, studios, and equipment guests reserve in time slots."
              onBack={() => setShowForm(false)}
            />

            {isAdmin && !editingId ? (
              <div className="rounded-xl border border-blue-100/90 bg-blue-50/80 px-4 py-3 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Permissions</p>
                <p className="mt-1 leading-relaxed">
                  Assign any team calendar. Staff can only manage resources on calendars they control.
                </p>
              </div>
            ) : null}
            {!isAdmin && !editingId && linkedPractitionerIds.length > 0 ? (
              <p className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 text-sm text-slate-600">
                Pick a calendar you control under <strong>Show on calendar</strong>.
              </p>
            ) : null}

            <ResourceFormSection
              step={1}
              title="Basics"
              description="Name and type shown to guests and staff."
            >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="min-w-0">
                <label className={fieldLabelClass}>Resource name *</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Court 1, Studio A"
                  className={fieldInputClass}
                />
              </div>
              <div className="min-w-0">
                <label className={`${fieldLabelClass} flex items-center gap-1.5`}>
                  Type
                  <HelpTooltip
                    icon="?"
                    content="Optional label for guests. Does not change rules or pricing."
                  />
                </label>
                <input
                  type="text"
                  value={formType}
                  onChange={(e) => setFormType(e.target.value)}
                  placeholder="Meeting room, pitch, bay…"
                  autoComplete="off"
                  className={fieldInputClass}
                />
                <p className={fieldHintClass}>Quick picks:</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {RESOURCE_TYPE_SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setFormType(s)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:border-brand-200 hover:bg-brand-50/50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            </ResourceFormSection>

            <ResourceFormSection
              step={2}
              title="Team calendar"
              description="Where this resource appears on your dashboard calendar."
            >
            <div className="w-full min-w-0 max-w-xl">
              <label className={fieldLabelClass}>Show on calendar *</label>
              <select
                value={formDisplayCalendarId}
                onChange={(e) => setFormDisplayCalendarId(e.target.value)}
                className={fieldSelectClass}
              >
                {(isAdmin || !editingId) && <option value="">Select a calendar column</option>}
                {hostCalendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {isAdmin && (
                <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/90 p-3">
                  {!entitlementLoaded ? (
                    <p className="text-xs text-slate-500">Loading plan limits…</p>
                  ) : canAddCalendar ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setShowInlineCalendarForm((v) => !v);
                          setInlineCalendarError(null);
                        }}
                        className="inline-flex w-full items-center justify-center rounded-lg border border-brand-200/90 bg-white px-3.5 py-2.5 text-sm font-semibold text-brand-700 shadow-sm transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out hover:border-brand-400 hover:bg-brand-50 hover:text-brand-800 hover:shadow-md active:scale-[0.98] active:border-brand-500 active:bg-brand-100 active:shadow-inner motion-reduce:transition-colors motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                      >
                        Add calendar
                      </button>
                      {showInlineCalendarForm && (
                        <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                          <label className="block text-xs font-medium text-slate-600">New calendar name</label>
                          <input
                            type="text"
                            value={newCalendarName}
                            onChange={(e) => setNewCalendarName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                void handleCreateInlineCalendar();
                              }
                            }}
                            placeholder="e.g. Room 1"
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                          />
                          {inlineCalendarError && (
                            <p className="text-xs text-red-600">{inlineCalendarError}</p>
                          )}
                          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                            <button
                              type="button"
                              onClick={() => void handleCreateInlineCalendar()}
                              disabled={creatingCalendar}
                              className="min-h-10 w-full rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50 sm:w-auto"
                            >
                              {creatingCalendar ? 'Creating…' : 'Create and select'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setShowInlineCalendarForm(false);
                                setNewCalendarName('');
                                setInlineCalendarError(null);
                              }}
                              disabled={creatingCalendar}
                              className="min-h-10 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:w-auto"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                      <p className="mt-2 text-xs text-slate-500">
                        Creates a team calendar column here and selects it for this resource. You can refine its weekly
                        hours later in Calendar availability.
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-amber-950">
                      <CalendarLimitMessage
                        entitlement={calendarEntitlement}
                        linkClassName="font-medium text-brand-700 underline hover:text-brand-800"
                      />
                    </p>
                  )}
                </div>
              )}
              <p className={fieldHintClass}>
                Bookings and availability blocks appear on that column. Two resources can share a column only if weekly
                hours do not overlap.
                {isAdmin ? ' Staff only manage resources on calendars they control.' : ''}
              </p>
            </div>
            </ResourceFormSection>

            <ResourceFormSection
              step={3}
              title="Booking rules"
              description="Slot grid, duration limits, and when guests can book online."
            >
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                  Start times every (minutes)
                  <HelpTooltip icon="?" maxWidth={320} content={RESOURCE_SLOT_INTERVAL_HELP} />
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={formSlotStr}
                  onChange={(e) => setFormSlotStr(e.target.value.replace(/[^0-9]/g, ''))}
                  onBlur={() => {
                    if (!formAdvancedMinBooking) {
                      const slot = parseInt(formSlotStr.trim(), 10);
                      if (Number.isFinite(slot) && slot >= SLOT_INTERVAL_MIN && slot <= SLOT_INTERVAL_MAX) {
                        setFormMinStr(
                          String(syncedMinBookingMinutesFromSlot(slot, MIN_BOOKING_MIN)),
                        );
                      }
                    }
                  }}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  {SLOT_INTERVAL_MIN}–{SLOT_INTERVAL_MAX} minutes.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Longest booking (minutes)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={formMaxStr}
                  onChange={(e) => setFormMaxStr(e.target.value.replace(/[^0-9]/g, ''))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  {MAX_BOOKING_MIN}–{MAX_BOOKING_MAX} minutes.
                </p>
              </div>
            </div>
            <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/80 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <label className="mb-0 flex items-center gap-1.5 text-xs font-medium text-slate-600 sm:mb-1">
                  Shortest booking (minutes)
                  <HelpTooltip icon="?" maxWidth={320} content={RESOURCE_MIN_BOOKING_HELP} />
                </label>
                <label className="flex cursor-pointer items-start gap-2 text-[11px] font-medium leading-snug text-slate-600 sm:items-center">
                  <input
                    type="checkbox"
                    checked={formAdvancedMinBooking}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setFormAdvancedMinBooking(on);
                      if (!on) {
                        const slot = parseInt(formSlotStr.trim(), 10);
                        if (Number.isFinite(slot) && slot >= SLOT_INTERVAL_MIN && slot <= SLOT_INTERVAL_MAX) {
                          setFormMinStr(
                            String(syncedMinBookingMinutesFromSlot(slot, MIN_BOOKING_MIN)),
                          );
                        } else {
                          setFormMinStr(String(DEFAULT_RESOURCE_MIN_BOOKING_MINUTES));
                        }
                      }
                    }}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  Advanced: longer minimum than start-time step
                </label>
              </div>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={formMinStr}
                disabled={!formAdvancedMinBooking}
                onChange={(e) => setFormMinStr(e.target.value.replace(/[^0-9]/g, ''))}
                className="mt-1.5 w-full max-w-xs rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-600"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                {formAdvancedMinBooking
                  ? `${MIN_BOOKING_MIN}–${MIN_BOOKING_MAX} minutes; must be at least the start-time step.`
                  : `Matches the start-time step (minimum ${MIN_BOOKING_MIN} minutes).`}
              </p>
            </div>
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
              <p className="mb-2 text-xs font-medium text-slate-700">Guest online booking</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Max advance (days)</label>
                  <NumericInput
                    min={1}
                    max={365}
                    value={formMaxAdvanceDays}
                    onChange={setFormMaxAdvanceDays}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Min notice (hours)</label>
                  <NumericInput
                    min={0}
                    max={168}
                    value={formMinNoticeHours}
                    onChange={setFormMinNoticeHours}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Cancellation notice (hours)</label>
                  <NumericInput
                    min={0}
                    max={168}
                    value={formCancellationHours}
                    onChange={setFormCancellationHours}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={formAllowSameDay}
                      onChange={(e) => setFormAllowSameDay(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Allow same-day bookings
                  </label>
                </div>
              </div>
            </div>
            </ResourceFormSection>

            <ResourceFormSection step={4} title="Pricing & payment" description="Slot price and how guests pay when booking online.">
              <div className="w-full min-w-0 max-w-md">
                <label className={fieldLabelClass}>
                  {formSlotMinutesParsed != null
                    ? `Price per ${formSlotMinutesParsed}-minute step (${sym})`
                    : `Price per start-time step (${sym})`}
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={formPrice}
                  onChange={(e) => setFormPrice(e.target.value)}
                  placeholder="Leave blank for free"
                  className={fieldInputClass}
                />
                <p className={fieldHintClass}>
                  Charged per step of your start-time grid (set in Booking rules above).
                </p>
              </div>
              <div className="mt-4">
              <ResourcePaymentCards
                value={formPaymentReq}
                onChange={setFormPaymentReq}
                sym={sym}
                depositValue={formDeposit}
                onDepositChange={setFormDeposit}
                stripeConnected={stripeConnected}
              />
              <StripePaymentWarning
                stripeConnected={stripeConnected}
                requiresOnlinePayment={formPaymentReq === 'deposit' || formPaymentReq === 'full_payment'}
              />
              </div>
              <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={formActive}
                  onChange={(e) => setFormActive(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                Active (bookable by guests)
              </label>
            </ResourceFormSection>

            <ResourceFormSection
              step={5}
              title="Weekly hours"
              description="Guests can only book when resource, venue, and host calendar hours all overlap."
            >
            {formCalendarRestrictionWarning ? (
              <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                {formCalendarRestrictionWarning}
              </div>
            ) : null}
            <WeekHoursEditor
              days={DAY_LABELS}
              hours={formHours}
              matchCalendar={formMatchCalendarHours}
              matchLabel={
                formMatchCalendarHours
                  ? formDisplayCalendarId
                    ? 'Matching calendar hours'
                    : 'Will match selected calendar'
                  : 'Match selected calendar hours'
              }
              onToggleMatchCalendar={() => {
                const next = !formMatchCalendarHours;
                setFormMatchCalendarHours(next);
                if (next && selectedHostCalendar) {
                  setFormHours(weekHoursFromJSON(selectedHostCalendar.working_hours));
                }
              }}
              onChange={(key, patch) => {
                setFormMatchCalendarHours(false);
                setFormHours((h) => ({ ...h, [key]: { ...h[key]!, ...patch } }));
              }}
            />
            </ResourceFormSection>

            <ResourceFormSection
              step={6}
              title="Date exceptions"
              description="Closures or special hours on specific dates. Tap the calendar to select a day or range."
            >

            {exceptionEditingDay ? (
              <div className="mt-4 rounded-xl border border-slate-300 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Editing</p>
                    <p className="text-sm font-medium text-slate-900">{exceptionEditingDay}</p>
                  </div>
                  <button
                    type="button"
                    onClick={cancelExceptionEdit}
                    className="text-xs font-medium text-slate-600 hover:text-slate-900"
                  >
                    Close
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end lg:grid-cols-4">
                  <div className="min-w-0 sm:col-span-2 lg:col-span-1">
                    <label className="mb-1 block text-xs text-slate-600">Closure or amended hours</label>
                    <select
                      value={formExceptionType}
                      onChange={(e) => setFormExceptionType(e.target.value as 'closed' | 'custom')}
                      className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                    >
                      <option value="closed">Closed (not open)</option>
                      <option value="custom">Amended hours (custom times)</option>
                    </select>
                  </div>
                  {formExceptionType === 'custom' && (
                    <>
                      <div className="min-w-0">
                        <label className="mb-1 block text-xs text-slate-600">From</label>
                        <input
                          type="time"
                          value={formExceptionStart}
                          onChange={(e) => setFormExceptionStart(e.target.value)}
                          className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="mb-1 block text-xs text-slate-600">To</label>
                        <input
                          type="time"
                          value={formExceptionEnd}
                          onChange={(e) => setFormExceptionEnd(e.target.value)}
                          className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                        />
                      </div>
                    </>
                  )}
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <button
                    type="button"
                    onClick={saveExceptionEdit}
                    className="min-h-10 w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 sm:w-auto"
                  >
                    Save changes
                  </button>
                  <button
                    type="button"
                    onClick={() => removeException(exceptionEditingDay)}
                    className="min-h-10 w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 sm:w-auto"
                  >
                    Remove this day
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                <p className="text-xs font-semibold text-slate-700">Add closure or amended hours</p>
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end lg:grid-cols-4">
                  <div className="min-w-0 sm:col-span-2 lg:col-span-1">
                    <label className="mb-1 block text-xs text-slate-600">Closure or amended hours</label>
                    <select
                      value={formExceptionType}
                      onChange={(e) => setFormExceptionType(e.target.value as 'closed' | 'custom')}
                      className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                    >
                      <option value="closed">Closed (not open)</option>
                      <option value="custom">Amended hours (custom times)</option>
                    </select>
                  </div>
                  {formExceptionType === 'custom' && (
                    <>
                      <div className="min-w-0">
                        <label className="mb-1 block text-xs text-slate-600">From</label>
                        <input
                          type="time"
                          value={formExceptionStart}
                          onChange={(e) => setFormExceptionStart(e.target.value)}
                          className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="mb-1 block text-xs text-slate-600">To</label>
                        <input
                          type="time"
                          value={formExceptionEnd}
                          onChange={(e) => setFormExceptionEnd(e.target.value)}
                          className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                        />
                      </div>
                    </>
                  )}
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <button
                    type="button"
                    onClick={applyExceptionRange}
                    disabled={!exceptionRangeStart}
                    className="min-h-10 w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50 sm:w-auto"
                  >
                    Apply to calendar selection
                  </button>
                  <button
                    type="button"
                    onClick={clearExceptionRangeSelection}
                    className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:w-auto"
                  >
                    Clear selection
                  </button>
                  {exceptionRangeStart ? (
                    <span className="text-xs text-slate-500 sm:ml-1">
                      {exceptionRangeEnd
                        ? `${exceptionRangeStart} → ${exceptionRangeEnd}`
                        : `${exceptionRangeStart} (single day — tap Apply)`}
                    </span>
                  ) : null}
                </div>
              </div>
            )}

            <div className="mt-4 w-full min-w-0 max-w-2xl">
              <ResourceExceptionsCalendar
                year={exceptionMonth.year}
                month={exceptionMonth.month}
                onPrevMonth={exceptionPrevMonth}
                onNextMonth={exceptionNextMonth}
                exceptions={formExceptions}
                rangeStart={exceptionRangeStart}
                rangeEnd={exceptionRangeEnd}
                editingDay={exceptionEditingDay}
                onDayClick={handleExceptionDayClick}
              />
            </div>

            </ResourceFormSection>

            <FormStickyActions
              saving={saving}
              saveLabel={saving ? 'Saving…' : editingId ? 'Save changes' : 'Create resource'}
              error={error}
              onCancel={() => setShowForm(false)}
              onSave={() => void handleSave()}
            />
          </div>
        ) : selected ? (
          <div className="min-w-0 space-y-4">
            <SectionCard elevated>
              <SectionCard.Header
                eyebrow="Resource detail"
                title={selected.name}
                description={
                  selected.resource_type ? (
                    <span>{selected.resource_type}</span>
                  ) : (
                    <span className="text-slate-500">
                      {hostCalendars.find((c) => c.id === selected.display_on_calendar_id)?.name ?? 'No calendar assigned'}
                    </span>
                  )
                }
                right={
                  <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
                    <button
                      type="button"
                      onClick={openResourceBookingDialog}
                      className="min-h-10 w-full rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 sm:w-auto"
                    >
                      + Book this resource
                    </button>
                    <Pill variant={selected.is_active ? 'success' : 'neutral'} size="sm" className="w-fit">
                      {selected.is_active ? 'Active' : 'Inactive'}
                    </Pill>
                    {(isAdmin ||
                      (selected.display_on_calendar_id !== null &&
                        linkedPractitionerIds.includes(selected.display_on_calendar_id))) ? (
                      <DashboardEntityRowActions
                        className="w-full justify-stretch sm:w-auto sm:justify-end [&>button]:min-h-10 [&>button]:flex-1 sm:[&>button]:flex-initial"
                        onEdit={() => openEdit(selected)}
                        onDelete={() => requestDeleteResource(selected.id)}
                      />
                    ) : null}
                  </div>
                }
              />
            </SectionCard>

            {!selected.display_on_calendar_id ? (
              <div
                className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
                role="alert"
              >
                <p className="font-medium text-amber-900">Not visible on team calendar</p>
                <p className="mt-1">
                  Choose a <strong>Display on calendar</strong> host so resource bookings appear on{' '}
                  <Link href="/dashboard/calendar" className="font-medium text-brand-600 underline hover:text-brand-800">
                    Calendar
                  </Link>
                  . Until then, manage bookings here on the timeline only.
                </p>
                <button
                  type="button"
                  onClick={() => openEdit(selected)}
                  className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 sm:w-auto"
                >
                  Set host calendar
                </button>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
              <StatTile
                label="Start-time step"
                value={formatDuration(selected.slot_interval_minutes)}
                color="brand"
              />
              <StatTile label="Shortest booking" value={formatDuration(selected.min_booking_minutes)} color="brand" />
              <StatTile label="Longest booking" value={formatDuration(selected.max_booking_minutes)} color="brand" />
              <StatTile
                label={`Price / ${selected.slot_interval_minutes} min`}
                value={selected.price_per_slot_pence != null ? formatPrice(selected.price_per_slot_pence) : 'Free'}
                color="brand"
              />
              <StatTile
                label="Guest payment"
                value={resourcePaymentSummary(selected, formatPrice)}
                color="slate"
              />
            </div>

            <SectionCard>
              <SectionCard.Header title="Weekly availability" />
              <SectionCard.Body className="!pt-0">
              <div className="mt-3 space-y-1.5">
                {DAY_LABELS.map((d) => {
                  const ranges = selected.availability_hours?.[d.key];
                  const open = ranges && ranges.length > 0;
                  return (
                    <div key={d.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm sm:flex-nowrap sm:items-center">
                      <span className="w-12 shrink-0 font-medium text-slate-600 sm:w-20">{d.label.slice(0, 3)}</span>
                      {open ? (
                        <span className="text-slate-900">
                          {ranges![0].start} &ndash; {ranges![0].end}
                        </span>
                      ) : (
                        <span className="text-slate-400">Closed</span>
                      )}
                    </div>
                  );
                })}
              </div>
              {selected.availability_exceptions && Object.keys(selected.availability_exceptions).length > 0 && (
                <>
                  <h4 className="mt-4 text-xs font-semibold text-slate-700">Date exceptions</h4>
                  <ul className="mt-1.5 space-y-1 text-sm">
                    {Object.entries(selected.availability_exceptions)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([dateKey, val]) => (
                        <li key={dateKey} className="text-slate-600">
                          <span className="font-medium">{dateKey}:</span>{' '}
                          {'closed' in val ? 'Closed' : `${val.periods[0].start} \u2013 ${val.periods[0].end}`}
                        </li>
                      ))}
                  </ul>
                </>
              )}
              </SectionCard.Body>
            </SectionCard>

            <SectionCard>
              <SectionCard.Header title="Bookings" />
              <SectionCard.Body className="!pt-0 sm:!pt-0">
              <BookingsDateToolbar
                dateIso={bookingsDate}
                onPrev={() =>
                  setBookingsDate((d) => {
                    const t = new Date(`${d}T12:00:00`);
                    t.setDate(t.getDate() - 1);
                    return formatYmdLocal(t);
                  })
                }
                onNext={() =>
                  setBookingsDate((d) => {
                    const t = new Date(`${d}T12:00:00`);
                    t.setDate(t.getDate() + 1);
                    return formatYmdLocal(t);
                  })
                }
                onToday={() => setBookingsDate(formatYmdLocal(new Date()))}
                onDateChange={setBookingsDate}
              />
              {bookingsLoading ? (
                <div className="mt-4 space-y-2" role="status" aria-label="Loading bookings">
                  {[1, 2, 3].map((i) => (
                    <Skeleton.Block key={i} className="h-14" />
                  ))}
                </div>
              ) : bookings.length === 0 ? (
                <EmptyState
                  title="No bookings on this date"
                  description="Try another day using the arrows or date picker above."
                />
              ) : (
                <ul className="mt-3 space-y-2">
                  {bookings.map((b) => {
                    const payLine = resourceBookingPaymentLine(b, formatPrice);
                    const timeLabel = b.booking_time.slice(0, 5);
                    const subtitle = [
                      b.booking_end_time ? `Until ${b.booking_end_time.slice(0, 5)}` : '',
                      payLine ?? '',
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <li key={b.id}>
                        <ScheduleRow
                          timeLabel={timeLabel}
                          title={b.guest_name}
                          subtitle={subtitle || undefined}
                          stripClassName={bookingScheduleStripClass(b.status)}
                          onClick={() => setDetailBookingId(b.id)}
                          trailing={
                            <Pill variant={resourceBookingStatusVariant(b.status)} size="sm">
                              {b.status}
                            </Pill>
                          }
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
              </SectionCard.Body>
            </SectionCard>
          </div>
        ) : (
          <div className="flex min-h-[30vh] items-center justify-center">
            <EmptyState
              title={resources.length > 0 ? 'Select a resource' : 'Create a resource'}
              description={
                resources.length > 0
                  ? 'Choose a resource from the list to view availability and bookings.'
                  : 'Add your first bookable resource to start taking slot reservations.'
              }
              action={
                canManageResources ? (
                  <button
                    type="button"
                    onClick={openCreate}
                    className="text-sm font-semibold text-brand-600 hover:text-brand-800"
                  >
                    Create your first resource
                  </button>
                ) : undefined
              }
            />
          </div>
        )}
      </div>
      </div>

      {resourceToDelete && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-[2px]"
          onClick={() => {
            if (!deleteResourceBusy) setResourceToDelete(null);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-resource-title"
            aria-describedby="delete-resource-desc"
            className="max-h-[min(90dvh,90vh)] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="delete-resource-title" className="text-base font-semibold text-slate-900">
              Delete this resource?
            </h3>
            <p id="delete-resource-desc" className="mt-2 text-sm text-slate-600">
              <span className="font-medium text-slate-800">{resourceToDelete.name}</span> will be removed from your
              venue. Upcoming bookings linked to this resource cannot be deleted this way; resolve them first if
              removal is blocked. This cannot be undone.
            </p>
            {deleteResourceModalError ? (
              <div
                role="alert"
                className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              >
                {deleteResourceModalError}
              </div>
            ) : null}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <button
                type="button"
                onClick={() => setResourceToDelete(null)}
                disabled={deleteResourceBusy}
                className="min-h-10 w-full rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:w-auto"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDeleteResource()}
                disabled={deleteResourceBusy}
                className="min-h-10 w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50 sm:w-auto"
              >
                {deleteResourceBusy ? 'Deleting…' : 'Delete resource'}
              </button>
            </div>
          </div>
        </div>
      )}

      {detailBookingId ? (
        <BookingDetailPanel
          key={detailBookingId}
          bookingId={detailBookingId}
          venueId={venueId}
          venueCurrency={currency}
          initialSnapshot={detailBookingSnapshot}
          presentation="drawer"
          onClose={() => setDetailBookingId(null)}
          onUpdated={() => {
            void fetchResourceBookings();
          }}
        />
      ) : null}

      {showResourceBooking && selectedId ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setShowResourceBooking(false);
            }
          }}
          title={selected ? `Book ${selected.name}` : 'Book resource'}
          size="lg"
          contentClassName="max-h-[min(92dvh,92vh)] max-w-xl overflow-y-auto"
        >
          {resourceBookingVenueError ? (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {resourceBookingVenueError}
            </div>
          ) : resourceBookingVenue ? (
            <ResourceBookingFlow
              key={`${selectedId}-${resourceBookingSessionKey}`}
              venue={resourceBookingVenue}
              bookingAudience="staff"
              staffBookingSource="phone"
              onBookingCreated={() => void fetchResourceBookings()}
              onClose={() => setShowResourceBooking(false)}
              initialResourceId={selectedId}
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
    </div>
  );
}
