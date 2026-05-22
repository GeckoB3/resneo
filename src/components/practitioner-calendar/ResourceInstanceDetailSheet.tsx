'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ScheduleBlockDTO } from '@/types/schedule-blocks';
import type { ClassPaymentRequirement } from '@/types/booking-models';
import {
  PRACTITIONER_BOOKING_STATUS_BADGE as STATUS_BADGE,
  formatDashboardMoneyPence as formatMoneyPence,
} from './detail-sheet-primitives';
import { computePopoverPanelStyle } from '@/lib/ui/clamped-floating-styles';
import { isBookingDetailPopoverDismissExempt } from '@/lib/ui/booking-detail-popover-dismiss';
import { useViewportBounds } from '@/lib/ui/use-viewport-bounds';
import { Sheet } from '@/components/ui/primitives/Sheet';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { GuestMessageChannelSelect } from '@/components/booking/GuestMessageChannelSelect';
import type { GuestMessageChannel } from '@/lib/booking/guest-message-channel';
import { timeToMinutes } from '@/lib/availability';
import { StaffExpandedBookingModifyModal } from '@/components/booking/StaffExpandedBookingModifyModal';
import type { StaffExpandedBookingModifySource } from '@/components/booking/StaffExpandedBookingModifyModal';

interface BookingDetailPayload {
  id: string;
  booking_date: string;
  booking_time: string;
  booking_end_time?: string | null;
  estimated_end_time?: string | null;
  status: string;
  party_size: number;
  deposit_amount_pence: number | null;
  deposit_status: string | null;
  resource_payment_requirement?: ClassPaymentRequirement | null;
  checked_in_at: string | null;
  special_requests?: string | null;
  internal_notes?: string | null;
  resource_id?: string | null;
  guest?: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
}

interface ResourcePayload {
  id: string;
  name: string;
  display_on_calendar_id?: string | null;
  min_booking_minutes?: number;
}

function resourcePaymentModeLabel(m: ClassPaymentRequirement | null | undefined): string {
  if (m === 'none') return 'Pay at venue';
  if (m === 'deposit') return 'Deposit (online)';
  if (m === 'full_payment') return 'Full payment (online)';
  return '—';
}

function formatCheckedInAt(value: string | null): string {
  if (!value) return 'Not checked in';
  return new Date(value).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
}

function endTimeFromDetail(detail: BookingDetailPayload, block: ScheduleBlockDTO): string {
  if (detail.booking_end_time) return detail.booking_end_time.slice(0, 5);
  if (detail.estimated_end_time) return detail.estimated_end_time.slice(0, 5);
  return block.end_time.slice(0, 5);
}

function durationMinutesFromDetail(detail: BookingDetailPayload, block: ScheduleBlockDTO): number | null {
  const start = detail.booking_time.slice(0, 5);
  const end = endTimeFromDetail(detail, block);
  const mins = timeToMinutes(end) - timeToMinutes(start);
  return mins > 0 ? mins : null;
}

interface Props {
  selection: { bookingId: string; resourceId: string; block: ScheduleBlockDTO } | null;
  onClose: () => void;
  venueId: string;
  currency?: string;
  presentation?: 'sheet' | 'popover';
  anchor?: { x: number; y: number } | null;
  onUpdated?: () => void;
}

export function ResourceInstanceDetailSheet({
  selection,
  onClose,
  venueId,
  currency = 'GBP',
  presentation = 'popover',
  anchor,
  onUpdated,
}: Props) {
  const open = selection !== null;
  const panelRef = useRef<HTMLElement>(null);
  const [resource, setResource] = useState<ResourcePayload | null>(null);
  const [detail, setDetail] = useState<BookingDetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [guestMessageDraft, setGuestMessageDraft] = useState('');
  const [guestMessageChannel, setGuestMessageChannel] = useState<GuestMessageChannel>('both');
  const [guestMessageSending, setGuestMessageSending] = useState(false);
  const [modifyOpen, setModifyOpen] = useState(false);
  const [modifyFocusSlot, setModifyFocusSlot] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  const bookingId = selection?.bookingId ?? null;
  const resourceId = selection?.resourceId ?? null;

  const load = useCallback(async () => {
    if (!bookingId || !resourceId) return;
    setLoading(true);
    setError(null);
    try {
      const [resourceRes, bookingRes] = await Promise.all([
        fetch(`/api/venue/resources/${resourceId}`),
        fetch(`/api/venue/bookings/${bookingId}`),
      ]);
      if (!resourceRes.ok) {
        const j = await resourceRes.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? 'Could not load resource');
      }
      if (!bookingRes.ok) {
        const j = await bookingRes.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? 'Could not load booking');
      }
      const resourceJson = (await resourceRes.json()) as { resource?: ResourcePayload };
      const bookingJson = (await bookingRes.json()) as BookingDetailPayload;
      setResource(resourceJson.resource ?? null);
      setDetail(bookingJson);
    } catch (e) {
      setResource(null);
      setDetail(null);
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [bookingId, resourceId]);

  useEffect(() => {
    if (!selection || !bookingId || !resourceId) {
      setResource(null);
      setDetail(null);
      setError(null);
      setActionError(null);
      setGuestMessageDraft('');
      return;
    }
    void load();
  }, [selection, bookingId, resourceId, load]);

  const viewport = useViewportBounds();
  const isPopover = presentation === 'popover';
  const popoverStyle = useMemo((): CSSProperties | undefined => {
    if (!isPopover) return undefined;

    return computePopoverPanelStyle({
      anchorX: anchor?.x ?? viewport.width / 2,
      anchorY: anchor?.y ?? 120,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      maxPanelWidth: 640,
    });
  }, [anchor?.x, anchor?.y, isPopover, viewport.height, viewport.width]);

  useEffect(() => {
    if (!selection) {
      setModifyOpen(false);
      setModifyFocusSlot(false);
      setCancelConfirmOpen(false);
    }
  }, [selection?.bookingId]);

  useEffect(() => {
    if (!isPopover || !open) return;
    if (modifyOpen || cancelConfirmOpen) return;

    const onPointerDownCapture = (event: PointerEvent) => {
      if (isBookingDetailPopoverDismissExempt(event.target, panelRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const onClickCapture = (event: MouseEvent) => {
      if (isBookingDetailPopoverDismissExempt(event.target, panelRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onClose();
    };

    document.addEventListener('pointerdown', onPointerDownCapture, true);
    document.addEventListener('click', onClickCapture, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDownCapture, true);
      document.removeEventListener('click', onClickCapture, true);
    };
  }, [cancelConfirmOpen, isPopover, modifyOpen, onClose, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (modifyOpen || cancelConfirmOpen) return;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cancelConfirmOpen, modifyOpen, onClose, open]);

  const patchBooking = useCallback(
    async (body: Record<string, unknown>) => {
      if (!bookingId) return false;
      setActionBusy(true);
      setActionError(null);
      try {
        const res = await fetch(`/api/venue/bookings/${bookingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setActionError(data.error ?? 'Update failed');
          return false;
        }
        await load();
        onUpdated?.();
        return true;
      } catch {
        setActionError('Network error');
        return false;
      } finally {
        setActionBusy(false);
      }
    },
    [bookingId, load, onUpdated],
  );

  const toggleCheckIn = useCallback(async () => {
    if (!bookingId || !detail) return;
    setActionBusy(true);
    setActionError(null);
    const checkedIn = !detail.checked_in_at;
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checked_in: checkedIn }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(data.error ?? 'Check-in update failed');
        return;
      }
      await load();
      onUpdated?.();
    } catch {
      setActionError('Network error');
    } finally {
      setActionBusy(false);
    }
  }, [bookingId, detail, load, onUpdated]);

  const sendGuestMessage = useCallback(async () => {
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
        const msg =
          (data.errors && data.errors.length > 0 ? data.errors.join('; ') : data.error) ??
          'Could not send message';
        setActionError(msg);
        return;
      }
      setGuestMessageDraft('');
      await load();
      onUpdated?.();
    } catch {
      setActionError('Network error');
    } finally {
      setGuestMessageSending(false);
    }
  }, [bookingId, guestMessageChannel, guestMessageDraft, load, onUpdated]);

  const cancelBooking = useCallback(async () => {
    const ok = await patchBooking({ status: 'Cancelled' });
    if (ok) {
      setCancelConfirmOpen(false);
      onClose();
    }
  }, [onClose, patchBooking]);

  const modifySource = useMemo((): StaffExpandedBookingModifySource | null => {
    if (!detail) return null;
    const guestName =
      [detail.guest?.first_name, detail.guest?.last_name].filter(Boolean).join(' ').trim() || 'Guest';
    return {
      id: detail.id,
      booking_date: detail.booking_date,
      booking_time: detail.booking_time,
      party_size: detail.party_size,
      estimated_end_time: detail.estimated_end_time ?? null,
      booking_end_time: detail.booking_end_time ?? null,
      status: detail.status,
      deposit_status: detail.deposit_status ?? 'none',
      dietary_notes: null,
      occasion: null,
      guest_name: guestName,
      guest_first_name: detail.guest?.first_name ?? null,
      guest_last_name: detail.guest?.last_name ?? null,
      guest_email: detail.guest?.email ?? null,
      guest_phone: detail.guest?.phone ?? null,
      inferred_booking_model: 'resource_booking',
      resource_id: detail.resource_id ?? resourceId,
    };
  }, [detail, resourceId]);

  if (!open || !selection) return null;

  const block = selection.block;
  const resourceName =
    resource?.name ??
    (block.title.includes('·') ? block.title.split('·')[0]?.trim() : block.title) ??
    'Resource';
  const dateStr = detail?.booking_date ?? block.date;
  const startStr = detail?.booking_time ? detail.booking_time.slice(0, 5) : block.start_time.slice(0, 5);
  const endStr = detail ? endTimeFromDetail(detail, block) : block.end_time.slice(0, 5);
  const durationMins = detail ? durationMinutesFromDetail(detail, block) : null;
  const guestName =
    detail?.guest
      ? [detail.guest.first_name, detail.guest.last_name].filter(Boolean).join(' ').trim() || 'Guest'
      : block.title.includes('·')
        ? block.title.split('·').slice(1).join('·').trim() || 'Guest'
        : 'Guest';
  const statusClass = STATUS_BADGE[detail?.status ?? block.status ?? ''] ?? 'bg-slate-100 text-slate-700';
  const canCheckIn = detail && detail.status !== 'Cancelled' && detail.status !== 'No-Show';
  const canCancel =
    detail &&
    ['Pending', 'Booked', 'Confirmed', 'Seated'].includes(detail.status);

  const bodyContent = (
    <div className="space-y-3 p-2.5 sm:p-4">
      <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-white p-3">
        <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Resource booking</p>
        <p className="mt-0.5 text-lg font-bold leading-tight tracking-tight text-slate-950 tabular-nums">
          {startStr} – {endStr}
        </p>
        {durationMins != null ? (
          <p className="text-[11px] text-slate-600">{durationMins} min</p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${statusClass}`}>
            {detail?.status ?? block.status ?? '—'}
          </span>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      ) : null}
      {actionError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{actionError}</div>
      ) : null}
      {loading && !detail ? <p className="text-sm text-slate-500">Loading details…</p> : null}

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-2">
          <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Guest</p>
          <p className="truncate text-sm font-bold text-slate-900">{guestName}</p>
          {detail?.party_size && detail.party_size > 1 ? (
            <p className="text-[11px] text-slate-500">{detail.party_size} guests</p>
          ) : null}
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-2">
          <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Checked in</p>
          <p className="truncate text-xs font-bold text-slate-800">
            {formatCheckedInAt(detail?.checked_in_at ?? null)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-2">
          <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Email</p>
          {detail?.guest?.email ? (
            <a
              href={`mailto:${detail.guest.email}`}
              className="block truncate text-xs font-bold text-slate-800 hover:text-brand-700"
            >
              {detail.guest.email}
            </a>
          ) : (
            <p className="truncate text-xs font-bold text-slate-400">Not provided</p>
          )}
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-2">
          <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Telephone</p>
          {detail?.guest?.phone ? (
            <a
              href={`tel:${detail.guest.phone}`}
              className="block truncate text-xs font-bold text-slate-800 hover:text-brand-700"
            >
              {detail.guest.phone}
            </a>
          ) : (
            <p className="truncate text-xs font-bold text-slate-400">Not provided</p>
          )}
        </div>
        <div className="col-span-2 rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-2">
          <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Payment</p>
          <p className="text-xs font-bold text-slate-800">
            {resourcePaymentModeLabel(detail?.resource_payment_requirement ?? null)}
            {detail?.deposit_amount_pence != null && detail.deposit_amount_pence > 0 ? (
              <>
                {' '}
                · {formatMoneyPence(detail.deposit_amount_pence, currency)}
                {detail.deposit_status ? (
                  <span className="ml-1 font-medium text-slate-500">({detail.deposit_status})</span>
                ) : null}
              </>
            ) : null}
          </p>
        </div>
      </div>

      <div className="border-t border-slate-100 pt-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Message guest</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <GuestMessageChannelSelect
            value={guestMessageChannel}
            onChange={setGuestMessageChannel}
            disabled={guestMessageSending || actionBusy || !detail}
          />
        </div>
        <textarea
          value={guestMessageDraft}
          onChange={(e) => setGuestMessageDraft(e.target.value)}
          rows={2}
          disabled={guestMessageSending || actionBusy || !detail}
          placeholder="Email or SMS to the guest"
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-60"
        />
        <button
          type="button"
          disabled={guestMessageSending || actionBusy || !detail || guestMessageDraft.trim().length === 0}
          onClick={() => void sendGuestMessage()}
          className="mt-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-50"
        >
          {guestMessageSending ? 'Sending…' : 'Send to guest'}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
        {canCheckIn ? (
          <button
            type="button"
            disabled={actionBusy || !detail}
            onClick={() => void toggleCheckIn()}
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
          >
            {detail?.checked_in_at ? 'Clear check-in' : 'Check in'}
          </button>
        ) : null}
        {canCancel ? (
          <button
            type="button"
            disabled={actionBusy}
            onClick={() => setCancelConfirmOpen(true)}
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-50"
          >
            Cancel booking
          </button>
        ) : null}
        <button
          type="button"
          disabled={actionBusy || !detail}
          onClick={() => {
            setModifyFocusSlot(true);
            setModifyOpen(true);
          }}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Change slot
        </button>
      </div>

      <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
        <Link
          href={`/dashboard/bookings?openBooking=${encodeURIComponent(selection.bookingId)}`}
          className="block rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-center text-xs font-semibold text-slate-700 hover:bg-slate-50"
          onClick={onClose}
        >
          Open in bookings list
        </Link>
        <Link
          href="/dashboard/resource-timeline"
          className="block rounded-lg border border-brand-200 bg-brand-50/50 px-2.5 py-2 text-center text-xs font-semibold text-brand-700 hover:bg-brand-50"
          onClick={onClose}
        >
          Manage resource
        </Link>
      </div>
    </div>
  );

  const headerBlock = (
    <div className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b border-slate-100 bg-white/95 px-2.5 py-2 backdrop-blur sm:px-4 sm:py-3">
      <div className="min-w-0">
        <h2 id="resource-detail-title" className="truncate text-[13px] font-semibold text-slate-900 sm:text-lg">
          {resourceName}
        </h2>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-medium text-slate-600 sm:text-sm">
          <span>{dateStr}</span>
          <span className="text-slate-300">·</span>
          <span className="tabular-nums">
            {startStr} – {endStr}
          </span>
          {durationMins != null ? (
            <>
              <span className="text-slate-300">·</span>
              <span>{durationMins} min</span>
            </>
          ) : null}
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        aria-label="Close resource booking detail"
      >
        <svg className="h-4 w-4 sm:h-5 sm:w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );

  const dialogs = (
    <>
      <Dialog
        open={cancelConfirmOpen}
        onOpenChange={setCancelConfirmOpen}
        title="Cancel resource booking?"
        size="sm"
      >
        <p className="text-sm text-slate-600">
          Cancel this booking for {guestName}? Refunds follow your venue cancellation policy.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={actionBusy}
            onClick={() => setCancelConfirmOpen(false)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Keep booking
          </button>
          <button
            type="button"
            disabled={actionBusy}
            onClick={() => void cancelBooking()}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {actionBusy ? 'Cancelling…' : 'Cancel booking'}
          </button>
        </div>
      </Dialog>

      {modifyOpen && modifySource ? (
        <StaffExpandedBookingModifyModal
          open
          onClose={() => {
            setModifyOpen(false);
            setModifyFocusSlot(false);
          }}
          onSaved={() => {
            setModifyOpen(false);
            setModifyFocusSlot(false);
            void load();
            onUpdated?.();
          }}
          venueId={venueId}
          venueCurrency={currency}
          tableManagementEnabled={false}
          booking={modifySource}
          focusResourceSlotChange={modifyFocusSlot}
          detail={
            detail
              ? {
                  special_requests: detail.special_requests ?? null,
                  internal_notes: detail.internal_notes ?? null,
                  guest: detail.guest ?? null,
                }
              : undefined
          }
        />
      ) : null}
    </>
  );

  const popoverDismissLayer = isPopover ? (
    <button
      type="button"
      tabIndex={-1}
      aria-label="Close resource booking details"
      className="fixed inset-0 z-40 cursor-default bg-transparent p-0"
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    />
  ) : null;

  if (isPopover) {
    return (
      <>
        {popoverDismissLayer}
        <div className="fixed z-50" style={popoverStyle}>
          <aside
            ref={panelRef}
            className="max-h-[inherit] min-w-0 max-w-full overflow-x-hidden overflow-y-auto rounded-2xl border border-slate-200/80 bg-white shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100"
            role="region"
            aria-labelledby="resource-detail-title"
            onClick={(event) => event.stopPropagation()}
          >
            {headerBlock}
            {bodyContent}
          </aside>
        </div>
        {dialogs}
      </>
    );
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
        title={resourceName}
        hideHeader
        showClose={false}
        side="right"
        contentClassName="flex max-h-[90dvh] flex-col overflow-hidden p-0 lg:max-h-none lg:max-w-lg"
      >
        <aside className="flex min-h-0 flex-1 flex-col overflow-y-auto" aria-labelledby="resource-detail-title">
          {headerBlock}
          {bodyContent}
        </aside>
      </Sheet>
      {dialogs}
    </>
  );
}
