import type { SupabaseClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/stripe';

/**
 * Ensure a Stripe Customer exists on the venue connected account for this ReserveNI user.
 */
export async function ensureVenueStripeCustomerForUser(
  admin: SupabaseClient,
  params: { userId: string; venueId: string; stripeConnectedAccountId: string; email?: string | null },
): Promise<{ stripeCustomerId: string }> {
  const { userId, venueId, stripeConnectedAccountId, email } = params;

  const { data: existing, error: selErr } = await admin
    .from('venue_customer_stripe')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (selErr) {
    console.error('[ensureVenueStripeCustomerForUser] select failed', selErr);
    throw new Error('Failed to load venue customer');
  }

  if (existing?.stripe_customer_id) {
    return { stripeCustomerId: existing.stripe_customer_id as string };
  }

  const customer = await stripe.customers.create(
    {
      email: email?.trim() || undefined,
      metadata: {
        reserve_ni_user_id: userId,
        reserve_ni_venue_id: venueId,
      },
    },
    { stripeAccount: stripeConnectedAccountId },
  );

  const { error: insErr } = await admin.from('venue_customer_stripe').insert({
    user_id: userId,
    venue_id: venueId,
    stripe_connected_account_id: stripeConnectedAccountId,
    stripe_customer_id: customer.id,
  });

  if (insErr) {
    if (insErr.code === '23505') {
      const { data: again } = await admin
        .from('venue_customer_stripe')
        .select('stripe_customer_id')
        .eq('user_id', userId)
        .eq('venue_id', venueId)
        .maybeSingle();
      if (again?.stripe_customer_id) return { stripeCustomerId: again.stripe_customer_id as string };
    }
    console.error('[ensureVenueStripeCustomerForUser] insert failed', insErr);
    throw new Error('Failed to store venue customer');
  }

  return { stripeCustomerId: customer.id };
}
