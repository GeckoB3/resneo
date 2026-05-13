/**
 * Sends booking modification email/SMS via {@link sendBookingModificationNotification}
 * (venue policy applies). Loads current booking guest + venue; used after reschedule PATCH
 * or an explicit POST when notifications were deferred.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { enrichBookingEmailForComms } from '@/lib/emails/booking-email-enrichment';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import type { BookingEmailData } from '@/lib/emails/types';
import { sendBookingModificationNotification } from '@/lib/communications/send-templated';
import { createOrGetBookingShortLink } from '@/lib/booking-short-links';
import { formatGuestDisplayName } from '@/lib/guests/name';

export async function executeBookingModificationGuestNotification(
  admin: SupabaseClient,
  venueId: string,
  bookingId: string,
): Promise<void> {
  const { data: bookingRow, error: bkErr } = await admin
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (bkErr || !bookingRow) {
    console.warn('[executeBookingModificationGuestNotification] booking not found', {
      bookingId,
      venueId,
      bkErr,
    });
    return;
  }

  const guestId = (bookingRow as { guest_id: string }).guest_id;
  const { data: guestRow, error: gErr } = await admin
    .from('guests')
    .select('first_name, last_name, email, phone')
    .eq('id', guestId)
    .maybeSingle();

  const { data: venueRow } = await admin
    .from('venues')
    .select('name, address, phone, email, reply_to_email')
    .eq('id', venueId)
    .single();

  if (gErr || !guestRow || !venueRow?.name) return;

  const br = bookingRow as {
    booking_time: unknown;
    booking_date: string;
    party_size: number;
    deposit_amount_pence?: number | null;
    deposit_status?: string | null;
  };
  const timeStr =
    typeof br.booking_time === 'string' ? String(br.booking_time).slice(0, 5) : '12:00';

  const manageLink = await createOrGetBookingShortLink({
    venueId,
    bookingId,
    purpose: 'manage',
  });

  const bookingEmail: BookingEmailData = {
    id: bookingId,
    guest_name: formatGuestDisplayName(guestRow.first_name, guestRow.last_name),
    guest_email: guestRow.email ?? null,
    guest_phone: guestRow.phone ?? null,
    booking_date: br.booking_date,
    booking_time: timeStr,
    party_size: Number(br.party_size),
    deposit_amount_pence: br.deposit_amount_pence ?? null,
    deposit_status: br.deposit_status ?? null,
    manage_booking_link: manageLink,
  };

  const venueEmailData = venueRowToEmailData({
    name: venueRow.name,
    address: venueRow.address ?? null,
    phone: venueRow.phone ?? null,
    email: venueRow.email ?? null,
    reply_to_email: venueRow.reply_to_email ?? null,
  });

  const enriched = await enrichBookingEmailForComms(admin, bookingId, bookingEmail);
  await sendBookingModificationNotification(enriched, venueEmailData, venueId);
}
