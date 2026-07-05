import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import {
  sendCardHoldRequestNotifications,
  sendDepositRequestNotifications,
} from '@/lib/communications/send-templated';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import { createOrGetPaymentShortLink } from '@/lib/booking-short-links';
import { formatGuestDisplayName } from '@/lib/guests/name';
import {
  linkedGrantAllowsMutation,
  loadStaffAccessibleBooking,
} from '@/lib/booking/staff-booking-access';
import {
  applyCardHoldChargeRefund,
  chargeCardHoldNoShowFee,
  type ChargeCardHoldNoShowFeeErrorCode,
} from '@/lib/booking/card-hold-charge';
import { releaseCardHoldsForBookings } from '@/lib/booking/card-hold-release';
import { recordBookingWriteAudit } from '@/lib/linked-accounts/audit';
import type { BookingModel } from '@/types/booking-models';

const schema = z.object({
  action: z.enum(['send_payment_link', 'waive', 'record_cash', 'refund', 'charge_no_show_fee']),
  amount_pence: z.number().int().min(0).max(500000).optional(),
});

/** Hold-row fields the deposit actions need (card_hold deposits §9.2). */
type DepositActionHoldRow = {
  id: string;
  stripe_connected_account_id: string;
  stripe_payment_method_id: string | null;
  fee_pence: number;
  charge_payment_intent_id: string | null;
  charged_pence: number | null;
  released_at: string | null;
};

/** §9.2a result-code -> HTTP status. Card errors are 402 per the spec contract. */
const CHARGE_ERROR_STATUS: Record<ChargeCardHoldNoShowFeeErrorCode, number> = {
  no_card_hold: 404,
  not_no_show: 409,
  invalid_state: 409,
  hold_released: 409,
  hold_expired: 409,
  no_saved_card: 409,
  invalid_amount: 400,
  card_declined: 402,
  authentication_required: 402,
  charge_failed: 502,
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createVenueRouteClient(request);
  const staff = await getVenueStaff(supabase);
  if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  const loaded = await loadStaffAccessibleBooking(staff, id);
  if (!loaded.ok) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }
  if (!linkedGrantAllowsMutation(loaded.ctx.linkedGrant, loaded.ctx.isOwnVenue)) {
    return NextResponse.json(
      { error: 'This link does not allow changing deposits on the other venue’s bookings.' },
      { status: 403 },
    );
  }

  const admin = getSupabaseAdminClient();
  const scopeVenueId = loaded.ctx.ownerVenueId;
  const booking = loaded.ctx.booking;

  // Card-hold state drives every action's guards (§9.2b-e): a hold booking
  // must never fall through to the legacy deposit behaviour.
  const { data: holdData, error: holdErr } = await admin
    .from('booking_card_holds')
    .select(
      'id, stripe_connected_account_id, stripe_payment_method_id, fee_pence, charge_payment_intent_id, charged_pence, released_at',
    )
    .eq('booking_id', id)
    .maybeSingle();
  if (holdErr) {
    console.error('[deposit route] hold load failed:', holdErr, { bookingId: id });
    return NextResponse.json({ error: 'Failed to load booking payment state' }, { status: 500 });
  }
  const hold = (holdData ?? null) as DepositActionHoldRow | null;
  const holdIsOpenUnsaved =
    hold != null &&
    hold.released_at == null &&
    hold.stripe_payment_method_id == null &&
    booking.deposit_status === 'Pending';

  if (parsed.data.action === 'charge_no_show_fee') {
    // §9.2a guard 1: admin session. Deliberately no feature-flag guard (§6.1).
    if (!requireAdmin(staff)) {
      return NextResponse.json(
        { code: 'admin_only', message: 'Only admins can charge a no-show fee.' },
        { status: 403 },
      );
    }

    const result = await chargeCardHoldNoShowFee(admin, {
      bookingId: id,
      venueId: scopeVenueId,
      amountPence: parsed.data.amount_pence,
      staffId: staff.id,
    });

    if (!result.ok) {
      return NextResponse.json(
        { code: result.code, message: result.message },
        { status: CHARGE_ERROR_STATUS[result.code] ?? 500 },
      );
    }

    // Cross-venue writes are audited (§9.2a, §11).
    if (!loaded.ctx.isOwnVenue && loaded.ctx.linkId) {
      let actorUserId: string | null = null;
      try {
        const { data: authData } = await supabase.auth.getUser();
        actorUserId = authData.user?.id ?? null;
      } catch {
        actorUserId = null;
      }
      await recordBookingWriteAudit({
        admin,
        linkId: loaded.ctx.linkId,
        actingVenueId: staff.venue_id,
        actingUserId: actorUserId,
        owningVenueId: scopeVenueId,
        actionType: 'edited_booking',
        bookingId: id,
        beforeState: booking as Record<string, unknown>,
        afterState: { deposit_status: 'Charged', charged_pence: result.chargedPence },
      });
    }

    return NextResponse.json({
      ok: true,
      charged_pence: result.chargedPence,
      payment_intent_id: result.paymentIntentId,
    });
  }

  if (parsed.data.action === 'waive') {
    if (hold) {
      // §9.2c: only a Pending booking with an open UNSAVED hold can be waived.
      // A saved hold is released only by cancel, refund, or expiry.
      if (!holdIsOpenUnsaved) {
        return NextResponse.json(
          {
            error: 'A saved card hold cannot be waived. It is released when the booking is cancelled, refunded, or expires.',
            code: 'invalid_state',
          },
          { status: 409 },
        );
      }
      await releaseCardHoldsForBookings(admin, [id], 'admin');
      // The hold release above already happened; if the booking flip fails the
      // reminder cron could re-target a Pending booking with a dead hold, so
      // surface the failure. Re-running waive is safe: release is idempotent.
      const { error: waiveErr } = await admin
        .from('bookings')
        .update({ deposit_status: 'Waived', updated_at: new Date().toISOString() })
        .eq('id', id);
      if (waiveErr) {
        console.error('[deposit route] waive booking update failed:', waiveErr, { bookingId: id });
        return NextResponse.json(
          { error: 'The card request could not be waived. Please try again.' },
          { status: 500 },
        );
      }
      return NextResponse.json({ success: true });
    }
    await admin.from('bookings').update({ deposit_status: 'Waived', updated_at: new Date().toISOString() }).eq('id', id);
    return NextResponse.json({ success: true });
  }

  if (parsed.data.action === 'record_cash') {
    // §9.2d: never on a hold booking; it would fabricate a paid deposit which
    // the no-show path would then "forfeit".
    if (hold) {
      return NextResponse.json(
        {
          error: 'Cash cannot be recorded for a booking with a card hold. No deposit was requested for it.',
          code: 'invalid_state',
        },
        { status: 409 },
      );
    }
    const amountPence = parsed.data.amount_pence ?? booking.deposit_amount_pence ?? 0;
    await admin.from('bookings').update({
      deposit_status: 'Paid',
      deposit_amount_pence: amountPence,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    return NextResponse.json({ success: true });
  }

  if (parsed.data.action === 'refund') {
    if (hold) {
      // §9.2e: refund the charged no-show fee against the hold's own PI on the
      // SNAPSHOTTED connected account (never the venue row, so refunds survive
      // a venue account change). Admin-only (§15).
      if (booking.deposit_status !== 'Charged') {
        return NextResponse.json(
          {
            error: 'There is no charged no-show fee to refund for this booking.',
            code: 'invalid_state',
          },
          { status: 409 },
        );
      }
      if (!requireAdmin(staff)) {
        return NextResponse.json(
          { code: 'admin_only', message: 'Only admins can refund a no-show fee.' },
          { status: 403 },
        );
      }
      if (!hold.charge_payment_intent_id) {
        return NextResponse.json(
          { error: 'No charge was found for this card hold.', code: 'invalid_state' },
          { status: 409 },
        );
      }
      try {
        await stripe.refunds.create(
          { payment_intent: hold.charge_payment_intent_id },
          { stripeAccount: hold.stripe_connected_account_id },
        );
      } catch (refundErr) {
        // Already fully refunded in Stripe (for example via the dashboard):
        // proceed so our state converges with Stripe's. Anything else fails.
        const code = (refundErr as { code?: string } | null)?.code;
        if (code !== 'charge_already_refunded') {
          console.error('[deposit route] hold fee refund failed:', refundErr, { bookingId: id });
          return NextResponse.json(
            { error: 'The refund could not be completed. Please try again.' },
            { status: 502 },
          );
        }
      }
      await applyCardHoldChargeRefund(admin, {
        bookingId: id,
        venueId: scopeVenueId,
        chargedPence: hold.charged_pence,
      });
      return NextResponse.json({ success: true });
    }
    if (!booking.stripe_payment_intent_id) {
      return NextResponse.json({ error: 'No Stripe payment intent found' }, { status: 400 });
    }
    const { data: venue } = await admin
      .from('venues')
      .select('stripe_connected_account_id')
      .eq('id', scopeVenueId)
      .single();
    if (!venue?.stripe_connected_account_id) {
      return NextResponse.json({ error: 'Venue payment account not connected' }, { status: 400 });
    }
    await stripe.refunds.create(
      { payment_intent: booking.stripe_payment_intent_id },
      { stripeAccount: venue.stripe_connected_account_id }
    );
    await admin.from('bookings').update({ deposit_status: 'Refunded', updated_at: new Date().toISOString() }).eq('id', id);
    return NextResponse.json({ success: true });
  }

  // action === 'send_payment_link'
  if (hold) {
    // §9.2b: a released hold can never be re-sent (any release reason).
    if (hold.released_at != null) {
      return NextResponse.json(
        {
          error: 'The card request is no longer active because the hold was released.',
          code: 'hold_released',
        },
        { status: 409 },
      );
    }
    if (!holdIsOpenUnsaved) {
      return NextResponse.json(
        { error: 'The card details are already saved for this booking.', code: 'invalid_state' },
        { status: 409 },
      );
    }
  }

  const { data: guest } = await admin
    .from('guests')
    .select('first_name, last_name, email, phone')
    .eq('id', booking.guest_id)
    .single();
  const { data: venue } = await admin
    .from('venues')
    .select('name, address, email, reply_to_email')
    .eq('id', scopeVenueId)
    .single();
  if (!venue?.name) return NextResponse.json({ error: 'Venue not found' }, { status: 400 });
  if (!guest?.email && !guest?.phone) {
    return NextResponse.json(
      { error: 'Guest needs an email or phone number to send a payment link' },
      { status: 400 },
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || request.nextUrl.origin;
  const paymentLink = await createOrGetPaymentShortLink(scopeVenueId, id, baseUrl);

  const bookingData = {
    id,
    guest_name: formatGuestDisplayName(guest.first_name, guest.last_name),
    guest_email: guest.email ?? null,
    guest_phone: guest.phone ?? null,
    booking_date: booking.booking_date as string,
    booking_time: typeof booking.booking_time === 'string' ? booking.booking_time.slice(0, 5) : '',
    booking_model: (booking.booking_model as BookingModel | null | undefined) ?? undefined,
    party_size: booking.party_size as number,
    deposit_amount_pence: booking.deposit_amount_pence ?? null,
  };
  const venueData = venueRowToEmailData({
    name: venue.name,
    address: venue.address ?? null,
    email: venue.email ?? null,
    reply_to_email: venue.reply_to_email ?? null,
  });

  if (hold) {
    // §9.2b: card-request comms instead of deposit comms. Delete the prior
    // card-request logs so the dedupe layer allows the re-send.
    await admin.from('communication_logs').delete().eq('booking_id', id).eq('message_type', 'card_hold_request_sms');
    await admin.from('communication_logs').delete().eq('booking_id', id).eq('message_type', 'card_hold_request_email');

    const results = await sendCardHoldRequestNotifications(
      bookingData,
      venueData,
      scopeVenueId,
      paymentLink,
      hold.fee_pence,
    );

    if (!results.email.sent && !results.sms.sent) {
      return NextResponse.json(
        {
          error: 'Could not send the card request',
          details: { email: results.email.reason, sms: results.sms.reason },
        },
        { status: 422 },
      );
    }

    return NextResponse.json({ success: true });
  }

  await admin.from('communication_logs').delete().eq('booking_id', id).eq('message_type', 'deposit_request_sms');
  await admin.from('communication_logs').delete().eq('booking_id', id).eq('message_type', 'deposit_request_email');

  const results = await sendDepositRequestNotifications(
    bookingData,
    venueData,
    scopeVenueId,
    paymentLink,
  );

  if (!results.email.sent && !results.sms.sent) {
    return NextResponse.json(
      {
        error: 'Could not send payment link',
        details: { email: results.email.reason, sms: results.sms.reason },
      },
      { status: 422 },
    );
  }

  return NextResponse.json({ success: true });
}
