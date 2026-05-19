import { sendEmail } from '@/lib/emails/send-email';
import { sendSmsWithSegments } from '@/lib/emails/send-sms';
import { assertSmsSendWithinFreeAccessQuota, estimateSmsSegments, recordOutboundSms } from '@/lib/sms-usage';
import { formatGuestDisplayName } from '@/lib/guests/name';
import { renderAppointmentWaitlistOfferEmail } from '@/lib/emails/templates/appointment-waitlist-offer-email';
import { renderAppointmentWaitlistOfferSms } from '@/lib/emails/templates/appointment-waitlist-offer-sms';

export interface AppointmentWaitlistOfferNotifyInput {
  venueId: string;
  venueName: string;
  venueLogoUrl?: string | null;
  venueAddress?: string | null;
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

function formatOfferExpiry(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Notifies a waitlisted guest that a slot opened (Phase 1a.3 offer-on-cancel).
 * Uses direct email/SMS — not tied to a booking row yet.
 */
export async function sendAppointmentWaitlistOfferNotification(
  input: AppointmentWaitlistOfferNotifyInput,
): Promise<AppointmentWaitlistOfferNotifyResult> {
  const guestName = formatGuestDisplayName(input.guestFirstName, input.guestLastName, 'guest');
  const expiresAtLabel = formatOfferExpiry(input.expiresAtIso);

  const { subject, html, text } = renderAppointmentWaitlistOfferEmail({
    venueName: input.venueName,
    venueLogoUrl: input.venueLogoUrl,
    venueAddress: input.venueAddress,
    venuePhone: input.venuePhone,
    guestName,
    desiredDate: input.desiredDate,
    timeWindowLabel: input.desiredTimeHm,
    expiresAtLabel,
    bookingPageUrl: input.bookingPageUrl,
  });

  let emailSent = false;
  let smsSent = false;

  if (input.guestEmail?.trim()) {
    try {
      await sendEmail({
        to: input.guestEmail.trim(),
        subject,
        text,
        html,
      });
      emailSent = true;
    } catch (err) {
      console.error('[sendAppointmentWaitlistOfferNotification] email failed:', err, {
        venueId: input.venueId,
      });
    }
  }

  const bookingUrl = input.bookingPageUrl?.trim();
  if (input.guestPhone?.trim() && bookingUrl) {
    const { body: smsText } = renderAppointmentWaitlistOfferSms(bookingUrl);
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
