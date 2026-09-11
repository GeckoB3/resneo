'use client';

import type { GuestMessageChannel } from '@/lib/booking/guest-message-channel';

/** Mirrors renderer.ts: three concatenated GSM segments, venue name prefix included. */
export const CUSTOM_SMS_CHAR_BUDGET = 459;
const SMS_SEGMENT_CHARS = 153;

function smsSegments(text: string): number {
  return Math.max(1, Math.ceil(text.length / SMS_SEGMENT_CHARS));
}

/**
 * Small footer under a custom-message textarea: how to make paragraphs, the
 * character count, and (when SMS is a chosen channel) how many texts it will
 * take and whether it will be cut short.
 */
export function GuestMessageComposerHint({
  message,
  channel,
  className = '',
}: {
  message: string;
  channel: GuestMessageChannel;
  className?: string;
}) {
  const trimmed = message.trim();
  const includesSms = channel === 'sms' || channel === 'both';
  const overSms = includesSms && trimmed.length > CUSTOM_SMS_CHAR_BUDGET - 40;
  const segments = smsSegments(trimmed);
  return (
    <div className={`mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[11px] text-slate-500 ${className}`}>
      <span>Press Enter for a new line. Leave a blank line to start a new paragraph.</span>
      <span className={overSms ? 'font-medium text-amber-700' : ''}>
        {trimmed.length} characters
        {includesSms && trimmed.length > 0
          ? ` · about ${segments} text${segments === 1 ? '' : 's'}${overSms ? ' (SMS will be cut short)' : ''}`
          : ''}
      </span>
    </div>
  );
}
