import { sendEmail } from '@/lib/emails/send-email';
import { sendSmsWithSegments } from '@/lib/emails/send-sms';
import { assertSmsSendWithinFreeAccessQuota, estimateSmsSegments, recordOutboundSms } from '@/lib/sms-usage';
import { formatGuestDisplayName } from '@/lib/guests/name';
import { renderAppointmentWaitlistOfferEmail } from '@/lib/emails/templates/appointment-waitlist-offer-email';
import { renderAppointmentWaitlistOfferSms } from '@/lib/emails/templates/appointment-waitlist-offer-sms';
import { resolveCommPolicy } from '@/lib/communications/policy-resolver';

export interface AppointmentWaitlistOfferNotifyInput {
  venueId: string;
  venueName: string;
  venueLogoUrl?: string | null;
  venueBrandColour?: string | null;
  venueAddress?: string | null;
  venuePhone: string | null;
  bookingPageUrl: string | null;
  guestFirstName: string | null;
  guestLastName: string | null;
  guestEmail: string | null;
  guestPhone: string;
  desiredDate: string;
  desiredTimeHm: string;
  /** Internal offer expiry for notify_in_order; not shown to guests. */
  expiresAtIso: string | null;
}

export interface AppointmentWaitlistOfferNotifyResult {
  emailSent: boolean;
  smsSent: boolean;
  skipped?: boolean;
  skipReason?: string;
}

/**
 * Notifies a waitlisted guest that availability has opened.
 * Uses direct email/SMS — not tied to a booking row yet.
 * Respects venue communication policies for `appointment_waitlist_offer`.
 */
export async function sendAppointmentWaitlistOfferNotification(
  input: AppointmentWaitlistOfferNotifyInput,
): Promise<AppointmentWaitlistOfferNotifyResult> {
  const resolved = await resolveCommPolicy({
    venueId: input.venueId,
    messageKey: 'appointment_waitlist_offer',
    lane: 'appointments_other',
  });

  if (!resolved.enabled) {
    return { emailSent: false, smsSent: false, skipped: true, skipReason: 'disabled' };
  }

  const sendEmailChannel = resolved.channels.includes('email');
  const sendSmsChannel = resolved.channels.includes('sms');

  if (!sendEmailChannel && !sendSmsChannel) {
    return { emailSent: false, smsSent: false, skipped: true, skipReason: 'no_channels' };
  }

  const guestName = formatGuestDisplayName(input.guestFirstName, input.guestLastName, 'guest');

  const { subject, html, text } = renderAppointmentWaitlistOfferEmail({
    venueName: input.venueName,
    venueLogoUrl: input.venueLogoUrl,
    venueBrandColour: input.venueBrandColour ?? null,
    venueAddress: input.venueAddress,
    venuePhone: input.venuePhone,
    guestName,
    desiredDate: input.desiredDate,
    timeWindowLabel: input.desiredTimeHm,
    bookingPageUrl: input.bookingPageUrl,
  });

  let emailSent = false;
  let smsSent = false;

  if (sendEmailChannel && input.guestEmail?.trim()) {
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
  if (sendSmsChannel && input.guestPhone?.trim() && bookingUrl) {
    const { body: smsText } = renderAppointmentWaitlistOfferSms({
      venueName: input.venueName,
      bookingPageUrl: bookingUrl,
    });
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
