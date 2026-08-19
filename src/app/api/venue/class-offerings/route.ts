import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveVenueMode } from '@/lib/venue-mode';
import {
  buildClassOfferingSummaries,
  computeClassAvailability,
  fetchClassInputForRange,
} from '@/lib/availability/class-session-engine';
import { loadClassOfferingCommerceCatalog } from '@/lib/class-commerce/enrich-class-offerings';
import { resolveLinkedStaffCatalogScope } from '@/lib/booking/staff-booking-access';
import { withScheduleFailClosed } from '@/lib/availability/schedule-unavailable-response';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function addDaysIso(from: string, days: number): string {
  const [y, m, d] = from.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * GET /api/venue/class-offerings?from=YYYY-MM-DD&days=90
 * Staff: same shape as public class-offerings; includes sessions inside min-notice (staff can book walk-ins).
 */
/**
 * Stage 7 (decision J): fail closed rather than open.
 *
 * Staff twin of `/api/booking/class-offerings`. The reads behind
 * `fetchClassInputForRange` substitute `[]` on failure, so an offering list built without
 * one of its inputs can show a session on a day the venue is closed, or hide one it is
 * running.
 *
 * Staff READS, not the staff write validators. Stage 7's scope note excludes
 * `findClassScheduleWindowAvailabilityConflict` and `findEventLeaveConflict` deliberately,
 * because refusing to let staff SCHEDULE anything during a database wobble is a different
 * trade with a different answer. This route blocks nothing: it answers a question, and
 * answering it wrongly is the failure decision (J) exists to prevent, with the audience
 * changed.
 *
 * The 401 guard below runs before any schedule read, and the wrapper replaces only a
 * SUCCESSFUL response, so an unauthenticated request still gets 401 rather than 503.
 */
export async function GET(request: NextRequest) {
  return withScheduleFailClosed(() => handleStaffClassOfferingsGet(request));
}

async function handleStaffClassOfferingsGet(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const daysRaw = request.nextUrl.searchParams.get('days');
    const days = Math.min(120, Math.max(7, parseInt(daysRaw ?? '90', 10) || 90));
    const fromParam = request.nextUrl.searchParams.get('from');
    const from =
      fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : new Date().toISOString().slice(0, 10);
    const to = addDaysIso(from, days);

    const admin = getSupabaseAdminClient();

    const ownerVenueParam = request.nextUrl.searchParams.get('owner_venue_id');
    const scope = await resolveLinkedStaffCatalogScope(
      admin,
      staff.venue_id,
      ownerVenueParam && UUID_RE.test(ownerVenueParam) ? ownerVenueParam : null,
    );
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }
    const offeringsVenueId = scope.venueId;

    const venueMode = await resolveVenueMode(admin, offeringsVenueId);
    const canClass =
      venueMode.bookingModel === 'class_session' || venueMode.enabledModels.includes('class_session');
    if (!canClass) {
      return NextResponse.json({ error: 'This venue does not offer class session bookings' }, { status: 403 });
    }

    const input = await fetchClassInputForRange({
      supabase: admin,
      venueId: offeringsVenueId,
      fromDate: from,
      toDate: to,
      forPublicBooking: false,
    });
    const slots = computeClassAvailability(input);
    const classes = buildClassOfferingSummaries(slots);

    const { data: authUser } = await supabase.auth.getUser();
    const commerce = await loadClassOfferingCommerceCatalog(admin, {
      venueId: offeringsVenueId,
      viewerUserId: authUser.user?.id ?? null,
    });

    return NextResponse.json({
      venue_id: offeringsVenueId,
      from,
      to,
      classes,
      instances: slots,
      commerce,
    });
  } catch (err) {
    console.error('GET /api/venue/class-offerings failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
