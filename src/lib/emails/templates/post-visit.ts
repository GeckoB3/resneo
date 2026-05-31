import type { BookingEmailData, VenueEmailData, RenderedEmail } from "../types";
import { renderTransactionalEmailHtml } from "./booking-confirmation-layout";

export function renderPostVisitEmail(
  booking: BookingEmailData,
  venue: VenueEmailData,
  customMessage?: string | null,
): RenderedEmail {
  const bookAgainUrl =
    venue.booking_page_url ??
    `${process.env.NEXT_PUBLIC_BASE_URL || "https://www.resneo.com"}/book/${venue.name.toLowerCase().replace(/\s+/g, "-")}`;

  const mainContent =
    `<p style="margin:0 0 12px 0">Hi ${booking.guest_name},</p>` +
    `<p style="margin:0 0 12px 0">We hope you enjoyed your visit.</p>` +
    `<p style="margin:0 0 12px 0">We would love to welcome you back. Book your next visit anytime.</p>`;

  const html = renderTransactionalEmailHtml({
    venueName: venue.name,
    venueLogoUrl: venue.logo_url,
    heading: "Thanks for your visit!",
    mainContent,
    customMessage,
    ctaLabel: "Book again",
    ctaUrl: bookAgainUrl,
    footerNote: `You received this email because you had a booking at ${venue.name}.`,
  });

  const textParts = [`Hi ${booking.guest_name},`, ""];
  textParts.push(
    `We hope you enjoyed your visit to ${venue.name}.`,
    "",
    `We would love to welcome you back. Book again: ${bookAgainUrl}`,
  );
  if (customMessage) textParts.push("", customMessage);
  textParts.push("", venue.name);

  return {
    subject: `Thanks for visiting ${venue.name}!`,
    html,
    text: textParts.join("\n"),
  };
}
