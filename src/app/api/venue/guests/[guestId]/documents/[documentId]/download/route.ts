import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { insertContactAuditEvent } from '@/lib/guests/contact-audit';

const BUCKET = 'guest-documents';

/**
 * GET /api/venue/guests/[guestId]/documents/[documentId]/download — short-lived read URL.
 *
 * `?intent=view` marks the read as an in-app view (the Records viewer) rather than a
 * download, so the contact's audit trail says which happened.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ guestId: string; documentId: string }> },
) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { guestId, documentId } = await params;
    const intent = request.nextUrl.searchParams.get('intent') === 'view' ? 'view' : 'download';

    const { data: doc, error: fErr } = await staff.db
      .from('guest_documents')
      .select('id, storage_path, uploaded_at, deleted_at')
      .eq('id', documentId)
      .eq('guest_id', guestId)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (fErr || !doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const row = doc as { storage_path: string; uploaded_at: string | null; deleted_at: string | null };
    if (row.deleted_at || !row.uploaded_at) {
      return NextResponse.json({ error: 'Document not available' }, { status: 400 });
    }

    const signed = await staff.db.storage.from(BUCKET).createSignedUrl(row.storage_path, 120);

    if (signed.error || !signed.data?.signedUrl) {
      console.error('createSignedUrl failed:', signed.error);
      return NextResponse.json({ error: 'Could not create download URL' }, { status: 500 });
    }

    await insertContactAuditEvent(staff.db, {
      venue_id: staff.venue_id,
      guest_id: guestId,
      actor_staff_id: staff.id,
      event_type: intent === 'view' ? 'guest_document_view' : 'guest_document_download',
      metadata: { document_id: documentId },
    });

    return NextResponse.json({ url: signed.data.signedUrl, expires_in: 120 });
  } catch (err) {
    console.error('GET document download failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
