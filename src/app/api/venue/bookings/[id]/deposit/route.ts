import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { sendDepositRequestNotifications } from '@/lib/communications/send-templated';
import { venueRowToEmailData } from '@/lib/emails/venue-email-data';
import { createOrGetPaymentShortLink } from '@/lib/booking-short-links';
import { formatGuestDisplayName } from '@/lib/guests/name';
import {
  linkedGrantAllowsMutation,
  loadStaffAccessibleBooking,
} from '@/lib/booking/staff-booking-access';
import type { BookingModel } from '@/types/booking-models';

const schema = z.object({
  action: z.enum(['send_payment_link', 'waive', 'record_cash', 'refund']),
  amount_pence: z.number().int().min(0).max(500000).optional(),
});

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

  if (parsed.data.action === 'waive') {
    await admin.from('bookings').update({ deposit_status: 'Waived', updated_at: new Date().toISOString() }).eq('id', id);
    return NextResponse.json({ success: true });
  }

  if (parsed.data.action === 'record_cash') {
    const amountPence = parsed.data.amount_pence ?? booking.deposit_amount_pence ?? 0;
    await admin.from('bookings').update({
      deposit_status: 'Paid',
      deposit_amount_pence: amountPence,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    return NextResponse.json({ success: true });
  }

  if (parsed.data.action === 'refund') {
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

  await admin.from('communication_logs').delete().eq('booking_id', id).eq('message_type', 'deposit_request_sms');
  await admin.from('communication_logs').delete().eq('booking_id', id).eq('message_type', 'deposit_request_email');

  const results = await sendDepositRequestNotifications(
    {
      id,
      guest_name: formatGuestDisplayName(guest.first_name, guest.last_name),
      guest_email: guest.email ?? null,
      guest_phone: guest.phone ?? null,
      booking_date: booking.booking_date as string,
      booking_time: typeof booking.booking_time === 'string' ? booking.booking_time.slice(0, 5) : '',
      booking_model: (booking.booking_model as BookingModel | null | undefined) ?? undefined,
      party_size: booking.party_size as number,
      deposit_amount_pence: booking.deposit_amount_pence ?? null,
    },
    venueRowToEmailData({
      name: venue.name,
      address: venue.address ?? null,
      email: venue.email ?? null,
      reply_to_email: venue.reply_to_email ?? null,
    }),
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
