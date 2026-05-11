import { getSupabaseAdminClient } from '@/lib/supabase';
import type { BookingEmailData, VenueEmailData } from '@/lib/emails/types';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import { sendPolicyMessage } from './outbound';
import type { MessageType, Recipient, TemplateVariables } from './types';
import { sendEmail } from '@/lib/emails/send-email';
import { sendSmsWithSegments } from '@/lib/emails/send-sms';
import { assertSmsSendWithinFreeAccessQuota, estimateSmsSegments, recordOutboundSms } from '@/lib/sms-usage';
import type { BookingModel } from '@/types/booking-models';
import { formatGuestDisplayName } from '@/lib/guests/name';

interface LogContext {
  venue_id?: string;
  booking_id?: string;
  guest_id?: string;
}

interface LegacyCommLogOpts {
  venue_id: string;
  booking_id: string;
  message_type: string;
  channel: 'email' | 'sms';
  recipient: string;
  status: 'pending' | 'sent' | 'failed';
  external_id?: string | null;
  error_message?: string | null;
  communication_lane?: 'table' | 'appointments_other';
}

export async function logToCommLogs(opts: LegacyCommLogOpts): Promise<boolean> {
  try {
    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from('communication_logs')
      .insert({
        venue_id: opts.venue_id,
        booking_id: opts.booking_id,
        communication_lane: opts.communication_lane ?? 'table',
        message_type: opts.message_type,
        channel: opts.channel,
        recipient: opts.recipient,
        status: opts.status,
        external_id: opts.external_id ?? null,
        error_message: opts.error_message ?? null,
        sent_at: opts.status === 'sent' ? new Date().toISOString() : null,
      })
      .select('id')
      .maybeSingle();

    if (error) {
      if (error.code === '23505') return false;
      console.error('[logToCommLogs] insert error:', error);
      return false;
    }
    return Boolean(data);
  } catch (error) {
    console.error('[logToCommLogs] failed:', error);
    return false;
  }
}

export async function updateCommLogStatus(opts: {
  venue_id: string;
  booking_id: string;
  message_type: string;
  status: 'sent' | 'failed';
  external_id?: string | null;
  error_message?: string | null;
  communication_lane?: 'table' | 'appointments_other';
}): Promise<void> {
  try {
    await getSupabaseAdminClient()
      .from('communication_logs')
      .update({
        status: opts.status,
        external_id: opts.external_id ?? null,
        error_message: opts.error_message ?? null,
        sent_at: opts.status === 'sent' ? new Date().toISOString() : null,
      })
      .eq('booking_id', opts.booking_id)
      .eq('message_type', opts.message_type)
      .eq('communication_lane', opts.communication_lane ?? 'table');
  } catch (error) {
    console.error('[updateCommLogStatus] failed:', error);
  }
}

function coercePartySize(value: string | number | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 1;
}

function coerceDepositPence(payload: TemplateVariables): number | null {
  const raw = payload.deposit_amount_pence ?? payload.deposit_amount;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw > 1000 ? raw : Math.round(raw * 100);
  }
  if (typeof raw === 'string') {
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed)) {
      return raw.includes('.') ? Math.round(parsed * 100) : parsed > 1000 ? Math.round(parsed) : Math.round(parsed * 100);
    }
  }
  return null;
}

async function buildGuestBookingContext(
  payload: TemplateVariables,
  recipient: Recipient,
  ctx: LogContext,
): Promise<{ booking: BookingEmailData; venue: VenueEmailData } | null> {
  if (!ctx.venue_id) return null;

  const admin = getSupabaseAdminClient();
  const bookingRow = ctx.booking_id
    ? await admin
        .from('bookings')
        .select(
          'id, venue_id, guest_id, guest_email, booking_date, booking_time, party_size, special_requests, dietary_notes, deposit_amount_pence, deposit_status, cancellation_deadline, experience_event_id, class_instance_id, resource_id',
        )
        .eq('id', ctx.booking_id)
        .maybeSingle()
    : null;

  const bookingData = bookingRow?.data as
    | {
        id: string;
        venue_id: string;
        guest_id: string | null;
        guest_email: string | null;
        booking_date: string;
        booking_time: string;
        party_size: number;
        special_requests: string | null;
        dietary_notes: string | null;
        deposit_amount_pence: number | null;
        deposit_status: string | null;
        cancellation_deadline: string | null;
        experience_event_id?: string | null;
        class_instance_id?: string | null;
        resource_id?: string | null;
      }
    | null;

  const guestId = ctx.guest_id ?? bookingData?.guest_id ?? null;
  const guestRow = guestId
    ? await admin
        .from('guests')
        .select('first_name, last_name, email, phone')
        .eq('id', guestId)
        .maybeSingle()
    : null;

  const venueRow = await admin
    .from('venues')
    .select(
      'name, address, phone, booking_model, email, reply_to_email, logo_url, cover_photo_url, website_url, timezone',
    )
    .eq('id', ctx.venue_id)
    .maybeSingle();

  if (venueRow.error) {
    console.error('[buildGuestBookingContext] venue lookup failed:', venueRow.error);
    return null;
  }

  const venue = venueRow.data as
    | {
        name?: string | null;
        address?: string | null;
        phone?: string | null;
        booking_model?: string | null;
        email?: string | null;
        reply_to_email?: string | null;
        logo_url?: string | null;
        cover_photo_url?: string | null;
        website_url?: string | null;
        timezone?: string | null;
      }
    | null;

  if (!venue?.name) return null;

  const bookingModel =
    bookingData?.experience_event_id
      ? 'event_ticket'
      : bookingData?.class_instance_id
        ? 'class_session'
        : bookingData?.resource_id
          ? 'resource_booking'
          : (venue.booking_model ?? 'table_reservation');

  return {
    booking: {
      id: ctx.booking_id ?? bookingData?.id ?? crypto.randomUUID(),
      guest_name: (() => {
        const gr = guestRow?.data as {
          first_name?: string | null;
          last_name?: string | null;
        } | null;
        const fromDb = formatGuestDisplayName(gr?.first_name, gr?.last_name);
        const fromPayload = typeof payload.guest_name === 'string' ? payload.guest_name : null;
        return fromDb !== 'Guest' ? fromDb : (fromPayload ?? 'Guest');
      })(),
      guest_email:
        recipient.email ??
        (guestRow?.data as { email?: string | null } | null)?.email ??
        bookingData?.guest_email ??
        null,
      guest_phone:
        recipient.phone ??
        (guestRow?.data as { phone?: string | null } | null)?.phone ??
        null,
      booking_date:
        (typeof payload.booking_date === 'string' ? payload.booking_date : null) ??
        bookingData?.booking_date ??
        new Date().toISOString().slice(0, 10),
      booking_time:
        (typeof payload.booking_time === 'string' ? payload.booking_time.slice(0, 5) : null) ??
        bookingData?.booking_time?.slice(0, 5) ??
        '00:00',
      party_size:
        payload.party_size != null
          ? coercePartySize(payload.party_size)
          : bookingData?.party_size ?? 1,
      special_requests:
        (typeof payload.special_requests === 'string'
          ? payload.special_requests
          : null) ?? bookingData?.special_requests ?? null,
      dietary_notes:
        (typeof payload.dietary_notes === 'string'
          ? payload.dietary_notes
          : null) ?? bookingData?.dietary_notes ?? null,
      deposit_amount_pence:
        coerceDepositPence(payload) ?? bookingData?.deposit_amount_pence ?? null,
      deposit_status:
        (typeof payload.deposit_status === 'string' ? payload.deposit_status : null) ??
        bookingData?.deposit_status ??
        null,
      refund_cutoff:
        (typeof payload.cancellation_deadline === 'string'
          ? payload.cancellation_deadline
          : null) ?? bookingData?.cancellation_deadline ?? null,
      manage_booking_link:
        (typeof payload.manage_booking_link === 'string'
          ? payload.manage_booking_link
          : null) ??
        (typeof payload.short_manage_link === 'string'
          ? payload.short_manage_link
          : null) ??
        null,
      booking_model: bookingModel as BookingModel,
    },
    venue: venueRowToEmailData({
      name: venue.name,
      address: venue.address ?? null,
      phone: venue.phone ?? null,
      email: venue.email ?? null,
      reply_to_email: venue.reply_to_email ?? null,
      logo_url: venue.logo_url ?? null,
      cover_photo_url: venue.cover_photo_url ?? null,
      website_url: venue.website_url ?? null,
      timezone: venue.timezone ?? null,
    }),
  };
}

function renderInternalEmail(subject: string, body: string) {
  return {
    subject,
    text: body,
    html: `<html><body style="font-family:Arial,sans-serif;line-height:1.5"><p>${body.replace(/\n/g, '<br/>')}</p></body></html>`,
  };
}

async function sendInternalCustomMessage(
  recipient: Recipient,
  payload: TemplateVariables,
  ctx: LogContext,
): Promise<void> {
  const message = typeof payload.message === 'string' ? payload.message : '';
  const venueName =
    typeof payload.venue_name === 'string' ? payload.venue_name : 'Venue';

  if (recipient.email) {
    const rendered = renderInternalEmail(
      `A message from ${venueName}`,
      message,
    );
    await sendEmail({ to: recipient.email, ...rendered });
  }
  if (recipient.phone) {
    const smsBody = `${venueName}: ${message}`;
    if (ctx.venue_id) {
      const quota = await assertSmsSendWithinFreeAccessQuota({
        venueId: ctx.venue_id,
        additionalSegments: estimateSmsSegments(smsBody),
      });
      if (!quota.ok) {
        console.warn('[sendInternalCustomMessage] SMS blocked:', quota.reason, { venueId: ctx.venue_id });
        return;
      }
    }
    const { sid, segmentCount } = await sendSmsWithSegments(
      recipient.phone,
      smsBody,
    );
    if (sid && ctx.venue_id) {
      await recordOutboundSms({
        venueId: ctx.venue_id,
        bookingId: ctx.booking_id,
        messageType: 'custom_message_sms',
        recipientPhone: recipient.phone,
        twilioSid: sid,
        segmentCount,
      });
    }
  }
}

async function sendDietaryDigest(
  recipient: Recipient,
  payload: TemplateVariables,
): Promise<void> {
  if (!recipient.email) return;
  const venueName =
    typeof payload.venue_name === 'string' ? payload.venue_name : 'Venue';
  const date =
    typeof payload.booking_date === 'string' ? payload.booking_date : 'today';
  const summary =
    typeof payload.dietary_summary === 'string' ? payload.dietary_summary : '';
  const rendered = renderInternalEmail(
    `Dietary summary for ${venueName} on ${date}`,
    summary || 'No dietary notes.',
  );
  await sendEmail({ to: recipient.email, ...rendered });
}

function mapMessageType(type: MessageType) {
  switch (type) {
    case 'deposit_payment_reminder':
      return { key: 'deposit_payment_reminder' as const, mode: 'dedupe' as const };
    case 'auto_cancel_notification':
      return { key: 'auto_cancel_notification' as const, mode: 'dedupe' as const };
    case 'no_show_notification':
      return { key: 'no_show_notification' as const, mode: 'dedupe' as const };
    case 'custom_message':
      return { key: 'custom_message' as const, mode: 'upsert' as const };
    default:
      return null;
  }
}

export class CommunicationService {
  async send(
    type: MessageType,
    recipient: Recipient,
    payload: TemplateVariables,
    ctx: LogContext = {},
  ): Promise<void> {
    if (type === 'dietary_digest') {
      await sendDietaryDigest(recipient, payload);
      return;
    }

    const mapped = mapMessageType(type);
    if (!mapped) return;

    if (type === 'custom_message' && !ctx.guest_id) {
      await sendInternalCustomMessage(recipient, payload, ctx);
      return;
    }

    const context = await buildGuestBookingContext(payload, recipient, ctx);
    if (!context || !ctx.venue_id) return;

    const channels: Array<'email' | 'sms'> = [];
    if (recipient.email) channels.push('email');
    if (recipient.phone) channels.push('sms');

    for (const channel of channels) {
      await sendPolicyMessage({
        venueId: ctx.venue_id,
        booking: context.booking,
        venue: context.venue,
        messageKey: mapped.key,
        channel,
        mode: mapped.mode,
        paymentLink:
          typeof payload.payment_link === 'string' ? payload.payment_link : null,
        confirmLink:
          typeof payload.confirm_link === 'string' ? payload.confirm_link : null,
        cancelLink:
          typeof payload.cancel_link === 'string' ? payload.cancel_link : null,
        message: typeof payload.message === 'string' ? payload.message : null,
        rebookLink:
          context.venue.booking_page_url ?? null,
      });
    }
  }
}

export const communicationService = new CommunicationService();
