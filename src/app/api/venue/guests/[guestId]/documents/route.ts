import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';

/**
 * GET /api/venue/guests/[guestId]/documents — list completed uploads for guest.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ guestId: string }> },
) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { guestId } = await params;

    const { data: guest, error: gErr } = await staff.db
      .from('guests')
      .select('id')
      .eq('id', guestId)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (gErr || !guest) {
      return NextResponse.json({ error: 'Guest not found' }, { status: 404 });
    }

    const { data, error } = await staff.db
      .from('guest_documents')
      .select('id, file_name, mime_type, file_size_bytes, category, created_at, uploaded_at')
      .eq('venue_id', staff.venue_id)
      .eq('guest_id', guestId)
      .is('deleted_at', null)
      .not('uploaded_at', 'is', null)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('GET guest documents failed:', error);
      return NextResponse.json({ error: 'Failed to list documents' }, { status: 500 });
    }

    return NextResponse.json({ documents: data ?? [] });
  } catch (err) {
    console.error('GET /api/venue/guests/[guestId]/documents failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
