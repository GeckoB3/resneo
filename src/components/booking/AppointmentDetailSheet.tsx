'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  BOOKING_PRIMARY_ACTIONS,
  BOOKING_REVERT_ACTIONS,
  BOOKING_STATUS_TRANSITIONS,
  canMarkNoShowForSlot,
  isBookingStatus,
  type BookingStatus,
} from '@/lib/table-management/booking-status';
import { validateNoShowGracePeriod } from '@/lib/table-management/lifecycle';
import { currencySymbolFromCode } from '@/lib/money/currency-symbol';
import type { BookingModel, ClassPaymentRequirement } from '@/types/booking-models';
import {
  inferBookingRowModel,
  bookingModelShortLabel,
  bookingStatusDisplayLabel,
  isTableReservationBooking,
} from '@/lib/booking/infer-booking-row-model';
import {
  attendanceConfirmationSources,
  showAttendanceConfirmedSupplementPill,
  showDepositPendingPill,
} from '@/lib/booking/booking-staff-indicators';
import { BOOKING_START_PRIMARY_BUTTON_CLASSES } from '@/lib/table-management/booking-status-visual';
import { formatBookablePricePence } from '@/lib/booking/format-price-display';
import { CustomerProfileNotesCard } from '@/components/booking/CustomerProfileNotesCard';
import { GuestMessageChannelSelect } from '@/components/booking/GuestMessageChannelSelect';
import type { GuestMessageChannel } from '@/lib/booking/guest-message-channel';
import { Pill, type PillVariant } from '@/components/ui/dashboard/Pill';
import { formatGuestDisplayName, splitLegacyGuestName } from '@/lib/guests/name';

export interface DetailPractitionerOption {
  id: string;
  name: string;
  is_active: boolean;
}

export interface DetailServiceOption {
  id: string;
  name: string;
  duration_minutes: number;
  colour: string;
  price_pence?: number | null;
}

/** List-row snapshot to paint the panel immediately before GET /bookings/[id] completes. */
export interface AppointmentDetailPrefetch {
  id: string;
  booking_date: string;
  booking_time: string;
  booking_end_time: string | null;
  status: string;
  practitioner_id: string | null;
  appointment_service_id: string | null;
  special_requests: string | null;
  internal_notes: string | null;
  client_arrived_at: string | null;
  guest_attendance_confirmed_at?: string | null;
  staff_attendance_confirmed_at?: string | null;
  deposit_amount_pence: number | null;
  deposit_status: string | null;
  resource_payment_requirement?: ClassPaymentRequirement | null;
  party_size: number;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  guest_visit_count: number | null;
}

interface GuestDetail {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  visit_count: number | null;
  customer_profile_notes?: string | null;
}

export interface BookingDetailRecord {
  id: string;
  booking_date: string;
  booking_time: string;
  booking_end_time: string | null;
  status: string;
  practitioner_id: string | null;
  appointment_service_id: string | null;
  special_requests: string | null;
  internal_notes: string | null;
  client_arrived_at: string | null;
  guest_attendance_confirmed_at?: string | null;
  staff_attendance_confirmed_at?: string | null;
  deposit_amount_pence: number | null;
  deposit_status: string | null;
  resource_payment_requirement?: ClassPaymentRequirement | null;
  party_size: number;
  source?: string | null;
  dietary_notes?: string | null;
  occasion?: string | null;
  guest: GuestDetail | null;
  experience_event_id?: string | null;
  class_instance_id?: string | null;
  resource_id?: string | null;
  event_session_id?: string | null;
  calendar_id?: string | null;
  service_item_id?: string | null;
  service_variant_id?: string | null;
  service_variant_name?: string | null;
  service_variant_price_pence?: number | null;
  cde_context?: {
    inferred_model: BookingModel;
    title: string;
    subtitle?: string | null;
  } | null;
  inferred_booking_model?: BookingModel;
  communications?: Array<{ id: string; message_type: string; channel: string; status: string; created_at: string }>;
}

function prefetchToDetailRecord(p: AppointmentDetailPrefetch): BookingDetailRecord {
  return {
    id: p.id,
    booking_date: p.booking_date,
    booking_time: p.booking_time,
    booking_end_time: p.booking_end_time,
    status: p.status,
    practitioner_id: p.practitioner_id,
    appointment_service_id: p.appointment_service_id,
    special_requests: p.special_requests,
    internal_notes: p.internal_notes,
    client_arrived_at: p.client_arrived_at,
    guest_attendance_confirmed_at: p.guest_attendance_confirmed_at ?? null,
    staff_attendance_confirmed_at: p.staff_attendance_confirmed_at ?? null,
    deposit_amount_pence: p.deposit_amount_pence,
    deposit_status: p.deposit_status,
    resource_payment_requirement: p.resource_payment_requirement ?? null,
    party_size: p.party_size,
    guest: (() => {
      const split = splitLegacyGuestName(p.guest_name);
      return {
        id: '__prefetch__',
        first_name: split.first || null,
        last_name: split.last || null,
        email: p.guest_email,
        phone: p.guest_phone,
        visit_count: p.guest_visit_count,
      };
    })(),
    communications: [],
  };
}

function appointmentDetailStatusVariant(status: string): PillVariant {
  switch (status) {
    case 'Pending':
      return 'warning';
    case 'Booked':
      return 'info';
    case 'Confirmed':
      return 'success';
    case 'Seated':
      return 'brand';
    case 'Completed':
      return 'success';
    case 'No-Show':
      return 'danger';
    case 'Cancelled':
      return 'neutral';
    default:
      return 'neutral';
  }
}

function inferredForDetail(d: BookingDetailRecord): BookingModel {
  return d.inferred_booking_model ?? inferBookingRowModel(d);
}

function isAppointmentStyleModel(m: BookingModel): boolean {
  return m === 'practitioner_appointment' || m === 'unified_scheduling';
}

function isCdeModelType(m: BookingModel): boolean {
  return m === 'event_ticket' || m === 'class_session' || m === 'resource_booking';
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

function formatMoneyPence(pence: number | null | undefined, sym: string): string {
  if (pence == null) return '-';
  return `${sym}${(pence / 100).toFixed(2)}`;
}

function resourcePaymentModeLabel(m: ClassPaymentRequirement | null | undefined): string {
  if (m === 'none') return 'Pay at venue';
  if (m === 'deposit') return 'Deposit (online)';
  if (m === 'full_payment') return 'Full payment (online)';
  return '—';
}

interface Props {
  open: boolean;
  bookingId: string | null;
  onClose: () => void;
  onUpdated: () => void;
  currency?: string;
  practitioners: DetailPractitionerOption[];
  services: DetailServiceOption[];
  /** When false, only appointment-style bookings should open this sheet */
  requirePractitionerBooking?: boolean;
  /** Same row as the list/calendar - shows full layout instantly while the detail request runs. */
  prefetchedBooking?: AppointmentDetailPrefetch | null;
}

export function AppointmentDetailSheet({
  open,
  bookingId,
  onClose,
  onUpdated,
  currency = 'GBP',
  practitioners,
  services,
  requirePractitionerBooking = true,
  prefetchedBooking = null,
}: Props) {
  const sym = currencySymbolFromCode(currency);
  const [detail, setDetail] = useState<BookingDetailRecord | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [graceMinutes, setGraceMinutes] = useState(15);
  const [editOpen, setEditOpen] = useState(false);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editPractitionerId, setEditPractitionerId] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [guestMessageDraft, setGuestMessageDraft] = useState('');
  const [guestMessageChannel, setGuestMessageChannel] = useState<GuestMessageChannel>('both');
  const [guestMessageSending, setGuestMessageSending] = useState(false);

  const prefetchRef = useRef(prefetchedBooking);
  prefetchRef.current = prefetchedBooking;

  const loadDetail = useCallback(async () => {
    if (!bookingId) return;
    const seeded = prefetchRef.current?.id === bookingId;
    if (!seeded) {
      setLoading(true);
      setDetail(null);
    } else {
      setRefreshing(true);
    }
    setLoadError(null);
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLoadError((data as { error?: string }).error ?? 'Could not load booking');
        if (!seeded) setDetail(null);
        return;
      }
      const data = (await res.json()) as BookingDetailRecord & {
        practitioner_id?: string | null;
        source?: string | null;
        dietary_notes?: string | null;
        occasion?: string | null;
      };
      const inferred = inferredForDetail(data);
      if (requirePractitionerBooking && inferred === 'table_reservation') {
        setLoadError('This booking is not available in this view.');
        setDetail(null);
        return;
      }
      setLoadError(null);
      setDetail(data);
      setNotesDraft(data.internal_notes ?? '');
    } catch {
      setLoadError('Could not load booking');
      if (!seeded) setDetail(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [bookingId, requirePractitionerBooking]);

  useLayoutEffect(() => {
    if (!open || !bookingId) return;
    if (prefetchedBooking && prefetchedBooking.id === bookingId) {
      setDetail(prefetchToDetailRecord(prefetchedBooking));
      setNotesDraft(prefetchedBooking.internal_notes ?? '');
      setLoadError(null);
      setLoading(false);
    }
  }, [open, bookingId, prefetchedBooking]);

  useEffect(() => {
    if (!open || !bookingId) {
      setDetail(null);
      setLoadError(null);
      setActionError(null);
      setEditOpen(false);
      setDeleteConfirmOpen(false);
      setRefreshing(false);
      setGuestMessageDraft('');
      return;
    }
    void loadDetail();
  }, [open, bookingId, loadDetail]);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const res = await fetch('/api/venue');
        if (res.ok) {
          const v = await res.json();
          const g = (v as { no_show_grace_minutes?: number }).no_show_grace_minutes;
          if (typeof g === 'number' && g >= 10 && g <= 60) setGraceMinutes(g);
        }
      } catch {
        /* keep default */
      }
    })();
  }, [open]);

  const serviceMap = new Map(services.map((s) => [s.id, s]));
  const activePractitioners = practitioners.filter((p) => p.is_active);

  const inferredModel = detail ? inferredForDetail(detail) : null;
  const isApptStyle = inferredModel != null && isAppointmentStyleModel(inferredModel);
  const isCde = inferredModel != null && isCdeModelType(inferredModel);

  async function patchJson(body: Record<string, unknown>): Promise<boolean> {
    if (!bookingId) return false;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Request failed' }));
        setActionError((data as { error?: string }).error ?? 'Update failed');
        return false;
      }
      await loadDetail();
      onUpdated();
      return true;
    } catch {
      setActionError('Network error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(next: BookingStatus) {
    await patchJson({ status: next });
  }

  async function toggleArrived(arrived: boolean) {
    await patchJson({ client_arrived: arrived });
  }

  async function toggleStaffAttendance() {
    if (!detail) return;
    const next = !detail.staff_attendance_confirmed_at;
    await patchJson({ staff_attendance_confirmed: next });
  }

  async function saveNotes() {
    await patchJson({ internal_notes: notesDraft.trim() || null });
  }

  async function sendGuestMessage() {
    if (!bookingId || !guestMessageDraft.trim()) return;
    setGuestMessageSending(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: guestMessageDraft.trim(), channel: guestMessageChannel }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        errors?: string[];
      };
      if (!res.ok || !data.success) {
        const detail =
          (data.errors && data.errors.length > 0
            ? data.errors.join('; ')
            : data.error) ?? 'Could not send message';
        setActionError(detail);
        return;
      }
      if (data.errors && data.errors.length > 0) {
        setActionError(`Partially sent — ${data.errors.join('; ')}`);
      }
      setGuestMessageDraft('');
      await loadDetail();
      onUpdated();
    } catch {
      setActionError('Network error');
    } finally {
      setGuestMessageSending(false);
    }
  }

  async function deleteBookingPermanently() {
    if (!bookingId) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Request failed' }));
        setActionError((data as { error?: string }).error ?? 'Delete failed');
        return;
      }
      setDeleteConfirmOpen(false);
      onClose();
      onUpdated();
    } catch {
      setActionError('Network error');
    } finally {
      setBusy(false);
    }
  }

  function openEditTime() {
    if (!detail) return;
    setEditDate(detail.booking_date);
    setEditTime(detail.booking_time.slice(0, 5));
    setEditPractitionerId(detail.practitioner_id ?? '');
    setEditOpen(true);
    setActionError(null);
  }

  async function submitEditTime() {
    if (!detail?.practitioner_id) return;
    const ok = await patchJson({
      booking_date: editDate,
      booking_time: editTime.length === 5 ? `${editTime}:00` : editTime,
      practitioner_id: editPractitionerId || detail.practitioner_id,
    });
    if (ok) setEditOpen(false);
  }

  const durationMins =
    detail?.booking_end_time != null
      ? timeToMinutes(detail.booking_end_time) - timeToMinutes(detail.booking_time)
      : isApptStyle
        ? (detail?.appointment_service_id ? serviceMap.get(detail.appointment_service_id)?.duration_minutes ?? 30 : 30)
        : 30;

  const endLabel = minutesToTime(timeToMinutes(detail?.booking_time ?? '00:00') + Math.max(durationMins, 0));

  const primary =
    detail && isBookingStatus(detail.status) ? BOOKING_PRIMARY_ACTIONS[detail.status as BookingStatus] : undefined;
  const revert =
    detail && isBookingStatus(detail.status) ? BOOKING_REVERT_ACTIONS[detail.status as BookingStatus] : undefined;

  const arrived = Boolean(detail?.client_arrived_at);
  const isHeldStatus =
    detail?.status === 'Confirmed' || detail?.status === 'Booked';
  const canNoShow =
    isHeldStatus &&
    canMarkNoShowForSlot(detail.booking_date, detail.booking_time, graceMinutes);
  const noShowGraceResult =
    isHeldStatus &&
    !canMarkNoShowForSlot(detail.booking_date, detail.booking_time, graceMinutes)
      ? validateNoShowGracePeriod(detail.booking_date, detail.booking_time, graceMinutes)
      : null;
  const noShowGraceBlockedReason =
    noShowGraceResult && !noShowGraceResult.ok ? noShowGraceResult.error : undefined;

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-[1px] lg:bg-slate-900/20"
        aria-hidden
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="appointment-detail-title"
        className="fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto rounded-t-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100 animate-slide-in-bottom lg:inset-y-0 lg:right-0 lg:left-auto lg:max-h-none lg:w-full lg:max-w-md lg:rounded-none lg:rounded-l-2xl lg:border-l lg:border-t-0 lg:border-r-0 lg:border-b-0 lg:animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-3 backdrop-blur lg:px-5">
          <div className="min-w-0">
            <h2 id="appointment-detail-title" className="text-lg font-semibold text-slate-900">
              {isCde ? 'Booking' : 'Appointment'}
            </h2>
            {refreshing && detail && (
              <p className="text-xs text-slate-400 motion-safe:animate-pulse">Syncing latest…</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-2 hover:bg-slate-100"
          >
            <svg className="h-5 w-5 text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 px-4 py-4 lg:px-5">
          {loading && !detail && (
            <div className="flex justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
            </div>
          )}
          {loadError && !loading && !detail && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</div>
          )}
          {loadError && detail && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{loadError}</div>
          )}
          {actionError && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>
          )}

          {detail && (
            <>
              {detail.cde_context && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700/80">Booking type</p>
                  <p className="text-sm font-semibold text-slate-900">
                    {bookingModelShortLabel(detail.cde_context.inferred_model)}
                  </p>
                  <p className="mt-1 text-sm text-slate-800">{detail.cde_context.title}</p>
                  {detail.cde_context.subtitle ? (
                    <p className="mt-0.5 text-xs text-slate-600">{detail.cde_context.subtitle}</p>
                  ) : null}
                </div>
              )}

              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xl font-semibold text-slate-900">
                    {formatGuestDisplayName(detail.guest?.first_name, detail.guest?.last_name)}
                  </span>
                  <Pill variant={appointmentDetailStatusVariant(detail.status)} size="sm" dot>
                    {bookingStatusDisplayLabel(
                      detail.status,
                      isTableReservationBooking(detail),
                    )}
                  </Pill>
                  {isApptStyle &&
                    arrived &&
                    detail.status !== 'Seated' &&
                    ['Pending', 'Booked', 'Confirmed'].includes(detail.status) && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-950 ring-1 ring-amber-300/70">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" aria-hidden />
                      Waiting
                    </span>
                  )}
                  {isApptStyle &&
                    showDepositPendingPill(detail) &&
                    ['Pending', 'Booked', 'Confirmed'].includes(detail.status) && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-950 ring-1 ring-orange-200/80"
                      title="Deposit not yet paid"
                    >
                      Deposit pending
                    </span>
                  )}
                  {isApptStyle &&
                    showAttendanceConfirmedSupplementPill(detail) &&
                    ['Pending', 'Booked', 'Confirmed'].includes(detail.status) && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-900 ring-1 ring-teal-200/80"
                      title={(() => {
                        const src = attendanceConfirmationSources(detail);
                        const parts: string[] = [];
                        if (src.guestAt) parts.push(`Guest: ${new Date(src.guestAt).toLocaleString('en-GB')}`);
                        if (src.staffAt) parts.push(`Staff: ${new Date(src.staffAt).toLocaleString('en-GB')}`);
                        return parts.length ? parts.join(' · ') : 'Confirmed';
                      })()}
                    >
                      Confirmed
                    </span>
                  )}
                </div>
              </div>

              {isApptStyle ? (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Client name</dt>
                  <dd className="mt-0.5 text-slate-900">
                    {detail.guest?.first_name || detail.guest?.last_name
                      ? formatGuestDisplayName(detail.guest.first_name, detail.guest.last_name)
                      : '-'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Email</dt>
                  <dd className="mt-0.5 break-all text-slate-700">
                    {detail.guest?.email ? (
                      <a href={`mailto:${detail.guest.email}`} className="text-brand-600 hover:underline">
                        {detail.guest.email}
                      </a>
                    ) : (
                      '-'
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Phone</dt>
                  <dd className="mt-0.5 text-slate-700">
                    {detail.guest?.phone ? (
                      <a href={`tel:${detail.guest.phone}`} className="text-brand-600 hover:underline">
                        {detail.guest.phone}
                      </a>
                    ) : (
                      '-'
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Visits recorded</dt>
                  <dd className="mt-0.5 text-slate-700">
                    {detail.guest?.visit_count != null ? (
                      <>
                        <span className="font-semibold tabular-nums">{detail.guest.visit_count}</span>
                        <span className="ml-1 text-xs text-slate-500">
                          (from guest profile when phone/email matches)
                        </span>
                      </>
                    ) : (
                      '-'
                    )}
                  </dd>
                </div>
                {detail.guest?.id && detail.guest.id !== '__prefetch__' ? (
                  <div className="sm:col-span-2">
                    <CustomerProfileNotesCard
                      embedded
                      guestId={detail.guest.id}
                      value={detail.guest.customer_profile_notes}
                      disabled={busy}
                      onSaved={() => {
                        void loadDetail();
                        onUpdated();
                      }}
                    />
                  </div>
                ) : null}
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Service</dt>
                  <dd className="mt-0.5 text-slate-900">
                    {(() => {
                      const baseName = detail.appointment_service_id
                        ? serviceMap.get(detail.appointment_service_id)?.name ?? null
                        : null;
                      const variantName = detail.service_variant_name ?? null;
                      if (baseName && variantName) return `${baseName} - ${variantName}`;
                      return baseName ?? variantName ?? '-';
                    })()}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Staff member</dt>
                  <dd className="mt-0.5 text-slate-900">
                    {practitioners.find((p) => p.id === detail.practitioner_id)?.name ?? '-'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Appointment time</dt>
                  <dd className="mt-0.5 font-medium text-slate-800">
                    {detail.booking_time.slice(0, 5)} – {endLabel}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Duration</dt>
                  <dd className="mt-0.5 text-slate-700">{durationMins} minutes</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Price</dt>
                  <dd className="mt-0.5 text-slate-700">
                    {(() => {
                      const variantPrice = detail.service_variant_price_pence;
                      if (variantPrice != null) {
                        return formatBookablePricePence(Number(variantPrice), sym);
                      }
                      if (
                        detail.appointment_service_id &&
                        serviceMap.get(detail.appointment_service_id)?.price_pence != null
                      ) {
                        return formatBookablePricePence(
                          Number(serviceMap.get(detail.appointment_service_id)?.price_pence),
                          sym,
                        );
                      }
                      return '-';
                    })()}
                  </dd>
                </div>
                {detail.deposit_amount_pence != null && detail.deposit_amount_pence > 0 && (
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Deposit</dt>
                    <dd className="mt-0.5 text-slate-700">
                      {formatMoneyPence(detail.deposit_amount_pence, sym)} ({detail.deposit_status ?? '-'})
                    </dd>
                  </div>
                )}
                {detail.source ? (
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Source</dt>
                    <dd className="mt-0.5 text-slate-700">{detail.source}</dd>
                  </div>
                ) : null}
                {detail.dietary_notes ? (
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Dietary</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-slate-700">{detail.dietary_notes}</dd>
                  </div>
                ) : null}
                {detail.occasion ? (
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Occasion</dt>
                    <dd className="mt-0.5 text-slate-700">{detail.occasion}</dd>
                  </div>
                ) : null}
                {isApptStyle &&
                  (detail.guest_attendance_confirmed_at || detail.staff_attendance_confirmed_at) && (
                    <div className="sm:col-span-2 rounded-lg border border-slate-100 bg-slate-50/80 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Attendance confirmation
                      </p>
                      {detail.guest_attendance_confirmed_at ? (
                        <p className="mt-1 text-sm text-slate-800">
                          Guest (link/SMS/email):{' '}
                          {new Date(detail.guest_attendance_confirmed_at).toLocaleString('en-GB')}
                        </p>
                      ) : null}
                      {detail.staff_attendance_confirmed_at ? (
                        <p className="mt-1 text-sm text-slate-800">
                          Staff:{' '}
                          {new Date(detail.staff_attendance_confirmed_at).toLocaleString('en-GB')}
                        </p>
                      ) : null}
                    </div>
                  )}
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Customer comments</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-slate-700">
                    {detail.special_requests?.trim() || '-'}
                  </dd>
                </div>
              </dl>
              ) : (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Date</dt>
                  <dd className="mt-0.5 text-slate-900">{detail.booking_date}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Time</dt>
                  <dd className="mt-0.5 font-medium text-slate-800">
                    {detail.booking_time.slice(0, 5)} – {endLabel}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Party size</dt>
                  <dd className="mt-0.5 text-slate-900">{detail.party_size}</dd>
                </div>
                {detail.guest?.id && detail.guest.id !== '__prefetch__' ? (
                  <div className="sm:col-span-2">
                    <CustomerProfileNotesCard
                      embedded
                      guestId={detail.guest.id}
                      value={detail.guest.customer_profile_notes}
                      disabled={busy}
                      onSaved={() => {
                        void loadDetail();
                        onUpdated();
                      }}
                    />
                  </div>
                ) : null}
                {inferredModel === 'resource_booking' ? (
                  <>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Payment</dt>
                      <dd className="mt-0.5 text-slate-700">
                        {resourcePaymentModeLabel(detail.resource_payment_requirement)}
                      </dd>
                    </div>
                    {detail.deposit_amount_pence != null && detail.deposit_amount_pence > 0 && (
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                          {detail.resource_payment_requirement === 'full_payment' ? 'Amount paid online' : 'Deposit'}
                        </dt>
                        <dd className="mt-0.5 text-slate-700">
                          {formatMoneyPence(detail.deposit_amount_pence, sym)} ({detail.deposit_status ?? '-'})
                        </dd>
                      </div>
                    )}
                    {(!detail.deposit_amount_pence || detail.deposit_amount_pence <= 0) &&
                      detail.resource_payment_requirement === 'none' && (
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Online payment</dt>
                          <dd className="mt-0.5 text-slate-700">Not taken (pay at venue)</dd>
                        </div>
                      )}
                  </>
                ) : detail.deposit_amount_pence != null && detail.deposit_amount_pence > 0 ? (
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Deposit</dt>
                    <dd className="mt-0.5 text-slate-700">
                      {formatMoneyPence(detail.deposit_amount_pence, sym)} ({detail.deposit_status ?? '-'})
                    </dd>
                  </div>
                ) : null}
                {detail.source ? (
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Source</dt>
                    <dd className="mt-0.5 text-slate-700">{detail.source}</dd>
                  </div>
                ) : null}
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Customer comments</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-slate-700">
                    {detail.special_requests?.trim() || '-'}
                  </dd>
                </div>
              </dl>
              )}

              <div>
                <label htmlFor="internal-notes-detail" className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Staff comments
                </label>
                <textarea
                  id="internal-notes-detail"
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  onBlur={() => {
                    if (busy) return;
                    if ((detail.internal_notes ?? '') !== notesDraft) {
                      void saveNotes();
                    }
                  }}
                  rows={3}
                  disabled={busy}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-60"
                  placeholder="Internal notes (visible to staff only)"
                />
                <button
                  type="button"
                  disabled={busy || notesDraft === (detail.internal_notes ?? '')}
                  onClick={() => void saveNotes()}
                  className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Save notes
                </button>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Message guest</p>
                {detail.communications && detail.communications.length > 0 && (
                  <div className="mt-2 max-h-28 space-y-1 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/80 p-2">
                    {detail.communications.slice(-5).map((c) => (
                      <div key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-600">
                        <span
                          className={`rounded px-1 py-0.5 text-[10px] font-semibold ${
                            c.channel === 'email' ? 'bg-blue-50 text-blue-800' : 'bg-green-50 text-green-800'
                          }`}
                        >
                          {c.channel}
                        </span>
                        <span className="text-slate-500">{c.message_type.replace(/_/g, ' ')}</span>
                        <span className={c.status === 'sent' ? 'text-emerald-600' : 'text-red-600'}>{c.status}</span>
                        <span className="text-slate-400">
                          {new Date(c.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500">Via</span>
                  <GuestMessageChannelSelect
                    value={guestMessageChannel}
                    onChange={setGuestMessageChannel}
                    disabled={guestMessageSending || busy}
                  />
                </div>
                <textarea
                  value={guestMessageDraft}
                  onChange={(e) => setGuestMessageDraft(e.target.value)}
                  rows={3}
                  disabled={guestMessageSending || busy}
                  placeholder="Email or SMS to the guest (uses templates and venue settings)"
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-60"
                />
                <button
                  type="button"
                  disabled={guestMessageSending || busy || guestMessageDraft.trim().length === 0}
                  onClick={() => void sendGuestMessage()}
                  className="mt-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-50"
                >
                  {guestMessageSending ? 'Sending…' : 'Send to guest'}
                </button>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Actions</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {isApptStyle && ['Pending', 'Booked', 'Confirmed'].includes(detail.status) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void toggleArrived(!arrived)}
                      className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-200 disabled:opacity-50"
                    >
                      {arrived ? 'Clear waiting' : 'Arrived'}
                    </button>
                  )}
                  {isApptStyle && ['Pending', 'Booked', 'Confirmed'].includes(detail.status) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void toggleStaffAttendance()}
                      className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-900 hover:bg-teal-100 disabled:opacity-50"
                    >
                      {detail.staff_attendance_confirmed_at
                        ? 'Clear staff attendance confirmation'
                        : 'Mark attendance confirmed (staff)'}
                    </button>
                  )}
                  {primary && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void setStatus(primary.target)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${
                        primary.label === 'Seat' && !isTableReservationBooking(detail)
                          ? BOOKING_START_PRIMARY_BUTTON_CLASSES
                          : 'border border-transparent bg-brand-600 hover:bg-brand-700'
                      }`}
                    >
                      {primary.label === 'Seat'
                        ? (isTableReservationBooking(detail) ? 'Seat' : 'Start')
                        : primary.label}
                    </button>
                  )}
                  {revert && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void setStatus(revert.target)}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      title={
                        detail.status === 'Seated' && !isTableReservationBooking(detail)
                          ? 'Return to booked; if they were marked arrived, waiting is restored'
                          : undefined
                      }
                    >
                      {detail.status === 'Seated' &&
                      revert.target === 'Booked' &&
                      !isTableReservationBooking(detail)
                        ? 'Undo Start'
                        : revert.label}
                    </button>
                  )}
                  {(detail.status === 'Confirmed' || detail.status === 'Booked') && (
                    <button
                      type="button"
                      disabled={busy || !canNoShow}
                      title={noShowGraceBlockedReason}
                      onClick={() => void setStatus('No-Show')}
                      className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Mark as no show
                    </button>
                  )}
                  {isBookingStatus(detail.status) &&
                    BOOKING_STATUS_TRANSITIONS[detail.status as BookingStatus].includes('Cancelled') && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void setStatus('Cancelled')}
                        className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    )}
                  {detail.practitioner_id && ['Pending', 'Booked', 'Confirmed', 'Seated'].includes(detail.status) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={openEditTime}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Edit time
                    </button>
                  )}
                  {detail.status === 'Cancelled' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setDeleteConfirmOpen(true)}
                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
                    >
                      Delete permanently
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {deleteConfirmOpen && detail && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !busy && setDeleteConfirmOpen(false)}
        >
          <div
            role="dialog"
            aria-labelledby="delete-booking-title"
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="delete-booking-title" className="text-base font-semibold text-slate-900">
              Delete booking permanently?
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              This removes the cancelled booking and its related staff logs from the system. This cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setDeleteConfirmOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void deleteBookingPermanently()}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editOpen && detail?.practitioner_id && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setEditOpen(false)}>
          <div
            role="dialog"
            aria-labelledby="edit-time-title"
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="edit-time-title" className="text-base font-semibold text-slate-900">
              Edit time
            </h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600">Date</label>
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Time</label>
                <input
                  type="time"
                  value={editTime}
                  onChange={(e) => setEditTime(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Practitioner</label>
                <select
                  value={editPractitionerId}
                  onChange={(e) => setEditPractitionerId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {activePractitioners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submitEditTime()}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
