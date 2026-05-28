'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RegistryAppointment } from '@/components/booking/AppointmentRegistryCard';
import {
  ExpandedBookingContent,
  type BookingDetailLite,
  type BookingRow,
} from '@/app/dashboard/bookings/ExpandedBookingContent';
import { expandedBookingRowShellClass } from '@/app/dashboard/bookings/booking-expand-accordion-classes';
import { bindDetailPrefetchHandlers } from '@/lib/dashboard/detail-prefetch-intent';
import { bookingDetailLiteFromCachePayload } from '@/lib/booking/resolve-booking-detail-lite';
import { readResponseJson } from '@/lib/http/read-response-json';
import { formatMoneyPence } from '@/lib/appointments-csv';
import { currencySymbolFromCode } from '@/lib/money/currency-symbol';
import type { BookingModel } from '@/types/booking-models';
import {
  bookingModelShortLabel,
  showBookingModelTypePill,
  inferBookingRowModel,
} from '@/lib/booking/infer-booking-row-model';
import {
  showAttendanceConfirmedSupplementPill,
  showDepositPendingPill,
} from '@/lib/booking/booking-staff-indicators';
import {
  applyBookingRowOverlayFields,
  overlayFromPatchPayload,
} from '@/lib/booking/booking-row-overlay';
import { bookingStatusVisualForRow } from '@/lib/table-management/booking-status-visual';
import { BookingStatusPill } from '@/components/ui/dashboard/BookingStatusPill';
import { Pill, type PillVariant } from '@/components/ui/dashboard/Pill';
import type { GuestMessageChannel, GuestMessageSendResult } from '@/lib/booking/guest-message-channel';
import { useToast } from '@/components/ui/Toast';
import {
  useDashboardDetailCache,
  type VenueBookingDetailPayload,
} from '@/components/providers/DashboardDetailCacheProvider';

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDayHeader(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

function timeToMinutesHHMM(t: string): number {
  const hm = t.trim().slice(0, 5);
  const [h, m] = hm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

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

function inferRegistryModel(b: RegistryAppointment): BookingModel {
  return inferBookingRowModel({
    booking_model: b.booking_model,
    experience_event_id: b.experience_event_id,
    class_instance_id: b.class_instance_id,
    resource_id: b.resource_id,
    event_session_id: b.event_session_id,
    calendar_id: b.calendar_id,
    service_item_id: b.service_item_id,
    practitioner_id: b.practitioner_id,
    appointment_service_id: b.appointment_service_id,
  });
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

function statusBorderClass(b: RegistryAppointment): string {
  return bookingStatusVisualForRow(b).listBorderLeft;
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

function depositPillVariant(status: string): PillVariant {
  const s = status.toLowerCase();
  if (s === 'paid' || s === 'captured') return 'success';
  if (s === 'pending' || s === 'requires_action') return 'warning';
  if (s === 'refunded' || s === 'cancelled' || s === 'failed') return 'danger';
  return 'neutral';
}

function tableStatusLabel(s: string): string {
  if (s === 'Seated') return 'Started';
  if (s === 'No-Show') return 'No show';
  return s;
}

export function RegistryBookingAccordionList({
  experienceEventId,
  classInstanceId,
  venueId,
  ownerVenueId,
  linkedAct,
  venueCurrency = 'GBP',
  venueTimezone = 'Europe/London',
  hideDateInSummary = false,
  onBookingsUpdated,
  onBookingsCountChange,
}: {
  experienceEventId?: string | null;
  classInstanceId?: string | null;
  venueId: string;
  /** When set, loads session bookings from a linked owner venue. */
  ownerVenueId?: string;
  linkedAct?: import('@/lib/linked-accounts/types').LinkActionLevel;
  venueCurrency?: string;
  venueTimezone?: string;
  /** When all rows share one date, omit the date chip in the collapsed row. */
  hideDateInSummary?: boolean;
  onBookingsUpdated?: () => void;
  onBookingsCountChange?: (count: number) => void;
}) {
  const { addToast } = useToast();
  const {
    peekVenueBookingDetail,
    primeVenueBookingDetail,
    invalidateVenueBookingDetail,
    warmVenueBookingDetail,
  } = useDashboardDetailCache();
  const sym = currencySymbolFromCode(venueCurrency);

  const [bookings, setBookings] = useState<RegistryAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [detailById, setDetailById] = useState<Record<string, BookingDetailLite>>({});
  const [detailLoadingIds, setDetailLoadingIds] = useState<string[]>([]);
  const [guestHistoryRevisionById, setGuestHistoryRevisionById] = useState<Record<string, number>>({});
  const [messageDraftById, setMessageDraftById] = useState<Record<string, string>>({});
  const [sendingMessageIds, setSendingMessageIds] = useState<string[]>([]);

  const fetchBookings = useCallback(async () => {
    if (!experienceEventId && !classInstanceId) {
      setBookings([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (experienceEventId) params.set('experience_event_id', experienceEventId);
      if (classInstanceId) params.set('class_instance_id', classInstanceId);
      if (ownerVenueId) {
        params.set('owner_venue_id', ownerVenueId);
      }
      const res = await fetch(`/api/venue/bookings/list?${params}`);
      const data = await readResponseJson<{ error?: string; bookings?: RegistryAppointment[] }>(res);
      if (!res.ok) {
        setError(data.error ?? 'Failed to load bookings');
        setBookings([]);
        onBookingsCountChange?.(0);
        return;
      }
      setBookings(data.bookings ?? []);
      onBookingsCountChange?.((data.bookings ?? []).filter((b) => b.status !== 'Cancelled').reduce((s, b) => s + (b.party_size ?? 1), 0));
    } catch {
      setError('Network error loading bookings');
      setBookings([]);
      onBookingsCountChange?.(0);
    } finally {
      setLoading(false);
    }
  }, [classInstanceId, experienceEventId, onBookingsCountChange, ownerVenueId, venueId]);

  useEffect(() => {
    void fetchBookings();
  }, [fetchBookings]);

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

  const toggleExpanded = useCallback(
    (bookingId: string) => {
      setExpandedIds((prev) => {
        const next = prev.includes(bookingId) ? prev.filter((id) => id !== bookingId) : [...prev, bookingId];
        if (!prev.includes(bookingId)) {
          if (ownerVenueId) {
            void fetch('/api/venue/linked-calendar/booking/view', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ bookingId }),
            }).catch(() => undefined);
          }
          void loadBookingDetail(bookingId);
        }
        return next;
      });
    },
    [loadBookingDetail, ownerVenueId, venueId],
  );

  const updateRowStatus = useCallback(
    async (bookingId: string, nextStatus: string) => {
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
              r.id === bookingId ? applyBookingRowOverlayFields(r, overlayFromPatchPayload(payload)) : r,
            ),
          );
        }
        onBookingsUpdated?.();
      } catch {
        addToast('Network error updating status', 'error');
        setBookings((rows) => rows.map((r) => (r.id === bookingId ? prev : r)));
      }
    },
    [addToast, bookings, onBookingsUpdated],
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
      } finally {
        setSendingMessageIds((prev) => prev.filter((id) => id !== bookingId));
      }
    },
    [addToast, invalidateVenueBookingDetail, loadBookingDetail],
  );

  const sortedBookings = useMemo(() => {
    return [...bookings].sort((a, b) => {
      const d = a.booking_date.localeCompare(b.booking_date);
      if (d !== 0) return d;
      return a.booking_time.localeCompare(b.booking_time);
    });
  }, [bookings]);

  if (loading) {
    return <p className="text-sm text-slate-500">Loading bookings…</p>;
  }
  if (error) {
    return <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  }
  if (sortedBookings.length === 0) {
    return <p className="text-sm text-slate-500">No bookings for this event.</p>;
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[11px] font-semibold tabular-nums text-slate-500 sm:text-xs">
        {sortedBookings.length} {sortedBookings.length === 1 ? 'booking' : 'bookings'}
      </p>
      {sortedBookings.map((b) => {
        const expanded = expandedIds.includes(b.id);
        const bookingModel = inferRegistryModel(b);
        const typeLabel = bookingModelShortLabel(bookingModel);
        const startTime = b.booking_time.slice(0, 5);
        const endTime = b.booking_end_time ? b.booking_end_time.slice(0, 5) : null;
        const duration = registryAppointmentDurationMinutes(b, null);
        const svcName = b.booking_item_name?.trim() || null;
        const priceDisplay =
          b.deposit_amount_pence != null ? formatMoneyPence(b.deposit_amount_pence, sym) : null;
        const draftMessage = messageDraftById[b.id] ?? '';
        const sendingMessage = sendingMessageIds.includes(b.id);

        return (
          <div
            key={b.id}
            role="button"
            tabIndex={0}
            aria-expanded={expanded}
            aria-controls={`registry-expand-${b.id}`}
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
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs sm:text-sm">
                  <span className="min-w-0 max-w-[8.75rem] truncate font-semibold text-slate-900 sm:max-w-[14rem]">
                    {b.guest_name}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-slate-700">
                    {startTime}
                    {endTime ? <span className="text-slate-400">-{endTime}</span> : null}
                  </span>
                  {!hideDateInSummary ? (
                    <>
                      <span className={expanded ? 'inline shrink-0 text-slate-300' : 'hidden shrink-0 text-slate-300 sm:inline'}>
                        ·
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
                    </>
                  ) : null}
                  {svcName ? (
                    <>
                      <span className="inline shrink-0 text-slate-300">·</span>
                      <span className="inline max-w-[10rem] truncate text-[11px] font-medium text-slate-600">
                        {svcName}
                      </span>
                    </>
                  ) : null}
                  <BookingStatusPill statusKey={b.status}>{tableStatusLabel(b.status)}</BookingStatusPill>
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
                  {showBookingModelTypePill(bookingModel) ? (
                    <span className={expanded ? 'inline-flex shrink-0' : 'hidden shrink-0 md:inline-flex'}>
                      <Pill variant={bookingTypePillVariant(bookingModel)} size="sm">
                        {typeLabel}
                      </Pill>
                    </span>
                  ) : null}
                  {duration != null && (
                    <span className="hidden rounded bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500 sm:inline-block">
                      {duration} min
                    </span>
                  )}
                  {(b.addons_count ?? 0) > 0 && (
                    <Pill variant="info" size="sm">
                      +{b.addons_count} {b.addons_count === 1 ? 'extra' : 'extras'}
                    </Pill>
                  )}
                  {b.party_size > 1 && (
                    <span className="hidden rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 sm:inline-block">
                      {b.party_size} people
                    </span>
                  )}
                  {priceDisplay && (
                    <span className={expanded ? 'inline-flex' : 'hidden sm:inline-flex'}>
                      <Pill variant={depositPillVariant(b.deposit_status)} size="sm" dot>
                        {priceDisplay} · {b.deposit_status}
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
            {expanded ? (
              <div
                id={`registry-expand-${b.id}`}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                className={expandedBookingRowShellClass}
              >
                <ExpandedBookingContent
                  booking={registryToExpandedBookingRow(b)}
                  detail={detailById[b.id]}
                  detailLoading={detailLoadingIds.includes(b.id)}
                  tableManagementEnabled={false}
                  venueId={venueId}
                  venueCurrency={venueCurrency}
                  venueTimezone={venueTimezone}
                  linkedAct={linkedAct}
                  guestHistoryListRefresh={guestHistoryRevisionById[b.id] ?? 0}
                  relatedBookingsStackDepth={0}
                  draftMessage={draftMessage}
                  sendingMessage={sendingMessage}
                  onMessageDraftChange={(value) => setMessageDraftById((prev) => ({ ...prev, [b.id]: value }))}
                  onSendMessage={(channel) => sendGuestMessage(b.id, draftMessage, channel)}
                  onStatusAction={(status) => {
                    void updateRowStatus(b.id, status);
                  }}
                  onDetailUpdated={() => {
                    invalidateVenueBookingDetail(b.id);
                    setDetailById((prev) => {
                      const next = { ...prev };
                      delete next[b.id];
                      return next;
                    });
                    void loadBookingDetail(b.id, true);
                    void fetchBookings();
                    onBookingsUpdated?.();
                  }}
                  venueStaffBookingModel="event_ticket"
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
