import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/stripe';
import { RESERVE_NI_SUBSCRIPTION_PURPOSE } from '@/types/class-commerce';

/**
 * Create the subscription behind a membership purchase (P0-17, C9).
 *
 * This is the server side of the SetupIntent flow that replaced hosted
 * Checkout. The customer confirms a card in the Payment Element; Stripe
 * delivers `setup_intent.succeeded`; this creates the subscription with that
 * card as its default payment method. `customer.subscription.created` then
 * fires and the EXISTING `syncClassMembershipFromStripeSubscription` records
 * it, which is why this rework did not touch the recording path.
 *
 * Doing it here rather than in a second call from the client is deliberate: by
 * the time the SetupIntent succeeds the card is already saved, so a client that
 * closed its tab would leave a customer with a saved card, no membership, and
 * nothing to reconcile from. The webhook is the only participant guaranteed to
 * run.
 *
 * IDEMPOTENCY, twice over, because Stripe redelivers and customers double-tap:
 *
 *  - the Stripe idempotency key is derived from the SetupIntent id, so a
 *    redelivered event replays the original result rather than creating a
 *    second subscription;
 *  - an existing live membership for the same (user, venue, product) short
 *    circuits before any Stripe call, which covers two SetupIntents created
 *    from two taps.
 *
 * The price comes from the database rather than from the SetupIntent metadata:
 * the product is the source of truth, and a plan whose price changed or which
 * was deactivated between the tap and the confirm must not be sold at the old
 * one.
 */

export type MembershipSubscriptionOutcome =
  | { created: true; subscriptionId: string }
  | { created: false; reason: 'not_a_membership_setup' | 'already_subscribed' | 'product_unavailable' | 'incomplete_setup' };

export async function createMembershipSubscriptionFromSetupIntent(
  admin: SupabaseClient,
  setupIntent: Stripe.SetupIntent,
  stripeAccountId: string,
): Promise<MembershipSubscriptionOutcome> {
  const meta = setupIntent.metadata ?? {};
  if (meta.reserve_ni_purpose !== RESERVE_NI_SUBSCRIPTION_PURPOSE.CLASS_MEMBERSHIP) {
    return { created: false, reason: 'not_a_membership_setup' };
  }

  const userId = meta.user_id;
  const venueId = meta.venue_id;
  const productId = meta.product_id;
  const customerId =
    typeof setupIntent.customer === 'string' ? setupIntent.customer : setupIntent.customer?.id ?? null;
  const paymentMethodId =
    typeof setupIntent.payment_method === 'string'
      ? setupIntent.payment_method
      : setupIntent.payment_method?.id ?? null;

  if (!userId || !venueId || !productId || !customerId || !paymentMethodId) {
    console.warn('[membership-subscription] incomplete setup intent', setupIntent.id, {
      userId,
      venueId,
      productId,
      hasCustomer: Boolean(customerId),
      hasPaymentMethod: Boolean(paymentMethodId),
    });
    return { created: false, reason: 'incomplete_setup' };
  }

  const { data: existing } = await admin
    .from('class_memberships')
    .select('id')
    .eq('user_id', userId)
    .eq('venue_id', venueId)
    .eq('product_id', productId)
    .in('status', ['active', 'trialing', 'past_due'])
    .maybeSingle();
  if (existing) {
    console.log('[membership-subscription] already subscribed, skipping', { userId, venueId, productId });
    return { created: false, reason: 'already_subscribed' };
  }

  const { data: product } = await admin
    .from('class_membership_products')
    .select('stripe_price_id')
    .eq('id', productId)
    .eq('venue_id', venueId)
    .eq('active', true)
    .maybeSingle();

  const priceId = (product as { stripe_price_id?: string | null } | null)?.stripe_price_id?.trim();
  if (!priceId) {
    // Deactivated or unpriced between the tap and the confirm. The card is
    // saved and nothing is charged, which is the right way round to fail.
    console.warn('[membership-subscription] product unavailable at confirm time', { productId, venueId });
    return { created: false, reason: 'product_unavailable' };
  }

  const subscription = await stripe.subscriptions.create(
    {
      customer: customerId,
      items: [{ price: priceId }],
      default_payment_method: paymentMethodId,
      // Carried through unchanged: this is what
      // syncClassMembershipFromStripeSubscription reads to record the
      // membership when customer.subscription.created arrives.
      metadata: {
        reserve_ni_purpose: RESERVE_NI_SUBSCRIPTION_PURPOSE.CLASS_MEMBERSHIP,
        user_id: userId,
        venue_id: venueId,
        product_id: productId,
      },
    },
    {
      stripeAccount: stripeAccountId,
      idempotencyKey: `membership_sub:${setupIntent.id}`,
    },
  );

  console.log('[membership-subscription] created', {
    subscriptionId: subscription.id,
    userId,
    venueId,
    productId,
  });
  return { created: true, subscriptionId: subscription.id };
}
