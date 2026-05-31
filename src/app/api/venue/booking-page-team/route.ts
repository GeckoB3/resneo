import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { listBookingPageTeam } from '@/lib/booking/booking-page-team';

/** GET /api/venue/booking-page-team - bookable team members for the "Meet the team" editor. */
export async function GET(request: NextRequest) {
  void request;
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    const team = await listBookingPageTeam(getSupabaseAdminClient(), staff.venue_id);
    return NextResponse.json({ team });
  } catch (err) {
    console.error('GET /api/venue/booking-page-team failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
