import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { insertContactAuditEvent } from '@/lib/guests/contact-audit';
import { resolveGuestDocumentScope } from '@/lib/guests/linked-guest-access';

const BUCKET = 'guest-documents';

const patchSchema = z.object({
  file_name: z.string().min(1).max(200).optional(),
  category: z.string().max(60).nullable().optional(),
});

/**
 * PATCH /api/venue/guests/[guestId]/documents/[documentId] — rename / category.
 * DELETE — soft delete + remove object from storage.
 *
 * DELETE accepts `owner_venue_id` for a linked venue's guest (R26). Destroying a file the
 * owner venue holds needs their FULL MANAGEMENT grant, not merely an edit grant, matching
 * booking cancel and booking delete. PATCH stays own-venue only: renaming a partner's file
 * was not asked for and has no caller.
 */
export async function PATCH(
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
    const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const update: Record<string, unknown> = {};
    if (parsed.data.file_name !== undefined) update.file_name = parsed.data.file_name.trim();
    if (parsed.data.category !== undefined) update.category = parsed.data.category;

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No changes' }, { status: 400 });
    }

    const { data, error } = await staff.db
      .from('guest_documents')
      .update(update)
      .eq('id', documentId)
      .eq('guest_id', guestId)
      .eq('venue_id', staff.venue_id)
      .is('deleted_at', null)
      .select('id, file_name, category')
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    await insertContactAuditEvent(staff.db, {
      venue_id: staff.venue_id,
      guest_id: guestId,
      actor_staff_id: staff.id,
      event_type: 'guest_document_updated',
      metadata: { document_id: documentId, patch: parsed.data },
    });

    return NextResponse.json({ document: data });
  } catch (err) {
    console.error('PATCH guest document failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
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

    const scoped = await resolveGuestDocumentScope(staff, request, guestId, 'delete');
    if (!scoped.ok) {
      return NextResponse.json({ error: scoped.error }, { status: scoped.status });
    }
    const { venueId: scopeVenueId, auditMetadata } = scoped.scope;

    const { data: doc, error: fErr } = await staff.db
      .from('guest_documents')
      .select('id, storage_path')
      .eq('id', documentId)
      .eq('guest_id', guestId)
      .eq('venue_id', scopeVenueId)
      .is('deleted_at', null)
      .maybeSingle();

    if (fErr || !doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const storagePath = (doc as { storage_path: string }).storage_path;

    const { error: rmErr } = await staff.db.storage.from(BUCKET).remove([storagePath]);
    if (rmErr) {
      console.warn('storage remove failed (continuing soft delete):', rmErr.message);
    }

    const { error: uErr } = await staff.db
      .from('guest_documents')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', documentId)
      .eq('venue_id', scopeVenueId);

    if (uErr) {
      console.error('soft delete document failed:', uErr);
      return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 });
    }

    await insertContactAuditEvent(staff.db, {
      venue_id: scopeVenueId,
      guest_id: guestId,
      actor_staff_id: staff.id,
      event_type: 'guest_document_deleted',
      metadata: { document_id: documentId, ...auditMetadata },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE guest document failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
