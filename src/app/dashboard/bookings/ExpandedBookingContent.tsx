'use client';

import { useEffect, useState } from 'react';
import {
  BOOKING_PRIMARY_ACTIONS,
  BOOKING_REVERT_ACTIONS,
  canTransitionBookingStatus,
  isDestructiveBookingStatus,
  isRevertTransition,
  type BookingStatus,
} from '@/lib/table-management/booking-status';
import { ModifyBookingInline } from '@/components/booking/ModifyBookingInline';
import { BookingNotesEditablePanel } from '@/components/booking/BookingNotesEditablePanel';
import { CustomerProfileNotesCard } from '@/components/booking/CustomerProfileNotesCard';
import { GuestTagEditor } from '@/components/dashboard/GuestTagEditor';
import type { BookingNotesVariant } from '@/components/booking/BookingNotesEditablePanel';
import type { BookingModel } from '@/types/booking-models';
import {
  bookingModelShortLabel,
  inferBookingRowModel,
  isTableReservationBooking,
} from '@/lib/booking/infer-booking-row-model';
import { GuestMessageChannelSelect } from '@/components/booking/GuestMessageChannelSelect';
import type { GuestMessageChannel } from '@/lib/booking/guest-message-channel';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { Pill } from '@/components/ui/dashboard/Pill';

interface BookingRow {
  id: string;
  booking_date: string;
  booking_time: string;
  estimated_end_time: string | null;
  created_at: string | null;
  party_size: number;
  status: string;
  source: string;
  deposit_status: string;
  deposit_amount_pence: number | null;
  dietary_notes: string | null;
  occasion: string | null;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  table_assignments?: Array<{ id: string; name: string }>;
  group_booking_id?: string | null;
  person_label?: string | null;
  area_name?: string | null;
  experience_event_id?: string | null;
  class_instance_id?: string | null;
  resource_id?: string | null;
  event_session_id?: string | null;
  calendar_id?: string | null;
  service_item_id?: string | null;
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
    name: string | null;
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

function formatRelative(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDateNice(value: string): string {
  const d = new Date(value + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return value;
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function ExpandedBookingContent({
  booking,
  detail,
  detailLoading,
  tableManagementEnabled,
  venueId,
  draftMessage,
  sendingMessage,
  onMessageDraftChange,
  onSendMessage,
  onStatusAction,
  onDetailUpdated,
  onRequestChangeTable,
  isAppointment = false,
}: {
  booking: BookingRow;
  detail: BookingDetailLite | undefined;
  detailLoading: boolean;
  tableManagementEnabled: boolean;
  venueId: string;
  draftMessage: string;
  sendingMessage: boolean;
  onMessageDraftChange: (value: string) => void;
  onSendMessage: (channel: GuestMessageChannel) => void;
  onStatusAction: (status: BookingStatus) => void;
  onDetailUpdated: () => void;
  onRequestChangeTable?: () => void;
  isAppointment?: boolean;
}) {
  const [showMessageBox, setShowMessageBox] = useState(false);
  const [guestMessageChannel, setGuestMessageChannel] = useState<GuestMessageChannel>('both');
  const [showModify, setShowModify] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ status: BookingStatus; label: string } | null>(null);
  const [inlineActionLoading, setInlineActionLoading] = useState<string | null>(null);
  const [inlineActionError, setInlineActionError] = useState<string | null>(null);
  const [linkedBookings, setLinkedBookings] = useState<Array<{ id: string; person_label: string | null; booking_time: string; status: string }>>([]);

  useEffect(() => {
    if (!booking.group_booking_id) return;
    let cancelled = false;
    fetch(`/api/venue/bookings/list?group_booking_id=${booking.group_booking_id}`)
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const others = (data.bookings ?? [])
          .filter((b: { id: string }) => b.id !== booking.id)
          .map((b: { id: string; person_label: string | null; booking_time: string; status: string }) => ({
            id: b.id,
            person_label: b.person_label,
            booking_time: b.booking_time,
            status: b.status,
          }));
        setLinkedBookings(others);
      })
      .catch(() => { /* ignore */ });
    return () => {
      cancelled = true;
    };
  }, [booking.group_booking_id, booking.id]);

  const displayLinkedBookings = booking.group_booking_id ? linkedBookings : [];

  const notesVariant: BookingNotesVariant =
    inferBookingRowModel(booking) === 'table_reservation' ? 'table' : 'cde';

  if (detailLoading) {
    return (
      <div id={`booking-expand-${booking.id}`} className="mt-2 animate-pulse space-y-2.5 px-1 pb-3" onClick={(e) => e.stopPropagation()}>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="h-28 rounded-2xl bg-slate-100" />
          <div className="h-28 rounded-2xl bg-slate-100" />
        </div>
        <div className="h-16 rounded-2xl bg-slate-100" />
        <div className="h-10 rounded-2xl bg-slate-100" />
      </div>
    );
  }

  const guestName = detail?.guest?.name ?? booking.guest_name;
  const guestPhone = detail?.guest?.phone ?? booking.guest_phone;
  const guestEmail = detail?.guest?.email ?? booking.guest_email;
  const visitCount = detail?.guest?.visit_count ?? 0;
  const previousVisitDate = detail?.guest?.last_visit_date ?? null;
  const tableNames = (detail?.table_assignments ?? booking.table_assignments ?? []).map((t) => t.name);
  const depositAmtStr = booking.deposit_amount_pence ? `£${(booking.deposit_amount_pence / 100).toFixed(2)}` : null;
  const confirmationSentAt = detail?.communications.find(
    (comm) => comm.message_type === 'booking_confirmation_email' || comm.message_type === 'booking_confirmation_sms',
  )?.created_at;
  const runDepositAction = async (action: 'send_payment_link' | 'waive' | 'record_cash' | 'refund') => {
    setInlineActionLoading(`deposit:${action}`);
    setInlineActionError(null);
    try {
      const res = await fetch(`/api/venue/bookings/${booking.id}/deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        setInlineActionError(payload.error ?? 'Deposit action failed');
        return;
      }
      setInlineActionError(null);
      onDetailUpdated();
    } finally {
      setInlineActionLoading(null);
    }
  };
  const resendConfirmation = async () => {
    setInlineActionLoading('resend-confirmation');
    setInlineActionError(null);
    try {
      const res = await fetch(`/api/venue/bookings/${booking.id}/resend-confirmation`, { method: 'POST' });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        setInlineActionError(payload.error ?? 'Failed to resend confirmation');
        return;
      }
      setInlineActionError(null);
      onDetailUpdated();
    } finally {
      setInlineActionLoading(null);
    }
  };

  const canCancel = canTransitionBookingStatus(booking.status, 'Cancelled');
  const canNoShow = canTransitionBookingStatus(booking.status, 'No-Show');
  const revertAction = BOOKING_REVERT_ACTIONS[booking.status as BookingStatus];
  const tableStyle = isTableReservationBooking(booking);

  const forwardPrimaryLabel = (target: BookingStatus, defaultLabel: string) => {
    if (target === 'Seated' && !tableStyle) return 'Start';
    return defaultLabel;
  };

  const revertButtonLabel = () => {
    if (!revertAction) return '';
    if (
      revertAction.target === 'Booked' &&
      booking.status === 'Seated' &&
      !tableStyle
    ) {
      return 'Undo Start';
    }
    return revertAction.label;
  };

  const forwardActions = (
    [
      BOOKING_PRIMARY_ACTIONS.Pending,
      BOOKING_PRIMARY_ACTIONS.Booked,
      BOOKING_PRIMARY_ACTIONS.Confirmed,
      BOOKING_PRIMARY_ACTIONS.Seated,
    ] as Array<{ label: string; target: BookingStatus } | undefined>
  ).reduce<Array<{ label: string; target: BookingStatus }>>((actions, action) => {
    if (!action || !canTransitionBookingStatus(booking.status, action.target)) return actions;
    if (actions.some((existing) => existing.target === action.target)) return actions;
    return [...actions, action];
  }, []);

  const handleStatusClick = (status: BookingStatus, label: string) => {
    if (isDestructiveBookingStatus(status) || isRevertTransition(booking.status as BookingStatus, status)) {
      setConfirmAction({ status, label });
    } else {
      onStatusAction(status);
    }
  };

  return (
    <div id={`booking-expand-${booking.id}`} className="mt-1.5 space-y-2 px-0.5 pb-2.5 sm:px-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <SectionCard className="rounded-xl">
        <SectionCard.Body className="p-2.5 sm:p-3">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-sm font-bold text-brand-700 ring-1 ring-brand-100">
                {guestName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                  <p className="max-w-[12rem] truncate text-sm font-bold text-slate-900 sm:max-w-[18rem]">{guestName}</p>
                  <Pill variant="neutral" size="sm">{visitCount > 0 ? `${visitCount} visit${visitCount !== 1 ? 's' : ''}` : 'First visit'}</Pill>
                  {detail?.guest?.customer_profile_notes ? <Pill variant="info" size="sm">Guest note</Pill> : null}
                </div>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                  <span className="font-medium text-slate-700">{formatDateNice(booking.booking_date)}</span>
                  <span className="text-slate-300">·</span>
                  <span className="font-semibold tabular-nums text-slate-700">{booking.booking_time.slice(0, 5)}</span>
                  {!isAppointment ? (
                    <>
                      <span className="text-slate-300">·</span>
                      <span>{booking.party_size} cover{booking.party_size === 1 ? '' : 's'}</span>
                    </>
                  ) : null}
                  {booking.area_name ? (
                    <>
                      <span className="hidden text-slate-300 sm:inline">·</span>
                      <span className="hidden sm:inline">{booking.area_name}</span>
                    </>
                  ) : null}
                  {booking.created_at ? (
                    <>
                      <span className="hidden text-slate-300 sm:inline">·</span>
                      <span className="hidden sm:inline">Created {formatRelative(booking.created_at)}</span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:flex sm:shrink-0 sm:items-center">
              {guestPhone ? (
                <a href={`tel:${guestPhone}`} className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
                  Call
                </a>
              ) : null}
              {guestEmail ? (
                <a href={`mailto:${guestEmail}`} className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
                  Email
                </a>
              ) : null}
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <div className={`rounded-lg border px-2 py-1.5 ${tableNames.length > 0 ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
              <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Table</p>
              <p className={`truncate text-xs font-bold ${tableNames.length > 0 ? 'text-emerald-900' : 'text-amber-800'}`}>
                {tableNames.length > 0 ? tableNames.join(' + ') : tableManagementEnabled ? 'Unassigned' : 'N/A'}
              </p>
              {detail?.combination_staff_notes ? (
                <p className="mt-1 line-clamp-2 text-[10px] font-medium leading-snug text-emerald-800">
                  {detail.combination_staff_notes}
                </p>
              ) : null}
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Deposit</p>
              <p className={`truncate text-xs font-bold ${booking.deposit_status === 'Paid' ? 'text-emerald-700' : booking.deposit_status === 'Pending' ? 'text-amber-700' : 'text-slate-700'}`}>
                {booking.deposit_status === 'Not Required'
                  ? 'None'
                  : booking.deposit_status === 'Paid' && depositAmtStr
                    ? `${depositAmtStr} paid`
                    : booking.deposit_status}
              </p>
            </div>
            {detail?.checked_in_at ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Checked in</p>
                <p className="truncate text-xs font-bold text-slate-700">{formatRelative(detail.checked_in_at)}</p>
              </div>
            ) : null}
            {confirmationSentAt ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Confirmation</p>
                <p className="truncate text-xs font-bold text-slate-700">Sent {formatRelative(confirmationSentAt)}</p>
              </div>
            ) : null}
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Source</p>
              <p className="truncate text-xs font-bold text-slate-700">{booking.source}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Ref</p>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(booking.id)}
                className="truncate text-left text-xs font-bold text-slate-700 hover:text-brand-700"
                title="Copy booking reference"
              >
                #{booking.id.slice(0, 8)}
              </button>
            </div>
          </div>
        </SectionCard.Body>
      </SectionCard>

      {detail?.guest?.id ? (
        <details className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-900/[0.03]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-slate-700 marker:hidden">
            <span>Guest profile</span>
            <span className="text-[11px] font-medium text-slate-400 group-open:hidden">
              {(detail.guest.tags ?? []).length > 0
                ? `${detail.guest.tags!.length} tag${detail.guest.tags!.length === 1 ? '' : 's'}`
                : detail.guest.customer_profile_notes
                  ? 'Customer info'
                  : 'Tags and notes'}
            </span>
            <svg className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </summary>
          <div className="space-y-2 border-t border-slate-100 p-2.5">
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-5">
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Name</p>
                <p className="truncate text-xs font-bold text-slate-800">{guestName}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Email</p>
                {guestEmail ? (
                  <a href={`mailto:${guestEmail}`} className="block truncate text-xs font-bold text-slate-800 hover:text-brand-700">
                    {guestEmail}
                  </a>
                ) : (
                  <p className="truncate text-xs font-bold text-slate-400">Not provided</p>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Telephone</p>
                {guestPhone ? (
                  <a href={`tel:${guestPhone}`} className="block truncate text-xs font-bold text-slate-800 hover:text-brand-700">
                    {guestPhone}
                  </a>
                ) : (
                  <p className="truncate text-xs font-bold text-slate-400">Not provided</p>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Previous visit</p>
                <p className="truncate text-xs font-bold text-slate-800">
                  {previousVisitDate ? formatDateNice(previousVisitDate) : 'None yet'}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Visits</p>
                <p className="truncate text-xs font-bold text-slate-800">
                  {visitCount > 0 ? `${visitCount} visit${visitCount === 1 ? '' : 's'}` : 'First visit'}
                </p>
              </div>
            </div>
            <GuestTagEditor
              tags={Array.isArray(detail.guest.tags) ? detail.guest.tags : []}
              venueId={venueId}
              onTagsChange={async (nextTags) => {
                const res = await fetch(`/api/venue/guests/${detail.guest!.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ tags: nextTags }),
                });
                if (!res.ok) {
                  const j = (await res.json().catch(() => ({}))) as { error?: string };
                  throw new Error(typeof j.error === 'string' ? j.error : 'Could not save tags');
                }
                onDetailUpdated();
              }}
            />
            <CustomerProfileNotesCard
              embedded
              guestId={detail.guest.id}
              value={detail.guest.customer_profile_notes}
              disabled={detailLoading}
              onSaved={onDetailUpdated}
            />
          </div>
        </details>
      ) : null}

      <details className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-900/[0.03]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-slate-700 marker:hidden">
          <span>Payments and confirmation</span>
          <span className="text-[11px] font-medium text-slate-400 group-open:hidden">{booking.deposit_status}</span>
          <svg className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </summary>
        <div className="space-y-2 border-t border-slate-100 p-2.5">
          <div className="flex flex-wrap gap-1.5">
            {booking.deposit_status !== 'Paid' && booking.deposit_status !== 'Refunded' ? (
              <>
                <button type="button" disabled={inlineActionLoading !== null} onClick={() => { void runDepositAction('send_payment_link'); }} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Send payment link</button>
                <button type="button" disabled={inlineActionLoading !== null} onClick={() => { void runDepositAction('waive'); }} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Waive</button>
                <button type="button" disabled={inlineActionLoading !== null} onClick={() => { void runDepositAction('record_cash'); }} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Record cash</button>
              </>
            ) : null}
            {booking.deposit_status === 'Paid' ? (
              <button type="button" disabled={inlineActionLoading !== null} onClick={() => { void runDepositAction('refund'); }} className="rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">Refund deposit</button>
            ) : null}
            <button type="button" disabled={inlineActionLoading !== null} onClick={() => { void resendConfirmation(); }} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Resend confirmation</button>
          </div>
          {detail?.cancellation_deadline ? (
            <p className="text-[11px] text-slate-500">Cancellation deadline: {formatRelative(detail.cancellation_deadline)}</p>
          ) : null}
          {inlineActionError ? (
            <p className="rounded-lg border border-red-100 bg-red-50 px-2 py-1.5 text-[11px] font-medium text-red-700">{inlineActionError}</p>
          ) : null}
        </div>
      </details>

      <details
        className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-900/[0.03]"
        open={showMessageBox}
        onToggle={(event) => {
          const nextOpen = event.currentTarget.open;
          setShowMessageBox(nextOpen);
          if (nextOpen) setShowModify(false);
        }}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-slate-700 marker:hidden">
          <span>SMS / email guest</span>
          <span className="text-[11px] font-medium text-slate-400 group-open:hidden">
            {(detail?.communications ?? []).length > 0
              ? `${detail!.communications.length} sent`
              : guestPhone && guestEmail
                ? 'SMS + email'
                : guestPhone
                  ? 'SMS'
                  : guestEmail
                    ? 'Email'
                    : 'No contact'}
          </span>
          <svg className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </summary>
        <div className="border-t border-slate-100 bg-brand-50/20 p-2.5 sm:p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-700">Message {guestName.split(' ')[0]}</p>
            {(detail?.communications ?? []).length > 0 && (
              <span className="text-[10px] text-slate-400">
                {detail!.communications.length} sent · last via {detail!.communications[0]?.channel}
              </span>
            )}
          </div>
          <textarea
            value={draftMessage}
            onChange={(e) => onMessageDraftChange(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
            placeholder={`Write a message to ${guestName.split(' ')[0]}…`}
          />
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center justify-between gap-2 text-xs font-medium text-slate-500 sm:justify-start">
              Send via
              <GuestMessageChannelSelect
                value={guestMessageChannel}
                onChange={setGuestMessageChannel}
                disabled={sendingMessage}
              />
            </label>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
              <button
                type="button"
                onClick={() => setShowMessageBox(false)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50 sm:py-1.5"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={sendingMessage || draftMessage.trim().length === 0}
                onClick={() => onSendMessage(guestMessageChannel)}
                className="inline-flex min-w-[5.25rem] items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-white transition-colors duration-150 hover:bg-slate-900 disabled:opacity-50 sm:py-1.5"
                aria-busy={sendingMessage}
              >
                {sendingMessage ? (
                  <span
                    className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-white/25 border-t-white"
                    aria-hidden
                  />
                ) : null}
                <span>Send</span>
              </button>
            </div>
          </div>
        </div>
      </details>

      <details className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-900/[0.03]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-slate-700 marker:hidden">
          <span>Notes and preferences</span>
          <span className="text-[11px] font-medium text-slate-400 group-open:hidden">
            {[booking.dietary_notes, detail?.special_requests, detail?.internal_notes].filter(Boolean).length || 'None'}
          </span>
          <svg className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </summary>
        <div className="border-t border-slate-100 p-2.5">
          <BookingNotesEditablePanel
            bookingId={booking.id}
            dietaryNotes={booking.dietary_notes}
            guestRequests={detail?.special_requests}
            staffNotes={detail?.internal_notes}
            onSaved={onDetailUpdated}
            notesVariant={notesVariant}
          />
        </div>
      </details>

      {/* CDE context */}
      {detail?.cde_context && (
        <SectionCard className="border-emerald-200 bg-emerald-50/30">
          <SectionCard.Body className="p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
              </div>
              <div>
                <Pill variant="success" size="sm">{bookingModelShortLabel(detail.cde_context.inferred_model)}</Pill>
                <p className="mt-1.5 text-sm font-semibold text-slate-900">{detail.cde_context.title}</p>
                {detail.cde_context.subtitle && (
                  <p className="mt-0.5 text-xs text-slate-600">{detail.cde_context.subtitle}</p>
                )}
              </div>
            </div>
          </SectionCard.Body>
        </SectionCard>
      )}

      {/* Group booking */}
      {booking.group_booking_id && (
        <SectionCard className="border-violet-200 bg-violet-50/30">
          <SectionCard.Body className="p-4">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 shrink-0 text-violet-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" /></svg>
              <span className="text-xs font-semibold text-violet-800">Group booking</span>
              {booking.person_label && <span className="text-xs text-violet-600">· {booking.person_label}</span>}
            </div>
            {displayLinkedBookings.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-400">Others in this group</p>
                {displayLinkedBookings.map((lb) => (
                  <div key={lb.id} className="flex items-center justify-between">
                    <span className="text-xs font-medium text-violet-800">{lb.person_label ?? 'Unknown'}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs tabular-nums text-violet-600">{lb.booking_time?.slice(0, 5)}</span>
                      <Pill variant={lb.status === 'Confirmed' ? 'success' : lb.status === 'Booked' ? 'info' : lb.status === 'Pending' ? 'warning' : lb.status === 'Cancelled' ? 'danger' : 'neutral'} size="sm">{lb.status}</Pill>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard.Body>
        </SectionCard>
      )}

      {/* Actions bar */}
      <SectionCard className="rounded-xl">
        <SectionCard.Body className="p-2">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {forwardActions.map((action) => (
              <button
                key={action.target}
                type="button"
                onClick={() => handleStatusClick(action.target, forwardPrimaryLabel(action.target, action.label))}
                className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 sm:text-xs"
              >
                {(action.target === 'Confirmed' || action.target === 'Booked') && (
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                )}
                {action.target === 'Seated' && tableStyle && (
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" /></svg>
                )}
                {action.target === 'Seated' && !tableStyle && (
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" /></svg>
                )}
                {forwardPrimaryLabel(action.target, action.label)}
              </button>
            ))}

            {onRequestChangeTable && (
              <button
                type="button"
                onClick={onRequestChangeTable}
                className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 sm:text-xs"
              >
                Change table
              </button>
            )}

            {revertAction && (
              <button
                type="button"
                onClick={() => handleStatusClick(revertAction.target, revertButtonLabel())}
                className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 transition-colors hover:bg-amber-100 sm:text-xs"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" /></svg>
                {revertButtonLabel()}
              </button>
            )}

            <div className="min-w-2 flex-1" />

            <button
              type="button"
              onClick={() => { setShowModify(!showModify); if (!showModify) setShowMessageBox(false); }}
              className={`inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors sm:text-xs ${showModify ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" /></svg>
              Modify
            </button>

            <div className="mx-0.5 h-4 w-px bg-slate-200" />

            {canCancel && (
              <button
                type="button"
                onClick={() => handleStatusClick('Cancelled', 'Cancel Booking')}
                className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-1 text-[11px] font-semibold text-red-600 transition-colors hover:border-red-100 hover:bg-red-50 sm:text-xs"
              >
                Cancel
              </button>
            )}
            {canNoShow && (
              <button
                type="button"
                onClick={() => handleStatusClick('No-Show', 'Mark No-Show')}
                className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-1 text-[11px] font-semibold text-rose-600 transition-colors hover:border-rose-100 hover:bg-rose-50 sm:text-xs"
              >
                No-Show
              </button>
            )}
          </div>
        </SectionCard.Body>
      </SectionCard>

      {/* Modify booking (collapsible) */}
      {showModify && (
        <SectionCard className="rounded-xl border-brand-200 bg-brand-50/20">
          <SectionCard.Body className="p-2.5 sm:p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-brand-800">Modify booking</p>
              <button type="button" onClick={() => setShowModify(false)} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-white/70">
                Close
              </button>
            </div>
            <ModifyBookingInline
              bookingId={booking.id}
              venueId={venueId}
              currentDate={booking.booking_date}
              currentTime={booking.booking_time}
              currentPartySize={booking.party_size}
              onSaved={() => { setShowModify(false); onDetailUpdated(); }}
              onCancel={() => setShowModify(false)}
            />
          </SectionCard.Body>
        </SectionCard>
      )}

      {/* Communications and booking activity */}
      {((detail?.communications ?? []).length > 0 || (detail?.events ?? []).length > 0) && !showMessageBox && (
        <details className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-900/[0.03]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-slate-700 marker:hidden">
            <span>Activity</span>
            <span className="text-[11px] font-medium text-slate-400 group-open:hidden">
              {(detail?.communications ?? []).length} comms · {(detail?.events ?? []).length} events
            </span>
            <svg className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </summary>
          <div className="space-y-2 border-t border-slate-100 p-2.5">
            {(detail?.communications ?? []).length > 0 ? (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Communications</p>
                <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                  {(detail?.communications ?? []).slice(0, 6).map((comm) => (
                    <div key={comm.id} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5 text-[11px] text-slate-600">
                      <span className="min-w-0 truncate">
                        <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${comm.status === 'sent' ? 'bg-emerald-400' : comm.status === 'failed' ? 'bg-red-400' : 'bg-amber-400'}`} />
                        {comm.message_type.replace(/_/g, ' ')}
                      </span>
                      <span className="shrink-0 text-slate-400">{comm.channel} · {formatRelative(comm.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {(detail?.events ?? []).length > 0 ? (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Timeline</p>
                <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                  {(detail?.events ?? []).slice(0, 6).map((event) => (
                    <div key={event.id} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-600">
                      <span className="min-w-0 truncate font-medium">{event.event_type.replace(/_/g, ' ')}</span>
                      <span className="shrink-0 text-slate-400">{formatRelative(event.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </details>
      )}

      {/* Inline confirmation dialog */}
      {confirmAction && (
        <SectionCard className="border-red-200 bg-red-50/40">
          <SectionCard.Body className="p-4">
            <p className="text-sm font-bold text-red-800">{confirmAction.label}</p>
            <p className="mt-1 text-xs text-red-700">
              Confirm {confirmAction.label.toLowerCase()} for {guestName}
              {' '}({booking.party_size} cover{booking.party_size !== 1 ? 's' : ''}) at {booking.booking_time.slice(0, 5)}?
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => { onStatusAction(confirmAction.status); setConfirmAction(null); }}
                className="rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700"
              >
                {confirmAction.label}
              </button>
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Keep as is
              </button>
            </div>
          </SectionCard.Body>
        </SectionCard>
      )}
    </div>
  );
}
