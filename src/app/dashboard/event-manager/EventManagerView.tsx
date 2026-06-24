'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { BookingDetailPanel } from '@/app/dashboard/bookings/BookingDetailPanel';
import { bookingDetailPanelSnapshotFromListRow } from '@/lib/booking/booking-detail-from-row';
import {
  EXP_BOOKING_AMBER_ATTN,
  EXP_BOOKING_SOFT,
  EXP_BOOKING_SPIN_AM,
  EXP_BOOKING_SPIN_NA,
} from '@/app/dashboard/bookings/expanded-booking-toolbar-classes';
import { StripePaymentWarning } from '@/components/dashboard/StripePaymentWarning';
import { useToast } from '@/components/ui/Toast';
import { normalizeTimeToHhMm, validateStartEndTimes } from '@/lib/experience-events/experience-event-validation';
import { formatZodFlattenedError } from '@/lib/experience-events/experience-event-zod';
import {
  computeEventAnalytics,
  downloadCsvFile,
  escapeCsvCell,
  isValidIsoDate,
  localTodayIso,
  MAX_EVENT_OCCURRENCES,
  normaliseEventDates,
  previewWeeklyOccurrences,
  type EventAnalytics,
} from './event-manager-utils';
import { ConfirmDialog } from '@/components/ui/primitives/ConfirmDialog';
import { canAddCalendarColumn, useCalendarEntitlement } from '@/hooks/use-calendar-entitlement';
import { CalendarLimitMessage } from '@/components/dashboard/CalendarLimitMessage';
import { NumericInput } from '@/components/ui/NumericInput';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { DashboardEntityRowActions } from '@/components/ui/dashboard/DashboardEntityRowActions';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { Pill, type PillVariant } from '@/components/ui/dashboard/Pill';
import { currencySymbolFromCode } from '@/lib/money/currency-symbol';
import { EmptyState } from '@/components/ui/dashboard/EmptyState';
import { StackedList } from '@/components/ui/dashboard/StackedList';
import { DashboardCardGridSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';
import { useVenuePostgresLiveSync } from '@/lib/realtime/useVenuePostgresLiveSync';

interface TicketType {
  id: string;
  name: string;
  price_pence: number;
  capacity: number | null;
  sort_order: number;
}

interface ExperienceEvent {
  id: string;
  name: string;
  description: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  image_url: string | null;
  is_active: boolean;
  calendar_id: string | null;
  ticket_types: TicketType[];
  max_advance_booking_days?: number;
  min_booking_notice_hours?: number;
  cancellation_notice_hours?: number;
  allow_same_day_booking?: boolean;
  payment_requirement?: 'none' | 'deposit' | 'full_payment';
  deposit_amount_pence?: number | null;
}

interface AttendeeRow {
  booking_id: string;
  status: string;
  party_size: number;
  deposit_amount_pence: number | null;
  deposit_status: string | null;
  booking_date: string;
  booking_time: string;
  client_arrived_at: string | null;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  ticket_lines?: Array<{ label: string; quantity: number; unit_price_pence: number }>;
}

interface TicketTypeDraft {
  /**
   * Existing tier's `event_ticket_types.id`, round-tripped so the API can UPSERT
   * by id instead of matching on name. Absent for tiers added in the editor (they
   * are inserted fresh). Pairs with the server `syncEventTicketTypes` upsert —
   * without it, an edited tier orphans its `booking_ticket_lines` and loses
   * per-tier capacity (CDE review §5.3, finding C3).
   */
  id?: string;
  name: string;
  /** Price in whole pounds (NumericInput, decimals allowed); converted to pence on save. */
  price_pounds: number;
  /** Per-tier cap; `null` = no limit. */
  capacity: number | null;
}

type ScheduleMode = 'single' | 'weekly' | 'custom';

interface EventFormState {
  name: string;
  description: string;
  event_date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  image_url: string;
  ticket_types: TicketTypeDraft[];
  scheduleMode: ScheduleMode;
  recurrenceUntil: string;
  /** Picked custom dates (ISO `YYYY-MM-DD`), deduped + validated as chips are added. */
  customDates: string[];
  calendar_id: string;
  max_advance_booking_days: number;
  min_booking_notice_hours: number;
  cancellation_notice_hours: number;
  allow_same_day_booking: boolean;
  payment_requirement: 'none' | 'deposit' | 'full_payment';
  deposit_pounds: string;
}

function attendeeBookingDetailSnapshot(attendee: AttendeeRow, event: ExperienceEvent) {
  return bookingDetailPanelSnapshotFromListRow({
    id: attendee.booking_id,
    booking_date: attendee.booking_date || event.event_date,
    booking_time: attendee.booking_time || event.start_time,
    booking_end_time: event.end_time,
    party_size: attendee.party_size,
    status: attendee.status,
    guest_name: attendee.guest_name ?? undefined,
    guest_email: attendee.guest_email,
    guest_phone: attendee.guest_phone,
    deposit_status: attendee.deposit_status ?? undefined,
    service_name: event.name,
    booking_model: 'event_ticket',
    experience_event_id: event.id,
    inferred_booking_model: 'event_ticket',
  });
}

function canShowAttendeeArrivedActions(status: string): boolean {
  return status === 'Pending' || status === 'Booked' || status === 'Confirmed';
}

function EventAttendeeArrivedActions({
  attendee,
  busy,
  fullWidth,
  onToggle,
}: {
  attendee: AttendeeRow;
  busy: boolean;
  fullWidth?: boolean;
  onToggle: (arrived: boolean) => void;
}) {
  if (!canShowAttendeeArrivedActions(attendee.status)) return null;
  const arrived = Boolean(attendee.client_arrived_at);
  const wrapClass = fullWidth ? 'mt-3 flex w-full justify-stretch' : 'flex justify-end';

  if (!arrived) {
    return (
      <div className={wrapClass} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          disabled={busy}
          onClick={() => onToggle(true)}
          className={`${EXP_BOOKING_AMBER_ATTN} ${fullWidth ? 'w-full' : ''}`}
        >
          {busy ? <span className={EXP_BOOKING_SPIN_AM} aria-hidden /> : null}
          Arrived
        </button>
      </div>
    );
  }

  return (
    <div className={wrapClass} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        disabled={busy}
        onClick={() => onToggle(false)}
        className={`${EXP_BOOKING_SOFT} ${fullWidth ? 'w-full' : ''}`}
      >
        {busy ? <span className={EXP_BOOKING_SPIN_NA} aria-hidden /> : null}
        Clear
      </button>
    </div>
  );
}

function attendeeStatusVariant(status: string): PillVariant {
  const s = status.toLowerCase();
  if (s.includes('cancel')) return 'danger';
  if (s.includes('confirm') || s.includes('paid') || s.includes('complete')) return 'success';
  if (s.includes('pending') || s.includes('hold')) return 'warning';
  return 'neutral';
}

const BLANK_EVENT: EventFormState = {
  name: '',
  description: '',
  event_date: '',
  start_time: '10:00',
  end_time: '12:00',
  capacity: 20,
  image_url: '',
  ticket_types: [{ name: 'General Admission', price_pounds: 0, capacity: null }],
  scheduleMode: 'single',
  recurrenceUntil: '',
  customDates: [],
  calendar_id: '',
  max_advance_booking_days: 90,
  min_booking_notice_hours: 1,
  cancellation_notice_hours: 48,
  allow_same_day_booking: true,
  payment_requirement: 'none',
  deposit_pounds: '',
};

export function EventManagerView({
  venueId,
  isAdmin,
  linkedPractitionerIds = [],
  currency = 'GBP',
  publicBookingUrl,
  stripeConnected = false,
}: {
  venueId: string;
  isAdmin: boolean;
  linkedPractitionerIds?: string[];
  currency?: string;
  publicBookingUrl: string;
  stripeConnected?: boolean;
}) {
  const { addToast } = useToast();
  const sym = currencySymbolFromCode(currency);

  function formatPrice(pence: number): string {
    return `${sym}${(pence / 100).toFixed(2)}`;
  }

  const [events, setEvents] = useState<ExperienceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [arrivedBusy, setArrivedBusy] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ExperienceEvent | null>(null);
  const [attendees, setAttendees] = useState<AttendeeRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailBookingId, setDetailBookingId] = useState<string | null>(null);
  const [detailBookingAnchor, setDetailBookingAnchor] = useState<{ x: number; y: number } | null>(null);

  // Event CRUD state
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventForm, setEventForm] = useState<EventFormState>({ ...BLANK_EVENT });
  const [eventSaving, setEventSaving] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const [eventToDelete, setEventToDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleteEventBusy, setDeleteEventBusy] = useState(false);
  const [deleteEventModalError, setDeleteEventModalError] = useState<string | null>(null);
  const [showCancelEventConfirm, setShowCancelEventConfirm] = useState(false);
  // Draft date in the custom-dates picker (added as a chip on "Add").
  const [customDateDraft, setCustomDateDraft] = useState('');
  const [teamCalendars, setTeamCalendars] = useState<Array<{ id: string; name: string; calendar_type?: string }>>(
    [],
  );
  useEffect(() => {
    setDetailBookingId(null);
    setDetailBookingAnchor(null);
  }, [selectedId]);

  const detailBookingSnapshot = useMemo(() => {
    if (!detailBookingId || !detail) return null;
    const attendee = attendees.find((a) => a.booking_id === detailBookingId);
    if (!attendee) return null;
    return attendeeBookingDetailSnapshot(attendee, detail);
  }, [detailBookingId, detail, attendees]);

  // Per-event analytics: tickets sold by tier, revenue, fill % (finding 21).
  // Cancelled / No-show bookings are already excluded by the attendees route, and
  // computeEventAnalytics excludes them again defensively.
  const analytics = useMemo(() => {
    if (!detail) return null;
    return computeEventAnalytics(attendees, {
      capacity: detail.capacity,
      tierNames: detail.ticket_types.map((t) => t.name),
    });
  }, [detail, attendees]);

  const openAttendeeBookingDetail = useCallback((attendee: AttendeeRow, e: MouseEvent) => {
    setDetailBookingId(attendee.booking_id);
    setDetailBookingAnchor({ x: e.clientX, y: e.clientY });
  }, []);

  useEffect(() => {
    if (!showEventForm) return;
    let cancelled = false;
    void fetch('/api/venue/practitioners?roster=1')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.practitioners) return;
        setTeamCalendars(
          (d.practitioners as Array<{ id: string; name: string; calendar_type?: string }>)
            .filter((p) => p.calendar_type !== 'resource')
            .filter((p) => isAdmin || linkedPractitionerIds.includes(p.id)),
        );
      })
      .catch((e) => {
        console.error('[EventManagerView] /api/venue/practitioners load failed:', e);
        setTeamCalendars([]);
      });
    return () => {
      cancelled = true;
    };
  }, [showEventForm, isAdmin, linkedPractitionerIds]);

  const [showAddCalendarModal, setShowAddCalendarModal] = useState(false);
  const [newCalendarName, setNewCalendarName] = useState('');
  const [addCalendarSubmitting, setAddCalendarSubmitting] = useState(false);
  const [addCalendarModalError, setAddCalendarModalError] = useState<string | null>(null);

  const {
    entitlement: calendarEntitlement,
    entitlementLoaded,
    refresh: refreshCalendarEntitlement,
  } = useCalendarEntitlement(isAdmin);
  const canAddCalendar = canAddCalendarColumn(calendarEntitlement, entitlementLoaded);

  useEffect(() => {
    if (entitlementLoaded && !canAddCalendar) {
      setShowAddCalendarModal(false);
    }
  }, [entitlementLoaded, canAddCalendar]);

  const submitInlineNewCalendar = useCallback(async () => {
    const name = newCalendarName.trim();
    if (!name) {
      setAddCalendarModalError('Enter a display name for the calendar.');
      return;
    }
    setAddCalendarSubmitting(true);
    setAddCalendarModalError(null);
    try {
      const res = await fetch('/api/venue/practitioners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          calendar_type: 'practitioner',
          is_active: true,
        }),
      });
      const json = (await res.json()) as {
        id?: string;
        name?: string;
        error?: string;
        upgrade_required?: boolean;
      };
      if (!res.ok) {
        if (res.status === 403 && json.upgrade_required) {
          void refreshCalendarEntitlement();
          setAddCalendarModalError(json.error ?? 'Calendar limit reached for your plan.');
        } else {
          setAddCalendarModalError(json.error ?? 'Could not create calendar');
        }
        return;
      }
      const newId = json.id;
      const newName = typeof json.name === 'string' ? json.name : name;
      if (!newId) {
        setAddCalendarModalError('Calendar was created but no id was returned. Refresh the page.');
        return;
      }
      setTeamCalendars((prev) => {
        if (prev.some((c) => c.id === newId)) return prev;
        return [...prev, { id: newId, name: newName }].sort((a, b) => a.name.localeCompare(b.name));
      });
      setEventForm((f) => ({ ...f, calendar_id: newId }));
      setNewCalendarName('');
      setShowAddCalendarModal(false);
      addToast(`Calendar "${newName}" created and selected.`, 'success');
      void refreshCalendarEntitlement();
    } catch {
      setAddCalendarModalError('Could not create calendar');
    } finally {
      setAddCalendarSubmitting(false);
    }
  }, [newCalendarName, addToast, refreshCalendarEntitlement]);

  const fetchEvents = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) {
      setLoading(true);
    }
    setListError(null);
    try {
      const res = await fetch('/api/venue/experience-events');
      const data = (await res.json()) as { events?: ExperienceEvent[]; error?: string };
      if (!res.ok) {
        setListError(data.error ?? `Could not load events (${res.status})`);
        setEvents([]);
        return;
      }
      setEvents(data.events ?? []);
    } catch {
      setListError('Network error while loading events.');
      setEvents([]);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  const loadDetail = useCallback(async (id: string, opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) {
      setDetailLoading(true);
    }
    setDetailError(null);
    try {
      const [evRes, attRes] = await Promise.all([
        fetch(`/api/venue/experience-events/${id}`),
        fetch(`/api/venue/experience-events/${id}/attendees`),
      ]);
      const evJson = await evRes.json();
      const attJson = await attRes.json();
      if (!evRes.ok) {
        setDetailError(evJson.error ?? 'Failed to load event');
        setDetail(null);
        setAttendees([]);
        return;
      }
      if (!attRes.ok) {
        setDetailError(attJson.error ?? 'Failed to load attendees');
        setDetail(evJson as ExperienceEvent);
        setAttendees([]);
        return;
      }
      setDetail(evJson as ExperienceEvent);
      setAttendees((attJson.attendees ?? []) as AttendeeRow[]);
    } catch {
      setDetailError('Failed to load event');
      setDetail(null);
      setAttendees([]);
    } finally {
      if (!silent) {
        setDetailLoading(false);
      }
    }
  }, []);

  const refreshEvents = useCallback(() => {
    void fetchEvents({ silent: true });
  }, [fetchEvents]);

  const refreshEventDetail = useCallback(() => {
    if (!selectedId) return;
    void loadDetail(selectedId, { silent: true });
  }, [loadDetail, selectedId]);

  const refreshEventsAndDetail = useCallback(() => {
    refreshEvents();
    refreshEventDetail();
  }, [refreshEvents, refreshEventDetail]);

  // --- Realtime detail refetch: debounced + relevance-filtered (finding 20) ---
  // The shared `onRefresh` (used by the experience_events subscription and the
  // poll fallback) refreshes the list + open detail. But a venue-wide `bookings`
  // change previously also forced a full event+attendees refetch on EVERY ping,
  // even for a booking on a different event. We give `bookings` its own handler
  // that (a) only refetches the OPEN event's detail, (b) skips when the changed
  // booking provably belongs to a different event, and (c) debounces bursts.
  const selectedIdRef = useRef<string | null>(null);
  const attendeeBookingIdsRef = useRef<Set<string>>(new Set());
  const detailRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    attendeeBookingIdsRef.current = new Set(attendees.map((a) => a.booking_id));
  }, [attendees]);
  useEffect(() => {
    return () => {
      if (detailRefreshTimerRef.current) clearTimeout(detailRefreshTimerRef.current);
    };
  }, []);

  const scheduleRelevantDetailRefresh = useCallback(
    (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
      const openId = selectedIdRef.current;
      if (!openId) return; // No detail open → nothing to refetch.

      const row = payload.new ?? payload.old ?? {};
      const changedEventId =
        typeof row.experience_event_id === 'string' ? row.experience_event_id : undefined;
      const changedBookingId = typeof row.id === 'string' ? row.id : undefined;

      // Skip only when we can POSITIVELY attribute the change to a different event.
      // When the realtime payload omits experience_event_id (limited replica
      // identity), fall back to refetching unless the booking id is one we already
      // show for a different reason — i.e. err toward freshness, never staleness.
      if (changedEventId && changedEventId !== openId) {
        const alreadyInRoster = changedBookingId
          ? attendeeBookingIdsRef.current.has(changedBookingId)
          : false;
        if (!alreadyInRoster) return;
      }

      if (detailRefreshTimerRef.current) clearTimeout(detailRefreshTimerRef.current);
      detailRefreshTimerRef.current = setTimeout(() => {
        detailRefreshTimerRef.current = null;
        const id = selectedIdRef.current;
        if (id) void loadDetail(id, { silent: true });
      }, 300);
    },
    [loadDetail],
  );

  useVenuePostgresLiveSync({
    venueId,
    onRefresh: refreshEventsAndDetail,
    subscriptions: [
      { table: 'experience_events', filter: `venue_id=eq.${venueId}` },
      { table: 'bookings', filter: `venue_id=eq.${venueId}`, handler: scheduleRelevantDetailRefresh },
    ],
  });

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setAttendees([]);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const handleSaveEvent = async () => {
    if (!eventForm.name.trim()) {
      setEventError('Event name is required.');
      return;
    }
    const validTickets = eventForm.ticket_types.filter((tt) => tt.name.trim());
    if (validTickets.length === 0) {
      setEventError('At least one ticket type with a name is required.');
      return;
    }

    // Guard a paid event that still has a £0 tier (CDE review §5.3, finding 18).
    // A deposit / full-payment event with a free tier silently lets guests book
    // for nothing, so block the save with a specific message instead of relying on
    // the advisory help text under the payment options.
    if (eventForm.payment_requirement === 'deposit' || eventForm.payment_requirement === 'full_payment') {
      const freeTier = validTickets.find(
        (tt) => Math.round((tt.price_pounds || 0) * 100) <= 0,
      );
      if (freeTier) {
        setEventError(
          `"${freeTier.name.trim()}" is ${sym}0. ${
            eventForm.payment_requirement === 'deposit' ? 'Deposit' : 'Full payment'
          } events need every ticket priced above ${sym}0, or switch payment to "None".`,
        );
        return;
      }
    }

    let eventDateForPayload = eventForm.event_date;
    if (!editingEventId && eventForm.scheduleMode === 'custom') {
      const customDates = normaliseEventDates(eventForm.customDates);
      if (customDates.length === 0) {
        setEventError('Add at least one valid date for this event.');
        return;
      }
      if (customDates.length > MAX_EVENT_OCCURRENCES) {
        setEventError(`At most ${MAX_EVENT_OCCURRENCES} dates can be created at once.`);
        return;
      }
      eventDateForPayload = customDates[0];
    } else if (!eventForm.event_date) {
      setEventError('Event date is required.');
      return;
    }

    if (!eventForm.start_time || !eventForm.end_time) {
      setEventError('Start and end time are required.');
      return;
    }

    const timeErr = validateStartEndTimes(eventForm.start_time, eventForm.end_time);
    if (timeErr) {
      setEventError(timeErr);
      return;
    }

    if (!editingEventId && eventForm.scheduleMode === 'weekly') {
      if (!eventForm.recurrenceUntil) {
        setEventError('End date is required for weekly recurrence.');
        return;
      }
      if (eventForm.recurrenceUntil < eventForm.event_date) {
        setEventError('End date must be on or after the first occurrence date.');
        return;
      }
    }

    if (!editingEventId && !isAdmin && !String(eventForm.calendar_id ?? '').trim()) {
      setEventError('Choose a calendar column for this event.');
      return;
    }

    setEventSaving(true);
    setEventError(null);
    try {
      const depositPence =
        eventForm.payment_requirement === 'deposit' && eventForm.deposit_pounds.trim() !== ''
          ? Math.max(0, Math.round(parseFloat(eventForm.deposit_pounds) * 100))
          : null;

      const basePayload = {
        name: eventForm.name.trim(),
        description: eventForm.description.trim() || null,
        event_date: eventDateForPayload,
        start_time: normalizeTimeToHhMm(eventForm.start_time),
        end_time: normalizeTimeToHhMm(eventForm.end_time),
        capacity: eventForm.capacity,
        image_url: eventForm.image_url.trim() || null,
        ticket_types: validTickets.map((tt) => {
          const cap = tt.capacity != null && tt.capacity >= 1 ? tt.capacity : undefined;
          return {
            // Round-trip the tier id so the API upserts in place (finding C3); new
            // tiers have no id and are inserted fresh.
            ...(tt.id ? { id: tt.id } : {}),
            name: tt.name.trim(),
            price_pence: Math.round((tt.price_pounds || 0) * 100),
            ...(cap !== undefined ? { capacity: cap } : {}),
          };
        }),
        calendar_id: eventForm.calendar_id || null,
        max_advance_booking_days: eventForm.max_advance_booking_days,
        min_booking_notice_hours: eventForm.min_booking_notice_hours,
        cancellation_notice_hours: eventForm.cancellation_notice_hours,
        allow_same_day_booking: eventForm.allow_same_day_booking,
        payment_requirement: eventForm.payment_requirement,
        deposit_amount_pence: depositPence,
      };

      let postBody: Record<string, unknown> = { ...basePayload };
      if (!editingEventId) {
        if (eventForm.scheduleMode === 'weekly') {
          postBody = {
            ...basePayload,
            event_date: eventForm.event_date,
            schedule: { type: 'weekly' as const, until_date: eventForm.recurrenceUntil },
          };
        } else if (eventForm.scheduleMode === 'custom') {
          const dates = normaliseEventDates(eventForm.customDates);
          postBody = {
            ...basePayload,
            event_date: dates[0],
            schedule: { type: 'custom' as const, dates },
          };
        }
      }

      const res = editingEventId
        ? await fetch('/api/venue/experience-events', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: editingEventId, ...basePayload }),
          })
        : await fetch('/api/venue/experience-events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(postBody),
          });
      const json = (await res.json()) as {
        error?: string;
        details?: unknown;
        created?: number;
        upgrade_required?: boolean;
        current?: number;
        limit?: number;
      };
      if (!res.ok) {
        if (res.status === 403 && json.upgrade_required) {
          setEventError(
            `Plan limit reached: ${json.current ?? '?'} of ${json.limit ?? '?'} active events. Upgrade your plan or deactivate old events.`,
          );
          return;
        }
        if (res.status === 409) {
          setEventError(json.error ?? 'This time conflicts with another booking or block on that calendar.');
          return;
        }
        const hint = formatZodFlattenedError(json.details);
        const baseErr = json.error ?? 'Save failed';
        setEventError(hint ? `${baseErr}: ${hint}` : baseErr);
        return;
      }
      if (!editingEventId && typeof json.created === 'number' && json.created > 1) {
        addToast(`Created ${json.created} separate event rows (one per date).`, 'success');
      } else {
        addToast(editingEventId ? 'Event updated.' : 'Event created.', 'success');
      }
      setShowEventForm(false);
      setEditingEventId(null);
      setEventForm({ ...BLANK_EVENT });
      await fetchEvents();
    } catch {
      setEventError('Save failed');
    } finally {
      setEventSaving(false);
    }
  };

  const handleEditEvent = (event: ExperienceEvent) => {
    setEventForm({
      name: event.name,
      description: event.description ?? '',
      event_date: event.event_date,
      start_time: event.start_time.slice(0, 5),
      end_time: event.end_time.slice(0, 5),
      capacity: event.capacity,
      image_url: event.image_url ?? '',
      ticket_types:
        event.ticket_types.length > 0
          ? event.ticket_types.map((tt) => ({
              // Preserve the tier id so an edit upserts in place rather than
              // re-creating (and orphaning sold lines) — finding C3.
              id: tt.id,
              name: tt.name,
              price_pounds: tt.price_pence / 100,
              capacity: tt.capacity ?? null,
            }))
          : [{ name: 'General Admission', price_pounds: 0, capacity: null }],
      scheduleMode: 'single',
      recurrenceUntil: '',
      customDates: [],
      calendar_id: event.calendar_id ?? '',
      max_advance_booking_days: event.max_advance_booking_days ?? 90,
      min_booking_notice_hours: event.min_booking_notice_hours ?? 1,
      cancellation_notice_hours: event.cancellation_notice_hours ?? 48,
      allow_same_day_booking: event.allow_same_day_booking ?? true,
      payment_requirement: event.payment_requirement ?? 'none',
      deposit_pounds:
        event.deposit_amount_pence != null && event.deposit_amount_pence > 0
          ? (event.deposit_amount_pence / 100).toFixed(2)
          : '',
    });
    setEditingEventId(event.id);
    setEventError(null);
    setShowEventForm(true);
    setSelectedId(null);
  };

  /**
   * Clone/duplicate (finding 22): prefill the CREATE form from an existing event.
   * `editingEventId` stays null so this POSTs a brand-new event; tier ids are
   * dropped so the copy inserts fresh tiers (never re-points at the source's
   * `event_ticket_types`), and the date is cleared so the user must place the copy
   * on a free slot rather than colliding with the original.
   */
  const handleCloneEvent = (event: ExperienceEvent) => {
    setEventForm({
      name: `${event.name} (copy)`,
      description: event.description ?? '',
      event_date: '',
      start_time: event.start_time.slice(0, 5),
      end_time: event.end_time.slice(0, 5),
      capacity: event.capacity,
      image_url: event.image_url ?? '',
      ticket_types:
        event.ticket_types.length > 0
          ? event.ticket_types.map((tt) => ({
              // No id: a clone always inserts fresh tiers.
              name: tt.name,
              price_pounds: tt.price_pence / 100,
              capacity: tt.capacity ?? null,
            }))
          : [{ name: 'General Admission', price_pounds: 0, capacity: null }],
      scheduleMode: 'single',
      recurrenceUntil: '',
      customDates: [],
      calendar_id: event.calendar_id ?? '',
      max_advance_booking_days: event.max_advance_booking_days ?? 90,
      min_booking_notice_hours: event.min_booking_notice_hours ?? 1,
      cancellation_notice_hours: event.cancellation_notice_hours ?? 48,
      allow_same_day_booking: event.allow_same_day_booking ?? true,
      payment_requirement: event.payment_requirement ?? 'none',
      deposit_pounds:
        event.deposit_amount_pence != null && event.deposit_amount_pence > 0
          ? (event.deposit_amount_pence / 100).toFixed(2)
          : '',
    });
    setEditingEventId(null);
    setCustomDateDraft('');
    setEventError(null);
    setShowEventForm(true);
    setSelectedId(null);
    addToast('Prefilled a new event from this one. Pick a date to save.', 'success');
  };

  const requestDeleteEvent = (id: string) => {
    const row = events.find((e) => e.id === id);
    const name =
      row?.name ?? (detail?.id === id ? detail.name : null) ?? 'this event';
    setDeleteEventModalError(null);
    setEventToDelete({ id, name });
  };

  const confirmDeleteEvent = async () => {
    const target = eventToDelete;
    if (!target) return;
    setDeleteEventBusy(true);
    setDeleteEventModalError(null);
    try {
      const res = await fetch('/api/venue/experience-events', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: target.id }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setDeleteEventModalError(json.error ?? 'Delete failed');
        return;
      }
      setEventToDelete(null);
      addToast('Event deleted.', 'success');
      if (selectedId === target.id) setSelectedId(null);
      await fetchEvents();
    } catch {
      setDeleteEventModalError('Delete failed');
    } finally {
      setDeleteEventBusy(false);
    }
  };

  const handleCancelEvent = async () => {
    if (!selectedId || !detail) return;
    setCancelLoading(true);
    try {
      const res = await fetch(`/api/venue/experience-events/${selectedId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        addToast(data.error ?? 'Could not cancel event', 'error');
        return;
      }
      addToast('Event cancelled and guests notified per your policy.', 'success');
      setSelectedId(null);
      await fetchEvents();
    } catch {
      addToast('Could not cancel event', 'error');
    } finally {
      setCancelLoading(false);
    }
  };

  const addTicketType = () => {
    setEventForm((f) => ({
      ...f,
      ticket_types: [...f.ticket_types, { name: '', price_pounds: 0, capacity: null }],
    }));
  };

  // --- Custom-date chips (finding 14): add valid, non-past dates as chips ---
  const customDateError = (() => {
    const raw = customDateDraft.trim();
    if (raw === '') return null;
    if (!isValidIsoDate(raw)) return 'Enter a valid date.';
    if (raw < localTodayIso()) return 'That date is in the past.';
    if (eventForm.customDates.includes(raw)) return 'That date is already added.';
    return null;
  })();

  const addCustomDate = () => {
    const raw = customDateDraft.trim();
    if (!isValidIsoDate(raw) || raw < localTodayIso() || eventForm.customDates.includes(raw)) return;
    setEventForm((f) => ({ ...f, customDates: normaliseEventDates([...f.customDates, raw]) }));
    setCustomDateDraft('');
  };

  const removeCustomDate = (d: string) => {
    setEventForm((f) => ({ ...f, customDates: f.customDates.filter((x) => x !== d) }));
  };

  // Preview of the exact dates a weekly schedule will create (matches the server).
  const weeklyPreviewDates =
    !editingEventId && eventForm.scheduleMode === 'weekly'
      ? previewWeeklyOccurrences(eventForm.event_date, eventForm.recurrenceUntil)
      : [];

  const removeTicketType = (i: number) => {
    setEventForm((f) => ({ ...f, ticket_types: f.ticket_types.filter((_, j) => j !== i) }));
  };

  const updateTicketType = (i: number, patch: Partial<TicketTypeDraft>) => {
    setEventForm((f) => {
      const updated = [...f.ticket_types];
      updated[i] = { ...updated[i], ...patch };
      return { ...f, ticket_types: updated };
    });
  };

  const today = new Date().toISOString().slice(0, 10);
  const q = searchQuery.trim().toLowerCase();
  const visibleEvents =
    q.length === 0
      ? events
      : events.filter(
          (e) =>
            e.name.toLowerCase().includes(q) ||
            e.event_date.includes(q) ||
            (e.description ?? '').toLowerCase().includes(q),
        );
  const upcoming = visibleEvents.filter((e) => e.event_date >= today);
  const past = visibleEvents.filter((e) => e.event_date < today);

  const handleToggleArrived = async (bookingId: string, arrived: boolean) => {
    setArrivedBusy((s) => ({ ...s, [bookingId]: true }));
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_arrived: arrived }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        addToast(data.error ?? 'Arrived update failed', 'error');
        return;
      }
      if (selectedId) await loadDetail(selectedId, { silent: true });
      addToast(arrived ? 'Marked as arrived.' : 'Arrived cleared.', 'success');
    } finally {
      setArrivedBusy((s) => ({ ...s, [bookingId]: false }));
    }
  };

  const exportAttendeesCsv = () => {
    if (!detail) return;
    const header = [
      'Guest',
      'Email',
      'Phone',
      'Qty',
      'Status',
      'Deposit_pence',
      'Ticket_lines',
      'Arrived_utc',
    ].join(',');
    const lines = attendees.map((a) =>
      [
        escapeCsvCell(a.guest_name),
        escapeCsvCell(a.guest_email),
        escapeCsvCell(a.guest_phone),
        escapeCsvCell(a.party_size),
        escapeCsvCell(a.status),
        escapeCsvCell(a.deposit_amount_pence),
        escapeCsvCell(
          (a.ticket_lines ?? []).map((l) => `${l.label} x${l.quantity}`).join('; '),
        ),
        escapeCsvCell(a.client_arrived_at ? new Date(a.client_arrived_at).toISOString() : ''),
      ].join(','),
    );
    downloadCsvFile(
      `event-attendees-${detail.event_date}-${detail.name.slice(0, 40).replace(/[^\w-]+/g, '_')}.csv`,
      [header, ...lines].join('\n'),
    );
    addToast('CSV downloaded.', 'success');
  };

  const copyPublicBookingLink = async () => {
    try {
      await navigator.clipboard.writeText(publicBookingUrl);
      addToast('Public booking link copied.', 'success');
    } catch {
      addToast('Could not copy link', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Events"
        title="Event manager"
        subtitle="Create ticketed experiences, manage capacity, and review attendees."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search events…"
              className="min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              aria-label="Search events"
            />
            {publicBookingUrl.includes('/book/') ? (
              <button
                type="button"
                onClick={() => void copyPublicBookingLink()}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                Copy booking link
              </button>
            ) : null}
            {(isAdmin || linkedPractitionerIds.length > 0) ? (
              <button
                type="button"
                onClick={() => {
                  setEditingEventId(null);
                  setEventForm({ ...BLANK_EVENT });
                  setEventError(null);
                  setShowEventForm(true);
                }}
                className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
              >
                + Create event
              </button>
            ) : null}
          </div>
        }
      />

      {!isAdmin && (
        <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          {linkedPractitionerIds.length === 0
            ? 'Your account is not linked to a calendar yet. Ask an admin to assign at least one calendar before you can create, edit, or delete events.'
            : 'You can create, edit, or delete events when you assign them to a calendar column you control below. Only admins can add new calendar columns or cancel an event with guest notifications.'}
        </p>
      )}

      {publicBookingUrl.includes('/book/') && (
        <p className="mb-4 text-sm text-slate-500">
          Guests book ticketed events on your public page:{' '}
          <Link
            href={publicBookingUrl}
            className="font-medium text-brand-600 underline hover:text-brand-700"
            target="_blank"
            rel="noreferrer"
          >
            Open booking page
          </Link>
        </p>
      )}

      {listError && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span>{listError}</span>
          <button
            type="button"
            onClick={() => void fetchEvents()}
            className="rounded-md border border-red-300 bg-white px-3 py-1 text-sm font-medium text-red-800 hover:bg-red-100"
          >
            Retry
          </button>
        </div>
      )}

      {/* Create / edit event form */}
      {showEventForm && (
        <SectionCard elevated>
          <SectionCard.Header title={editingEventId ? 'Edit event' : 'Create event'} />
          <SectionCard.Body className="space-y-4">
          <div className="space-y-3 border-b border-slate-100 pb-4">
            {isAdmin && !editingEventId && (
              <div className="rounded-lg border border-blue-100 bg-blue-50/90 px-3 py-2.5 text-xs text-slate-700">
                <p className="font-semibold text-slate-900">Who can manage this event later</p>
                <p className="mt-1.5 leading-relaxed text-slate-600">
                  If you assign this event to a <strong>calendar column</strong> below, staff linked to that column can{' '}
                  <strong>create</strong>, <strong>edit</strong>, or <strong>delete</strong> it later. If you leave it
                  unassigned, only admins can change or remove it.
                </p>
              </div>
            )}
            {!isAdmin && !editingEventId && linkedPractitionerIds.length > 0 && (
              <p className="text-xs leading-relaxed text-slate-600">
                Choose a <strong>calendar column</strong> you control below. You cannot create new team columns here.
              </p>
            )}
            {isAdmin && editingEventId && (
              <p className="text-xs leading-relaxed text-slate-600">
                The calendar below controls which staff can edit or delete this event: only staff assigned to that
                column see those actions.
              </p>
            )}
            {!isAdmin && editingEventId && (
              <p className="text-xs leading-relaxed text-slate-600">
                You can change this event because it is assigned to a calendar you control. You cannot add new calendar
                columns here.
              </p>
            )}
          </div>
          <div className="space-y-4">
            {!editingEventId && (
              <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3">
                <p className="mb-2 text-xs font-medium text-slate-700">Schedule</p>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="sched"
                      checked={eventForm.scheduleMode === 'single'}
                      onChange={() => setEventForm((f) => ({ ...f, scheduleMode: 'single' }))}
                      className="text-brand-600 focus:ring-brand-500"
                    />
                    <span className="text-slate-700">One date</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="sched"
                      checked={eventForm.scheduleMode === 'weekly'}
                      onChange={() => setEventForm((f) => ({ ...f, scheduleMode: 'weekly' }))}
                      className="text-brand-600 focus:ring-brand-500"
                    />
                    <span className="text-slate-700">Weekly (same weekday)</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="sched"
                      checked={eventForm.scheduleMode === 'custom'}
                      onChange={() => setEventForm((f) => ({ ...f, scheduleMode: 'custom' }))}
                      className="text-brand-600 focus:ring-brand-500"
                    />
                    <span className="text-slate-700">Custom dates</span>
                  </label>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Weekly and custom create one event row per date (same ticket setup on each).
                </p>
              </div>
            )}
            <div className="grid min-w-0 gap-4 sm:grid-cols-2 [&_input]:min-w-0 [&_input]:max-w-full [&_select]:min-w-0 [&_select]:max-w-full [&_textarea]:min-w-0 [&_textarea]:max-w-full">
              <div className="min-w-0 sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-600">Event name *</label>
                <input
                  type="text"
                  value={eventForm.name}
                  onChange={(e) => setEventForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Seasonal tasting, Workshop"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
              </div>
              {editingEventId || eventForm.scheduleMode !== 'custom' ? (
                <>
                  <div className="min-w-0">
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      {eventForm.scheduleMode === 'weekly' && !editingEventId ? 'First occurrence *' : 'Date *'}
                    </label>
                    <input
                      type="date"
                      value={eventForm.event_date}
                      onChange={(e) => setEventForm((f) => ({ ...f, event_date: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                    />
                  </div>
                  {!editingEventId && eventForm.scheduleMode === 'weekly' && (
                    <div className="min-w-0">
                      <label htmlFor="weekly-until-input" className="mb-1 block text-xs font-medium text-slate-600">
                        Repeat until *
                      </label>
                      <input
                        id="weekly-until-input"
                        type="date"
                        min={eventForm.event_date || localTodayIso()}
                        value={eventForm.recurrenceUntil}
                        onChange={(e) => setEventForm((f) => ({ ...f, recurrenceUntil: e.target.value }))}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                      />
                      {weeklyPreviewDates.length > 0 ? (
                        <p className="mt-1 text-xs text-slate-500">
                          {weeklyPreviewDates.length === 1
                            ? '1 event will be created.'
                            : `${weeklyPreviewDates.length} events will be created (every 7 days).`}
                        </p>
                      ) : null}
                    </div>
                  )}
                </>
              ) : (
                <div className="min-w-0 sm:col-span-2">
                  <label htmlFor="custom-date-input" className="mb-1 block text-xs font-medium text-slate-600">
                    Dates *
                  </label>
                  <div className="flex flex-wrap items-start gap-2">
                    <input
                      id="custom-date-input"
                      type="date"
                      min={localTodayIso()}
                      value={customDateDraft}
                      onChange={(e) => setCustomDateDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addCustomDate();
                        }
                      }}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                    />
                    <button
                      type="button"
                      onClick={addCustomDate}
                      disabled={customDateDraft.trim() === '' || customDateError !== null}
                      className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-medium text-brand-700 shadow-sm hover:bg-brand-50 disabled:opacity-50"
                    >
                      Add date
                    </button>
                  </div>
                  {customDateError ? (
                    <p className="mt-1 text-xs text-red-600">{customDateError}</p>
                  ) : null}
                  {eventForm.customDates.length > 0 ? (
                    <>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {eventForm.customDates.map((d) => (
                          <span
                            key={d}
                            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white py-1 pl-3 pr-1.5 text-xs font-medium text-slate-700 shadow-sm"
                          >
                            {d}
                            <button
                              type="button"
                              onClick={() => removeCustomDate(d)}
                              aria-label={`Remove ${d}`}
                              className="flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            >
                              <span aria-hidden>×</span>
                            </button>
                          </span>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        {eventForm.customDates.length === 1
                          ? '1 event will be created on this date.'
                          : `${eventForm.customDates.length} events will be created — one per date.`}
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">
                      Pick a date and choose &ldquo;Add date&rdquo;. Each date becomes its own event with the same ticket
                      setup.
                    </p>
                  )}
                </div>
              )}
              <div className="min-w-0">
                <label className="mb-1 block text-xs font-medium text-slate-600">Capacity *</label>
                <NumericInput
                  min={1}
                  value={eventForm.capacity}
                  onChange={(v) => setEventForm((f) => ({ ...f, capacity: v }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
              </div>
              <div className="min-w-0">
                <label className="mb-1 block text-xs font-medium text-slate-600">Start time *</label>
                <input
                  type="time"
                  value={eventForm.start_time}
                  onChange={(e) => setEventForm((f) => ({ ...f, start_time: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
              </div>
              <div className="min-w-0">
                <label className="mb-1 block text-xs font-medium text-slate-600">End time *</label>
                <input
                  type="time"
                  value={eventForm.end_time}
                  onChange={(e) => setEventForm((f) => ({ ...f, end_time: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
              </div>
              <div className="min-w-0 sm:col-span-2 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                <p className="mb-2 text-xs font-medium text-slate-700">Guest booking rules</p>
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Max advance (days)</label>
                    <NumericInput
                      min={1}
                      max={365}
                      value={eventForm.max_advance_booking_days}
                      onChange={(v) =>
                        setEventForm((f) => ({
                          ...f,
                          max_advance_booking_days: v,
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Min notice (hours)</label>
                    <NumericInput
                      min={0}
                      max={168}
                      value={eventForm.min_booking_notice_hours}
                      onChange={(v) =>
                        setEventForm((f) => ({
                          ...f,
                          min_booking_notice_hours: v,
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Cancellation notice (hours)</label>
                    <NumericInput
                      min={0}
                      max={168}
                      value={eventForm.cancellation_notice_hours}
                      onChange={(v) =>
                        setEventForm((f) => ({
                          ...f,
                          cancellation_notice_hours: v,
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={eventForm.allow_same_day_booking}
                        onChange={(e) =>
                          setEventForm((f) => ({ ...f, allow_same_day_booking: e.target.checked }))
                        }
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Allow same-day bookings
                    </label>
                  </div>
                </div>
              </div>
              <div className="min-w-0 sm:col-span-2 space-y-3 rounded-lg border border-slate-100 bg-slate-50/80 p-3">
                <p className="text-xs font-medium text-slate-700">Calendar column</p>
                <p className="text-xs text-slate-500">
                  Show this event on a team calendar column in the dashboard. The time must not overlap other
                  appointments, classes, resources on that column, or blocked time.
                  {isAdmin && (
                    <span className="mt-1 block text-slate-600">
                      Choosing a column here also decides which staff can edit or delete this event later (see note
                      above).
                    </span>
                  )}
                </p>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Calendar</label>
                  <select
                    value={eventForm.calendar_id}
                    onChange={(e) => setEventForm((f) => ({ ...f, calendar_id: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  >
                    <option value="">Not assigned to a calendar</option>
                    {teamCalendars.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                {isAdmin && (
                  <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/90 p-3">
                    {!entitlementLoaded ? (
                      <p className="text-xs text-slate-500">Loading plan limits…</p>
                    ) : canAddCalendar ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setAddCalendarModalError(null);
                            setNewCalendarName('');
                            setShowAddCalendarModal(true);
                          }}
                          className="inline-flex w-full items-center justify-center rounded-lg border border-brand-200/90 bg-white px-3.5 py-2.5 text-sm font-semibold text-brand-700 shadow-sm transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out hover:border-brand-400 hover:bg-brand-50 hover:text-brand-800 hover:shadow-md active:scale-[0.98] active:border-brand-500 active:bg-brand-100 active:shadow-inner motion-reduce:transition-colors motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                        >
                          Add calendar
                        </button>
                        <p className="mt-2 text-xs text-slate-500">
                          Create a calendar column here and assign it to this event immediately.
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
              </div>
              <div className="min-w-0 sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Description <span className="font-normal text-slate-400">optional</span>
                </label>
                <textarea
                  rows={2}
                  value={eventForm.description}
                  onChange={(e) => setEventForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Briefly describe the event for guests…"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
              </div>
              <div className="min-w-0 sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Image URL <span className="font-normal text-slate-400">optional</span>
                </label>
                <input
                  type="url"
                  value={eventForm.image_url}
                  onChange={(e) => setEventForm((f) => ({ ...f, image_url: e.target.value }))}
                  placeholder="https://…"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
                {/^https?:\/\//i.test(eventForm.image_url.trim()) && (
                  <div className="mt-2">
                    <p className="mb-1 text-xs text-slate-500">Preview</p>
                    <img
                      src={eventForm.image_url.trim()}
                      alt=""
                      className="max-h-40 max-w-full rounded-lg border border-slate-200 object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Ticket types */}
            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-700">Ticket types</h3>
              <div className="space-y-2">
                {eventForm.ticket_types.map((tt, i) => (
                  <div key={i} className="flex min-w-0 max-w-full flex-wrap items-end gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                    <div className="min-w-0 flex-1 sm:min-w-[140px]">
                      <label
                        htmlFor={`ticket-name-${i}`}
                        className="mb-1 block text-xs font-medium text-slate-500 sm:text-sm"
                      >
                        Ticket name
                      </label>
                      <input
                        id={`ticket-name-${i}`}
                        type="text"
                        value={tt.name}
                        onChange={(e) => updateTicketType(i, { name: e.target.value })}
                        placeholder="e.g. General Admission"
                        className="w-full rounded border border-slate-200 bg-white px-2 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                      />
                    </div>
                    <div className="w-full min-w-0 sm:w-28">
                      <label
                        htmlFor={`ticket-price-${i}`}
                        className="mb-1 block text-xs font-medium text-slate-500 sm:text-sm"
                      >
                        Price ({sym})
                      </label>
                      <NumericInput
                        id={`ticket-price-${i}`}
                        allowFloat
                        min={0}
                        value={tt.price_pounds}
                        onChange={(v) => updateTicketType(i, { price_pounds: v })}
                        placeholder="0.00"
                        autoComplete="off"
                        className="w-full rounded border border-slate-200 bg-white px-2 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                      />
                    </div>
                    <div className="w-full min-w-0 sm:w-24">
                      <label
                        htmlFor={`ticket-cap-${i}`}
                        className="mb-1 block text-xs font-medium text-slate-500 sm:text-sm"
                      >
                        Cap <span className="font-normal text-slate-400">opt.</span>
                      </label>
                      <NumericInput
                        id={`ticket-cap-${i}`}
                        value={tt.capacity}
                        onChange={(v) => updateTicketType(i, { capacity: v >= 1 ? v : null })}
                        placeholder="No limit"
                        autoComplete="off"
                        className="w-full rounded border border-slate-200 bg-white px-2 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                      />
                    </div>
                    {eventForm.ticket_types.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeTicketType(i)}
                        className="min-h-10 self-end rounded-lg px-2 text-sm font-medium text-red-500 hover:bg-red-50 hover:text-red-700"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addTicketType}
                className="mt-2 text-sm font-medium text-brand-600 hover:text-brand-800"
              >
                + Add ticket type
              </button>
            </div>

            {/* Online payment */}
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Online payment (Stripe)</label>
              <div className="space-y-2">
                <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="event_payment_requirement"
                    className="mt-0.5"
                    checked={eventForm.payment_requirement === 'none'}
                    onChange={() =>
                      setEventForm((f) => ({ ...f, payment_requirement: 'none', deposit_pounds: '' }))
                    }
                  />
                  <span>None - pay at venue or free event</span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="event_payment_requirement"
                    className="mt-0.5"
                    checked={eventForm.payment_requirement === 'deposit'}
                    onChange={() => setEventForm((f) => ({ ...f, payment_requirement: 'deposit' }))}
                  />
                  <span>Deposit per person (partial payment online)</span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="event_payment_requirement"
                    className="mt-0.5"
                    checked={eventForm.payment_requirement === 'full_payment'}
                    onChange={() =>
                      setEventForm((f) => ({ ...f, payment_requirement: 'full_payment', deposit_pounds: '' }))
                    }
                  />
                  <span>Full payment online (per ticket)</span>
                </label>
              </div>
              {eventForm.payment_requirement === 'deposit' && (
                <div className="mt-3 max-w-full sm:max-w-xs">
                  <label className="mb-1 block text-xs font-medium text-slate-600">Deposit amount ({sym}) *</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={eventForm.deposit_pounds}
                    onChange={(e) => setEventForm((f) => ({ ...f, deposit_pounds: e.target.value }))}
                    placeholder="e.g. 5.00"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  />
                </div>
              )}
              <p className="mt-2 text-xs text-slate-500">
                Deposit and full payment require ticket prices &gt; 0 and a connected Stripe account.
              </p>
              <StripePaymentWarning
                stripeConnected={stripeConnected}
                requiresOnlinePayment={
                  eventForm.payment_requirement === 'deposit' || eventForm.payment_requirement === 'full_payment'
                }
              />
            </div>

            {eventError && <p className="text-sm text-red-600">{eventError}</p>}
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => void handleSaveEvent()}
                disabled={eventSaving}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {eventSaving ? 'Saving…' : 'Save event'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowEventForm(false);
                  setEditingEventId(null);
                  setEventError(null);
                }}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
          </SectionCard.Body>
        </SectionCard>
      )}

      {loading ? (
        <DashboardCardGridSkeleton cards={2} />
      ) : events.length === 0 ? (
        <EmptyState
          title="No events yet"
          description={
            isAdmin || linkedPractitionerIds.length > 0
              ? 'Use "Create event" in the header to add your first ticketed experience.'
              : 'Ask an admin to link your account to a calendar before you can create events.'
          }
        />
      ) : (
        <div className="space-y-6">
          {upcoming.length > 0 && (
            <SectionCard>
              <SectionCard.Header eyebrow="Upcoming" />
              <SectionCard.Body className="!pt-4 space-y-3">
                {upcoming.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    formatPrice={formatPrice}
                    selected={selectedId === event.id}
                    onSelect={() => setSelectedId(selectedId === event.id ? null : event.id)}
                    canEdit={
                      isAdmin ||
                      (event.calendar_id !== null && linkedPractitionerIds.includes(event.calendar_id))
                    }
                    onEdit={() => handleEditEvent(event)}
                    onDelete={() => requestDeleteEvent(event.id)}
                  />
                ))}
              </SectionCard.Body>
            </SectionCard>
          )}
          {past.length > 0 && (
            <SectionCard className="opacity-90">
              <SectionCard.Header eyebrow="Past" />
              <SectionCard.Body className="!pt-4 space-y-3">
                {past.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    formatPrice={formatPrice}
                    selected={selectedId === event.id}
                    onSelect={() => setSelectedId(selectedId === event.id ? null : event.id)}
                    canEdit={
                      isAdmin ||
                      (event.calendar_id !== null && linkedPractitionerIds.includes(event.calendar_id))
                    }
                    onEdit={() => handleEditEvent(event)}
                    onDelete={() => requestDeleteEvent(event.id)}
                  />
                ))}
              </SectionCard.Body>
            </SectionCard>
          )}
        </div>
      )}

      {showAddCalendarModal && isAdmin && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-[2px]"
          onClick={() => {
            if (addCalendarSubmitting) return;
            setShowAddCalendarModal(false);
            setAddCalendarModalError(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-calendar-modal-title"
            className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="add-calendar-modal-title" className="mb-1 text-lg font-semibold text-slate-900">
              Add calendar
            </h2>
            <p className="mb-4 text-sm text-slate-500">
              Same defaults as Calendar availability: weekly hours are set automatically; you can edit them in
              Availability later.
            </p>
            {addCalendarModalError && (
              <div
                role="alert"
                className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              >
                {addCalendarModalError}
              </div>
            )}
            <label className="mb-1 block text-xs font-medium text-slate-600">Display name *</label>
            <input
              type="text"
              value={newCalendarName}
              onChange={(e) => setNewCalendarName(e.target.value)}
              placeholder="e.g. Studio A, Front desk"
              disabled={addCalendarSubmitting}
              className="mb-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-60"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submitInlineNewCalendar();
                }
              }}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void submitInlineNewCalendar()}
                disabled={addCalendarSubmitting}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {addCalendarSubmitting ? 'Creating\u2026' : 'Create and select'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddCalendarModal(false);
                  setAddCalendarModalError(null);
                }}
                disabled={addCalendarSubmitting}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedId && (
        <SectionCard elevated className="mt-8">
          {detailLoading && (
            <SectionCard.Body>
              <p className="text-sm text-slate-500">Loading details…</p>
            </SectionCard.Body>
          )}
          {detailError && (
            <SectionCard.Body>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-red-600">{detailError}</p>
                <button
                  type="button"
                  onClick={() => selectedId && void loadDetail(selectedId)}
                  className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  Retry
                </button>
              </div>
            </SectionCard.Body>
          )}
          {!detailLoading && detail && (
            <>
              <SectionCard.Header
                eyebrow="Event detail"
                title={detail.name}
                description={
                  <>
                    <span className="block">
                      {detail.event_date} · {detail.start_time.slice(0, 5)} – {detail.end_time.slice(0, 5)} ·{' '}
                      {detail.capacity} capacity
                    </span>
                    {!detail.is_active ? (
                      <span className="mt-2 inline-block">
                        <Pill variant="warning" size="sm">
                          Cancelled / inactive
                        </Pill>
                      </span>
                    ) : null}
                    {!isAdmin &&
                    detail.is_active &&
                    detail.calendar_id !== null &&
                    linkedPractitionerIds.includes(detail.calendar_id) ? (
                      <span className="mt-3 block max-w-md text-xs text-slate-500">
                        Cancelling an event and notifying guests is limited to venue admins. You can still edit or
                        delete this event when allowed.
                      </span>
                    ) : null}
                  </>
                }
                right={
                  isAdmin || (detail.calendar_id !== null && linkedPractitionerIds.includes(detail.calendar_id)) ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <DashboardEntityRowActions
                        onEdit={() => handleEditEvent(detail)}
                        onDelete={() => requestDeleteEvent(detail.id)}
                      />
                      {isAdmin || linkedPractitionerIds.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => handleCloneEvent(detail)}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                        >
                          Duplicate
                        </button>
                      ) : null}
                      {isAdmin && detail.is_active ? (
                        <button
                          type="button"
                          onClick={() => setShowCancelEventConfirm(true)}
                          disabled={cancelLoading}
                          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 shadow-sm hover:bg-red-100 disabled:opacity-50"
                        >
                          {cancelLoading ? 'Cancelling…' : 'Cancel event & notify guests'}
                        </button>
                      ) : null}
                    </div>
                  ) : null
                }
              />

              <SectionCard.Body className="space-y-4">
                {analytics ? <EventAnalyticsPanel analytics={analytics} formatPrice={formatPrice} /> : null}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Attendees</p>
                    {attendees.length > 0 ? (
                      <p className="mt-0.5 text-xs text-slate-500">Click a booking to view full details</p>
                    ) : null}
                  </div>
                  {attendees.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => exportAttendeesCsv()}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                    >
                      Export CSV
                    </button>
                  ) : null}
                </div>
                {attendees.length === 0 ? (
                  <EmptyState
                    title="No bookings for this event"
                    description="When guests book tickets, they will appear in this list."
                  />
                ) : (
                  <StackedList
                    flush
                    items={attendees}
                    keyExtractor={(a) => a.booking_id}
                    renderDesktopRow={(a) => (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={(e) => openAttendeeBookingDetail(a, e)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setDetailBookingId(a.booking_id);
                            setDetailBookingAnchor(null);
                          }
                        }}
                        className="grid cursor-pointer grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto_auto_auto] items-start gap-3 rounded-lg px-2 py-3 text-sm outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                      >
                        <div className="min-w-0 font-medium text-slate-900">{a.guest_name ?? '—'}</div>
                        <div className="min-w-0 text-slate-600">
                          <div className="max-w-[200px] truncate text-xs">{a.guest_email ?? '—'}</div>
                          <div className="text-[11px] text-slate-500">{a.guest_phone ?? ''}</div>
                        </div>
                        <div className="min-w-0 text-xs text-slate-600">
                          {(a.ticket_lines ?? []).length > 0
                            ? (a.ticket_lines ?? []).map((l) => `${l.label} ×${l.quantity}`).join(', ')
                            : '—'}
                        </div>
                        <div className="tabular-nums text-slate-800">{a.party_size}</div>
                        <div>
                          <Pill variant={attendeeStatusVariant(a.status)} size="sm">
                            {a.status}
                          </Pill>
                        </div>
                        <div className="text-xs text-slate-600">
                          {a.client_arrived_at ? new Date(a.client_arrived_at).toLocaleString('en-GB') : '—'}
                        </div>
                        <EventAttendeeArrivedActions
                          attendee={a}
                          busy={Boolean(arrivedBusy[a.booking_id])}
                          onToggle={(arrived) => void handleToggleArrived(a.booking_id, arrived)}
                        />
                      </div>
                    )}
                    renderMobileCard={(a) => (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={(e) => openAttendeeBookingDetail(a, e)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setDetailBookingId(a.booking_id);
                            setDetailBookingAnchor(null);
                          }
                        }}
                        className="cursor-pointer rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/5 outline-none hover:bg-slate-50/80 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-slate-900">{a.guest_name ?? '—'}</p>
                            <p className="text-xs text-slate-500">{a.guest_email ?? '—'}</p>
                            {a.guest_phone ? <p className="text-xs text-slate-500">{a.guest_phone}</p> : null}
                          </div>
                          <Pill variant={attendeeStatusVariant(a.status)} size="sm">
                            {a.status}
                          </Pill>
                        </div>
                        <p className="mt-2 text-xs text-slate-600">
                          Tickets:{' '}
                          {(a.ticket_lines ?? []).length > 0
                            ? (a.ticket_lines ?? []).map((l) => `${l.label} ×${l.quantity}`).join(', ')
                            : '—'}{' '}
                          · Qty {a.party_size}
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          Arrived:{' '}
                          {a.client_arrived_at ? new Date(a.client_arrived_at).toLocaleString('en-GB') : '—'}
                        </p>
                        <EventAttendeeArrivedActions
                          attendee={a}
                          busy={Boolean(arrivedBusy[a.booking_id])}
                          fullWidth
                          onToggle={(arrived) => void handleToggleArrived(a.booking_id, arrived)}
                        />
                      </div>
                    )}
                  />
                )}
              </SectionCard.Body>
            </>
          )}
        </SectionCard>
      )}

      {detailBookingId ? (
        <BookingDetailPanel
          key={detailBookingId}
          bookingId={detailBookingId}
          venueId={venueId}
          venueCurrency={currency}
          initialSnapshot={detailBookingSnapshot}
          isAppointment
          presentation="popover"
          anchor={detailBookingAnchor}
          onClose={() => {
            setDetailBookingId(null);
            setDetailBookingAnchor(null);
          }}
          onUpdated={() => {
            if (selectedId) void loadDetail(selectedId, { silent: true });
          }}
        />
      ) : null}

      {eventToDelete && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-[2px]"
          onClick={() => {
            if (!deleteEventBusy) setEventToDelete(null);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-event-title"
            aria-describedby="delete-event-desc"
            className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="delete-event-title" className="text-base font-semibold text-slate-900">
              Permanently delete this event?
            </h3>
            <p id="delete-event-desc" className="mt-2 text-sm text-slate-600">
              <span className="font-medium text-slate-800">{eventToDelete.name}</span> will be removed. Ticket types and
              settings for this event row are discarded. This cannot be undone.
            </p>
            {deleteEventModalError ? (
              <div
                role="alert"
                className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              >
                {deleteEventModalError}
              </div>
            ) : null}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setEventToDelete(null)}
                disabled={deleteEventBusy}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDeleteEvent()}
                disabled={deleteEventBusy}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
              >
                {deleteEventBusy ? 'Deleting…' : 'Delete event'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel-event confirmation (replaces window.confirm — finding 22). */}
      <ConfirmDialog
        open={showCancelEventConfirm}
        onOpenChange={setShowCancelEventConfirm}
        title="Cancel this event?"
        message={
          detail
            ? `"${detail.name}" will be deactivated. All active bookings are cancelled and guests are notified per your refund policy. This cannot be undone.`
            : 'This event will be cancelled and guests notified per your refund policy.'
        }
        confirmLabel="Cancel event & notify"
        cancelLabel="Keep event"
        destructive
        onConfirm={() => void handleCancelEvent()}
      />
    </div>
  );
}

function EventCard({
  event,
  formatPrice,
  selected,
  onSelect,
  canEdit,
  onEdit,
  onDelete,
}: {
  event: ExperienceEvent;
  formatPrice: (pence: number) => string;
  selected: boolean;
  onSelect: () => void;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`rounded-2xl border bg-white shadow-sm shadow-slate-900/5 transition-[box-shadow,background-color,border-color] ${
        selected ? 'border-brand-300 ring-2 ring-brand-200' : 'border-slate-200'
      }`}
    >
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 flex-1 px-3 py-4 text-left sm:px-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-slate-900">{event.name}</h3>
              <p className="text-sm text-slate-500">
                {event.event_date} &middot; {event.start_time.slice(0, 5)} – {event.end_time.slice(0, 5)}
              </p>
              {event.description && (
                <p className="mt-1 text-sm text-slate-600 line-clamp-2">{event.description}</p>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2 text-right text-sm">
              <Pill variant="neutral" size="sm" className="tabular-nums">
                {event.capacity} cap
              </Pill>
              {!event.is_active ? (
                <Pill variant="warning" size="sm">
                  Inactive
                </Pill>
              ) : null}
            </div>
          </div>
          {event.ticket_types.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {event.ticket_types.map((tt) => (
                <Pill key={tt.id} variant="brand" size="sm">
                  {tt.name}: {formatPrice(tt.price_pence)}
                  {tt.capacity ? ` (${tt.capacity} max)` : ''}
                </Pill>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">{selected ? 'Hide details' : 'View attendees & actions'}</p>
        </button>
        {canEdit ? (
          <div className="flex shrink-0 flex-col items-end justify-start gap-2 border-l border-slate-100 px-3 py-4 sm:px-4">
            <DashboardEntityRowActions onEdit={onEdit} onDelete={onDelete} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Per-event sales analytics for the detail panel (finding 21): tickets sold by
 * tier, total revenue and capacity fill %. Reads the (already status-filtered)
 * roster so the figures reflect money actually taken and seats actually held.
 */
function EventAnalyticsPanel({
  analytics,
  formatPrice,
}: {
  analytics: EventAnalytics;
  formatPrice: (pence: number) => string;
}) {
  const { tiers, ticketsSold, revenuePence, seatsTaken, capacity, fillPercent } = analytics;
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Sales &amp; capacity</p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <p className="text-xs text-slate-500">Tickets sold</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{ticketsSold}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Revenue</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{formatPrice(revenuePence)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Seats taken</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
            {seatsTaken}
            <span className="text-sm font-normal text-slate-500"> / {capacity}</span>
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Fill</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
            {fillPercent === null ? '—' : `${fillPercent}%`}
          </p>
        </div>
      </div>
      {fillPercent !== null ? (
        <div
          className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200"
          role="progressbar"
          aria-valuenow={fillPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Capacity filled"
        >
          <div
            className={`h-full rounded-full ${fillPercent >= 100 ? 'bg-emerald-500' : 'bg-brand-500'}`}
            style={{ width: `${fillPercent}%` }}
          />
        </div>
      ) : null}
      {tiers.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-medium text-slate-600">By ticket type</p>
          <ul className="mt-2 space-y-1.5">
            {tiers.map((t) => (
              <li
                key={t.label}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm"
              >
                <span className="min-w-0 truncate text-slate-700">{t.label}</span>
                <span className="tabular-nums text-slate-500">
                  <span className="font-medium text-slate-800">{t.quantity}</span> sold ·{' '}
                  {formatPrice(t.revenue_pence)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
