import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';
import {
  buildCheckoutLineItems,
  buildSignupCheckoutSubscriptionData,
} from '@/lib/stripe/subscription-line-items';

export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/stripe-health/smoke-test
 *
 * Active check: for each base plan, open a real subscription Checkout Session with its
 * live price IDs (base plan + metered SMS overage, exactly as the signup flow builds them)
 * then immediately expire it. This proves the prices are chargeable together and the
 * account can open subscription checkouts. No customer is created and no payment is taken
 * because the session is expired before completion — safe to run in live mode.
 */
const PLANS: Array<{ label: string; envKey: string }> = [
  { label: 'Appointments Pro', envKey: 'STRIPE_APPOINTMENTS_PRO_PRICE_ID' },
  { label: 'Appointments Plus', envKey: 'STRIPE_APPOINTMENTS_PLUS_PRICE_ID' },
  { label: 'Appointments Light', envKey: 'STRIPE_LIGHT_PRICE_ID' },
  { label: 'Restaurant', envKey: 'STRIPE_RESTAURANT_PRICE_ID' },
];

interface SmokeResult {
  label: string;
  env_key: string;
  ok: boolean;
  error: string | null;
  session_id: string | null;
  expired: boolean;
}

export async function POST(request: NextRequest) {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;

  const origin =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : request.nextUrl.origin);

  const results: SmokeResult[] = await Promise.all(
    PLANS.map(async (plan): Promise<SmokeResult> => {
      const priceId = process.env[plan.envKey]?.trim();
      if (!priceId) {
        return { label: plan.label, env_key: plan.envKey, ok: false, error: `${plan.envKey} is not set.`, session_id: null, expired: false };
      }

      let sessionId: string | null = null;
      try {
        const session = await stripe.checkout.sessions.create({
          mode: 'subscription',
          line_items: buildCheckoutLineItems(priceId, 1),
          subscription_data: buildSignupCheckoutSubscriptionData(),
          success_url: `${origin}/signup/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/signup/payment`,
        });
        sessionId = session.id;

        let expired = false;
        try {
          await stripe.checkout.sessions.expire(session.id);
          expired = true;
        } catch {
          // Session may already be terminal; creation still succeeded, which is what we test.
          expired = false;
        }

        return { label: plan.label, env_key: plan.envKey, ok: true, error: null, session_id: sessionId, expired };
      } catch (e) {
        return {
          label: plan.label,
          env_key: plan.envKey,
          ok: false,
          error: e instanceof Error ? e.message : 'Checkout session creation failed.',
          session_id: sessionId,
          expired: false,
        };
      }
    }),
  );

  return NextResponse.json({
    ok: results.every((r) => r.ok),
    results,
    note: 'Each plan opens a real subscription Checkout Session with its live price IDs, then immediately expires it. No customer is created and no payment is taken.',
    generated_at: new Date().toISOString(),
  });
}
