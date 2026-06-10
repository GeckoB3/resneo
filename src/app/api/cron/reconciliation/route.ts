import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';

/**
 * GET/POST /api/cron/reconciliation
 * Vercel Cron uses GET; POST kept for manual triggers.
 * Compares recent Paid/Refunded bookings to Stripe PaymentIntents; logs reconciliation_alerts.
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

    return NextResponse.json({ checked: bookings.length, alerts });
  } catch (err) {
    console.error('reconciliation cron failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
