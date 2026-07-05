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

export interface CardHoldRequestEmailOptions {
  /** Reminder variant (card_hold_payment_reminder §10.3.2): prefixes the subject. */
  reminder?: boolean;
  customMessage?: string | null;
}

/**
 * Card-request email (card_hold deposits §10.3): asks the guest to add card
 * details to secure the booking. No payment is taken; there is no refund
 * deadline (holds have none, the consent rule is stated in the body).
 * The fee is the consented no-show maximum in pence.
 */
export function renderCardHoldRequestEmail(
  booking: BookingEmailData,
  venue: VenueEmailData,
  paymentLink: string,
  feePence: number,
  opts?: CardHoldRequestEmailOptions,
): RenderedEmail {
  const date = formatDate(booking.booking_date);
  const time = formatTime(booking.booking_time);
  const fee = formatCardHoldFeePence(feePence);
  const appt = isAppointment(booking);
  const customMessage = opts?.customMessage ?? null;

  const bodyCore =
    `No payment is taken now. Add your card details to secure your booking. ` +
    `${venue.name} may charge a no-show fee of up to ${fee} if you do not attend.`;

  const mainContent =
    `<p style="margin:0 0 12px 0">Hi ${booking.guest_name},</p>` +
    `<p style="margin:0 0 12px 0">${bodyCore}</p>`;

  const html = renderTransactionalEmailHtml({
    venueName: venue.name,
    venueLogoUrl: venue.logo_url,
    heading: "Card details needed",
    mainContent,
    bookingDate: date,
    bookingTime: time,
    partySize: booking.party_size,
    venueAddress: venue.address,
    specialRequests: booking.special_requests ?? booking.dietary_notes,
    customMessage: customMessage?.trim() || null,
    emailVariant: appt ? "appointment" : "table",
    practitionerName: booking.practitioner_name ?? null,
    serviceName: booking.appointment_service_name ?? null,
    priceDisplay: booking.appointment_price_display ?? null,
    groupAppointments: booking.group_appointments,
    ctaLabel: "Add card details",
    ctaUrl: paymentLink,
  });

  const textParts = [
    `Hi ${booking.guest_name},`,
    "",
    `${venue.name}: card details needed for your booking on ${date} at ${time}${
      !appt ? ` for ${booking.party_size}` : ""
    }.`,
    "",
    bodyCore,
    "",
    `Add card details: ${paymentLink}`,
  ];
  if (customMessage?.trim()) textParts.splice(3, 0, "", customMessage.trim());
  if (venue.address) textParts.push("", `Address: ${venue.address}`);
  textParts.push("", venue.name);

  const subject = opts?.reminder
    ? `Reminder: add your card details to confirm your booking at ${venue.name}`
    : `Add your card details to confirm your booking at ${venue.name}`;

  return {
    subject,
    html,
    text: textParts.join("\n"),
  };
}
