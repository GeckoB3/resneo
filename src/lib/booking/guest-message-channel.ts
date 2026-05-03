/**
 * Staff-initiated guest message channel for bookings and contacts endpoints.
 */
export type GuestMessageChannel = 'email' | 'sms' | 'both';

export const GUEST_MESSAGE_CHANNEL_OPTIONS: Array<{ value: GuestMessageChannel; label: string }> = [
  { value: 'both', label: 'Email & SMS (if available)' },
  { value: 'email', label: 'Email only' },
  { value: 'sms', label: 'SMS only' },
];
