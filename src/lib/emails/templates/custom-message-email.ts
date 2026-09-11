/**
 * Staff-authored custom message email (booking panel "SMS / email guest",
 * contact detail panel, and the contacts bulk "Message" action).
 *
 * This is deliberately NOT the booking layout. A custom message is a plain
 * note from the venue to a person: greeting, the message as the staff member
 * typed it, and the venue's contact details. It never carries booking details,
 * even when the message was started from a booking.
 *
 * Layout:
 *  1. Card: brand-coloured top rule, round logo, venue name, "Hi {name}," and
 *     the message with paragraphs and line breaks preserved.
 *  2. Contact strip inside the same card: address, phone (tap to call), website.
 *  3. Footer: why you received this, powered by ResNeo.
 */

import { emailAccent } from '../email-accent';
import { buildGoogleMapsDirectionsUrl, normalizeWebsiteUrlForLink } from '../external-links';
import { escapeHtml } from './base-template';

const PAGE_BG = '#f0f2f5';
const CARD_BG = '#ffffff';
const CARD_BORDER = '#e2e8f0';
const TEXT_DARK = '#0f172a';
const TEXT_BODY = '#334155';
const TEXT_MUTED = '#64748b';
const TEXT_FAINT = '#94a3b8';
const RULE = '#f1f5f9';
const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif`;

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.resneo.com';
}

/**
 * Turns the raw textarea value into safe HTML paragraphs.
 * A blank line starts a new paragraph; a single newline becomes a line break.
 * Everything is escaped, so the message can never inject markup.
 */
export function formatMessageParagraphsHtml(message: string, colour = TEXT_BODY): string {
  const normalised = message.replace(/\r\n?/g, '\n').trim();
  if (!normalised) return '';
  return normalised
    .split(/\n\s*\n+/)
    .map((para) => para.trim())
    .filter((para) => para.length > 0)
    .map(
      (para) =>
        `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.7;color:${colour}">` +
        para.split('\n').map((line) => escapeHtml(line.trimEnd())).join('<br/>') +
        `</p>`,
    )
    .join('');
}

/** Plain-text twin of {@link formatMessageParagraphsHtml}: normalised newlines, trimmed. */
export function formatMessagePlainText(message: string): string {
  return message.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export interface CustomMessageEmailOptions {
  venueName: string;
  venueLogoUrl?: string | null;
  /** Venue brand colour when the venue has chosen to use it in emails; else ResNeo navy. */
  brandColour?: string | null;
  /** First name only; the template says "Hi there," when unknown. */
  guestFirstName: string;
  message: string;
  venueAddress?: string | null;
  venuePhone?: string | null;
  venueWebsiteUrl?: string | null;
  /** Public booking page, shown as a second link when set. */
  bookingPageUrl?: string | null;
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

function contactRow(label: string, valueHtml: string): string {
  return (
    `<tr>` +
    `<td style="padding:6px 14px 6px 0;vertical-align:top;white-space:nowrap">` +
    `<p style="margin:0;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${TEXT_MUTED};line-height:1.8">${label}</p>` +
    `</td>` +
    `<td style="padding:6px 0;vertical-align:top">` +
    `<p style="margin:0;font-family:${FONT};font-size:14px;color:${TEXT_BODY};line-height:1.8">${valueHtml}</p>` +
    `</td>` +
    `</tr>`
  );
}

export function renderCustomMessageEmailHtml(opts: CustomMessageEmailOptions): string {
  const accent = emailAccent(opts.brandColour);
  const logoUrl = opts.venueLogoUrl?.trim() || null;
  const website = normalizeWebsiteUrlForLink(opts.venueWebsiteUrl);
  const bookingPage = normalizeWebsiteUrlForLink(opts.bookingPageUrl);
  const address = opts.venueAddress?.trim() || null;
  const phone = opts.venuePhone?.trim() || null;
  const name = escapeHtml(opts.venueName);

  const logoSection = logoUrl
    ? `<div style="text-align:center;margin:0 0 16px">` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto">` +
      `<tr><td style="padding:4px;background:#ffffff;border:1px solid ${CARD_BORDER};border-radius:50%">` +
      `<img src="${escapeHtml(logoUrl)}" alt="" width="72" height="72" ` +
      `style="width:72px;height:72px;display:block;border-radius:50%;object-fit:cover;background:#ffffff"/>` +
      `</td></tr></table></div>`
    : '';

  const header =
    logoSection +
    `<p style="margin:0;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${TEXT_MUTED};text-align:center">${name}</p>`;

  const greeting =
    `<p style="margin:0 0 16px;font-family:${FONT};font-size:20px;font-weight:700;letter-spacing:-0.01em;color:${TEXT_DARK};line-height:1.35">Hi ${escapeHtml(opts.guestFirstName)},</p>`;

  const body = formatMessageParagraphsHtml(opts.message);

  const contactRows = [
    address
      ? contactRow(
          'Address',
          `<a href="${escapeHtml(buildGoogleMapsDirectionsUrl(address) ?? '')}" target="_blank" rel="noopener noreferrer" style="color:${accent};font-weight:600;text-decoration:none">${escapeHtml(address).replace(/\n/g, '<br/>')}</a>`,
        )
      : '',
    phone
      ? contactRow(
          'Phone',
          `<a href="${escapeHtml(telHref(phone))}" style="color:${accent};font-weight:600;text-decoration:none">${escapeHtml(phone)}</a>`,
        )
      : '',
    website
      ? contactRow(
          'Website',
          `<a href="${escapeHtml(website)}" target="_blank" style="color:${accent};font-weight:600;text-decoration:none">${escapeHtml(website.replace(/^https?:\/\//i, '').replace(/\/$/, ''))}</a>`,
        )
      : '',
    bookingPage
      ? contactRow(
          'Book online',
          `<a href="${escapeHtml(bookingPage)}" target="_blank" style="color:${accent};font-weight:600;text-decoration:none">Book with ${name}</a>`,
        )
      : '',
  ].join('');

  const contactStrip = contactRows
    ? `<div style="margin:8px 0 0;padding:20px 22px;background:#f8fafc;border:1px solid ${CARD_BORDER};border-radius:12px">` +
      `<p style="margin:0 0 8px;font-family:${FONT};font-size:15px;font-weight:700;color:${TEXT_DARK}">${name}</p>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${contactRows}</table>` +
      `</div>`
    : `<p style="margin:8px 0 0;font-family:${FONT};font-size:14px;font-weight:700;color:${TEXT_DARK}">${name}</p>`;

  const divider = `<div style="margin:24px 0;height:1px;background:${RULE}"></div>`;

  const card =
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
    `style="margin:0;background:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:16px;overflow:hidden">` +
    `<tr><td style="height:6px;background:${accent};font-size:0;line-height:0">&nbsp;</td></tr>` +
    `<tr><td style="padding:28px 32px 32px;font-family:${FONT}">` +
    header +
    divider +
    greeting +
    body +
    divider +
    contactStrip +
    `</td></tr></table>`;

  const footerText = `You received this email because you have contacted or booked with ${name}.`;

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    `<title>A message from ${name}</title>`,
    '</head>',
    `<body style="margin:0;padding:0;background:${PAGE_BG};-webkit-font-smoothing:antialiased">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${PAGE_BG}">`,
    `<tr><td align="center" style="padding:36px 16px 28px">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%">`,
    `<tr><td>${card}</td></tr>`,
    `<tr><td style="padding:20px 12px 36px;text-align:center">`,
    `<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;color:${TEXT_FAINT};line-height:1.6">${footerText}</p>`,
    `<p style="margin:0;font-family:${FONT};font-size:12px;color:${TEXT_FAINT};line-height:1.6">Powered by ` +
      `<a href="${escapeHtml(baseUrl())}" target="_blank" style="color:#003B6F;font-weight:600;text-decoration:none">ResNeo</a></p>`,
    `</td></tr>`,
    `</table>`,
    `</td></tr>`,
    `</table>`,
    `</body></html>`,
  ].join('\n');
}

/** Plain-text alternative: greeting, message, then the venue's contact details. */
export function renderCustomMessageEmailText(opts: CustomMessageEmailOptions): string {
  const website = normalizeWebsiteUrlForLink(opts.venueWebsiteUrl);
  const bookingPage = normalizeWebsiteUrlForLink(opts.bookingPageUrl);
  const lines: Array<string | null> = [
    `Hi ${opts.guestFirstName},`,
    '',
    formatMessagePlainText(opts.message),
    '',
    opts.venueName,
    opts.venueAddress?.trim() || null,
    opts.venuePhone?.trim() || null,
    website,
    bookingPage ? `Book online: ${bookingPage}` : null,
  ];
  return lines.filter((l): l is string => l !== null).join('\n');
}
