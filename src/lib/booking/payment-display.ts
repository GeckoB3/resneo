/**
 * In-person payments: pure display helpers for the web dashboard.
 *
 * The web cannot TAKE an in-person payment (that is Tap to Pay / card reader in
 * the ResNeo app), but it must show what the app collected. Everything the app
 * needs is already returned by `GET /api/venue/bookings/[id]`: the resolved
 * totals, the live `payment_state` / `amount_paid_pence` / `balance_due_pence`,
 * the visit picture, and the `booking_payments` ledger rows.
 *
 * Ported from the app's `lib/payments/payment-display.ts`, display subset only:
 * the charge-gate and amount-validation helpers are deliberately omitted because
 * nothing here can collect money. Keep the two in step: if the app changes how a
 * ledger row reads, this must follow, or the same booking will describe itself
 * two different ways on phone and desktop.
 *
 * Pure functions: no React, no fetching, unit-testable.
 * `unpaid` / `deposit_paid` / `partially_paid` are NORMAL states and are
 * rendered as neutral information, never as an error or a required action.
 */

import type { BookingPaymentState } from '@/lib/booking/payment-summary';

/** One in-person ledger row (`booking_payments`) as the booking GET returns it. */
export interface BookingPaymentRow {
  id: string;
  /** Which booking of the visit the row is anchored to; older payloads omit it. */
  booking_id?: string | null;
  method: 'card_present' | 'cash' | 'external' | 'online';
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  amount_pence: number;
  note: string | null;
  created_at: string;
}

/** One priced service of a visit. */
export interface VisitPaymentLine {
  booking_id: string;
  name: string | null;
  total_pence: number | null;
}

/**
 * The visit behind a booking's balance. A multi-service visit is several
 * `bookings` rows sharing a `group_booking_id`, and one collection settles all
 * of them, so the balance shown is the visit's, not the opened line's.
 */
export interface VisitPayment {
  booking_count: number;
  booking_ids: string[];
  total_pence: number | null;
  amount_paid_pence: number;
  balance_due_pence: number | null;
  lines?: VisitPaymentLine[];
}

/** The payment-bearing fields of the booking detail payload. */
export interface PaymentDisplayBooking {
  id: string;
  deposit_status?: string | null;
  deposit_amount_pence?: number | null;
  service_variant_name?: string | null;
  service_variant_price_pence?: number | null;
  booking_total_price_pence?: number | null;
  addons?: Array<{
    id?: string;
    addon_id?: string | null;
    addon_name_snapshot: string;
    price_pence_at_booking: number;
  }>;
  addons_total_price_pence?: number | null;
  amount_paid_pence?: number | null;
  payment_state?: BookingPaymentState | null;
  balance_due_pence?: number | null;
  visit_payment?: VisitPayment | null;
  payments?: BookingPaymentRow[];
}

/** Money for display. Falls back to a plain string if Intl is unavailable. */
export function formatPence(pence: number | null | undefined): string | null {
  if (pence == null) return null;
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(
      pence / 100,
    );
  } catch {
    return `£${(pence / 100).toFixed(2)}`;
  }
}

/** Like {@link formatPence} but treats 0 or negative as "no amount". */
export function formatPositivePence(pence: number | null | undefined): string | null {
  if (pence == null || pence <= 0) return null;
  return formatPence(pence);
}

/** One line of the price summary. */
export interface PriceSummaryRow {
  key: string;
  label: string;
  /** Amount in pence, or null when `note` explains why there isn't one. */
  pence: number | null;
  /** Shown in place of an amount (e.g. an unpriced service). */
  note?: string;
  /** Totals and the outstanding balance read louder than the item lines. */
  emphasis?: boolean;
  /** Add-ons sit under their service. */
  indent?: boolean;
}

/**
 * The money breakdown: each priced item, the booking total, the visit total when
 * this is one line of a multi-service visit, what has been paid (deposit
 * included), and what is outstanding. Returns `[]` when there is nothing to say.
 *
 * Two deliberate choices carried over from the app:
 *
 * 1. An unpriced service still produces a row, labelled rather than hidden.
 *    `booking_total_price_pence` is NULL for appointments created by the widget,
 *    the app, or staff booking, so the total falls back to variant + add-ons.
 * 2. The deposit is not subtracted on screen. `amount_paid_pence` already
 *    includes a paid deposit, so showing both as deductions double-counts.
 */
export function buildPriceSummary(booking: PaymentDisplayBooking): PriceSummaryRow[] {
  const rows: PriceSummaryRow[] = [];

  const variantPence = booking.service_variant_price_pence ?? null;
  const serviceLabel = booking.service_variant_name?.trim() || null;
  const addons = booking.addons ?? [];

  const visit = booking.visit_payment ?? null;
  // A multi-service visit lists every service from `visit_payment.lines`. Those
  // per-line totals already include each line's add-ons, so this booking's own
  // add-on rows and "Booking total" are suppressed to avoid double-counting.
  const visitLines = visit && visit.booking_count > 1 ? (visit.lines ?? []) : [];
  const useVisitLines = visitLines.length > 1;

  if (useVisitLines) {
    visitLines.forEach((line, idx) => {
      const label =
        line.name?.trim() ||
        (line.booking_id === booking.id ? serviceLabel : null) ||
        'Service';
      rows.push({
        key: `line-${line.booking_id}-${idx}`,
        label,
        pence: line.total_pence,
        ...(line.total_pence == null ? { note: 'Price not set' } : {}),
      });
    });
  } else {
    if (serviceLabel) {
      rows.push({
        key: 'service',
        label: serviceLabel,
        pence: variantPence,
        ...(variantPence == null ? { note: 'Price not set' } : {}),
      });
    }

    addons.forEach((addon, idx) => {
      rows.push({
        key: `addon-${addon.id ?? addon.addon_id ?? idx}`,
        label: addon.addon_name_snapshot,
        pence: addon.price_pence_at_booking,
        indent: true,
      });
    });
  }

  // Mirrors the backend resolver: stored column wins, else variant + add-ons,
  // else the price is genuinely unknown.
  const addonsTotal = booking.addons_total_price_pence ?? 0;
  const computed = (variantPence ?? 0) + addonsTotal;
  const totalPence =
    booking.booking_total_price_pence != null && booking.booking_total_price_pence > 0
      ? booking.booking_total_price_pence
      : computed > 0
        ? computed
        : null;

  const onlyItemPence = rows.length === 1 ? rows[0]!.pence : null;
  if (!useVisitLines && totalPence != null && !(rows.length === 1 && onlyItemPence === totalPence)) {
    rows.push({ key: 'total', label: 'Booking total', pence: totalPence, emphasis: true });
  }

  if (visit && visit.booking_count > 1) {
    rows.push({
      key: 'visit-total',
      label: `Visit total (${visit.booking_count} services)`,
      pence: visit.total_pence,
      ...(visit.total_pence == null ? { note: 'Not known' } : {}),
      emphasis: true,
    });
  }

  const depositPaid =
    booking.deposit_status === 'Paid' && (booking.deposit_amount_pence ?? 0) > 0
      ? (booking.deposit_amount_pence as number)
      : null;
  if (depositPaid != null) {
    rows.push({ key: 'deposit', label: 'Deposit paid', pence: depositPaid });
  }

  const amountPaid = booking.amount_paid_pence ?? 0;
  if (amountPaid > 0 && amountPaid !== depositPaid) {
    rows.push({ key: 'paid', label: 'Paid so far', pence: amountPaid });
  }

  const balance = booking.balance_due_pence ?? null;
  const hasMoneyContext = totalPence != null || depositPaid != null || amountPaid > 0;
  if (balance != null && balance > 0) {
    rows.push({ key: 'balance', label: 'Outstanding', pence: balance, emphasis: true });
  } else if (balance === 0 && hasMoneyContext) {
    rows.push({ key: 'balance', label: 'Outstanding', pence: 0, emphasis: true });
  } else if (balance == null && hasMoneyContext) {
    rows.push({
      key: 'balance',
      label: 'Outstanding',
      pence: null,
      note: 'Price not set',
      emphasis: true,
    });
  }

  return rows;
}

/** Neutral labels for the whole-booking payment state. */
export function bookingPaymentStateLabel(state: BookingPaymentState): string {
  switch (state) {
    case 'unpaid':
      return 'Unpaid';
    case 'deposit_paid':
      return 'Deposit paid';
    case 'partially_paid':
      return 'Partially paid';
    case 'paid':
      return 'Paid';
    case 'refunded':
      return 'Refunded';
  }
}

/** Short labels for a ledger row's collection method. */
export function paymentMethodLabel(method: BookingPaymentRow['method']): string {
  switch (method) {
    case 'card_present':
      return 'Card';
    case 'cash':
      return 'Cash';
    case 'external':
      return 'Other';
    case 'online':
      return 'Online';
  }
}

/** Card rows the venue is still waiting on. */
export function pendingCardPayments(
  payments: BookingPaymentRow[] | null | undefined,
): BookingPaymentRow[] {
  return (payments ?? []).filter((p) => p.status === 'pending' && p.method === 'card_present');
}

/** Total of the card payments currently in flight (0 when there are none). */
export function pendingCardTotalPence(payments: BookingPaymentRow[] | null | undefined): number {
  return pendingCardPayments(payments).reduce((sum, p) => sum + p.amount_pence, 0);
}

/**
 * Past this age a `pending` card row is stuck, not in flight: its webhook is not
 * coming. Same window the app uses, so both surfaces stop waiting together.
 */
export const PENDING_CARD_STALE_MS = 5 * 60_000;

export type PendingCardVerdict = 'none' | 'in_flight' | 'stale';

export interface PendingCardState {
  verdict: PendingCardVerdict;
  rows: BookingPaymentRow[];
  totalPence: number;
}

/**
 * The pending-card verdict for a booking.
 *
 * Takes `nowMs` rather than reading the clock so render stays pure; callers read
 * the clock in an effect. A `nowMs` of 0 means "not read yet" and is treated as
 * in flight, because warning for a few extra seconds costs nothing.
 *
 * Note the app additionally filters out attempts that client watched decline
 * (its local `failedCardAttempts` store). The web has no such store and never
 * initiates a tap, so every pending row it sees is genuinely unexplained here.
 */
export function pendingCardState(args: {
  payments: BookingPaymentRow[] | null | undefined;
  nowMs: number;
}): PendingCardState {
  const rows = pendingCardPayments(args.payments);
  if (rows.length === 0) return { verdict: 'none', rows: [], totalPence: 0 };

  const totalPence = rows.reduce((sum, row) => sum + row.amount_pence, 0);
  const newestMs = rows.reduce((newest, row) => {
    const at = Date.parse(row.created_at);
    return Number.isNaN(at) ? newest : Math.max(newest, at);
  }, 0);
  const stale = args.nowMs > 0 && newestMs > 0 && args.nowMs - newestMs > PENDING_CARD_STALE_MS;
  return { verdict: stale ? 'stale' : 'in_flight', rows, totalPence };
}

/** How a ledger row's status should read to staff. */
const PAYMENT_STATUS_LABEL: Record<BookingPaymentRow['status'], string> = {
  pending: 'Processing',
  succeeded: 'Collected',
  failed: 'Failed',
  refunded: 'Refunded',
};

/** One line of the booking's payment history. */
export interface PaymentHistoryRow {
  key: string;
  pence: number;
  methodLabel: string;
  statusLabel: string;
  /** Drives the status colour: settled, in flight, or a problem. */
  tone: 'default' | 'muted' | 'warning' | 'danger';
  /** ISO timestamp for the caller to format. */
  createdAt: string;
  /** Note when the row was collected on a sibling service of the visit. */
  note: string | null;
}

/**
 * The ledger as staff need to read it at end of day: every row, newest first.
 *
 * `failed` and `pending` rows are deliberately included. They are the only trace
 * of a card attempt that went wrong, and hiding them is what left a booking
 * looking simply unpaid after a tap that did charge the client.
 * `payments[]` is VISIT-wide, so rows anchored elsewhere carry a note.
 */
export function buildPaymentHistory(
  payments: BookingPaymentRow[] | null | undefined,
  openedBookingId: string,
): PaymentHistoryRow[] {
  const tones: Record<BookingPaymentRow['status'], PaymentHistoryRow['tone']> = {
    pending: 'warning',
    succeeded: 'default',
    failed: 'danger',
    refunded: 'muted',
  };
  return [...(payments ?? [])]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((p) => ({
      key: p.id,
      pence: p.amount_pence,
      methodLabel: paymentMethodLabel(p.method),
      statusLabel: PAYMENT_STATUS_LABEL[p.status],
      tone: tones[p.status],
      createdAt: p.created_at,
      note: otherVisitLineNote(p, openedBookingId),
    }));
}

/**
 * `payments[]` is VISIT-wide, so a row listed under this booking may have been
 * collected on a different service of the same visit. Staff need to see which,
 * because the amount and the service on screen will not match up.
 */
export function otherVisitLineNote(
  payment: BookingPaymentRow,
  openedBookingId: string,
): string | null {
  if (!payment.booking_id || payment.booking_id === openedBookingId) return null;
  return 'Collected on another service in this visit';
}
