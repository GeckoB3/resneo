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

export function renderDayOfReminderEmail(
  booking: BookingEmailData,
  venue: VenueEmailData,
  customMessage?: string | null,
): RenderedEmail {
  const date = formatDate(booking.booking_date);
  const time = formatTime(booking.booking_time);
  const appt = isAppointment(booking);

  const [h] = booking.booking_time.slice(0, 5).split(":").map(Number);
  const timeOfDay = (h ?? 18) < 15 ? "today" : "tonight";

  const mainContent =
    `<p style="margin:0 0 12px 0">Hi ${booking.guest_name},</p>` +
    `<p style="margin:0 0 12px 0">This is a friendly reminder about your booking ${timeOfDay}.</p>`;

  const html = renderTransactionalEmailHtml({
    venueName: venue.name,
    venueLogoUrl: venue.logo_url,
    heading: `See you ${timeOfDay}!`,
    mainContent,
    bookingDate: date,
    bookingTime: time,
    partySize: booking.party_size,
    venueAddress: venue.address,
    specialRequests: booking.special_requests ?? booking.dietary_notes,
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
  if (appt) {
    textParts.push(
      `Reminder: you have a booking ${timeOfDay} at ${venue.name}.`,
      "",
    );
    if (booking.group_appointments && booking.group_appointments.length > 0) {
      for (const g of booking.group_appointments) {
        textParts.push(
          `* ${g.person_label}: ${formatDate(g.booking_date)} ${formatTime(g.booking_time)}. ${g.service_name} with ${g.practitioner_name}`,
        );
      }
      textParts.push("");
    } else {
      textParts.push(`Date: ${date}`, `Time: ${time}`);
      if (booking.appointment_service_name)
        textParts.push(`Service: ${booking.appointment_service_name}`);
      if (booking.practitioner_name)
        textParts.push(`With: ${booking.practitioner_name}`);
      textParts.push("");
    }
  } else {
    textParts.push(
      `We're looking forward to seeing you ${timeOfDay} at ${venue.name}!`,
      "",
      `Date: ${date}`,
      `Time: ${time}`,
      `Party size: ${booking.party_size}`,
      "",
    );
  }
  if (venue.address) textParts.push(`Address: ${venue.address}`);
  if (booking.special_requests)
    textParts.push(`Notes: ${booking.special_requests}`);
  if (customMessage) textParts.push("", customMessage);
  if (booking.manage_booking_link) {
    textParts.push("", `Manage your booking: ${booking.manage_booking_link}`);
  }
  textParts.push("", venue.name);

  return {
    subject: `See you ${timeOfDay} at ${venue.name}!`,
    html,
    text: textParts.join("\n"),
  };
}
