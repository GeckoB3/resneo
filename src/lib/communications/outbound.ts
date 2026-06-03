import type { BookingEmailData, VenueEmailData } from '@/lib/emails/types';
import type { CommunicationChannel, CommunicationMessageKey } from './policies';
import { resolveCommPolicy } from './policy-resolver';
import { renderCommunicationEmail, renderCommunicationSms } from './renderer';
import { getSupabaseAdminClient } from '@/lib/supabase';
import {
  parseVenueFeatureFlags,
  resolveAppointmentsFeatureFlag,
} from '@/lib/feature-flags';
import {
  deliverEmailMessage,
  deliverSmsMessage,
  type CommunicationSendResult,
  type LogMode,
} from './delivery';

export type { LogMode };

export interface SendPolicyMessageOptions {
  venueId: string;
  booking: BookingEmailData;
  venue: VenueEmailData;
  messageKey: CommunicationMessageKey;
  channel: CommunicationChannel;
  mode: LogMode;
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
  /** Compliance messages (§12): public form URL, form name, link expiry in days. */
  complianceFormLink?: string | null;
  complianceFormName?: string | null;
  complianceExpiryDays?: number | null;
  /** When set, log with guest_id and null booking (contacts CRM / no booking anchor). */
  guestIdForLog?: string;
}

async function fetchVenueCommContext(venueId: string): Promise<{
  bookingModel: string | null;
  guestSelfRescheduleEnabled: boolean;
}> {
  const { data } = await getSupabaseAdminClient()
    .from('venues')
    .select('booking_model, feature_flags')
    .eq('id', venueId)
    .maybeSingle();

  const row = data as { booking_model?: string | null; feature_flags?: unknown } | null;
  const venueFlags = parseVenueFeatureFlags(row?.feature_flags);

  return {
    bookingModel: row?.booking_model ?? null,
    guestSelfRescheduleEnabled: resolveAppointmentsFeatureFlag(
      'guest_self_reschedule',
      venueFlags,
    ),
  };
}

export async function sendPolicyMessage(
  opts: SendPolicyMessageOptions,
): Promise<CommunicationSendResult> {
  const venueComm = await fetchVenueCommContext(opts.venueId);
  const bookingModel = opts.booking.booking_model ?? venueComm.bookingModel;
  const guestSelfRescheduleEnabled = venueComm.guestSelfRescheduleEnabled;
  const resolved = await resolveCommPolicy({
    venueId: opts.venueId,
    messageKey: opts.messageKey,
    bookingModel,
    requestedChannels: [opts.channel],
  });

  if (!resolved.enabled) return { sent: false, reason: 'disabled' };
  if (!resolved.channels.includes(opts.channel)) {
    return {
      sent: false,
      reason: opts.channel === 'sms' ? 'tier' : 'disabled',
    };
  }

  const recipient =
    opts.channel === 'email' ? opts.booking.guest_email : opts.booking.guest_phone;
  if (!recipient) {
    return {
      sent: false,
      reason: opts.channel === 'email' ? 'no_email' : 'no_phone',
    };
  }

  const deliverMode: LogMode = opts.guestIdForLog ? 'guest_log' : opts.mode;

  const deliveryContext = {
    venueId: opts.venueId,
    bookingId: opts.guestIdForLog ? null : opts.booking.id,
    guestId: opts.guestIdForLog ?? null,
    lane: resolved.lane,
    messageType: resolved.logMessageTypeByChannel[opts.channel]!,
    recipient,
    emailFromDisplayName: opts.venue.name,
    emailReplyTo: opts.venue.reply_to_email ?? null,
  };

  if (opts.channel === 'email') {
    const rendered = renderCommunicationEmail({
      lane: resolved.lane,
      messageKey: opts.messageKey,
      booking: opts.booking,
      venue: opts.venue,
      emailCustomMessage: resolved.emailCustomMessage,
      smsCustomMessage: resolved.smsCustomMessage,
      paymentLink: opts.paymentLink ?? null,
      confirmLink: opts.confirmLink ?? null,
      cancelLink: opts.cancelLink ?? null,
      refundMessage: opts.refundMessage ?? null,
      rebookLink: opts.rebookLink ?? null,
      paymentDeadline: opts.paymentDeadline ?? null,
      paymentDeadlineHours: opts.paymentDeadlineHours ?? null,
      durationText: opts.durationText ?? null,
      preAppointmentInstructions: opts.preAppointmentInstructions ?? null,
      cancellationPolicy: opts.cancellationPolicy ?? null,
      changeSummary: opts.changeSummary ?? null,
      message: opts.message ?? null,
      complianceFormLink: opts.complianceFormLink ?? null,
      complianceFormName: opts.complianceFormName ?? null,
      complianceExpiryDays: opts.complianceExpiryDays ?? null,
      guestSelfRescheduleEnabled,
    });
    if (!rendered) return { sent: false, reason: 'disabled' };
    return deliverEmailMessage(deliveryContext, rendered, deliverMode);
  }

  const rendered = renderCommunicationSms({
    lane: resolved.lane,
    messageKey: opts.messageKey,
    booking: opts.booking,
    venue: opts.venue,
    emailCustomMessage: resolved.emailCustomMessage,
    smsCustomMessage: resolved.smsCustomMessage,
    paymentLink: opts.paymentLink ?? null,
    confirmLink: opts.confirmLink ?? null,
    cancelLink: opts.cancelLink ?? null,
    refundMessage: opts.refundMessage ?? null,
    rebookLink: opts.rebookLink ?? null,
    paymentDeadline: opts.paymentDeadline ?? null,
    paymentDeadlineHours: opts.paymentDeadlineHours ?? null,
    durationText: opts.durationText ?? null,
    preAppointmentInstructions: opts.preAppointmentInstructions ?? null,
    cancellationPolicy: opts.cancellationPolicy ?? null,
    changeSummary: opts.changeSummary ?? null,
    message: opts.message ?? null,
    complianceFormLink: opts.complianceFormLink ?? null,
    complianceFormName: opts.complianceFormName ?? null,
    complianceExpiryDays: opts.complianceExpiryDays ?? null,
    guestSelfRescheduleEnabled,
  });
  if (!rendered) return { sent: false, reason: 'disabled' };
  return deliverSmsMessage(deliveryContext, rendered, deliverMode);
}
