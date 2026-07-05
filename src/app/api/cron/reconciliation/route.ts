import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';

/**
 * GET/POST /api/cron/reconciliation
 * Vercel Cron uses GET; POST kept for manual triggers.
 * Compares recent Paid/Refunded bookings to Stripe PaymentIntents; logs reconciliation_alerts.
 * Card holds (design doc §12.4): recent 'Card Held' bookings whose hold is not
 * released must have a succeeded saving intent with an attached payment method;
 * 'Charged' bookings must have a succeeded charge PaymentIntent.
 */
export async function GET(request: NextRequest) {
  return POST(request);
}

export const POST = withCronRunLogging('reconciliation', handlePost);

async function handlePost(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  try {
    const supabase = getSupabaseAdminClient();
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: bookings, error: fetchErr } = await supabase
      .from('bookings')
      .select('id, venue_id, deposit_status, stripe_payment_intent_id')
      .in('deposit_status', ['Paid', 'Refunded'])
      .not('stripe_payment_intent_id', 'is', null)
      .or(`created_at.gte.${cutoff},updated_at.gte.${cutoff}`);

    if (fetchErr) {
      console.error('reconciliation fetch failed:', fetchErr);
      return NextResponse.json({ error: 'Fetch failed' }, { status: 500 });
    }

    if (!bookings?.length) {
      return NextResponse.json({ checked: 0, alerts: 0 });
    }

    const venueIds = [...new Set(bookings.map((b) => b.venue_id))];
    const { data: venues } = await supabase
      .from('venues')
      .select('id, stripe_connected_account_id')
      .in('id', venueIds);
    const venueMap = new Map((venues ?? []).map((v) => [v.id, v.stripe_connected_account_id as string | null]));

    let alerts = 0;
    for (const b of bookings) {
      const accountId = venueMap.get(b.venue_id);
      if (!accountId) continue;

      try {
        const pi = await stripe.paymentIntents.retrieve(
          b.stripe_payment_intent_id!,
          { expand: ['latest_charge'] },
          { stripeAccount: accountId },
        );
        const expectedStatus = b.deposit_status;
        const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
        const refunded = charge?.refunded ?? false;

        if (expectedStatus === 'Paid' && pi.status !== 'succeeded') {
          await supabase.from('reconciliation_alerts').insert({
            booking_id: b.id,
            expected_status: expectedStatus,
            actual_stripe_status: pi.status,
          });
          alerts++;
        } else if (expectedStatus === 'Refunded' && (pi.status !== 'succeeded' || !refunded)) {
          const stripeStatus = refunded ? 'succeeded_refunded' : pi.status;
          await supabase.from('reconciliation_alerts').insert({
            booking_id: b.id,
            expected_status: expectedStatus,
            actual_stripe_status: stripeStatus,
          });
          alerts++;
        }
      } catch (err) {
        console.error('Stripe PI retrieve failed for booking', b.id, err);
        await supabase.from('reconciliation_alerts').insert({
          booking_id: b.id,
          expected_status: b.deposit_status,
          actual_stripe_status: `error: ${err instanceof Error ? err.message : 'unknown'}`,
        });
        alerts++;
      }
    }

    const holdResult = await reconcileCardHolds(supabase, cutoff);

    return NextResponse.json({
      checked: bookings.length + holdResult.checked,
      alerts: alerts + holdResult.alerts,
    });
  } catch (err) {
    console.error('reconciliation cron failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

type HoldReconRow = {
  booking_id: string;
  stripe_setup_intent_id: string | null;
  stripe_connected_account_id: string;
  charge_payment_intent_id: string | null;
  booking: {
    id: string;
    deposit_status: string | null;
    stripe_payment_intent_id: string | null;
  };
};

function normalizeHoldReconRows(rows: unknown[]): HoldReconRow[] {
  const out: HoldReconRow[] = [];
  for (const raw of rows) {
    const r = raw as Omit<HoldReconRow, 'booking'> & {
      booking: HoldReconRow['booking'] | HoldReconRow['booking'][] | null;
    };
    const booking = Array.isArray(r.booking) ? r.booking[0] ?? null : r.booking;
    if (!booking) continue;
    out.push({ ...r, booking });
  }
  return out;
}

/**
 * Card-hold reconciliation (§12.4). 'Card Held' (hold not released): the
 * saving intent is the SetupIntent in setup mode, else the booking's unit PI
 * in payment_with_setup mode; alert when it is not succeeded or its payment
 * method is detached. For the PI case, `pi.payment_method` presence is used as
 * a cheap detachment check: it does not verify the method is still attached to
 * the customer, only that the intent still references one. 'Charged': the
 * charge PaymentIntent must be succeeded. Uses the hold's snapshotted
 * connected account, never the venue's current one.
 */
async function reconcileCardHolds(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  cutoff: string,
): Promise<{ checked: number; alerts: number }> {
  let checked = 0;
  let alerts = 0;

  const insertAlert = async (bookingId: string, expected: string, actual: string) => {
    await supabase.from('reconciliation_alerts').insert({
      booking_id: bookingId,
      expected_status: expected,
      actual_stripe_status: actual,
    });
    alerts++;
  };

  // Arm 1: 'Card Held', hold not released -> the saved card must still be usable.
  const { data: heldRows, error: heldErr } = await supabase
    .from('booking_card_holds')
    .select(
      'booking_id, stripe_setup_intent_id, stripe_connected_account_id, charge_payment_intent_id, booking:bookings!inner(id, deposit_status, stripe_payment_intent_id)',
    )
    .is('released_at', null)
    .eq('booking.deposit_status', 'Card Held')
    .or(`created_at.gte.${cutoff},updated_at.gte.${cutoff}`)
    .limit(200);

  if (heldErr) {
    console.error('reconciliation card-hold fetch failed:', heldErr);
  } else {
    for (const hold of normalizeHoldReconRows(heldRows ?? [])) {
      checked++;
      try {
        if (hold.stripe_setup_intent_id) {
          const si = await stripe.setupIntents.retrieve(hold.stripe_setup_intent_id, {
            stripeAccount: hold.stripe_connected_account_id,
          });
          if (si.status !== 'succeeded') {
            await insertAlert(hold.booking_id, 'Card Held', si.status);
          } else if (!si.payment_method) {
            await insertAlert(hold.booking_id, 'Card Held', 'succeeded_pm_detached');
          }
        } else if (hold.booking.stripe_payment_intent_id) {
          const pi = await stripe.paymentIntents.retrieve(hold.booking.stripe_payment_intent_id, {
            stripeAccount: hold.stripe_connected_account_id,
          });
          if (pi.status !== 'succeeded') {
            await insertAlert(hold.booking_id, 'Card Held', pi.status);
          } else if (!pi.payment_method) {
            await insertAlert(hold.booking_id, 'Card Held', 'succeeded_pm_detached');
          }
        } else {
          await insertAlert(hold.booking_id, 'Card Held', 'missing_saving_intent');
        }
      } catch (err) {
        console.error('Stripe card-hold intent retrieve failed for booking', hold.booking_id, err);
        await insertAlert(
          hold.booking_id,
          'Card Held',
          `error: ${err instanceof Error ? err.message : 'unknown'}`,
        );
      }
    }
  }

  // Arm 2: 'Charged' -> the charge PI must have succeeded.
  const { data: chargedRows, error: chargedErr } = await supabase
    .from('booking_card_holds')
    .select(
      'booking_id, stripe_setup_intent_id, stripe_connected_account_id, charge_payment_intent_id, booking:bookings!inner(id, deposit_status, stripe_payment_intent_id)',
    )
    .not('charge_payment_intent_id', 'is', null)
    .eq('booking.deposit_status', 'Charged')
    .or(`created_at.gte.${cutoff},updated_at.gte.${cutoff}`)
    .limit(200);

  if (chargedErr) {
    console.error('reconciliation charged-hold fetch failed:', chargedErr);
  } else {
    for (const hold of normalizeHoldReconRows(chargedRows ?? [])) {
      checked++;
      try {
        const pi = await stripe.paymentIntents.retrieve(hold.charge_payment_intent_id!, {
          stripeAccount: hold.stripe_connected_account_id,
        });
        if (pi.status !== 'succeeded') {
          await insertAlert(hold.booking_id, 'Charged', pi.status);
        }
      } catch (err) {
        console.error('Stripe charge PI retrieve failed for booking', hold.booking_id, err);
        await insertAlert(
          hold.booking_id,
          'Charged',
          `error: ${err instanceof Error ? err.message : 'unknown'}`,
        );
      }
    }
  }

  return { checked, alerts };
}
