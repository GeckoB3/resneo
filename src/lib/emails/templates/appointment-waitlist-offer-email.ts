import type { RenderedEmail } from '../types';
import { escapeHtml, formatDate } from './base-template';
import { renderTransactionalEmailHtml } from './booking-confirmation-layout';

export interface AppointmentWaitlistOfferEmailInput {
  venueName: string;
  venueLogoUrl?: string | null;
  /** Brand colour for buttons and links when the venue brands its emails. */
  venueBrandColour?: string | null;
  venueAddress?: string | null;
  venuePhone?: string | null;
  guestName: string;
  desiredDate: string;
  /** Window label, e.g. "All day", "14:30", or "10:00 – 14:00". */
  timeWindowLabel: string;
  bookingPageUrl: string | null;
}

function preferredTimeDetailLine(timeWindowLabel: string): string {
  if (timeWindowLabel === 'All day') {
    return 'any time that day';
  }
  if (timeWindowLabel.includes('–')) {
    return `between ${timeWindowLabel}`;
  }
  return `at ${timeWindowLabel}`;
}

export function renderAppointmentWaitlistOfferEmail(
  input: AppointmentWaitlistOfferEmailInput,
): RenderedEmail {
  const dateLabel = formatDate(input.desiredDate);
  const isAllDay = input.timeWindowLabel === 'All day';
  const whenLine = preferredTimeDetailLine(input.timeWindowLabel);

  let mainContent =
    `<p style="margin:0 0 12px 0">Hi ${escapeHtml(input.guestName)},</p>` +
    `<p style="margin:0 0 12px 0">Good news: availability has opened at <strong>${escapeHtml(input.venueName)}</strong> on <strong>${escapeHtml(dateLabel)}</strong> ${escapeHtml(whenLine)} for the appointment you requested.</p>` +
    `<p style="margin:0 0 12px 0">Visit our booking page to see what is available and book online.</p>`;

  if (input.venuePhone?.trim()) {
    mainContent +=
      `<p style="margin:0 0 12px 0">If you need help, call us on <strong>${escapeHtml(input.venuePhone.trim())}</strong>.</p>`;
  }

  const html = renderTransactionalEmailHtml({
    venueName: input.venueName,
    brandColour: input.venueBrandColour ?? null,
    venueLogoUrl: input.venueLogoUrl,
    heading: 'Appointment availability',
    mainContent,
    bookingDate: dateLabel,
    bookingTime: isAllDay ? undefined : input.timeWindowLabel,
    venueAddress: input.venueAddress,
    emailVariant: 'appointment',
    ctaLabel: input.bookingPageUrl ? 'View availability' : undefined,
    ctaUrl: input.bookingPageUrl,
    footerNote: `You received this email because you joined the waitlist at ${input.venueName}.`,
  });

  const textParts = [
    `Hi ${input.guestName},`,
    '',
    `Good news: availability has opened at ${input.venueName} on ${dateLabel} ${whenLine} for the appointment you requested.`,
    '',
    'Visit our booking page to see what is available and book online.',
  ];
  if (input.venuePhone?.trim()) {
    textParts.push('', `Call us: ${input.venuePhone.trim()}`);
  }
  if (input.bookingPageUrl) {
    textParts.push('', `Book online: ${input.bookingPageUrl}`);
  }
  if (input.venueAddress?.trim()) {
    textParts.push('', `Address: ${input.venueAddress.trim()}`);
  }
  textParts.push('', input.venueName);

  return {
    subject: `Appointment availability at ${input.venueName}`,
    html,
    text: textParts.join('\n'),
  };
}
