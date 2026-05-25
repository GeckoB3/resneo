import { stripe } from '@/lib/stripe';

export interface CreateMembershipStripeRecurringParams {
  stripeAccountId: string;
  productName: string;
  productDescription?: string | null;
  currency: string;
  unitAmountPence: number;
  interval: 'week' | 'month' | 'year';
  intervalCount: number;
  /** When updating pricing, reuse existing Stripe Product. */
  existingStripeProductId?: string | null;
}

export interface CreateMembershipStripeRecurringResult {
  stripe_product_id: string;
  stripe_price_id: string;
}

/**
 * Creates (or reuses) a Product and a new recurring Price on the venue's connected Stripe account.
 * Changing amount/interval creates a new Price; callers should persist the new `stripe_price_id`.
 */
export async function createMembershipRecurringProductAndPrice(
  params: CreateMembershipStripeRecurringParams,
): Promise<CreateMembershipStripeRecurringResult> {
  const {
    stripeAccountId,
    productName,
    productDescription,
    currency,
    unitAmountPence,
    interval,
    intervalCount,
    existingStripeProductId,
  } = params;

  let productId = existingStripeProductId?.trim() || null;
  if (!productId) {
    const product = await stripe.products.create(
      {
        name: productName,
        description: productDescription?.trim() ? productDescription.trim() : undefined,
        metadata: { reserve_ni_kind: 'class_membership' },
      },
      { stripeAccount: stripeAccountId },
    );
    productId = product.id;
  }

  const price = await stripe.prices.create(
    {
      product: productId,
      currency: currency.toLowerCase(),
      unit_amount: unitAmountPence,
      recurring: {
        interval,
        interval_count: intervalCount,
      },
      metadata: { reserve_ni_kind: 'class_membership' },
    },
    { stripeAccount: stripeAccountId },
  );

  if (!price.id) {
    throw new Error('Stripe did not return a price id');
  }

  return { stripe_product_id: productId, stripe_price_id: price.id };
}

/** Best-effort: archive previous price so it is not offered for new checkouts. */
export async function archiveStripePriceOnConnectedAccount(
  stripeAccountId: string,
  priceId: string,
): Promise<void> {
  try {
    await stripe.prices.update(priceId, { active: false }, { stripeAccount: stripeAccountId });
  } catch (e) {
    console.warn('[archiveStripePriceOnConnectedAccount] non-fatal', priceId, e);
  }
}

/**
 * Best-effort: archive the Stripe Product so it is no longer offered for new checkouts.
 * Stripe will not allow archiving a Product whose only Price is still active — callers
 * should archive all live Prices first (the membership product helper above does this).
 */
export async function archiveStripeProductOnConnectedAccount(
  stripeAccountId: string,
  productId: string,
): Promise<void> {
  try {
    await stripe.products.update(productId, { active: false }, { stripeAccount: stripeAccountId });
  } catch (e) {
    console.warn('[archiveStripeProductOnConnectedAccount] non-fatal', productId, e);
  }
}
