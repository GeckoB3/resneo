import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';
import { finalizeCronRun } from '@/lib/cron/finalize-cron-run';
import { reconcileStuckCancellingVenues } from '@/lib/billing/reconcile-stuck-cancelling';
import { reconcileStuckTrialingVenues } from '@/lib/billing/reconcile-stuck-trials';

/**
 * GET /api/cron/subscription-reconcile — keep stored plan_status in sync with reality, a backstop for
 * missed or late Stripe subscription webhooks. Two passes:
 *  1. Flip venues stuck at 'cancelling' past their paid period end to 'cancelled' (deterministic, no
 *     Stripe call) — the display/entitlement layers already derive this via `effectivePlanStatus`, so
 *     this only keeps the stored column and raw consumers in sync.
 *  2. Re-fetch Stripe for venues stuck at 'trialing' past their trial end and write their real status
 *     (active/past_due/cancelled) — the post-trial outcome is only knowable from Stripe.
 * Registered in vercel.json.
 */
export const GET = withCronRunLogging('subscription-reconcile', handleGet);

async function handleGet(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  const admin = getSupabaseAdminClient();
  const cancelling = await reconcileStuckCancellingVenues(admin);
  const trials = await reconcileStuckTrialingVenues(admin, stripe);

  const outcome = await finalizeCronRun({
    job: 'subscription-reconcile',
    results: {
      cancelling_reconciled: cancelling.reconciled,
      trials_scanned: trials.scanned,
      trials_reconciled: trials.reconciled,
      trials_still_trialing: trials.stillTrialing,
    },
    errors: cancelling.errors.length + trials.errors.length,
  });
  return NextResponse.json(outcome.body, { status: outcome.httpStatus });
}
