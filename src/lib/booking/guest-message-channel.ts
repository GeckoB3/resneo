/**
 * Staff-initiated guest message channel for bookings and contacts endpoints.
 */
export type GuestMessageChannel = 'email' | 'sms' | 'both';

/** Result of POST /api/venue/bookings/:id/message — drives inline UI in ExpandedBookingContent. */
export type GuestMessageSendResult =
  | { ok: true; warning?: string }
  | { ok: false; error: string };

export const GUEST_MESSAGE_CHANNEL_OPTIONS: Array<{ value: GuestMessageChannel; label: string }> = [
  { value: 'both', label: 'Email & SMS (if available)' },
  { value: 'email', label: 'Email only' },
  { value: 'sms', label: 'SMS only' },
];
