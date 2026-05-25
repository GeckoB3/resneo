import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { sendCommunication } from '@/lib/communications';
import { applyBookingLifecycleStatusEffects, validateBookingStatusTransition } from '@/lib/table-management/lifecycle';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { formatGuestDisplayName } from '@/lib/guests/name';
import { stripe } from '@/lib/stripe';

/**
 * GET/POST /api/cron/auto-cancel-bookings
 * Vercel Cron uses GET; POST kept for manual triggers.
 * Cancels phone bookings still Pending with deposit Pending after 24h.
 */
export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  try {
    const supabase = getSupabaseAdminClient();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: bookings, error: fetchErr } = await supabase
      .from('bookings')
      .select('id, venue_id, guest_id, booking_date, booking_time, party_size, created_at')
      .eq('status', 'Pending')
      .eq('deposit_status', 'Pending')
      .eq('source', 'phone')
      .lt('created_at', cutoff);

    if (fetchErr) {
      console.error('auto-cancel fetch failed:', fetchErr);
      return NextResponse.json({ error: 'Fetch failed' }, { status: 500 });
    }

    const ids = (bookings ?? []).map((b) => b.id);
    if (ids.length === 0) {
      return NextResponse.json({ cancelled: 0 });
    }

    for (const booking of bookings ?? []) {
      const check = validateBookingStatusTransition('Pending', 'Cancelled');
      if (!check.ok) continue;
      const { error: updateErr } = await supabase
        .from('bookings')
        .update({
          status: 'Cancelled',
          cancellation_actor_type: 'system',
          cancelled_by_staff_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', booking.id);
      if (updateErr) {
        console.error('auto-cancel update failed:', updateErr);
        return NextResponse.json({ error: 'Update failed' }, { status: 500 });
      }
      await applyBookingLifecycleStatusEffects(supabase, {
        bookingId: booking.id,
        guestId: booking.guest_id,
        previousStatus: 'Pending',
        nextStatus: 'Cancelled',
        actorId: null,
      });
    }

    const eventRows = (bookings ?? []).map((b) => ({
      venue_id: b.venue_id,
      booking_id: b.id,
      event_type: 'auto_cancelled',
      payload: {
        reason: 'deposit_unpaid_timeout',
        source: 'auto-cancel-bookings-cron',
        cutoff,
      },
    }));
    if (eventRows.length > 0) {
      const { error: eventErr } = await supabase.from('events').insert(eventRows);
      if (eventErr) {
        console.error('auto-cancel events insert failed:', eventErr);
      }
    }

    for (const b of bookings ?? []) {
      const { data: guest } = await supabase
        .from('guests')
        .select('first_name, last_name, email, phone')
        .eq('id', b.guest_id)
        .single();
      const { data: venue } = await supabase.from('venues').select('name').eq('id', b.venue_id).single();
      await sendCommunication({
        type: 'auto_cancel_notification',
        venue_id: b.venue_id,
        booking_id: b.id,
        recipient: { email: guest?.email ?? undefined, phone: guest?.phone ?? undefined },
        payload: {
          guest_name: formatGuestDisplayName(guest?.first_name, guest?.last_name),
          venue_name: venue?.name,
          booking_date: b.booking_date,
          booking_time: b.booking_time,
          party_size: b.party_size,
        },
      });
    }

    // ---------------------------------------------------------------------
    // Plan §4.4 — abandoned class cart auto-cancel.
    // Class seats are scarce — release them within 30 minutes when the Stripe
    // PaymentIntent is in a definitively non-payable state.
    // ---------------------------------------------------------------------
    const classCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: abandonedClassBookings, error: classFetchErr } = await supabase
      .from('bookings')
      .select(
        'id, venue_id, guest_id, group_booking_id, stripe_payment_intent_id, class_instance_id, created_at',
      )
      .eq('status', 'Pending')
      .eq('deposit_status', 'Pending')
      .eq('source', 'online')
      .not('class_instance_id', 'is', null)
      .not('stripe_payment_intent_id', 'is', null)
      .lt('created_at', classCutoff)
      .limit(200);

    let classCancelled = 0;
    if (classFetchErr) {
      console.error('auto-cancel class fetch failed:', classFetchErr);
    } else if ((abandonedClassBookings ?? []).length > 0) {
      // Group by stripe PI so we make one Stripe lookup per PI.
      const byPi = new Map<
        string,
        Array<{
          id: string;
          venue_id: string;
          guest_id: string;
          group_booking_id: string | null;
        }>
      >();
      for (const b of abandonedClassBookings ?? []) {
        const pi = (b as { stripe_payment_intent_id: string | null }).stripe_payment_intent_id;
        if (!pi) continue;
        const list = byPi.get(pi) ?? [];
        list.push(b as { id: string; venue_id: string; guest_id: string; group_booking_id: string | null });
        byPi.set(pi, list);
      }

      const venueAccountCache = new Map<string, string | null>();
      async function getVenueAccount(venueId: string): Promise<string | null> {
        if (venueAccountCache.has(venueId)) return venueAccountCache.get(venueId) ?? null;
        const { data } = await supabase
          .from('venues')
          .select('stripe_connected_account_id')
          .eq('id', venueId)
          .maybeSingle();
        const acct = (data as { stripe_connected_account_id?: string | null } | null)?.stripe_connected_account_id ?? null;
        venueAccountCache.set(venueId, acct);
        return acct;
      }

      for (const [piId, group] of byPi.entries()) {
        try {
          const venueId = group[0]!.venue_id;
          const acct = await getVenueAccount(venueId);
          if (!acct) continue;
          const pi = await stripe.paymentIntents.retrieve(piId, { stripeAccount: acct });
          const definitelyNotPaid =
            pi.status === 'requires_payment_method' ||
            pi.status === 'canceled' ||
            pi.status === 'requires_confirmation';
          if (!definitelyNotPaid) continue;

          const ids = group.map((b) => b.id);
          const { error: cancelErr } = await supabase
            .from('bookings')
            .update({
              status: 'Cancelled',
              deposit_status: 'Failed',
              cancellation_actor_type: 'system',
              cancelled_by_staff_id: null,
              updated_at: new Date().toISOString(),
            })
            .in('id', ids)
            .eq('status', 'Pending');
          if (cancelErr) {
            console.error('[auto-cancel] class cart cancel failed', cancelErr, { piId });
            continue;
          }

          await supabase.from('events').insert(
            group.map((b) => ({
              venue_id: b.venue_id,
              booking_id: b.id,
              event_type: 'auto_cancelled',
              payload: {
                reason: 'class_cart_abandoned',
                stripe_payment_intent_id: piId,
                stripe_status: pi.status,
              },
            })),
          );

          for (const b of group) {
            await applyBookingLifecycleStatusEffects(supabase, {
              bookingId: b.id,
              guestId: b.guest_id,
              previousStatus: 'Pending',
              nextStatus: 'Cancelled',
              actorId: null,
            });
          }

          classCancelled += ids.length;
        } catch (err) {
          console.error('[auto-cancel] class cart pi retrieve failed', err, { piId });
        }
      }
    }

    return NextResponse.json({ cancelled: ids.length, class_cancelled: classCancelled });
  } catch (err) {
    console.error('auto-cancel failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
