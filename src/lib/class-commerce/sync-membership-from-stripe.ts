import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RESERVE_NI_SUBSCRIPTION_PURPOSE } from '@/types/class-commerce';

function mapStripeSubscriptionStatus(status: Stripe.Subscription.Status): string {
  switch (status) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    case 'paused':
      return 'paused';
    case 'incomplete_expired':
      return 'incomplete';
    default:
      return 'incomplete';
  }
}

/**
 * Upserts `class_memberships` when a Connect-account subscription carries ReserveNI metadata.
 */
export async function syncClassMembershipFromStripeSubscription(
  admin: SupabaseClient,
  sub: Stripe.Subscription,
): Promise<void> {
  const meta = sub.metadata ?? {};
  if (meta.reserve_ni_purpose !== RESERVE_NI_SUBSCRIPTION_PURPOSE.CLASS_MEMBERSHIP) return;

  const userId = meta.user_id as string | undefined;
  const venueId = meta.venue_id as string | undefined;
  const productId = meta.product_id as string | undefined;
  if (!userId || !venueId || !productId) {
    console.warn('[syncClassMembership] missing metadata on subscription', sub.id, meta);
    return;
  }

  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
  const periodEndUnix = (sub as unknown as { current_period_end?: number }).current_period_end;
  const periodEnd =
    typeof periodEndUnix === 'number' ? new Date(periodEndUnix * 1000).toISOString() : null;

  const row = {
    venue_id: venueId,
    user_id: userId,
    product_id: productId,
    stripe_subscription_id: sub.id,
    stripe_customer_id: customerId,
    status: mapStripeSubscriptionStatus(sub.status),
    current_period_end: periodEnd,
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await admin
    .from('class_memberships')
    .select('id')
    .eq('stripe_subscription_id', sub.id)
    .maybeSingle();

  if (existing) {
    await admin.from('class_memberships').update(row).eq('stripe_subscription_id', sub.id);
  } else {
    await admin.from('class_memberships').insert({ ...row, created_at: new Date().toISOString() });
  }
}
