import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { submitPublicForm } from '@/lib/compliance/public-forms-service';
import { clientIpFromHeaders, rateLimit } from '@/lib/compliance/rate-limit';

const CODE_RE = /^[0-9a-z]{8,12}$/;
const SUBMITS_PER_CODE_PER_HOUR = 10;
const SUBMITS_PER_IP_PER_HOUR = 40;

/** POST /api/public/compliance/forms/[code]/submit — submit responses (no auth, single-use). */
export async function POST(request: NextRequest, ctx: { params: { code: string } | Promise<{ code: string }> }) {
  try {
    const { code } = await Promise.resolve(ctx.params);
    if (!CODE_RE.test(code)) {
      return NextResponse.json({ error: 'Invalid link.', reason: 'not_found' }, { status: 404 });
    }

    const ip = clientIpFromHeaders(request.headers);
    const tooMany = { error: 'Too many attempts. Please try again later.' };
    // Per-code (a single link) AND per-IP (across many codes, blunting enumeration, audit Low).
    const codeLimit = rateLimit(`compliance-submit:${code}`, SUBMITS_PER_CODE_PER_HOUR, 60 * 60 * 1000);
    if (!codeLimit.allowed) {
      return NextResponse.json(tooMany, { status: 429, headers: { 'Retry-After': String(codeLimit.retryAfterSeconds) } });
    }
    const ipLimit = rateLimit(`compliance-submit-ip:${ip}`, SUBMITS_PER_IP_PER_HOUR, 60 * 60 * 1000);
    if (!ipLimit.allowed) {
      return NextResponse.json(tooMany, { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfterSeconds) } });
    }

    const body = await request.json().catch(() => null);
    const responses = body && typeof body === 'object' ? (body as { responses?: unknown }).responses : null;

    const admin = getSupabaseAdminClient();
    const userAgent = request.headers.get('user-agent');

    const result = await submitPublicForm(admin, { code, responses, ip, userAgent });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, reason: result.reason, field_errors: result.fieldErrors },
        { status: result.status },
      );
    }
    return NextResponse.json({ success: true, record_id: result.recordId, type_name: result.typeName }, { status: 201 });
  } catch (err) {
    console.error('POST /api/public/compliance/forms/[code]/submit failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
