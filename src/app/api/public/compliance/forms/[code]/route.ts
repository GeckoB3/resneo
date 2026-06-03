import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { loadPublicFormByCode } from '@/lib/compliance/public-forms-service';
import { clientIpFromHeaders, rateLimit } from '@/lib/compliance/rate-limit';

const CODE_RE = /^[0-9a-z]{8,12}$/;
const FORM_GET_PER_IP_PER_MIN = 60;

/** GET /api/public/compliance/forms/[code] — fetch the form schema bound to a link (no auth). */
export async function GET(request: NextRequest, ctx: { params: { code: string } | Promise<{ code: string }> }) {
  try {
    const { code } = await Promise.resolve(ctx.params);
    if (!CODE_RE.test(code)) {
      return NextResponse.json({ error: 'Invalid link.', reason: 'not_found' }, { status: 404 });
    }

    // Throttle per IP so the link-code space can't be brute-forced and the per-call
    // access-count write can't be hammered.
    const limit = rateLimit(`compliance-form-get:${clientIpFromHeaders(request.headers)}`, FORM_GET_PER_IP_PER_MIN, 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
      );
    }

    const admin = getSupabaseAdminClient();
    const result = await loadPublicFormByCode(admin, code);
    if (!result.ok) {
      const status = result.reason === 'not_found' ? 404 : 410;
      return NextResponse.json({ error: 'This form is not available.', reason: result.reason }, { status });
    }
    return NextResponse.json(result.value);
  } catch (err) {
    console.error('GET /api/public/compliance/forms/[code] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
