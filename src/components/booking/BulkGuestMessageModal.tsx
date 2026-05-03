'use client';

import { useState } from 'react';
import type { GuestMessageChannel } from '@/lib/booking/guest-message-channel';
import { GuestMessageChannelSelect } from './GuestMessageChannelSelect';

export interface BulkGuestMessageModalProps {
  onClose: () => void;
  recipientCount: number;
  sending: boolean;
  onSend: (message: string, channel: GuestMessageChannel) => void;
  /** Overrides default subtitle (booking-oriented copy). */
  description?: string;
  /** Overrides "Message X guest(s)" when set. */
  title?: string;
}

/** Mount only when shown so form state resets without effects. */
export function BulkGuestMessageModal({
  onClose,
  recipientCount,
  sending,
  onSend,
  description,
  title,
}: BulkGuestMessageModalProps) {
  const [message, setMessage] = useState('');
  const [channel, setChannel] = useState<GuestMessageChannel>('both');

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/30 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      role="presentation"
      onClick={() => !sending && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-guest-msg-title"
        className="max-h-[min(90vh,100dvh)] w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-200/80 bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6 shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100 sm:rounded-2xl sm:pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="bulk-guest-msg-title" className="text-lg font-semibold text-slate-900">
          {title ?? `Message ${recipientCount} guest${recipientCount !== 1 ? 's' : ''}`}
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          {description ??
            'The same message is sent to each selected booking. Guests without the chosen contact method are skipped.'}
        </p>
        <label htmlFor="bulk-guest-channel" className="mt-4 block text-xs font-medium text-slate-600">
          Channel
        </label>
        <div className="mt-1">
          <GuestMessageChannelSelect
            id="bulk-guest-channel"
            value={channel}
            onChange={setChannel}
            disabled={sending}
            className="w-full min-h-[44px] text-xs"
          />
        </div>
        <label htmlFor="bulk-guest-body" className="mt-3 block text-xs font-medium text-slate-600">
          Message
        </label>
        <textarea
          id="bulk-guest-body"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          disabled={sending}
          placeholder="Type your message…"
          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
          autoFocus
        />
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={sending}
            onClick={onClose}
            className="min-h-[44px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={sending || message.trim().length === 0}
            onClick={() => onSend(message.trim(), channel)}
            className="min-h-[44px] rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
