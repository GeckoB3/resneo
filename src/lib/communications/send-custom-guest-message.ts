import type { BookingModel } from '@/types/booking-models';
import type { BookingEmailData, VenueEmailData } from '@/lib/emails/types';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import { sendPolicyMessage } from '@/lib/communications/outbound';
import type { SendCustomBookingMessageResult } from '@/lib/communications/send-custom-booking-message';
import { hasMarketingPermission, marketingSkipReason } from '@/lib/guests/marketing-permission';
import { formatGuestDisplayName } from '@/lib/guests/name';
import type { GuestMessageChannel } from '@/lib/booking/guest-message-channel';

export type SendCustomGuestMessageInput = {
  venueId: string;
  guestId: string;
  message: string;
  channel: GuestMessageChannel;
  /**
   * Bulk sends (contacts selected with the tick boxes) are marketing: only contacts
   * with a recorded consent and no opt-out receive them. One-to-one messages from a
   * contact's own panel are sent regardless, like a phone call would be.
   */
  requireMarketingPermission?: boolean;
};

export type SendCustomGuestMessageResult = SendCustomBookingMessageResult & {
  /** Set when the contact was skipped for lack of marketing permission; nothing was attempted. */
  skippedReason?: string;
};

/**
 * Sends a staff-authored custom message to a guest (contacts / CRM). The message is a
 * plain note: it is never anchored on, and never mentions, any of the guest's bookings.
 * Logged against the guest (communication_logs.guest_id) with no booking.
 */
export async function sendCustomGuestMessage(
  input: SendCustomGuestMessageInput,
): Promise<SendCustomGuestMessageResult> {
  const admin = getSupabaseAdminClient();

  const { data: guestRow, error: guestError } = await admin
    .from('guests')
    .select('id, venue_id, first_name, last_name, email, phone, marketing_consent, marketing_opt_out')
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
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    marketing_consent: boolean | null;
    marketing_opt_out: boolean | null;
  };

  if (input.requireMarketingPermission && !hasMarketingPermission(guest)) {
    return {
      attempted: [],
      skippedReason: marketingSkipReason(guest) ?? 'No marketing permission on file',
    };
  }

  const { data: venueRow, error: venueError } = await admin
    .from('venues')
    .select(
      'name, address, phone, booking_model, email, reply_to_email, timezone, booking_page_config, logo_url, cover_photo_url, website_url, booking_page_url',
    )
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
    booking_page_config: venueRow.booking_page_config ?? null,
    logo_url: venueRow.logo_url ?? null,
    cover_photo_url: venueRow.cover_photo_url ?? null,
    website_url: venueRow.website_url ?? null,
    booking_page_url: venueRow.booking_page_url ?? null,
  });

  const bookingModel: BookingModel =
    ((venueRow as { booking_model?: BookingModel | null }).booking_model as BookingModel | null) ??
    'table_reservation';

  const guestEmail = guest.email?.trim() || null;
  const guestPhone = guest.phone?.trim() || null;

  // The renderer ignores every booking field for custom_message; this shape only
  // satisfies the policy pipeline's contract and carries the recipient details.
  const minimalBooking: BookingEmailData = {
    id: guest.id,
    guest_name: formatGuestDisplayName(guest.first_name, guest.last_name),
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