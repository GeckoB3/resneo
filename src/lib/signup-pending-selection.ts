import type { PlanTier } from '@/types/plan-tier';

/** Stored on the auth user while signup is in progress (before a venue exists). */
export const SIGNUP_PENDING_PLAN_KEY = 'signup_pending_plan';
export const SIGNUP_PENDING_BUSINESS_TYPE_KEY = 'signup_pending_business_type';

export type SignupPendingPlan = PlanTier;

/** Plans that can appear in the pending-signup metadata. */
const SIGNUP_PENDING_PLANS: readonly SignupPendingPlan[] = [
  'appointments',
  'plus',
  'light',
  'restaurant',
  'founding',
];

/**
 * True when the user has progressed far enough in the funnel to show the order summary / payment step.
 * Mirrors sessionStorage rules on the payment page and create-checkout validation.
 */
export function isSignupPaymentReady(
  plan: SignupPendingPlan | string | null | undefined,
  businessType: string | null | undefined,
): boolean {
  if (!plan) return false;
  if (plan === 'appointments' || plan === 'plus' || plan === 'light') return true;
  if (plan === 'restaurant' || plan === 'founding') return !!businessType?.trim();
  return false;
}

/**
 * Read the durable signup-in-progress selection from an auth user's `user_metadata`.
 * This is the device-independent resume signal (it survives logout and device switches),
 * unlike the sessionStorage copy used by the public funnel pages.
 */
export function readSignupPendingFromMetadata(
  meta: Record<string, unknown> | null | undefined,
): { plan: SignupPendingPlan | null; businessType: string | null } {
  const rawPlan = meta?.[SIGNUP_PENDING_PLAN_KEY];
  const rawBt = meta?.[SIGNUP_PENDING_BUSINESS_TYPE_KEY];
  const plan =
    typeof rawPlan === 'string' && (SIGNUP_PENDING_PLANS as readonly string[]).includes(rawPlan)
      ? (rawPlan as SignupPendingPlan)
      : null;
  const businessType = typeof rawBt === 'string' && rawBt.trim() ? rawBt.trim() : null;
  return { plan, businessType };
}
