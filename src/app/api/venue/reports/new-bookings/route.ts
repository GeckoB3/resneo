import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { getVenueLocalDateAndMinutes } from '@/lib/venue/venue-local-clock';
import type { ReportGrain } from '@/lib/reports/report-periods';
import {
  NEW_BOOKINGS_PRESETS,
  buildNewBookingsReport,
  daysSpanned,
  resolveNewBookingsPreset,
  type NewBookingsPreset,
} from '@/lib/reports/new-bookings';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GRAINS: ReportGrain[] = ['day', 'week', 'month'];
/** Longest range served in one call, as on the Revenue tab. */
const MAX_RANGE_DAYS = 400;

/**
 * GET /api/venue/reports/new-bookings?preset=today|yesterday|this_week|last_week|this_month|last_month
 *   or ?from=YYYY-MM-DD&to=YYYY-MM-DD, plus &grain=day|week|month
 *
 * Admin only, like the rest of Reports. How many bookings were made at this
 * venue in the range, counted on the venue-local day each was made, per period
 * and split by how they came in. See src/lib/reports/new-bookings.ts for what
 * counts as one booking.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const { data: venue, error: venueErr } = await staff.db
      .from('venues')
      .select('id, timezone')
      .eq('id', staff.venue_id)
      .maybeSingle();
    if (venueErr || !venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }
    const timeZone =
      typeof venue.timezone === 'string' && venue.timezone.trim() ? venue.timezone.trim() : 'Europe/London';
    const today = getVenueLocalDateAndMinutes(timeZone).dateYmd;

    const params = request.nextUrl.searchParams;
    const presetParam = params.get('preset');
    const fromParam = params.get('from');
    const toParam = params.get('to');
    const grainParam = params.get('grain');
    // A preset is resolved here, from the venue's own today, so "This week" is
    // the diary's week even when the admin is browsing from another timezone.
    const preset = NEW_BOOKINGS_PRESETS.includes(presetParam as NewBookingsPreset)
      ? resolveNewBookingsPreset(presetParam as NewBookingsPreset, today)
      : null;
    const from = preset ? preset.from : fromParam && DATE_RE.test(fromParam) ? fromParam : today;
    const requestedTo = preset ? preset.to : toParam && DATE_RE.test(toParam) ? toParam : from;
    const grain: ReportGrain = GRAINS.includes(grainParam as ReportGrain) ? (grainParam as ReportGrain) : 'day';

    if (from > today) {
      return NextResponse.json(
        { error: 'New bookings can only be counted up to today. Choose a start date that is not in the future.' },
        { status: 400 },
      );
    }
    // Nothing can have been booked after today, so a range reaching past it stops there.
    const to = requestedTo > today ? today : requestedTo;
    if (to < from) {
      return NextResponse.json({ error: 'The end date must not be before the start date.' }, { status: 400 });
    }
    if (daysSpanned(from, to) > MAX_RANGE_DAYS) {
      return NextResponse.json({ error: `Choose a range of up to ${MAX_RANGE_DAYS} days.` }, { status: 400 });
    }

    const report = await buildNewBookingsReport(staff.db, {
      venueId: staff.venue_id,
      timeZone,
      from,
      to,
      grain,
      today,
    });
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('GET /api/venue/reports/new-bookings failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
