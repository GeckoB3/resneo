import type { SupabaseClient } from '@supabase/supabase-js';
import { CRON_COMMS_TOLERANCE_MS, msUntilBookingStartUtc } from '@/lib/cron/comms-timing';
import type { CommunicationChannel, CommunicationMessageKey } from '@/lib/communications/policies';
import {
  getVenueCommunicationPolicies,
  inferCommunicationLaneFromBookingModel,
} from '@/lib/communications/policies';
import type { CommunicationLogMessageType } from '@/lib/communications/policy-resolver';
import type { BookingModel } from '@/types/booking-models';

/** Stored on `import_sessions.session_settings`. Default: true (send due reminders). */
export const SEND_IMPORT_REMINDERS_SESSION_KEY = 'send_import_reminders';

const SCHEDULED_REMINDER_KEYS: CommunicationMessageKey[] = [
  'confirm_or_cancel_prompt',
  'pre_visit_reminder',
];

const LOG_TYPE_BY_CHANNEL: Partial<
  Record<CommunicationMessageKey, Partial<Record<CommunicationChannel, CommunicationLogMessageType>>>
> = {
  confirm_or_cancel_prompt: {
    email: 'confirm_or_cancel_prompt_email',
    sms: 'confirm_or_cancel_prompt_sms',
  },
  pre_visit_reminder: {
    email: 'pre_visit_reminder_email',
    sms: 'pre_visit_reminder_sms',
  },
};

export const IMPORT_SKIP_LOG_REASON = 'import_skip:reminder_window_passed_at_import';

export function parseSendImportRemindersFromSession(
  sessionSettings: Record<string, unknown> | null | undefined,
): boolean {
  const raw = sessionSettings?.[SEND_IMPORT_REMINDERS_SESSION_KEY];
  if (raw === false) return false;
  return true;
}

/** True when the configured reminder window has already ended at import time. */
export function isScheduledReminderWindowPassedAtImport(
  msUntilStart: number,
  hoursBefore: number,
  toleranceMs: number = CRON_COMMS_TOLERANCE_MS,
): boolean {
  const targetMs = hoursBefore * 60 * 60 * 1000;
  return msUntilStart < targetMs - toleranceMs;
}

/**
 * Booking row fields for import. When reminders are enabled, only past/invalid rows stay suppressed.
 * Confirmations are never sent on import (execute does not call confirmation APIs).
 */
export function bookingImportCommsFields(opts: {
  bookingDateYmd: string;
  timeForDb: string;
  sendImportReminders: boolean;
}): { suppress_import_comms: boolean } {
  if (!opts.sendImportReminders) {
    return { suppress_import_comms: true };
  }

  const t = opts.timeForDb.length >= 8 ? opts.timeForDb : `${opts.timeForDb.slice(0, 5)}:00`;
  const start = new Date(`${opts.bookingDateYmd}T${t}`);
  if (Number.isNaN(start.getTime())) {
    return { suppress_import_comms: true };
  }

  if (start.getTime() <= Date.now()) {
    return { suppress_import_comms: true };
  }

  return { suppress_import_comms: false };
}

/**
 * Marks reminder log rows as sent when their send window already passed at import, so cron dedupe
 * does not attempt a retroactive send.
 */
export async function recordImportPassedReminderLogs(
  admin: SupabaseClient,
  opts: {
    venueId: string;
    bookingId: string;
    bookingDateYmd: string;
    bookingTimeForDb: string;
    bookingModel: BookingModel | string | null | undefined;
    venueTimeZone: string;
    recipientEmail: string | null;
    recipientPhone: string | null;
  },
): Promise<void> {
  const policies = await getVenueCommunicationPolicies(opts.venueId);
  const lane = inferCommunicationLaneFromBookingModel(opts.bookingModel);
  const lanePolicies = policies[lane];
  const nowMs = Date.now();
  const msUntil = msUntilBookingStartUtc(
    opts.bookingDateYmd,
    opts.bookingTimeForDb,
    opts.venueTimeZone,
    nowMs,
  );

  const rows: {
    venue_id: string;
    booking_id: string;
    communication_lane: typeof lane;
    message_type: CommunicationLogMessageType;
    channel: CommunicationChannel;
    recipient: string;
    status: 'sent';
    sent_at: string;
    error_message: string;
  }[] = [];

  for (const messageKey of SCHEDULED_REMINDER_KEYS) {
    const policy = lanePolicies[messageKey];
    if (!policy.enabled || policy.hoursBefore == null) continue;
    if (!isScheduledReminderWindowPassedAtImport(msUntil, policy.hoursBefore)) continue;

    for (const channel of policy.channels) {
      const messageType = LOG_TYPE_BY_CHANNEL[messageKey]?.[channel];
      if (!messageType) continue;
      const recipient =
        channel === 'email' ? opts.recipientEmail : channel === 'sms' ? opts.recipientPhone : null;
      if (!recipient?.trim()) continue;

      rows.push({
        venue_id: opts.venueId,
        booking_id: opts.bookingId,
        communication_lane: lane,
        message_type: messageType,
        channel,
        recipient: recipient.trim(),
        status: 'sent',
        sent_at: new Date().toISOString(),
        error_message: IMPORT_SKIP_LOG_REASON,
      });
    }
  }

  if (rows.length === 0) return;

  const { error } = await admin.from('communication_logs').insert(rows);
  if (error && error.code !== '23505') {
    console.error('[recordImportPassedReminderLogs] insert failed:', error, {
      venueId: opts.venueId,
      bookingId: opts.bookingId,
    });
  }
}
