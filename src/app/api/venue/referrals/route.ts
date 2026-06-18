import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { referralProgrammeEnabled } from '@/lib/referrals/constants';
import { loadReferralsDashboardForVenue } from '@/lib/referrals/load-dashboard';

/**
 * GET /api/venue/referrals — Refer & Earn dashboard data for the Settings tab (admin only).
 * Bearer (mobile) + cookie (web) auth via createVenueRouteClient. Mirrors the web SSR gate
 * in dashboard/settings: only admins of a referral-enabled programme get the payload.
 * Returns the loadReferralsDashboardForVenue shape verbatim (ReferralsDashboardData).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Admins only' }, { status: 403 });
    }

    if (!referralProgrammeEnabled()) {
      return NextResponse.json({ error: 'Referral programme is not available.' }, { status: 403 });
    }

    const dashboard = await loadReferralsDashboardForVenue(staff.db, staff.venue_id);
    if (!dashboard) {
      // referralProgrammeEnabled() already true above; a null here means the loader's own kill-switch.
      return NextResponse.json({ error: 'Referral programme is not available.' }, { status: 403 });
    }

    return NextResponse.json(dashboard);
  } catch (err) {
    console.error('GET /api/venue/referrals failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
