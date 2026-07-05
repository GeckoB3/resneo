import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { verifyPaymentLinkToken } from '@/lib/payment-token';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { formatGuestDisplayName } from '@/lib/guests/name';

/**
 * GET /api/booking/pay?t=token
 * Returns the client_secret for the booking's payment link (24h signed token).
 *
 * Two modes (spec CARD_HOLD_DEPOSITS_DESIGN_AND_IMPLEMENTATION section 7.7):
 * - `payment_mode:'payment'`: the booking has a deposit PaymentIntent (existing behaviour).
 * - `payment_mode:'setup'`: the booking has an open unsaved card hold (booking_card_holds
 *   row with released_at IS NULL, stripe_payment_method_id IS NULL and a SetupIntent);
 *   returns the SetupIntent's client_secret plus `card_hold_fee_pence` (capture-unit total).
 *   The SetupIntent is retrieved on the hold row's snapshotted connected account, NOT the
 *   venue's current account, so an account change cannot orphan the link.
 *
 * Eligibility: booking status must be 'Pending' AND (PI present OR open unsaved hold).
 * Anything else 404s; a hold that already saved a card gets the friendlier
 * "This booking is already secured." message.
 *
 * No Appointments Light `past_due` guard: guests must finish in-flight deposit PaymentIntents for
 * bookings created before the venue entered past_due (new bookings are already blocked at create).
 */
export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const rl = checkRateLimit(ip, 'booking-pay', 60, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many requests. Try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

    const token = request.nextUrl.searchParams.get('t');
    if (!token?.trim()) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    const verified = verifyPaymentLinkToken(token);
    if (!verified.ok && verified.reason === 'misconfigured') {
      console.error('GET /api/booking/pay: PAYMENT_TOKEN_SECRET not set');
      return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
    }
    if (!verified.ok) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
    }

    const { bookingId, exp } = verified;
    if (Date.now() > exp || !bookingId) {
      return NextResponse.json({ error: 'Link expired' }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();
    const { data: booking } = await supabase
      .from('bookings')
      .select(
        'id, stripe_payment_intent_id, venue_id, status, booking_date, booking_time, party_size, deposit_amount_pence, guest_email, guest_first_name, guest_last_name, guest_phone, cancellation_deadline, guest_id',
      )
      .eq('id', bookingId)
      .single();

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found or already completed' }, { status: 404 });
    }

    // The hold row (unique per booking) drives both setup-mode eligibility and
    // the "already secured" 404 nicety, so load it whenever it could matter.
    type HoldRow = {
      stripe_connected_account_id: string;
      stripe_setup_intent_id: string | null;
      stripe_payment_method_id: string | null;
      fee_pence: number;
      released_at: string | null;
    };
    let hold: HoldRow | null = null;
    if (booking.status !== 'Pending' || !booking.stripe_payment_intent_id) {
      const { data: holdRow } = await supabase
        .from('booking_card_holds')
        .select('stripe_connected_account_id, stripe_setup_intent_id, stripe_payment_method_id, fee_pence, released_at')
        .eq('booking_id', booking.id)
        .maybeSingle();
      hold = (holdRow as HoldRow | null) ?? null;
    }

    // A hold that already saved a card means the guest finished this link.
    if (hold?.stripe_payment_method_id) {
      return NextResponse.json({ error: 'This booking is already secured.' }, { status: 404 });
    }

    if (booking.status !== 'Pending') {
      return NextResponse.json({ error: 'Booking not found or already completed' }, { status: 404 });
    }

    const openUnsavedHold =
      hold && !hold.released_at && !hold.stripe_payment_method_id && hold.stripe_setup_intent_id ? hold : null;

    if (!booking.stripe_payment_intent_id && !openUnsavedHold) {
      return NextResponse.json({ error: 'Booking not found or already completed' }, { status: 404 });
    }

    const { data: venue } = await supabase
      .from('venues')
      .select('name, stripe_connected_account_id, address')
      .eq('id', booking.venue_id)
      .single();

    // Resolve guest name from guests table if not on booking snapshot
    const b = booking as {
      guest_first_name?: string | null;
      guest_last_name?: string | null;
      guest_email?: string | null;
      guest_id?: string | null;
    };
    let guestName = formatGuestDisplayName(b.guest_first_name, b.guest_last_name);
    let guestEmail = booking.guest_email ?? '';
    if (booking.guest_id) {
      const { data: guest } = await supabase
        .from('guests')
        .select('first_name, last_name, email')
        .eq('id', booking.guest_id)
        .single();
      if (guest) {
        if (!guestName || guestName === 'Guest') {
          guestName = formatGuestDisplayName(guest.first_name, guest.last_name);
        }
        if (!guestEmail) guestEmail = guest.email ?? '';
      }
    }

    const bookingFields = {
      booking_id: booking.id,
      venue_name: venue?.name ?? '',
      venue_address: venue?.address ?? null,
      booking_date: booking.booking_date,
      booking_time: typeof booking.booking_time === 'string' ? booking.booking_time.slice(0, 5) : booking.booking_time,
      party_size: booking.party_size,
      guest_name: guestName,
      guest_email: guestEmail,
      refund_cutoff: booking.cancellation_deadline ?? null,
    };

    if (openUnsavedHold) {
      // Setup mode: retrieve the SI on the hold's snapshotted account. The venue's
      // current account may be missing or changed; that must not 500 here.
      const setupIntent = await stripe.setupIntents.retrieve(openUnsavedHold.stripe_setup_intent_id!, {
        stripeAccount: openUnsavedHold.stripe_connected_account_id,
      });

      if (!setupIntent.client_secret) {
        return NextResponse.json({ error: 'Payment not available' }, { status: 500 });
      }

      // Capture-unit total: sibling rows (group members, cart lines) share the SI;
      // the fee shown to the guest is the sum over the unit's live holds.
      let cardHoldFeePence = openUnsavedHold.fee_pence;
      const { data: siblings } = await supabase
        .from('booking_card_holds')
        .select('fee_pence')
        .eq('stripe_setup_intent_id', openUnsavedHold.stripe_setup_intent_id!)
        .is('released_at', null);
      if (siblings && siblings.length > 0) {
        cardHoldFeePence = siblings.reduce((sum, row) => sum + (row.fee_pence ?? 0), 0);
      }

      return NextResponse.json({
        payment_mode: 'setup',
        client_secret: setupIntent.client_secret,
        stripe_account_id: openUnsavedHold.stripe_connected_account_id,
        card_hold_fee_pence: cardHoldFeePence,
        deposit_amount_pence: null,
        ...bookingFields,
      });
    }

    // Payment mode (existing behaviour): the deposit PI lives on the venue's current account.
    if (!venue?.stripe_connected_account_id) {
      return NextResponse.json({ error: 'Venue payment not configured' }, { status: 500 });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(
      booking.stripe_payment_intent_id!,
      { stripeAccount: venue.stripe_connected_account_id }
    );

    if (!paymentIntent.client_secret) {
      return NextResponse.json({ error: 'Payment not available' }, { status: 500 });
    }

    return NextResponse.json({
      payment_mode: 'payment',
      client_secret: paymentIntent.client_secret,
      stripe_account_id: venue.stripe_connected_account_id,
      deposit_amount_pence: booking.deposit_amount_pence ?? null,
      ...bookingFields,
    });
  } catch (err) {
    console.error('GET /api/booking/pay failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
