/**
 * Referral programme constants. See Docs/REFERRAL_PROGRAMME_PLAN.md.
 *
 * Reward amounts are inc-VAT and equal each plan's monthly price.
 * Overridable via env vars so finance can adjust without a release.
 */

import {
  APPOINTMENTS_LIGHT_PRICE,
  APPOINTMENTS_PLUS_PRICE,
  APPOINTMENTS_PRO_PRICE,
  RESTAURANT_PRICE,
} from '@/lib/pricing-constants';

export const REFERRAL_REFEREE_BONUS_DAYS = Number(
  process.env.REFERRAL_REFEREE_BONUS_DAYS ?? 30,
);

export const REFERRAL_MAX_UNREDEEMED_CREDITS = Number(
  process.env.REFERRAL_MAX_UNREDEEMED_CREDITS ?? 6,
);

/** Master kill-switch. Defaults to true. Set to 'false' to disable end-to-end. */
export function referralProgrammeEnabled(): boolean {
  return (process.env.REFERRAL_PROGRAMME_ENABLED ?? 'true').toLowerCase() !== 'false';
}

/** Allowed venue plan_status values for a referrer code to be considered active. */
export const REFERRER_GOOD_STANDING_STATUSES = new Set([
  'active',
  'trialing',
  'cancelling',
]);

/**
 * Reward in pence for the referrer, keyed by referrer's pricing_tier.
 * Defaults equal the inc-VAT monthly price (Light £20, Plus £49, Pro £99, Restaurant £79).
 * Founding (free) referrers default to Restaurant price since they will move to that tier.
 */
export function referralRewardPenceForTier(
  tier: string | null | undefined,
): number {
  const t = (tier ?? '').toLowerCase().trim();
  switch (t) {
    case 'light':
      return Number(
        process.env.REFERRAL_REWARD_LIGHT_PENCE ?? APPOINTMENTS_LIGHT_PRICE * 100,
      );
    case 'plus':
      return Number(
        process.env.REFERRAL_REWARD_PLUS_PENCE ?? APPOINTMENTS_PLUS_PRICE * 100,
      );
    case 'appointments':
      return Number(
        process.env.REFERRAL_REWARD_APPOINTMENTS_PENCE ?? APPOINTMENTS_PRO_PRICE * 100,
      );
    case 'restaurant':
    case 'founding':
      return Number(
        process.env.REFERRAL_REWARD_RESTAURANT_PENCE ?? RESTAURANT_PRICE * 100,
      );
    default:
      // Conservative default: lowest reward.
      return Number(
        process.env.REFERRAL_REWARD_LIGHT_PENCE ?? APPOINTMENTS_LIGHT_PRICE * 100,
      );
  }
}

/** Human display, e.g. 9900 -> "£99". */
export function formatGbpPence(pence: number): string {
  const pounds = pence / 100;
  if (Number.isInteger(pounds)) {
    return `£${pounds.toFixed(0)}`;
  }
  return `£${pounds.toFixed(2)}`;
}
