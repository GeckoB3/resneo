import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';

const slugParamSchema = /^[a-z0-9-]{1,100}$/;

/**
 * GET /api/venue/slug-available?slug=my-venue
 * Admin only. Returns whether the slug is free for this venue's public booking URL
 * (or already held by this venue).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const raw = request.nextUrl.searchParams.get('slug')?.trim().toLowerCase() ?? '';
    if (!raw || !slugParamSchema.test(raw)) {
      return NextResponse.json(
        { error: 'Invalid slug: use 1–100 characters (lowercase letters, numbers, hyphens only).' },
        { status: 400 },
      );
    }

    const { data: other, error } = await staff.db
      .from('venues')
      .select('id')
      .eq('slug', raw)
      .neq('id', staff.venue_id)
      .maybeSingle();

    if (error) {
      console.error('[GET /api/venue/slug-available] query failed:', error.message);
      return NextResponse.json({ error: 'Could not check slug' }, { status: 500 });
    }

    const taken = Boolean(other);
    return NextResponse.json({
      slug: raw,
      available: !taken,
    });
  } catch (err) {
    console.error('GET /api/venue/slug-available failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
