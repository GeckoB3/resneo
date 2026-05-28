import type { BookingEmailData, VenueEmailData, RenderedEmail } from "../types";
import {
  formatRefundDeadlineIso,
  isDepositRefundAvailableAt,
} from "@/lib/booking/cancellation-deadline";
import { formatDate, formatTime, formatDepositAmount } from "./base-template";
import { renderTransactionalEmailHtml } from "./booking-confirmation-layout";

const AMBER_BG = "#FFF3CD";
const AMBER_TEXT = "#664D03";

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

function buildRefundNotice(
  amount: string,
  refundCutoffIso: string,
  at: Date = new Date(),
): string {
  const fmt = formatRefundDeadlineIso(refundCutoffIso);
  const refundable = isDepositRefundAvailableAt(refundCutoffIso, at);
  const body = refundable
    ? `You've paid a deposit of \u00A3${amount}. If your plans change, you can cancel for a full refund before <strong>${fmt}</strong>. After this time, the deposit is non-refundable.`
    : `You've paid a deposit of \u00A3${amount}. Under the venue's policy, the deadline to cancel for a refund has already passed, so this deposit is not refundable if you cancel.`;
  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${AMBER_BG};border:1px solid #FFE69C;border-radius:8px;margin:16px 0">`,
    `<tr><td style="padding:16px;font-size:14px;color:${AMBER_TEXT}">`,
    `<strong>Deposit refund notice</strong><br/>`,
    body,
    "</td></tr></table>",
  ].join("");
}

export function renderReminder56h(
  booking: BookingEmailData,
  venue: VenueEmailData,
  customMessage?: string | null,
): RenderedEmail {
  const date = formatDate(booking.booking_date);
  const time = formatTime(booking.booking_time);
  const hasDeposit =
    booking.deposit_status === "Paid" && booking.deposit_amount_pence;
  const appt = isAppointment(booking);

  let depositHtml: string | null = null;
  if (hasDeposit && booking.refund_cutoff) {
    depositHtml = buildRefundNotice(
      formatDepositAmount(booking.deposit_amount_pence!),
      booking.refund_cutoff,
    );
  }

  const mainContent =
    `<p style="margin:0 0 12px 0">Hi ${booking.guest_name},</p>` +
    `<p style="margin:0 0 12px 0">You have an upcoming booking. Please confirm you're still coming, ` +
    `or use <strong>Manage or cancel</strong> if you need to change or cancel your booking. ` +
    `<strong>If you do not reply, your booking stays in place</strong> — we will not cancel it automatically.</p>`;

  const confirmCancelLink = booking.confirm_cancel_link ?? "";
  const manageLink = booking.manage_booking_link ?? "";

  const html = renderTransactionalEmailHtml({
    venueName: venue.name,
    venueLogoUrl: venue.logo_url,
    heading: "Please confirm your booking",
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
    ctaLabel: confirmCancelLink ? "Confirm my booking" : undefined,
    ctaUrl: confirmCancelLink || null,
    secondaryCtaLabel: manageLink ? "Manage or cancel" : undefined,
    secondaryCtaUrl: manageLink || null,
    footerNote:
      "Paid a deposit? The notice above explains when it is refundable. Use Manage or cancel to change your booking or request cancellation.",
  });

  const textParts = [`Hi ${booking.guest_name},`, ""];
  textParts.push(
    "Quick check on your upcoming booking. Use the confirm link to let us know you are coming, or the manage link to change or cancel. If we do not hear from you, your booking stays in place.",
    "",
  );
  textParts.push(`Date: ${date}`, `Time: ${time}`);
  if (!appt) textParts.push(`Party size: ${booking.party_size}`);
  if (appt && booking.appointment_service_name)
    textParts.push(`Service: ${booking.appointment_service_name}`);
  if (appt && booking.practitioner_name)
    textParts.push(`With: ${booking.practitioner_name}`);
  if (appt && booking.addon_lines && booking.addon_lines.length > 0) {
    textParts.push("Extras:");
    for (const line of booking.addon_lines) textParts.push(`  - ${line}`);
  }
  if (venue.address) textParts.push(`Address: ${venue.address}`);
  if (hasDeposit && booking.refund_cutoff) {
    const fmt = formatRefundDeadlineIso(booking.refund_cutoff);
    const refundable = isDepositRefundAvailableAt(booking.refund_cutoff);
    textParts.push(
      "",
      refundable
        ? `You've paid a deposit of \u00A3${formatDepositAmount(booking.deposit_amount_pence!)}. Full refund if you cancel before ${fmt}. Non-refundable after that.`
        : `You've paid a deposit of \u00A3${formatDepositAmount(booking.deposit_amount_pence!)}. The deadline to cancel for a refund has already passed; this deposit is not refundable if you cancel.`,
    );
  }
  if (customMessage) textParts.push("", customMessage);
  if (confirmCancelLink)
    textParts.push("", `Confirm my booking: ${confirmCancelLink}`);
  if (manageLink && manageLink !== confirmCancelLink) {
    textParts.push(`Manage or cancel: ${manageLink}`);
  }
  textParts.push(
    "",
    "If you take no action, your booking stays in place.",
    venue.name,
  );

  return {
    subject: `Please confirm your booking at ${venue.name} on ${date}`,
    html,
    text: textParts.join("\n"),
  };
}
