import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';
import { syncClassMembershipFromStripeSubscription } from '@/lib/class-commerce/sync-membership-from-stripe';

interface MembershipRow {
  id: string;
  venue_id: string;
  stripe_subscription_id: string | null;
  status: string;
}

/**
 * Cron — M5 membership reconciliation (§5.2).
 *
 * The membership lifecycle (activate / renew / cancel) is driven by a manually
 * configured Stripe Connect subscription webhook. If those events are never wired,
 * or one is missed/dropped, a membership can keep granting free class access after
 * the subscription was cancelled at Stripe (or never activate). This job is the
 * backstop: for every membership we still believe is live, fetch the authoritative
 * subscription from the venue's connected account and re-sync status + period via
 * `syncClassMembershipFromStripeSubscription`. A subscription that no longer exists
 * at Stripe is marked `canceled` so it stops covering bookings.
 */
export const GET = withCronRunLogging('reconcile-class-memberships', handleGet);

async function handleGet(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  const admin = getSupabaseAdminClient();

  // Only memberships we currently treat as access-granting need reconciling — a
  // membership already `canceled`/`past_due` is not handing out free classes. The
  // webhook is responsible for activating brand-new ones.
  const { data: memberships, error } = await admin
    .from('class_memberships')
    .select('id, venue_id, stripe_subscription_id, status')
    .in('status', ['active', 'trialing'])
    .not('stripe_subscription_id', 'is', null)
    .limit(1000);

  if (error) {
    console.error('[cron/reconcile-class-memberships]', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const mRows = (memberships ?? []) as MembershipRow[];
  if (mRows.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, resynced: 0, cancelled: 0 });
  }

  // Resolve each venue's connected account once.
  const venueIds = [...new Set(mRows.map((m) => m.venue_id))];
  const { data: venues } = await admin
    .from('venues')
    .select('id, stripe_connected_account_id')
    .in('id', venueIds);
  const accountByVenue = new Map(
    ((venues ?? []) as Array<{ id: string; stripe_connected_account_id: string | null }>).map(
      (v) => [v.id, v.stripe_connected_account_id] as const,
    ),
  );

  let resynced = 0;
  let cancelled = 0;
  const errors: string[] = [];

  for (const m of mRows) {
    if (!m.stripe_subscription_id) continue;
    const accountId = accountByVenue.get(m.venue_id) ?? null;
    if (!accountId) {
      // No connected account on file — can't query Stripe for this venue.
      continue;
    }

    try {
      const sub = (await stripe.subscriptions.retrieve(m.stripe_subscription_id, {
        stripeAccount: accountId,
      })) as Stripe.Subscription;
      // Re-sync status/period from the source of truth. This downgrades a
      // cancelled-at-Stripe membership even if the Connect webhook was missed.
      await syncClassMembershipFromStripeSubscription(admin, sub);
      resynced += 1;
    } catch (e) {
      const code = (e as { statusCode?: number; code?: string }).statusCode;
      const stripeCode = (e as { code?: string }).code;
      const missing =
        code === 404 ||
        stripeCode === 'resource_missing' ||
        /no such subscription/i.test((e as Error)?.message ?? '');
      if (missing) {
        // Subscription no longer exists at Stripe — stop it granting access.
        const { error: upErr } = await admin
          .from('class_memberships')
          .update({ status: 'canceled', updated_at: new Date().toISOString() })
          .eq('id', m.id);
        if (upErr) {
          errors.push(`cancel ${m.id}: ${upErr.message}`);
        } else {
          cancelled += 1;
        }
      } else {
        console.error('[cron/reconcile-class-memberships] retrieve failed', m.id, e);
        errors.push(`retrieve ${m.id}: ${(e as Error)?.message ?? 'unknown'}`);
      }
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    scanned: mRows.length,
    resynced,
    cancelled,
    errors,
  });
}
