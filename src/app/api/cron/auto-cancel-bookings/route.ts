import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { sendCommunication } from '@/lib/communications';
import { sendStaffPush } from '@/lib/communications/staff-push-notification';
import { applyBookingLifecycleStatusEffects, validateBookingStatusTransition } from '@/lib/table-management/lifecycle';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';
import { formatGuestDisplayName } from '@/lib/guests/name';
import { stripe } from '@/lib/stripe';
import { releaseCardHoldsForBookings } from '@/lib/booking/card-hold-release';
import {
  CARD_HOLD_ONLINE_SOURCES,
  CARD_HOLD_STAFF_SOURCES,
  excludeBookingsWithHolds,
  isAbandonedSetupIntentStatus,
  normalizeEmbeddedBooking,
  partitionOnlineHoldCandidates,
} from '@/lib/booking/card-hold-cron';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * GET/POST /api/cron/auto-cancel-bookings
 * Vercel Cron uses GET; POST kept for manual triggers.
 *
 * Four sweeps (card-hold arms: design doc §12.1):
 * 1. Phone deposit sweep (24h): phone bookings still Pending with deposit
 *    Pending, EXCLUDING card-hold bookings (a hold row means card-hold copy,
 *    reason, and release semantics apply, not deposit ones).
 * 2. Staff card-hold arm (24h): phone/walk-in bookings with an open unsaved
 *    hold whose guest never added card details.
 * 3. Online card-hold arm (30m, setup mode): abandoned SetupIntent captures.
 * 4. PI-status sweep (30m): abandoned class carts (unchanged for non-hold
 *    rows) widened to payment_with_setup card-hold units on any online source.
 */
export async function GET(request: NextRequest) {
  return POST(request);
}

export const POST = withCronRunLogging('auto-cancel-bookings', handlePost);

type SweepBooking = {
  id: string;
  venue_id: string;
  guest_id: string;
  booking_date: string;
  booking_time: string;
  party_size: number;
  created_at: string;
};

type HoldJoinRow = {
  booking_id: string;
  stripe_setup_intent_id: string | null;
  stripe_connected_account_id: string;
  booking: SweepBooking & {
    stripe_payment_intent_id: string | null;
    class_instance_id: string | null;
  };
};

/** Guest email/SMS + staff push, shared by the deposit sweep and the staff card-hold arm. */
async function sendAutoCancelNotifications(
  supabase: SupabaseClient,
  booking: SweepBooking,
  opts: { cardHold: boolean },
): Promise<void> {
  const { data: guest } = await supabase
    .from('guests')
    .select('first_name, last_name, email, phone')
    .eq('id', booking.guest_id)
    .single();
  const { data: venue } = await supabase.from('venues').select('name').eq('id', booking.venue_id).single();
  await sendCommunication({
    type: 'auto_cancel_notification',
    venue_id: booking.venue_id,
    booking_id: booking.id,
    recipient: { email: guest?.email ?? undefined, phone: guest?.phone ?? undefined },
    payload: {
      guest_name: formatGuestDisplayName(guest?.first_name, guest?.last_name),
      venue_name: venue?.name,
      booking_date: booking.booking_date,
      booking_time: booking.booking_time,
      party_size: booking.party_size,
      // Card-hold copy variant (§12.1): "because card details were not added
      // in time", never the deposit wording.
      ...(opts.cardHold ? { card_hold: true } : {}),
    },
  });
  try {
    await sendStaffPush(
      {
        id: booking.id,
        guest_name: formatGuestDisplayName(guest?.first_name, guest?.last_name),
        booking_date: booking.booking_date,
        booking_time: booking.booking_time,
      },
      { name: venue?.name ?? null },
      booking.venue_id,
      'payment_failed',
    );
  } catch (pushErr) {
    console.error('auto-cancel staff push failed:', pushErr);
  }
}

async function handlePost(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  try {
    const supabase = getSupabaseAdminClient();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // -----------------------------------------------------------------------
    // Sweep 1: phone deposit timeout (24h). Card-hold bookings are excluded
    // (§12.1): they are handled by sweep 2 with hold release + card-hold copy.
    // -----------------------------------------------------------------------
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

    let depositCandidates = (bookings ?? []) as SweepBooking[];
    if (depositCandidates.length > 0) {
      const { data: holdRows, error: holdErr } = await supabase
        .from('booking_card_holds')
        .select('booking_id')
        .in('booking_id', depositCandidates.map((b) => b.id));
      if (holdErr) {
        console.error('auto-cancel hold lookup failed:', holdErr);
        return NextResponse.json({ error: 'Fetch failed' }, { status: 500 });
      }
      depositCandidates = excludeBookingsWithHolds(
        depositCandidates,
        (holdRows ?? []).map((h) => h.booking_id as string),
      );
    }

    for (const booking of depositCandidates) {
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

    const eventRows = depositCandidates.map((b) => ({
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

    for (const b of depositCandidates) {
      await sendAutoCancelNotifications(supabase, b, { cardHold: false });
    }

    // -----------------------------------------------------------------------
    // Sweep 2: staff card-hold timeout (24h, §12.1). Phone AND walk-in (card
    // holds, unlike deposits, are allowed for walk-ins, D6) with an open
    // unsaved hold. deposit_status stays 'Pending' on the Cancelled row,
    // matching the deposit sweep; the release helper stamps the hold, inserts
    // card_hold_released events, and deletes the booking-scoped customer.
    // -----------------------------------------------------------------------
    let staffHoldCancelled = 0;
    const { data: staffHoldRows, error: staffHoldErr } = await supabase
      .from('booking_card_holds')
      .select(
        'booking_id, stripe_setup_intent_id, stripe_connected_account_id, booking:bookings!inner(id, venue_id, guest_id, booking_date, booking_time, party_size, created_at, stripe_payment_intent_id, class_instance_id)',
      )
      .is('released_at', null)
      .is('stripe_payment_method_id', null)
      .eq('booking.status', 'Pending')
      .eq('booking.deposit_status', 'Pending')
      .in('booking.source', [...CARD_HOLD_STAFF_SOURCES])
      .lt('booking.created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(200);

    if (staffHoldErr) {
      console.error('[auto-cancel] staff card-hold fetch failed:', staffHoldErr);
    } else {
      const staffCandidates = (staffHoldRows ?? [])
        .map((row) => normalizeEmbeddedBooking((row as { booking: unknown }).booking))
        .filter((b): b is HoldJoinRow['booking'] => Boolean(b));

      const cancelledStaff: SweepBooking[] = [];
      for (const booking of staffCandidates) {
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
          .eq('id', booking.id)
          .eq('status', 'Pending');
        if (updateErr) {
          console.error('[auto-cancel] staff card-hold cancel failed:', updateErr, { bookingId: booking.id });
          continue;
        }
        await applyBookingLifecycleStatusEffects(supabase, {
          bookingId: booking.id,
          guestId: booking.guest_id,
          previousStatus: 'Pending',
          nextStatus: 'Cancelled',
          actorId: null,
        });
        cancelledStaff.push(booking);
      }

      if (cancelledStaff.length > 0) {
        const { error: eventErr } = await supabase.from('events').insert(
          cancelledStaff.map((b) => ({
            venue_id: b.venue_id,
            booking_id: b.id,
            event_type: 'auto_cancelled',
            payload: {
              reason: 'card_hold_setup_timeout',
              source: 'auto-cancel-bookings-cron',
              cutoff,
            },
          })),
        );
        if (eventErr) {
          console.error('[auto-cancel] staff card-hold events insert failed:', eventErr);
        }

        try {
          await releaseCardHoldsForBookings(
            supabase,
            cancelledStaff.map((b) => b.id),
            'abandoned',
          );
        } catch (releaseErr) {
          console.error('[auto-cancel] staff card-hold release failed:', releaseErr);
        }

        for (const b of cancelledStaff) {
          await sendAutoCancelNotifications(supabase, b, { cardHold: true });
        }
        staffHoldCancelled = cancelledStaff.length;
      }
    }

    // -----------------------------------------------------------------------
    // Sweep 3 + 4 candidates: online card-hold abandonment (30m, §12.1).
    // Sources are load-bearing: direct flows post booking_page/widget; only
    // class carts post 'online'.
    // -----------------------------------------------------------------------
    const classCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    let onlineHoldCancelled = 0;

    const { data: onlineHoldRows, error: onlineHoldErr } = await supabase
      .from('booking_card_holds')
      .select(
        'booking_id, stripe_setup_intent_id, stripe_connected_account_id, booking:bookings!inner(id, venue_id, guest_id, booking_date, booking_time, party_size, created_at, stripe_payment_intent_id, class_instance_id)',
      )
      .is('released_at', null)
      .is('stripe_payment_method_id', null)
      .eq('booking.status', 'Pending')
      .eq('booking.deposit_status', 'Pending')
      .in('booking.source', [...CARD_HOLD_ONLINE_SOURCES])
      .lt('booking.created_at', classCutoff)
      .order('created_at', { ascending: true })
      .limit(200);

    let onlineHoldCandidates: HoldJoinRow[] = [];
    if (onlineHoldErr) {
      console.error('[auto-cancel] online card-hold fetch failed:', onlineHoldErr);
    } else {
      onlineHoldCandidates = (onlineHoldRows ?? [])
        .map((row) => {
          const booking = normalizeEmbeddedBooking((row as { booking: unknown }).booking) as
            | HoldJoinRow['booking']
            | null;
          if (!booking) return null;
          return {
            booking_id: (row as { booking_id: string }).booking_id,
            stripe_setup_intent_id: (row as { stripe_setup_intent_id: string | null }).stripe_setup_intent_id,
            stripe_connected_account_id: (row as { stripe_connected_account_id: string })
              .stripe_connected_account_id,
            booking,
          } satisfies HoldJoinRow;
        })
        .filter((r): r is HoldJoinRow => r !== null);
    }

    const { setupModeBySetupIntent, paymentWithSetup } =
      partitionOnlineHoldCandidates(onlineHoldCandidates);

    // Sweep 3: setup-mode units. One SI per capture unit; retrieve it on the
    // hold's snapshotted account. requires_payment_method / canceled -> the
    // guest definitively abandoned; requires_action / processing waits.
    for (const [siId, group] of setupModeBySetupIntent.entries()) {
      try {
        const account = group[0]!.stripe_connected_account_id;
        const si = await stripe.setupIntents.retrieve(siId, { stripeAccount: account });
        if (!isAbandonedSetupIntentStatus(si.status)) continue;

        const ids = group.map((r) => r.booking.id);
        const check = validateBookingStatusTransition('Pending', 'Cancelled');
        if (!check.ok) continue;
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
          console.error('[auto-cancel] card-hold setup cancel failed', cancelErr, { siId });
          continue;
        }

        const { error: eventErr } = await supabase.from('events').insert(
          group.map((r) => ({
            venue_id: r.booking.venue_id,
            booking_id: r.booking.id,
            event_type: 'auto_cancelled',
            payload: {
              reason: 'card_hold_setup_abandoned',
              stripe_setup_intent_id: siId,
              stripe_status: si.status,
            },
          })),
        );
        if (eventErr) {
          console.error('[auto-cancel] card-hold setup events insert failed:', eventErr);
        }

        for (const r of group) {
          await applyBookingLifecycleStatusEffects(supabase, {
            bookingId: r.booking.id,
            guestId: r.booking.guest_id,
            previousStatus: 'Pending',
            nextStatus: 'Cancelled',
            actorId: null,
          });
        }

        // Releases the holds and deletes the booking-scoped customer (§12.1).
        try {
          await releaseCardHoldsForBookings(supabase, ids, 'abandoned');
        } catch (releaseErr) {
          console.error('[auto-cancel] card-hold setup release failed:', releaseErr, { siId });
        }

        onlineHoldCancelled += ids.length;
      } catch (err) {
        console.error('[auto-cancel] card-hold si retrieve failed', err, { siId });
      }
    }

    // -----------------------------------------------------------------------
    // Sweep 4: PI-status sweep (plan §4.4 class carts, unchanged for non-hold
    // rows, widened per §12.1 to payment_with_setup card-hold units on any
    // online source). Class seats are scarce: release them within 30 minutes
    // when the Stripe PaymentIntent is in a definitively non-payable state.
    // -----------------------------------------------------------------------
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

    if (classFetchErr) {
      console.error('auto-cancel class fetch failed:', classFetchErr);
    }

    type PiSweepRow = {
      id: string;
      venue_id: string;
      guest_id: string;
      stripe_payment_intent_id: string | null;
      class_instance_id: string | null;
      /** Hold snapshot account when the row is a card-hold unit; null for plain class rows. */
      hold_account: string | null;
    };
    const piSweepRows = new Map<string, PiSweepRow>();
    for (const b of (abandonedClassBookings ?? []) as Array<
      Omit<PiSweepRow, 'hold_account'>
    >) {
      piSweepRows.set(b.id, { ...b, hold_account: null });
    }
    // payment_with_setup card-hold units (hold with NULL SI, booking has the
    // unit's PI). May overlap class rows; the hold's snapshot account wins.
    for (const r of paymentWithSetup) {
      piSweepRows.set(r.booking.id, {
        id: r.booking.id,
        venue_id: r.booking.venue_id,
        guest_id: r.booking.guest_id,
        stripe_payment_intent_id: r.booking.stripe_payment_intent_id,
        class_instance_id: r.booking.class_instance_id,
        hold_account: r.stripe_connected_account_id,
      });
    }

    let classCancelled = 0;
    if (piSweepRows.size > 0) {
      // Group by stripe PI so we make one Stripe lookup per PI.
      const byPi = new Map<string, PiSweepRow[]>();
      for (const b of piSweepRows.values()) {
        if (!b.stripe_payment_intent_id) continue;
        const list = byPi.get(b.stripe_payment_intent_id) ?? [];
        list.push(b);
        byPi.set(b.stripe_payment_intent_id, list);
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
          const holdAccount = group.find((b) => b.hold_account)?.hold_account ?? null;
          const acct = holdAccount ?? (await getVenueAccount(group[0]!.venue_id));
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
            console.error('[auto-cancel] pi sweep cancel failed', cancelErr, { piId });
            continue;
          }

          await supabase.from('events').insert(
            group.map((b) => ({
              venue_id: b.venue_id,
              booking_id: b.id,
              event_type: 'auto_cancelled',
              payload: {
                // Hold units (hold_account set) are card-hold abandonment even
                // when they are class-cart lines (spec §12.1).
                reason: b.hold_account ? 'card_hold_setup_abandoned' : 'class_cart_abandoned',
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

          // Card-hold units in the group get their holds released (and the
          // booking-scoped customer deleted); a no-op for plain class rows.
          try {
            await releaseCardHoldsForBookings(supabase, ids, 'abandoned');
          } catch (releaseErr) {
            console.error('[auto-cancel] pi sweep hold release failed:', releaseErr, { piId });
          }

          classCancelled += ids.length;
        } catch (err) {
          console.error('[auto-cancel] pi sweep retrieve failed', err, { piId });
        }
      }
    }

    return NextResponse.json({
      cancelled: depositCandidates.length,
      staff_hold_cancelled: staffHoldCancelled,
      online_hold_cancelled: onlineHoldCancelled,
      class_cancelled: classCancelled,
    });
  } catch (err) {
    console.error('auto-cancel failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
