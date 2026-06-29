import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/stripe-health/smoke-test/connect
 *
 * Active check: create an Express connected account and open an onboarding account
 * link exactly as POST /api/venue/stripe-connect does, then delete the account.
 * This exercises the precise path that 500s when Connect is not fully set up in a
 * given mode (e.g. the live platform profile / loss-liability is incomplete), so a
 * superuser can confirm "a venue can start payment onboarding right now" without
 * waiting for a real user to hit the error.
 *
 * The throwaway account is deleted immediately and never onboarded, so no real
 * connected account lingers. Safe to run in live mode.
 */
interface ConnectSmokeResult {
  ok: boolean;
  account_created: boolean;
  account_link_created: boolean;
  cleaned_up: boolean;
  account_id: string | null;
  error: string | null;
  cleanup_error: string | null;
}

export async function POST(request: NextRequest) {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;

  const origin =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : request.nextUrl.origin);
  const base = origin.replace(/\/$/, '');

  const result: ConnectSmokeResult = {
    ok: false,
    account_created: false,
    account_link_created: false,
    cleaned_up: false,
    account_id: null,
    error: null,
    cleanup_error: null,
  };

  try {
    // 1) Same call the venue onboarding route makes. Email is omitted on purpose:
    //    this is a probe, and an empty email would be rejected anyway.
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'GB',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });
    result.account_created = true;
    result.account_id = account.id;

    // 2) The second call that can throw: the hosted onboarding link.
    await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${base}/dashboard/settings?stripe=refresh`,
      return_url: `${base}/dashboard/settings?stripe=success`,
      type: 'account_onboarding',
    });
    result.account_link_created = true;
    result.ok = true;
  } catch (e) {
    result.error = e instanceof Error ? e.message : 'Connect onboarding probe failed.';
  }

  // 3) Always try to clean up the throwaway account.
  if (result.account_id) {
    try {
      await stripe.accounts.del(result.account_id);
      result.cleaned_up = true;
    } catch (e) {
      result.cleanup_error = e instanceof Error ? e.message : 'Failed to delete the test account.';
    }
  }

  return NextResponse.json({
    ...result,
    note: 'Creates a throwaway Express account and onboarding link exactly as venue setup does, then deletes it. No venue is onboarded and no charge is taken.',
    generated_at: new Date().toISOString(),
  });
}
