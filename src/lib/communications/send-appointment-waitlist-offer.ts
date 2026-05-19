import { sendEmail } from '@/lib/emails/send-email';
import { sendSmsWithSegments } from '@/lib/emails/send-sms';
import { assertSmsSendWithinFreeAccessQuota, estimateSmsSegments, recordOutboundSms } from '@/lib/sms-usage';
import { formatGuestDisplayName } from '@/lib/guests/name';

export interface AppointmentWaitlistOfferNotifyInput {
  venueId: string;
  venueName: string;
  venuePhone: string | null;
  bookingPageUrl: string | null;
  guestFirstName: string | null;
  guestLastName: string | null;
  guestEmail: string | null;
  guestPhone: string;
  desiredDate: string;
  desiredTimeHm: string;
  expiresAtIso: string;
}

export interface AppointmentWaitlistOfferNotifyResult {
  emailSent: boolean;
  smsSent: boolean;
}

function formatOfferDate(dateIso: string): string {
  return new Date(`${dateIso}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function formatOfferExpiry(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildOfferMessage(input: AppointmentWaitlistOfferNotifyInput): {
  subject: string;
  emailText: string;
  smsText: string;
} {
  const guestName = formatGuestDisplayName(input.guestFirstName, input.guestLastName, 'guest');
  const dateLabel = formatOfferDate(input.desiredDate);
  const expiryLabel = formatOfferExpiry(input.expiresAtIso);
  const contactHint = input.venuePhone
    ? `Call ${input.venuePhone} to secure this slot`
    : 'Contact the venue to secure this slot';
  const bookHint = input.bookingPageUrl
    ? ` You can also book online: ${input.bookingPageUrl}`
    : '';

  const body = `Hi ${guestName}, good news — an appointment slot opened at ${input.venueName} on ${dateLabel} at ${input.desiredTimeHm}. ${contactHint} before ${expiryLabel}.${bookHint}`;

  return {
    subject: `Appointment available at ${input.venueName}`,
    emailText: body,
    smsText: `${input.venueName}: Slot available ${dateLabel} ${input.desiredTimeHm}. ${contactHint} by ${expiryLabel}.${bookHint ? ` Book: ${input.bookingPageUrl}` : ''}`,
  };
}

/**
 * Notifies a waitlisted guest that a slot opened (Phase 1a.3 offer-on-cancel).
 * Uses direct email/SMS — not tied to a booking row yet.
 */
export async function sendAppointmentWaitlistOfferNotification(
  input: AppointmentWaitlistOfferNotifyInput,
): Promise<AppointmentWaitlistOfferNotifyResult> {
  const { subject, emailText, smsText } = buildOfferMessage(input);
  let emailSent = false;
  let smsSent = false;

  if (input.guestEmail?.trim()) {
    try {
      await sendEmail({
        to: input.guestEmail.trim(),
        subject,
        text: emailText,
        html: `<html><body style="font-family:Arial,sans-serif;line-height:1.5"><p>${emailText.replace(/\n/g, '<br/>')}</p></body></html>`,
      });
      emailSent = true;
    } catch (err) {
      console.error('[sendAppointmentWaitlistOfferNotification] email failed:', err, {
        venueId: input.venueId,
      });
    }
  }

  if (input.guestPhone?.trim()) {
    try {
      const quota = await assertSmsSendWithinFreeAccessQuota({
        venueId: input.venueId,
        additionalSegments: estimateSmsSegments(smsText),
      });
      if (quota.ok) {
        const { sid, segmentCount } = await sendSmsWithSegments(input.guestPhone.trim(), smsText);
        if (sid) {
          await recordOutboundSms({
            venueId: input.venueId,
            messageType: 'appointment_waitlist_offer',
            recipientPhone: input.guestPhone.trim(),
            twilioSid: sid,
            segmentCount,
          });
          smsSent = true;
        }
      } else {
        console.warn('[sendAppointmentWaitlistOfferNotification] SMS blocked:', quota.reason, {
          venueId: input.venueId,
        });
      }
    } catch (err) {
      console.error('[sendAppointmentWaitlistOfferNotification] SMS failed:', err, {
        venueId: input.venueId,
      });
    }
  }

  return { emailSent, smsSent };
}
