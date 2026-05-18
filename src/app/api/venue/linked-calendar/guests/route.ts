import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveCallerGrantOverVenue } from '@/lib/linked-accounts/queries';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/venue/linked-calendar/guests?venueId=&q= — search a linked venue's
 * clients, for the cross-venue "new booking" form. Requires a create-capable
 * link with PII granted: a venue that can create bookings (create_edit_cancel)
 * always also has PII (§5.5), so guest lookup is safe here.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const staff = await getVenueStaff(supabase);
  if (!staff) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const venueId = request.nextUrl.searchParams.get('venueId') ?? '';
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
  if (!UUID_RE.test(venueId)) {
    return NextResponse.json({ error: 'A valid venueId is required.' }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdminClient();
    const access = await resolveCallerGrantOverVenue(admin, staff.venue_id, venueId);
    if (!access || access.grant.act !== 'create_edit_cancel' || !access.grant.pii) {
      return NextResponse.json(
        { error: 'You cannot look up clients for that venue.' },
        { status: 403 },
      );
    }

    let query = admin
      .from('guests')
      .select('id, name, first_name, last_name, email')
      .eq('venue_id', venueId)
      .order('name', { ascending: true })
      .limit(20);
    if (q.length > 0) {
      const safe = q.replace(/[%,()]/g, ' ');
      query = query.or(
        `name.ilike.%${safe}%,first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,email.ilike.%${safe}%`,
      );
    }
    const { data, error } = await query;
    if (error) {
      console.error('linked-calendar guest search failed:', error.message);
      return NextResponse.json({ error: 'Failed to search clients.' }, { status: 500 });
    }

    const guests = (data ?? []).map((g) => {
      const composed = [g.first_name, g.last_name]
        .filter((x): x is string => Boolean(x))
        .join(' ')
        .trim();
      return {
        id: g.id as string,
        name: composed || (g.name as string) || 'Client',
        email: (g.email as string | null) ?? null,
      };
    });
    return NextResponse.json({ guests });
  } catch (err) {
    console.error('GET /api/venue/linked-calendar/guests failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
