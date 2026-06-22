import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveVenueMode } from '@/lib/venue-mode';
import { venueExposesBookingModel } from '@/lib/booking/enabled-models';
import {
  computeClassAvailability,
  fetchClassInputForRange,
} from '@/lib/availability/class-session-engine';
import { nextResponseIfPublicBookingBlockedForVenue } from '@/lib/booking/light-plan-public-block';

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
export async function GET(request: NextRequest) {
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
    const blocked = await nextResponseIfPublicBookingBlockedForVenue(supabase, venueId);
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
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120',
        },
      },
    );
  } catch (err) {
    console.error('GET /api/booking/class-instances failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
