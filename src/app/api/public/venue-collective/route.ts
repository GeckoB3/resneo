import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { loadActiveCollectiveForVenue } from '@/lib/linked-accounts/collectives';

/**
 * GET /api/public/venue-collective?venueId=... — public lookup of the live
 * collective a venue belongs to (§8.6), for the fully-booked cross-suggestion on
 * its public booking page. Returns only the collective's public slug + name (the
 * same data the public collective page already exposes), or null. No auth: this
 * is public booking-page chrome.
 */
export async function GET(request: NextRequest) {
  const venueId = (request.nextUrl.searchParams.get('venueId') ?? '').trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(venueId)) {
    return NextResponse.json({ collective: null });
  }
  try {
    const admin = getSupabaseAdminClient();
    const collective = await loadActiveCollectiveForVenue(admin, venueId);
    return NextResponse.json({ collective });
  } catch (err) {
    console.error('GET /api/public/venue-collective failed:', err);
    return NextResponse.json({ collective: null });
  }
}
