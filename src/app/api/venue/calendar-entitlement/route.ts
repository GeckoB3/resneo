import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { assertCalendarSlotAvailable, assertStaffSlotAvailable } from '@/lib/light-plan';
import { planCalendarLimit, planStaffLimit } from '@/lib/plan-limits';
import { isLightPlanTier, isPlusPlanTier } from '@/lib/tier-enforcement';

/**
 * GET /api/venue/calendar-entitlement
 * Calendar / team limits for the current venue (for plan UI and availability).
 * Bearer (mobile app) or cookie session (dashboard), like every other venue route.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const { data: venue } = await admin
      .from('venues')
      .select('pricing_tier, calendar_count, booking_model')
      .eq('id', staff.venue_id)
      .single();

    if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

    const tier = (venue.pricing_tier as string) ?? 'appointments';
    const { count, error: countErr } = await admin
      .from('practitioners')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', staff.venue_id)
      .eq('is_active', true);

    if (countErr) {
      console.error('[calendar-entitlement] practitioner count failed:', countErr);
      return NextResponse.json({ error: 'Failed to load entitlement' }, { status: 500 });
    }

    const activePractitioners = count ?? 0;

    const calRes = await assertCalendarSlotAvailable(staff.venue_id);
    const staffRes = await assertStaffSlotAvailable(staff.venue_id);

    const calLimit = planCalendarLimit(tier);
    const staffLimit = planStaffLimit(tier);
    const finiteCal = calLimit !== Infinity;
    const finiteStaff = staffLimit !== Infinity;

    if (isLightPlanTier(tier) || isPlusPlanTier(tier)) {
      return NextResponse.json({
        pricing_tier: tier,
        calendar_count: isLightPlanTier(tier) ? 1 : null,
        active_practitioners: activePractitioners,
        calendar_limit: calRes.limit,
        unlimited: !finiteCal,
        at_calendar_limit: !calRes.allowed,
        can_add_practitioner: calRes.allowed,
        unified_calendar_count: calRes.current,
        staff_limit: finiteStaff ? staffRes.limit : null,
        active_staff: staffRes.staffCount,
        can_invite_staff: staffRes.allowed,
        booking_model: venue.booking_model,
      });
    }

    return NextResponse.json({
      pricing_tier: tier,
      calendar_count: null,
      active_practitioners: activePractitioners,
      calendar_limit: null,
      unlimited: true,
      at_calendar_limit: false,
      can_add_practitioner: true,
      unified_calendar_count: calRes.current,
      staff_limit: null,
      active_staff: staffRes.staffCount,
      can_invite_staff: true,
      booking_model: venue.booking_model,
    });
  } catch (err) {
    console.error('[calendar-entitlement] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
