import { NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';

/**
 * GET /api/venue/guests/tags - distinct tags used at this venue (autocomplete).
 */
export async function GET(request: Request) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { data, error } = await staff.db
      .from('guests')
      .select('tags')
      .eq('venue_id', staff.venue_id);

    if (error) {
      console.error('GET /api/venue/guests/tags failed:', error);
      return NextResponse.json({ error: 'Failed to load tags' }, { status: 500 });
    }

    const set = new Set<string>();
    for (const row of data ?? []) {
      const tags = (row as { tags?: string[] | null }).tags;
      if (!Array.isArray(tags)) continue;
      for (const t of tags) {
        if (typeof t === 'string' && t.trim()) {
          set.add(t.trim());
        }
      }
    }

    const tags = [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return NextResponse.json({ tags });
  } catch (err) {
    console.error('GET /api/venue/guests/tags failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
