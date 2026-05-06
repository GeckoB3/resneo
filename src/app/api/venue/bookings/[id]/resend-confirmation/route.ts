import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { generateConfirmToken, hashConfirmToken } from '@/lib/confirm-token';
import { sendBookingConfirmationNotifications } from '@/lib/communications/send-templated';
import { enrichBookingEmailForComms } from '@/lib/emails/booking-email-enrichment';
import { createOrGetBookingShortLink } from '@/lib/booking-short-links';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const staff = await getVenueStaff(supabase);
  if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { id } = await params;
  const admin = getSupabaseAdminClient();

  const { data: booking } = await admin
    .from('bookings')
    .select('id, venue_id, guest_id, booking_date, booking_time, party_size, cancellation_deadline, deposit_amount_pence, deposit_status, dietary_notes, special_requests')
    .eq('id', id)
    .eq('venue_id', staff.venue_id)
    .maybeSingle();
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  const [{ data: guest }, { data: venue }] = await Promise.all([
    admin.from('guests').select('name, email, phone').eq('id', booking.guest_id).maybeSingle(),
    admin.from('venues').select('name, address, email, reply_to_email').eq('id', booking.venue_id).maybeSingle(),
  ]);
  if (!venue?.name || !guest?.email) {
    return NextResponse.json({ error: 'Guest email not available' }, { status: 400 });
  }

  const manageToken = generateConfirmToken();
  await admin
    .from('bookings')
    .update({
      confirm_token_hash: hashConfirmToken(manageToken),
      confirm_token_used_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', booking.id);

  const manageBookingLink = await createOrGetBookingShortLink({
    venueId: staff.venue_id,
    bookingId: booking.id,
    purpose: 'manage',
  });

  // Clear any existing dedup entries so the resend actually fires (email + SMS use separate message types)
  await admin
    .from('communication_logs')
    .delete()
    .eq('booking_id', booking.id)
    .in('message_type', ['booking_confirmation_email', 'booking_confirmation_sms']);

  const basePayload = {
    id: booking.id,
    guest_name: guest.name ?? 'Guest',
    guest_email: guest.email,
    guest_phone: guest.phone ?? null,
    booking_date: booking.booking_date,
    booking_time: booking.booking_time?.slice(0, 5) ?? '00:00',
    party_size: booking.party_size,
    special_requests: booking.special_requests ?? null,
    dietary_notes: booking.dietary_notes ?? null,
    deposit_amount_pence: booking.deposit_amount_pence ?? null,
    deposit_status: booking.deposit_status ?? null,
    manage_booking_link: manageBookingLink,
  };
  const enriched = await enrichBookingEmailForComms(admin, booking.id, basePayload);
  await sendBookingConfirmationNotifications(
    enriched,
    venueRowToEmailData({
      name: venue.name,
      address: venue.address ?? null,
      email: venue.email ?? null,
      reply_to_email: venue.reply_to_email ?? null,
    }),
    staff.venue_id,
  );

  return NextResponse.json({ success: true });
}
