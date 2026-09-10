import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { getVenueLocalDateAndMinutes } from '@/lib/venue/venue-local-clock';
import {
  BOOKED_REVENUE_PRESETS,
  buildBookedRevenueReport,
  resolvePresetRange,
  type BookedRevenueGrain,
  type BookedRevenuePreset,
} from '@/lib/reports/booked-revenue';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GRAINS: BookedRevenueGrain[] = ['day', 'week', 'month'];
/** Longest range served in one call; a day grain over years would be a very long table. */
const MAX_RANGE_DAYS = 400;

/**
 * GET /api/venue/reports/booked-revenue?from=YYYY-MM-DD&to=YYYY-MM-DD&grain=day|week|month
 *
 * Admin only. Booked revenue per period and per calendar for this venue, plus
 * the calendars of any linked venue that has granted full calendar detail with
 * create/edit/cancel rights. See src/lib/reports/booked-revenue.ts.
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
      .select('id, name, timezone')
      .eq('id', staff.venue_id)
      .maybeSingle();
    if (venueErr || !venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }
    const timezone =
      typeof venue.timezone === 'string' && venue.timezone.trim() ? venue.timezone.trim() : 'Europe/London';
    const today = getVenueLocalDateAndMinutes(timezone).dateYmd;

    const params = request.nextUrl.searchParams;
    const presetParam = params.get('preset');
    const fromParam = params.get('from');
    const toParam = params.get('to');
    const grainParam = params.get('grain');
    // A preset is resolved here, from the venue's own today, so "This week" is
    // the diary's week even when the admin is browsing from another timezone.
    const preset = BOOKED_REVENUE_PRESETS.includes(presetParam as BookedRevenuePreset)
      ? resolvePresetRange(presetParam as BookedRevenuePreset, today)
      : null;
    const from = preset ? preset.from : fromParam && DATE_RE.test(fromParam) ? fromParam : today;
    const to = preset ? preset.to : toParam && DATE_RE.test(toParam) ? toParam : from;
    const grain: BookedRevenueGrain = GRAINS.includes(grainParam as BookedRevenueGrain)
      ? (grainParam as BookedRevenueGrain)
      : 'day';
    if (to < from) {
      return NextResponse.json({ error: 'The end date must not be before the start date.' }, { status: 400 });
    }
    const spanDays = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
    if (!Number.isFinite(spanDays) || spanDays > MAX_RANGE_DAYS) {
      return NextResponse.json(
        { error: `Choose a range of up to ${MAX_RANGE_DAYS} days.` },
        { status: 400 },
      );
    }

    const report = await buildBookedRevenueReport(staff.db, {
      venueId: staff.venue_id,
      venueName: (venue.name as string | null) ?? 'Your venue',
      from,
      to,
      grain,
      today,
    });
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('GET /api/venue/reports/booked-revenue failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
