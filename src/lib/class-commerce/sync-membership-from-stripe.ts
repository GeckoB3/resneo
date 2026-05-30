import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RESERVE_NI_SUBSCRIPTION_PURPOSE } from '@/types/class-commerce';
import { sendClassCommerceComm } from '@/lib/communications/send-class-commerce';

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
 * Upserts `class_memberships` when a Connect-account subscription carries Resneo metadata.
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
  const periodStartUnix = (sub as unknown as { current_period_start?: number }).current_period_start;
  // Stripe Subscriptions API v2024+ moved current_period_* into `items.data[0]`.
  const firstItem = sub.items?.data?.[0] as unknown as
    | { current_period_start?: number; current_period_end?: number }
    | undefined;
  const periodEndChosen = periodEndUnix ?? firstItem?.current_period_end;
  const periodStartChosen = periodStartUnix ?? firstItem?.current_period_start;
  const periodEnd =
    typeof periodEndChosen === 'number' ? new Date(periodEndChosen * 1000).toISOString() : null;
  const periodStart =
    typeof periodStartChosen === 'number' ? new Date(periodStartChosen * 1000).toISOString() : null;

  const row = {
    venue_id: venueId,
    user_id: userId,
    product_id: productId,
    stripe_subscription_id: sub.id,
    stripe_customer_id: customerId,
    status: mapStripeSubscriptionStatus(sub.status),
    current_period_start: periodStart,
    current_period_end: periodEnd,
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await admin
    .from('class_memberships')
    .select('id, status, current_period_end, cancel_at_period_end')
    .eq('stripe_subscription_id', sub.id)
    .maybeSingle();

  const prev = existing as
    | { id: string; status: string; current_period_end: string | null; cancel_at_period_end: boolean }
    | null;

  if (prev) {
    await admin.from('class_memberships').update(row).eq('stripe_subscription_id', sub.id);
  } else {
    await admin.from('class_memberships').insert({ ...row, created_at: new Date().toISOString() });
  }

  // Phase 2 §5.5 — fire lifecycle comms based on state transitions.
  try {
    const { data: product } = await admin
      .from('class_membership_products')
      .select('name')
      .eq('id', productId)
      .maybeSingle();
    const planName = (product as { name?: string | null } | null)?.name?.trim() || 'Membership';
    const newStatus = row.status;

    // Welcome — first transition into active/trialing.
    const becameActive =
      (newStatus === 'active' || newStatus === 'trialing') &&
      (!prev || (prev.status !== 'active' && prev.status !== 'trialing'));
    if (becameActive) {
      await sendClassCommerceComm({
        venueId,
        userId,
        payload: {
          key: 'class_membership_started',
          vars: { venueName: '', planName, periodEndIso: row.current_period_end },
        },
      });
    } else if (
      prev &&
      (prev.status === 'active' || prev.status === 'trialing') &&
      (newStatus === 'active' || newStatus === 'trialing') &&
      prev.current_period_end &&
      row.current_period_end &&
      prev.current_period_end !== row.current_period_end
    ) {
      // Renewal — current_period_end advanced for an already-active member.
      await sendClassCommerceComm({
        venueId,
        userId,
        payload: {
          key: 'class_membership_renewed',
          vars: { venueName: '', planName, periodEndIso: row.current_period_end },
        },
      });
    }

    // Cancelling — cancel_at_period_end flipped from false → true.
    if (
      prev &&
      prev.cancel_at_period_end === false &&
      row.cancel_at_period_end === true
    ) {
      await sendClassCommerceComm({
        venueId,
        userId,
        payload: {
          key: 'class_membership_cancelling',
          vars: { venueName: '', planName, periodEndIso: row.current_period_end },
        },
      });
    }

    // Ended — transition to canceled / paused / incomplete from active state.
    if (
      prev &&
      (prev.status === 'active' || prev.status === 'trialing') &&
      newStatus === 'canceled'
    ) {
      await sendClassCommerceComm({
        venueId,
        userId,
        payload: {
          key: 'class_membership_ended',
          vars: { venueName: '', planName },
        },
      });
    }
  } catch (commsErr) {
    console.error('[syncClassMembership] lifecycle comms failed', commsErr);
  }
}
