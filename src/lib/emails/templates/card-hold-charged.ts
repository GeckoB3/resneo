import type { BookingEmailData, VenueEmailData, RenderedEmail } from "../types";
import { formatCardHoldFeePence } from "@/lib/booking/card-hold-terms";
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
  return booking.appointment_service_name?.trim() || "booking";
}

/**
 * No-show fee receipt (card_hold deposits §10.2.2), sent on charge success by
 * the charge engine and the fee-PI webhook (comm-log type
 * `card_hold_charged_email`). Email is the receipt of record; no SMS in v1.
 */
export function renderCardHoldChargedEmail(
  booking: BookingEmailData,
  venue: VenueEmailData,
  charge: { chargedPence: number; chargedAt?: string | null },
): RenderedEmail {
  const date = formatDate(booking.booking_date);
  const time = formatTime(booking.booking_time);
  const amount = formatCardHoldFeePence(charge.chargedPence);
  const label = bookingLabel(booking);
  const appt = isAppointment(booking);
  const chargedOn = charge.chargedAt ? formatDate(charge.chargedAt.slice(0, 10)) : null;

  const bodyCore =
    `You missed your ${label} at ${venue.name} on ${date} at ${time}. ` +
    `As set out when you booked, a no-show fee of ${amount} has been charged to your saved card` +
    (chargedOn ? ` on ${chargedOn}` : "") +
    `. ` +
    `If you think this is a mistake, please contact ${venue.name} directly.`;

  const mainContent =
    `<p style="margin:0 0 12px 0">Hi ${booking.guest_name},</p>` +
    `<p style="margin:0 0 12px 0">${bodyCore}</p>`;

  const html = renderTransactionalEmailHtml({
    venueName: venue.name,
    venueLogoUrl: venue.logo_url,
    heading: "No-show fee charged",
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
  textParts.push(`Amount charged: ${amount}`);
  if (chargedOn) textParts.push(`Charged on: ${chargedOn}`);
  if (venue.address) textParts.push("", `Address: ${venue.address}`);
  textParts.push("", venue.name);

  return {
    subject: `No-show fee charged: ${venue.name}`,
    html,
    text: textParts.join("\n"),
  };
}
