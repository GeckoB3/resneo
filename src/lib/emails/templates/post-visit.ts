import type { BookingEmailData, VenueEmailData, RenderedEmail } from "../types";
import { renderTransactionalEmailHtml } from "./booking-confirmation-layout";

export function renderPostVisitEmail(
  booking: BookingEmailData,
  venue: VenueEmailData,
  customMessage?: string | null,
): RenderedEmail {
  // Never guess the address from the venue name: a wrong link is worse than no button.
  const bookAgainUrl = venue.booking_page_url ?? null;

  const mainContent =
    `<p style="margin:0 0 12px 0">Hi ${booking.guest_name},</p>` +
    `<p style="margin:0 0 12px 0">We hope you enjoyed your visit.</p>` +
    `<p style="margin:0 0 12px 0">We would love to welcome you back. Book your next visit anytime.</p>`;

  const html = renderTransactionalEmailHtml({
    venueName: venue.name,
    brandColour: venue.brand_colour ?? null,
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
    bookAgainUrl
      ? `We would love to welcome you back. Book again: ${bookAgainUrl}`
      : "We would love to welcome you back.",
  );
  if (customMessage) textParts.push("", customMessage);
  textParts.push("", venue.name);

  return {
    subject: `Thanks for visiting ${venue.name}!`,
    html,
    text: textParts.join("\n"),
  };
}
