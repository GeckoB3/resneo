import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Record whether a connected Stripe account can take charges on every venue that holds it
 * (`venues.stripe_charges_enabled`, migration 20270213120000). The column lets server rules
 * that cannot call Stripe per venue per page view, such as hiding a venue's paid services
 * from a combined booking page, know whether the venue can actually be paid (RT2-15).
 *
 * Only ever written with the service-role client: the database refuses the change from a
 * client role. Best effort: a failure is logged and never fails the caller (a webhook must
 * still acknowledge the event, a status read must still answer).
 */
export async function recordStripeChargesEnabled(
  admin: SupabaseClient,
  accountId: string,
  chargesEnabled: boolean | null | undefined,
): Promise<void> {
  if (!accountId) return;
  const value = chargesEnabled === true;
  const { error } = await admin
    .from('venues')
    .update({ stripe_charges_enabled: value })
    .eq('stripe_connected_account_id', accountId)
    .or(`stripe_charges_enabled.is.null,stripe_charges_enabled.neq.${value}`);
  if (error) {
    console.error('[stripe] could not record stripe_charges_enabled', { accountId, error: error.message });
  }
}
