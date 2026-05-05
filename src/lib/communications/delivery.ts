import { getSupabaseAdminClient } from '@/lib/supabase';
import { sendEmail } from '@/lib/emails/send-email';
import { sendSmsWithSegments } from '@/lib/emails/send-sms';
import { assertSmsSendWithinFreeAccessQuota, estimateSmsSegments, recordOutboundSms } from '@/lib/sms-usage';
import type { CommunicationLane } from './policies';
import type { CommunicationLogMessageType } from './policy-resolver';
import type { RenderedEmail, RenderedSms } from '@/lib/emails/types';

export interface CommunicationDeliveryContext {
  venueId: string;
  /** Null when logging a CRM-only message (contacts, no booking anchor). */
  bookingId: string | null;
  /** Set with null booking_id for guest-scoped CRM logs in communication_logs.guest_id. */
  guestId?: string | null;
  lane: CommunicationLane;
  messageType: CommunicationLogMessageType;
  recipient: string;
  /** From display name (business name); envelope address is platform SendGrid identity. */
  emailFromDisplayName?: string;
  /** Guest replies route here when set (business inbox from venue profile). */
  emailReplyTo?: string | null;
}

export interface CommunicationSendResult {
  sent: boolean;
  reason?: string;
}

/** `guest_log`: insert communication_logs row with guest_id only (staff CRM). */
export type LogMode = 'dedupe' | 'upsert' | 'guest_log';

async function insertPending(
  ctx: CommunicationDeliveryContext,
  channel: 'email' | 'sms',
): Promise<boolean> {
  if (!ctx.bookingId) {
    console.error('[insertPending] bookingId required');
    return false;
  }
  const admin = getSupabaseAdminClient();
  const { error } = await admin.from('communication_logs').insert({
    venue_id: ctx.venueId,
    booking_id: ctx.bookingId,
    communication_lane: ctx.lane,
    message_type: ctx.messageType,
    channel,
    recipient: ctx.recipient,
    status: 'pending',
  });

  if (!error) return true;
  if (error.code === '23505') return false;
  throw error;
}

async function insertGuestLog(
  ctx: CommunicationDeliveryContext,
  channel: 'email' | 'sms',
): Promise<string | null> {
  if (!ctx.guestId) {
    console.error('[insertGuestLog] guestId required');
    return null;
  }
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from('communication_logs')
    .insert({
      venue_id: ctx.venueId,
      booking_id: null,
      guest_id: ctx.guestId,
      communication_lane: ctx.lane,
      message_type: ctx.messageType,
      channel,
      recipient: ctx.recipient,
      status: 'pending',
    })
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[insertGuestLog] insert failed:', error);
    return null;
  }
  const row = data as { id: string } | null;
  return row?.id ?? null;
}

async function upsertPending(
  ctx: CommunicationDeliveryContext,
  channel: 'email' | 'sms',
): Promise<void> {
  if (!ctx.bookingId) {
    throw new Error('[upsertPending] bookingId required');
  }
  const admin = getSupabaseAdminClient();
  await admin.from('communication_logs').upsert(
    {
      venue_id: ctx.venueId,
      booking_id: ctx.bookingId,
      communication_lane: ctx.lane,
      message_type: ctx.messageType,
      channel,
      recipient: ctx.recipient,
      status: 'pending',
      sent_at: null,
      error_message: null,
      external_id: null,
    },
    { onConflict: 'booking_id,message_type,communication_lane' },
  );
}

async function finalizeStatus(
  ctx: CommunicationDeliveryContext,
  opts: {
    logRowId: string | undefined;
    status: 'sent' | 'failed';
    externalId?: string | null;
    errorMessage?: string | null;
  },
): Promise<void> {
  const admin = getSupabaseAdminClient();
  const patch = {
    status: opts.status,
    external_id: opts.externalId ?? null,
    error_message: opts.errorMessage ?? null,
    sent_at: opts.status === 'sent' ? new Date().toISOString() : null,
  };

  if (opts.logRowId) {
    await admin.from('communication_logs').update(patch).eq('id', opts.logRowId);
    return;
  }

  if (ctx.bookingId) {
    await admin
      .from('communication_logs')
      .update(patch)
      .eq('booking_id', ctx.bookingId)
      .eq('message_type', ctx.messageType)
      .eq('communication_lane', ctx.lane);
    return;
  }

  console.error('[finalizeStatus] no bookingId or logRowId');
}

async function prepareLog(
  ctx: CommunicationDeliveryContext,
  channel: 'email' | 'sms',
  mode: LogMode,
): Promise<{ ok: boolean; logRowId?: string }> {
  if (mode === 'guest_log') {
    const logRowId = await insertGuestLog(ctx, channel);
    return {
      ok: logRowId !== null && logRowId !== '',
      logRowId: logRowId ?? undefined,
    };
  }
  if (mode === 'dedupe') {
    const inserted = await insertPending(ctx, channel);
    return { ok: inserted };
  }
  await upsertPending(ctx, channel);
  return { ok: true };
}

export async function deliverEmailMessage(
  ctx: CommunicationDeliveryContext,
  rendered: RenderedEmail,
  mode: LogMode,
): Promise<CommunicationSendResult> {
  let logRowId: string | undefined;

  if (!process.env.SENDGRID_API_KEY) {
    const detail = 'Email did not send: SENDGRID_API_KEY is not configured on the server.';
    console.warn('[deliverEmailMessage]', detail);
    try {
      const prep = await prepareLog(ctx, 'email', mode);
      logRowId = prep.logRowId;
      if (!prep.ok) return { sent: false, reason: mode === 'guest_log' ? 'send_error' : 'duplicate' };
      await finalizeStatus(ctx, { logRowId, status: 'failed', externalId: null, errorMessage: detail });
    } catch (logErr) {
      console.error('[deliverEmailMessage] failed to log comm_log:', logErr);
    }
    return { sent: false, reason: 'not_configured' };
  }

  try {
    const prep = await prepareLog(ctx, 'email', mode);
    logRowId = prep.logRowId;
    if (!prep.ok && mode !== 'upsert')
      return { sent: false, reason: mode === 'guest_log' ? 'send_error' : 'duplicate' };

    const externalId = await sendEmail({
      to: ctx.recipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      fromDisplayName: ctx.emailFromDisplayName,
      replyTo: ctx.emailReplyTo ?? null,
    });
    await finalizeStatus(ctx, { logRowId, status: 'sent', externalId });
    return { sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[deliverEmailMessage] failed:', error);
    await finalizeStatus(ctx, { logRowId, status: 'failed', externalId: null, errorMessage: message });
    return { sent: false, reason: 'send_error' };
  }
}

export async function deliverSmsMessage(
  ctx: CommunicationDeliveryContext,
  rendered: RenderedSms,
  mode: LogMode,
): Promise<CommunicationSendResult> {
  let logRowId: string | undefined;

  if (
    !process.env.TWILIO_PHONE_NUMBER ||
    !process.env.TWILIO_ACCOUNT_SID ||
    !process.env.TWILIO_AUTH_TOKEN
  ) {
    const detail = 'SMS did not send: Twilio is not configured on the server (TWILIO_* env vars missing).';
    console.warn('[deliverSmsMessage]', detail);
    try {
      const prep = await prepareLog(ctx, 'sms', mode);
      logRowId = prep.logRowId;
      if (!prep.ok) return { sent: false, reason: mode === 'guest_log' ? 'send_error' : 'duplicate' };
      await finalizeStatus(ctx, { logRowId, status: 'failed', externalId: null, errorMessage: detail });
    } catch (logErr) {
      console.error('[deliverSmsMessage] failed to log comm_log:', logErr);
    }
    return { sent: false, reason: 'not_configured' };
  }

  try {
    const prep = await prepareLog(ctx, 'sms', mode);
    logRowId = prep.logRowId;
    if (!prep.ok && mode !== 'upsert')
      return { sent: false, reason: mode === 'guest_log' ? 'send_error' : 'duplicate' };

    const quota = await assertSmsSendWithinFreeAccessQuota({
      venueId: ctx.venueId,
      additionalSegments: estimateSmsSegments(rendered.body),
    });
    if (!quota.ok) {
      await finalizeStatus(ctx, { logRowId, status: 'failed', externalId: null, errorMessage: quota.reason });
      return { sent: false, reason: 'sms_quota' };
    }

    const { sid, segmentCount } = await sendSmsWithSegments(ctx.recipient, rendered.body);

    if (!sid) {
      const detail =
        'SMS did not send (Twilio not configured, invalid number, or empty message). Check TWILIO_* env vars.';
      await finalizeStatus(ctx, { logRowId, status: 'failed', externalId: null, errorMessage: detail });
      return { sent: false, reason: 'send_error' };
    }

    await finalizeStatus(ctx, { logRowId, status: 'sent', externalId: sid });
    await recordOutboundSms({
      venueId: ctx.venueId,
      bookingId: ctx.bookingId ?? undefined,
      messageType: ctx.messageType,
      recipientPhone: ctx.recipient,
      twilioSid: sid,
      segmentCount,
    });
    return { sent: true };
  } catch (error) {
    const messageErr = error instanceof Error ? error.message : String(error);
    console.error('[deliverSmsMessage] failed:', error);
    await finalizeStatus(ctx, { logRowId, status: 'failed', externalId: null, errorMessage: messageErr });
    return { sent: false, reason: 'send_error' };
  }
}
