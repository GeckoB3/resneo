import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { fetchAppointmentCatalog } from '@/lib/availability/appointment-catalog';
import { resolveVenueMode } from '@/lib/venue-mode';
import { isUnifiedSchedulingVenue, venueUsesUnifiedAppointmentData } from '@/lib/booking/unified-scheduling';
import { nextResponseIfPublicBookingBlockedForVenue } from '@/lib/booking/light-plan-public-block';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';

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
    const blocked = await nextResponseIfPublicBookingBlockedForVenue(supabase, venueId);
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
      const authClient = await createClient();
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
