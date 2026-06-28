import type { SupabaseClient } from '@supabase/supabase-js';

export interface ReconcileStuckCancellingResult {
  /** Number of venue rows flipped from 'cancelling' to 'cancelled'. */
  reconciled: number;
  /** Human-readable failure messages (empty on success). */
  errors: string[];
}

/**
 * Reconcile venues stuck at `plan_status = 'cancelling'` whose paid period has already ended, flipping
 * them to `'cancelled'`. This is a backstop for missed or late Stripe `customer.subscription.deleted`
 * webhooks.
 *
 * The display and entitlement layers already derive the *effective* status at read time via
 * `effectivePlanStatus` (see `@/lib/billing/subscription-entitlement`), so a stuck row is already shown
 * and gated as cancelled. This job only corrects the stored column so any remaining raw consumers (and
 * the CSV export) agree, and so the data is self-consistent.
 *
 * Mirrors `effectivePlanStatus` exactly: only `'cancelling'` rows with a non-null
 * `subscription_current_period_end` at or before `now` are flipped. Rows with no stored period end are
 * left untouched — we never expire on missing data. The predicate is evaluated against current row
 * state inside the UPDATE, so a row a webhook reactivated to 'active' between scheduling and this run is
 * not clobbered.
 */
export async function reconcileStuckCancellingVenues(
  admin: SupabaseClient,
  now: Date = new Date(),
): Promise<ReconcileStuckCancellingResult> {
  const nowIso = now.toISOString();

  const { data, error } = await admin
    .from('venues')
    .update({ plan_status: 'cancelled' })
    .eq('plan_status', 'cancelling')
    .not('subscription_current_period_end', 'is', null)
    .lte('subscription_current_period_end', nowIso)
    .select('id');

  if (error) {
    console.error('[reconcile-stuck-cancelling] update failed:', error.message);
    return { reconciled: 0, errors: [error.message] };
  }

  return { reconciled: (data ?? []).length, errors: [] };
}
