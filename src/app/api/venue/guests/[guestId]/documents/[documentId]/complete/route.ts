import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { insertContactAuditEvent } from '@/lib/guests/contact-audit';

/**
 * POST /api/venue/guests/[guestId]/documents/[documentId]/complete — mark upload finished.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ guestId: string; documentId: string }> },
) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { guestId, documentId } = await params;

    const { data: doc, error: fErr } = await staff.db
      .from('guest_documents')
      .select('id, uploaded_at')
      .eq('id', documentId)
      .eq('guest_id', guestId)
      .eq('venue_id', staff.venue_id)
      .is('deleted_at', null)
      .maybeSingle();

    if (fErr || !doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    if ((doc as { uploaded_at?: string | null }).uploaded_at) {
      return NextResponse.json({ success: true, already_complete: true });
    }

    const { error: uErr } = await staff.db
      .from('guest_documents')
      .update({ uploaded_at: new Date().toISOString() })
      .eq('id', documentId)
      .eq('venue_id', staff.venue_id);

    if (uErr) {
      console.error('complete document failed:', uErr);
      return NextResponse.json({ error: 'Failed to complete upload' }, { status: 500 });
    }

    await insertContactAuditEvent(staff.db, {
      venue_id: staff.venue_id,
      guest_id: guestId,
      actor_staff_id: staff.id,
      event_type: 'guest_document_uploaded',
      metadata: { document_id: documentId },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('POST document complete failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
