'use client';

import { useEffect, useState } from 'react';
import {
  bookingPaymentStateLabel,
  buildPaymentHistory,
  buildPriceSummary,
  formatPence,
  formatPositivePence,
  pendingCardPayments,
  pendingCardState,
  type PaymentDisplayBooking,
} from '@/lib/booking/payment-display';

/** How often to re-check a pending row's age. The stale window is minutes. */
const PENDING_CARD_TICK_MS = 30_000;

/**
 * Read-only view of a booking's payment state: what has been paid (including anything taken in
 * person on the app), any card payment still in flight, and the full ledger.
 *
 * The price breakdown itself lives in {@link BookingPriceSummary}, rendered in the open body of the
 * booking detail: staff want to see what a booking costs without opening anything, whereas these
 * payment mechanics are only wanted when money is actually in question.
 *
 * The web cannot TAKE an in-person payment (that is Tap to Pay / a card reader
 * in the ResNeo app), so there is no collect action here. It exists so a payment
 * taken on the app is visible on the desktop dashboard: without it a booking
 * settled in the chair still reads as unpaid on the web, and a failed or stuck
 * card attempt leaves no trace at all.
 *
 * Mirrors the app's "Payments & confirmation" card. Shared logic lives in
 * `@/lib/booking/payment-display`, ported from the app so the two cannot drift.
 */
export function BookingPaymentDetails({ booking }: { booking: PaymentDisplayBooking }) {
  const history = buildPaymentHistory(booking.payments, booking.id);

  /**
   * Epoch-ms clock for the pending-card age check. Read from a timer callback
   * rather than during render, because render must stay pure, and 0 (not yet
   * read) is deliberately treated as "still in flight" by `pendingCardState`:
   * over-warning for a moment is harmless, under-warning is not.
   *
   * Only runs while something is actually pending, so an ordinary booking never
   * re-renders on a timer.
   */
  const hasPending = pendingCardPayments(booking.payments).length > 0;
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    if (!hasPending) return;
    // A 0ms timeout, not a direct call: the effect schedules the read, it does
    // not perform it, which keeps setState out of the effect body.
    const first = window.setTimeout(() => setNowMs(Date.now()), 0);
    const timer = window.setInterval(() => setNowMs(Date.now()), PENDING_CARD_TICK_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [hasPending]);

  const pending = pendingCardState({ payments: booking.payments, nowMs });

  const state = booking.payment_state ?? null;
  // Neutral information only. 'unpaid' and 'deposit_paid' are normal states and
  // are already conveyed by the price rows, so they get no separate line.
  const showState =
    state === 'paid' || state === 'refunded' || state === 'partially_paid';

  if (history.length === 0 && !showState && pending.verdict === 'none') return null;

  return (
    <div className="space-y-2">
      {pending.verdict !== 'none' ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5">
          <p className="text-[11px] font-semibold text-amber-900">
            {pending.verdict === 'stale' ? 'Card payment unconfirmed' : 'Card payment processing'}
            {pending.totalPence > 0 ? ` · ${formatPence(pending.totalPence)}` : ''}
          </p>
          <p className="mt-0.5 text-[11px] text-amber-800">
            {pending.verdict === 'stale'
              ? 'This started a while ago and has not been confirmed, so it may or may not have gone through. Check the payment history below, or the payment in your Stripe dashboard.'
              : 'This usually clears within a few seconds. If it is still here in a few minutes, check the payment in your Stripe dashboard.'}
          </p>
        </div>
      ) : null}

      {showState && state ? (
        <p className="text-[11px] text-slate-500">
          Payment: <span className="font-medium text-slate-800">{bookingPaymentStateLabel(state)}</span>
          {booking.amount_paid_pence ? ` · ${formatPositivePence(booking.amount_paid_pence) ?? ''}` : ''}
        </p>
      ) : null}

      {history.length > 0 ? (
        <div className="border-t border-slate-100 pt-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Payment history
          </p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-slate-700">
            {history.map((h) => (
              <li key={h.key} className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="font-medium text-slate-800">{h.methodLabel}</span>
                  <span className={`ml-1 ${TONE_CLASS[h.tone]}`}>{h.statusLabel}</span>
                  <span className="ml-1 text-slate-500">{formatLedgerDate(h.createdAt)}</span>
                  {h.note ? <span className="block text-slate-500">{h.note}</span> : null}
                </span>
                <span className="shrink-0 tabular-nums">{formatPence(h.pence)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const TONE_CLASS: Record<string, string> = {
  default: 'text-emerald-700',
  muted: 'text-slate-500',
  warning: 'text-amber-700',
  danger: 'text-red-700',
};

/** Short, unambiguous date for a ledger row. Invalid input renders nothing. */
function formatLedgerDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms));
  } catch {
    return '';
  }
}
