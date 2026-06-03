import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import {
  COMPLIANCE_BUCKET,
  COMPLIANCE_FILE_ALLOWED_MIME,
  COMPLIANCE_FILE_MAX_BYTES,
} from '@/lib/compliance/files';
import { clientIpFromHeaders, rateLimit } from '@/lib/compliance/rate-limit';

const CODE_RE = /^[0-9a-z]{8,12}$/;
const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
};

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
    if (!COMPLIANCE_FILE_ALLOWED_MIME.includes(file.type as (typeof COMPLIANCE_FILE_ALLOWED_MIME)[number])) {
      return NextResponse.json(
        { error: 'Unsupported file type. Use PDF, JPEG, PNG, HEIC or WebP.' },
        { status: 400 },
      );
    }
    if (file.size <= 0 || file.size > COMPLIANCE_FILE_MAX_BYTES) {
      return NextResponse.json({ error: 'File must be between 0 and 10 MB.' }, { status: 400 });
    }

    const ext = EXT_BY_MIME[file.type] ?? 'bin';
    const storagePath = `venues/${l.venue_id}/uploads/${code}/${crypto.randomUUID()}.${ext}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const { error: upErr } = await admin.storage.from(COMPLIANCE_BUCKET).upload(storagePath, bytes, {
      contentType: file.type,
      upsert: false,
    });
    if (upErr) {
      console.error('[public compliance file upload] failed:', upErr.message);
      return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 });
    }

    return NextResponse.json({
      storage_path: storagePath,
      file_name: file.name.slice(0, 500),
      mime_type: file.type,
      file_size_bytes: file.size,
    });
  } catch (err) {
    console.error('POST /api/public/compliance/forms/[code]/file failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
