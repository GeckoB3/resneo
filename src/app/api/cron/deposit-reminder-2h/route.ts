import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { sendCommunication } from '@/lib/communications';
import { createOrGetPaymentShortLink } from '@/lib/booking-short-links';
import { tryGetPaymentTokenSecret } from '@/lib/payment-token';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';
import { formatGuestDisplayName } from '@/lib/guests/name';

/**
 * GET/POST /api/cron/deposit-reminder-2h
 * Vercel Cron invokes scheduled paths with HTTP GET; POST kept for manual triggers.
 * Sends a follow-up if a phone booking deposit hasn't been paid 2 hours after creation.
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

    const origin = process.env.NEXT_PUBLIC_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : request.nextUrl.origin);
    let sent = 0;

    for (const b of bookings ?? []) {
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

    return NextResponse.json({ sent });
  } catch (err) {
    console.error('deposit-reminder-2h failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
