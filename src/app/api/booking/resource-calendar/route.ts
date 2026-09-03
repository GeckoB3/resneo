import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveVenueMode } from '@/lib/venue-mode';
import { venueExposesBookingModel } from '@/lib/booking/enabled-models';
import {
  mapCalendarToResource,
  computeResourceAvailableDatesInMonth,
  computeResourceAvailableDatesInMonthAnyDuration,
  attachHostCalendarsToResources,
} from '@/lib/availability/resource-booking-engine';
import { nextResponseIfPublicBookingBlockedForVenue } from '@/lib/booking/light-plan-public-block';
import { withScheduleFailClosed } from '@/lib/availability/schedule-unavailable-response';

/**
 * GET /api/booking/resource-calendar?venue_id=&resource_id=&year=&month=&duration=
 * Dates in that month (YYYY-MM-DD) with at least one available slot for the duration.
 * Use duration=any (or flex) to mark days where any valid duration in range can book (aligned with staff calendar).
 */
/**
 * Stage 7 (decision J): fail closed rather than open.
 *
 * The reads behind this route substitute `[]` on failure, so a resource month built without one of its inputs removes whole dates from the picker, which reads as fully booked. Wrapping the handler
 * covers every branch at once and cannot miss one the way per-return edits would. Only a
 * SUCCESSFUL response is replaced: a 400 is already a correct answer about the request
 * itself and says nothing about schedule data.
 *
 * Latent today, since production has no classes, events or resources. Wired now because the
 * mechanism is fresh and the cost is four lines; left undone it becomes the thing nobody
 * remembers when a venue first switches these on.
 */
export async function GET(request: NextRequest) {
  return withScheduleFailClosed(() => handleResourceCalendarGet(request));
}

async function handleResourceCalendarGet(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const venueId = searchParams.get('venue_id');
    const resourceId = searchParams.get('resource_id');
    const yearParam = searchParams.get('year');
    const monthParam = searchParams.get('month');
    const durationParam = searchParams.get('duration');

    if (!venueId || !resourceId) {
      return NextResponse.json({ error: 'venue_id and resource_id are required' }, { status: 400 });
    }

    const year = yearParam ? parseInt(yearParam, 10) : NaN;
    const month = monthParam ? parseInt(monthParam, 10) : NaN;
    if (Number.isNaN(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
    }
    if (Number.isNaN(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: 'Invalid month (1–12)' }, { status: 400 });
    }

    const durationAny = durationParam === 'any' || durationParam === 'flex';
    let durationMinutes = 60;
    if (!durationAny) {
      durationMinutes = durationParam ? parseInt(durationParam, 10) : 60;
      if (Number.isNaN(durationMinutes) || durationMinutes < 5 || durationMinutes > 1440) {
        return NextResponse.json({ error: 'duration must be between 5 and 1440 minutes' }, { status: 400 });
      }
    }

    const supabase = getSupabaseAdminClient();
    const blocked = await nextResponseIfPublicBookingBlockedForVenue(supabase, venueId, request);
    if (blocked) return blocked;

    const venueMode = await resolveVenueMode(supabase, venueId);
    if (!venueExposesBookingModel(venueMode.bookingModel, venueMode.enabledModels, 'resource_booking')) {
      return NextResponse.json({ error: 'Resource bookings are not available for this venue' }, { status: 403 });
    }

    const { data: row, error: rowErr } = await supabase
      .from('unified_calendars')
      .select('*')
      .eq('id', resourceId)
      .eq('venue_id', venueId)
      .eq('calendar_type', 'resource')
      .maybeSingle();

    if (rowErr || !row) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
    }

    let resource = mapCalendarToResource(row as Record<string, unknown>);
    if (!resource.is_active) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
    }

    const [enriched] = await attachHostCalendarsToResources(supabase, venueId, [resource]);
    resource = enriched ?? resource;

    const prefetchOpts = { reuseEnrichedResourceRow: true as const };
    const available_dates = durationAny
      ? await computeResourceAvailableDatesInMonthAnyDuration(
          supabase,
          venueId,
          resource,
          year,
          month,
          prefetchOpts,
        )
      : await computeResourceAvailableDatesInMonth(
          supabase,
          venueId,
          resource,
          year,
          month,
          durationMinutes,
          prefetchOpts,
        );

    return NextResponse.json(
      {
        venue_id: venueId,
        resource_id: resourceId,
        year,
        month,
        duration_minutes: durationAny ? null : durationMinutes,
        duration_mode: durationAny ? 'any' : 'fixed',
        available_dates,
      },
      {
        headers: {
          /**
           * SA-M9, extended to this route. Schedule-derived answers cannot be
           * CDN-cached while nothing revalidates them: there is not one
           * `revalidateTag` or `revalidatePath` in `src/`, so a closure or an
           * hours change an owner had just saved kept selling for up to 165
           * seconds at every edge location, with no way to flush it. The
           * sibling appointment-calendar branch was fixed for exactly this and
           * this one was missed.
           *
           * It also invalidates staging soaks: the scheduling resolver work
           * changes precisely the values this cached, so a soak would look
           * correct while production served pre-change availability.
           *
           * The cache comes back when there is something to key it on. §11.5
           * wants a `venues.availability_epoch` bumped by trigger on every
           * schedule write. Until then, correct and uncached beats fast and wrong.
           */
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (err) {
    console.error('GET /api/booking/resource-calendar failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
