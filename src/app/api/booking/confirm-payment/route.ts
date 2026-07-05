import { NextRequest, NextResponse, after } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { validateBookingStatusTransition } from '@/lib/table-management/lifecycle';
import {
  confirmBookingsForSucceededPaymentIntent,
  confirmBookingsForSucceededSetupIntent,
  sendDepositPaidBookingComms,
} from '@/lib/booking/confirm-deposit-payment';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';

/**
 * POST /api/booking/confirm-payment
 *
 * Called by the client after Stripe.confirmPayment() / Stripe.confirmSetup()
 * succeeds. Accepts exactly one of `payment_intent_id` | `setup_intent_id` |
 * `booking_id` (spec §7.4). Verifies the intent status directly with Stripe
 * and, if succeeded, confirms the booking(s) and sends confirmation comms.
 *
 * This endpoint is the primary confirmation path. The webhook handler is kept
 * as a backup for edge cases (3D Secure redirects, delayed confirmations).
 *
 * No Appointments Light `past_due` guard: same reasoning as GET /api/booking/pay (complete existing deposits).
 */

const BOOKING_SELECT =
  'id, venue_id, guest_id, status, deposit_status, stripe_payment_intent_id, booking_date, booking_time, party_size, cancellation_deadline, deposit_amount_pence, dietary_notes, occasion, confirm_token_hash, source';

type BookingRow = {
  id: string;
  venue_id: string;
  guest_id: string | null;
  status: string;
  deposit_status: string | null;
  stripe_payment_intent_id: string | null;
};

/** Open, unsaved hold row for the setup confirm path (spec §7.4 / §7.7). */
type OpenHoldRow = {
  booking_id: string;
  venue_id: string;
  stripe_setup_intent_id: string | null;
  stripe_connected_account_id: string;
};

const OPEN_HOLD_SELECT = 'booking_id, venue_id, stripe_setup_intent_id, stripe_connected_account_id';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const bookingId = (body.booking_id as string | undefined) || undefined;
    const paymentIntentIdParam = (body.payment_intent_id as string | undefined) || undefined;
    const setupIntentIdParam = (body.setup_intent_id as string | undefined) || undefined;
    const guestEmail = (body.guest_email as string | undefined)?.trim() || null;

    const providedCount = [bookingId, paymentIntentIdParam, setupIntentIdParam].filter(Boolean).length;
    if (providedCount !== 1) {
      return NextResponse.json(
        { error: 'Provide exactly one of booking_id, payment_intent_id or setup_intent_id' },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdminClient();

    // Resolve the lead booking and the intent to verify.
    let booking: BookingRow | null = null;
    let hold: OpenHoldRow | null = null;

    if (bookingId) {
      const { data, error } = await supabase
        .from('bookings')
        .select(BOOKING_SELECT)
        .eq('id', bookingId)
        .single();
      if (error || !data) {
        return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
      }
      booking = data as BookingRow;
    } else if (paymentIntentIdParam) {
      const { data, error } = await supabase
        .from('bookings')
        .select(BOOKING_SELECT)
        .eq('stripe_payment_intent_id', paymentIntentIdParam)
        .limit(1)
        .maybeSingle();
      if (error || !data) {
        return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
      }
      booking = data as BookingRow;
    } else if (setupIntentIdParam) {
      const { data: holdData, error: holdErr } = await supabase
        .from('booking_card_holds')
        .select(OPEN_HOLD_SELECT)
        .eq('stripe_setup_intent_id', setupIntentIdParam)
        .limit(1)
        .maybeSingle();
      if (holdErr || !holdData) {
        return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
      }
      hold = holdData as OpenHoldRow;
      const { data, error } = await supabase
        .from('bookings')
        .select(BOOKING_SELECT)
        .eq('id', hold.booking_id)
        .single();
      if (error || !data) {
        return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
      }
      booking = data as BookingRow;
    }

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    // Already moved past Pending (e.g. by webhook) - return success without
    // re-processing. Both `Booked` and `Confirmed` indicate the payment step
    // completed and the booking is held; only Pending should re-trigger the
    // confirm flow. 'Card Held' is the hold-saved analogue of 'Paid' (spec
    // §7.4 already-confirmed race) and must not fall through to the
    // status-transition validation below.
    if (
      (booking.status === 'Booked' || booking.status === 'Confirmed') &&
      (booking.deposit_status === 'Paid' || booking.deposit_status === 'Card Held')
    ) {
      return NextResponse.json({ confirmed: true, already_confirmed: true });
    }

    // booking_id form: resolve to the booking's PI, or failing that its open
    // unsaved hold's SetupIntent (spec §7.4).
    const usePaymentIntent = Boolean(booking.stripe_payment_intent_id) || Boolean(paymentIntentIdParam);
    if (!usePaymentIntent && !hold) {
      const { data: holdData } = await supabase
        .from('booking_card_holds')
        .select(OPEN_HOLD_SELECT)
        .eq('booking_id', booking.id)
        .is('released_at', null)
        .is('stripe_payment_method_id', null)
        .not('stripe_setup_intent_id', 'is', null)
        .maybeSingle();
      hold = (holdData as OpenHoldRow | null) ?? null;
    }

    if (!usePaymentIntent && !hold?.stripe_setup_intent_id) {
      return NextResponse.json({ error: 'No payment intent linked to this booking' }, { status: 400 });
    }

    // Venue row: comms data for both paths; connected account for the PI path.
    // The SI path uses the hold's snapshotted account instead, so a changed or
    // missing venue account must not fail it (spec §7.7).
    const { data: venue } = await supabase
      .from('venues')
      .select(
        'name, stripe_connected_account_id, address, email, reply_to_email, logo_url, cover_photo_url, website_url, timezone',
      )
      .eq('id', booking.venue_id)
      .single();

    let confirmResult;
    if (usePaymentIntent) {
      if (!venue?.stripe_connected_account_id) {
        return NextResponse.json({ error: 'Venue Stripe account not found' }, { status: 500 });
      }

      const paymentIntentId = paymentIntentIdParam ?? booking.stripe_payment_intent_id!;

      // Verify the PaymentIntent status directly with Stripe on the connected account.
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
        stripeAccount: venue.stripe_connected_account_id,
      });

      if (pi.status !== 'succeeded') {
        return NextResponse.json({
          confirmed: false,
          payment_status: pi.status,
          message: pi.status === 'processing'
            ? 'Payment is still processing. It will be confirmed shortly.'
            : 'Payment has not succeeded yet.',
        });
      }

      const transitionCheck = validateBookingStatusTransition(booking.status, 'Booked');
      if (!transitionCheck.ok) {
        return NextResponse.json({ error: transitionCheck.error }, { status: 400 });
      }

      const paymentMethodId =
        typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method?.id ?? null;

      confirmResult = await confirmBookingsForSucceededPaymentIntent(supabase, {
        paymentIntentId,
        venueId: booking.venue_id,
        guestEmail,
        paymentMethodId,
      });
    } else {
      const setupIntentId = hold!.stripe_setup_intent_id!;

      // Verify the SetupIntent on the hold's snapshotted connected account.
      const si = await stripe.setupIntents.retrieve(setupIntentId, {
        stripeAccount: hold!.stripe_connected_account_id,
      });

      if (si.status !== 'succeeded') {
        return NextResponse.json({
          confirmed: false,
          setup_status: si.status,
          message: si.status === 'processing'
            ? 'Card setup is still processing. It will be confirmed shortly.'
            : 'Card setup has not succeeded yet.',
        });
      }

      const transitionCheck = validateBookingStatusTransition(booking.status, 'Booked');
      if (!transitionCheck.ok) {
        return NextResponse.json({ error: transitionCheck.error }, { status: 400 });
      }

      const paymentMethodId =
        typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id ?? null;

      confirmResult = await confirmBookingsForSucceededSetupIntent(supabase, {
        setupIntentId,
        paymentMethodId,
        venueId: booking.venue_id,
        guestEmail,
      });
    }

    if (!confirmResult.ok) {
      console.error('[confirm-payment] booking confirm failed:', confirmResult.reason, {
        bookingId: booking.id,
      });
      return NextResponse.json({ error: 'Failed to confirm booking after payment' }, { status: 500 });
    }

    if (confirmResult.alreadyConfirmed) {
      console.log('confirm-payment: booking already marked Booked by webhook');
      return NextResponse.json({ confirmed: true, already_confirmed: true });
    }

    const confirmedIds = confirmResult.confirmedIds;

    const { data: guest } = await supabase
      .from('guests')
      .select('first_name, last_name, email, phone')
      .eq('id', booking.guest_id)
      .single();

    const venueData = venueRowToEmailData({
      name: venue?.name ?? 'Venue',
      address: venue?.address ?? null,
      email: venue?.email ?? null,
      reply_to_email: venue?.reply_to_email ?? null,
      logo_url: (venue as { logo_url?: string | null } | null)?.logo_url ?? null,
      cover_photo_url: (venue as { cover_photo_url?: string | null } | null)?.cover_photo_url ?? null,
      website_url: (venue as { website_url?: string | null } | null)?.website_url ?? null,
      timezone: (venue as { timezone?: string | null } | null)?.timezone ?? null,
    });

    const venueIdForAfter = booking.venue_id;
    after(async () => {
      await sendDepositPaidBookingComms(supabase, {
        confirmedIds,
        venueId: venueIdForAfter,
        venueData,
        guest,
        guestEmail,
      });
    });

    return NextResponse.json({ confirmed: true });
  } catch (err) {
    console.error('POST /api/booking/confirm-payment failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
