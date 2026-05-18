import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getSmsUsageDisplayForVenue } from '@/lib/billing/sms-usage-display';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' } as const;

/**
 * GET /api/venue/sms-usage-display — admin-only SMS usage banner for reports/settings UI.
 */
export async function GET() {
  const supabase = await createClient();
  const staff = await getVenueStaff(supabase);
  if (!staff) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS });
  }

  if (!requireAdmin(staff)) {
    return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403, headers: NO_STORE_HEADERS });
  }

  const venueId = staff.venue_id;
  if (!venueId) {
    return NextResponse.json({ error: 'No venue' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const admin = getSupabaseAdminClient();
  const usage = await getSmsUsageDisplayForVenue(admin, venueId);
  return NextResponse.json({ usage }, { headers: NO_STORE_HEADERS });
}
