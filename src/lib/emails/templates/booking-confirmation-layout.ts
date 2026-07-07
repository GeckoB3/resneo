/**
 * Booking confirmation email — premium card-based layout.
 *
 * Layout:
 *  1. Hero card — greeting · "confirmed" highlight · venue thumbnail · circular action buttons
 *  2. Details card — receipt-style line items (appointments) or label rows (tables) ·
 *                    deposit callout · custom message · booking ref · account link
 *  3. Location card — venue name · address · directions link  (when address set)
 *  4. Cancellation policy card — free-text policy  (when provided)
 *  5. Pre-appointment instructions card — before-visit notes  (when provided, appt only)
 */

import type { BookingEmailData, BookingTicketPriceLine, GroupAppointmentLine, VenueEmailData } from '@/lib/emails/types';
import {
  confirmationPaymentPolicyText,
  formatMoneyOrNull,
} from '@/lib/communications/booking-confirmation-pricing';
import { buildGoogleCalendarAddUrlForBooking } from '@/lib/emails/calendar-links';
import { normalizeWebsiteUrlForLink } from '@/lib/emails/external-links';
import { resolveEmailLocation } from '@/lib/emails/booking-location';
import { escapeHtml, escapeHtmlMultiline, formatDate, formatTime } from './base-template';

// ─── Design tokens ────────────────────────────────────────────────────────────

const ACCENT = '#003B6F';
const PAGE_BG = '#f0f2f5';
const CARD_BG = '#ffffff';
const CARD_BORDER = '#e2e8f0';
const TEXT_DARK = '#0f172a';
const TEXT_BODY = '#334155';
const TEXT_MUTED = '#64748b';
const TEXT_FAINT = '#94a3b8';
const RULE = '#f1f5f9';
const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.resneo.com';
}

/** Extracts and returns first name; falls back to "there" for generic greeting. */
export function guestFirstName(name: string | null | undefined): string {
  const t = (name ?? '').trim();
  if (!t || t.toLowerCase() === 'guest') return 'there';
  return t.split(/\s+/)[0] ?? 'there';
}

function bookingRef(id: string): string {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase();
}

function heroPhrase(booking: BookingEmailData, isAppt: boolean): { before: string; highlight: string } {
  const m = booking.booking_model;
  if (m === 'event_ticket') return { before: 'Your event is', highlight: 'confirmed' };
  if (m === 'class_session') return { before: 'Your class is', highlight: 'confirmed' };
  if (m === 'resource_booking') return { before: 'Your booking is', highlight: 'confirmed' };
  if (isAppt || booking.email_variant === 'appointment') return { before: 'Your booking is', highlight: 'confirmed' };
  return { before: 'Your booking is', highlight: 'confirmed' };
}

function dateTimeLine(booking: BookingEmailData): string {
  return `${formatDate(booking.booking_date)} at ${formatTime(booking.booking_time)}`;
}

// ─── Card wrapper ─────────────────────────────────────────────────────────────

function card(inner: string, paddingV = '32px', opts?: { bg?: string; border?: string }): string {
  const bg = opts?.bg ?? CARD_BG;
  const border = opts?.border ?? CARD_BORDER;
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
    `style="margin:0 0 16px;background:${bg};border:1px solid ${border};border-radius:16px;overflow:hidden">` +
    `<tr><td style="padding:${paddingV} 32px;font-family:${FONT}">` +
    inner +
    `</td></tr></table>`
  );
}

/** Centred date/time chip shown under the hero heading. */
function dateTimeChip(text: string): string {
  return (
    `<p style="margin:14px 0 0;text-align:center">` +
    `<span style="display:inline-block;padding:7px 16px;background:#f1f5f9;border-radius:9999px;` +
    `font-family:${FONT};font-size:13px;font-weight:600;color:${TEXT_BODY};line-height:1.4">${text}</span>` +
    `</p>`
  );
}

/**
 * Long or multi-line price/payment text reads badly as a right-aligned bold
 * cell; render those values as a stacked full-width block instead.
 */
function isLongPriceValue(value: string): boolean {
  return value.includes('\n') || value.length > 36;
}

// ─── Account portal callout (rendered as the final card, above the footer) ────

const ACCOUNT_CALLOUT_BG = '#eef4fa';
const ACCOUNT_CALLOUT_BORDER = '#d6e3ef';

/** Wraps the provided account-link HTML in a centred, brand-tinted end-of-email callout. */
function buildAccountCalloutInner(linkHtml: string): string {
  return (
    `<p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${ACCENT};font-family:${FONT};text-align:center">Your ResNeo account</p>` +
    `<div style="text-align:center;font-size:14px;color:${TEXT_BODY};line-height:1.6;font-family:${FONT}">${linkHtml}</div>`
  );
}

// ─── Action pill links (text-only; SVGs are stripped by Gmail/Outlook) ────────

function buildActionButtons(opts: {
  calendarUrl: string | null;
  mapsUrl: string | null;
  venueUrl: string | null;
  manageUrl: string | null;
  manageLabel?: string;
  /** Online services: join link shown instead of the maps Location button. */
  joinOnlineUrl?: string | null;
}): string {
  const buttons: Array<{ href: string; label: string }> = [];
  if (opts.calendarUrl) buttons.push({ href: opts.calendarUrl, label: 'Add to calendar' });
  if (opts.joinOnlineUrl) buttons.push({ href: opts.joinOnlineUrl, label: 'Join online' });
  if (opts.mapsUrl)     buttons.push({ href: opts.mapsUrl,     label: 'Location' });
  if (opts.venueUrl)    buttons.push({ href: opts.venueUrl,    label: 'Visit website' });
  if (opts.manageUrl)   buttons.push({ href: opts.manageUrl,   label: opts.manageLabel ?? 'Manage' });
  if (buttons.length === 0) return '';

  // Inline-block pills inside a centred block so they wrap onto extra lines on
  // narrow screens instead of overflowing a fixed table row.
  const pills = buttons.map(
    (b) =>
      `<a href="${escapeHtml(b.href)}" target="_blank" rel="noopener noreferrer" ` +
      `style="display:inline-block;margin:4px 3px;padding:10px 18px;border:1px solid ${CARD_BORDER};border-radius:9999px;` +
      `font-family:${FONT};font-size:13px;font-weight:600;color:${ACCENT};line-height:1.4;` +
      `text-decoration:none;background:#f8fafc;white-space:nowrap">${escapeHtml(b.label)}</a>`,
  );

  return `<div style="margin:24px 0 0;text-align:center">${pills.join('')}</div>`;
}

// ─── Appointment line-item detail rows ────────────────────────────────────────

function buildEventTicketDetailRows(
  booking: BookingEmailData,
  tickets: BookingTicketPriceLine[],
  paymentDisplay: string | null,
): string {
  const eventName = booking.appointment_service_name?.trim() || 'Event';
  let computedTotal = 0;
  let ticketCount = 0;

  const itemRows = tickets.map((t) => {
    const subtotal = t.quantity * t.unit_price_pence;
    computedTotal += subtotal;
    ticketCount += t.quantity;
    const unitFmt = formatMoneyOrNull(t.unit_price_pence);
    const subFmt = formatMoneyOrNull(subtotal);
    const label = (t.label?.trim() || 'Ticket').replace(/:\s*$/, '');
    const qtyLine =
      t.quantity === 1
        ? `1 ticket at ${unitFmt ?? '—'}`
        : `${t.quantity} tickets at ${unitFmt ?? '—'} each`;

    const priceCell = subFmt
      ? `<td style="padding:14px 0;border-bottom:1px solid ${RULE};text-align:right;vertical-align:top;white-space:nowrap">` +
        `<p style="margin:0;font-size:15px;font-weight:600;color:${TEXT_DARK}">${escapeHtml(subFmt)}</p>` +
        `</td>`
      : `<td></td>`;

    return (
      `<tr>` +
      `<td style="padding:14px 12px 14px 0;border-bottom:1px solid ${RULE};vertical-align:top">` +
      `<p style="margin:0;font-size:15px;font-weight:600;color:${TEXT_DARK};line-height:1.4">${escapeHtml(label)}</p>` +
      `<p style="margin:4px 0 0;font-size:13px;color:${TEXT_MUTED};line-height:1.5">${escapeHtml(qtyLine)}</p>` +
      `</td>` +
      priceCell +
      `</tr>`
    );
  });

  const totalFmt = formatMoneyOrNull(
    booking.booking_total_price_pence != null && booking.booking_total_price_pence > 0
      ? booking.booking_total_price_pence
      : computedTotal,
  );

  const totalRow = totalFmt
    ? `<tr>` +
      `<td style="padding:16px 12px 2px 0;vertical-align:top">` +
      `<p style="margin:0;font-size:16px;font-weight:700;color:${TEXT_DARK}">Total cost</p>` +
      `<p style="margin:4px 0 0;font-size:13px;color:${TEXT_MUTED};line-height:1.5">` +
      `${escapeHtml(`${ticketCount} ${ticketCount === 1 ? 'ticket' : 'tickets'} purchased`)}` +
      `</p>` +
      `</td>` +
      `<td style="padding:16px 0 2px;text-align:right;vertical-align:top;white-space:nowrap">` +
      `<p style="margin:0;font-size:16px;font-weight:700;color:${TEXT_DARK}">${escapeHtml(totalFmt)}</p>` +
      `</td>` +
      `</tr>`
    : '';

  const paymentRow = paymentDisplay?.trim()
    ? `<tr>` +
      `<td colspan="2" style="padding:16px 0 0;vertical-align:top;border-top:1px solid ${RULE}">` +
      `<p style="margin:0 0 6px;font-size:11px;font-weight:700;color:${TEXT_MUTED};text-transform:uppercase;letter-spacing:0.06em">Payment</p>` +
      `<p style="margin:0;font-size:14px;color:${TEXT_BODY};line-height:1.6;font-family:${FONT}">${escapeHtmlMultiline(paymentDisplay.trim())}</p>` +
      `</td>` +
      `</tr>`
    : '';

  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0 0">` +
    `<tbody>` +
    `<tr>` +
    `<td colspan="2" style="padding:0 0 12px;vertical-align:top">` +
    `<p style="margin:0;font-size:15px;font-weight:600;color:${TEXT_DARK};line-height:1.4">${escapeHtml(eventName)}</p>` +
    `</td>` +
    `</tr>` +
    itemRows.join('') +
    totalRow +
    paymentRow +
    `</tbody>` +
    `</table>`
  );
}

function buildAppointmentDetailRows(booking: BookingEmailData, priceDisplay: string | null): string {
  if (booking.booking_model === 'event_ticket' && booking.booking_ticket_price_lines?.length) {
    return buildEventTicketDetailRows(
      booking,
      booking.booking_ticket_price_lines,
      confirmationPaymentPolicyText(booking),
    );
  }

  // Group: multiple services / people
  if (booking.group_appointments && booking.group_appointments.length > 0) {
    const itemRows = booking.group_appointments.map((g) => {
      const hasLabel = g.person_label?.trim();
      const hasPrac = g.practitioner_name?.trim();
      const subParts: string[] = [];
      if (hasLabel) subParts.push(g.person_label.trim());
      if (hasPrac) subParts.push(`with ${g.practitioner_name.trim()}`);
      const sub = subParts.length > 0
        ? `<p style="margin:4px 0 0;font-size:13px;color:${TEXT_MUTED}">${escapeHtml(subParts.join(' · '))}</p>`
        : '';

      // Per-person add-on lines (price is contained in each pre-formatted string).
      const addonLinesHtml = (g.addon_lines ?? [])
        .map(
          (line) =>
            `<p style="margin:6px 0 0;font-size:13px;color:${TEXT_MUTED};line-height:1.45">+ ${escapeHtml(line)}</p>`,
        )
        .join('');

      const priceTop = g.price_display?.trim()
        ? `<p style="margin:0;font-size:15px;font-weight:600;color:${TEXT_DARK}">${escapeHtml(g.price_display.trim())}</p>`
        : '';

      // When add-ons apply, close the person block with an aligned subtotal row.
      const hasSubtotal = Boolean(g.subtotal_display?.trim());
      const firstRowBorder = hasSubtotal ? '' : `border-bottom:1px solid ${RULE};`;
      const firstRowPadBottom = hasSubtotal ? '4px' : '14px';

      const serviceRow =
        `<tr>` +
        `<td style="padding:14px 12px ${firstRowPadBottom} 0;${firstRowBorder}vertical-align:top">` +
        `<p style="margin:0;font-size:15px;font-weight:600;color:${TEXT_DARK};line-height:1.4">${escapeHtml(g.service_name)}</p>` +
        sub +
        addonLinesHtml +
        `</td>` +
        `<td style="padding:14px 0 ${firstRowPadBottom};${firstRowBorder}text-align:right;vertical-align:top;white-space:nowrap">` +
        priceTop +
        `</td>` +
        `</tr>`;

      const subtotalRow = hasSubtotal
        ? `<tr>` +
          `<td style="padding:2px 12px 14px 0;border-bottom:1px solid ${RULE};vertical-align:top">` +
          `<p style="margin:0;font-size:11px;font-weight:700;color:${TEXT_MUTED};text-transform:uppercase;letter-spacing:0.06em">Subtotal</p>` +
          `</td>` +
          `<td style="padding:2px 0 14px;border-bottom:1px solid ${RULE};text-align:right;vertical-align:top;white-space:nowrap">` +
          `<p style="margin:0;font-size:15px;font-weight:700;color:${TEXT_DARK}">${escapeHtml(g.subtotal_display!.trim())}</p>` +
          `</td>` +
          `</tr>`
        : '';

      return serviceRow + subtotalRow;
    });

    // The cell already carries a "Total" label, so drop any leading "Total:" prefix
    // from the structured price text to avoid "Total  Total: £x".
    const totalValue = priceDisplay?.trim().replace(/^Total:\s*/i, '') ?? '';
    const totalRow = totalValue
      ? isLongPriceValue(totalValue)
        ? `<tr>` +
          `<td colspan="2" style="padding:16px 0 2px;vertical-align:top">` +
          `<p style="margin:0 0 6px;font-size:11px;font-weight:700;color:${TEXT_MUTED};text-transform:uppercase;letter-spacing:0.06em">Total</p>` +
          `<p style="margin:0;font-size:14px;color:${TEXT_BODY};line-height:1.6">${escapeHtmlMultiline(totalValue)}</p>` +
          `</td>` +
          `</tr>`
        : `<tr>` +
          `<td style="padding:16px 12px 2px 0;vertical-align:top">` +
          `<p style="margin:0;font-size:16px;font-weight:700;color:${TEXT_DARK}">Total</p>` +
          `</td>` +
          `<td style="padding:16px 0 2px;text-align:right;vertical-align:top;white-space:nowrap">` +
          `<p style="margin:0;font-size:16px;font-weight:700;color:${TEXT_DARK}">${escapeHtmlMultiline(totalValue)}</p>` +
          `</td>` +
          `</tr>`
      : '';

    return (
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0 0">` +
      `<tbody>${itemRows.join('')}${totalRow}</tbody>` +
      `</table>`
    );
  }

  // Single appointment / service (model B or CDE with a service name)
  if (booking.appointment_service_name || booking.practitioner_name) {
    const svcName = booking.appointment_service_name ?? 'Appointment';
    const prac = booking.practitioner_name?.trim();
    const lineItemPrice = booking.appointment_price_display?.trim() ?? null;
    // Only show a separate total row when the structured price text adds deposit info
    const totalPrice =
      priceDisplay?.trim() && priceDisplay.trim() !== lineItemPrice
        ? priceDisplay.trim()
        : null;
    const hasPriceRow = Boolean(lineItemPrice || totalPrice);
    const addonLines = booking.addon_lines ?? [];
    const hasAddonRows = addonLines.length > 0;

    const subLine = prac
      ? `<p style="margin:4px 0 0;font-size:13px;color:${TEXT_MUTED};line-height:1.5">with ${escapeHtml(prac)}</p>`
      : '';

    const priceCell = lineItemPrice
      ? `<td style="padding:14px 0;border-bottom:${hasPriceRow && (totalPrice || hasAddonRows) ? `1px solid ${RULE}` : 'none'};text-align:right;vertical-align:top;white-space:nowrap">` +
        `<p style="margin:0;font-size:15px;font-weight:600;color:${TEXT_DARK}">${escapeHtml(lineItemPrice)}</p>` +
        `</td>`
      : `<td></td>`;

    const addonRows = hasAddonRows
      ? `<tr><td colspan="2" style="padding:14px 0 4px;border-bottom:${totalPrice ? `1px solid ${RULE}` : 'none'};vertical-align:top">` +
        `<p style="margin:0;font-size:11px;font-weight:700;color:${TEXT_MUTED};text-transform:uppercase;letter-spacing:0.06em">Extras</p>` +
        `<ul style="margin:8px 0 0;padding-left:18px;font-size:14px;color:${TEXT_DARK};line-height:1.6">` +
        addonLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('') +
        `</ul>` +
        `</td></tr>`
      : '';

    const totalRow = totalPrice
      ? isLongPriceValue(totalPrice)
        ? `<tr>` +
          `<td colspan="2" style="padding:16px 0 2px;vertical-align:top">` +
          `<p style="margin:0 0 6px;font-size:11px;font-weight:700;color:${TEXT_MUTED};text-transform:uppercase;letter-spacing:0.06em">Total</p>` +
          `<p style="margin:0;font-size:14px;color:${TEXT_BODY};line-height:1.6">${escapeHtmlMultiline(totalPrice)}</p>` +
          `</td>` +
          `</tr>`
        : `<tr>` +
          `<td style="padding:16px 12px 2px 0;vertical-align:top">` +
          `<p style="margin:0;font-size:16px;font-weight:700;color:${TEXT_DARK}">Total</p>` +
          `</td>` +
          `<td style="padding:16px 0 2px;text-align:right;vertical-align:top">` +
          `<p style="margin:0;font-size:16px;font-weight:700;color:${TEXT_DARK}">${escapeHtmlMultiline(totalPrice)}</p>` +
          `</td>` +
          `</tr>`
      : '';

    return (
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0 0">` +
      `<tbody>` +
      `<tr>` +
      `<td style="padding:14px 12px 14px 0;border-bottom:${totalPrice || hasAddonRows ? `1px solid ${RULE}` : 'none'};vertical-align:top">` +
      `<p style="margin:0;font-size:15px;font-weight:600;color:${TEXT_DARK};line-height:1.4">${escapeHtml(svcName)}</p>` +
      subLine +
      `</td>` +
      priceCell +
      `</tr>` +
      addonRows +
      totalRow +
      `</tbody>` +
      `</table>`
    );
  }

  return '';
}

// ─── Table reservation detail rows (label + value style) ──────────────────────

function buildTableDetailRows(booking: BookingEmailData): string {
  const items: Array<{ label: string; value: string }> = [
    { label: 'Date', value: formatDate(booking.booking_date) },
    { label: 'Time', value: formatTime(booking.booking_time) },
    { label: 'Guests', value: `${booking.party_size} guest${booking.party_size !== 1 ? 's' : ''}` },
  ];
  const notes = booking.special_requests?.trim() ?? booking.dietary_notes?.trim();
  if (notes) items.push({ label: 'Notes', value: notes });

  const rows = items.map((item, i) => {
    const isLast = i === items.length - 1;
    return (
      `<tr>` +
      `<td style="padding:14px 0;${isLast ? '' : `border-bottom:1px solid ${RULE};`}vertical-align:top">` +
      `<p style="margin:0;font-size:11px;font-weight:700;color:${TEXT_MUTED};text-transform:uppercase;letter-spacing:0.06em;line-height:1.3">${escapeHtml(item.label)}</p>` +
      `<p style="margin:6px 0 0;font-size:15px;font-weight:500;color:${TEXT_DARK};line-height:1.5">${escapeHtml(item.value)}</p>` +
      `</td>` +
      `</tr>`
    );
  });

  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0 0">` +
    `<tbody>${rows.join('')}</tbody>` +
    `</table>`
  );
}

// ─── Location card inner HTML ─────────────────────────────────────────────────

function buildLocationInner(opts: {
  venueName: string;
  address: string;
  mapsUrl: string | null;
}): string {
  const directionsLink = opts.mapsUrl
    ? `<p style="margin:16px 0 0">` +
      `<a href="${escapeHtml(opts.mapsUrl)}" target="_blank" rel="noopener noreferrer" ` +
      `style="display:inline-block;padding:9px 18px;border:1px solid ${CARD_BORDER};border-radius:9999px;` +
      `font-family:${FONT};font-size:13px;font-weight:600;color:${ACCENT};text-decoration:none;background:#f8fafc">` +
      `Get directions &#8594;</a></p>`
    : '';

  return (
    `<p style="margin:0 0 14px;font-size:17px;font-weight:700;color:${TEXT_DARK};letter-spacing:-0.01em;font-family:${FONT}">Location</p>` +
    `<p style="margin:0 0 5px;font-size:15px;font-weight:600;color:${TEXT_BODY};font-family:${FONT}">${escapeHtml(opts.venueName)}</p>` +
    `<p style="margin:0;font-size:14px;color:${TEXT_MUTED};line-height:1.6;font-family:${FONT}">${escapeHtml(opts.address)}</p>` +
    directionsLink
  );
}

/** Online services: "Location — Online" card with join button and joining info. */
function buildOnlineLocationInner(opts: { joinUrl: string | null; info: string | null }): string {
  const joinButton = opts.joinUrl
    ? `<p style="margin:14px 0 0">` +
      `<a href="${escapeHtml(opts.joinUrl)}" target="_blank" rel="noopener noreferrer" ` +
      `style="display:inline-block;padding:8px 18px;border-radius:9999px;` +
      `font-family:${FONT};font-size:13px;font-weight:600;color:#ffffff;text-decoration:none;background:${ACCENT}">` +
      `Join online &#8594;</a></p>` +
      `<p style="margin:8px 0 0;font-size:12px;color:${TEXT_MUTED};word-break:break-all;font-family:${FONT}">${escapeHtml(opts.joinUrl)}</p>`
    : '';

  const infoBlock = opts.info
    ? `<p style="margin:12px 0 0;font-size:14px;color:${TEXT_BODY};line-height:1.55;font-family:${FONT}">${escapeHtmlMultiline(opts.info)}</p>`
    : '';

  return (
    `<p style="margin:0 0 14px;font-size:17px;font-weight:700;color:${TEXT_DARK};letter-spacing:-0.01em;font-family:${FONT}">Location</p>` +
    `<p style="margin:0;font-size:15px;font-weight:600;color:${TEXT_BODY};font-family:${FONT}">Online</p>` +
    `<p style="margin:5px 0 0;font-size:14px;color:${TEXT_MUTED};line-height:1.6;font-family:${FONT}">This service is delivered online — no need to travel.</p>` +
    infoBlock +
    joinButton
  );
}

/** Client-address services: the visit happens at the client's own address. */
function buildClientAddressLocationInner(opts: { address: string | null }): string {
  return (
    `<p style="margin:0 0 14px;font-size:17px;font-weight:700;color:${TEXT_DARK};letter-spacing:-0.01em;font-family:${FONT}">Location</p>` +
    `<p style="margin:0;font-size:15px;font-weight:600;color:${TEXT_BODY};font-family:${FONT}">Your address</p>` +
    (opts.address
      ? `<p style="margin:5px 0 0;font-size:14px;color:${TEXT_MUTED};line-height:1.6;font-family:${FONT}">${escapeHtml(opts.address)}</p>`
      : '') +
    `<p style="margin:12px 0 0;font-size:13px;color:${TEXT_MUTED};line-height:1.6;font-family:${FONT}">We come to you for this appointment.</p>`
  );
}

// ─── Policy / instructions card inner HTML ────────────────────────────────────

function buildInfoCardInner(heading: string, body: string, accentBg = '#f8fafc', accentBorder = CARD_BORDER): string {
  return (
    `<p style="margin:0 0 12px;font-size:17px;font-weight:700;color:${TEXT_DARK};letter-spacing:-0.01em;font-family:${FONT}">${escapeHtml(heading)}</p>` +
    `<div style="padding:16px 18px;background:${accentBg};border-radius:12px;border:1px solid ${accentBorder}">` +
    `<p style="margin:0;font-size:14px;color:${TEXT_BODY};line-height:1.65;font-family:${FONT}">${escapeHtml(body)}</p>` +
    `</div>`
  );
}

// ─── Public interface ─────────────────────────────────────────────────────────

export interface BookingConfirmationLayoutBlocks {
  preambleHtml: string;
  depositHtml: string | null;
  customMessage: string | null;
  postCtaAccountHtml: string | null;
  /** Cancellation policy text — rendered as a standalone card. */
  cancellationPolicy?: string | null;
  /** Pre-appointment instructions — rendered in a tinted card above the details. */
  preAppointmentInstructions?: string | null;
}

export function renderBookingConfirmationDocumentHtml(input: {
  booking: BookingEmailData;
  venue: VenueEmailData;
  appointmentStyle: boolean;
  blocks: BookingConfirmationLayoutBlocks;
  emailVariant: 'table' | 'appointment';
  priceDisplay?: string | null;
  manageButtonLabel?: string;
}): string {
  const { booking, venue, appointmentStyle, blocks, priceDisplay, manageButtonLabel } = input;

  const calendarUrl = buildGoogleCalendarAddUrlForBooking(booking, venue);
  const resolvedLocation = resolveEmailLocation(booking, venue);
  const mapsUrl = resolvedLocation.mapsUrl;
  const venueWebUrl = normalizeWebsiteUrlForLink(venue.website_url ?? undefined);
  const manageUrl = booking.manage_booking_link?.trim() || null;
  const thumbUrl = venue.logo_url?.trim() || null;

  const firstName = guestFirstName(booking.guest_name);
  const { before, highlight } = heroPhrase(booking, appointmentStyle);

  // ── Hero card ──────────────────────────────────────────────────────────────

  const heroInner =
    `<p style="margin:0 0 10px;font-size:15px;color:${TEXT_MUTED};font-family:${FONT}">Hi ${escapeHtml(firstName)},</p>` +
    // Title: "Your appointment is" + line break + "confirmed" in accent
    `<p style="margin:0;font-family:${FONT};font-size:28px;line-height:1.15;font-weight:800;letter-spacing:-0.02em;color:${TEXT_DARK}">` +
    `${escapeHtml(before)}<br/><span style="color:${ACCENT}">${escapeHtml(highlight)}</span>` +
    `</p>` +
    // Venue thumbnail
    (thumbUrl
      ? `<div style="margin:24px 0 16px;text-align:center">` +
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto">` +
        `<tr><td style="padding:4px;background:#ffffff;border:1px solid ${CARD_BORDER};border-radius:50%">` +
        `<img src="${escapeHtml(thumbUrl)}" alt="" width="80" height="80" ` +
        `style="width:80px;height:80px;display:block;border-radius:50%;object-fit:cover;background:#ffffff"/>` +
        `</td></tr>` +
        `</table>` +
        `</div>`
      : `<div style="margin:22px 0 0"></div>`) +
    // Venue name + date/time chip
    `<p style="margin:0;font-size:17px;font-weight:700;color:${TEXT_DARK};text-align:center;letter-spacing:-0.01em;font-family:${FONT}">${escapeHtml(venue.name)}</p>` +
    dateTimeChip(escapeHtml(dateTimeLine(booking))) +
    // Action buttons
    buildActionButtons({
      calendarUrl,
      mapsUrl,
      venueUrl: venueWebUrl,
      manageUrl,
      manageLabel: manageButtonLabel,
      joinOnlineUrl: resolvedLocation.joinUrl,
    });

  // ── Details card ───────────────────────────────────────────────────────────

  const confirmedPill =
    `<span style="display:inline-block;padding:6px 14px 6px 11px;border-radius:9999px;` +
    `background:${ACCENT};color:#fff;font-size:12px;font-weight:700;font-family:${FONT};letter-spacing:0.02em">&#10003; Confirmed</span>`;

  const detailsHeading =
    booking.booking_model === 'event_ticket'
      ? 'Event details'
      : 'Booking details';

  const preambleSection = blocks.preambleHtml?.trim()
    ? `<div style="margin:16px 0 0;font-size:14px;color:${TEXT_BODY};line-height:1.6;font-family:${FONT}">${blocks.preambleHtml}</div>`
    : '';

  const preInstructions = blocks.preAppointmentInstructions?.trim()
    ? `<div style="margin:20px 0 0;padding:16px 18px;background:#eef2f3;border-radius:12px;border:1px solid #c5d3d7">` +
      `<p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#2e4f59;font-family:${FONT};text-transform:uppercase;letter-spacing:0.06em">Before your appointment</p>` +
      `<p style="margin:0;font-size:14px;color:#3d5f6a;line-height:1.6;font-family:${FONT}">${escapeHtml(blocks.preAppointmentInstructions.trim())}</p>` +
      `</div>`
    : '';

  const detailRows = appointmentStyle
    ? buildAppointmentDetailRows(booking, priceDisplay ?? null)
    : buildTableDetailRows(booking);

  const depositSection = blocks.depositHtml ?? '';

  const customMessageSection = blocks.customMessage?.trim()
    ? `<div style="margin:20px 0 0;padding:16px 18px;background:#f8fafc;border-radius:12px;border:1px solid ${CARD_BORDER};font-size:14px;color:${TEXT_BODY};line-height:1.65;font-family:${FONT}">${escapeHtml(blocks.customMessage.trim())}</div>`
    : '';

  const bookingRefLine =
    `<p style="margin:24px 0 0;font-size:12px;color:${TEXT_FAINT};font-family:${FONT}">Booking ref: ${escapeHtml(bookingRef(booking.id))}</p>`;

  const detailsInner =
    confirmedPill +
    `<p style="margin:16px 0 0;font-size:19px;font-weight:700;color:${TEXT_DARK};letter-spacing:-0.01em;font-family:${FONT}">${escapeHtml(detailsHeading)}</p>` +
    preambleSection +
    preInstructions +
    detailRows +
    depositSection +
    customMessageSection +
    bookingRefLine;

  // ── Location card ──────────────────────────────────────────────────────────

  let locationCardHtml = '';
  if (resolvedLocation.kind === 'online') {
    locationCardHtml = card(
      buildOnlineLocationInner({
        joinUrl: resolvedLocation.joinUrl,
        info: booking.booking_location?.online_info?.trim() || null,
      }),
    );
  } else if (resolvedLocation.kind === 'client_address') {
    locationCardHtml = card(
      buildClientAddressLocationInner({
        address: booking.booking_location?.client_address?.trim() || null,
      }),
    );
  } else if (venue.address?.trim()) {
    locationCardHtml = card(
      buildLocationInner({
        venueName: venue.name,
        address: venue.address.trim(),
        mapsUrl,
      }),
    );
  }

  // ── Cancellation policy card ───────────────────────────────────────────────

  const policyCardHtml = blocks.cancellationPolicy?.trim()
    ? card(buildInfoCardInner('Cancellation policy', blocks.cancellationPolicy.trim()))
    : '';

  // ── Account portal callout (final card, just above the footer) ─────────────

  const accountCardHtml = blocks.postCtaAccountHtml?.trim()
    ? card(buildAccountCalloutInner(blocks.postCtaAccountHtml), '22px', {
        bg: ACCOUNT_CALLOUT_BG,
        border: ACCOUNT_CALLOUT_BORDER,
      })
    : '';

  // ── Assemble page ──────────────────────────────────────────────────────────

  const base = baseUrl();
  const footerText = `You received this email because you made a booking with ${escapeHtml(venue.name)} via ResNeo.`;

  const cardRows = [
    `<tr><td style="padding-bottom:0">${card(heroInner)}</td></tr>`,
    `<tr><td style="padding-bottom:0">${card(detailsInner)}</td></tr>`,
    ...(locationCardHtml ? [`<tr><td style="padding-bottom:0">${locationCardHtml}</td></tr>`] : []),
    ...(policyCardHtml   ? [`<tr><td style="padding-bottom:0">${policyCardHtml}</td></tr>`]   : []),
    ...(accountCardHtml  ? [`<tr><td style="padding-bottom:0">${accountCardHtml}</td></tr>`]  : []),
  ].join('\n');

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    '</head>',
    `<body style="margin:0;padding:0;background:${PAGE_BG};-webkit-font-smoothing:antialiased">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${PAGE_BG}">`,
    `<tr><td align="center" style="padding:36px 16px 28px">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%">`,
    // Cards
    cardRows,
    // Footer
    `<tr><td style="padding:20px 12px 36px;text-align:center">`,
    `<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;color:${TEXT_FAINT};line-height:1.6">${footerText}</p>`,
    `<p style="margin:0;font-family:${FONT};font-size:12px;color:${TEXT_FAINT};line-height:1.6">Powered by ` +
      `<a href="${escapeHtml(base)}" target="_blank" style="color:#003B6F;font-weight:600;text-decoration:none">ResNeo</a></p>`,
    `</td></tr>`,
    `</table>`,
    `</td></tr>`,
    `</table>`,
    `</body></html>`,
  ].join('\n');
}

// ─── Generic transactional email layout ──────────────────────────────────────
// Used by all non-confirmation guest emails (reminders, deposits, modifications,
// cancellations, etc.) — same card-based design language as the booking
// confirmation but in a single card: hero section (logo + heading) above a
// rule, then body content, detail rows, optional CTA pills.

function buildTransactionalDetailRows(opts: {
  bookingDate?: string;
  bookingTime?: string;
  partySize?: number;
  emailVariant?: 'table' | 'appointment';
  serviceName?: string | null;
  practitionerName?: string | null;
  priceDisplay?: string | null;
  groupAppointments?: GroupAppointmentLine[];
  addonLines?: string[] | null;
  venueAddress?: string | null;
  /** Online services: join link rendered under the Location value. */
  locationJoinUrl?: string | null;
  /** Online services: joining info rendered under the Location value. */
  locationExtra?: string | null;
  specialRequests?: string | null;
}): string {
  const isAppt = opts.emailVariant === 'appointment';

  // Group appointments: one labelled row per person
  if (opts.groupAppointments && opts.groupAppointments.length > 0) {
    const itemRows = opts.groupAppointments.map((g, idx) => {
      const isLast = idx === opts.groupAppointments!.length - 1 && !opts.priceDisplay;
      return (
        `<tr>` +
        `<td style="padding:14px 0;${isLast ? '' : `border-bottom:1px solid ${RULE};`}vertical-align:top">` +
        `<p style="margin:0;font-size:15px;font-weight:600;color:${TEXT_DARK};line-height:1.4;font-family:${FONT}">${escapeHtml(g.person_label)}</p>` +
        `<p style="margin:4px 0 0;font-size:13px;color:${TEXT_MUTED};line-height:1.5;font-family:${FONT}">` +
        `${escapeHtml(formatDate(g.booking_date))} at ${escapeHtml(formatTime(g.booking_time))} &middot; ` +
        `${escapeHtml(g.service_name)} with ${escapeHtml(g.practitioner_name)}` +
        (g.price_display?.trim() ? ` &middot; ${escapeHtml(g.price_display.trim())}` : '') +
        `</p>` +
        `</td>` +
        `</tr>`
      );
    });

    const summaryRow = opts.priceDisplay?.trim()
      ? `<tr><td style="padding:14px 0 2px;vertical-align:top">` +
        `<p style="margin:0;font-size:11px;font-weight:700;color:${TEXT_MUTED};text-transform:uppercase;letter-spacing:0.06em;font-family:${FONT}">Total</p>` +
        `<p style="margin:6px 0 0;font-size:15px;font-weight:500;color:${TEXT_DARK};line-height:1.5;font-family:${FONT}">${escapeHtmlMultiline(opts.priceDisplay.trim())}</p>` +
        `</td></tr>`
      : '';

    return (
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
      `style="margin:28px 0 0;padding:8px 0 0;border-top:1px solid ${RULE}">` +
      `<tbody>${itemRows.join('')}${summaryRow}</tbody>` +
      `</table>`
    );
  }

  // Standard label / value rows
  const items: Array<{ label: string; value: string; multiline?: boolean; extraHtml?: string }> = [];
  if (opts.bookingDate) items.push({ label: 'Date', value: opts.bookingDate });
  if (opts.bookingTime) items.push({ label: 'Time', value: opts.bookingTime });
  if (isAppt) {
    if (opts.serviceName) items.push({ label: 'Service', value: opts.serviceName });
    if (opts.practitionerName) items.push({ label: 'With', value: opts.practitionerName });
    if (opts.priceDisplay) items.push({ label: 'Price', value: opts.priceDisplay, multiline: true });
    // Extras always follow the service they were booked against.
    if (opts.addonLines && opts.addonLines.length > 0)
      items.push({ label: 'Extras', value: opts.addonLines.join('\n'), multiline: true });
    if ((opts.partySize ?? 0) > 1) items.push({ label: 'People', value: `${opts.partySize}` });
  } else {
    if ((opts.partySize ?? 0) > 0) {
      const ps = opts.partySize!;
      items.push({ label: 'Guests', value: `${ps} guest${ps !== 1 ? 's' : ''}` });
    }
  }
  if (opts.venueAddress) {
    const locationExtraHtml =
      (opts.locationExtra?.trim()
        ? `<p style="margin:5px 0 0;font-size:13px;color:${TEXT_MUTED};line-height:1.5;font-family:${FONT}">${escapeHtmlMultiline(opts.locationExtra.trim())}</p>`
        : '') +
      (opts.locationJoinUrl?.trim()
        ? `<p style="margin:6px 0 0;font-size:13px;font-family:${FONT}">` +
          `<a href="${escapeHtml(opts.locationJoinUrl.trim())}" target="_blank" rel="noopener noreferrer" ` +
          `style="color:${ACCENT};font-weight:600;text-decoration:underline;word-break:break-all">Join online &#8594;</a></p>`
        : '');
    items.push({
      label: 'Location',
      value: opts.venueAddress,
      ...(locationExtraHtml ? { extraHtml: locationExtraHtml } : {}),
    });
  }
  if (opts.specialRequests) items.push({ label: 'Notes', value: opts.specialRequests });

  if (items.length === 0) return '';

  const rows = items.map((item, i) => {
    const isLast = i === items.length - 1;
    const valueHtml = item.multiline ? escapeHtmlMultiline(item.value) : escapeHtml(item.value);
    return (
      `<tr>` +
      `<td style="padding:14px 0;${isLast ? '' : `border-bottom:1px solid ${RULE};`}vertical-align:top">` +
      `<p style="margin:0;font-size:11px;font-weight:700;color:${TEXT_MUTED};text-transform:uppercase;letter-spacing:0.06em;line-height:1.3;font-family:${FONT}">${escapeHtml(item.label)}</p>` +
      `<p style="margin:6px 0 0;font-size:15px;font-weight:500;color:${TEXT_DARK};line-height:1.5;font-family:${FONT}">${valueHtml}</p>` +
      (item.extraHtml ?? '') +
      `</td>` +
      `</tr>`
    );
  });

  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
    `style="margin:28px 0 0;padding:8px 0 0;border-top:1px solid ${RULE}">` +
    `<tbody>${rows.join('')}</tbody>` +
    `</table>`
  );
}

function ctaPillButton(label: string, href: string, outlined = false): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto">` +
    `<tr><td align="center" style="border-radius:9999px;background:${outlined ? CARD_BG : ACCENT};${outlined ? `border:2px solid ${ACCENT};` : ''}">` +
    `<a href="${escapeHtml(href)}" target="_blank" ` +
    `style="display:inline-block;padding:${outlined ? '13px 34px' : '15px 36px'};font-family:${FONT};font-size:15px;font-weight:600;` +
    `text-decoration:none;border-radius:9999px;color:${outlined ? ACCENT : '#ffffff'}">${escapeHtml(label)}</a>` +
    `</td></tr></table>`
  );
}

export interface TransactionalEmailOptions {
  venueName: string;
  venueLogoUrl?: string | null;
  /** Main card heading — should NOT include the venue name (shown separately in hero). */
  heading: string;
  /** Pre-built HTML body paragraphs, including greeting. */
  mainContent: string;
  bookingDate?: string;
  bookingTime?: string;
  partySize?: number;
  /** Value of the "Location" detail row (venue address, client address, or "Online"). */
  venueAddress?: string | null;
  /** Online services: join link rendered under the Location row. */
  locationJoinUrl?: string | null;
  /** Online services: joining info rendered under the Location row. */
  locationExtra?: string | null;
  specialRequests?: string | null;
  emailVariant?: 'table' | 'appointment';
  practitionerName?: string | null;
  serviceName?: string | null;
  priceDisplay?: string | null;
  groupAppointments?: GroupAppointmentLine[];
  /** Add-on / extras lines, rendered as a detail row directly after the service. */
  addonLines?: string[] | null;
  depositInfoHtml?: string | null;
  customMessage?: string | null;
  ctaLabel?: string;
  ctaUrl?: string | null;
  secondaryCtaLabel?: string;
  secondaryCtaUrl?: string | null;
  postCtaHtml?: string | null;
  footerNote?: string;
}

/**
 * Card-based transactional email layout matching the booking confirmation design.
 * Single card: hero (logo · venue name · heading · date/time) + body content.
 */
export function renderTransactionalEmailHtml(opts: TransactionalEmailOptions): string {
  const base = baseUrl();
  const logoUrl = opts.venueLogoUrl?.trim() || null;

  // ── Hero section (top of card) ─────────────────────────────────────────────

  const logoSection = logoUrl
    ? `<div style="text-align:center;margin:0 0 18px">` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto">` +
      `<tr><td style="padding:4px;background:#ffffff;border:1px solid ${CARD_BORDER};border-radius:50%">` +
      `<img src="${escapeHtml(logoUrl)}" alt="" width="80" height="80" ` +
      `style="width:80px;height:80px;display:block;border-radius:50%;object-fit:cover;background:#ffffff"/>` +
      `</td></tr>` +
      `</table>` +
      `</div>`
    : '';

  const dateTimeHero =
    opts.bookingDate && opts.bookingTime
      ? dateTimeChip(`${escapeHtml(opts.bookingDate)} at ${escapeHtml(opts.bookingTime)}`)
      : opts.bookingDate
        ? dateTimeChip(escapeHtml(opts.bookingDate))
        : '';

  const heroSection =
    logoSection +
    `<p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${TEXT_MUTED};text-align:center;font-family:${FONT}">${escapeHtml(opts.venueName)}</p>` +
    `<p style="margin:0;font-size:24px;font-weight:700;letter-spacing:-0.02em;color:${TEXT_DARK};text-align:center;line-height:1.25;font-family:${FONT}">${escapeHtml(opts.heading)}</p>` +
    dateTimeHero;

  // ── Body section ───────────────────────────────────────────────────────────

  const detailRows = buildTransactionalDetailRows({
    bookingDate: opts.bookingDate,
    bookingTime: opts.bookingTime,
    partySize: opts.partySize,
    emailVariant: opts.emailVariant,
    serviceName: opts.serviceName,
    practitionerName: opts.practitionerName,
    priceDisplay: opts.priceDisplay,
    groupAppointments: opts.groupAppointments,
    addonLines: opts.addonLines,
    venueAddress: opts.venueAddress,
    locationJoinUrl: opts.locationJoinUrl,
    locationExtra: opts.locationExtra,
    specialRequests: opts.specialRequests,
  });

  const depositSection = opts.depositInfoHtml ?? '';

  const customSection = opts.customMessage?.trim()
    ? `<div style="margin:20px 0 0;padding:16px 18px;background:#f8fafc;border-radius:12px;` +
      `border:1px solid ${CARD_BORDER};font-size:14px;color:${TEXT_BODY};line-height:1.65;font-family:${FONT}">` +
      `${escapeHtml(opts.customMessage.trim())}</div>`
    : '';

  const primaryCta =
    opts.ctaLabel && opts.ctaUrl
      ? `<div style="text-align:center;margin:28px 0 0">${ctaPillButton(opts.ctaLabel, opts.ctaUrl)}</div>`
      : '';
  const secondaryCta =
    opts.secondaryCtaLabel && opts.secondaryCtaUrl
      ? `<div style="text-align:center;margin:12px 0 0">${ctaPillButton(opts.secondaryCtaLabel, opts.secondaryCtaUrl, true)}</div>`
      : '';

  const postCtaSection = opts.postCtaHtml?.trim()
    ? `<div style="margin:28px 0 0;padding:18px 20px;background:#eef4fa;border:1px solid #d6e3ef;border-radius:12px;font-size:14px;color:${TEXT_BODY};line-height:1.6;font-family:${FONT};text-align:center">${opts.postCtaHtml}</div>`
    : '';

  const bodySection =
    `<div style="font-family:${FONT};font-size:15px;color:${TEXT_BODY};line-height:1.65">` +
    opts.mainContent +
    `</div>` +
    detailRows +
    depositSection +
    customSection +
    primaryCta +
    secondaryCta +
    postCtaSection;

  // ── Assemble single card ───────────────────────────────────────────────────

  const divider = `<div style="margin:28px 0;height:1px;background:${RULE}"></div>`;
  const mainCard = card(heroSection + divider + bodySection);

  const footerText =
    opts.footerNote ??
    `You received this email because you have a booking at ${escapeHtml(opts.venueName)}.`;

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    '</head>',
    `<body style="margin:0;padding:0;background:${PAGE_BG};-webkit-font-smoothing:antialiased">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${PAGE_BG}">`,
    `<tr><td align="center" style="padding:36px 16px 28px">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%">`,
    `<tr><td>${mainCard}</td></tr>`,
    `<tr><td style="padding:20px 12px 36px;text-align:center">`,
    `<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;color:${TEXT_FAINT};line-height:1.6">${escapeHtml(footerText)}</p>`,
    `<p style="margin:0;font-family:${FONT};font-size:12px;color:${TEXT_FAINT};line-height:1.6">Powered by ` +
      `<a href="${escapeHtml(base)}" target="_blank" style="color:#003B6F;font-weight:600;text-decoration:none">ResNeo</a></p>`,
    `</td></tr>`,
    `</table>`,
    `</td></tr>`,
    `</table>`,
    `</body></html>`,
  ].join('\n');
}
