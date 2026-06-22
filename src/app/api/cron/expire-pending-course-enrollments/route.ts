import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';
import { stripe } from '@/lib/stripe';

/**
 * Cron: expire abandoned paid course checkouts (C9).
 *
 * Course capacity counts `pending_payment` enrollments (see
 * `account/courses/checkout` + `enroll`), so a never-completed paid checkout
 * permanently holds a seat. This job cancels `class_course_enrollments` that are
 * still `pending_payment` and older than 2 hours, releasing the held seat.
 *
 * The flip to `cancelled` is a conditional UPDATE (status still
 * `pending_payment`), so it loses the race against a concurrent fulfillment that
 * is activating the same row — that fulfillment keeps the seat. For rows with a
 * dangling PaymentIntent we also cancel the PI best-effort so a late
 * confirmation cannot charge a guest for a seat we just released; if Stripe
 * reports the PI already succeeded (paid moments before the cutoff) we revert
 * the row to `pending_payment` so the normal fulfill path can still honour it.
 */
export const GET = withCronRunLogging('expire-pending-course-enrollments', handleGet);

const STALE_AFTER_MS = 2 * 60 * 60 * 1000; // 2 hours

async function handleGet(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  const admin = getSupabaseAdminClient();
  const cutoffIso = new Date(Date.now() - STALE_AFTER_MS).toISOString();

  const { data: rows, error } = await admin
    .from('class_course_enrollments')
    .select('id, venue_id, stripe_payment_intent_id, created_at')
    .eq('status', 'pending_payment')
    .lt('created_at', cutoffIso)
    .limit(100);

  if (error) {
    console.error('[cron/expire-pending-course-enrollments]', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Cache venue → connected account so we don't re-query per row.
  const acctByVenue = new Map<string, string | null>();
  async function connectedAccountFor(venueId: string): Promise<string | null> {
    if (acctByVenue.has(venueId)) return acctByVenue.get(venueId) ?? null;
    const { data: venue } = await admin
      .from('venues')
      .select('stripe_connected_account_id')
      .eq('id', venueId)
      .maybeSingle();
    const acct = (venue as { stripe_connected_account_id?: string | null } | null)?.stripe_connected_account_id?.trim() || null;
    acctByVenue.set(venueId, acct);
    return acct;
  }

  let cancelled = 0;
  let revivedPaid = 0;

  for (const r of (rows ?? []) as Array<{
    id: string;
    venue_id: string;
    stripe_payment_intent_id: string | null;
    created_at: string;
  }>) {
    // Atomically claim the expiry: only flip rows still pending_payment.
    const { data: claimed, error: claimErr } = await admin
      .from('class_course_enrollments')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', r.id)
      .eq('status', 'pending_payment')
      .select('id');

    if (claimErr) {
      console.warn('[cron/expire-pending-course-enrollments] claim', r.id, claimErr.message);
      continue;
    }
    if (!claimed || claimed.length === 0) {
      // A fulfillment activated it (or another runner cancelled it) — leave it.
      continue;
    }

    cancelled += 1;

    if (!r.stripe_payment_intent_id) continue;

    const acct = await connectedAccountFor(r.venue_id);
    try {
      await stripe.paymentIntents.cancel(
        r.stripe_payment_intent_id,
        undefined,
        acct ? { stripeAccount: acct } : undefined,
      );
    } catch (e) {
      const code = (e as Stripe.errors.StripeError)?.code;
      const piStatus = (e as { payment_intent?: { status?: string } })?.payment_intent?.status;
      // If the PI already succeeded just before the cutoff, do NOT strand a paid
      // guest: revert the enrollment to pending_payment so fulfill can honour it.
      if (piStatus === 'succeeded' || code === 'payment_intent_unexpected_state') {
        await admin
          .from('class_course_enrollments')
          .update({ status: 'pending_payment', updated_at: new Date().toISOString() })
          .eq('id', r.id)
          .eq('status', 'cancelled');
        cancelled -= 1;
        revivedPaid += 1;
        continue;
      }
      // Already-cancelled PI or transient error: the seat is released either way.
      console.warn('[cron/expire-pending-course-enrollments] PI cancel', r.id, (e as Error).message);
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: rows?.length ?? 0,
    cancelled,
    revived_paid: revivedPaid,
  });
}
