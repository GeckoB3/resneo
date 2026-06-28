import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import {
  mapStripeSubscriptionToPlanStatus,
  subscriptionCancelAtIso,
  subscriptionPeriodEndIso,
  subscriptionPeriodStartIso,
} from '@/lib/stripe/subscription-fields';

export interface ReconcileStuckTrialingResult {
  /** Venues examined (stuck trials with a Stripe subscription id). */
  scanned: number;
  /** Venues whose plan_status changed away from 'trialing' (active/past_due/cancelled). */
  reconciled: number;
  /** Venues Stripe still reports as trialing (e.g. trial extended) — period dates refreshed only. */
  stillTrialing: number;
  /** Per-venue failure messages (empty on success). */
  errors: string[];
}

/** Cap Stripe retrievals per run; a backlog clears over subsequent daily runs. */
const BATCH_LIMIT = 500;

/**
 * Reconcile venues stuck at `plan_status = 'trialing'` whose trial period has already ended, by
 * re-fetching the Stripe subscription and writing its real status. Backstop for missed or late Stripe
 * `customer.subscription.updated` / `…deleted` webhooks at trial end.
 *
 * Unlike a lapsed cancellation (which is unambiguously 'cancelled'), the post-trial status — active,
 * past_due, or cancelled — is only knowable from Stripe, so this re-fetches each subscription and maps
 * it with `mapStripeSubscriptionToPlanStatus`, exactly as the webhook would have. Only `'trialing'`
 * rows with a non-null `subscription_current_period_end` (= trial end) at or before `now` and a
 * `stripe_subscription_id` are touched. The status guard is re-asserted in the UPDATE so a row a
 * webhook reconciled between read and write is not clobbered.
 */
export async function reconcileStuckTrialingVenues(
  admin: SupabaseClient,
  stripe: Stripe,
  now: Date = new Date(),
): Promise<ReconcileStuckTrialingResult> {
  const nowIso = now.toISOString();
  const errors: string[] = [];

  const { data, error } = await admin
    .from('venues')
    .select('id, stripe_subscription_id')
    .eq('plan_status', 'trialing')
    .not('subscription_current_period_end', 'is', null)
    .lte('subscription_current_period_end', nowIso)
    .not('stripe_subscription_id', 'is', null)
    .limit(BATCH_LIMIT);

  if (error) {
    console.error('[reconcile-stuck-trials] select failed:', error.message);
    return { scanned: 0, reconciled: 0, stillTrialing: 0, errors: [error.message] };
  }

  const venues = (data ?? []) as Array<{ id: string; stripe_subscription_id: string }>;
  let reconciled = 0;
  let stillTrialing = 0;

  for (const venue of venues) {
    try {
      const sub = await stripe.subscriptions.retrieve(venue.stripe_subscription_id);
      const planStatus = mapStripeSubscriptionToPlanStatus(sub);

      const { error: updErr } = await admin
        .from('venues')
        .update({
          plan_status: planStatus,
          subscription_current_period_start: subscriptionPeriodStartIso(sub),
          subscription_current_period_end: subscriptionPeriodEndIso(sub) ?? subscriptionCancelAtIso(sub),
        })
        .eq('id', venue.id)
        .eq('plan_status', 'trialing');

      if (updErr) {
        errors.push(`venue ${venue.id}: ${updErr.message}`);
        continue;
      }
      if (planStatus === 'trialing') stillTrialing += 1;
      else reconciled += 1;
    } catch (e) {
      errors.push(`venue ${venue.id}: ${e instanceof Error ? e.message : 'stripe retrieve failed'}`);
    }
  }

  return { scanned: venues.length, reconciled, stillTrialing, errors };
}
