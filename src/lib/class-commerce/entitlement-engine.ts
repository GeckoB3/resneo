import type { ClassPaymentRequirement } from '@/types/booking-models';

export type ClassLineEntitlementKind = 'free' | 'course' | 'membership' | 'credits' | 'stripe';

export interface ClassLineEntitlementDecision {
  kind: ClassLineEntitlementKind;
  /** Card amount in pence when `kind === 'stripe'`. */
  stripeAmountPence: number;
  /** Credits to redeem when `kind === 'credits'` (typically party size). */
  creditsToRedeem: number;
  paymentRequirement: ClassPaymentRequirement;
}

/**
 * Decide how a single class cart line should be settled.
 *
 * This is the **single source of truth** for entitlement precedence, per
 * `Docs/CLASS_COMMERCE_PRODUCT_RULES.md` §1/§15. The order, from first applied
 * to last, is:
 *
 *   1. Free line (no online charge)                          → `free`
 *   2. Course bundle / series coverage (active enrollment)   → `course`
 *   3. Membership coverage (unlimited or allowance plan)     → `membership`
 *   4. Class credits — only when the guest opted to pay with
 *      credits AND the balance covers the party size         → `credits`
 *   5. Card (Stripe)                                          → `stripe`
 *
 * Course and membership coverage are settled BEFORE consuming a credit, so a
 * member/enrollee never burns a credit for a session already covered. Credits
 * are consumed only when the guest explicitly opted in (`payWithClassCredits`).
 */
export function decideClassLineEntitlement(params: {
  onlineChargePence: number;
  paymentRequirement: ClassPaymentRequirement;
  /** Whether an active paid course enrollment covers this session. */
  courseCovers: boolean;
  /** Whether an active membership (unlimited or allowance) covers this session. */
  membershipCovers: boolean;
  /** Whether the guest opted to pay with class credits for this checkout. */
  payWithClassCredits: boolean;
  creditsAvailableForClassType: number;
  partySize: number;
}): ClassLineEntitlementDecision {
  const {
    onlineChargePence,
    paymentRequirement,
    courseCovers,
    membershipCovers,
    payWithClassCredits,
    creditsAvailableForClassType,
    partySize,
  } = params;

  // 1. No online charge — nothing to settle.
  if (onlineChargePence <= 0) {
    return {
      kind: 'free',
      stripeAmountPence: 0,
      creditsToRedeem: 0,
      paymentRequirement,
    };
  }

  // 2. Course bundle / series coverage takes precedence over everything else.
  if (courseCovers) {
    return {
      kind: 'course',
      stripeAmountPence: 0,
      creditsToRedeem: 0,
      paymentRequirement,
    };
  }

  // 3. Membership coverage settles the line before any credit is consumed.
  if (membershipCovers) {
    return {
      kind: 'membership',
      stripeAmountPence: 0,
      creditsToRedeem: 0,
      paymentRequirement,
    };
  }

  // 4. Class credits — only when the guest opted in and the balance covers it.
  if (payWithClassCredits && creditsAvailableForClassType >= partySize) {
    return {
      kind: 'credits',
      stripeAmountPence: 0,
      creditsToRedeem: partySize,
      paymentRequirement,
    };
  }

  // 5. Fall back to the card.
  return {
    kind: 'stripe',
    stripeAmountPence: onlineChargePence,
    creditsToRedeem: 0,
    paymentRequirement,
  };
}
