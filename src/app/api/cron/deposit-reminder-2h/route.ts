import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { sendCommunication } from '@/lib/communications';
import { sendCardHoldRequestNotifications } from '@/lib/communications/send-templated';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import { createOrGetPaymentShortLink } from '@/lib/booking-short-links';
import { tryGetPaymentTokenSecret } from '@/lib/payment-token';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';
import { formatGuestDisplayName } from '@/lib/guests/name';
import {
  CARD_HOLD_STAFF_SOURCES,
  excludeBookingsWithHolds,
  normalizeEmbeddedBooking,
} from '@/lib/booking/card-hold-cron';

/**
 * GET/POST /api/cron/deposit-reminder-2h
 * Vercel Cron invokes scheduled paths with HTTP GET; POST kept for manual triggers.
 *
 * Two arms (card-hold arm: design doc §12.2):
 * 1. Deposit reminder: phone booking whose deposit hasn't been paid 2 hours
 *    after creation. Card-hold bookings are EXCLUDED (a hold row has no
 *    deposit_amount_pence, so the deposit template would invent a £5.00
 *    deposit that does not exist).
 * 2. Card-request reminder: phone/walk-in booking with an open unsaved hold
 *    2 hours after creation: regenerate the short link and re-send the
 *    card-request as `card_hold_payment_reminder`.
 */
export async function GET(request: NextRequest) {
  return POST(request);
}

export const POST = withCronRunLogging('deposit-reminder-2h', handlePost);

async function handlePost(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  if (!tryGetPaymentTokenSecret()) {
    console.error('deposit-reminder-2h: PAYMENT_TOKEN_SECRET is not set');
    return NextResponse.json({ error: 'Service misconfigured' }, { status: 503 });
  }

  try {
    const supabase = getSupabaseAdminClient();
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const twoAndHalfHoursAgo = new Date(now.getTime() - 2.5 * 60 * 60 * 1000);

    const { data: bookings } = await supabase
      .from('bookings')
      .select('id, venue_id, guest_id, booking_date, booking_time, party_size, deposit_amount_pence, stripe_payment_intent_id, created_at')
      .eq('source', 'phone')
      .eq('status', 'Pending')
      .eq('deposit_status', 'Pending')
      .gte('created_at', twoAndHalfHoursAgo.toISOString())
      .lte('created_at', twoHoursAgo.toISOString());

    // §12.2: exclude card-hold bookings from the deposit reminder; they get
    // the card-request reminder below instead.
    let depositCandidates = bookings ?? [];
    if (depositCandidates.length > 0) {
      const { data: holdRows, error: holdErr } = await supabase
        .from('booking_card_holds')
        .select('booking_id')
        .in('booking_id', depositCandidates.map((b) => b.id as string));
      if (holdErr) {
        console.error('deposit-reminder-2h hold lookup failed:', holdErr);
        return NextResponse.json({ error: 'Fetch failed' }, { status: 500 });
      }
      depositCandidates = excludeBookingsWithHolds(
        depositCandidates as Array<{ id: string }>,
        (holdRows ?? []).map((h) => h.booking_id as string),
      ) as typeof depositCandidates;
    }

    const origin = process.env.NEXT_PUBLIC_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : request.nextUrl.origin);
    let sent = 0;

    for (const b of depositCandidates) {
      const { data: venue } = await supabase.from('venues').select('name').eq('id', b.venue_id).single();
      const { data: guest } = await supabase
        .from('guests')
        .select('first_name, last_name, phone, email')
        .eq('id', b.guest_id)
        .single();
      if (!guest?.phone && !guest?.email) continue;

      const timeStr = typeof b.booking_time === 'string' ? b.booking_time.slice(0, 5) : '00:00';
      const depositAmount = b.deposit_amount_pence ? (b.deposit_amount_pence / 100).toFixed(2) : '5.00';
      const paymentLink = await createOrGetPaymentShortLink(b.venue_id as string, b.id as string, origin);

      await sendCommunication({
        type: 'deposit_payment_reminder',
        venue_id: b.venue_id,
        booking_id: b.id,
        recipient: { phone: guest.phone ?? undefined, email: guest.email ?? undefined },
        payload: {
          guest_name: formatGuestDisplayName(guest.first_name, guest.last_name),
          venue_name: venue?.name ?? 'Venue',
          booking_date: b.booking_date,
          booking_time: timeStr,
          party_size: b.party_size,
          deposit_amount: depositAmount,
          payment_link: paymentLink,
        },
      });
      sent++;
    }

    // -----------------------------------------------------------------------
    // Card-request reminder arm (§12.2): phone/walk-in booking, still
    // Pending/Pending, with an open unsaved hold, created 2-2.5h ago.
    // -----------------------------------------------------------------------
    let cardHoldSent = 0;
    const { data: holdCandidates, error: holdFetchErr } = await supabase
      .from('booking_card_holds')
      .select(
        'booking_id, fee_pence, booking:bookings!inner(id, venue_id, guest_id, booking_date, booking_time, party_size, created_at)',
      )
      .is('released_at', null)
      .is('stripe_payment_method_id', null)
      .eq('booking.status', 'Pending')
      .eq('booking.deposit_status', 'Pending')
      .in('booking.source', [...CARD_HOLD_STAFF_SOURCES])
      .gte('booking.created_at', twoAndHalfHoursAgo.toISOString())
      .lte('booking.created_at', twoHoursAgo.toISOString())
      .order('created_at', { ascending: true })
      .limit(200);

    if (holdFetchErr) {
      console.error('deposit-reminder-2h card-hold fetch failed:', holdFetchErr);
    } else {
      for (const row of holdCandidates ?? []) {
        const booking = normalizeEmbeddedBooking(
          (row as { booking: unknown }).booking,
        ) as {
          id: string;
          venue_id: string;
          guest_id: string;
          booking_date: string;
          booking_time: string;
          party_size: number;
        } | null;
        const feePence = (row as { fee_pence: number }).fee_pence;
        if (!booking || !feePence) continue;

        const { data: venue } = await supabase
          .from('venues')
          .select('name, address, email, reply_to_email')
          .eq('id', booking.venue_id)
          .single();
        const { data: guest } = await supabase
          .from('guests')
          .select('first_name, last_name, phone, email')
          .eq('id', booking.guest_id)
          .single();
        if (!venue?.name || (!guest?.phone && !guest?.email)) continue;

        const paymentLink = await createOrGetPaymentShortLink(booking.venue_id, booking.id, origin);

        const results = await sendCardHoldRequestNotifications(
          {
            id: booking.id,
            guest_name: formatGuestDisplayName(guest.first_name, guest.last_name),
            guest_email: guest.email ?? null,
            guest_phone: guest.phone ?? null,
            booking_date: booking.booking_date,
            booking_time: booking.booking_time,
            party_size: booking.party_size,
          },
          venueRowToEmailData({
            name: venue.name,
            address: venue.address ?? null,
            email: venue.email ?? null,
            reply_to_email: venue.reply_to_email ?? null,
          }),
          booking.venue_id,
          paymentLink,
          feePence,
          { reminder: true },
        );
        if (results.email.sent || results.sms.sent) cardHoldSent++;
      }
    }

    return NextResponse.json({ sent, card_hold_sent: cardHoldSent });
  } catch (err) {
    console.error('deposit-reminder-2h failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
