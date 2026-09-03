import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveVenueMode } from '@/lib/venue-mode';
import { venueExposesBookingModel } from '@/lib/booking/enabled-models';
import {
  computeClassAvailability,
  fetchClassInputForRange,
} from '@/lib/availability/class-session-engine';
import { nextResponseIfPublicBookingBlockedForVenue } from '@/lib/booking/light-plan-public-block';
import { withScheduleFailClosed } from '@/lib/availability/schedule-unavailable-response';

function addDaysIso(from: string, days: number): string {
  const [y, m, d] = from.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * GET /api/booking/class-instances?venue_id=uuid&class_type_id=uuid[&from=YYYY-MM-DD&days=90]
 *
 * Public list of FUTURE bookable instances for a single class type, used by the
 * guest manage-link "move to another session" picker. Runs the same class
 * availability engine as the public class booking flow (future-only + remaining
 * capacity), then narrows to the requested class type. No auth required — the
 * manage link itself is the bearer; capacity is re-checked on the actual move.
 */
/**
 * Stage 7 (decision J): fail closed rather than open.
 *
 * The reads behind this route substitute `[]` on failure, so a class list built without one of its inputs can show a session the venue is closed for, or hide one it is running. Wrapping the handler
 * covers every branch at once and cannot miss one the way per-return edits would. Only a
 * SUCCESSFUL response is replaced: a 400 is already a correct answer about the request
 * itself and says nothing about schedule data.
 *
 * Latent today, since production has no classes, events or resources. Wired now because the
 * mechanism is fresh and the cost is four lines; left undone it becomes the thing nobody
 * remembers when a venue first switches these on.
 */
export async function GET(request: NextRequest) {
  return withScheduleFailClosed(() => handleClassInstancesGet(request));
}

async function handleClassInstancesGet(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const venueId = searchParams.get('venue_id');
    const classTypeId = searchParams.get('class_type_id');
    if (!venueId || !classTypeId) {
      return NextResponse.json(
        { error: 'venue_id and class_type_id are required' },
        { status: 400 },
      );
    }

    const daysRaw = searchParams.get('days');
    const days = Math.min(120, Math.max(7, parseInt(daysRaw ?? '90', 10) || 90));
    const fromParam = searchParams.get('from');
    const from =
      fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam)
        ? fromParam
        : new Date().toISOString().slice(0, 10);
    const to = addDaysIso(from, days);

    const supabase = getSupabaseAdminClient();
    const blocked = await nextResponseIfPublicBookingBlockedForVenue(supabase, venueId, request);
    if (blocked) return blocked;

    const venueMode = await resolveVenueMode(supabase, venueId);
    if (!venueExposesBookingModel(venueMode.bookingModel, venueMode.enabledModels, 'class_session')) {
      return NextResponse.json(
        { error: 'Class booking is not available for this venue' },
        { status: 403 },
      );
    }

    const input = await fetchClassInputForRange({
      supabase,
      venueId,
      fromDate: from,
      toDate: to,
      forPublicBooking: true,
    });
    const slots = computeClassAvailability(input)
      .filter((s) => s.class_type_id === classTypeId && s.remaining > 0)
      .map((s) => ({
        instance_id: s.instance_id,
        instance_date: s.instance_date,
        start_time: s.start_time,
        duration_minutes: s.duration_minutes,
        remaining: s.remaining,
        capacity: s.capacity,
      }));

    return NextResponse.json(
      {
        venue_id: venueId,
        class_type_id: classTypeId,
        from,
        to,
        instances: slots,
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
    console.error('GET /api/booking/class-instances failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
