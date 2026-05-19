import type { RenderedEmail } from '../types';
import { escapeHtml, formatDate } from './base-template';
import { renderTransactionalEmailHtml } from './booking-confirmation-layout';

const AMBER_BG = '#FFF3CD';
const AMBER_BORDER = '#FFE69C';
const AMBER_TEXT = '#664D03';

export interface AppointmentWaitlistOfferEmailInput {
  venueName: string;
  venueLogoUrl?: string | null;
  venueAddress?: string | null;
  venuePhone?: string | null;
  guestName: string;
  desiredDate: string;
  /** Window label, e.g. "All day", "14:30", or "10:00 – 14:00". */
  timeWindowLabel: string;
  expiresAtLabel: string;
  bookingPageUrl: string | null;
}

function buildExpiryCallout(expiresAtLabel: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
    `style="background-color:${AMBER_BG};border:1px solid ${AMBER_BORDER};border-radius:10px;margin:16px 0 0">` +
    `<tr><td style="padding:14px 16px;font-size:14px;color:${AMBER_TEXT};line-height:1.5">` +
    `This offer is held for you until <strong>${escapeHtml(expiresAtLabel)}</strong>. ` +
    `Please book online before then to secure the slot.` +
    `</td></tr></table>`
  );
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
    `<p style="margin:0 0 12px 0">Good news — an appointment slot has opened at <strong>${escapeHtml(input.venueName)}</strong> on <strong>${escapeHtml(dateLabel)}</strong> ${escapeHtml(whenLine)}.</p>`;

  if (input.venuePhone?.trim()) {
    mainContent +=
      `<p style="margin:0 0 12px 0">If you need help, call us on <strong>${escapeHtml(input.venuePhone.trim())}</strong>.</p>`;
  }

  const html = renderTransactionalEmailHtml({
    venueName: input.venueName,
    venueLogoUrl: input.venueLogoUrl,
    heading: 'An appointment is available',
    mainContent,
    bookingDate: dateLabel,
    bookingTime: isAllDay ? undefined : input.timeWindowLabel,
    venueAddress: input.venueAddress,
    emailVariant: 'appointment',
    depositInfoHtml: buildExpiryCallout(input.expiresAtLabel),
    ctaLabel: input.bookingPageUrl ? 'Book appointment' : undefined,
    ctaUrl: input.bookingPageUrl,
    footerNote: `You received this email because you joined the waitlist at ${input.venueName}.`,
  });

  const textParts = [
    `Hi ${input.guestName},`,
    '',
    `Good news — an appointment slot has opened at ${input.venueName} on ${dateLabel} ${whenLine}.`,
    '',
    `Please book before ${input.expiresAtLabel} to secure this slot.`,
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
    subject: `Appointment available at ${input.venueName}`,
    html,
    text: textParts.join('\n'),
  };
}
