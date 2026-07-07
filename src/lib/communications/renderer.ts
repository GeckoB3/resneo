import type {
  BookingEmailData,
  RenderedEmail,
  RenderedSms,
  VenueEmailData,
} from '@/lib/emails/types';
import {
  escapeHtml,
  formatDate,
  formatSmsDate,
  formatTime,
} from '@/lib/emails/templates/base-template';
import { confirmationSubject } from '@/lib/emails/templates/booking-confirmation';
import { renderBookingConfirmationDocumentHtml, renderTransactionalEmailHtml } from '@/lib/emails/templates/booking-confirmation-layout';
import { buildGoogleCalendarAddUrlForBooking } from '@/lib/emails/calendar-links';
import { normalizeWebsiteUrlForLink } from '@/lib/emails/external-links';
import { resolveEmailLocation } from '@/lib/emails/booking-location';
import { accountBookingsMagicLinkUrl, accountBookingsPortalUrl } from '@/lib/emails/account-portal-links';
import { formatCardHoldFeePence } from '@/lib/booking/card-hold-terms';
import {
  bookingConfirmationSmsPriceSuffix,
  cardHoldConfirmationNotice,
  confirmationStructuredPriceText,
  eventBookingConfirmationSmsPriceSuffix,
  formatMoneyOrNull,
} from './booking-confirmation-pricing';
import type {
  CommunicationLane,
  CommunicationMessageKey,
} from './policies';

export interface CommunicationRenderOptions {
  lane: CommunicationLane;
  messageKey: CommunicationMessageKey;
  booking: BookingEmailData;
  venue: VenueEmailData;
  emailCustomMessage?: string | null;
  smsCustomMessage?: string | null;
  paymentLink?: string | null;
  confirmLink?: string | null;
  cancelLink?: string | null;
  refundMessage?: string | null;
  rebookLink?: string | null;
  paymentDeadline?: string | null;
  paymentDeadlineHours?: number | null;
  durationText?: string | null;
  preAppointmentInstructions?: string | null;
  cancellationPolicy?: string | null;
  changeSummary?: string | null;
  message?: string | null;
  /** When false for appointment lanes, manage links use cancel-only copy. */
  guestSelfRescheduleEnabled?: boolean;
  /** Compliance messages (§12): the public form URL, form name, and link expiry in days. */
  complianceFormLink?: string | null;
  complianceFormName?: string | null;
  complianceExpiryDays?: number | null;
}

function isAppointmentCancelOnly(opts: CommunicationRenderOptions): boolean {
  return isAppointmentLane(opts.lane) && opts.guestSelfRescheduleEnabled === false;
}

function manageBookingEmailCtaLabel(cancelOnly: boolean): string {
  return cancelOnly ? 'Cancel Your Appointment' : 'Manage Your Booking';
}

function manageBookingSmsUrlLabel(cancelOnly: boolean): string {
  return cancelOnly ? 'Cancel: ' : 'Manage: ';
}

function manageBookingTextLinkLine(cancelOnly: boolean, url: string): string {
  return cancelOnly ? `Cancel appointment: ${url}` : `Manage booking: ${url}`;
}

function manageBookingActionButtonLabel(cancelOnly: boolean): string {
  return cancelOnly ? 'Cancel' : 'Manage';
}

function isAppointmentLane(lane: CommunicationLane): boolean {
  return lane === 'appointments_other';
}

function htmlParagraph(text: string): string {
  return `<p style="margin:0 0 14px 0">${escapeHtml(text)}</p>`;
}

/** Account portal / magic-link line for policy-driven booking emails (complements single-booking manage URL). */
function accountBookingsLinkParts(booking: BookingEmailData): { html: string; textLine: string | null } {
  const url =
    (booking.account_bookings_link ?? '').trim() ||
    accountBookingsMagicLinkUrl(booking.guest_email) ||
    accountBookingsPortalUrl();
  if (!url) return { html: '', textLine: null };
  const safe = escapeHtml(url);
  return {
    html: `<p style="margin:0 0 12px 0;font-size:14px;color:#475569">Your bookings across venues: <a href="${safe}" style="color:#003B6F;font-weight:600">View or sign in to your account</a>.</p>`,
    textLine: `View or sign in to your account: ${url}`,
  };
}

/** "Forms to complete before your visit" block (compliance auto-send, Phase 1). */
function complianceFormsHtml(forms?: Array<{ name: string; url: string }>): string {
  if (!forms || forms.length === 0) return '';
  const items = forms
    .map(
      (f) =>
        `<li style="margin:2px 0"><a href="${escapeHtml(f.url)}" style="color:#003B6F;font-weight:600">${escapeHtml(f.name)}</a></li>`,
    )
    .join('');
  return (
    `<p style="margin:0 0 6px 0"><strong>Forms to complete before your visit:</strong></p>` +
    `<ul style="margin:0 0 14px 18px;padding:0">${items}</ul>`
  );
}

function complianceFormsTextLines(forms?: Array<{ name: string; url: string }>): Array<string | null> {
  if (!forms || forms.length === 0) return [];
  return ['', 'Forms to complete before your visit:', ...forms.map((f) => `  - ${f.name}: ${f.url}`)];
}

function htmlRaw(text: string): string {
  return `<p style="margin:0 0 14px 0">${text}</p>`;
}

function withStaff(
  base: string,
  booking: BookingEmailData,
): string {
  if (!booking.practitioner_name?.trim()) return base;
  return `${base} with ${booking.practitioner_name.trim()}`;
}

function bookingLabel(booking: BookingEmailData): string {
  return booking.appointment_service_name?.trim() || 'booking';
}

/** GSM-style single-segment target; prose is clipped before URLs when needed. */
const SMS_CHAR_BUDGET = 160;

function clipSmsText(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 3))}...`;
}

function joinSmsPrefixAndUrl(
  prefix: string,
  url: string | null | undefined,
  label = '',
  max = SMS_CHAR_BUDGET,
): string {
  const u = (url ?? '').trim();
  const base = prefix.trim();
  if (!u) return clipSmsText(base, max);
  const labelledUrl = `${label}${u}`;
  const combined = `${base} ${labelledUrl}`;
  if (combined.length <= max) return combined;
  // Long signed links can exceed a single SMS segment. Keep the actual message copy
  // and allow Twilio to split into segments rather than sending a bare URL.
  return combined;
}

function smsLeadPart(raw: string | null | undefined): string {
  const t = raw?.trim();
  if (!t) return '';
  return `${t} `;
}

function venueSmsName(name: string): string {
  return clipSmsText(name, 40);
}

function withStaffSms(booking: BookingEmailData, label: string): string {
  const L = clipSmsText(label, 34);
  const p = booking.practitioner_name?.trim();
  if (!p) return L;
  return `${L} with ${clipSmsText(p, 22)}`;
}

function emailFooterText(venue: VenueEmailData): string {
  const parts = [venue.name];
  if (venue.phone) parts.push(venue.phone);
  if (venue.address) parts.push(venue.address);
  return parts.join(' • ');
}

function emailVariantForLane(lane: CommunicationLane): 'table' | 'appointment' {
  return isAppointmentLane(lane) ? 'appointment' : 'table';
}

function buildTextLines(lines: Array<string | null | undefined>): string {
  return lines.filter((line): line is string => Boolean(line && line.trim())).join('\n');
}

export function renderCommunicationSms(
  opts: CommunicationRenderOptions,
): RenderedSms | null {
  const vn = venueSmsName(opts.venue.name);
  const smsDate = formatSmsDate(opts.booking.booking_date);
  const time = formatTime(opts.booking.booking_time);
  const partySize = opts.booking.party_size;
  const label = bookingLabel(opts.booking);
  const leadPart = smsLeadPart(opts.smsCustomMessage);
  const refundMsg = opts.refundMessage?.trim()
    ? clipSmsText(opts.refundMessage.trim(), 56)
    : '';
  const manageUrl = opts.booking.manage_booking_link?.trim() ?? '';
  const cancelOnly = isAppointmentCancelOnly(opts);
  const smsManageLabel = manageBookingSmsUrlLabel(cancelOnly);

  const body = (() => {
    switch (opts.messageKey) {
      case 'booking_confirmation': {
        const payHint = isAppointmentLane(opts.lane)
          ? opts.booking.booking_model === 'event_ticket'
            ? eventBookingConfirmationSmsPriceSuffix(opts.booking)
            : bookingConfirmationSmsPriceSuffix(opts.booking)
          : '';
        if (isAppointmentLane(opts.lane)) {
          const core = `${leadPart}${vn}: Confirmed: ${withStaffSms(opts.booking, label)} on ${smsDate} at ${time}.${payHint}`;
          return joinSmsPrefixAndUrl(core, manageUrl || null, smsManageLabel);
        }
        const core = `${leadPart}${vn}: Booking confirmed for ${partySize} guests on ${smsDate} at ${time}.`;
        return joinSmsPrefixAndUrl(core, manageUrl || null, smsManageLabel);
      }
      case 'deposit_payment_request': {
        const url = opts.paymentLink?.trim() ?? '';
        const core = isAppointmentLane(opts.lane)
          ? `${leadPart}${vn}: Deposit needed to confirm ${clipSmsText(label, 34)} on ${smsDate} at ${time}.`
          : `${leadPart}${vn}: Deposit needed to confirm ${partySize} guests on ${smsDate} at ${time}.`;
        return joinSmsPrefixAndUrl(core, url || null, 'Pay: ');
      }
      case 'confirm_or_cancel_prompt': {
        const url =
          opts.confirmLink?.trim() ||
          opts.cancelLink?.trim() ||
          opts.booking.confirm_cancel_link?.trim() ||
          manageUrl ||
          '';
        const core = isAppointmentLane(opts.lane)
          ? `${leadPart}${vn}: Please confirm or cancel ${withStaffSms(opts.booking, label)} on ${smsDate} at ${time}.`
          : `${leadPart}${vn}: Please confirm or cancel your booking for ${partySize} guests on ${smsDate} at ${time}.`;
        return url
          ? joinSmsPrefixAndUrl(core, url)
          : clipSmsText(`${core}.`, SMS_CHAR_BUDGET);
      }
      case 'deposit_payment_reminder': {
        const url = opts.paymentLink?.trim() ?? '';
        const core = isAppointmentLane(opts.lane)
          ? `${leadPart}${vn}: Reminder: deposit still needed for ${clipSmsText(label, 30)} on ${smsDate} at ${time}.`
          : `${leadPart}${vn}: Reminder: deposit still needed for ${partySize} guests on ${smsDate} at ${time}.`;
        return joinSmsPrefixAndUrl(core, url || null, 'Pay: ');
      }
      case 'card_hold_request':
      case 'card_hold_payment_reminder': {
        // Card-hold deposits (§10.3). Single shape for both lanes; the reassurance
        // clause ("No payment is taken now.") is dropped first when over 160 chars.
        const url = opts.paymentLink?.trim() ?? '';
        const prefix =
          opts.messageKey === 'card_hold_payment_reminder' ? 'Reminder: ' : '';
        const core = `${leadPart}${prefix}${vn}: card details needed to secure your booking for ${smsDate} at ${time}.`;
        const withReassurance = joinSmsPrefixAndUrl(
          `${core} No payment is taken now.`,
          url || null,
          'Add: ',
        );
        if (withReassurance.length <= SMS_CHAR_BUDGET) return withReassurance;
        return joinSmsPrefixAndUrl(core, url || null, 'Add: ');
      }
      case 'pre_visit_reminder': {
        const core = isAppointmentLane(opts.lane)
          ? `${leadPart}${vn}: Reminder: ${withStaffSms(opts.booking, label)} is on ${smsDate} at ${time}. See you soon.`
          : `${leadPart}${vn}: Reminder: your booking for ${partySize} guests is on ${smsDate} at ${time}.`;
        return clipSmsText(core, SMS_CHAR_BUDGET);
      }
      case 'booking_modification': {
        const core = isAppointmentLane(opts.lane)
          ? `${leadPart}${vn}: Updated booking: ${withStaffSms(opts.booking, label)} is now ${smsDate} at ${time}.`
          : `${leadPart}${vn}: Updated booking for ${partySize} guests: ${smsDate} at ${time}.`;
        return joinSmsPrefixAndUrl(core, manageUrl || null, smsManageLabel);
      }
      case 'cancellation_confirmation': {
        const tail = refundMsg ? ` ${refundMsg}` : '';
        const core = isAppointmentLane(opts.lane)
          ? `${leadPart}${vn}: Cancelled: your ${clipSmsText(label, 32)} on ${smsDate} at ${time}.${tail}`
          : `${leadPart}${vn}: Cancelled: your booking for ${partySize} guests on ${smsDate} at ${time}.${tail}`;
        return clipSmsText(core, SMS_CHAR_BUDGET);
      }
      case 'auto_cancel_notification': {
        // Card-hold variant (§12.1): the guest never owed a deposit, they never
        // added card details.
        const reason = opts.booking.card_hold
          ? 'card details were not added in time'
          : 'deposit was not paid in time';
        const reasonShort = opts.booking.card_hold
          ? 'card details were not added'
          : 'deposit was not paid';
        const core = isAppointmentLane(opts.lane)
          ? `${leadPart}${vn}: Cancelled: ${clipSmsText(label, 30)} on ${smsDate} at ${time}; ${reason}.`
          : `${leadPart}${vn}: Cancelled: booking for ${partySize} guests on ${smsDate} at ${time}; ${reasonShort}.`;
        return clipSmsText(core, SMS_CHAR_BUDGET);
      }
      case 'custom_message': {
        const msg = clipSmsText(opts.message ?? '', 130);
        return clipSmsText(`${vn}: ${msg}`, SMS_CHAR_BUDGET);
      }
      case 'compliance_form_request':
      case 'compliance_form_reminder': {
        const formName = clipSmsText(opts.complianceFormName ?? 'form', 40);
        const core = `${leadPart}${vn}: please complete your ${formName} before your ${smsDate} visit.`;
        return joinSmsPrefixAndUrl(core, opts.complianceFormLink?.trim() || null);
      }
      case 'compliance_record_expiring': {
        const formName = clipSmsText(opts.complianceFormName ?? 'record', 40);
        const core = `${leadPart}${vn}: your ${formName} is expiring soon. Please renew it.`;
        return joinSmsPrefixAndUrl(core, opts.complianceFormLink?.trim() || null);
      }
      default:
        return null;
    }
  })();

  return body ? { body } : null;
}

function buildMainContentEmail(opts: CommunicationRenderOptions): {
  subject: string;
  heading: string;
  mainContent: string;
  textLines: Array<string | null>;
  ctaLabel?: string;
  ctaUrl?: string | null;
  secondaryCtaLabel?: string;
  secondaryCtaUrl?: string | null;
  /** HTML inserted after CTAs (e.g. account portal pitch below calendar button). */
  postCtaHtml?: string | null;
  /** Plain-text line after CTA URL lines. */
  postCtaTextLine?: string | null;
} {
  const guestName = opts.booking.guest_name || 'Guest';
  const date = formatDate(opts.booking.booking_date);
  const time = formatTime(opts.booking.booking_time);
  const partySize = opts.booking.party_size;
  const depositAmount = formatMoneyOrNull(opts.booking.deposit_amount_pence);
  const label = bookingLabel(opts.booking);
  const withStaffLabel = withStaff(label, opts.booking);
  const appointment = isAppointmentLane(opts.lane);
  const cancelOnly = isAppointmentCancelOnly(opts);
  const manageCtaLabel = manageBookingEmailCtaLabel(cancelOnly);

  switch (opts.messageKey) {
    case 'booking_confirmation': {
      const acct = accountBookingsLinkParts(opts.booking);
      const structuredPrice = appointment ? confirmationStructuredPriceText(opts.booking) : null;
      const structuredTextLines = structuredPrice
        ? ['Price and payment:', ...structuredPrice.split('\n')]
        : [];
      // Card-hold deposits (§10.2): open hold -> append the card-on-file notice.
      const holdNotice = cardHoldConfirmationNotice(opts.booking, opts.venue.name);
      return {
        subject: appointment
          ? confirmationSubject(opts.booking, opts.venue.name)
          : `Your booking at ${opts.venue.name} is confirmed`,
        heading: 'Your booking is confirmed',
        mainContent: [
          htmlParagraph(`Hi ${guestName},`),
          htmlParagraph(
            appointment
              ? 'Your booking is confirmed. Here are the details:'
              : 'Your table is booked. Here are the details:',
          ),
          complianceFormsHtml(opts.booking.compliance_forms),
          opts.cancellationPolicy ? htmlRaw(`<strong>Cancellation policy:</strong> ${escapeHtml(opts.cancellationPolicy)}`) : '',
          opts.preAppointmentInstructions && appointment
            ? htmlRaw(`<strong>Before your appointment:</strong><br/>${escapeHtml(opts.preAppointmentInstructions)}`)
            : '',
        ].join(''),
        textLines: [
          `Hi ${guestName},`,
          '',
          appointment
            ? 'Your booking is confirmed. Here are the details:'
            : 'Your table is booked. Here are the details:',
          appointment ? `Service: ${withStaffLabel}` : null,
          `Date: ${date}`,
          `Time: ${time}`,
          appointment ? opts.durationText ? `Duration: ${opts.durationText}` : null : `Guests: ${partySize}`,
          ...structuredTextLines,
          holdNotice ? '' : null,
          holdNotice,
          ...complianceFormsTextLines(opts.booking.compliance_forms),
          opts.cancellationPolicy ? `Cancellation policy: ${opts.cancellationPolicy}` : null,
          opts.preAppointmentInstructions && appointment
            ? `Before your appointment: ${opts.preAppointmentInstructions}`
            : null,
          '',
          cancelOnly ? 'Need to cancel?' : 'Need to make changes?',
        ],
        ctaLabel: manageCtaLabel,
        ctaUrl: opts.booking.manage_booking_link ?? null,
        postCtaHtml: acct.html || null,
        postCtaTextLine: acct.textLine,
      };
    }
    case 'deposit_payment_request': {
      const acctDep = accountBookingsLinkParts(opts.booking);
      return {
        subject: `Complete your booking at ${opts.venue.name}`,
        heading: 'Complete your booking',
        mainContent: [
          htmlParagraph(`Hi ${guestName},`),
          htmlParagraph(
            appointment
              ? 'Your appointment has been reserved, but a deposit is required to confirm it:'
              : 'Your table has been reserved, but a deposit is required to confirm it:',
          ),
          depositAmount ? htmlRaw(`<strong>Deposit required:</strong> ${escapeHtml(depositAmount)}`) : '',
          opts.paymentDeadlineHours != null
            ? htmlParagraph(
                appointment
                  ? `Please complete your payment within ${opts.paymentDeadlineHours} hours to secure your appointment.`
                  : `Please complete your payment within ${opts.paymentDeadlineHours} hours to secure your booking.`,
              )
            : '',
        ].join(''),
        textLines: [
          `Hi ${guestName},`,
          '',
          appointment
            ? 'Your appointment has been reserved, but a deposit is required to confirm it:'
            : 'Your table has been reserved, but a deposit is required to confirm it:',
          appointment ? `Service: ${withStaffLabel}` : null,
          `Date: ${date}`,
          `Time: ${time}`,
          appointment ? null : `Guests: ${partySize}`,
          depositAmount ? `Deposit required: ${depositAmount}` : null,
          opts.paymentDeadlineHours != null
            ? `Please complete payment within ${opts.paymentDeadlineHours} hours to secure it.`
            : null,
        ],
        ctaLabel: 'Pay Deposit Now',
        ctaUrl: opts.paymentLink ?? null,
        postCtaHtml: acctDep.html || null,
        postCtaTextLine: acctDep.textLine,
      };
    }
    case 'deposit_confirmation': {
      const acctPaid = accountBookingsLinkParts(opts.booking);
      return {
        subject: `Deposit received for ${opts.venue.name}`,
        heading: 'Deposit received',
        mainContent: [
          htmlParagraph(`Hi ${guestName},`),
          htmlParagraph('Your deposit has been received and your booking is secured.'),
          depositAmount ? htmlRaw(`<strong>Deposit paid:</strong> ${escapeHtml(depositAmount)}`) : '',
        ].join(''),
        textLines: [
          `Hi ${guestName},`,
          '',
          'Your deposit has been received and your booking is secured.',
          depositAmount ? `Deposit paid: ${depositAmount}` : null,
        ],
        ctaLabel: manageCtaLabel,
        ctaUrl: opts.booking.manage_booking_link ?? null,
        postCtaHtml: acctPaid.html || null,
        postCtaTextLine: acctPaid.textLine,
      };
    }
    case 'confirm_or_cancel_prompt': {
      const hasPaidDeposit =
        opts.booking.deposit_status === 'Paid' && Boolean(opts.booking.deposit_amount_pence);
      const policyText = hasPaidDeposit ? (opts.cancellationPolicy ?? null) : null;
      return {
        subject: appointment
          ? `Can you still attend ${opts.venue.name}?`
          : `Are you still coming to ${opts.venue.name}?`,
        heading: appointment ? 'Can you still make your appointment?' : 'Are you still coming?',
        mainContent: [
          htmlParagraph(`Hi ${guestName},`),
          htmlParagraph(
            appointment
              ? "We're getting ready for your appointment and want to make sure everything is in order."
              : "We're getting ready for your visit and want to make sure everything is in order.",
          ),
          // Extras render as a detail row after the service (see renderTransactionalEmailHtml).
          policyText ? htmlRaw(escapeHtml(policyText)) : '',
        ].join(''),
        textLines: [
          `Hi ${guestName},`,
          '',
          appointment
            ? "We're getting ready for your appointment and want to make sure everything is in order."
            : "We're getting ready for your visit and want to make sure everything is in order.",
          appointment ? `Service: ${withStaffLabel}` : null,
          ...(appointment && opts.booking.addon_lines && opts.booking.addon_lines.length > 0
            ? ['Extras:', ...opts.booking.addon_lines.map((l) => `  - ${l}`)]
            : []),
          `Date: ${date}`,
          `Time: ${time}`,
          appointment ? null : `Guests: ${partySize}`,
          policyText,
        ],
        ctaLabel: "Yes, I'm Coming",
        ctaUrl: opts.confirmLink ?? null,
        secondaryCtaLabel: appointment ? 'Cancel My Appointment' : 'Cancel My Booking',
        secondaryCtaUrl: opts.cancelLink ?? null,
      };
    }
    case 'deposit_payment_reminder':
      return {
        subject: `Reminder: Complete your deposit for ${opts.venue.name}`,
        heading: 'Deposit reminder',
        mainContent: [
          htmlParagraph(`Hi ${guestName},`),
          htmlParagraph(
            appointment
              ? "Just a quick reminder that your deposit for your upcoming appointment hasn't been paid yet:"
              : "Just a quick reminder that your deposit for your upcoming booking hasn't been paid yet:",
          ),
          depositAmount ? htmlRaw(`<strong>Deposit required:</strong> ${escapeHtml(depositAmount)}`) : '',
          opts.paymentDeadline
            ? htmlParagraph(`Please complete payment by ${opts.paymentDeadline}.`)
            : '',
        ].join(''),
        textLines: [
          `Hi ${guestName},`,
          '',
          appointment
            ? "Just a quick reminder that your deposit for your upcoming appointment hasn't been paid yet:"
            : "Just a quick reminder that your deposit for your upcoming booking hasn't been paid yet:",
          appointment ? `Service: ${withStaffLabel}` : null,
          `Date: ${date}`,
          `Time: ${time}`,
          appointment ? null : `Guests: ${partySize}`,
          depositAmount ? `Deposit required: ${depositAmount}` : null,
          opts.paymentDeadline ? `Please complete payment by ${opts.paymentDeadline}.` : null,
        ],
        ctaLabel: 'Pay Deposit Now',
        ctaUrl: opts.paymentLink ?? null,
      };
    case 'card_hold_request':
    case 'card_hold_payment_reminder': {
      // Card-hold deposits (§10.3): no payment is taken and there is no refund
      // deadline copy (holds have none; the consent rule is stated in the body).
      const isReminder = opts.messageKey === 'card_hold_payment_reminder';
      const fee = formatCardHoldFeePence(opts.booking.card_hold_fee_pence ?? 0);
      const bodyCore =
        `No payment is taken now. Add your card details to secure your booking. ` +
        `${opts.venue.name} may charge a no-show fee of up to ${fee} if you do not attend.`;
      return {
        subject: isReminder
          ? `Reminder: add your card details to confirm your booking at ${opts.venue.name}`
          : `Add your card details to confirm your booking at ${opts.venue.name}`,
        heading: 'Card details needed',
        mainContent: [
          htmlParagraph(`Hi ${guestName},`),
          htmlParagraph(bodyCore),
        ].join(''),
        textLines: [
          `Hi ${guestName},`,
          '',
          bodyCore,
          appointment ? `Service: ${withStaffLabel}` : null,
          `Date: ${date}`,
          `Time: ${time}`,
          appointment ? null : `Guests: ${partySize}`,
        ],
        ctaLabel: 'Add card details',
        ctaUrl: opts.paymentLink ?? null,
      };
    }
    case 'pre_visit_reminder': {
      const acctPre = accountBookingsLinkParts(opts.booking);
      return {
        subject: appointment
          ? `Reminder: Your appointment at ${opts.venue.name} is coming up`
          : `Reminder: Your booking at ${opts.venue.name} is coming up`,
        heading: appointment ? 'Appointment reminder' : 'Booking reminder',
        mainContent: [
          htmlParagraph(`Hi ${guestName},`),
          htmlParagraph(
            appointment
              ? 'This is a friendly reminder about your upcoming appointment:'
              : 'This is a friendly reminder about your upcoming booking:',
          ),
          // Extras render as a detail row after the service (see renderTransactionalEmailHtml).
          opts.preAppointmentInstructions && appointment
            ? htmlRaw(`<strong>Before your appointment:</strong><br/>${escapeHtml(opts.preAppointmentInstructions)}`)
            : '',
          depositAmount ? htmlRaw(`<strong>Deposit paid:</strong> ${escapeHtml(depositAmount)}`) : '',
        ].join(''),
        textLines: [
          `Hi ${guestName},`,
          '',
          appointment
            ? 'This is a friendly reminder about your upcoming appointment:'
            : 'This is a friendly reminder about your upcoming booking:',
          appointment ? `Service: ${withStaffLabel}` : null,
          ...(appointment && opts.booking.addon_lines && opts.booking.addon_lines.length > 0
            ? ['Extras:', ...opts.booking.addon_lines.map((l) => `  - ${l}`)]
            : []),
          `Date: ${date}`,
          `Time: ${time}`,
          appointment ? opts.durationText ? `Duration: ${opts.durationText}` : null : `Guests: ${partySize}`,
          opts.preAppointmentInstructions && appointment
            ? `Before your appointment: ${opts.preAppointmentInstructions}`
            : null,
          depositAmount ? `Deposit paid: ${depositAmount}` : null,
        ],
        ctaLabel: manageCtaLabel,
        ctaUrl: opts.booking.manage_booking_link ?? null,
        postCtaHtml: acctPre.html || null,
        postCtaTextLine: acctPre.textLine,
      };
    }
    case 'booking_modification': {
      const acctMod = accountBookingsLinkParts(opts.booking);
      return {
        subject: appointment
          ? `Your appointment at ${opts.venue.name} has been updated`
          : `Your booking at ${opts.venue.name} has been updated`,
        heading: appointment ? 'Your appointment has been updated' : 'Your booking has been updated',
        mainContent: [
          htmlParagraph(`Hi ${guestName},`),
          htmlParagraph('Your booking has been updated. Here are the new details:'),
          opts.changeSummary ? htmlRaw(`<strong>What changed:</strong> ${escapeHtml(opts.changeSummary)}`) : '',
        ].join(''),
        textLines: [
          `Hi ${guestName},`,
          '',
          'Your booking has been updated. Here are the new details:',
          appointment ? `Service: ${withStaffLabel}` : null,
          `Date: ${date}`,
          `Time: ${time}`,
          appointment ? opts.durationText ? `Duration: ${opts.durationText}` : null : `Guests: ${partySize}`,
          opts.changeSummary ? `What changed: ${opts.changeSummary}` : null,
        ],
        ctaLabel: manageCtaLabel,
        ctaUrl: opts.booking.manage_booking_link ?? null,
        postCtaHtml: acctMod.html || null,
        postCtaTextLine: acctMod.textLine,
      };
    }
    case 'cancellation_confirmation':
      return {
        subject: appointment
          ? `Your appointment at ${opts.venue.name} has been cancelled`
          : `Your booking at ${opts.venue.name} has been cancelled`,
        heading: appointment ? 'Your appointment has been cancelled' : 'Your booking has been cancelled',
        mainContent: [
          htmlParagraph(`Hi ${guestName},`),
          htmlParagraph(appointment ? 'Your appointment has been cancelled:' : 'Your booking has been cancelled:'),
          opts.refundMessage ? htmlParagraph(opts.refundMessage) : '',
          htmlParagraph(
            appointment
              ? "We're sorry to see you cancel. We'd love to welcome you back another time."
              : "We're sorry to see you cancel. We'd love to welcome you another time.",
          ),
        ].join(''),
        textLines: [
          `Hi ${guestName},`,
          '',
          appointment ? 'Your appointment has been cancelled:' : 'Your booking has been cancelled:',
          appointment ? `Service: ${withStaffLabel}` : null,
          `Date: ${date}`,
          `Time: ${time}`,
          appointment ? null : `Guests: ${partySize}`,
          opts.refundMessage ?? null,
        ],
        ctaLabel: 'Book Again',
        ctaUrl: opts.rebookLink ?? opts.venue.booking_page_url ?? null,
      };
    case 'auto_cancel_notification': {
      // Card-hold variant (§12.1): "the deposit wasn't paid in time" is false
      // for a card hold, where only card details were requested.
      const cancelReason = opts.booking.card_hold
        ? 'because card details were not added in time'
        : "because the deposit wasn't paid in time";
      const cancelledLine = appointment
        ? `We're sorry to let you know that your appointment has been cancelled ${cancelReason}:`
        : `We're sorry to let you know that your booking has been cancelled ${cancelReason}:`;
      return {
        subject: appointment
          ? `Your appointment at ${opts.venue.name} has been cancelled`
          : `Your booking at ${opts.venue.name} has been cancelled`,
        heading: 'Booking cancelled',
        mainContent: [
          htmlParagraph(`Hi ${guestName},`),
          htmlParagraph(cancelledLine),
          htmlParagraph(
            appointment
              ? "The slot has been released. If you'd still like to book, you're welcome to choose a new time."
              : "The slot has been released. If you'd still like to visit us, you're welcome to make a new booking.",
          ),
        ].join(''),
        textLines: [
          `Hi ${guestName},`,
          '',
          cancelledLine,
          appointment ? `Service: ${withStaffLabel}` : null,
          `Date: ${date}`,
          `Time: ${time}`,
          appointment ? null : `Guests: ${partySize}`,
        ],
        ctaLabel: 'Book Again',
        ctaUrl: opts.rebookLink ?? opts.venue.booking_page_url ?? null,
      };
    }
    case 'custom_message':
      return {
        subject: `A message from ${opts.venue.name}`,
        heading: 'A message from your venue',
        mainContent: [
          htmlParagraph(`Hi ${guestName},`),
          opts.message ? htmlParagraph(opts.message) : '',
        ].join(''),
        textLines: [
          `Hi ${guestName},`,
          '',
          opts.message ?? '',
        ],
      };
    case 'no_show_notification':
      return {
        subject: `We missed you at ${opts.venue.name}`,
        heading: 'We missed you',
        mainContent: [
          htmlParagraph(`Hi ${guestName},`),
          htmlParagraph(
            appointment
              ? 'Your booking was marked as a no-show.'
              : 'Your table booking was marked as a no-show.',
          ),
          opts.refundMessage ? htmlParagraph(opts.refundMessage) : '',
        ].join(''),
        textLines: [
          `Hi ${guestName},`,
          '',
          appointment
            ? 'Your booking was marked as a no-show.'
            : 'Your table booking was marked as a no-show.',
          `Date: ${date}`,
          `Time: ${time}`,
          opts.refundMessage ?? null,
        ],
      };
    case 'post_visit_thankyou':
      return {
        subject: `Thank you for visiting ${opts.venue.name}`,
        heading: 'Thank you for your visit',
        mainContent: [
          htmlParagraph(`Hi ${guestName},`),
          htmlParagraph(
            appointment
              ? 'Thank you for choosing us for your appointment. We hope your experience was excellent.'
              : 'Thank you for dining with us. We hope you had a wonderful experience.',
          ),
        ].join(''),
        textLines: [
          `Hi ${guestName},`,
          '',
          appointment
            ? 'Thank you for choosing us for your appointment.'
            : 'Thank you for dining with us.',
        ],
        ctaLabel: 'Book Again',
        ctaUrl: opts.rebookLink ?? opts.venue.booking_page_url ?? null,
      };
    case 'compliance_form_request':
    case 'compliance_form_reminder': {
      const formName = opts.complianceFormName ?? 'form';
      const formLink = opts.complianceFormLink?.trim() ?? '';
      const expiryDays = opts.complianceExpiryDays ?? 14;
      const isReminder = opts.messageKey === 'compliance_form_reminder';
      return {
        subject: `Please complete your ${formName} before your appointment`,
        heading: isReminder ? 'A quick reminder' : `Please complete your ${formName}`,
        mainContent: [
          htmlParagraph(`Hi ${guestName},`),
          htmlParagraph(
            isReminder
              ? `Just a reminder to complete your ${escapeHtml(formName)} before your upcoming appointment at ${escapeHtml(opts.venue.name)}.`
              : `Before your upcoming appointment at ${escapeHtml(opts.venue.name)}, please take a moment to complete your ${escapeHtml(formName)}.`,
          ),
          htmlParagraph(`This link is unique to you and will expire in ${expiryDays} days.`),
        ].join(''),
        textLines: [
          `Hi ${guestName},`,
          '',
          isReminder
            ? `Just a reminder to complete your ${formName} before your upcoming appointment at ${opts.venue.name}.`
            : `Before your upcoming appointment at ${opts.venue.name}, please complete your ${formName}.`,
          '',
          `This link is unique to you and will expire in ${expiryDays} days.`,
        ],
        ctaLabel: 'Complete the form',
        ctaUrl: formLink || null,
      };
    }
    case 'compliance_record_expiring': {
      const formName = opts.complianceFormName ?? 'record';
      const formLink = opts.complianceFormLink?.trim() ?? '';
      return {
        subject: `Your ${formName} is expiring soon`,
        heading: `Your ${formName} is expiring soon`,
        mainContent: [
          htmlParagraph(`Hi ${guestName},`),
          htmlParagraph(
            `Your ${escapeHtml(formName)} on file with ${escapeHtml(opts.venue.name)} is due to expire soon. Please complete it again so you're ready for your next appointment.`,
          ),
        ].join(''),
        textLines: [
          `Hi ${guestName},`,
          '',
          `Your ${formName} on file with ${opts.venue.name} is due to expire soon. Please complete it again so you're ready for your next appointment.`,
        ],
        ctaLabel: formLink ? 'Complete the form' : undefined,
        ctaUrl: formLink || null,
      };
    }
    case 'appointment_waitlist_offer':
      throw new Error(
        'appointment_waitlist_offer is rendered via renderAppointmentWaitlistOfferEmail, not buildMainContentEmail',
      );
    case 'class_credits_purchased':
    case 'class_credits_expiring':
    case 'class_credits_restored':
    case 'class_course_enrolled':
    case 'class_course_refunded':
    case 'class_membership_started':
    case 'class_membership_renewed':
    case 'class_membership_cancelling':
    case 'class_membership_ended':
      // Class-commerce keys render via sendClassCommerceComm, not buildMainContentEmail
      // (they are not booking-keyed and use canonical bodies for v1).
      throw new Error(
        `${opts.messageKey} is rendered via sendClassCommerceComm, not buildMainContentEmail`,
      );
  }
}

export function renderCommunicationEmail(
  opts: CommunicationRenderOptions,
): RenderedEmail | null {
  const config = buildMainContentEmail(opts);

  const appointmentLane = isAppointmentLane(opts.lane);

  // Service delivery location: venue address (default), client's address, or online
  // joining details — drives the Location row/card, maps link, and text lines.
  const resolvedLocation = resolveEmailLocation(opts.booking, opts.venue);

  let html: string;

  const cancelOnly = isAppointmentCancelOnly(opts);

  if (opts.messageKey === 'booking_confirmation') {
    const structuredPrice = confirmationStructuredPriceText(opts.booking);
    // Card-hold deposits (§10.2): render the card-on-file notice in the details
    // card, in the slot the deposit callout uses (mirrors how deposit receipt
    // lines are appended to the confirmation).
    const holdNotice = cardHoldConfirmationNotice(opts.booking, opts.venue.name);
    const holdNoticeHtml = holdNotice
      ? `<div style="margin:20px 0 0;padding:16px 18px;background:#eef4fa;border:1px solid #d6e3ef;border-radius:12px;font-size:14px;color:#334155;line-height:1.6">${escapeHtml(holdNotice)}</div>`
      : null;

    html = renderBookingConfirmationDocumentHtml({
      booking: opts.booking,
      venue: opts.venue,
      appointmentStyle: appointmentLane,
      emailVariant: appointmentLane ? 'appointment' : 'table',
      priceDisplay: structuredPrice?.trim() ? structuredPrice : null,
      manageButtonLabel: manageBookingActionButtonLabel(cancelOnly),
      blocks: {
        preambleHtml: complianceFormsHtml(opts.booking.compliance_forms),
        depositHtml: holdNoticeHtml,
        customMessage: opts.emailCustomMessage ?? null,
        postCtaAccountHtml: config.postCtaHtml ?? null,
        cancellationPolicy: opts.cancellationPolicy ?? null,
        preAppointmentInstructions:
          opts.preAppointmentInstructions && appointmentLane
            ? opts.preAppointmentInstructions
            : null,
      },
    });
  } else {
    html = renderTransactionalEmailHtml({
      venueName: opts.venue.name,
      venueLogoUrl: opts.venue.logo_url ?? null,
      heading: config.heading,
      mainContent: config.mainContent,
      bookingDate: formatDate(opts.booking.booking_date),
      bookingTime: formatTime(opts.booking.booking_time),
      partySize: opts.booking.party_size,
      venueAddress: resolvedLocation.rowValue,
      locationJoinUrl: resolvedLocation.joinUrl,
      locationExtra: resolvedLocation.rowExtra,
      specialRequests: opts.booking.special_requests ?? null,
      customMessage: opts.emailCustomMessage ?? null,
      ctaLabel: config.ctaLabel,
      ctaUrl: config.ctaUrl,
      secondaryCtaLabel: config.secondaryCtaLabel,
      secondaryCtaUrl: config.secondaryCtaUrl,
      postCtaHtml: config.postCtaHtml ?? null,
      footerNote: emailFooterText(opts.venue),
      emailVariant: emailVariantForLane(opts.lane),
      practitionerName: opts.booking.practitioner_name ?? null,
      serviceName: appointmentLane ? bookingLabel(opts.booking) : null,
      priceDisplay: null,
      groupAppointments: opts.booking.group_appointments,
      addonLines: appointmentLane ? (opts.booking.addon_lines ?? null) : null,
    });
  }

  const calendarUrl =
    opts.messageKey === 'booking_confirmation'
      ? buildGoogleCalendarAddUrlForBooking(opts.booking, opts.venue)
      : null;
  const mapsUrl = resolvedLocation.mapsUrl;
  const venueWeb = normalizeWebsiteUrlForLink(opts.venue.website_url ?? undefined);

  let ctaLabel = config.ctaLabel;
  let ctaUrl = config.ctaUrl;
  let secondaryCtaLabel = config.secondaryCtaLabel;
  let secondaryCtaUrl = config.secondaryCtaUrl;

  if (opts.messageKey !== 'booking_confirmation') {
    if (calendarUrl) {
      if (ctaUrl) {
        secondaryCtaLabel = 'Add to calendar';
        secondaryCtaUrl = calendarUrl;
      } else {
        ctaLabel = 'Add to calendar';
        ctaUrl = calendarUrl;
      }
    }
  }

  // Non-venue locations matter on every message (reminders included), so the client
  // always has the address / join link to hand; the venue-maps line stays
  // confirmation-only as before.
  const locationTextLines =
    resolvedLocation.kind === 'business_venue'
      ? opts.messageKey === 'booking_confirmation' && mapsUrl
        ? [`Location (Google Maps): ${mapsUrl}`]
        : []
      : resolvedLocation.textLines;

  const text = buildTextLines([
    ...config.textLines,
    opts.emailCustomMessage ? '' : null,
    opts.emailCustomMessage ?? null,
    opts.messageKey === 'booking_confirmation' || locationTextLines.length > 0 ? '' : null,
    opts.messageKey === 'booking_confirmation' && calendarUrl ? `Add to calendar: ${calendarUrl}` : null,
    ...locationTextLines,
    opts.messageKey === 'booking_confirmation' && venueWeb ? `Venue website: ${venueWeb}` : null,
    opts.messageKey === 'booking_confirmation' && opts.booking.manage_booking_link?.trim()
      ? manageBookingTextLinkLine(cancelOnly, opts.booking.manage_booking_link.trim())
      : null,
    opts.messageKey !== 'booking_confirmation' && ctaLabel && ctaUrl ? '' : null,
    opts.messageKey !== 'booking_confirmation' && ctaLabel && ctaUrl ? `${ctaLabel}: ${ctaUrl}` : null,
    opts.messageKey !== 'booking_confirmation' && secondaryCtaLabel && secondaryCtaUrl
      ? `${secondaryCtaLabel}: ${secondaryCtaUrl}`
      : null,
    config.postCtaTextLine?.trim() ? config.postCtaTextLine : null,
    '',
    opts.venue.name,
    opts.venue.phone ?? null,
    opts.venue.address ?? null,
  ]);

  return {
    subject: config.subject,
    html,
    text,
  };
}
