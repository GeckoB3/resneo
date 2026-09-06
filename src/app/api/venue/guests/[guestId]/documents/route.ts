import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { resolveGuestDocumentScope } from '@/lib/guests/linked-guest-access';

const BUCKET = 'guest-documents';
/** How long a thumbnail link lasts; the list is fetched afresh whenever the section opens. */
const PREVIEW_TTL_SECONDS = 15 * 60;

/** Files the dashboard can show inline: photos as thumbnails, PDFs in the viewer. */
export function isPreviewableDocument(mimeType: string | null | undefined): boolean {
  const mime = (mimeType ?? '').toLowerCase();
  return mime.startsWith('image/') || mime === 'application/pdf';
}

/**
 * GET /api/venue/guests/[guestId]/documents — list completed uploads for guest.
 *
 * Accepts `owner_venue_id` so the Records card also works on a linked venue's booking
 * (R26): a full_details link that shares PII may read the owner venue's files.
 *
 * Photos and PDFs carry a short-lived `preview_url` so the Records section can
 * show a thumbnail and open the file in place; other files get `null` and are
 * downloaded through the download route as before.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ guestId: string }> },
) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { guestId } = await params;

    const scoped = await resolveGuestDocumentScope(staff, request, guestId, 'read');
    if (!scoped.ok) {
      return NextResponse.json({ error: scoped.error }, { status: scoped.status });
    }
    const scopeVenueId = scoped.scope.venueId;

    const { data, error } = await staff.db
      .from('guest_documents')
      .select('id, file_name, mime_type, file_size_bytes, category, created_at, uploaded_at, storage_path')
      .eq('venue_id', scopeVenueId)
      .eq('guest_id', guestId)
      .is('deleted_at', null)
      .not('uploaded_at', 'is', null)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('GET guest documents failed:', error);
      return NextResponse.json({ error: 'Failed to list documents' }, { status: 500 });
    }

    const rows = (data ?? []) as Array<{
      id: string;
      file_name: string;
      mime_type: string | null;
      file_size_bytes: number | null;
      category: string | null;
      created_at: string;
      uploaded_at: string | null;
      storage_path: string;
    }>;

    const previewPaths = rows.filter((r) => isPreviewableDocument(r.mime_type)).map((r) => r.storage_path);
    const previewByPath = new Map<string, string>();
    if (previewPaths.length > 0) {
      const signed = await staff.db.storage.from(BUCKET).createSignedUrls(previewPaths, PREVIEW_TTL_SECONDS);
      if (signed.error) {
        // Thumbnails are a convenience; the list itself still answers.
        console.error('createSignedUrls for document previews failed:', signed.error);
      }
      for (const item of signed.data ?? []) {
        if (item.path && item.signedUrl && !item.error) previewByPath.set(item.path, item.signedUrl);
      }
    }

    return NextResponse.json({
      documents: rows.map(({ storage_path, ...rest }) => ({
        ...rest,
        preview_url: previewByPath.get(storage_path) ?? null,
      })),
    });
  } catch (err) {
    console.error('GET /api/venue/guests/[guestId]/documents failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
