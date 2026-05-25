import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/stripe';
import { RESERVE_NI_PI_PURPOSE } from '@/types/class-commerce';
import { sendClassCommerceComm } from '@/lib/communications/send-class-commerce';

export interface FulfillCreditPurchaseParams {
  admin: SupabaseClient;
  paymentIntentId: string;
  stripeAccountId?: string | null;
}

/**
 * Idempotent: grants credit batch + ledger when a succeeded PaymentIntent carries
 * {@link RESERVE_NI_PI_PURPOSE.CLASS_CREDIT_PURCHASE} metadata.
 */
export async function fulfillClassCreditPurchaseFromPaymentIntent(
  params: FulfillCreditPurchaseParams,
): Promise<{ fulfilled: boolean; reason?: string }> {
  const { admin, paymentIntentId, stripeAccountId } = params;

  let pi: Stripe.PaymentIntent;
  try {
    pi = stripeAccountId
      ? await stripe.paymentIntents.retrieve(paymentIntentId, { stripeAccount: stripeAccountId })
      : await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch (e) {
    console.error('[fulfillClassCreditPurchase] retrieve PI failed', e);
    return { fulfilled: false, reason: 'retrieve_failed' };
  }

  if (pi.status !== 'succeeded') {
    return { fulfilled: false, reason: 'not_succeeded' };
  }

  const meta = pi.metadata ?? {};
  if (meta.reserve_ni_purpose !== RESERVE_NI_PI_PURPOSE.CLASS_CREDIT_PURCHASE) {
    return { fulfilled: false, reason: 'wrong_purpose' };
  }

  const userId = meta.user_id as string | undefined;
  const venueId = meta.venue_id as string | undefined;
  const productId = meta.product_id as string | undefined;
  if (!userId || !venueId || !productId) {
    console.error('[fulfillClassCreditPurchase] missing metadata', meta);
    return { fulfilled: false, reason: 'missing_metadata' };
  }

  const { data: product, error: prodErr } = await admin
    .from('class_credit_products')
    .select('id, venue_id, credits_count, validity_days, name')
    .eq('id', productId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (prodErr || !product) {
    console.error('[fulfillClassCreditPurchase] product not found', prodErr);
    return { fulfilled: false, reason: 'product_not_found' };
  }

  const creditsCount = (product as { credits_count: number }).credits_count;
  const validityDays = (product as { validity_days: number | null }).validity_days;

  const expiresAt =
    validityDays != null && validityDays > 0
      ? new Date(Date.now() + validityDays * 86400000).toISOString()
      : null;

  const { error: lockErr } = await admin.from('class_credit_purchase_fulfillments').insert({
    stripe_payment_intent_id: paymentIntentId,
    user_id: userId,
    venue_id: venueId,
    product_id: productId,
    balance_id: null,
  });

  if (lockErr) {
    const code = (lockErr as { code?: string }).code;
    if (code === '23505') {
      return { fulfilled: false, reason: 'already_fulfilled' };
    }
    console.error('[fulfillClassCreditPurchase] fulfillment lock insert failed', lockErr);
    return { fulfilled: false, reason: 'lock_failed' };
  }

  const { data: balance, error: balErr } = await admin
    .from('user_class_credit_balances')
    .insert({
      user_id: userId,
      venue_id: venueId,
      product_id: productId,
      credits_remaining: creditsCount,
      expires_at: expiresAt,
    })
    .select('id')
    .single();

  if (balErr || !balance) {
    console.error('[fulfillClassCreditPurchase] balance insert failed', balErr);
    await admin.from('class_credit_purchase_fulfillments').delete().eq('stripe_payment_intent_id', paymentIntentId);
    return { fulfilled: false, reason: 'balance_insert_failed' };
  }

  const balanceId = (balance as { id: string }).id;

  const idempotencyKey = `credit_purchase:${paymentIntentId}`;

  const { error: ledErr } = await admin.from('class_credit_ledger').insert({
    balance_id: balanceId,
    user_id: userId,
    venue_id: venueId,
    delta_credits: creditsCount,
    reason: 'purchase',
    stripe_payment_intent_id: paymentIntentId,
    idempotency_key: idempotencyKey,
    note: 'Credit pack purchase',
  });

  if (ledErr) {
    console.error('[fulfillClassCreditPurchase] ledger insert failed', ledErr);
    await admin.from('user_class_credit_balances').delete().eq('id', balanceId);
    await admin.from('class_credit_purchase_fulfillments').delete().eq('stripe_payment_intent_id', paymentIntentId);
    return { fulfilled: false, reason: 'ledger_insert_failed' };
  }

  await admin
    .from('class_credit_purchase_fulfillments')
    .update({ balance_id: balanceId })
    .eq('stripe_payment_intent_id', paymentIntentId);

  // Phase 2 §5.5 — receipt email. Best-effort; failures don't unwind fulfilment.
  try {
    await sendClassCommerceComm({
      venueId,
      userId,
      payload: {
        key: 'class_credits_purchased',
        vars: {
          venueName: '',
          packName: (product as { name?: string | null }).name?.trim() || 'class credits',
          creditsCount,
          expiresAtIso: expiresAt,
        },
      },
    });
  } catch (commsErr) {
    console.error('[fulfillClassCreditPurchase] receipt comms failed', commsErr);
  }

  return { fulfilled: true };
}
