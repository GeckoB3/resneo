import type { BookingModel } from '@/types/booking-models';
import type { BookingEmailData, VenueEmailData } from '@/lib/emails/types';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import { sendPolicyMessage } from '@/lib/communications/outbound';
import {
  sendCustomBookingMessage,
  type SendCustomBookingMessageResult,
} from '@/lib/communications/send-custom-booking-message';
import type { GuestMessageChannel } from '@/lib/booking/guest-message-channel';

export type SendCustomGuestMessageInput = {
  venueId: string;
  guestId: string;
  message: string;
  channel: GuestMessageChannel;
};

export type SendCustomGuestMessageResult = SendCustomBookingMessageResult;

/**
 * Sends a staff-authored custom message to a guest (contacts / CRM), reusing the same
 * policy + templates as booking-initiated custom messages. Prefer the latest booking as
 * anchor for communication_logs when one exists; otherwise log with guest_id only.
 */
export async function sendCustomGuestMessage(
  input: SendCustomGuestMessageInput,
): Promise<SendCustomGuestMessageResult> {
  const admin = getSupabaseAdminClient();

  const { data: guestRow, error: guestError } = await admin
    .from('guests')
    .select('id, venue_id, name, email, phone')
    .eq('id', input.guestId)
    .eq('venue_id', input.venueId)
    .maybeSingle();

  if (guestError) {
    console.error('[sendCustomGuestMessage] guest lookup failed:', guestError);
    return { attempted: [], error: 'Guest lookup failed' };
  }
  if (!guestRow) {
    return { attempted: [], error: 'Guest not found' };
  }

  const guest = guestRow as {
    id: string;
    venue_id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  };

  const { data: anchorBooking, error: anchorError } = await admin
    .from('bookings')
    .select('id')
    .eq('guest_id', guest.id)
    .eq('venue_id', input.venueId)
    .order('booking_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (anchorError) {
    console.error('[sendCustomGuestMessage] anchor booking lookup failed:', anchorError);
  }

  if (anchorBooking?.id && typeof anchorBooking.id === 'string') {
    return sendCustomBookingMessage({
      venueId: input.venueId,
      bookingId: anchorBooking.id,
      message: input.message,
      channel: input.channel,
    });
  }

  const { data: venueRow, error: venueError } = await admin
    .from('venues')
    .select('name, address, phone, booking_model, email, reply_to_email, timezone')
    .eq('id', input.venueId)
    .maybeSingle();

  if (venueError) {
    console.error('[sendCustomGuestMessage] venue lookup failed:', venueError);
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

  const bookingModel: BookingModel =
    ((venueRow as { booking_model?: BookingModel | null }).booking_model as BookingModel | null) ??
    'table_reservation';

  const guestEmail = guest.email?.trim() || null;
  const guestPhone = guest.phone?.trim() || null;

  const minimalBooking: BookingEmailData = {
    id: guest.id,
    guest_name: guest.name?.trim() || 'Guest',
    guest_email: guestEmail,
    guest_phone: guestPhone,
    booking_date: new Date().toISOString().slice(0, 10),
    booking_time: '00:00:00',
    party_size: 1,
    booking_model: bookingModel,
  };

  const result: SendCustomGuestMessageResult = { attempted: [] };

  const wantsEmail = input.channel === 'email' || input.channel === 'both';
  const wantsSms = input.channel === 'sms' || input.channel === 'both';

  if (wantsEmail) {
    if (!guestEmail) {
      result.email = { sent: false, reason: 'no_email' };
    } else {
      result.attempted.push('email');
      const outcome = await sendPolicyMessage({
        venueId: input.venueId,
        booking: minimalBooking,
        venue,
        messageKey: 'custom_message',
        channel: 'email',
        mode: 'upsert',
        guestIdForLog: guest.id,
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
        booking: minimalBooking,
        venue,
        messageKey: 'custom_message',
        channel: 'sms',
        mode: 'upsert',
        guestIdForLog: guest.id,
        message: input.message,
      });
      result.sms = outcome;
    }
  }

  return result;
}