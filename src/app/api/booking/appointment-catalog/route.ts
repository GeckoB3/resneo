import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { fetchAppointmentCatalog } from '@/lib/availability/appointment-catalog';
import { resolveVenueMode } from '@/lib/venue-mode';
import { isUnifiedSchedulingVenue, venueUsesUnifiedAppointmentData } from '@/lib/booking/unified-scheduling';
import { nextResponseIfPublicBookingBlockedForVenue } from '@/lib/booking/light-plan-public-block';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { isCollectiveId } from '@/lib/linked-accounts/collective-booking-bridge';
import { loadCollectiveAppointmentCatalog } from '@/lib/linked-accounts/collective-venue';
import { resolveStaffCollectiveScope } from '@/lib/linked-accounts/collective-staff-scope';

/**
 * GET /api/booking/appointment-catalog?venue_id=uuid
 * Active practitioners and services for guest pickers - no date, no slot computation.
 * Pass `?include_hidden=true` from an authenticated staff session to include
 * `hidden_from_online` add-on groups (used by the dashboard staff booking surface).
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const venueId = url.searchParams.get('venue_id');
    if (!venueId) {
      return NextResponse.json({ error: 'Missing required query param: venue_id' }, { status: 400 });
    }

    const practitionerSlug = url.searchParams.get('practitioner_slug')?.trim();
    const includeHiddenRequested = url.searchParams.get('include_hidden') === 'true';

    const supabase = getSupabaseAdminClient();

    // Combined booking page (plan §22): the venue id is actually a collective —
    // return the merged "virtual venue" catalogue (offerings as services, the
    // union of provider calendars as staff).
    if (await isCollectiveId(supabase, venueId)) {
      // Staff of a member venue booking for the collective see hidden add-on
      // groups, as they do on their own catalogue, and every member's own services
      // next to the combined offerings; the public sees neither.
      let memberStaff = false;
      if (includeHiddenRequested) {
        const authClient = await createVenueRouteClient(request);
        const staff = await getVenueStaff(authClient);
        memberStaff = Boolean(staff && (await resolveStaffCollectiveScope(supabase, staff.venue_id, venueId)));
      }
      const catalog = await loadCollectiveAppointmentCatalog(supabase, venueId, {
        includeHiddenAddons: memberStaff,
        includeMemberOwnServices: memberStaff,
      });
      return NextResponse.json(catalog);
    }

    // Staff of the venue, or of a partner linked to it with booking rights, are not
    // the public: the linked calendar's "New booking" reads this catalog for them.
    const blocked = await nextResponseIfPublicBookingBlockedForVenue(supabase, venueId, request);
    if (blocked) return blocked;

    const venueMode = await resolveVenueMode(supabase, venueId);
    if (
      !isUnifiedSchedulingVenue(venueMode.bookingModel) &&
      !venueUsesUnifiedAppointmentData(venueMode.bookingModel, venueMode.enabledModels)
    ) {
      return NextResponse.json({ error: 'Not an appointment venue' }, { status: 404 });
    }

    let includeHiddenAddons = false;
    if (includeHiddenRequested) {
      const authClient = await createVenueRouteClient(request);
      const staff = await getVenueStaff(authClient);
      if (staff && staff.venue_id === venueId) {
        includeHiddenAddons = true;
      }
    }

    const catalog = await fetchAppointmentCatalog(supabase, venueId, {
      practitionerSlug: practitionerSlug || undefined,
      includeHiddenAddons,
    });
    if (practitionerSlug && catalog.practitioners.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(catalog);
  } catch (error) {
    console.error('[appointment-catalog] Failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
