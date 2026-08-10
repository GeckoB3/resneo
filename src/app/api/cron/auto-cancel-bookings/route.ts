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
import { cancelAbandonedPaymentIntent } from '@/lib/booking/cancel-abandoned-payment-intent';
import { selfHealSucceededPaymentIntent } from '@/lib/booking/self-heal-succeeded-payment';
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
 * Sweeps (card-hold arms: design doc §12.1; money widening:
 * deposit-payment-robustness-plan Phase 1):
 * 1. Phone deposit sweep (24h): phone bookings still Pending whose deposit is
 *    still owed ('Pending' OR 'Failed'), EXCLUDING card-hold bookings. The PI
 *    is verified first: a `succeeded` PI self-heals instead of cancelling and
 *    a `processing` one waits.
 * 2. Staff card-hold arm (24h): phone/walk-in bookings with an open unsaved
 *    hold whose guest never added card details.
 * 3. Online card-hold arm (30m, setup mode): abandoned SetupIntent captures.
 * 4. Online money sweep (30m): EVERY online-like money booking (booking_page,
 *    widget, online; all models) still Pending with an owed deposit and a PI
 *    in a definitively unpaid state. Also covers payment_with_setup card-hold
 *    units. Bookings a staff member recently sent a payment link for are
 *    excluded (they follow the 24h phone-style deadline instead, plan D14).
 * 5. No-PI arm (30m): online money rows that never got a PaymentIntent linked;
 *    nothing can ever pay them.
 */
export async function GET(request: NextRequest) {
  return POST(request);
}

export const POST = withCronRunLogging('auto-cancel-bookings', handlePost);

/** Deposit states that still owe the capture (plan 3.4): one failed attempt must not exempt a row. */
const DEPOSIT_OWED_STATUSES = ['Pending', 'Failed'] as const;

/** Staff-sent payment-link comm types that shield a booking from the 30m sweep (plan D14). */
const PAYMENT_LINK_COMM_TYPES = [
  'deposit_request_email',
  'deposit_request_sms',
  'card_hold_request_email',
  'card_hold_request_sms',
] as const;

type SweepBooking = {
  id: string;
  venue_id: string;
  guest_id: string;
  booking_date: string;
  booking_time: string;
  party_size: number;
  created_at: string;
};

type MoneySweepRow = SweepBooking & {
  group_booking_id: string | null;
  stripe_payment_intent_id: string | null;
  class_instance_id: string | null;
  source: string;
  /** Hold snapshot account when the row is a card-hold unit; null otherwise. */
  hold_account: string | null;
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

/** Guest email/SMS + staff push, shared by every cancelling sweep. */
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

/** One notification per capture unit: multi-service/group siblings share the guest. */
function dedupeByCaptureUnit<T extends { id: string; group_booking_id?: string | null }>(
  rows: T[],
): T[] {
  const seen = new Set<string>();
  const leads: T[] = [];
  for (const row of rows) {
    const key = row.group_booking_id ?? row.id;
    if (seen.has(key)) continue;
    seen.add(key);
    leads.push(row);
  }
  return leads;
}

async function handlePost(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  try {
    const supabase = getSupabaseAdminClient();
    const now = Date.now();
    const cutoff = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const classCutoff = new Date(now - 30 * 60 * 1000).toISOString();
    /** requires_action older than this is abandoned (plan M4 backstop). */
    const staleActionCutoff = cutoff;

    const venueAccountCache = new Map<string, string | null>();
    async function getVenueAccount(venueId: string): Promise<string | null> {
      if (venueAccountCache.has(venueId)) return venueAccountCache.get(venueId) ?? null;
      const { data } = await supabase
        .from('venues')
        .select('stripe_connected_account_id')
        .eq('id', venueId)
        .maybeSingle();
      const acct =
        (data as { stripe_connected_account_id?: string | null } | null)
          ?.stripe_connected_account_id ?? null;
      venueAccountCache.set(venueId, acct);
      return acct;
    }

    let selfHealed = 0;

    // -----------------------------------------------------------------------
    // Sweep 1: phone deposit timeout (24h). Card-hold bookings are excluded
    // (§12.1): they are handled by sweep 2 with hold release + card-hold copy.
    // Before cancelling, the PI (when one exists) is verified: `succeeded`
    // self-heals instead of cancelling a paid booking whose webhook and client
    // confirm both failed; `processing` waits for the next run (plan 3.5).
    // -----------------------------------------------------------------------
    const { data: bookings, error: fetchErr } = await supabase
      .from('bookings')
      .select(
        'id, venue_id, guest_id, booking_date, booking_time, party_size, created_at, group_booking_id, stripe_payment_intent_id',
      )
      .eq('status', 'Pending')
      .in('deposit_status', [...DEPOSIT_OWED_STATUSES])
      .eq('source', 'phone')
      .lt('created_at', cutoff);

    if (fetchErr) {
      console.error('auto-cancel fetch failed:', fetchErr);
      return NextResponse.json({ error: 'Fetch failed' }, { status: 500 });
    }

    type PhoneSweepRow = SweepBooking & {
      group_booking_id: string | null;
      stripe_payment_intent_id: string | null;
    };
    let depositCandidates = (bookings ?? []) as PhoneSweepRow[];
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

    // Verify PIs once per intent; drop paid/processing units from the cancel set.
    const phoneRowsToCancel: PhoneSweepRow[] = [];
    const phonePiStatusByIntent = new Map<string, string | null>();
    {
      const byPi = new Map<string, PhoneSweepRow[]>();
      for (const b of depositCandidates) {
        if (!b.stripe_payment_intent_id) {
          phoneRowsToCancel.push(b); // never had a payable intent
          continue;
        }
        const list = byPi.get(b.stripe_payment_intent_id) ?? [];
        list.push(b);
        byPi.set(b.stripe_payment_intent_id, list);
      }
      for (const [piId, group] of byPi.entries()) {
        try {
          const acct = await getVenueAccount(group[0]!.venue_id);
          if (!acct) continue;
          const pi = await stripe.paymentIntents.retrieve(piId, { stripeAccount: acct });
          phonePiStatusByIntent.set(piId, pi.status);
          if (pi.status === 'succeeded') {
            const heal = await selfHealSucceededPaymentIntent(supabase, {
              paymentIntentId: piId,
              venueId: group[0]!.venue_id,
              paymentMethodId:
                typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method?.id ?? null,
              leadBookingId: group[0]!.id,
              source: 'auto-cancel-sweep',
            });
            if (heal.outcome === 'confirmed') selfHealed += heal.confirmedIds.length;
            continue;
          }
          if (pi.status === 'processing') continue;
          // requires_payment_method / requires_confirmation / requires_action /
          // canceled: at 24h these are all abandoned.
          phoneRowsToCancel.push(...group);
        } catch (err) {
          console.error('[auto-cancel] phone sweep PI retrieve failed', err, { piId });
        }
      }
    }

    // Only rows the UPDATE actually flipped get events/lifecycle/notifications:
    // a guest can pay between the fetch above and this loop, and a 0-row match
    // returns no error, so acting on the fetched list would cancel-notify live
    // bookings.
    const depositCancelled: PhoneSweepRow[] = [];
    for (const booking of phoneRowsToCancel) {
      const check = validateBookingStatusTransition('Pending', 'Cancelled');
      if (!check.ok) continue;
      const { data: cancelledRows, error: updateErr } = await supabase
        .from('bookings')
        .update({
          status: 'Cancelled',
          cancellation_actor_type: 'system',
          cancelled_by_staff_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', booking.id)
        .eq('status', 'Pending')
        .select('id');
      if (updateErr) {
        console.error('auto-cancel update failed:', updateErr);
        return NextResponse.json({ error: 'Update failed' }, { status: 500 });
      }
      if (!cancelledRows?.length) continue;
      await applyBookingLifecycleStatusEffects(supabase, {
        bookingId: booking.id,
        guestId: booking.guest_id,
        previousStatus: 'Pending',
        nextStatus: 'Cancelled',
        actorId: null,
      });
      depositCancelled.push(booking);
    }

    const eventRows = depositCancelled.map((b) => ({
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

    // The unit's PI is dead once its rows are cancelled (plan D7): close the
    // pay-after-cancel window instead of relying on reconciliation alerts.
    {
      const cancelledPis = new Set<string>();
      for (const b of depositCancelled) {
        const piId = b.stripe_payment_intent_id;
        if (!piId || cancelledPis.has(piId)) continue;
        cancelledPis.add(piId);
        if (phonePiStatusByIntent.get(piId) === 'canceled') continue;
        await cancelAbandonedPaymentIntent(piId, await getVenueAccount(b.venue_id), {
          sweep: 'phone-deposit',
          bookingId: b.id,
        });
      }
    }

    for (const b of dedupeByCaptureUnit(depositCancelled)) {
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
        const { data: cancelledRows, error: updateErr } = await supabase
          .from('bookings')
          .update({
            status: 'Cancelled',
            cancellation_actor_type: 'system',
            cancelled_by_staff_id: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', booking.id)
          .eq('status', 'Pending')
          .select('id');
        if (updateErr) {
          console.error('[auto-cancel] staff card-hold cancel failed:', updateErr, { bookingId: booking.id });
          continue;
        }
        // 0 rows: the guest added their card (or staff confirmed) between the
        // fetch and this UPDATE. The booking is live; do not release its hold.
        if (!cancelledRows?.length) continue;
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
    // class carts post 'online'. The deposit filter includes 'Failed' because
    // payment_with_setup units share the money PI and a failed attempt flips
    // their rows to 'Failed' (plan 3.4).
    // -----------------------------------------------------------------------
    let onlineHoldCancelled = 0;

    const { data: onlineHoldRows, error: onlineHoldErr } = await supabase
      .from('booking_card_holds')
      .select(
        'booking_id, stripe_setup_intent_id, stripe_connected_account_id, booking:bookings!inner(id, venue_id, guest_id, booking_date, booking_time, party_size, created_at, stripe_payment_intent_id, class_instance_id)',
      )
      .is('released_at', null)
      .is('stripe_payment_method_id', null)
      .eq('booking.status', 'Pending')
      .in('booking.deposit_status', [...DEPOSIT_OWED_STATUSES])
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
        const { data: cancelledRows, error: cancelErr } = await supabase
          .from('bookings')
          .update({
            status: 'Cancelled',
            deposit_status: 'Failed',
            cancellation_actor_type: 'system',
            cancelled_by_staff_id: null,
            updated_at: new Date().toISOString(),
          })
          .in('id', ids)
          .eq('status', 'Pending')
          .select('id');
        if (cancelErr) {
          console.error('[auto-cancel] card-hold setup cancel failed', cancelErr, { siId });
          continue;
        }
        // Scope everything below to rows the UPDATE actually flipped: the
        // guest can confirm the SI between the retrieve above and this UPDATE
        // (the confirm flips rows to Booked/'Card Held'), and a 0-row match is
        // not an error. Acting on the full group would release live holds and
        // fabricate auto_cancelled events for Booked bookings.
        const cancelledIds = new Set((cancelledRows ?? []).map((r) => r.id as string));
        if (cancelledIds.size === 0) continue;
        const cancelledGroup = group.filter((r) => cancelledIds.has(r.booking.id));

        const { error: eventErr } = await supabase.from('events').insert(
          cancelledGroup.map((r) => ({
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

        for (const r of cancelledGroup) {
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
          await releaseCardHoldsForBookings(supabase, [...cancelledIds], 'abandoned');
        } catch (releaseErr) {
          console.error('[auto-cancel] card-hold setup release failed:', releaseErr, { siId });
        }

        onlineHoldCancelled += cancelledIds.size;
      } catch (err) {
        console.error('[auto-cancel] card-hold si retrieve failed', err, { siId });
      }
    }

    // -----------------------------------------------------------------------
    // Sweep 4: online money sweep (plan 3.1). Every online-like money booking
    // (all models: appointments, tables, events, classes, resources, groups)
    // still Pending with an owed deposit and a PI. Widened from the old
    // class-cart-only sweep; class rows keep their event reason. Card-hold
    // payment_with_setup units keep their snapshot account and hold release.
    // -----------------------------------------------------------------------
    const { data: onlineMoneyRows, error: moneyFetchErr } = await supabase
      .from('bookings')
      .select(
        'id, venue_id, guest_id, group_booking_id, stripe_payment_intent_id, class_instance_id, booking_date, booking_time, party_size, source, created_at',
      )
      .eq('status', 'Pending')
      .in('deposit_status', [...DEPOSIT_OWED_STATUSES])
      .in('source', [...CARD_HOLD_ONLINE_SOURCES])
      .not('stripe_payment_intent_id', 'is', null)
      .lt('created_at', classCutoff)
      .limit(200);

    if (moneyFetchErr) {
      console.error('[auto-cancel] online money fetch failed:', moneyFetchErr);
    }

    const moneyRows = new Map<string, MoneySweepRow>();
    for (const b of (onlineMoneyRows ?? []) as Array<Omit<MoneySweepRow, 'hold_account'>>) {
      moneyRows.set(b.id, { ...b, hold_account: null });
    }
    // payment_with_setup card-hold units (hold with NULL SI, booking has the
    // unit's PI). Overlaps the base query; the hold's snapshot account wins.
    for (const r of paymentWithSetup) {
      const base = moneyRows.get(r.booking.id);
      moneyRows.set(r.booking.id, {
        id: r.booking.id,
        venue_id: r.booking.venue_id,
        guest_id: r.booking.guest_id,
        group_booking_id: base?.group_booking_id ?? null,
        stripe_payment_intent_id: r.booking.stripe_payment_intent_id,
        class_instance_id: r.booking.class_instance_id,
        booking_date: r.booking.booking_date,
        booking_time: r.booking.booking_time,
        party_size: r.booking.party_size,
        source: base?.source ?? 'booking_page',
        created_at: r.booking.created_at,
        hold_account: r.stripe_connected_account_id,
      });
    }

    // Plan D14: a staff-sent payment link means the venue is actively chasing
    // this booking; it follows the 24h deadline, not the 30m one.
    if (moneyRows.size > 0) {
      const linkCommCutoff = new Date(now - 24 * 60 * 60 * 1000).toISOString();
      const { data: linkComms, error: linkCommErr } = await supabase
        .from('communication_logs')
        .select('booking_id')
        .in('booking_id', [...moneyRows.keys()])
        .in('message_type', [...PAYMENT_LINK_COMM_TYPES])
        .gte('created_at', linkCommCutoff);
      if (linkCommErr) {
        console.error('[auto-cancel] payment-link comm lookup failed:', linkCommErr);
        // Fail safe: without the exclusion data, skip this sweep run rather
        // than cancel bookings a venue may be actively collecting.
        moneyRows.clear();
      } else {
        for (const row of (linkComms ?? []) as Array<{ booking_id: string | null }>) {
          if (row.booking_id) moneyRows.delete(row.booking_id);
        }
      }
    }

    let onlineMoneyCancelled = 0;
    if (moneyRows.size > 0) {
      // Group by stripe PI so we make one Stripe lookup per capture unit.
      const byPi = new Map<string, MoneySweepRow[]>();
      for (const b of moneyRows.values()) {
        if (!b.stripe_payment_intent_id) continue;
        const list = byPi.get(b.stripe_payment_intent_id) ?? [];
        list.push(b);
        byPi.set(b.stripe_payment_intent_id, list);
      }

      for (const [piId, group] of byPi.entries()) {
        try {
          const holdAccount = group.find((b) => b.hold_account)?.hold_account ?? null;
          const acct = holdAccount ?? (await getVenueAccount(group[0]!.venue_id));
          if (!acct) continue;
          const pi = await stripe.paymentIntents.retrieve(piId, { stripeAccount: acct });

          if (pi.status === 'succeeded') {
            // The webhook and the client confirm both missed a real payment:
            // repair instead of cancelling (plan M3).
            const heal = await selfHealSucceededPaymentIntent(supabase, {
              paymentIntentId: piId,
              venueId: group[0]!.venue_id,
              paymentMethodId:
                typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method?.id ?? null,
              leadBookingId: group[0]!.id,
              source: 'auto-cancel-sweep',
            });
            if (heal.outcome === 'confirmed') selfHealed += heal.confirmedIds.length;
            continue;
          }
          if (pi.status === 'processing') continue;
          if (pi.status === 'requires_action') {
            // In-flight 3DS waits; but a unit stuck at requires_action for 24h
            // is abandoned (plan M4 backstop).
            const oldest = group.reduce(
              (min, b) => (b.created_at < min ? b.created_at : min),
              group[0]!.created_at,
            );
            if (oldest >= staleActionCutoff) continue;
          } else if (
            pi.status !== 'requires_payment_method' &&
            pi.status !== 'canceled' &&
            pi.status !== 'requires_confirmation'
          ) {
            continue;
          }

          const ids = group.map((b) => b.id);
          const { data: cancelledRows, error: cancelErr } = await supabase
            .from('bookings')
            .update({
              status: 'Cancelled',
              deposit_status: 'Failed',
              cancellation_actor_type: 'system',
              cancelled_by_staff_id: null,
              updated_at: new Date().toISOString(),
            })
            .in('id', ids)
            .eq('status', 'Pending')
            .select('id');
          if (cancelErr) {
            console.error('[auto-cancel] online money cancel failed', cancelErr, { piId });
            continue;
          }
          // Same race guard as the setup sweep: the guest can complete payment
          // between the PI retrieve and this UPDATE, so only the rows the
          // UPDATE flipped get events/lifecycle/hold release/notifications.
          const cancelledIds = new Set((cancelledRows ?? []).map((r) => r.id as string));
          if (cancelledIds.size === 0) continue;
          const cancelledGroup = group.filter((b) => cancelledIds.has(b.id));

          await supabase.from('events').insert(
            cancelledGroup.map((b) => ({
              venue_id: b.venue_id,
              booking_id: b.id,
              event_type: 'auto_cancelled',
              payload: {
                // Hold units (hold_account set) are card-hold abandonment even
                // when they are class-cart lines (spec §12.1); class carts keep
                // their historical reason; everything else is the widened
                // online money sweep (plan 3.1).
                reason: b.hold_account
                  ? 'card_hold_setup_abandoned'
                  : b.class_instance_id && b.source === 'online'
                    ? 'class_cart_abandoned'
                    : 'online_payment_abandoned',
                stripe_payment_intent_id: piId,
                stripe_status: pi.status,
              },
            })),
          );

          for (const b of cancelledGroup) {
            await applyBookingLifecycleStatusEffects(supabase, {
              bookingId: b.id,
              guestId: b.guest_id,
              previousStatus: 'Pending',
              nextStatus: 'Cancelled',
              actorId: null,
            });
          }

          // Card-hold units in the group get their holds released (and the
          // booking-scoped customer deleted); a no-op for plain money rows.
          try {
            await releaseCardHoldsForBookings(supabase, [...cancelledIds], 'abandoned');
          } catch (releaseErr) {
            console.error('[auto-cancel] online money hold release failed:', releaseErr, { piId });
          }

          // Plan D7: dead unit, dead intent.
          if (pi.status !== 'canceled') {
            await cancelAbandonedPaymentIntent(piId, acct, { sweep: 'online-money' });
          }

          for (const b of dedupeByCaptureUnit(cancelledGroup)) {
            await sendAutoCancelNotifications(supabase, b, { cardHold: false });
          }

          onlineMoneyCancelled += cancelledIds.size;
        } catch (err) {
          console.error('[auto-cancel] online money PI retrieve failed', err, { piId });
        }
      }
    }

    // -----------------------------------------------------------------------
    // Sweep 5: no-PI arm (plan 3.3). Online money rows that never got a
    // PaymentIntent linked (linkage write failed or an unknown crash path):
    // nothing can ever pay them. The 30m age gate keeps in-flight creates out.
    // -----------------------------------------------------------------------
    let noPiCancelled = 0;
    const { data: noPiRows, error: noPiErr } = await supabase
      .from('bookings')
      .select(
        'id, venue_id, guest_id, group_booking_id, booking_date, booking_time, party_size, created_at',
      )
      .eq('status', 'Pending')
      .eq('deposit_status', 'Pending')
      .gt('deposit_amount_pence', 0)
      .in('source', [...CARD_HOLD_ONLINE_SOURCES])
      .is('stripe_payment_intent_id', null)
      .lt('created_at', classCutoff)
      .limit(200);

    if (noPiErr) {
      console.error('[auto-cancel] no-PI fetch failed:', noPiErr);
    } else {
      const noPiCancelledRows: Array<SweepBooking & { group_booking_id: string | null }> = [];
      for (const booking of (noPiRows ?? []) as Array<
        SweepBooking & { group_booking_id: string | null }
      >) {
        const { data: cancelledRows, error: cancelErr } = await supabase
          .from('bookings')
          .update({
            status: 'Cancelled',
            deposit_status: 'Failed',
            cancellation_actor_type: 'system',
            cancelled_by_staff_id: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', booking.id)
          .eq('status', 'Pending')
          .select('id');
        if (cancelErr) {
          console.error('[auto-cancel] no-PI cancel failed:', cancelErr, { bookingId: booking.id });
          continue;
        }
        if (!cancelledRows?.length) continue;
        await applyBookingLifecycleStatusEffects(supabase, {
          bookingId: booking.id,
          guestId: booking.guest_id,
          previousStatus: 'Pending',
          nextStatus: 'Cancelled',
          actorId: null,
        });
        noPiCancelledRows.push(booking);
      }

      if (noPiCancelledRows.length > 0) {
        const { error: eventErr } = await supabase.from('events').insert(
          noPiCancelledRows.map((b) => ({
            venue_id: b.venue_id,
            booking_id: b.id,
            event_type: 'auto_cancelled',
            payload: {
              reason: 'payment_setup_incomplete',
              source: 'auto-cancel-bookings-cron',
              cutoff: classCutoff,
            },
          })),
        );
        if (eventErr) {
          console.error('[auto-cancel] no-PI events insert failed:', eventErr);
        }
        for (const b of dedupeByCaptureUnit(noPiCancelledRows)) {
          await sendAutoCancelNotifications(supabase, b, { cardHold: false });
        }
        noPiCancelled = noPiCancelledRows.length;
      }
    }

    return NextResponse.json({
      cancelled: depositCancelled.length,
      staff_hold_cancelled: staffHoldCancelled,
      online_hold_cancelled: onlineHoldCancelled,
      online_money_cancelled: onlineMoneyCancelled,
      no_pi_cancelled: noPiCancelled,
      self_healed: selfHealed,
    });
  } catch (err) {
    console.error('auto-cancel failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
