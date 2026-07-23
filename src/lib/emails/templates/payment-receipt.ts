import type { BookingEmailData, VenueEmailData, RenderedEmail } from "../types";
import { formatDate, formatTime } from "./base-template";
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

/**
 * In-person payment receipt (§6.5), sent by the balance webhook on
 * `payment_intent.succeeded` (comm-log type `payment_receipt`). This is the
 * customer's record: a direct-charge card-present payment has no Stripe-hosted
 * email by default. Email only; no SMS in v1.
 */
export function renderPaymentReceiptEmail(
  booking: BookingEmailData,
  venue: VenueEmailData,
  payment: { amountPaidPence: number; paidAt?: string | null },
): RenderedEmail {
  const date = formatDate(booking.booking_date);
  const time = formatTime(booking.booking_time);
  const amount = formatPoundsFromPence(payment.amountPaidPence);
  const label = bookingLabel(booking);
  const appt = isAppointment(booking);
  const paidOn = formatPaidOn(payment.paidAt, venue.timezone);

  const bodyCore =
    `Thanks for your payment of ${amount} to ${venue.name}` +
    (paidOn ? ` on ${paidOn}` : "") +
    `. ` +
    `This is your receipt for your ${label} on ${date} at ${time}. ` +
    `If anything looks wrong, please contact ${venue.name} directly.`;

  const mainContent =
    `<p style="margin:0 0 12px 0">Hi ${booking.guest_name},</p>` +
    `<p style="margin:0 0 12px 0">${bodyCore}</p>`;

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
    priceDisplay: null,
    groupAppointments: booking.group_appointments,
  });

  const textParts = [
    `Hi ${booking.guest_name},`,
    "",
    bodyCore,
    "",
    `Date: ${date}`,
    `Time: ${time}`,
  ];
  if (appt && booking.appointment_service_name) {
    textParts.push(`Service: ${booking.appointment_service_name}`);
  }
  textParts.push(`Amount paid: ${amount}`);
  if (paidOn) textParts.push(`Paid on: ${paidOn}`);
  if (venue.address) textParts.push("", `Address: ${venue.address}`);
  textParts.push("", venue.name);

  return {
    subject: `Payment received: ${venue.name}`,
    html,
    text: textParts.join("\n"),
  };
}
