import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { insertContactAuditEvent } from '@/lib/guests/contact-audit';

const BUCKET = 'guest-documents';
const MAX_BYTES = 50 * 1024 * 1024;

const bodySchema = z.object({
  file_name: z.string().min(1).max(200),
  mime_type: z.string().max(120).optional(),
  file_size_bytes: z.number().int().positive().max(MAX_BYTES),
  category: z.string().max(60).optional(),
});

function safeFileSegment(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'file';
  return base.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'file';
}

/**
 * POST /api/venue/guests/[guestId]/documents/sign — create DB row + signed upload URL.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ guestId: string }> },
) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { guestId } = await params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const { data: guest, error: gErr } = await staff.db
      .from('guests')
      .select('id')
      .eq('id', guestId)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (gErr || !guest) {
      return NextResponse.json({ error: 'Guest not found' }, { status: 404 });
    }

    const docId = crypto.randomUUID();
    const safeName = safeFileSegment(parsed.data.file_name);
    const storagePath = `${staff.venue_id}/${guestId}/${docId}/${safeName}`;

    const { data: row, error: insErr } = await staff.db
      .from('guest_documents')
      .insert({
        venue_id: staff.venue_id,
        guest_id: guestId,
        storage_path: storagePath,
        file_name: parsed.data.file_name.trim(),
        mime_type: parsed.data.mime_type?.trim() || null,
        file_size_bytes: parsed.data.file_size_bytes,
        category: parsed.data.category?.trim() || null,
        uploaded_by_staff_id: staff.id,
        uploaded_at: null,
      })
      .select('id')
      .single();

    if (insErr || !row) {
      console.error('guest_documents insert failed:', insErr);
      return NextResponse.json({ error: 'Failed to prepare upload' }, { status: 500 });
    }

    const documentId = (row as { id: string }).id;

    const signed = await staff.db.storage.from(BUCKET).createSignedUploadUrl(storagePath);

    if (signed.error || !signed.data?.signedUrl) {
      console.error('createSignedUploadUrl failed:', signed.error);
      await staff.db.from('guest_documents').delete().eq('id', documentId);
      return NextResponse.json({ error: 'Storage sign failed' }, { status: 500 });
    }

    await insertContactAuditEvent(staff.db, {
      venue_id: staff.venue_id,
      guest_id: guestId,
      actor_staff_id: staff.id,
      event_type: 'guest_document_upload_sign',
      metadata: { document_id: documentId, path: storagePath },
    });

    return NextResponse.json({
      document_id: documentId,
      path: storagePath,
      signed_url: signed.data.signedUrl,
      token: signed.data.token ?? null,
    });
  } catch (err) {
    console.error('POST /api/venue/guests/[guestId]/documents/sign failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
