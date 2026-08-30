import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';

/** Membership statuses that still entitle the customer to something today. */
const LIVE_MEMBERSHIP_STATUSES = ['active', 'trialing', 'past_due'];

export type RemovalOwnership =
  | { ok: true; connectedAccountId: string; customerId: string }
  | { ok: false; reason: 'venue_not_found' | 'venue_not_connected' | 'not_yours' };

/**
 * Prove the card is this customer's, at this venue, before touching Stripe.
 *
 * **The venue has to be in the route and this is why.** Cards live on
 * per-venue Connect customers (`venue_customer_stripe`), so a payment method
 * id alone cannot even name the connected account it lives on, let alone say
 * whose it is. Detaching by id without this would be an unauthenticated write
 * to whatever account happened to hold that id.
 *
 * The last check is the one that matters: the payment method is retrieved on
 * the venue's connected account and its `customer` must be the customer row
 * this user owns at this venue. Never trust an id from the client.
 */
export async function resolvePaymentMethodOwnership(
  admin: SupabaseClient,
  stripe: Pick<Stripe, 'paymentMethods'>,
  args: { userId: string; venueId: string; paymentMethodId: string },
): Promise<RemovalOwnership> {
  const { data: venue } = await admin
    .from('venues')
    .select('id, stripe_connected_account_id')
    .eq('id', args.venueId)
    .maybeSingle();
  if (!venue) return { ok: false, reason: 'venue_not_found' };

  const acct = (venue as { stripe_connected_account_id?: string | null })
    .stripe_connected_account_id?.trim();
  if (!acct) return { ok: false, reason: 'venue_not_connected' };

  const { data: link } = await admin
    .from('venue_customer_stripe')
    .select('stripe_customer_id')
    .eq('user_id', args.userId)
    .eq('venue_id', args.venueId)
    .maybeSingle();
  const customerId = (link as { stripe_customer_id?: string } | null)?.stripe_customer_id;
  // No customer at this venue means no cards here, so any id is not theirs.
  if (!customerId) return { ok: false, reason: 'not_yours' };

  let pm: Stripe.PaymentMethod;
  try {
    pm = await stripe.paymentMethods.retrieve(args.paymentMethodId, { stripeAccount: acct });
  } catch {
    // A id that does not exist on this account is indistinguishable, to the
    // caller, from one that belongs to somebody else. Deliberately.
    return { ok: false, reason: 'not_yours' };
  }

  const owner = typeof pm.customer === 'string' ? pm.customer : (pm.customer?.id ?? null);
  if (owner !== customerId) return { ok: false, reason: 'not_yours' };

  return { ok: true, connectedAccountId: acct, customerId };
}

export interface BackedMembership {
  id: string;
  name: string;
}

/**
 * Live memberships this card is actually paying for.
 *
 * **Attributed per card rather than warning whenever a membership exists**,
 * because a vague warning trains people to click through it. A subscription
 * names its own `default_payment_method`; when it does not, it falls back to
 * the customer's default, so a card that IS that default backs it too.
 *
 * Fails SOFT: if Stripe cannot be asked, the answer is "none known" and the
 * removal proceeds. The alternative is refusing to let somebody remove their
 * own card because a third party is unreachable, and a card can be re-added.
 */
export async function membershipsBackedByPaymentMethod(
  admin: SupabaseClient,
  stripe: Pick<Stripe, 'subscriptions' | 'customers'>,
  args: {
    userId: string;
    venueId: string;
    customerId: string;
    connectedAccountId: string;
    paymentMethodId: string;
  },
): Promise<BackedMembership[]> {
  try {
    const { data: rows } = await admin
      .from('class_memberships')
      .select('id, product_id, status, stripe_subscription_id')
      .eq('user_id', args.userId)
      .eq('venue_id', args.venueId)
      .in('status', LIVE_MEMBERSHIP_STATUSES);

    const live = (rows ?? []) as Array<{
      id: string;
      product_id: string;
      stripe_subscription_id: string | null;
    }>;
    if (live.length === 0) return [];

    // Only fetched when there is something to attribute.
    const customer = await stripe.customers.retrieve(args.customerId, {
      stripeAccount: args.connectedAccountId,
    });
    const customerDefault =
      typeof customer !== 'string' && !customer.deleted
        ? defaultPaymentMethodId(customer.invoice_settings?.default_payment_method ?? null)
        : null;

    const names = await membershipNames(admin, live.map((r) => r.product_id));
    const backed: BackedMembership[] = [];

    for (const row of live) {
      if (!row.stripe_subscription_id) continue;
      const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id, {
        stripeAccount: args.connectedAccountId,
      });
      const subDefault = defaultPaymentMethodId(sub.default_payment_method ?? null);
      const effective = subDefault ?? customerDefault;
      if (effective === args.paymentMethodId) {
        backed.push({ id: row.id, name: names.get(row.product_id) ?? 'Membership' });
      }
    }
    return backed;
  } catch (e) {
    console.error(
      '[membershipsBackedByPaymentMethod] could not attribute, allowing removal:',
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}

function defaultPaymentMethodId(
  value: string | Stripe.PaymentMethod | null,
): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

async function membershipNames(
  admin: SupabaseClient,
  productIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(productIds)].filter(Boolean);
  if (ids.length === 0) return new Map();
  const { data } = await admin
    .from('class_membership_products')
    .select('id, name')
    .in('id', ids);
  return new Map(
    ((data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
  );
}
