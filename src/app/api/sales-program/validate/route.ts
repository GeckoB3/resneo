import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { validateSalesCode } from '@/lib/sales/lookup';
import { salesProgrammeEnabled } from '@/lib/sales/constants';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

export async function GET(request: Request) {
  if (!salesProgrammeEnabled()) {
    return NextResponse.json({ ok: false, reason: 'disabled' });
  }

  // Public, unauthenticated endpoint — rate-limit per IP to prevent code enumeration
  // and salesperson-name harvesting. 20/min is ample for genuine signup-box validation.
  const rl = checkRateLimit(getClientIp(request), 'sales-validate', 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, reason: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const admin = getSupabaseAdminClient();
  const result = await validateSalesCode(admin, code);

  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason });
  }

  return NextResponse.json({
    ok: true,
    code: result.value.code,
    salesperson_name: result.value.salesperson_name,
    trial_days: result.value.trial_days,
  });
}
