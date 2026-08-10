'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatBookingModificationNotifyToast } from '@/lib/booking/modification-notify-result';

/**
 * Mirrors the calendar grid's deferred-notify window for drag reschedules
 * (PractitionerCalendarView BOOKING_MODIFY_NOTIFY_DEFER_MS): the guest is
 * notified automatically after this long unless staff notify now, skip, or
 * undo first.
 */
export const MODIFY_NOTIFY_DEFER_MS = 60_000;

export interface BookingScheduleChangeSummary {
  fromDate: string;
  fromTime: string;
  toDate: string;
  toTime: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatSlot(dateYmd: string, timeHm: string): string {
  const d = new Date(`${dateYmd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return `${timeHm} on ${dateYmd}`;
  return `${timeHm} on ${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * Post-save follow-up for the staff Modify form when the appointment start
 * changed (same semantics as the calendar drag's notify / skip / undo pill):
 * the save already happened with the guest notification DEFERRED, and this
 * panel decides what happens to it.
 *
 * - Notify now: send the booking-modification email/SMS and show the result.
 * - Skip notify: never send it.
 * - Undo change: revert the schedule (the parent owns the revert PATCH, which
 *   carries skip_booking_modification_guest_notification) and send nothing.
 * - Countdown expiry: same as Notify now, mirroring the calendar.
 * - Dismissing the panel without choosing (including closing the modal) sends
 *   the notification, matching the server's default for an un-deferred modify:
 *   the deferral exists to offer skip/undo, never to silently drop the update.
 */
export function BookingModifyNotifyFollowUp({
  bookingId,
  change,
  onUndo,
  onClose,
  deferMs = MODIFY_NOTIFY_DEFER_MS,
}: {
  bookingId: string;
  change: BookingScheduleChangeSummary;
  /** Reverts the schedule change; resolves true when the revert saved. */
  onUndo: () => Promise<boolean>;
  /** Fully closes the modify modal. */
  onClose: () => void;
  deferMs?: number;
}) {
  const [phase, setPhase] = useState<'pending' | 'sending' | 'result' | 'undoing'>('pending');
  const [resultText, setResultText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [countdownSec, setCountdownSec] = useState(() => Math.ceil(deferMs / 1000));

  // 'settled' = notified, skipped, or undone: nothing further may fire,
  // including the unmount fallback send.
  const settledRef = useRef(false);
  const notifyInFlightRef = useRef(false);

  const notify = useCallback(async (): Promise<void> => {
    if (settledRef.current || notifyInFlightRef.current) return;
    notifyInFlightRef.current = true;
    settledRef.current = true;
    setPhase('sending');
    setErrorText(null);
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
        setResultText(j.error ?? 'Could not send the update to the customer.');
      } else {
        setResultText(
          formatBookingModificationNotifyToast({
            emailSent: Boolean(j.emailSent),
            smsSent: Boolean(j.smsSent),
            skipped: Boolean(j.skipped),
            skippedReason: j.skippedReason,
          }),
        );
      }
    } catch {
      setResultText('Could not send the update to the customer.');
    } finally {
      notifyInFlightRef.current = false;
      setPhase('result');
    }
  }, [bookingId]);

  // Countdown to the automatic send, mirroring the calendar pill.
  useEffect(() => {
    if (phase !== 'pending') return;
    const interval = setInterval(() => {
      setCountdownSec((sec) => {
        if (sec <= 1) {
          clearInterval(interval);
          void notify();
          return 0;
        }
        return sec - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [phase, notify]);

  // Dismissed without choosing (modal closed, navigation): send, fire and
  // forget. settledRef guards every explicit choice.
  useEffect(() => {
    return () => {
      if (settledRef.current) return;
      settledRef.current = true;
      void fetch(`/api/venue/bookings/${bookingId}/guest-modification-notify`, {
        method: 'POST',
      }).catch(() => {
        /* best effort; the change itself is already saved */
      });
    };
  }, [bookingId]);

  const skip = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    onClose();
  }, [onClose]);

  const undo = useCallback(async () => {
    if (settledRef.current) return;
    settledRef.current = true;
    setPhase('undoing');
    setErrorText(null);
    const ok = await onUndo();
    if (ok) {
      onClose();
      return;
    }
    // The revert failed: the change stands, so the notify decision is live
    // again with the countdown stopped (staff choose explicitly).
    settledRef.current = false;
    setPhase('pending');
    setCountdownSec(0);
    setErrorText('Could not undo the change. The new time is still saved.');
  }, [onUndo, onClose]);

  const changeLine = `Moved from ${formatSlot(change.fromDate, change.fromTime)} to ${formatSlot(change.toDate, change.toTime)}.`;

  if (phase === 'result') {
    return (
      <div className="space-y-4">
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {changeLine}
        </p>
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {resultText}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Done
        </button>
      </div>
    );
  }

  const busy = phase === 'sending' || phase === 'undoing';

  return (
    <div className="space-y-4" role="group" aria-label="Notify the customer, skip, or undo this change">
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <p className="text-sm font-semibold text-slate-800">Time changed and saved</p>
        <p className="mt-0.5 text-sm text-slate-600">{changeLine}</p>
      </div>
      <p className="text-sm text-slate-600">
        {phase === 'pending' && countdownSec > 0
          ? `The customer will be notified in ${countdownSec}s unless you skip or undo.`
          : 'Notify the customer about this change?'}
      </p>
      {errorText ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorText}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void notify()}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {phase === 'sending' ? 'Sending…' : 'Notify now'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={skip}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Skip notify
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void undo()}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {phase === 'undoing' ? 'Undoing…' : 'Undo change'}
        </button>
      </div>
    </div>
  );
}
