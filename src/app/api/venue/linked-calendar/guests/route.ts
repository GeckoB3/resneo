import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClientFromHeaders } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveCallerGrantOverVenue } from '@/lib/linked-accounts/queries';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Shortest query we will run. Below this the caller is browsing, not searching,
 * and browsing a partner venue's whole client book is not something this form
 * needs: the stylist is looking for one named person. An empty query used to
 * return the first 20 clients alphabetically, which walked the list.
 */
const MIN_QUERY_LENGTH = 2;

/**
 * GET /api/venue/linked-calendar/guests?venueId=&q= — search a linked venue's
 * clients, for the cross-venue "new booking" form. Requires a create-capable
 * link with PII granted: a venue that can create bookings (create_edit_cancel)
 * always also has PII (§5.5), so guest lookup is safe here.
 *
 * Names match on substring; email matches on prefix only. A substring match on
 * email is an enumeration primitive (`q=a` matches nearly every address), and
 * someone looking up a specific client types the start of their address.
 */
export async function GET(request: NextRequest) {
  const supabase = await createRouteHandlerClientFromHeaders();
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

    // Too short to be a search: return nothing rather than the head of the list.
    if (q.length < MIN_QUERY_LENGTH) {
      return NextResponse.json({ guests: [] });
    }

    const safe = q.replace(/[%,()]/g, ' ');
    const { data, error } = await admin
      .from('guests')
      .select('id, first_name, last_name, email')
      .eq('venue_id', venueId)
      .or(
        `first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,email.ilike.${safe}%`,
      )
      .order('last_name', { ascending: true })
      .order('first_name', { ascending: true })
      .limit(20);
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
        name: composed || 'Client',
        email: (g.email as string | null) ?? null,
      };
    });
    return NextResponse.json({ guests });
  } catch (err) {
    console.error('GET /api/venue/linked-calendar/guests failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
