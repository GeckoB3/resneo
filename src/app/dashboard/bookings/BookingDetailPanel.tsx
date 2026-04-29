'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BOOKING_STATUS_TRANSITIONS, BOOKING_REVERT_ACTIONS, canMarkNoShowForSlot, isDestructiveBookingStatus, isRevertTransition, type BookingStatus } from '@/lib/table-management/booking-status';
import { NumericInput } from '@/components/ui/NumericInput';
import { PhoneWithCountryField } from '@/components/phone/PhoneWithCountryField';
import { normalizeToE164 } from '@/lib/phone/e164';
import { defaultPhoneCountryForVenueCurrency } from '@/lib/phone/default-country';
import type { CountryCode } from 'libphonenumber-js';
import { ModifyBookingInline } from '@/components/booking/ModifyBookingInline';
import { BookingNotesEditablePanel } from '@/components/booking/BookingNotesEditablePanel';
import { CustomerProfileNotesCard } from '@/components/booking/CustomerProfileNotesCard';
import { GuestTagEditor } from '@/components/dashboard/GuestTagEditor';
import type { BookingNotesVariant } from '@/components/booking/BookingNotesEditablePanel';
import type { BookingModel } from '@/types/booking-models';
import { bookingStatusDisplayLabel } from '@/lib/booking/infer-booking-row-model';
import { GuestMessageChannelSelect } from '@/components/booking/GuestMessageChannelSelect';
import type { GuestMessageChannel } from '@/lib/booking/guest-message-channel';
import { Pill, type PillVariant } from '@/components/ui/dashboard/Pill';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';

function detailStatusPillVariant(status: string): PillVariant {
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
      return 'neutral';
    case 'No-Show':
      return 'danger';
    case 'Cancelled':
      return 'neutral';
    default:
      return 'neutral';
  }
}

interface Guest {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  visit_count: number;
  tags?: string[];
  /** Staff notes on the guest profile; shown on every booking for this customer. */
  customer_profile_notes?: string | null;
}

interface EventRow {
  id: string;
  event_type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

interface CommRow {
  id: string;
  message_type: string;
  channel: string;
  status: string;
  created_at: string;
}

interface BookingDetail {
  id: string;
  venue_id: string;
  created_at?: string;
  created_by?: string | null;
  booking_date: string;
  booking_time: string;
  estimated_end_time: string | null;
  party_size: number;
  status: string;
  source: string;
  service_id?: string | null;
  deposit_status: string;
  deposit_amount_pence: number | null;
  dietary_notes: string | null;
  occasion: string | null;
  special_requests: string | null;
  internal_notes: string | null;
  cancellation_deadline: string | null;
  guest: Guest | null;
  events: EventRow[];
  communications: CommRow[];
  table_assignments?: Array<{ id: string; name: string }>;
  /** Staff-only note from table combination rules when multiple tables assigned. */
  combination_staff_notes?: string | null;
  /** Set by GET /api/venue/bookings/[id] for notes UI (table vs C/D/E). */
  inferred_booking_model?: BookingModel;
  area_id?: string | null;
  area_name?: string | null;
}

function timeToMinutes(value: string): number {
  const [h, m] = value.slice(0, 5).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function minutesToTime(value: number): string {
  const safe = ((value % (24 * 60)) + (24 * 60)) % (24 * 60);
  const h = Math.floor(safe / 60).toString().padStart(2, '0');
  const m = (safe % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

/** HH:mm from DB ISO timestamp; null if missing or unparseable (avoids Invalid Date / RangeError on toISOString). */
function estimatedEndToHHMM(iso: string | null | undefined): string | null {
  if (iso == null || typeof iso !== 'string' || !iso.trim()) return null;
  const d = new Date(iso.trim());
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(11, 16);
  }
  const afterT = iso.includes('T') ? iso.split('T')[1] : null;
  const hm = (afterT ?? iso).slice(0, 5);
  if (/^\d{2}:\d{2}$/.test(hm)) return hm;
  return null;
}

function endHHMMOrFallback(iso: string | null | undefined, startHHMM: string, fallbackDurationMins: number): string {
  const parsed = estimatedEndToHHMM(iso);
  if (parsed) return parsed;
  return minutesToTime(timeToMinutes(startHHMM) + fallbackDurationMins);
}

interface AssignmentSuggestion {
  source: 'single' | 'auto' | 'manual';
  table_ids: string[];
  table_names: string[];
  combined_capacity: number;
  spare_covers: number;
}

/** Shown immediately when opening from table grid / floor plan before GET completes. */
export interface BookingDetailPanelSnapshot {
  bookingDate: string;
  guestName: string;
  partySize: number;
  status: string;
  startTime: string;
  endTime: string;
  dietaryNotes?: string | null;
  occasion?: string | null;
  specialRequests?: string | null;
  depositStatus?: string | null;
  /** Display-only until the booking payload hydrates. */
  tableNames?: string[];
}

function formatDateNice(value: string): string {
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Seat/Unseat vs Start/Undo Start: table reservations vs appointments & C/D/E. */
function isTableStyleBookingDetail(
  d: BookingDetail | null | undefined,
  isAppointmentFlag: boolean,
): boolean {
  const m = d?.inferred_booking_model;
  if (m === 'table_reservation') return true;
  if (m != null) return false;
  return !isAppointmentFlag;
}

function buildPlaceholderDetail(
  id: string,
  vId: string,
  snap: BookingDetailPanelSnapshot
): BookingDetail {
  const startTime = snap.startTime.slice(0, 5);
  const endTimeRaw = snap.endTime?.trim() ? snap.endTime.slice(0, 5) : '';
  const endTime = /^\d{2}:\d{2}$/.test(endTimeRaw)
    ? endTimeRaw
    : minutesToTime(timeToMinutes(startTime) + 90);
  const estimatedEndIso = `${snap.bookingDate}T${endTime}:00.000Z`;
  const estimatedEndDate = new Date(estimatedEndIso);
  return {
    id,
    venue_id: vId,
    booking_date: snap.bookingDate,
    booking_time: startTime,
    estimated_end_time: Number.isNaN(estimatedEndDate.getTime()) ? null : estimatedEndIso,
    party_size: snap.partySize,
    status: snap.status,
    source: '-',
    deposit_status: snap.depositStatus ?? 'Pending',
    deposit_amount_pence: null,
    dietary_notes: snap.dietaryNotes ?? null,
    occasion: snap.occasion ?? null,
    special_requests: snap.specialRequests ?? null,
    internal_notes: null,
    cancellation_deadline: null,
    guest: { id: '', name: snap.guestName, email: null, phone: null, visit_count: 0, tags: [] },
    events: [],
    communications: [],
    table_assignments: [],
  };
}

export function BookingDetailPanel({
  bookingId,
  onClose,
  onUpdated,
  venueId,
  venueCurrency,
  initialSnapshot,
  isAppointment = false,
}: {
  bookingId: string;
  onClose: () => void;
  onUpdated: () => void;
  /** Required for optimistic placeholder from grid/floor views. */
  venueId?: string;
  venueCurrency?: string;
  initialSnapshot?: BookingDetailPanelSnapshot | null;
  isAppointment?: boolean;
}) {
  const guestPhoneDefaultCountry: CountryCode = useMemo(
    () => defaultPhoneCountryForVenueCurrency(venueCurrency),
    [venueCurrency],
  );
  const [detail, setDetail] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showModify, setShowModify] = useState(false);
  const [modifyDurationMinutes, setModifyDurationMinutes] = useState(90);
  const [modifyGuestName, setModifyGuestName] = useState('');
  const [modifyGuestPhone, setModifyGuestPhone] = useState('');
  const [modifyGuestEmail, setModifyGuestEmail] = useState('');
  const [modifyDietary, setModifyDietary] = useState('');
  const [modifyOccasion, setModifyOccasion] = useState('');
  const [modifySpecialRequests, setModifySpecialRequests] = useState('');
  const [modifyInternalNotes, setModifyInternalNotes] = useState('');
  const [modifyTableIds, setModifyTableIds] = useState<string[]>([]);
  const [assignedTables, setAssignedTables] = useState<Array<{ id: string; name: string }>>([]);
  const [allTables, setAllTables] = useState<Array<{ id: string; name: string; max_covers: number }>>([]);
  const [tableManagementEnabled, setTableManagementEnabled] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [recommendedTableIds, setRecommendedTableIds] = useState<string[]>([]);
  const [customMessage, setCustomMessage] = useState('');
  const [guestMessageChannel, setGuestMessageChannel] = useState<GuestMessageChannel>('both');
  const [assignmentSuggestions, setAssignmentSuggestions] = useState<AssignmentSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel: string; onConfirm: () => void } | null>(null);

  const optimisticDetail = useMemo(() => {
    if (!initialSnapshot || !venueId) return null;
    return buildPlaceholderDetail(bookingId, venueId, initialSnapshot);
  }, [bookingId, venueId, initialSnapshot]);

  const displayDetail = detail ?? optimisticDetail;
  const isHydrated = detail !== null;

  const notesVariant: BookingNotesVariant = useMemo(() => {
    const m = displayDetail?.inferred_booking_model;
    if (m === 'table_reservation') return 'table';
    if (m != null) return 'cde';
    return isAppointment ? 'cde' : 'table';
  }, [displayDetail?.inferred_booking_model, isAppointment]);

  const load = useCallback(async () => {
    const [bookingRes, tablesRes] = await Promise.all([
      fetch(`/api/venue/bookings/${bookingId}`),
      fetch('/api/venue/tables'),
    ]);

    if (!bookingRes.ok) {
      setError(bookingRes.status === 404 ? 'Booking not found' : 'Failed to load booking');
      return;
    }

    const data = (await bookingRes.json()) as BookingDetail;
    setDetail(data);
    const startMinutes = timeToMinutes(data.booking_time?.slice(0, 5) ?? '12:00');
    const endHHMM = endHHMMOrFallback(data.estimated_end_time, data.booking_time?.slice(0, 5) ?? '12:00', 90);
    const endMinutes = timeToMinutes(endHHMM);
    setModifyDurationMinutes(Math.max(15, endMinutes - startMinutes));
    setModifyGuestName(data.guest?.name ?? '');
    setModifyGuestPhone(data.guest?.phone ?? '');
    setModifyGuestEmail(data.guest?.email ?? '');
    setModifyDietary(data.dietary_notes ?? '');
    setModifyOccasion(data.occasion ?? '');
    setModifySpecialRequests(data.special_requests ?? '');
    setModifyInternalNotes(data.internal_notes ?? '');
    setModifyTableIds((data.table_assignments ?? []).map((t: { id: string }) => t.id));

    try {
      if (tablesRes.ok) {
        const tablesData = await tablesRes.json();
        setTableManagementEnabled(tablesData.settings?.table_management_enabled ?? false);
        setAllTables((tablesData.tables ?? []).filter((t: { is_active: boolean }) => t.is_active).map((t: { id: string; name: string; max_covers: number }) => ({ id: t.id, name: t.name, max_covers: t.max_covers })));

        if (data.table_assignments) {
          setAssignedTables(data.table_assignments);
        } else {
          setAssignedTables([]);
        }
      }
    } catch {
      // Table data is supplementary
    }

    try {
      const availabilityRes = await fetch(`/api/venue/tables/availability?date=${data.booking_date}`);
      if (availabilityRes.ok) {
        const availability = await availabilityRes.json();
        const time = (data.booking_time ?? '').slice(0, 5);
        const availableAtTime = new Set<string>(
          (availability.cells ?? [])
            .filter((cell: { time: string; is_available: boolean }) => cell.time === time && cell.is_available)
            .map((cell: { table_id: string }) => cell.table_id),
        );
        const fitting = (availability.tables ?? [])
          .filter((table: { id: string; max_covers: number }) => availableAtTime.has(table.id) && table.max_covers >= data.party_size)
          .map((table: { id: string }) => table.id);
        setRecommendedTableIds(fitting);
      }
    } catch {
      setRecommendedTableIds([]);
    }
  }, [bookingId]);

  const loadAssignmentSuggestions = useCallback(async () => {
    if (!detail) return;
    setSuggestionsLoading(true);
    try {
      const params = new URLSearchParams({
        date: detail.booking_date,
        time: detail.booking_time.slice(0, 5),
        party_size: String(detail.party_size),
        booking_id: detail.id,
      });
      if (detail.area_id) {
        params.set('area_id', detail.area_id);
      }
      const res = await fetch(`/api/venue/tables/combinations/suggest?${params.toString()}`);
      if (!res.ok) {
        setAssignmentSuggestions([]);
        return;
      }
      const payload = await res.json();
      setAssignmentSuggestions(payload.suggestions ?? []);
    } catch {
      setAssignmentSuggestions([]);
    } finally {
      setSuggestionsLoading(false);
    }
  }, [detail]);

  useEffect(() => {
    if (!showAssignModal) return;
    void loadAssignmentSuggestions();
  }, [showAssignModal, loadAssignmentSuggestions]);

  useEffect(() => {
    setDetail(null);
    setCustomMessage('');
    setShowModify(false);
    setShowAssignModal(false);
    setLoading(true);
    setError(null);
    void load().finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const executeStatusChange = useCallback(async (newStatus: string) => {
    if (!detail) return;
    const previous = detail.status;
    setActionLoading(true);
    setDetail((prev) => prev ? { ...prev, status: newStatus } : prev);
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? 'Failed');
        setDetail((prev) => prev ? { ...prev, status: previous } : prev);
        return;
      }
      setError(null);
      await load();
      onUpdated();
    } finally { setActionLoading(false); }
  }, [bookingId, detail, load, onUpdated]);

  const executePermanentDelete = useCallback(async () => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError((j as { error?: string }).error ?? 'Could not delete booking');
        return;
      }
      onUpdated();
      onClose();
    } finally {
      setActionLoading(false);
    }
  }, [bookingId, onUpdated, onClose]);

  const updateStatus = useCallback(async (newStatus: string) => {
    if (!detail) return;
    if (newStatus === 'No-Show' && !canMarkNoShowForSlot(detail.booking_date, detail.booking_time?.slice(0, 5) ?? '12:00', 0)) {
      setError('No-show can only be marked after the booking start time');
      return;
    }
    const currentStatus = detail.status as BookingStatus;
    const revert = isRevertTransition(currentStatus, newStatus);
    if (revert) {
      const revertAction = BOOKING_REVERT_ACTIONS[currentStatus];
      const tableStyle = isTableStyleBookingDetail(detail, isAppointment);
      const confirmLabel =
        currentStatus === 'Seated' && newStatus === 'Booked' && !tableStyle
          ? 'Undo Start'
          : revertAction?.label ?? `Revert to ${newStatus}`;
      setConfirmDialog({
        title: confirmLabel,
        message: `${detail.guest?.name ?? 'Guest'} (${detail.party_size}) at ${detail.booking_time?.slice(0, 5) ?? ''} on ${detail.booking_date} will be changed from ${detail.status} back to ${newStatus}.`,
        confirmLabel,
        onConfirm: () => { void executeStatusChange(newStatus); },
      });
      return;
    }
    if (isDestructiveBookingStatus(newStatus)) {
      setConfirmDialog({
        title: `Mark ${newStatus}`,
        message: `${detail.guest?.name ?? 'Guest'} (${detail.party_size}) at ${detail.booking_time?.slice(0, 5) ?? ''} on ${detail.booking_date} will be marked ${newStatus}.`,
        confirmLabel: `Mark ${newStatus}`,
        onConfirm: () => { void executeStatusChange(newStatus); },
      });
      return;
    }
    void executeStatusChange(newStatus);
  }, [detail, executeStatusChange, isAppointment]);

  const submitModify = useCallback(async () => {
    if (!detail) return;
    setActionLoading(true);
    try {
      const currentTime = detail.booking_time?.slice(0, 5) ?? '12:00';

      const phoneTrim = modifyGuestPhone.trim();
      const guestPhoneNormalized = phoneTrim ? normalizeToE164(modifyGuestPhone, guestPhoneDefaultCountry) : null;
      if (phoneTrim && !guestPhoneNormalized) {
        setError('Enter a valid phone number');
        setActionLoading(false);
        return;
      }

      const metadataPayload: Record<string, unknown> = {
        guest_name: modifyGuestName,
        guest_phone: guestPhoneNormalized,
        guest_email: modifyGuestEmail,
        occasion: modifyOccasion,
        special_requests: modifySpecialRequests,
        internal_notes: modifyInternalNotes,
      };
      if (notesVariant === 'table') {
        metadataPayload.dietary_notes = modifyDietary;
      }

      const metadataRes = await fetch(`/api/venue/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metadataPayload),
      });
      if (!metadataRes.ok) {
        const payload = await metadataRes.json().catch(() => ({}));
        setError(payload.error ?? 'Failed to update booking details');
        return;
      }

      const expectedEnd = minutesToTime(timeToMinutes(currentTime) + modifyDurationMinutes);
      const currentEnd = endHHMMOrFallback(detail.estimated_end_time, currentTime, 90);
      if (expectedEnd !== currentEnd) {
        const resizeRes = await fetch('/api/venue/tables/assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'change_time',
            booking_id: bookingId,
            new_time: currentTime,
            new_estimated_end_time: `${detail.booking_date}T${expectedEnd}:00.000Z`,
          }),
        });
        if (!resizeRes.ok) {
          const payload = await resizeRes.json().catch(() => ({}));
          setError(payload.error ?? 'Failed to update booking duration');
          return;
        }
      }

      const oldTableIds = assignedTables.map((table) => table.id).sort();
      const newTableIds = [...modifyTableIds].sort();
      if (oldTableIds.join('|') !== newTableIds.join('|')) {
        const assignBody = newTableIds.length === 0
          ? { action: 'unassign', booking_id: bookingId }
          : oldTableIds.length > 0
          ? {
              action: 'reassign',
              booking_id: bookingId,
              old_table_ids: oldTableIds,
              new_table_ids: newTableIds,
            }
          : {
              booking_id: bookingId,
              table_ids: newTableIds,
            };
        const assignRes = await fetch('/api/venue/tables/assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(assignBody),
        });
        if (!assignRes.ok) {
          const payload = await assignRes.json().catch(() => ({}));
          setError(payload.error ?? 'Failed to update table assignment');
          return;
        }
      }

      setError(null);
      setShowModify(false);
      await load();
      onUpdated();
    } finally { setActionLoading(false); }
  }, [
    detail,
    bookingId,
    modifyDurationMinutes,
    modifyGuestName,
    modifyGuestPhone,
    modifyGuestEmail,
    modifyDietary,
    modifyOccasion,
    modifySpecialRequests,
    modifyInternalNotes,
    modifyTableIds,
    assignedTables,
    load,
    onUpdated,
    notesVariant,
    guestPhoneDefaultCountry,
  ]);

  const runDepositAction = useCallback(async (action: 'send_payment_link' | 'waive' | 'record_cash' | 'refund') => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}/deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? 'Deposit action failed');
        return;
      }
      setError(null);
      await load();
      onUpdated();
    } finally {
      setActionLoading(false);
    }
  }, [bookingId, load, onUpdated]);

  if (!displayDetail) {
    return (
      <div
        className="fixed inset-0 z-50 flex justify-end bg-slate-900/25 backdrop-blur-[2px]"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Booking detail panel"
          className="flex w-full max-w-sm flex-col border-l border-slate-200/80 bg-white shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100 lg:rounded-l-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div className="h-4 w-28 animate-pulse rounded bg-slate-200" />
            <div className="h-8 w-8 animate-pulse rounded-lg bg-slate-100" />
          </div>
          <div className="animate-pulse space-y-3 p-4">
            <div className="h-20 rounded-xl bg-slate-100" />
            <div className="grid grid-cols-2 gap-2">
              <div className="h-14 rounded-lg bg-slate-100" />
              <div className="h-14 rounded-lg bg-slate-100" />
              <div className="h-14 rounded-lg bg-slate-100" />
              <div className="h-14 rounded-lg bg-slate-100" />
            </div>
          </div>
          {error && (
            <div className="mx-4 mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
              <button type="button" onClick={onClose} className="mt-2 block text-[11px] font-medium text-brand-600 hover:text-brand-700">
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const d = displayDetail;
  const optimisticTableLabel =
    !isHydrated && initialSnapshot?.tableNames && initialSnapshot.tableNames.length > 0
      ? initialSnapshot.tableNames.join(' + ')
      : null;

  const depositPaid = d.deposit_status === 'Paid' && d.deposit_amount_pence;
  const depositAmountStr = d.deposit_amount_pence ? `£${(d.deposit_amount_pence / 100).toFixed(2)}` : null;
  const nextStatuses = BOOKING_STATUS_TRANSITIONS[d.status as BookingStatus] ?? [];
  const canChangeStatus = nextStatuses.length > 0;
  const bookingStyleIsTable = isTableStyleBookingDetail(d, isAppointment);
  const currentStatus = d.status as BookingStatus;
  const forwardStatuses = nextStatuses.filter((status) => !isRevertTransition(currentStatus, status));
  const statusRevertAction = BOOKING_REVERT_ACTIONS[currentStatus];
  const forwardLabel = (status: BookingStatus) => {
    if (status === 'Seated') return bookingStyleIsTable ? 'Seat' : 'Start';
    if (status === 'Completed') return 'Complete';
    if (status === 'Cancelled') return 'Cancel';
    return status;
  };
  const revertLabel =
    statusRevertAction &&
    currentStatus === 'Seated' &&
    statusRevertAction.target === 'Booked' &&
    !bookingStyleIsTable
      ? 'Undo Start'
      : statusRevertAction?.label;
  const confirmationSentAt = d.communications.find(
    (comm) =>
      comm.message_type === 'booking_confirmation_email' ||
      comm.message_type === 'booking_confirmation_sms',
  )?.created_at;
  const startTime = d.booking_time?.slice(0, 5) ?? '00:00';
  const endTime = endHHMMOrFallback(d.estimated_end_time, startTime, 90);
  const durationMinutes = Math.max(15, timeToMinutes(endTime) - timeToMinutes(startTime));
  const tableLine =
    optimisticTableLabel ??
    (assignedTables.length > 0 ? assignedTables.map((table) => table.name).join(' + ') : null);
  const hasAssignedTable = Boolean(tableLine);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/25 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Booking detail panel"
        className="w-full max-w-md overflow-y-auto border-l border-slate-200/80 bg-white shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100 lg:rounded-l-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - compact */}
        <div className="sticky top-0 z-10 border-b border-slate-100 bg-gradient-to-br from-white via-white to-brand-50/70 px-4 py-3 backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-semibold text-slate-900">{d.guest?.name ?? 'Booking'}</h2>
                <Pill variant={detailStatusPillVariant(d.status)} size="sm" dot className="shrink-0">
                  {bookingStatusDisplayLabel(d.status, bookingStyleIsTable)}
                </Pill>
                {loading && optimisticDetail != null && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
                    Syncing
                  </span>
                )}
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium text-slate-600">
                <span>{formatDateNice(d.booking_date)}</span>
                <span className="text-slate-300">·</span>
                <span className="tabular-nums">{startTime} - {endTime}</span>
                <span className="text-slate-300">·</span>
                <span>{d.party_size} cover{d.party_size === 1 ? '' : 's'}</span>
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                <span className="font-mono">#{d.id.slice(0, 8)}</span>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(d.id)}
                  className="rounded border border-slate-200 px-1 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-50"
                >
                  Copy
                </button>
              </p>
            </div>
            <button type="button" aria-label="Close booking detail" onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="space-y-3 p-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
          )}

          <SectionCard className="border-brand-200 bg-gradient-to-br from-brand-50 via-white to-white">
            <SectionCard.Body className="p-3.5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-brand-600">Booking slot</p>
                  <p className="mt-1 text-2xl font-bold tracking-tight text-slate-950 tabular-nums">{startTime} - {endTime}</p>
                  <p className="mt-1 text-xs text-slate-600">
                    {durationMinutes} min · {d.party_size} cover{d.party_size === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:min-w-40">
                  <div className={`rounded-xl border px-3 py-2 ${hasAssignedTable ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Table</p>
                    <p className={`mt-0.5 truncate text-sm font-bold ${hasAssignedTable ? 'text-emerald-900' : 'text-amber-800'}`}>
                      {tableLine ?? 'Unassigned'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Deposit</p>
                    <p className={`mt-0.5 truncate text-sm font-bold ${
                      d.deposit_status === 'Paid'
                        ? 'text-emerald-700'
                        : d.deposit_status === 'Pending'
                          ? 'text-amber-700'
                          : 'text-slate-700'
                    }`}>
                      {depositPaid && depositAmountStr
                        ? `${depositAmountStr} paid`
                        : d.deposit_status === 'Not Required'
                          ? 'None'
                          : d.deposit_status}
                    </p>
                  </div>
                </div>
              </div>
            </SectionCard.Body>
          </SectionCard>

          {canChangeStatus && (
            <SectionCard>
              <SectionCard.Body className="p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Next action</p>
                    <p className="mt-0.5 text-xs text-slate-500">Update this booking without leaving the grid.</p>
                  </div>
                  <Pill variant={detailStatusPillVariant(d.status)} size="sm" dot>
                    {bookingStatusDisplayLabel(d.status, bookingStyleIsTable)}
                  </Pill>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {forwardStatuses.map((status) => (
                    <ActionButton
                      key={status}
                      onClick={() => updateStatus(status)}
                      disabled={actionLoading || !isHydrated}
                      variant={status === 'Cancelled' ? 'outline-danger' : status === 'No-Show' ? 'danger' : 'primary'}
                    >
                      {forwardLabel(status)}
                    </ActionButton>
                  ))}
                  {statusRevertAction && (
                    <ActionButton
                      onClick={() => updateStatus(statusRevertAction.target)}
                      disabled={actionLoading || !isHydrated}
                      variant="secondary"
                    >
                      {revertLabel}
                    </ActionButton>
                  )}
                </div>
              </SectionCard.Body>
            </SectionCard>
          )}

          {/* Guest + summary row */}
          <div className="grid gap-2.5">
            <SectionCard>
              <SectionCard.Body className="p-3.5">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-sm font-bold text-brand-700 ring-1 ring-brand-100">
                    {(d.guest?.name ?? '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-900">{d.guest?.name ?? 'Guest'}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {(d.guest?.visit_count ?? 0) > 0 ? `${d.guest?.visit_count} visit${(d.guest?.visit_count ?? 0) !== 1 ? 's' : ''}` : 'First visit'}
                    </p>
                  </div>
                </div>
                <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                  {d.guest?.email ? (
                    <a href={`mailto:${d.guest.email}`} className="flex items-center gap-2 text-xs text-slate-600 transition-colors hover:text-brand-600">
                      <svg className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" /></svg>
                      <span className="truncate">{d.guest.email}</span>
                    </a>
                  ) : (
                    <p className="text-xs italic text-slate-400">No email on file</p>
                  )}
                  {d.guest?.phone ? (
                    <a href={`tel:${d.guest.phone}`} className="flex items-center gap-2 text-xs text-slate-600 transition-colors hover:text-brand-600">
                      <svg className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" /></svg>
                      {d.guest.phone}
                    </a>
                  ) : (
                    <p className="text-xs italic text-slate-400">No phone on file</p>
                  )}
                  {d.guest?.id ? (
                    <div className="pt-1">
                      <GuestTagEditor
                        tags={Array.isArray(d.guest.tags) ? d.guest.tags : []}
                        venueId={d.venue_id}
                        onTagsChange={async (nextTags) => {
                          const res = await fetch(`/api/venue/guests/${d.guest!.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ tags: nextTags }),
                          });
                          if (!res.ok) {
                            const j = (await res.json().catch(() => ({}))) as { error?: string };
                            throw new Error(typeof j.error === 'string' ? j.error : 'Could not save tags');
                          }
                          await load();
                          onUpdated();
                        }}
                      />
                    </div>
                  ) : null}
                  {d.guest?.id ? (
                    <CustomerProfileNotesCard
                      embedded
                      guestId={d.guest.id}
                      value={d.guest.customer_profile_notes}
                      disabled={!isHydrated}
                      onSaved={() => {
                        void (async () => {
                          await load();
                          onUpdated();
                        })();
                      }}
                    />
                  ) : null}
                </div>
              </SectionCard.Body>
            </SectionCard>

            <SectionCard>
              <SectionCard.Body className="p-3.5">
                <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                  <CompactInfo label="Date" value={formatDateNice(d.booking_date)} />
                  <CompactInfo label="Time" value={`${startTime} – ${endTime}`} />
                  {d.area_name ? <CompactInfo label="Area" value={d.area_name} /> : null}
                  <CompactInfo label="Covers" value={String(d.party_size)} />
                  <CompactInfo
                    label="Deposit"
                    value={
                      depositPaid && depositAmountStr
                        ? `${depositAmountStr} paid`
                        : d.deposit_status === 'Not Required'
                          ? 'None'
                          : d.deposit_status
                    }
                    valueClass={
                      d.deposit_status === 'Paid'
                        ? 'text-emerald-700'
                        : d.deposit_status === 'Pending'
                          ? 'text-amber-700'
                          : 'text-slate-600'
                    }
                  />
                  <CompactInfo label="Duration" value={`${durationMinutes} min`} />
                  <CompactInfo label="Source" value={d.source} />
                </div>
                {isHydrated && (
                  <div className="mt-2.5 border-t border-slate-100 pt-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Created</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {d.created_at ? new Date(d.created_at).toLocaleString() : '—'}
                      {d.created_by ? ` · ${d.created_by}` : ''}
                    </p>
                  </div>
                )}
              </SectionCard.Body>
            </SectionCard>
          </div>

          {confirmationSentAt && (
            <p className="text-[11px] text-slate-500">Confirmation sent {new Date(confirmationSentAt).toLocaleString()}</p>
          )}
          <button
            type="button"
            disabled={actionLoading || !isHydrated}
            onClick={async () => {
              setActionLoading(true);
              try {
                const res = await fetch(`/api/venue/bookings/${bookingId}/resend-confirmation`, { method: 'POST' });
                if (!res.ok) {
                  const payload = await res.json().catch(() => ({}));
                  setError(payload.error ?? 'Failed to resend confirmation');
                  return;
                }
                setError(null);
                await load();
              } finally {
                setActionLoading(false);
              }
            }}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Resend confirmation
          </button>

          <SectionCard>
            <SectionCard.Body className="p-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Deposit</p>
                {d.deposit_status === 'Paid' && (
                  <Pill variant="success" size="sm" dot>{depositAmountStr ? `${depositAmountStr} paid` : 'Paid'}</Pill>
                )}
                {d.deposit_status === 'Refunded' && (
                  <Pill variant="brand" size="sm">{depositAmountStr ? `${depositAmountStr} refunded` : 'Refunded'}</Pill>
                )}
                {d.deposit_status === 'Pending' && (
                  <Pill variant="warning" size="sm" dot>Pending</Pill>
                )}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {d.deposit_status !== 'Paid' && d.deposit_status !== 'Refunded' && (
                  <>
                    <button
                      type="button"
                      disabled={actionLoading || !isHydrated}
                      onClick={() => runDepositAction('send_payment_link')}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                    >
                      Send payment link
                    </button>
                    <button
                      type="button"
                      disabled={actionLoading || !isHydrated}
                      onClick={() => runDepositAction('waive')}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                    >
                      Waive
                    </button>
                    <button
                      type="button"
                      disabled={actionLoading || !isHydrated}
                      onClick={() => runDepositAction('record_cash')}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                    >
                      Record cash
                    </button>
                  </>
                )}
                {d.deposit_status === 'Paid' && (
                  <button
                    type="button"
                    disabled={actionLoading || !isHydrated}
                    onClick={() => runDepositAction('refund')}
                    className="rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
                  >
                    Refund deposit
                  </button>
                )}
              </div>
            </SectionCard.Body>
          </SectionCard>

          {/* Table assignment */}
          {(tableManagementEnabled || assignedTables.length > 0) && (() => {
            const tableLine =
              optimisticTableLabel ??
              (assignedTables.length > 0 ? assignedTables.map((t) => t.name).join(' + ') : null);
            const hasTable = Boolean(tableLine);
            return (
              <SectionCard className={!hasTable ? 'border-amber-200 bg-amber-50/40' : ''}>
                <SectionCard.Body className="p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Table</p>
                      <p className={`mt-0.5 truncate text-sm font-semibold ${hasTable ? 'text-slate-900' : 'text-amber-700'}`}>
                        {hasTable ? tableLine : 'No table assigned'}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={!isHydrated || actionLoading}
                      onClick={() => setShowAssignModal(true)}
                      className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                    >
                      {hasTable ? 'Reassign' : 'Assign'}
                    </button>
                  </div>
                  {isHydrated && detail?.combination_staff_notes ? (
                    <p className="mt-2.5 border-t border-slate-100 pt-2.5 text-xs leading-snug text-slate-600">
                      <span className="font-medium text-slate-700">Combination note: </span>
                      {detail.combination_staff_notes}
                    </p>
                  ) : null}
                </SectionCard.Body>
              </SectionCard>
            );
          })()}

          {showAssignModal && (
            <div className="rounded-xl border border-brand-200 bg-brand-50/30 p-4">
              <p className="mb-2 text-sm font-medium text-slate-900">Table Assignment</p>
              {suggestionsLoading ? (
                <p className="mb-3 text-xs text-slate-500">Finding best table options...</p>
              ) : assignmentSuggestions.length > 0 ? (
                <div className="mb-3 space-y-2">
                  {assignmentSuggestions.slice(0, 6).map((suggestion, idx) => (
                    <button
                      key={`${suggestion.table_ids.join('|')}-${suggestion.source}`}
                      type="button"
                      disabled={actionLoading}
                      onClick={async () => {
                        setActionLoading(true);
                        try {
                          const assignRes = await fetch('/api/venue/tables/assignments', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(assignedTables.length > 0
                              ? {
                                  action: 'reassign',
                                  booking_id: bookingId,
                                  old_table_ids: assignedTables.map((x) => x.id),
                                  new_table_ids: suggestion.table_ids,
                                }
                              : { booking_id: bookingId, table_ids: suggestion.table_ids }
                            ),
                          });
                          if (!assignRes.ok) {
                            const payload = await assignRes.json().catch(() => ({}));
                            setError(payload.error ?? 'Failed to assign tables');
                            return;
                          }
                          setShowAssignModal(false);
                          await load();
                          onUpdated();
                        } finally { setActionLoading(false); }
                      }}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                        idx === 0
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{suggestion.table_names.join(' + ')}</span>
                        <span className="text-[10px] uppercase">
                          {suggestion.source === 'manual' ? 'Pre-configured' : suggestion.source === 'auto' ? 'Auto-detected' : 'Single'}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px]">
                        Capacity {suggestion.combined_capacity} • Spare {suggestion.spare_covers}
                      </p>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mb-3 text-xs text-slate-500">No ranked suggestions available. Choose manually below.</p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {allTables.map((t) => (
                  <button
                    key={t.id}
                    onClick={async () => {
                      setActionLoading(true);
                      try {
                        const assignRes = await fetch('/api/venue/tables/assignments', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(assignedTables.length > 0
                            ? { action: 'reassign', booking_id: bookingId, old_table_ids: assignedTables.map((x) => x.id), new_table_ids: [t.id] }
                            : { booking_id: bookingId, table_ids: [t.id] }
                          ),
                        });
                        if (!assignRes.ok) {
                          const payload = await assignRes.json().catch(() => ({}));
                          setError(payload.error ?? 'Failed to assign table');
                          return;
                        }
                        setShowAssignModal(false);
                        await load();
                        onUpdated();
                      } finally { setActionLoading(false); }
                    }}
                    disabled={actionLoading}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      assignedTables.some((at) => at.id === t.id)
                        ? 'border-brand-300 bg-brand-50 text-brand-700'
                        : recommendedTableIds.includes(t.id)
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {t.name} ({t.max_covers}){recommendedTableIds.includes(t.id) ? ' • Recommended' : ''}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowAssignModal(false)} className="mt-2 text-xs text-slate-500 hover:text-slate-700">Cancel</button>
            </div>
          )}

          {/* Deposit refund status banner */}
          {d.status === 'Cancelled' && d.deposit_amount_pence != null && d.deposit_amount_pence > 0 && (
            <DepositRefundBanner depositStatus={d.deposit_status} depositAmount={depositAmountStr!} cancellationDeadline={d.cancellation_deadline} />
          )}

          {d.occasion && (
            <div className="flex items-center gap-2 rounded-xl border border-violet-100 bg-violet-50/40 px-3.5 py-2.5">
              <svg className="h-4 w-4 shrink-0 text-violet-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8.25v-1.5m0 1.5c-1.355 0-2.697.056-4.024.166C6.845 8.51 6 9.473 6 10.608v2.513m6-4.871c1.355 0 2.697.056 4.024.166C17.155 8.51 18 9.473 18 10.608v2.513M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 8.25H6a2.25 2.25 0 0 1-2.25-2.25V15a2.25 2.25 0 0 1 2.25-2.25h12A2.25 2.25 0 0 1 21.25 15v1.5A2.25 2.25 0 0 1 18 18.75Z" /></svg>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-400">Occasion</p>
                <p className="text-sm font-semibold text-violet-900">{d.occasion}</p>
              </div>
            </div>
          )}

          <BookingNotesEditablePanel
            bookingId={bookingId}
            dietaryNotes={d.dietary_notes}
            guestRequests={d.special_requests}
            staffNotes={d.internal_notes}
            disabled={!isHydrated}
            notesVariant={notesVariant}
            onSaved={() => {
              void (async () => {
                await load();
                onUpdated();
              })();
            }}
          />

          {d.status === 'Cancelled' && (
            <SectionCard className="border-red-100 bg-red-50/20">
              <SectionCard.Body className="p-3.5">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-red-600/80">Remove from diary</p>
                <p className="mb-3 text-xs text-slate-600">
                  Permanently delete this cancelled booking and its communications log. This cannot be undone.
                </p>
                <ActionButton
                  onClick={() => {
                    setConfirmDialog({
                      title: 'Delete booking permanently?',
                      message: `${d.guest?.name ?? 'Guest'} (${d.party_size}) on ${d.booking_date} at ${d.booking_time?.slice(0, 5) ?? ''} will be removed from the system.`,
                      confirmLabel: 'Delete permanently',
                      onConfirm: () => { void executePermanentDelete(); },
                    });
                  }}
                  disabled={actionLoading || !isHydrated}
                  variant="outline-danger"
                >
                  Delete booking permanently
                </ActionButton>
              </SectionCard.Body>
            </SectionCard>
          )}

          {/* Modify section */}
          {!showModify ? (
            <button
              type="button"
              disabled={!isHydrated}
              onClick={() => setShowModify(true)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Modify booking
            </button>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
              {/* Date / Time / Party Size - availability-aware */}
              <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                <p className="mb-2.5 text-xs font-semibold text-slate-700">Date / Time / Party Size</p>
                {depositPaid && <p className="mb-2.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">Changing party size won&apos;t adjust the deposit already paid.</p>}
                <ModifyBookingInline
                  bookingId={bookingId}
                  venueId={d.venue_id || venueId || ''}
                  currentDate={d.booking_date}
                  currentTime={d.booking_time}
                  currentPartySize={d.party_size}
                  onSaved={async () => { await load(); onUpdated(); }}
                  onCancel={() => {}}
                />
              </div>

              {/* Guest details, duration, table assignment */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-700">Guest &amp; Booking Details</p>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Guest Name</label>
                  <input type="text" value={modifyGuestName} onChange={(e) => setModifyGuestName(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Guest Phone</label>
                  <PhoneWithCountryField
                    value={modifyGuestPhone}
                    onChange={setModifyGuestPhone}
                    defaultCountry={guestPhoneDefaultCountry}
                    inputClassName="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Guest Email</label>
                  <input type="email" value={modifyGuestEmail} onChange={(e) => setModifyGuestEmail(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Duration (mins)</label>
                  <NumericInput
                    min={15}
                    max={480}
                    value={modifyDurationMinutes}
                    onChange={(v) => setModifyDurationMinutes(Math.max(15, Math.round(v / 15) * 15))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  />
                </div>
                {notesVariant === 'table' && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">Dietary Notes</label>
                    <input type="text" value={modifyDietary} onChange={(e) => setModifyDietary(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Occasion</label>
                  <input type="text" value={modifyOccasion} onChange={(e) => setModifyOccasion(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    {notesVariant === 'cde' ? 'Booking notes' : 'Special Requests'}
                  </label>
                  <textarea value={modifySpecialRequests} onChange={(e) => setModifySpecialRequests(e.target.value)} rows={2} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    {notesVariant === 'cde' ? 'Staff notes' : 'Internal Notes'}
                  </label>
                  <textarea value={modifyInternalNotes} onChange={(e) => setModifyInternalNotes(e.target.value)} rows={2} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                </div>
                {(tableManagementEnabled || allTables.length > 0) && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-slate-500">Assigned Tables</p>
                    <div className="flex flex-wrap gap-1.5">
                      {allTables.map((table) => {
                        const selected = modifyTableIds.includes(table.id);
                        return (
                          <button
                            key={table.id}
                            type="button"
                            onClick={() => {
                              setModifyTableIds((prev) => selected ? prev.filter((id) => id !== table.id) : [...prev, table.id]);
                            }}
                            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                              selected
                                ? 'border-brand-300 bg-brand-50 text-brand-700'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            {table.name} ({table.max_covers})
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <button type="button" onClick={submitModify} disabled={actionLoading} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">Save Details</button>
                  <button type="button" onClick={() => setShowModify(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
                </div>
              </div>
            </div>
          )}

          {/* Timeline */}
          <SectionCard>
            <SectionCard.Body className="p-3.5">
              <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Timeline</p>
              {d.events.length === 0 ? (
                <p className="text-xs text-slate-400">{isHydrated ? 'No events yet.' : '…'}</p>
              ) : (
                <div className="max-h-36 space-y-2 overflow-y-auto pr-1">
                  {d.events.map((ev) => (
                    <div key={ev.id} className="flex items-start gap-2 text-xs">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-100">
                        <span className="h-1 w-1 rounded-full bg-slate-400" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="font-medium text-slate-700">{ev.event_type.replace(/_/g, ' ')}</span>
                        <span className="ml-1.5 text-[10px] text-slate-400">
                          {new Date(ev.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard.Body>
          </SectionCard>

          {/* Communications */}
          <SectionCard>
            <SectionCard.Body className="p-3.5">
              <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Communications</p>
              {d.communications && d.communications.length > 0 && (
                <div className="mb-3 max-h-32 space-y-1.5 overflow-y-auto pr-1">
                  {d.communications.map((c) => (
                    <div key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      <Pill variant={c.channel === 'email' ? 'brand' : 'success'} size="sm">{c.channel}</Pill>
                      <span className="font-medium text-slate-700">{c.message_type.replace(/_/g, ' ')}</span>
                      <span className={`text-[10px] font-medium ${c.status === 'sent' ? 'text-emerald-600' : 'text-red-500'}`}>
                        {c.status}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {new Date(c.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Send message via</span>
                  <GuestMessageChannelSelect
                    value={guestMessageChannel}
                    onChange={setGuestMessageChannel}
                    disabled={actionLoading || !isHydrated}
                  />
                </div>
                <textarea
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs placeholder:text-slate-400 focus:border-brand-300 focus:outline-none focus:ring-1 focus:ring-brand-200"
                  placeholder="SMS / email to guest…"
                />
                <button
                  type="button"
                  disabled={actionLoading || customMessage.trim().length === 0 || !isHydrated}
                  onClick={async () => {
                    setActionLoading(true);
                    try {
                      const res = await fetch(`/api/venue/bookings/${bookingId}/message`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message: customMessage, channel: guestMessageChannel }),
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
                            : payload.error) ?? 'Failed to send message';
                        setError(detail);
                        return;
                      }
                      if (payload.errors && payload.errors.length > 0) {
                        setError(`Partially sent — ${payload.errors.join('; ')}`);
                      } else {
                        setError(null);
                      }
                      setCustomMessage('');
                      await load();
                    } finally {
                      setActionLoading(false);
                    }
                  }}
                  className="mt-2 rounded-lg bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </SectionCard.Body>
          </SectionCard>
        </div>
      </div>
      {confirmDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-[2px]" onClick={() => setConfirmDialog(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900">{confirmDialog.title}</h3>
            <p className="mt-2 text-sm text-slate-600">{confirmDialog.message}</p>
            <div className="mt-5 flex gap-2.5">
              <button
                type="button"
                onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}
                className="flex-1 rounded-xl bg-red-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
              >
                {confirmDialog.confirmLabel}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CompactInfo({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={['mt-0.5 truncate text-sm font-medium text-slate-800', valueClass].filter(Boolean).join(' ')}>{value}</p>
    </div>
  );
}

function DepositRefundBanner({ depositStatus, depositAmount, cancellationDeadline }: {
  depositStatus: string;
  depositAmount: string;
  cancellationDeadline: string | null;
}) {
  if (depositStatus === 'Refunded') {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
          <p className="text-sm font-medium text-emerald-800">Deposit refunded</p>
        </div>
        <p className="mt-1 text-xs text-emerald-700">{depositAmount} has been refunded to the customer&apos;s payment method. Allow 5–10 business days for processing.</p>
      </div>
    );
  }

  if (depositStatus === 'Paid') {
    const wasEligible = cancellationDeadline && new Date() <= new Date(cancellationDeadline);
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126Z" /></svg>
          <p className="text-sm font-medium text-amber-800">Deposit not refunded</p>
        </div>
        <p className="mt-1 text-xs text-amber-700">
          {wasEligible
            ? `${depositAmount} - refund was eligible but failed to process. Please refund manually via Stripe.`
            : `${depositAmount} - cancelled after the 48-hour refund window. Deposit retained per cancellation policy.`
          }
        </p>
      </div>
    );
  }

  return null;
}

function ActionButton({ onClick, disabled, variant, children }: {
  onClick: () => void;
  disabled: boolean;
  variant: 'primary' | 'danger' | 'outline-danger' | 'secondary';
  children: React.ReactNode;
}) {
  const styles = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    'outline-danger': 'border border-red-200 text-red-600 hover:bg-red-50',
    secondary: 'border border-slate-300 text-slate-700 hover:bg-slate-100',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50 ${styles[variant]}`}
    >
      {children}
    </button>
  );
}
