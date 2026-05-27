/**
 * Anti-abuse checks for new referrals. Run server-side at venue creation
 * before we mark a referral as `referee_signed_up`.
 *
 * Failures DO NOT throw — the caller persists a void referrals row with
 * `void_reason` set, so we have an audit trail without breaking signup.
 *
 * Companies House check is intentionally omitted — the field isn't currently
 * stored on `venues`. See plan §15.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/stripe';

export type SelfReferralReason =
  | 'self_referral_same_email_domain'
  | 'self_referral_same_card_fingerprint';

interface SelfReferralCheckParams {
  admin: SupabaseClient;
  referrerVenueId: string;
  referredVenueId: string;
  refereeEmail: string | null | undefined;
}

function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  return email.slice(at + 1).trim().toLowerCase() || null;
}

async function fetchVenueIdentity(
  admin: SupabaseClient,
  venueId: string,
): Promise<{ email: string | null; stripe_customer_id: string | null } | null> {
  const { data, error } = await admin
    .from('venues')
    .select('email, stripe_customer_id')
    .eq('id', venueId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    email: (data as { email?: string | null }).email ?? null,
    stripe_customer_id: (data as { stripe_customer_id?: string | null }).stripe_customer_id ?? null,
  };
}

async function fetchDefaultCardFingerprint(stripeCustomerId: string | null): Promise<string | null> {
  if (!stripeCustomerId) return null;
  try {
    const pms = await stripe.paymentMethods.list({
      customer: stripeCustomerId,
      type: 'card',
      limit: 1,
    });
    const card = pms.data[0]?.card;
    return card?.fingerprint ?? null;
  } catch (e) {
    console.warn('[referrals/anti-abuse] paymentMethods.list failed', { stripeCustomerId, e });
    return null;
  }
}

/**
 * Returns a void reason if this looks like self-referral, else null.
 * Best-effort: any Stripe call failure is treated as "no signal", not a block.
 */
export async function detectSelfReferral(
  params: SelfReferralCheckParams,
): Promise<SelfReferralReason | null> {
  const { admin, referrerVenueId, referredVenueId, refereeEmail } = params;

  if (referrerVenueId === referredVenueId) {
    return 'self_referral_same_email_domain';
  }

  const referrer = await fetchVenueIdentity(admin, referrerVenueId);
  if (!referrer) return null;

  // 1) Email-domain match.
  const refereeDomain = emailDomain(refereeEmail);
  const referrerDomain = emailDomain(referrer.email);
  if (refereeDomain && referrerDomain && refereeDomain === referrerDomain) {
    // Ignore extremely common consumer providers — operators often use the
    // same gmail-style address across unrelated businesses.
    const generic = new Set([
      'gmail.com',
      'googlemail.com',
      'hotmail.com',
      'hotmail.co.uk',
      'outlook.com',
      'outlook.co.uk',
      'yahoo.com',
      'yahoo.co.uk',
      'icloud.com',
      'me.com',
      'live.com',
      'live.co.uk',
      'aol.com',
      'btinternet.com',
    ]);
    if (!generic.has(refereeDomain)) {
      return 'self_referral_same_email_domain';
    }
  }

  // 2) Card fingerprint match (only meaningful once both venues have a card).
  const referred = await fetchVenueIdentity(admin, referredVenueId);
  if (referrer.stripe_customer_id && referred?.stripe_customer_id) {
    const [a, b] = await Promise.all([
      fetchDefaultCardFingerprint(referrer.stripe_customer_id),
      fetchDefaultCardFingerprint(referred.stripe_customer_id),
    ]);
    if (a && b && a === b) {
      return 'self_referral_same_card_fingerprint';
    }
  }

  return null;
}
