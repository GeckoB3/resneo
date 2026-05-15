import { NextRequest, NextResponse, after } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { generateConfirmToken, hashConfirmToken } from '@/lib/confirm-token';
import { validateBookingStatusTransition } from '@/lib/table-management/lifecycle';
import { sendBookingConfirmationNotifications, sendDepositConfirmationEmail } from '@/lib/communications/send-templated';
import { isSelfServeBookingSource } from '@/lib/booking-source';
import { enrichBookingEmailForComms } from '@/lib/emails/booking-email-enrichment';
import { createOrGetBookingShortLink } from '@/lib/booking-short-links';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import { formatGuestDisplayName } from '@/lib/guests/name';

/**
 * POST /api/booking/confirm-payment
 *
 * Called by the client after Stripe.confirmPayment() succeeds. Verifies the
 * PaymentIntent status directly with Stripe and, if succeeded, confirms the
 * booking, sends confirmation comms, and returns the manage booking link.
 *
 * This endpoint is the primary confirmation path. The webhook handler is kept
 * as a backup for edge cases (3D Secure redirects, delayed confirmations).
 *
 * No Appointments Light `past_due` guard: same reasoning as GET /api/booking/pay (complete existing deposits).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const bookingId = body.booking_id as string | undefined;
    const guestEmail = (body.guest_email as string | undefined)?.trim() || null;
    if (!bookingId) {
      return NextResponse.json({ error: 'Missing booking_id' }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();

    const { data: booking, error: bookErr } = await supabase
      .from('bookings')
      .select('id, venue_id, guest_id, status, deposit_status, stripe_payment_intent_id, booking_date, booking_time, party_size, cancellation_deadline, deposit_amount_pence, dietary_notes, occasion, confirm_token_hash, source')
      .eq('id', bookingId)
      .single();

    if (bookErr || !booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    // Already moved past Pending (e.g. by webhook) - return success without re-processing.
    // Both `Booked` and `Confirmed` indicate the deposit has been credited and
    // the booking is held; only Pending should re-trigger the confirm flow.
    if (
      (booking.status === 'Booked' || booking.status === 'Confirmed') &&
      booking.deposit_status === 'Paid'
    ) {
      return NextResponse.json({ confirmed: true, already_confirmed: true });
    }

    if (!booking.stripe_payment_intent_id) {
      return NextResponse.json({ error: 'No payment intent linked to this booking' }, { status: 400 });
    }

    // Retrieve the venue's connected account to query the PaymentIntent.
    const { data: venue } = await supabase
      .from('venues')
      .select(
        'name, stripe_connected_account_id, address, email, reply_to_email, logo_url, cover_photo_url, website_url, timezone',
      )
      .eq('id', booking.venue_id)
      .single();

    if (!venue?.stripe_connected_account_id) {
      return NextResponse.json({ error: 'Venue Stripe account not found' }, { status: 500 });
    }

    // Verify the PaymentIntent status directly with Stripe on the connected account.
    const pi = await stripe.paymentIntents.retrieve(
      booking.stripe_payment_intent_id,
      { stripeAccount: venue.stripe_connected_account_id },
    );

    if (pi.status !== 'succeeded') {
      return NextResponse.json({
        confirmed: false,
        payment_status: pi.status,
        message: pi.status === 'processing'
          ? 'Payment is still processing \u2014 it will be confirmed shortly.'
          : 'Payment has not succeeded yet.',
      });
    }

    const transitionCheck = validateBookingStatusTransition(booking.status as string, 'Booked');
    if (!transitionCheck.ok) {
      return NextResponse.json({ error: transitionCheck.error }, { status: 400 });
    }

    // Payment verified - move every booking row that shares this PaymentIntent
    // from Pending to Booked (group / multi-service deposits store the same PI
    // on each segment). The dedicated `Confirmed` status is only set when the
    // guest or staff explicitly confirms attendance.
    const { data: statusRows } = await supabase
      .from('bookings')
      .update({
        status: 'Booked',
        deposit_status: 'Paid',
        updated_at: new Date().toISOString(),
      })
      .eq('stripe_payment_intent_id', booking.stripe_payment_intent_id)
      .eq('venue_id', booking.venue_id)
      .eq('status', 'Pending')
      .select('id');

    if (!statusRows?.length) {
      console.log('confirm-payment: booking already marked Booked by webhook');
      return NextResponse.json({ confirmed: true, already_confirmed: true });
    }

    const confirmedIds = statusRows.map((r) => r.id).filter(Boolean) as string[];

    // Save guest_email on every row that shares this PaymentIntent (e.g. class multi-session cart).
    if (guestEmail) {
      await supabase
        .from('bookings')
        .update({ guest_email: guestEmail, updated_at: new Date().toISOString() })
        .in('id', confirmedIds);
    }

    // Generate a manage-booking token per row (atomic: only if still null).
    for (const bid of confirmedIds) {
      const candidateToken = generateConfirmToken();
      await supabase
        .from('bookings')
        .update({
          confirm_token_hash: hashConfirmToken(candidateToken),
          updated_at: new Date().toISOString(),
        })
        .eq('id', bid)
        .is('confirm_token_hash', null)
        .select('id');
    }

    const { data: guest } = await supabase
      .from('guests')
      .select('first_name, last_name, email, phone')
      .eq('id', booking.guest_id)
      .single();

    const recipientEmail = guestEmail || guest?.email;
    const venueData = venueRowToEmailData({
      name: venue.name,
      address: venue.address ?? null,
      email: venue.email ?? null,
      reply_to_email: venue.reply_to_email ?? null,
      logo_url: (venue as { logo_url?: string | null }).logo_url ?? null,
      cover_photo_url: (venue as { cover_photo_url?: string | null }).cover_photo_url ?? null,
      website_url: (venue as { website_url?: string | null }).website_url ?? null,
      timezone: (venue as { timezone?: string | null }).timezone ?? null,
    });

    after(async () => {
      for (const bid of confirmedIds) {
        const { data: bRow } = await supabase
          .from('bookings')
          .select(
            'id, booking_model, booking_date, booking_time, party_size, cancellation_deadline, deposit_amount_pence, source, guest_email',
          )
          .eq('id', bid)
          .maybeSingle();
        if (!bRow) continue;

        const manageBookingLink = await createOrGetBookingShortLink({
          venueId: booking.venue_id,
          bookingId: bid,
          purpose: 'manage',
        });
        const bookingTime =
          typeof bRow.booking_time === 'string' ? bRow.booking_time.slice(0, 5) : bRow.booking_time;
        const guestDisplay = formatGuestDisplayName(guest?.first_name, guest?.last_name);
        const bookingData = {
          id: bRow.id,
          guest_name: guestDisplay !== 'Guest' ? guestDisplay : (guestEmail ?? 'Guest'),
          guest_email: recipientEmail ?? null,
          guest_phone: guest?.phone ?? null,
          booking_date: bRow.booking_date,
          booking_time: bookingTime,
          party_size: bRow.party_size,
          deposit_amount_pence: bRow.deposit_amount_pence ?? null,
          deposit_status: 'Paid' as const,
          refund_cutoff: bRow.cancellation_deadline ?? null,
          manage_booking_link: manageBookingLink,
          booking_model: bRow.booking_model,
        };

        try {
          const enriched = await enrichBookingEmailForComms(supabase, bid, bookingData);
          const { email: confEmail, sms: confSms } = await sendBookingConfirmationNotifications(
            enriched,
            venueData,
            booking.venue_id,
          );
          if (!confEmail.sent) console.warn('[after] confirm-payment confirmation email not sent:', confEmail.reason);
          if (!confSms.sent && confSms.reason !== 'skipped' && confSms.reason !== 'no_phone') {
            console.warn('[after] confirm-payment confirmation SMS not sent:', confSms.reason);
          }
        } catch (err) {
          console.error('[after] confirm-payment confirmation notifications failed:', err);
        }

        const skipDepositReceipt = isSelfServeBookingSource(bRow.source as string | null);
        if (recipientEmail && bRow.deposit_amount_pence && !skipDepositReceipt) {
          try {
            const enrichedDep = await enrichBookingEmailForComms(supabase, bid, bookingData);
            const depResult = await sendDepositConfirmationEmail(enrichedDep, venueData, booking.venue_id);
            if (!depResult.sent) console.warn('[after] confirm-payment deposit email not sent:', depResult.reason);
          } catch (err) {
            console.error('[after] confirm-payment deposit email failed:', err);
          }
        }
      }
    });

    return NextResponse.json({ confirmed: true });
  } catch (err) {
    console.error('POST /api/booking/confirm-payment failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
