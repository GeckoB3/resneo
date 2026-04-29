import type { BookingEmailData, VenueEmailData, RenderedEmail } from "../types";
import {
  formatRefundDeadlineIso,
  isDepositRefundAvailableAt,
} from "@/lib/booking/cancellation-deadline";
import { isCdeBookingModel } from "@/lib/booking/cde-booking";
import {
  renderBaseTemplate,
  buildDepositCallout,
  formatDate,
  formatTime,
  formatDepositAmount,
  escapeHtml,
} from "./base-template";
import { accountBookingsMagicLinkUrl, accountBookingsPortalUrl } from "@/lib/emails/account-portal-links";
import { confirmationStructuredPriceText } from "@/lib/communications/booking-confirmation-pricing";
import { buildGoogleCalendarAddUrlForBooking } from "@/lib/emails/calendar-links";

/** Non-table detail block: appointments (B/USE) or C/D/E with labels. */
function isAppointmentStyle(booking: BookingEmailData): boolean {
  return (
    booking.email_variant === "appointment" ||
    Boolean(
      booking.group_appointments?.length ||
      booking.practitioner_name ||
      booking.appointment_service_name,
    ) ||
    isCdeBookingModel(booking.booking_model)
  );
}

function confirmationHeadline(
  booking: BookingEmailData,
  venueName: string,
): { heading: string; subject: string } {
  const m = booking.booking_model;
  if (m === "event_ticket") {
    return {
      heading: `Your event at ${venueName} is confirmed`,
      subject: `Your event at ${venueName} is confirmed`,
    };
  }
  if (m === "class_session") {
    return {
      heading: `Your class at ${venueName} is confirmed`,
      subject: `Your class at ${venueName} is confirmed`,
    };
  }
  if (m === "resource_booking") {
    return {
      heading: `Your booking at ${venueName} is confirmed`,
      subject: `Your booking at ${venueName} is confirmed`,
    };
  }
  return {
    heading: `Your booking at ${venueName} is confirmed`,
    subject: `Your booking at ${venueName} is confirmed`,
  };
}

function confirmationIntroLine(booking: BookingEmailData): string {
  const m = booking.booking_model;
  if (m === "event_ticket") {
    return '<p style="margin:0 0 12px 0">Your event booking is confirmed. We look forward to seeing you.</p>';
  }
  if (m === "class_session") {
    return '<p style="margin:0 0 12px 0">Your class booking is confirmed. We look forward to seeing you.</p>';
  }
  if (m === "resource_booking") {
    return '<p style="margin:0 0 12px 0">Your booking is confirmed. We look forward to seeing you.</p>';
  }
  const appt = isAppointmentStyle(booking);
  return appt
    ? '<p style="margin:0 0 12px 0">Your booking is confirmed. We look forward to seeing you.</p>'
    : '<p style="margin:0 0 12px 0">Your booking is confirmed. We look forward to seeing you!</p>';
}

export function renderBookingConfirmation(
  booking: BookingEmailData,
  venue: VenueEmailData,
  customMessage?: string | null,
): RenderedEmail {
  const date = formatDate(booking.booking_date);
  const time = formatTime(booking.booking_time);
  const depositPaid =
    booking.deposit_status === "Paid" && booking.deposit_amount_pence;
  const depositPending =
    booking.deposit_status === "Pending" && booking.deposit_amount_pence;
  const appt = isAppointmentStyle(booking);
  const { heading: headLine, subject: subjectLine } = confirmationHeadline(
    booking,
    venue.name,
  );

  let depositHtml: string | null = null;
  if (depositPaid && !appt) {
    depositHtml = buildDepositCallout(
      formatDepositAmount(booking.deposit_amount_pence!),
      booking.refund_cutoff ?? null,
    );
  }

  let mainContent: string;
  mainContent = confirmationIntroLine(booking);
  const accountPortal =
    booking.account_bookings_link ?? accountBookingsMagicLinkUrl(booking.guest_email) ?? accountBookingsPortalUrl();
  if (accountPortal) {
    const safeUrl = escapeHtml(accountPortal);
    mainContent += `<p style="margin:0 0 12px 0;font-size:14px;color:#475569">All your bookings in one place: <a href="${safeUrl}" style="color:#4E6B78;font-weight:600">View your bookings</a> (sign-in may be required).</p>`;
  }
  if (!appt && depositPending) {
    mainContent += `<p style="margin:0 0 12px 0">A deposit of £${formatDepositAmount(booking.deposit_amount_pence!)} is required. You\'ll receive a separate message with payment details shortly.</p>`;
  }

  const calendarUrl = buildGoogleCalendarAddUrlForBooking(booking, venue);
  let ctaLabel: string | undefined = booking.manage_booking_link ? "Manage booking" : undefined;
  let ctaUrl: string | null | undefined = booking.manage_booking_link;
  let secondaryCtaLabel: string | undefined;
  let secondaryCtaUrl: string | null | undefined;
  if (calendarUrl) {
    if (ctaUrl) {
      secondaryCtaLabel = "Add to calendar";
      secondaryCtaUrl = calendarUrl;
    } else {
      ctaLabel = "Add to calendar";
      ctaUrl = calendarUrl;
    }
  }

  const html = renderBaseTemplate({
    venueName: venue.name,
    venueLogoUrl: venue.logo_url,
    heading: headLine,
    mainContent,
    bookingDate: date,
    bookingTime: time,
    partySize: booking.party_size,
    venueAddress: venue.address,
    specialRequests: booking.special_requests ?? booking.dietary_notes,
    depositInfoHtml: depositHtml,
    customMessage,
    emailVariant: appt ? "appointment" : "table",
    practitionerName: booking.practitioner_name ?? null,
    serviceName: booking.appointment_service_name ?? null,
    priceDisplay: confirmationStructuredPriceText(booking),
    groupAppointments: booking.group_appointments,
    ctaLabel,
    ctaUrl: ctaUrl ?? null,
    secondaryCtaLabel,
    secondaryCtaUrl: secondaryCtaUrl ?? null,
  });

  const textParts = [`Hi ${booking.guest_name},`, ""];
  if (appt) {
    const open =
      booking.booking_model === "event_ticket"
        ? `Your event at ${venue.name} is confirmed.`
        : booking.booking_model === "class_session"
          ? `Your class at ${venue.name} is confirmed.`
          : booking.booking_model === "resource_booking"
            ? `Your booking at ${venue.name} is confirmed.`
            : `Your booking at ${venue.name} is confirmed.`;
    textParts.push(open, "");
    if (booking.group_appointments && booking.group_appointments.length > 0) {
      for (const g of booking.group_appointments) {
        textParts.push(
          `* ${g.person_label}: ${formatDate(g.booking_date)} at ${formatTime(g.booking_time)}. ${g.service_name} with ${g.practitioner_name}${g.price_display ? ` (${g.price_display})` : ""}`,
        );
      }
      const structuredGroup = confirmationStructuredPriceText(booking);
      if (structuredGroup) {
        textParts.push("Price and payment:", ...structuredGroup.split("\n"));
      }
      textParts.push("");
    } else {
      textParts.push(`Date: ${date}`, `Time: ${time}`);
      if (
        isCdeBookingModel(booking.booking_model) &&
        booking.appointment_service_name
      ) {
        textParts.push(`Details: ${booking.appointment_service_name}`);
        if (booking.practitioner_name)
          textParts.push(booking.practitioner_name);
      } else {
        if (booking.appointment_service_name)
          textParts.push(`Service: ${booking.appointment_service_name}`);
        if (booking.practitioner_name)
          textParts.push(`With: ${booking.practitioner_name}`);
      }
      const structured = confirmationStructuredPriceText(booking);
      if (structured) {
        textParts.push("Price and payment:", ...structured.split("\n"));
      }
      textParts.push("");
    }
  } else {
    textParts.push(
      `Your reservation at ${venue.name} is confirmed.`,
      "",
      `Date: ${date}`,
      `Time: ${time}`,
      `Party size: ${booking.party_size}`,
      "",
    );
  }
  if (venue.address) textParts.push(`Address: ${venue.address}`);
  if (!appt && booking.special_requests)
    textParts.push(`Special requests: ${booking.special_requests}`);
  if (appt && (booking.special_requests ?? booking.dietary_notes)) {
    textParts.push(
      `Notes: ${(booking.special_requests ?? booking.dietary_notes)!}`,
    );
  }
  if (depositPaid && !appt) {
    textParts.push(
      "",
      `Deposit paid: £${formatDepositAmount(booking.deposit_amount_pence!)}`,
    );
    if (booking.refund_cutoff) {
      const fmt = formatRefundDeadlineIso(booking.refund_cutoff);
      if (isDepositRefundAvailableAt(booking.refund_cutoff)) {
        textParts.push(
          `Full refund if you cancel before ${fmt}. No refund after that or for no-shows.`,
        );
      } else {
        textParts.push(
          "This deposit is not refundable if you cancel. The deadline to cancel for a refund has already passed under the venue's policy.",
        );
      }
    }
  }
  if (customMessage) textParts.push("", customMessage);
  if (calendarUrl) {
    if (booking.manage_booking_link) {
      textParts.push("", `Manage your booking: ${booking.manage_booking_link}`);
      textParts.push(`Add to calendar: ${calendarUrl}`);
    } else {
      textParts.push("", `Add to calendar: ${calendarUrl}`);
    }
  } else if (booking.manage_booking_link) {
    textParts.push("", `Manage your booking: ${booking.manage_booking_link}`);
  }
  const portalText =
    booking.account_bookings_link ?? accountBookingsMagicLinkUrl(booking.guest_email) ?? accountBookingsPortalUrl();
  if (portalText) {
    textParts.push("", `View all your bookings: ${portalText}`);
  }
  textParts.push(
    "",
    appt ? `We look forward to seeing you.` : `We look forward to seeing you!`,
    venue.name,
  );

  return {
    subject: subjectLine,
    html,
    text: textParts.join("\n"),
  };
}
