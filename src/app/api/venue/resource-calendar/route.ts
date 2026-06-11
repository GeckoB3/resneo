import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveVenueMode } from '@/lib/venue-mode';
import {
  mapCalendarToResource,
  computeResourceAvailableDatesInMonth,
  computeResourceAvailableDatesInMonthAnyDuration,
  attachHostCalendarsToResources,
} from '@/lib/availability/resource-booking-engine';

/**
 * GET /api/venue/resource-calendar?resource_id=&year=&month=&duration=
 * Staff: available dates for one resource in a calendar month.
 * Omit `duration` or use `duration=any` to mark days where any valid slot-interval-based duration can book.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const { searchParams } = request.nextUrl;
    const resourceId = searchParams.get('resource_id');
    const yearParam = searchParams.get('year');
    const monthParam = searchParams.get('month');
    const durationParam = searchParams.get('duration');

    if (!resourceId) {
      return NextResponse.json({ error: 'resource_id is required' }, { status: 400 });
    }

    const year = yearParam ? parseInt(yearParam, 10) : NaN;
    const month = monthParam ? parseInt(monthParam, 10) : NaN;
    if (Number.isNaN(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
    }
    if (Number.isNaN(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: 'Invalid month (1–12)' }, { status: 400 });
    }

    const durationAny = !durationParam || durationParam === 'any' || durationParam === 'flex';
    let durationMinutes = 60;
    if (!durationAny) {
      durationMinutes = parseInt(durationParam, 10);
      if (Number.isNaN(durationMinutes) || durationMinutes < 5 || durationMinutes > 1440) {
        return NextResponse.json({ error: 'duration must be between 5 and 1440 minutes' }, { status: 400 });
      }
    }

    const excludeBookingIdParam = searchParams.get('exclude_booking_id');
    const excludeBookingId =
      excludeBookingIdParam &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(excludeBookingIdParam)
        ? excludeBookingIdParam
        : undefined;
    const skipPastSlots = searchParams.get('skip_past_slots') === '1';

    const admin = getSupabaseAdminClient();
    const venueMode = await resolveVenueMode(admin, staff.venue_id);
    const canResource =
      venueMode.bookingModel === 'resource_booking' ||
      venueMode.enabledModels.includes('resource_booking');
    if (!canResource) {
      return NextResponse.json({ error: 'This venue does not offer resource bookings' }, { status: 403 });
    }

    const { data: row, error: rowErr } = await admin
      .from('unified_calendars')
      .select('*')
      .eq('id', resourceId)
      .eq('venue_id', staff.venue_id)
      .eq('calendar_type', 'resource')
      .maybeSingle();

    if (rowErr || !row) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
    }

    let resource = mapCalendarToResource(row as Record<string, unknown>);
    if (!resource.is_active) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
    }

    const [enriched] = await attachHostCalendarsToResources(admin, staff.venue_id, [resource]);
    resource = enriched ?? resource;

    const prefetchOpts = {
      reuseEnrichedResourceRow: true as const,
      excludeBookingId,
      skipPastSlotFilter: skipPastSlots,
    };
    const available_dates = durationAny
      ? await computeResourceAvailableDatesInMonthAnyDuration(
          admin,
          staff.venue_id,
          resource,
          year,
          month,
          prefetchOpts,
        )
      : await computeResourceAvailableDatesInMonth(
          admin,
          staff.venue_id,
          resource,
          year,
          month,
          durationMinutes,
          prefetchOpts,
        );

    return NextResponse.json(
      {
        venue_id: staff.venue_id,
        resource_id: resourceId,
        year,
        month,
        duration_minutes: durationAny ? null : durationMinutes,
        duration_mode: durationAny ? 'any' : 'fixed',
        available_dates,
      },
      {
        headers: {
          'Cache-Control': 'private, max-age=45, stale-while-revalidate=120',
        },
      },
    );
  } catch (err) {
    console.error('GET /api/venue/resource-calendar failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
