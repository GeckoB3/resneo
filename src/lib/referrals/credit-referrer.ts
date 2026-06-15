/**
 * Apply the referrer's credit when the referee's first paid invoice settles.
 * Called from invoice.payment_succeeded in src/app/api/webhooks/stripe-subscription/route.ts.
 *
 * Idempotency: the outer webhook claim prevents re-entry on retried events. Inside,
 * we re-check `stripe_balance_transaction_id` before calling Stripe so a manual replay
 * (or two distinct events for the same first invoice) cannot double-credit.
 */

import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/stripe';
import { sendEmail } from '@/lib/emails/send-email';
import { renderReferralCreditedEmail } from '@/lib/emails/templates/referral-credited';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';
import { recordReferralTransition } from './audit';
import {
  REFERRAL_MAX_UNREDEEMED_CREDITS,
  formatGbpPence,
  referralProgrammeEnabled,
  referralRewardPenceForTier,
} from './constants';

function invoiceCustomerId(invoice: Stripe.Invoice): string | null {
  const c = invoice.customer;
  if (typeof c === 'string') return c.trim() || null;
  if (c && typeof c === 'object' && 'id' in c) return (c as Stripe.Customer).id ?? null;
  return null;
}

interface Venue {
  id: string;
  name: string | null;
  email: string | null;
  pricing_tier: string | null;
  stripe_customer_id: string | null;
}

async function loadVenueByStripeCustomer(
  admin: SupabaseClient,
  stripeCustomerId: string,
): Promise<Venue | null> {
  const { data, error } = await admin
    .from('venues')
    .select('id, name, email, pricing_tier, stripe_customer_id')
    .eq('stripe_customer_id', stripeCustomerId)
    .maybeSingle();
  if (error || !data) return null;
  return data as Venue;
}

async function loadVenueById(admin: SupabaseClient, venueId: string): Promise<Venue | null> {
  const { data, error } = await admin
    .from('venues')
    .select('id, name, email, pricing_tier, stripe_customer_id')
    .eq('id', venueId)
    .maybeSingle();
  if (error || !data) return null;
  return data as Venue;
}

/**
 * Belt-and-braces: confirm this is the customer's first paid invoice. The webhook event
 * itself does not say "first" — we list prior invoices for this customer and abort if
 * any earlier one with amount_paid > 0 exists. Cheap (max 5 invoices examined).
 */
async function isFirstPaidInvoice(
  stripeCustomerId: string,
  thisInvoice: Stripe.Invoice,
): Promise<boolean> {
  try {
    const list = await stripe.invoices.list({
      customer: stripeCustomerId,
      limit: 10,
    });
    for (const inv of list.data) {
      if (inv.id === thisInvoice.id) continue;
      const isPaid = (inv.amount_paid ?? 0) > 0 && inv.status === 'paid';
      if (!isPaid) continue;
      const otherCreated = inv.created ?? 0;
      const thisCreated = thisInvoice.created ?? 0;
      if (otherCreated < thisCreated) {
        return false;
      }
    }
    return true;
  } catch (e) {
    console.warn('[referrals/credit] invoices.list failed; assuming first-paid', { e });
    return true;
  }
}

/**
 * Main entry point. Returns true if a credit was applied, false otherwise.
 * Never throws — all failure modes are logged and swallowed so a referral
 * problem cannot break the wider webhook (which also handles SMS allowance etc.).
 */
export async function maybeCreditReferrerForInvoice(
  admin: SupabaseClient,
  invoice: Stripe.Invoice,
): Promise<boolean> {
  if (!referralProgrammeEnabled()) return false;

  // 1) Amount filter — skip £0 trial-end / proration / refund invoices.
  if ((invoice.amount_paid ?? 0) <= 0) return false;
  if (invoice.status !== 'paid') return false;

  // 2) Resolve referee venue from the invoice's customer.
  const customerId = invoiceCustomerId(invoice);
  if (!customerId) return false;
  const refereeVenue = await loadVenueByStripeCustomer(admin, customerId);
  if (!refereeVenue) return false;

  // 3) Find a pending referral for this referee.
  const { data: referralRow, error: refErr } = await admin
    .from('referrals')
    .select('id, code, referrer_venue_id, referred_venue_id, status, stripe_balance_transaction_id')
    .eq('referred_venue_id', refereeVenue.id)
    .maybeSingle();
  if (refErr) {
    console.error('[referrals/credit] referral lookup failed', { refereeVenueId: refereeVenue.id, error: refErr.message });
    return false;
  }
  if (!referralRow) return false;
  if (referralRow.status !== 'referee_signed_up') return false;
  if (referralRow.stripe_balance_transaction_id) {
    console.log('[referrals/credit] referral already credited; ignoring', { referralId: referralRow.id });
    return false;
  }

  // 4) First-paid-invoice guard.
  const firstPaid = await isFirstPaidInvoice(customerId, invoice);
  if (!firstPaid) {
    console.log('[referrals/credit] not first paid invoice; skipping', { referralId: referralRow.id });
    return false;
  }

  // 5) Load referrer.
  const referrerVenue = await loadVenueById(admin, referralRow.referrer_venue_id);
  if (!referrerVenue || !referrerVenue.stripe_customer_id) {
    // Mark as void so the row doesn't sit in referee_signed_up forever. Common cause:
    // the referrer is on a founding (free) plan that has no Stripe customer yet.
    // Operator can manually re-credit later once the referrer has a paid plan.
    console.warn('[referrals/credit] referrer missing stripe_customer_id; marking void', { referrerVenueId: referralRow.referrer_venue_id });
    const reason = 'referrer_has_no_stripe_customer';
    await admin
      .from('referrals')
      .update({ status: 'void', void_reason: reason })
      .eq('id', referralRow.id)
      .eq('status', 'referee_signed_up');
    await recordReferralTransition(admin, {
      referralId: referralRow.id,
      fromStatus: 'referee_signed_up',
      toStatus: 'void',
      detail: { reason },
    });
    return false;
  }

  // 6) Stacking cap.
  const { count: existingCreditCount } = await admin
    .from('referrals')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_venue_id', referrerVenue.id)
    .eq('status', 'credited');

  const overCap =
    (existingCreditCount ?? 0) >= REFERRAL_MAX_UNREDEEMED_CREDITS;

  // 7) Compute reward in pence (snapshot at credit time).
  const rewardPence = referralRewardPenceForTier(referrerVenue.pricing_tier);
  if (rewardPence <= 0) {
    console.warn('[referrals/credit] non-positive reward; skipping', { referrerVenueId: referrerVenue.id, rewardPence });
    return false;
  }

  if (overCap) {
    // Defer per plan §6 step 5: mark credited but don't push to Stripe; void_reason captures it.
    await admin
      .from('referrals')
      .update({
        status: 'credited',
        referrer_credited_at: new Date().toISOString(),
        referrer_credit_amount_pence: rewardPence,
        referrer_credit_currency: 'gbp',
        void_reason: 'queued_over_cap',
      })
      .eq('id', referralRow.id)
      .is('stripe_balance_transaction_id', null);
    await recordReferralTransition(admin, {
      referralId: referralRow.id,
      fromStatus: 'referee_signed_up',
      toStatus: 'credited',
      detail: { queued: true, reason: 'over_cap', rewardPence },
    });
    return false;
  }

  // 8) Apply Stripe balance credit (negative amount = credit to customer).
  // Use an idempotency key keyed to the referral so any retry — webhook replay,
  // network error before our DB update lands — returns the same transaction
  // rather than double-crediting.
  let balanceTx: Stripe.CustomerBalanceTransaction;
  try {
    balanceTx = await stripe.customers.createBalanceTransaction(
      referrerVenue.stripe_customer_id,
      {
        amount: -rewardPence,
        currency: 'gbp',
        description: `Referral reward — referred ${refereeVenue.name ?? 'a ResNeo venue'}`,
        metadata: {
          referral_id: referralRow.id,
          referred_venue_id: refereeVenue.id,
          referrer_venue_id: referrerVenue.id,
          invoice_id: invoice.id ?? '',
        },
      },
      { idempotencyKey: `referral_credit_${referralRow.id}` },
    );
  } catch (e) {
    console.error('[referrals/credit] createBalanceTransaction failed', { referralId: referralRow.id, e });
    return false;
  }

  // 9) Persist on the referral row. The .is(stripe_balance_transaction_id, null) guard
  //    prevents a concurrent retry from overwriting a successful credit.
  const { error: updErr } = await admin
    .from('referrals')
    .update({
      status: 'credited',
      referrer_credited_at: new Date().toISOString(),
      referrer_credit_amount_pence: rewardPence,
      referrer_credit_currency: 'gbp',
      stripe_balance_transaction_id: balanceTx.id,
    })
    .eq('id', referralRow.id)
    .is('stripe_balance_transaction_id', null);

  if (updErr) {
    console.error('[referrals/credit] persist update failed', { referralId: referralRow.id, error: updErr.message });
    // Stripe credit already applied; do not throw or the webhook will retry and create a second credit.
    return false;
  }

  await recordReferralTransition(admin, {
    referralId: referralRow.id,
    fromStatus: 'referee_signed_up',
    toStatus: 'credited',
    detail: {
      invoice_id: invoice.id,
      stripe_balance_transaction_id: balanceTx.id,
      reward_pence: rewardPence,
    },
  });

  // 10) Notify the referrer.
  await sendReferrerCreditedEmail({
    referrerVenue,
    refereeName: refereeVenue.name ?? 'a ResNeo venue',
    rewardPence,
  });

  return true;
}

async function sendReferrerCreditedEmail(params: {
  referrerVenue: Venue;
  refereeName: string;
  rewardPence: number;
}): Promise<void> {
  const to = params.referrerVenue.email?.trim();
  if (!to) {
    console.warn('[referrals/credit] referrer has no email; skipping notification', { referrerVenueId: params.referrerVenue.id });
    return;
  }
  const origin = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
  const dashboardUrl = `${origin}/dashboard/settings?tab=refer-earn`;
  const { html, text } = renderReferralCreditedEmail({
    referrerVenueName: params.referrerVenue.name?.trim() || 'ResNeo',
    refereeVenueName: params.refereeName,
    rewardDisplay: formatGbpPence(params.rewardPence),
    dashboardUrl,
  });
  try {
    await sendEmail({
      to,
      subject: `Your referral signed up — ${formatGbpPence(params.rewardPence)} credit applied`,
      html,
      text,
      fromDisplayName: 'ResNeo',
    });
  } catch (e) {
    console.error('[referrals/credit] sendEmail failed', { referrerVenueId: params.referrerVenue.id, e });
  }
}

/**
 * Mark all `referee_signed_up` referrals for this referee venue as failed.
 * Called from customer.subscription.deleted when the referee's sub is cancelled
 * before their first paid invoice.
 */
export async function markReferralsFailedForReferee(
  admin: SupabaseClient,
  refereeVenueId: string,
  reason: string,
): Promise<void> {
  const { data: rows, error } = await admin
    .from('referrals')
    .select('id, status')
    .eq('referred_venue_id', refereeVenueId)
    .eq('status', 'referee_signed_up');
  if (error || !rows?.length) return;

  for (const row of rows) {
    const id = (row as { id: string }).id;
    const { error: updErr } = await admin
      .from('referrals')
      .update({ status: 'failed', void_reason: reason })
      .eq('id', id)
      .eq('status', 'referee_signed_up');
    if (!updErr) {
      await recordReferralTransition(admin, {
        referralId: id,
        fromStatus: 'referee_signed_up',
        toStatus: 'failed',
        detail: { reason },
      });
    }
  }
}
