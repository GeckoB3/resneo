import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { validateReferralCode } from '@/lib/referrals/lookup';
import { referralProgrammeEnabled } from '@/lib/referrals/constants';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/referrals/validate?code=<code>
 *
 * Public endpoint — used by the signup page to verify a referral code and
 * display the referrer's venue name. Returns only the venue name, never any
 * contact details.
 */
export async function GET(request: Request) {
  if (!referralProgrammeEnabled()) {
    return NextResponse.json({ ok: false, reason: 'disabled' });
  }
  // Public, unauthenticated endpoint — rate-limit per IP to prevent code enumeration.
  const rl = checkRateLimit(getClientIp(request), 'referral-validate', 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, reason: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const admin = getSupabaseAdminClient();
  const result = await validateReferralCode(admin, code);
  if (result.ok) {
    return NextResponse.json({
      ok: true,
      code: result.value.code,
      referrer_venue_name: result.value.referrer_venue_name,
    });
  }
  return NextResponse.json({ ok: false, reason: result.reason });
}
