'use client';

import {
  GUEST_MESSAGE_CHANNEL_OPTIONS,
  type GuestMessageChannel,
} from '@/lib/booking/guest-message-channel';

export function GuestMessageChannelSelect({
  value,
  onChange,
  id,
  className = '',
  disabled = false,
}: {
  value: GuestMessageChannel;
  onChange: (v: GuestMessageChannel) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as GuestMessageChannel)}
      className={`rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium leading-normal text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50 [&>option]:text-xs [&>option]:font-medium [&>option]:leading-normal [&>option]:text-slate-800 ${className}`}
    >
      {GUEST_MESSAGE_CHANNEL_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
