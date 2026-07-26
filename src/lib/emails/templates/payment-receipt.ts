import type { BookingEmailData, VenueEmailData, RenderedEmail } from "../types";
import { escapeHtml, formatDate, formatTime } from "./base-template";
import { renderTransactionalEmailHtml } from "./booking-confirmation-layout";

function isAppointment(booking: BookingEmailData): boolean {
  return (
    booking.email_variant === "appointment" ||
    Boolean(
      booking.group_appointments?.length ||
        booking.practitioner_name ||
        booking.appointment_service_name,
    )
  );
}

/** Renderer convention: the booked service name where known, else the plain noun. */
function bookingLabel(booking: BookingEmailData): string {
  return booking.appointment_service_name?.trim() || "appointment";
}

function formatPoundsFromPence(pence: number): string {
  return `£${(Number(pence) / 100).toFixed(2)}`;
}

/** Short human booking reference (same derivation as the confirmation email). */
function bookingRef(id: string): string {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/**
 * The payment date in the venue's local timezone, so a payment just after
 * midnight UK time (BST) does not render the previous day. Falls back to the
 * UTC calendar date when the timezone is unknown or the value is unparseable.
 */
function formatPaidOn(
  paidAt: string | null | undefined,
  timezone: string | null | undefined,
): string | null {
  if (!paidAt) return null;
  const d = new Date(paidAt);
  if (isNaN(d.getTime())) return null;
  try {
    return d.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      ...(timezone ? { timeZone: timezone } : {}),
    });
  } catch {
    return formatDate(paidAt.slice(0, 10));
  }
}

/** The payment clock time in the venue's local timezone, e.g. "2:15 pm". */
function formatPaidAtTime(
  paidAt: string | null | undefined,
  timezone: string | null | undefined,
): string | null {
  if (!paidAt) return null;
  const d = new Date(paidAt);
  if (isNaN(d.getTime())) return null;
  try {
    return d
      .toLocaleTimeString("en-GB", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        ...(timezone ? { timeZone: timezone } : {}),
      })
      .toLowerCase();
  } catch {
    return null;
  }
}

/** Customer-facing label for the ledger payment method. */
function paymentMethodLabel(
  method: "card_present" | "cash" | "external" | "online" | null | undefined,
): string | null {
  switch (method) {
    case "card_present":
      return "Card (in person)";
    case "online":
      return "Card (online)";
    case "cash":
      return "Cash";
    case "external":
      return "Other";
    default:
      return null;
  }
}

export interface PaymentReceiptPaymentDetails {
  /** The amount collected by THIS payment. */
  amountPaidPence: number;
  /** When the payment succeeded (ISO). */
  paidAt?: string | null;
  /** Ledger payment method, when known. */
  method?: "card_present" | "cash" | "external" | "online" | null;
  /** Payment reference for support lookups (e.g. the Stripe PaymentIntent id). */
  paymentReference?: string | null;
  /** Whole-booking (visit) price when resolvable. */
  visitTotalPence?: number | null;
  /** Outstanding balance after this payment; 0 means settled in full. */
  balanceDuePence?: number | null;
}

const TEXT_DARK = "#0f172a";
const TEXT_MUTED = "#64748b";
const RULE = "#f1f5f9";
const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif`;

/** Receipt panel: amount, when, how, reference, and the running balance. */
function buildPaymentDetailsHtml(
  booking: BookingEmailData,
  payment: PaymentReceiptPaymentDetails,
  paidOnLine: string | null,
): string {
  const rows: Array<{ label: string; value: string; strong?: boolean }> = [
    { label: "Amount paid", value: formatPoundsFromPence(payment.amountPaidPence), strong: true },
  ];
  if (paidOnLine) rows.push({ label: "Payment date", value: paidOnLine });
  const methodLabel = paymentMethodLabel(payment.method);
  if (methodLabel) rows.push({ label: "Payment method", value: methodLabel });

  if (payment.visitTotalPence != null && payment.visitTotalPence > 0) {
    rows.push({ label: "Booking total", value: formatPoundsFromPence(payment.visitTotalPence) });
  }
  if (payment.balanceDuePence != null) {
    rows.push(
      payment.balanceDuePence > 0
        ? { label: "Remaining balance", value: formatPoundsFromPence(payment.balanceDuePence) }
        : { label: "Balance", value: "Paid in full" },
    );
  }

  const rowsHtml = rows
    .map(
      (r, i) =>
        `<tr>` +
        `<td style="padding:${i === 0 ? "0" : "8px"} 12px 0 0;vertical-align:top">` +
        `<p style="margin:0;font-size:13px;color:${TEXT_MUTED};font-family:${FONT}">${escapeHtml(r.label)}</p>` +
        `</td>` +
        `<td style="padding:${i === 0 ? "0" : "8px"} 0 0;text-align:right;vertical-align:top;white-space:nowrap">` +
        `<p style="margin:0;font-size:${r.strong ? "15px" : "13px"};font-weight:${r.strong ? "700" : "600"};color:${TEXT_DARK};font-family:${FONT}">${escapeHtml(r.value)}</p>` +
        `</td>` +
        `</tr>`,
    )
    .join("");

  const referenceLines =
    `<p style="margin:12px 0 0;padding-top:10px;border-top:1px solid ${RULE};font-size:12px;color:${TEXT_MUTED};font-family:${FONT}">` +
    `Booking ref: ${escapeHtml(bookingRef(booking.id))}` +
    (payment.paymentReference?.trim()
      ? `<br/>Payment ref: <span style="word-break:break-all">${escapeHtml(payment.paymentReference.trim())}</span>`
      : "") +
    `</p>`;

  return (
    `<div style="margin:20px 0 0;padding:16px 18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px">` +
    `<p style="margin:0 0 10px;font-size:11px;font-weight:700;color:${TEXT_MUTED};text-transform:uppercase;letter-spacing:0.06em;font-family:${FONT}">Payment details</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tbody>${rowsHtml}</tbody></table>` +
    referenceLines +
    `</div>`
  );
}

/**
 * Payment receipt (§6.5), sent by the balance webhook on
 * `payment_intent.succeeded` (comm-log type `payment_receipt`). This is the
 * customer's record: a direct-charge card-present payment has no Stripe-hosted
 * email by default. Email only; no SMS in v1.
 *
 * A payment settles the whole visit, so a multi-person / multi-service booking
 * is described as "your booking" with every line itemised underneath; only a
 * true single-service booking names the service in the opening sentence.
 */
export function renderPaymentReceiptEmail(
  booking: BookingEmailData,
  venue: VenueEmailData,
  payment: PaymentReceiptPaymentDetails,
): RenderedEmail {
  const date = formatDate(booking.booking_date);
  const time = formatTime(booking.booking_time);
  const amount = formatPoundsFromPence(payment.amountPaidPence);
  const appt = isAppointment(booking);
  const groupLines = booking.group_appointments ?? [];
  const isMultiLine = groupLines.length > 0;

  const paidOnDate = formatPaidOn(payment.paidAt, venue.timezone);
  const paidAtTime = formatPaidAtTime(payment.paidAt, venue.timezone);
  const paidOnLine = paidOnDate
    ? paidAtTime
      ? `${paidOnDate} at ${paidAtTime}`
      : paidOnDate
    : null;

  // A visit receipt covers every service in the booking; naming one service
  // would misdescribe what was paid for.
  const receiptSubject = isMultiLine
    ? `your booking on ${date} at ${time}`
    : `your ${bookingLabel(booking)} on ${date} at ${time}`;

  const bodyCore =
    `Thanks for your payment of ${amount} to ${venue.name}. ` +
    `This is your receipt for ${receiptSubject}. ` +
    (isMultiLine ? `The services included are listed below. ` : ``) +
    `Please keep this email for your records. ` +
    `If anything looks wrong, please contact ${venue.name} directly.`;

  const mainContent =
    `<p style="margin:0 0 12px 0">Hi ${booking.guest_name},</p>` +
    `<p style="margin:0 0 12px 0">${bodyCore}</p>`;

  const paymentDetailsHtml = buildPaymentDetailsHtml(booking, payment, paidOnLine);

  // Total row under the itemised services: the visit total when known.
  const totalDisplay =
    payment.visitTotalPence != null && payment.visitTotalPence > 0
      ? formatPoundsFromPence(payment.visitTotalPence)
      : null;

  const html = renderTransactionalEmailHtml({
    venueName: venue.name,
    venueLogoUrl: venue.logo_url,
    heading: "Payment received",
    mainContent,
    bookingDate: date,
    bookingTime: time,
    partySize: booking.party_size,
    venueAddress: venue.address,
    emailVariant: appt ? "appointment" : "table",
    practitionerName: booking.practitioner_name ?? null,
    serviceName: booking.appointment_service_name ?? null,
    priceDisplay: isMultiLine
      ? totalDisplay
      : (booking.appointment_price_display ?? totalDisplay),
    groupAppointments: booking.group_appointments,
    addonLines: booking.addon_lines ?? null,
    depositInfoHtml: paymentDetailsHtml,
  });

  // ── Plain-text version ──────────────────────────────────────────────────────

  const textParts = [`Hi ${booking.guest_name},`, "", bodyCore, ""];

  if (isMultiLine) {
    textParts.push("Your booking:");
    for (const g of groupLines) {
      const lineDate = formatDate(g.booking_date);
      const lineTime = formatTime(g.booking_time);
      let line = `- ${g.person_label}: ${g.service_name} with ${g.practitioner_name} on ${lineDate} at ${lineTime}`;
      if (g.price_display?.trim()) line += ` (${g.price_display.trim()})`;
      textParts.push(line);
      for (const addon of g.addon_lines ?? []) {
        textParts.push(`    + ${addon}`);
      }
      if (g.subtotal_display?.trim()) {
        textParts.push(`    Subtotal: ${g.subtotal_display.trim()}`);
      }
    }
    textParts.push("");
  } else {
    textParts.push(`Date: ${date}`, `Time: ${time}`);
    if (appt && booking.appointment_service_name) {
      textParts.push(`Service: ${booking.appointment_service_name}`);
      if (booking.appointment_price_display?.trim()) {
        textParts.push(`Price: ${booking.appointment_price_display.trim()}`);
      }
    }
    for (const addon of booking.addon_lines ?? []) {
      textParts.push(`Extra: ${addon}`);
    }
    textParts.push("");
  }

  textParts.push("Payment details:");
  textParts.push(`Amount paid: ${amount}`);
  if (paidOnLine) textParts.push(`Payment date: ${paidOnLine}`);
  const methodLabel = paymentMethodLabel(payment.method);
  if (methodLabel) textParts.push(`Payment method: ${methodLabel}`);
  if (payment.visitTotalPence != null && payment.visitTotalPence > 0) {
    textParts.push(`Booking total: ${formatPoundsFromPence(payment.visitTotalPence)}`);
  }
  if (payment.balanceDuePence != null) {
    textParts.push(
      payment.balanceDuePence > 0
        ? `Remaining balance: ${formatPoundsFromPence(payment.balanceDuePence)}`
        : `Balance: Paid in full`,
    );
  }
  textParts.push(`Booking ref: ${bookingRef(booking.id)}`);
  if (payment.paymentReference?.trim()) {
    textParts.push(`Payment ref: ${payment.paymentReference.trim()}`);
  }

  if (venue.address) textParts.push("", `Address: ${venue.address}`);
  textParts.push("", venue.name);

  return {
    subject: `Payment received: ${venue.name}`,
    html,
    text: textParts.join("\n"),
  };
}
