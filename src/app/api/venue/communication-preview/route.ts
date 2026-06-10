import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import {
  parseVenueFeatureFlags,
  resolveAppointmentsFeatureFlag,
} from '@/lib/feature-flags';
import type { CommunicationChannel, CommunicationLane, CommunicationMessageKey } from '@/lib/communications/policies';
import { resolveCommPolicy } from '@/lib/communications/policy-resolver';
import {
  getPreviewBookingSample,
  getPreviewVenueSample,
  type CommunicationPreviewSampleVariant,
} from '@/lib/communications/preview-samples';
import {
  renderCommunicationEmail,
  renderCommunicationSms,
} from '@/lib/communications/renderer';
import { renderAppointmentWaitlistOfferEmail } from '@/lib/emails/templates/appointment-waitlist-offer-email';
import { renderAppointmentWaitlistOfferSms } from '@/lib/emails/templates/appointment-waitlist-offer-sms';

/**
 * POST /api/venue/communication-preview
 * Returns rendered preview of a specific message type with optional custom message.
 */
export async function POST(request: NextRequest) {
  try {
    // Bearer (mobile) + cookie (web) auth — see createVenueRouteClient.
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const body = await request.json();
    const messageKey = body.messageKey as CommunicationMessageKey;
    const channel = body.channel as CommunicationChannel | undefined;
    const lane = body.lane as CommunicationLane | undefined;
    const customMessage = (body.customMessage as string | undefined) ?? null;
    const sampleVariant = body.sampleVariant as
      | CommunicationPreviewSampleVariant
      | undefined;

    if (!messageKey || !channel || !lane) {
      return NextResponse.json(
        { error: 'Missing messageKey, channel, or lane' },
        { status: 400 },
      );
    }

    const admin = getSupabaseAdminClient();
    const { data: venue } = await admin
      .from('venues')
      .select('name, address, booking_model, feature_flags')
      .eq('id', staff.venue_id)
      .single();

    const venueFlags = parseVenueFeatureFlags(
      (venue as { feature_flags?: unknown } | null)?.feature_flags,
    );
    const guestSelfRescheduleEnabled = resolveAppointmentsFeatureFlag(
      'guest_self_reschedule',
      venueFlags,
    );

    const bookingModel =
      (venue as { booking_model?: string | null } | null)?.booking_model ?? null;
    const resolved = await resolveCommPolicy({
      venueId: staff.venue_id,
      messageKey,
      bookingModel,
      lane,
      requestedChannels: [channel],
    });

    const venueData = getPreviewVenueSample(venue?.name ?? undefined, venue?.address ?? undefined);
    const booking = getPreviewBookingSample(
      lane,
      sampleVariant,
    );

    if (messageKey === 'appointment_waitlist_offer') {
      const bookingPageUrl = venueData.booking_page_url ?? 'https://www.resneo.com/book/preview';
      if (channel === 'email') {
        const email = renderAppointmentWaitlistOfferEmail({
          venueName: venueData.name,
          venueLogoUrl: venueData.logo_url,
          venueAddress: venueData.address,
          venuePhone: venueData.phone,
          guestName: 'Alex Smith',
          desiredDate: booking.booking_date,
          timeWindowLabel: booking.booking_time.slice(0, 5),
          bookingPageUrl,
        });
        return NextResponse.json({
          messageKey,
          channel,
          lane,
          subject: email.subject,
          html: email.html,
          text: email.text,
          previewSampleKind: sampleVariant ?? lane,
        });
      }

      const sms = renderAppointmentWaitlistOfferSms({
        venueName: venueData.name,
        bookingPageUrl,
      });
      return NextResponse.json({
        messageKey,
        channel,
        lane,
        subject: null,
        html: null,
        text: sms.body,
        previewSampleKind: sampleVariant ?? lane,
      });
    }

    const emailCustomMessage =
      channel === 'email'
        ? customMessage
        : resolved.emailCustomMessage;
    const smsCustomMessage =
      channel === 'sms'
        ? customMessage
        : resolved.smsCustomMessage;

    const emailPreview =
      channel === 'email'
        ? renderCommunicationEmail({
            lane,
            messageKey,
            booking,
            venue: venueData,
            emailCustomMessage,
            smsCustomMessage,
            paymentLink: 'https://www.resneo.com/pay?t=preview',
            confirmLink: 'https://www.resneo.com/confirm/preview',
            cancelLink: 'https://www.resneo.com/cancel/preview',
            refundMessage: '£20 deposit refunded',
            rebookLink: venueData.booking_page_url ?? null,
            paymentDeadline: '20 March at 17:00',
            paymentDeadlineHours: 24,
            durationText: '45 minutes',
            preAppointmentInstructions: 'Please arrive 10 minutes early.',
            cancellationPolicy:
              'Full refund if you cancel before the cutoff. No refund after that.',
            changeSummary: 'Time moved by 30 minutes.',
            message:
              'We have a quick update about your booking. Please contact us if you need anything else.',
            guestSelfRescheduleEnabled,
          })
        : null;
    const smsPreview =
      channel === 'sms'
        ? renderCommunicationSms({
            lane,
            messageKey,
            booking,
            venue: venueData,
            emailCustomMessage,
            smsCustomMessage,
            paymentLink: 'https://www.resneo.com/pay?t=preview',
            confirmLink: 'https://www.resneo.com/confirm/preview',
            cancelLink: 'https://www.resneo.com/cancel/preview',
            refundMessage: '£20 deposit refunded.',
            rebookLink: venueData.booking_page_url ?? null,
            paymentDeadline: '20 March at 17:00',
            paymentDeadlineHours: 24,
            durationText: '45 minutes',
            preAppointmentInstructions: 'Please arrive 10 minutes early.',
            cancellationPolicy:
              'Full refund if you cancel before the cutoff. No refund after that.',
            changeSummary: 'Time moved by 30 minutes.',
            message:
              'We have a quick update about your booking. Please contact us if you need anything else.',
            guestSelfRescheduleEnabled,
          })
        : null;

    return NextResponse.json({
      messageKey,
      channel,
      lane,
      subject: emailPreview?.subject ?? null,
      html: emailPreview?.html ?? null,
      text: emailPreview?.text ?? smsPreview?.body ?? null,
      previewSampleKind: sampleVariant ?? lane,
    });
  } catch (err) {
    console.error('Preview render failed:', err);
    return NextResponse.json({ error: 'Render failed' }, { status: 500 });
  }
}
