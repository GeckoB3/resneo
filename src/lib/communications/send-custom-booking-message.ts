import type { BookingModel } from '@/types/booking-models';
import type { BookingEmailData, VenueEmailData } from '@/lib/emails/types';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import { sendPolicyMessage } from './outbound';
import type { GuestMessageChannel } from '@/lib/booking/guest-message-channel';

export type CustomMessageChannel = 'email' | 'sms';

export interface CustomMessageChannelResult {
  sent: boolean;
  reason?: string;
}

export interface SendCustomBookingMessageInput {
  venueId: string;
  bookingId: string;
  message: string;
  channel: GuestMessageChannel;
}

export interface SendCustomBookingMessageResult {
  /** Which channels were attempted; absent entries were not requested or skipped early. */
  attempted: CustomMessageChannel[];
  email?: CustomMessageChannelResult;
  sms?: CustomMessageChannelResult;
  /** Top-level failure (booking/guest/venue not found). Present = no channel was attempted. */
  error?: string;
}

/**
 * Map the `reason` returned by sendPolicyMessage / delivery helpers to a short,
 * staff-facing explanation. Keep these short - they surface in toasts.
 */
function explainReason(reason: string | undefined): string {
  switch (reason) {
    case 'disabled':
      return 'Disabled in Communication settings';
    case 'tier':
      return 'SMS not available on this plan';
    case 'no_email':
      return 'Guest has no email on file';
    case 'no_phone':
      return 'Guest has no phone on file';
    case 'duplicate':
      return 'Already sent';
    case 'send_error':
      return 'Delivery failed (check provider configuration)';
    case 'sms_quota':
      return 'SMS quota exceeded for this billing period';
    default:
      return reason ?? 'Not sent';
  }
}

export function summariseChannelResult(
  result: CustomMessageChannelResult | undefined,
): string | null {
  if (!result) return null;
  if (result.sent) return null;
  return explainReason(result.reason);
}

/**
 * Sends a staff-authored custom message to a booking guest via email and/or SMS.
 * Unlike {@link sendCommunication}, this returns per-channel outcomes so the API /
 * UI can surface provider failures instead of silently reporting success.
 */
export async function sendCustomBookingMessage(
  input: SendCustomBookingMessageInput,
): Promise<SendCustomBookingMessageResult> {
  const admin = getSupabaseAdminClient();

  const { data: bookingRow, error: bookingError } = await admin
    .from('bookings')
    .select(
      'id, venue_id, guest_id, guest_email, booking_date, booking_time, party_size, special_requests, dietary_notes, deposit_amount_pence, deposit_status, cancellation_deadline, booking_model, experience_event_id, class_instance_id, resource_id',
    )
    .eq('id', input.bookingId)
    .eq('venue_id', input.venueId)
    .maybeSingle();

  if (bookingError) {
    console.error('[sendCustomBookingMessage] booking lookup failed:', bookingError);
    return { attempted: [], error: 'Booking lookup failed' };
  }
  if (!bookingRow) {
    return { attempted: [], error: 'Booking not found' };
  }

  const booking = bookingRow as {
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
    booking_model?: BookingModel | null;
    experience_event_id?: string | null;
    class_instance_id?: string | null;
    resource_id?: string | null;
  };

  const { data: guestRow } = booking.guest_id
    ? await admin
        .from('guests')
        .select('name, email, phone')
        .eq('id', booking.guest_id)
        .maybeSingle()
    : { data: null as { name: string | null; email: string | null; phone: string | null } | null };

  const { data: venueRow, error: venueError } = await admin
    .from('venues')
    .select('name, address, phone, booking_model, email, reply_to_email, timezone')
    .eq('id', input.venueId)
    .maybeSingle();

  if (venueError) {
    console.error('[sendCustomBookingMessage] venue lookup failed:', venueError);
    return { attempted: [], error: 'Venue lookup failed' };
  }
  if (!venueRow || typeof venueRow.name !== 'string' || !venueRow.name) {
    return { attempted: [], error: 'Venue not found' };
  }

  const venue: VenueEmailData = venueRowToEmailData({
    name: venueRow.name,
    address: venueRow.address ?? null,
    phone: venueRow.phone ?? null,
    email: venueRow.email ?? null,
    reply_to_email: venueRow.reply_to_email ?? null,
    timezone: venueRow.timezone ?? null,
  });

  const bookingModel: BookingModel = booking.experience_event_id
    ? 'event_ticket'
    : booking.class_instance_id
      ? 'class_session'
      : booking.resource_id
        ? 'resource_booking'
        : ((booking.booking_model as BookingModel | null) ??
          (venueRow.booking_model as BookingModel | null) ??
          'table_reservation');

  const guestEmail =
    guestRow?.email?.trim() ||
    booking.guest_email?.trim() ||
    null;
  const guestPhone = guestRow?.phone?.trim() || null;

  const bookingEmailData: BookingEmailData = {
    id: booking.id,
    guest_name: guestRow?.name?.trim() || 'Guest',
    guest_email: guestEmail,
    guest_phone: guestPhone,
    booking_date: booking.booking_date,
    booking_time: (booking.booking_time ?? '').slice(0, 5),
    party_size: booking.party_size ?? 1,
    special_requests: booking.special_requests,
    dietary_notes: booking.dietary_notes,
    deposit_amount_pence: booking.deposit_amount_pence,
    deposit_status: booking.deposit_status,
    refund_cutoff: booking.cancellation_deadline,
    booking_model: bookingModel,
  };

  const result: SendCustomBookingMessageResult = { attempted: [] };

  const wantsEmail = input.channel === 'email' || input.channel === 'both';
  const wantsSms = input.channel === 'sms' || input.channel === 'both';

  if (wantsEmail) {
    if (!guestEmail) {
      result.email = { sent: false, reason: 'no_email' };
    } else {
      result.attempted.push('email');
      const outcome = await sendPolicyMessage({
        venueId: input.venueId,
        booking: bookingEmailData,
        venue,
        messageKey: 'custom_message',
        channel: 'email',
        mode: 'upsert',
        message: input.message,
      });
      result.email = outcome;
    }
  }

  if (wantsSms) {
    if (!guestPhone) {
      result.sms = { sent: false, reason: 'no_phone' };
    } else {
      result.attempted.push('sms');
      const outcome = await sendPolicyMessage({
        venueId: input.venueId,
        booking: bookingEmailData,
        venue,
        messageKey: 'custom_message',
        channel: 'sms',
        mode: 'upsert',
        message: input.message,
      });
      result.sms = outcome;
    }
  }

  return result;
}
