import type { GroupAppointmentLine } from "../types";
import {
  formatRefundDeadlineIso,
  isDepositRefundAvailableAt,
} from "@/lib/booking/cancellation-deadline";

const BRAND = "#003B6F";
const GREY_BG = "#F5F5F5";
const AMBER_BG = "#FFF3CD";
const AMBER_TEXT = "#664D03";
const FOOTER_TEXT = "#888888";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escape each line and join with `<br/>` for multi-line detail card values. */
export function escapeHtmlMultiline(text: string): string {
  return text
    .split("\n")
    .map((line) => escapeHtml(line))
    .join("<br/>");
}

interface BaseTemplateOptions {
  venueName: string;
  venueLogoUrl?: string | null;
  heading: string;
  mainContent: string;
  bookingDate?: string;
  bookingTime?: string;
  partySize?: number;
  venueAddress?: string | null;
  specialRequests?: string | null;
  depositInfoHtml?: string | null;
  customMessage?: string | null;
  ctaLabel?: string;
  ctaUrl?: string | null;
  /** Second button (e.g. Manage Booking alongside Pay deposit). */
  secondaryCtaLabel?: string;
  secondaryCtaUrl?: string | null;
  /** Extra HTML rendered after primary/secondary CTAs (e.g. account portal pitch). */
  postCtaHtml?: string | null;
  footerNote?: string;
  /** Detail card: table reservation vs appointment business */
  emailVariant?: "table" | "appointment";
  practitionerName?: string | null;
  serviceName?: string | null;
  priceDisplay?: string | null;
  groupAppointments?: GroupAppointmentLine[];
}

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL || "https://www.resneo.com";
}

/** Label + value row matching appointment card typography (table reservation emails). */
function buildTableStyleDetailRow(
  label: string,
  valueHtmlEscaped: string,
  showBorderBottom: boolean,
): string {
  const border = showBorderBottom ? "border-bottom:1px solid #e2e8f0" : "";
  return (
    `<tr><td style="padding:8px 0;${border}">` +
    `<span style="display:block;font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.04em">${escapeHtml(label)}</span>` +
    `<span style="display:block;margin-top:4px;font-size:15px;color:#0f172a;font-weight:500">${valueHtmlEscaped}</span>` +
    `</td></tr>`
  );
}

export function buildBookingDetailsCard(opts: {
  bookingDate?: string;
  bookingTime?: string;
  partySize?: number;
  venueAddress?: string | null;
  specialRequests?: string | null;
  emailVariant?: "table" | "appointment";
  practitionerName?: string | null;
  serviceName?: string | null;
  priceDisplay?: string | null;
  groupAppointments?: GroupAppointmentLine[];
}): string {
  const variant = opts.emailVariant ?? "table";
  const rows: string[] = [];

  if (opts.groupAppointments && opts.groupAppointments.length > 0) {
    const header =
      '<tr><td style="padding:0 0 8px 0;font-size:13px;font-weight:600;color:#0f172a">Details for this booking</td></tr>';
    const tableRows = opts.groupAppointments.map((g) => {
      const dt = formatDateShort(g.booking_date);
      const tm = formatTime(g.booking_time);
      const price = g.price_display ? escapeHtml(g.price_display) : "N/A";
      return (
        `<tr><td style="padding:10px 0;border-top:1px solid #e5e5e5;font-size:13px;color:#333">` +
        `<strong>${escapeHtml(g.person_label)}</strong><br/>` +
        `<span style="color:#64748b">${dt} at ${tm}</span><br/>` +
        `${escapeHtml(g.service_name)} · ${escapeHtml(g.practitioner_name)} · ${price}` +
        `</td></tr>`
      );
    });
    const summaryRow =
      opts.priceDisplay?.trim() ?
        `<tr><td style="padding:12px 0 0 0;border-top:1px solid #e5e5e5;font-size:14px;color:#0f172a;font-weight:500;line-height:1.5">${escapeHtmlMultiline(opts.priceDisplay.trim())}</td></tr>`
      : "";
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${GREY_BG};border:1px solid #E5E5E5;border-radius:8px;margin:16px 0"><tr><td style="padding:16px">${header}${tableRows.join("")}${summaryRow}</td></tr></table>`;
  }

  if (variant === "appointment") {
    if (opts.bookingDate) {
      rows.push(
        `<tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0"><span style="display:block;font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.04em">Date</span><span style="display:block;margin-top:4px;font-size:15px;color:#0f172a;font-weight:500">${escapeHtml(opts.bookingDate)}</span></td></tr>`,
      );
    }
    if (opts.bookingTime) {
      rows.push(
        `<tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0"><span style="display:block;font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.04em">Time</span><span style="display:block;margin-top:4px;font-size:15px;color:#0f172a;font-weight:500">${escapeHtml(opts.bookingTime)}</span></td></tr>`,
      );
    }
    if (opts.serviceName) {
      rows.push(
        `<tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0"><span style="display:block;font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.04em">Service</span><span style="display:block;margin-top:4px;font-size:15px;color:#0f172a;font-weight:500">${escapeHtml(opts.serviceName)}</span></td></tr>`,
      );
    }
    if (opts.practitionerName) {
      rows.push(
        `<tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0"><span style="display:block;font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.04em">With</span><span style="display:block;margin-top:4px;font-size:15px;color:#0f172a;font-weight:500">${escapeHtml(opts.practitionerName)}</span></td></tr>`,
      );
    }
    if (opts.priceDisplay) {
      rows.push(
        `<tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0"><span style="display:block;font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.04em">Price and payment</span><span style="display:block;margin-top:4px;font-size:15px;color:#0f172a;font-weight:500;line-height:1.45">${escapeHtmlMultiline(opts.priceDisplay)}</span></td></tr>`,
      );
    }
    if (opts.partySize && opts.partySize > 1) {
      rows.push(
        `<tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0"><span style="display:block;font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.04em">People</span><span style="display:block;margin-top:4px;font-size:15px;color:#0f172a;font-weight:500">${opts.partySize}</span></td></tr>`,
      );
    }
    if (opts.venueAddress) {
      rows.push(
        `<tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0"><span style="display:block;font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.04em">Location</span><span style="display:block;margin-top:4px;font-size:15px;color:#0f172a;font-weight:500">${escapeHtml(opts.venueAddress)}</span></td></tr>`,
      );
    }
    if (opts.specialRequests) {
      rows.push(
        `<tr><td style="padding:8px 0"><span style="display:block;font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.04em">Notes</span><span style="display:block;margin-top:4px;font-size:15px;color:#0f172a;font-weight:500">${escapeHtml(opts.specialRequests)}</span></td></tr>`,
      );
    }
  } else {
    const tableRows: Array<{ label: string; value: string }> = [];
    if (opts.bookingDate) {
      tableRows.push({ label: "Date", value: escapeHtml(opts.bookingDate) });
    }
    if (opts.bookingTime) {
      tableRows.push({ label: "Time", value: escapeHtml(opts.bookingTime) });
    }
    if (opts.partySize != null && opts.partySize > 0) {
      const ps = opts.partySize;
      tableRows.push({
        label: "Party size",
        value: escapeHtml(`${ps} guest${ps !== 1 ? "s" : ""}`),
      });
    }
    if (opts.venueAddress) {
      tableRows.push({ label: "Location", value: escapeHtml(opts.venueAddress) });
    }
    if (opts.specialRequests) {
      tableRows.push({ label: "Notes", value: escapeHtml(opts.specialRequests) });
    }
    for (let i = 0; i < tableRows.length; i++) {
      const r = tableRows[i]!;
      rows.push(buildTableStyleDetailRow(r.label, r.value, i < tableRows.length - 1));
    }
  }

  if (rows.length === 0) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${GREY_BG};border:1px solid #e2e8f0;border-radius:10px;margin:16px 0;box-shadow:0 1px 2px rgba(15,23,42,0.06)"><tr><td style="padding:18px 20px">${rows.join("")}</td></tr></table>`;
}

/** Compact date for group lines (reuse full formatDate if needed). */
function formatDateShort(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T12:00:00");
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  } catch {
    return dateStr;
  }
}

/**
 * @param refundCutoffIso - `bookings.cancellation_deadline` (ISO). When the email is sent at `at`,
 *   copy reflects whether that deadline is still in the future (refund available) or already passed.
 */
export function buildDepositCallout(
  amount: string,
  refundCutoffIso?: string | null,
  at: Date = new Date(),
): string {
  let text = `Your deposit of £${escapeHtml(amount)} has been received.`;
  if (refundCutoffIso) {
    const fmt = formatRefundDeadlineIso(refundCutoffIso);
    const refundable = isDepositRefundAvailableAt(refundCutoffIso, at);
    if (refundable) {
      text += ` Your deposit is fully refundable if you cancel before ${escapeHtml(fmt)}. After this time, the deposit is non-refundable.`;
    } else {
      text +=
        " Under this venue's policy, deposits are only refunded if you cancel before a set time before your booking. That deadline has already passed, so this deposit is not refundable if you cancel.";
    }
  }
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${AMBER_BG};border:1px solid #FFE69C;border-radius:8px;margin:16px 0"><tr><td style="padding:16px;font-size:14px;color:${AMBER_TEXT}">${text}</td></tr></table>`;
}

export function buildCtaButton(label: string, url: string): string {
  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0">',
    '<tr><td style="background-color:' +
      BRAND +
      ';border-radius:8px;text-align:center">',
    `<a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:16px 32px;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:600;text-decoration:none">${escapeHtml(label)}</a>`,
    "</td></tr></table>",
  ].join("");
}

export function renderBaseTemplate(opts: BaseTemplateOptions): string {
  const base = baseUrl();

  const bookingCard = buildBookingDetailsCard({
    bookingDate: opts.bookingDate,
    bookingTime: opts.bookingTime,
    partySize: opts.partySize,
    venueAddress: opts.venueAddress,
    specialRequests: opts.specialRequests,
    emailVariant: opts.emailVariant,
    practitionerName: opts.practitionerName,
    serviceName: opts.serviceName,
    priceDisplay: opts.priceDisplay,
    groupAppointments: opts.groupAppointments,
  });

  const depositSection = opts.depositInfoHtml ?? "";

  const customSection = opts.customMessage
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0"><tr><td style="padding:16px;background-color:#F0F9FF;border-radius:8px;font-size:14px;color:#1E40AF;font-style:italic">${escapeHtml(opts.customMessage)}</td></tr></table>`
    : "";

  const ctaSection =
    opts.ctaUrl && opts.ctaLabel
      ? buildCtaButton(opts.ctaLabel, opts.ctaUrl)
      : "";
  const secondaryCtaSection =
    opts.secondaryCtaUrl && opts.secondaryCtaLabel
      ? buildCtaButton(opts.secondaryCtaLabel, opts.secondaryCtaUrl)
      : "";

  const postCtaSection = opts.postCtaHtml?.trim() ? opts.postCtaHtml : "";

  const footer =
    opts.footerNote ??
    `You received this email because you have a booking at ${escapeHtml(opts.venueName)}.`;

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
    '<body style="margin:0;padding:0;background-color:#f8fafc">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f8fafc">',
    '<tr><td align="center" style="padding:24px 16px">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">',

    // Header bar
    `<tr><td style="padding:20px 24px;background-color:${BRAND}">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td>`,
    opts.venueLogoUrl
      ? `<img src="${escapeHtml(opts.venueLogoUrl)}" alt="${escapeHtml(opts.venueName)}" width="120" style="height:auto;display:block" />`
      : `<span style="font-size:18px;font-weight:700;color:#ffffff">${escapeHtml(opts.venueName)}</span>`,
    "</td></tr></table>",
    "</td></tr>",

    // Body
    `<tr><td style="padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1e293b">`,
    `<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#0f172a">${escapeHtml(opts.heading)}</h1>`,
    opts.mainContent,
    bookingCard,
    depositSection,
    customSection,
    ctaSection,
    secondaryCtaSection,
    postCtaSection,
    "</td></tr>",

    // Footer
    `<tr><td style="padding:20px 24px;border-top:1px solid #e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:${FOOTER_TEXT}">`,
    `<p style="margin:0 0 8px 0">Powered by <a href="${base}" target="_blank" style="color:${BRAND};text-decoration:none;font-weight:600">Resneo</a></p>`,
    `<p style="margin:0;color:#aaa">${escapeHtml(footer)}</p>`,
    "</td></tr>",

    "</table>",
    "</td></tr></table>",
    "</body></html>",
  ].join("\n");
}

export function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

/** Compact calendar date for SMS (e.g. "28 Apr"). */
export function formatSmsDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
  } catch {
    return dateStr;
  }
}

export function formatTime(timeStr: string): string {
  try {
    const [h, m] = timeStr.slice(0, 5).split(":").map(Number);
    const ampm = (h ?? 0) >= 12 ? "pm" : "am";
    const h12 = (h ?? 0) % 12 || 12;
    return `${h12}:${String(m ?? 0).padStart(2, "0")}${ampm}`;
  } catch {
    return timeStr.slice(0, 5);
  }
}

export function formatDepositAmount(pence: number): string {
  return (pence / 100).toFixed(2);
}
