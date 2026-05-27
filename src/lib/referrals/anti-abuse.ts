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
    if (!isGenericConsumerEmailDomain(refereeDomain)) {
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

/**
 * Consumer email providers where a shared domain DOES NOT imply self-referral.
 * Unrelated NI venue operators routinely share addresses on these providers.
 *
 * Sourced from: UK & Ireland ISP/email defaults, big-tech consumer providers,
 * privacy-first mail services, and other widely-used global free providers.
 */
const GENERIC_CONSUMER_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  // Google
  'gmail.com',
  'googlemail.com',
  // Microsoft (Hotmail / Outlook / Live / MSN family)
  'hotmail.com',
  'hotmail.co.uk',
  'hotmail.ie',
  'hotmail.fr',
  'hotmail.de',
  'hotmail.it',
  'hotmail.es',
  'outlook.com',
  'outlook.co.uk',
  'outlook.ie',
  'outlook.fr',
  'outlook.de',
  'outlook.it',
  'outlook.es',
  'live.com',
  'live.co.uk',
  'live.ie',
  'live.fr',
  'live.de',
  'live.it',
  'msn.com',
  'msn.co.uk',
  // Yahoo
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.ie',
  'yahoo.fr',
  'yahoo.de',
  'yahoo.it',
  'yahoo.es',
  'ymail.com',
  'rocketmail.com',
  // Apple
  'icloud.com',
  'me.com',
  'mac.com',
  // AOL
  'aol.com',
  'aol.co.uk',
  // Proton
  'proton.me',
  'protonmail.com',
  'pm.me',
  // GMX / Mail.com
  'gmx.com',
  'gmx.co.uk',
  'gmx.de',
  'mail.com',
  // Fastmail
  'fastmail.com',
  'fastmail.fm',
  // Tutanota
  'tutanota.com',
  'tuta.io',
  'tutamail.com',
  // Zoho (free consumer tier widely used)
  'zoho.com',
  // Yandex
  'yandex.com',
  'yandex.ru',
  // UK / Ireland ISP-issued mailboxes
  'btinternet.com',
  'btopenworld.com',
  'talktalk.net',
  'tiscali.co.uk',
  'virginmedia.com',
  'virgin.net',
  'blueyonder.co.uk',
  'ntlworld.com',
  'sky.com',
  'plus.net',
  'plusnet.com',
  'freeserve.co.uk',
  'orange.net',
  'orange.co.uk',
  'lineone.net',
  'supanet.com',
  'vodafone.net',
  'vodafonemail.de',
  'eircom.net',
  'iol.ie',
  'indigo.ie',
  // Other historically common UK/IE providers
  'cableinet.co.uk',
  'demon.co.uk',
  'compuserve.com',
  'compuserve.co.uk',
  'mac.co.uk',
]);

export function isGenericConsumerEmailDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  return GENERIC_CONSUMER_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}
