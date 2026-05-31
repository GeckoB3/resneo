import type { BookingEmailData, VenueEmailData, RenderedEmail } from "../types";
import {
  formatRefundDeadlineIso,
  isDepositRefundAvailableAt,
} from "@/lib/booking/cancellation-deadline";
import {
  buildDepositCallout,
  escapeHtml,
  formatDate,
  formatTime,
  formatDepositAmount,
} from "./base-template";
import { renderTransactionalEmailHtml } from "./booking-confirmation-layout";
import { accountBookingsMagicLinkUrl, accountBookingsPortalUrl } from "@/lib/emails/account-portal-links";

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

export function renderDepositConfirmation(
  booking: BookingEmailData,
  venue: VenueEmailData,
  customMessage?: string | null,
): RenderedEmail {
  const date = formatDate(booking.booking_date);
  const time = formatTime(booking.booking_time);
  const amount = booking.deposit_amount_pence
    ? formatDepositAmount(booking.deposit_amount_pence)
    : "0.00";
  const appt = isAppointment(booking);

  const depositHtml = buildDepositCallout(amount, booking.refund_cutoff ?? null);

  const portal =
    booking.account_bookings_link ??
    accountBookingsMagicLinkUrl(booking.guest_email) ??
    accountBookingsPortalUrl();
  const portalHtml = portal
    ? `<p style="margin:0 0 12px 0;font-size:14px;color:#475569">All your bookings in one place: <a href="${escapeHtml(portal)}" style="color:#003B6F;font-weight:600">View your bookings</a> (sign-in may be required).</p>`
    : "";

  const mainContent =
    `<p style="margin:0 0 12px 0">Hi ${booking.guest_name},</p>` +
    `<p style="margin:0 0 12px 0">Thank you. Your deposit of \u00A3${amount} has been received.</p>` +
    portalHtml;

  const html = renderTransactionalEmailHtml({
    venueName: venue.name,
    venueLogoUrl: venue.logo_url,
    heading: "Deposit received",
    mainContent,
    bookingDate: date,
    bookingTime: time,
    partySize: booking.party_size,
    venueAddress: venue.address,
    depositInfoHtml: depositHtml,
    customMessage,
    emailVariant: appt ? "appointment" : "table",
    practitionerName: booking.practitioner_name ?? null,
    serviceName: booking.appointment_service_name ?? null,
    priceDisplay: booking.appointment_price_display ?? null,
    groupAppointments: booking.group_appointments,
    ctaLabel: booking.manage_booking_link ? "Manage booking" : undefined,
    ctaUrl: booking.manage_booking_link,
  });

  const textParts = [`Hi ${booking.guest_name},`, ""];
  textParts.push(
    `Thank you. Your deposit of \u00A3${amount} has been received for your booking at ${venue.name}.`,
    "",
    `Date: ${date}`,
    `Time: ${time}`,
  );
  if (!appt) textParts.push(`Party size: ${booking.party_size}`);
  if (appt && booking.appointment_service_name)
    textParts.push(`Service: ${booking.appointment_service_name}`);
  if (booking.refund_cutoff) {
    const fmt = formatRefundDeadlineIso(booking.refund_cutoff);
    if (isDepositRefundAvailableAt(booking.refund_cutoff)) {
      textParts.push(
        "",
        `Your deposit is fully refundable if you cancel before ${fmt}.`,
      );
    } else {
      textParts.push(
        "",
        "Under the venue's policy, this deposit is not refundable if you cancel. The deadline to cancel for a refund has already passed.",
      );
    }
  }
  if (customMessage) textParts.push("", customMessage);
  if (booking.manage_booking_link) {
    textParts.push("", `Manage your booking: ${booking.manage_booking_link}`);
  }
  if (portal) {
    textParts.push("", `View all your bookings: ${portal}`);
  }
  textParts.push("", venue.name);

  return {
    subject: `Deposit received for your booking at ${venue.name}`,
    html,
    text: textParts.join("\n"),
  };
}
