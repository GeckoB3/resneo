import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { uploadComplianceFile } from '@/lib/compliance/files';
import { clientIpFromHeaders, rateLimit } from '@/lib/compliance/rate-limit';

const CODE_RE = /^[0-9a-z]{8,12}$/;

/**
 * POST /api/public/compliance/forms/[code]/file — upload a `file`-field document for
 * a public submission. Validates the link, MIME and size server-side (§13.3), stores
 * under a per-link temp path, and returns the FileResponse the form submit expects.
 */
export async function POST(request: NextRequest, ctx: { params: { code: string } | Promise<{ code: string }> }) {
  try {
    const { code } = await Promise.resolve(ctx.params);
    if (!CODE_RE.test(code)) return NextResponse.json({ error: 'Invalid link.' }, { status: 404 });

    const limit = rateLimit(`compliance-file:${clientIpFromHeaders(request.headers)}`, 20, 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many uploads. Please slow down.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
      );
    }

    const admin = getSupabaseAdminClient();
    const { data: link } = await admin
      .from('compliance_form_links')
      .select('venue_id, status, expires_at')
      .eq('code', code)
      .maybeSingle();
    const l = link as { venue_id: string; status: string; expires_at: string } | null;
    if (!l || l.status !== 'pending' || new Date(l.expires_at).getTime() <= Date.now()) {
      return NextResponse.json({ error: 'This form is no longer available.' }, { status: 410 });
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }

    const uploaded = await uploadComplianceFile(admin, {
      storagePrefix: `venues/${l.venue_id}/uploads/${code}`,
      file,
    });
    if (!uploaded.ok) return NextResponse.json({ error: uploaded.error }, { status: uploaded.status });
    return NextResponse.json(uploaded.value);
  } catch (err) {
    console.error('POST /api/public/compliance/forms/[code]/file failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
