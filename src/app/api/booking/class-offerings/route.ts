import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { resolveVenueMode } from '@/lib/venue-mode';
import { venueExposesBookingModel } from '@/lib/booking/enabled-models';
import {
  buildClassOfferingSummaries,
  computeClassAvailability,
  fetchClassInputForRange,
} from '@/lib/availability/class-session-engine';
import { nextResponseIfPublicBookingBlockedForVenue } from '@/lib/booking/light-plan-public-block';
import { loadClassOfferingCommerceCatalog } from '@/lib/class-commerce/enrich-class-offerings';
import { withScheduleFailClosed } from '@/lib/availability/schedule-unavailable-response';

function addDaysIso(from: string, days: number): string {
  const [y, m, d] = from.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * GET /api/booking/class-offerings?venue_id=uuid&from=YYYY-MM-DD&days=90
 * Public: class types with bookable sessions in range + full instance rows for date/calendar selection.
 */
/**
 * Stage 7 (decision J): fail closed rather than open.
 *
 * Missed by Stage 7's original five: `class-instances` was wrapped and this, its sibling on
 * the same engine, was not. The reads behind `fetchClassInputForRange` substitute `[]` on
 * failure, so an offering list built without one of its inputs can show a session on a day
 * the venue is closed, or hide one it is running.
 *
 * Wrapping the handler covers every branch at once and cannot miss one the way per-return
 * edits would. Only a SUCCESSFUL response is replaced: a 400 is already a correct answer
 * about the request itself and says nothing about schedule data.
 */
export async function GET(request: NextRequest) {
  return withScheduleFailClosed(() => handleClassOfferingsGet(request));
}

async function handleClassOfferingsGet(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const venueId = searchParams.get('venue_id');
    if (!venueId) {
      return NextResponse.json({ error: 'Missing venue_id' }, { status: 400 });
    }

    const daysRaw = searchParams.get('days');
    const days = Math.min(120, Math.max(7, parseInt(daysRaw ?? '90', 10) || 90));
    const fromParam = searchParams.get('from');
    const from =
      fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : new Date().toISOString().slice(0, 10);
    const to = addDaysIso(from, days);

    const supabase = getSupabaseAdminClient();
    const blocked = await nextResponseIfPublicBookingBlockedForVenue(supabase, venueId);
    if (blocked) return blocked;

    const venueMode = await resolveVenueMode(supabase, venueId);
    if (!venueExposesBookingModel(venueMode.bookingModel, venueMode.enabledModels, 'class_session')) {
      return NextResponse.json({ error: 'Class booking is not available for this venue' }, { status: 403 });
    }

    const input = await fetchClassInputForRange({
      supabase,
      venueId,
      fromDate: from,
      toDate: to,
      forPublicBooking: true,
    });
    const slots = computeClassAvailability(input);
    const classes = buildClassOfferingSummaries(slots);

    let viewerUserId: string | null = null;
    try {
      const routeClient = await createRouteHandlerClient(request);
      const { data: auth } = await routeClient.auth.getUser();
      viewerUserId = auth.user?.id ?? null;
    } catch {
      viewerUserId = null;
    }

    const commerce = await loadClassOfferingCommerceCatalog(supabase, { venueId, viewerUserId });

    return NextResponse.json({
      venue_id: venueId,
      from,
      to,
      classes,
      instances: slots,
      commerce,
    });
  } catch (err) {
    console.error('GET /api/booking/class-offerings failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
