import type { BookingEmailData } from '@/lib/emails/types';
import {
  formatRefundDeadlineIso,
  isDepositRefundAvailableAt,
} from '@/lib/booking/cancellation-deadline';
import { formatDepositAmount } from '@/lib/emails/templates/base-template';
import { formatCardHoldFeePence } from '@/lib/booking/card-hold-terms';

export function formatMoneyOrNull(pence: number | null | undefined): string | null {
  if (typeof pence !== 'number') return null;
  return `£${formatDepositAmount(pence)}`;
}

/** Strip trailing venue-payment hint so the detail card shows a clean amount. */
export function normalizePriceDisplayForCard(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const s = raw.replace(/\s*\(pay at venue\)\s*$/i, '').trim();
  return s || null;
}

/** First £ amount in a display string, as pence (for fallbacks when total pence is unset). */
export function parseFirstGbpPence(display: string | null | undefined): number | null {
  if (!display?.trim()) return null;
  const m = display.match(/£\s*([\d.]+)/i);
  if (!m) return null;
  const val = parseFloat(m[1]!);
  if (!Number.isFinite(val)) return null;
  return Math.round(val * 100);
}

/** Total price in pence when known (prefers `booking_total_price_pence`, else first £ in display). */
export function inferredTotalPricePence(booking: BookingEmailData): number | null {
  const totalPence = booking.booking_total_price_pence ?? null;
  if (totalPence != null && totalPence > 0) return totalPence;
  if (totalPence === 0) return 0;
  return parseFirstGbpPence(booking.appointment_price_display);
}

/**
 * Card-hold deposits (§10.2): whether this booking carries an open card hold
 * the confirmation copy should describe. `card_hold_fee_pence` is only
 * populated for open holds (senders pass the consented fee; the confirmation
 * enrichment loads it from unreleased hold rows), so the fee's presence is the
 * primary signal; terminal money states guard against stale data.
 */
export function bookingHasOpenCardHoldDisplay(booking: BookingEmailData): boolean {
  const fee = booking.card_hold_fee_pence ?? 0;
  if (fee <= 0) return false;
  const ds = (booking.deposit_status ?? '').toLowerCase();
  return ds !== 'charged' && ds !== 'refunded' && ds !== 'waived' && ds !== 'failed';
}

/**
 * The §10.2 confirmation-email hold section, with the venue named. Returned as
 * one plain-text paragraph; null when the booking has no open hold.
 */
export function cardHoldConfirmationNotice(
  booking: BookingEmailData,
  venueName: string,
): string | null {
  if (!bookingHasOpenCardHoldDisplay(booking)) return null;
  const fee = formatCardHoldFeePence(booking.card_hold_fee_pence!);
  return (
    `No payment has been taken. Your card is securely on file and ${venueName} ` +
    `may charge a no-show fee of up to ${fee} if you do not attend. ` +
    `Cancel before your booking starts to avoid any charge.`
  );
}

/**
 * Whether the confirmation should present the booking as free (no monetary charge).
 * Excludes pending/paid deposits where money is still involved, and card-hold
 * bookings ("free" would hide the no-show fee the guest consented to, §10.2).
 */
export function isFreeBookingDisplay(booking: BookingEmailData): boolean {
  if (bookingHasOpenCardHoldDisplay(booking)) return false;
  const t = inferredTotalPricePence(booking);
  if (t != null && t > 0) return false;
  const ds = (booking.deposit_status ?? '').toLowerCase();
  if (ds === 'pending' && (booking.deposit_amount_pence ?? 0) > 0) return false;
  if (ds === 'paid' && (booking.deposit_amount_pence ?? 0) > 0) return false;

  if (t === 0) return true;
  if (t == null) {
    const gbp = parseFirstGbpPence(booking.appointment_price_display);
    if (gbp != null && gbp > 0) return false;
    const raw = booking.appointment_price_display?.trim();
    if (raw && !/£/.test(raw)) return false;
    return true;
  }
  return false;
}

function sumGroupAppointmentPricesPence(booking: BookingEmailData): number | null {
  const lines = booking.group_appointments;
  if (!lines?.length) return null;
  let sum = 0;
  let any = false;
  for (const g of lines) {
    // Prefer the per-person subtotal (service + variant + add-ons) when present,
    // falling back to the service-line price.
    const p = parseFirstGbpPence(g.subtotal_display ?? g.price_display ?? undefined);
    if (p != null) {
      sum += p;
      any = true;
    }
  }
  return any ? sum : null;
}

/** Ticket quantity + per-type pricing for event confirmations (email card, plain text). */
export function confirmationEventTicketBreakdownLines(booking: BookingEmailData): string[] {
  const tickets = booking.booking_ticket_price_lines;
  if (!tickets?.length) return [];

  const lines: string[] = [];
  let computedTotal = 0;
  let ticketCount = 0;

  for (const t of tickets) {
    const unit = formatMoneyOrNull(t.unit_price_pence);
    const subtotal = t.quantity * t.unit_price_pence;
    computedTotal += subtotal;
    ticketCount += t.quantity;
    const subFmt = formatMoneyOrNull(subtotal);
    const rawLabel = (t.label?.trim() || 'Ticket').replace(/:\s*$/, '');
    if (!unit || !subFmt) continue;
    if (t.quantity === 1) {
      lines.push(`${rawLabel}: 1 ticket at ${unit} (${subFmt})`);
    } else {
      lines.push(`${rawLabel}: ${t.quantity} tickets at ${unit} each (${subFmt})`);
    }
  }

  if (ticketCount > 0) {
    const ticketWord = ticketCount === 1 ? 'ticket' : 'tickets';
    lines.unshift(`Tickets purchased: ${ticketCount} ${ticketWord}`);
  }

  const tf = formatMoneyOrNull(computedTotal);
  if (tf) {
    lines.push(`Total cost: ${tf}`);
  }

  return lines;
}

function confirmationPaymentPolicyLines(booking: BookingEmailData): string[] {
  const lines: string[] = [];
  const pay = paymentStatusLine(booking);
  if (pay) lines.push(pay);
  const ref = refundPolicyLine(booking);
  if (ref) lines.push(ref);
  return lines;
}

function singleBookingPriceLines(booking: BookingEmailData): string[] {
  const lines: string[] = [];
  const tickets = booking.booking_ticket_price_lines;
  if (tickets?.length) {
    return confirmationEventTicketBreakdownLines(booking);
  }

  const qty =
    typeof booking.booking_price_quantity === 'number' && booking.booking_price_quantity > 0
      ? booking.booking_price_quantity
      : booking.party_size;
  const unitP = booking.booking_unit_price_pence;
  const totalPence = booking.booking_total_price_pence ?? inferredTotalPricePence(booking);
  if (
    typeof unitP === 'number' &&
    unitP > 0 &&
    qty > 1 &&
    totalPence != null &&
    totalPence > 0 &&
    unitP * qty === totalPence
  ) {
    const uf = formatMoneyOrNull(unitP);
    const tf = formatMoneyOrNull(totalPence);
    if (uf && tf) {
      lines.push(`${uf} each × ${qty}`);
      lines.push(`Total: ${tf}`);
      return lines;
    }
  }

  const normalized = normalizePriceDisplayForCard(booking.appointment_price_display);
  if (normalized) {
    // The service-line display (`appointment_price_display`) covers the service +
    // chosen variant only. When add-ons (or other extras) push the booking total
    // above that line price, surface the true total so the email's "Total" matches
    // what the guest is actually charged (service + variant + add-ons).
    const linePence = parseFirstGbpPence(normalized);
    if (totalPence != null && totalPence > 0 && linePence != null && totalPence > linePence) {
      const tf = formatMoneyOrNull(totalPence);
      if (tf) {
        lines.push(tf);
        return lines;
      }
    }
    lines.push(normalized);
    return lines;
  }
  if (totalPence != null && totalPence > 0) {
    const tf = formatMoneyOrNull(totalPence);
    if (tf) lines.push(tf);
  }
  return lines;
}

function groupBookingPriceLines(booking: BookingEmailData): string[] {
  const lines: string[] = [];
  const total =
    booking.booking_total_price_pence != null && booking.booking_total_price_pence > 0
      ? booking.booking_total_price_pence
      : sumGroupAppointmentPricesPence(booking);
  if (total != null && total > 0) {
    const tf = formatMoneyOrNull(total);
    if (tf) lines.push(`Total: ${tf}`);
  }
  return lines;
}

function paymentStatusLine(booking: BookingEmailData): string | null {
  // Card-hold bookings get a dedicated status line instead of "free" /
  // "pay at venue" (§10.2). A hold booking is never 'Paid' (§14), so this
  // cannot shadow the paid-deposit branches below.
  if (bookingHasOpenCardHoldDisplay(booking)) {
    const fee = formatCardHoldFeePence(booking.card_hold_fee_pence!);
    return `No payment taken. Card held for a no-show fee of up to ${fee}.`;
  }

  const ds = (booking.deposit_status ?? '').toLowerCase();
  const paidPence = booking.deposit_amount_pence;
  const totalPence = booking.booking_total_price_pence ?? null;
  const inferredTotal =
    totalPence != null && totalPence > 0
      ? totalPence
      : parseFirstGbpPence(booking.appointment_price_display);
  const hasPositivePrice = inferredTotal != null && inferredTotal > 0;
  const paidOnline = ds === 'paid' && typeof paidPence === 'number' && paidPence > 0;

  if (paidOnline) {
    const amt = formatMoneyOrNull(paidPence);
    if (!amt) return null;
    if (totalPence != null && totalPence > 0 && paidPence >= totalPence) {
      return `Payment: Paid in full online (${amt}).`;
    }
    if (totalPence != null && totalPence > 0 && paidPence < totalPence) {
      const bal = formatMoneyOrNull(totalPence - paidPence);
      return bal
        ? `Payment: Deposit of ${amt} paid online; ${bal} due at the venue.`
        : `Payment: Deposit of ${amt} paid online; balance due at the venue.`;
    }
    return `Payment: ${amt} received online.`;
  }

  if (ds === 'pending' && typeof paidPence === 'number' && paidPence > 0) {
    const dep = formatMoneyOrNull(paidPence);
    const totalFmt =
      totalPence != null && totalPence > 0
        ? formatMoneyOrNull(totalPence)
        : hasPositivePrice && inferredTotal != null
          ? formatMoneyOrNull(inferredTotal)
          : null;
    const head = dep
      ? `Payment: A deposit of ${dep} is required. You will receive payment details in a separate message.`
      : `Payment: A deposit is required. You will receive payment details in a separate message.`;
    return totalFmt ? `${head} Total for this booking: ${totalFmt}.` : head;
  }

  if (hasPositivePrice) {
    return 'Payment: Due at the venue.';
  }

  if (isFreeBookingDisplay(booking)) {
    return null;
  }

  return null;
}

function refundPolicyLine(booking: BookingEmailData): string | null {
  const ds = (booking.deposit_status ?? '').toLowerCase();
  const paidPence = booking.deposit_amount_pence ?? 0;
  if (ds !== 'paid' || paidPence <= 0 || !booking.refund_cutoff) return null;

  const fmt = formatRefundDeadlineIso(booking.refund_cutoff);
  const refundable = isDepositRefundAvailableAt(booking.refund_cutoff);
  const totalPence = booking.booking_total_price_pence ?? inferredTotalPricePence(booking);
  const fullPayment =
    totalPence != null && totalPence > 0 ? paidPence >= totalPence : false;

  if (!refundable) {
    return fullPayment
      ? "Cancellation: The deadline to cancel for a full refund has passed under the venue's policy."
      : "Cancellation: The deadline to cancel for a deposit refund has passed under the venue's policy.";
  }
  if (fullPayment) {
    return `Cancellation: Full refund if you cancel before ${fmt}. No refund after that or for no-shows.`;
  }
  return `Cancellation: Your deposit is fully refundable if you cancel before ${fmt}. After that, the deposit is non-refundable.`;
}

/**
 * Multi-line text for the confirmation detail card ("Price and payment" row) and plain-text summaries.
 * Avoids duplicating amounts in the email intro; use {@link bookingConfirmationPaymentParagraphs} only for
 * non-card contexts (it returns nothing when this covers the booking).
 */
export function confirmationStructuredPriceText(booking: BookingEmailData): string | null {
  const lines: string[] = [];

  if (booking.group_appointments?.length) {
    if (isFreeBookingDisplay(booking)) {
      lines.push('Free');
    } else {
      lines.push(...groupBookingPriceLines(booking));
    }
  } else if (isFreeBookingDisplay(booking)) {
    lines.push('Free');
  } else {
    lines.push(...singleBookingPriceLines(booking));
  }

  lines.push(...confirmationPaymentPolicyLines(booking));

  if (lines.length === 0) return null;
  return lines.join('\n');
}

/** Payment and cancellation copy only (for event emails that show tickets in the detail table). */
export function confirmationPaymentPolicyText(booking: BookingEmailData): string | null {
  const lines = confirmationPaymentPolicyLines(booking);
  if (lines.length === 0) return null;
  return lines.join('\n');
}

export function bookingConfirmationPaymentParagraphs(booking: BookingEmailData): string[] {
  void booking;
  return [];
}

export function bookingConfirmationPaymentTextLines(booking: BookingEmailData): string[] {
  void booking;
  return [];
}

/**
 * Short suffix for SMS (leading space when non-empty). Appointments / unified lanes only.
 */
/**
 * Short ticket + price summary for event booking confirmation SMS.
 */
export function eventBookingConfirmationSmsPriceSuffix(booking: BookingEmailData): string {
  const tickets = booking.booking_ticket_price_lines;
  if (!tickets?.length) {
    return bookingConfirmationSmsPriceSuffix(booking);
  }

  const parts: string[] = [];
  const ticketCount = tickets.reduce((sum, t) => sum + t.quantity, 0);
  const totalPence =
    booking.booking_total_price_pence != null && booking.booking_total_price_pence > 0
      ? booking.booking_total_price_pence
      : tickets.reduce((sum, t) => sum + t.quantity * t.unit_price_pence, 0);
  const totalFmt = formatMoneyOrNull(totalPence > 0 ? totalPence : null);
  const ticketWord = ticketCount === 1 ? 'ticket' : 'tickets';

  if (ticketCount > 0) {
    parts.push(`${ticketCount} ${ticketWord}`);
  }

  for (const t of tickets) {
    const unitFmt = formatMoneyOrNull(t.unit_price_pence);
    if (!unitFmt) continue;
    const label = (t.label?.trim() || 'Ticket').replace(/:\s*$/, '');
    parts.push(t.quantity === 1 ? `${label} ${unitFmt}` : `${label} ${t.quantity}×${unitFmt}`);
  }

  if (totalFmt) {
    parts.push(`total ${totalFmt}`);
  }

  const ds = (booking.deposit_status ?? '').toLowerCase();
  const paidPence = booking.deposit_amount_pence;
  const paidOnline = ds === 'paid' && typeof paidPence === 'number' && paidPence > 0;

  if (paidOnline) {
    const amt = formatMoneyOrNull(paidPence);
    if (amt) {
      if (totalPence > 0 && paidPence >= totalPence) {
        parts.push(`paid in full (${amt})`);
      } else if (totalPence > 0 && paidPence < totalPence) {
        const bal = formatMoneyOrNull(totalPence - paidPence);
        parts.push(bal ? `${amt} paid, ${bal} due at venue` : `${amt} paid, balance due at venue`);
      } else {
        parts.push(`${amt} paid online`);
      }
    }
  } else if (ds === 'pending' && (paidPence ?? 0) > 0) {
    const dep = formatMoneyOrNull(paidPence);
    parts.push(dep ? `${dep} deposit due` : 'deposit due');
  } else if (bookingHasOpenCardHoldDisplay(booking)) {
    // Card-hold event bookings (§10.2): never "free" / "pay at venue".
    const fee = formatCardHoldFeePence(booking.card_hold_fee_pence!);
    parts.push(`card held, no payment taken, no-show fee up to ${fee}`);
  } else if (isFreeBookingDisplay(booking)) {
    parts.push('free');
  } else if (totalFmt) {
    parts.push('pay at venue');
  }

  if (parts.length === 0) return '';
  return ` ${parts.join(', ')}.`;
}

export function bookingConfirmationSmsPriceSuffix(booking: BookingEmailData): string {
  // Card-hold bookings (§10.2): dedicated short suffix, same leading-space
  // pattern as the other branches so it slots into the 160-char SMS budget.
  if (bookingHasOpenCardHoldDisplay(booking)) {
    const fee = formatCardHoldFeePence(booking.card_hold_fee_pence!);
    return ` Card held, no payment taken. No-show fee up to ${fee}.`;
  }

  const ds = (booking.deposit_status ?? '').toLowerCase();
  const paidPence = booking.deposit_amount_pence;
  const totalPence = booking.booking_total_price_pence ?? null;
  const inferredTotal =
    totalPence != null && totalPence > 0
      ? totalPence
      : parseFirstGbpPence(booking.appointment_price_display);
  const hasPositivePrice = inferredTotal != null && inferredTotal > 0;
  const paidOnline = ds === 'paid' && typeof paidPence === 'number' && paidPence > 0;

  if (paidOnline) {
    const amt = formatMoneyOrNull(paidPence);
    if (!amt) return '';
    if (totalPence != null && totalPence > 0 && paidPence >= totalPence) {
      return ` Paid in full (${amt}).`;
    }
    if (totalPence != null && totalPence > 0 && paidPence < totalPence) {
      const bal = formatMoneyOrNull(totalPence - paidPence);
      return bal ? ` ${amt} paid, ${bal} due at venue.` : ` ${amt} paid, balance due at venue.`;
    }
    return ` ${amt} paid online.`;
  }

  if (ds === 'pending' && (paidPence ?? 0) > 0) {
    const dep = formatMoneyOrNull(paidPence);
    const totalFmt =
      totalPence != null && totalPence > 0 ? formatMoneyOrNull(totalPence) : null;
    if (dep && totalFmt) return ` ${dep} deposit due (total ${totalFmt}).`;
    return dep ? ` ${dep} deposit due.` : ' Deposit due.';
  }

  if (isFreeBookingDisplay(booking)) return ' Free.';

  const priceShow =
    normalizePriceDisplayForCard(booking.appointment_price_display) ??
    (inferredTotal != null && inferredTotal > 0 ? formatMoneyOrNull(inferredTotal) : null);

  if (hasPositivePrice && priceShow) {
    return ` ${priceShow} at venue.`;
  }
  if (priceShow) return ` ${priceShow}.`;

  return '';
}
