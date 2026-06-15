import { isAppointmentPlanTier, isRestaurantTableProductTier } from '@/lib/tier-enforcement';

/** Appointments SKU vs Restaurant / Founding SKU (matches signup `plan` query). */
export type SignupPlanFamily = 'appointments' | 'restaurant';

export function signupPlanToFamily(
  plan: 'appointments' | 'plus' | 'light' | 'restaurant' | 'founding',
): SignupPlanFamily {
  return plan === 'appointments' || plan === 'plus' || plan === 'light' ? 'appointments' : 'restaurant';
}

export function pricingTierToSignupFamily(tier: string | null | undefined): SignupPlanFamily {
  if (isRestaurantTableProductTier(tier)) return 'restaurant';
  if (isAppointmentPlanTier(tier)) return 'appointments';
  return 'appointments';
}

export const SIGNUP_PLAN_CONFLICT_MESSAGE =
  'Your account already has a ResNeo plan. Sign in to the dashboard to manage your subscription. You cannot subscribe to both the Appointments plan and the Restaurant plan on one account. Contact support if you need to change plan type.';
