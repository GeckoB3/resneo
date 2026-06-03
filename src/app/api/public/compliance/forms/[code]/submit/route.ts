import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { submitPublicForm } from '@/lib/compliance/public-forms-service';
import { clientIpFromHeaders, rateLimit } from '@/lib/compliance/rate-limit';

const CODE_RE = /^[0-9a-z]{8,12}$/;
const SUBMITS_PER_CODE_PER_HOUR = 10;

/** POST /api/public/compliance/forms/[code]/submit — submit responses (no auth, single-use). */
export async function POST(request: NextRequest, ctx: { params: { code: string } | Promise<{ code: string }> }) {
  try {
    const { code } = await Promise.resolve(ctx.params);
    if (!CODE_RE.test(code)) {
      return NextResponse.json({ error: 'Invalid link.', reason: 'not_found' }, { status: 404 });
    }

    const limit = rateLimit(`compliance-submit:${code}`, SUBMITS_PER_CODE_PER_HOUR, 60 * 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
      );
    }

    const body = await request.json().catch(() => null);
    const responses = body && typeof body === 'object' ? (body as { responses?: unknown }).responses : null;

    const admin = getSupabaseAdminClient();
    const ip = clientIpFromHeaders(request.headers);
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
