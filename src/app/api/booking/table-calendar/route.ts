import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { nextResponseIfPublicBookingBlockedForVenue } from '@/lib/booking/light-plan-public-block';
import { resolveVenueMode } from '@/lib/venue-mode';
import { computeTableAvailableDatesInMonth } from '@/lib/availability/table-month-availability';

/**
 * GET /api/booking/table-calendar?venue_id=&year=&month=&party_size=&area_id=
 *
 * Returns the dates in that month (YYYY-MM-DD) that have at least one available
 * table-reservation slot for the given party size.
 *
 * Feeds the visual availability indicators on the public table-booking calendar.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const venueId = searchParams.get('venue_id');
    const yearParam = searchParams.get('year');
    const monthParam = searchParams.get('month');
    const partySizeParam = searchParams.get('party_size');
    const areaId = searchParams.get('area_id') ?? undefined;

    if (!venueId) {
      return NextResponse.json({ error: 'venue_id is required' }, { status: 400 });
    }

    const year = yearParam ? parseInt(yearParam, 10) : NaN;
    const month = monthParam ? parseInt(monthParam, 10) : NaN;
    if (Number.isNaN(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
    }
    if (Number.isNaN(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: 'Invalid month (1–12)' }, { status: 400 });
    }

    const partySize = partySizeParam ? parseInt(partySizeParam, 10) : 2;
    if (Number.isNaN(partySize) || partySize < 1) {
      return NextResponse.json({ error: 'party_size must be a positive integer' }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();

    const blocked = await nextResponseIfPublicBookingBlockedForVenue(supabase, venueId);
    if (blocked) return blocked;

    const venueMode = await resolveVenueMode(supabase, venueId);
    if (venueMode.bookingModel !== 'table_reservation') {
      return NextResponse.json(
        { error: 'This venue does not use table reservations' },
        { status: 403 },
      );
    }

    if (venueMode.availabilityEngine !== 'service') {
      return NextResponse.json({ available_dates: [] });
    }

    const available_dates = await computeTableAvailableDatesInMonth(
      supabase,
      venueId,
      year,
      month,
      partySize,
      areaId,
    );

    return NextResponse.json(
      { venue_id: venueId, year, month, party_size: partySize, available_dates },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=90',
        },
      },
    );
  } catch (err) {
    console.error('GET /api/booking/table-calendar failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
