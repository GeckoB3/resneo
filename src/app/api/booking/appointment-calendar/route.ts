import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveVenueMode } from '@/lib/venue-mode';
import {
  isUnifiedSchedulingVenue,
  venueUsesUnifiedAppointmentData,
} from '@/lib/booking/unified-scheduling';
import { computeAppointmentAvailableDatesInMonth } from '@/lib/availability/appointment-month-availability';
import { nextResponseIfPublicBookingBlockedForVenue } from '@/lib/booking/light-plan-public-block';
import { loadActiveVariantForService } from '@/lib/venue/service-variants';

/**
 * GET /api/booking/appointment-calendar?venue_id=&practitioner_id=&service_id=&year=&month=
 * Returns the dates in that month (YYYY-MM-DD) on which the given practitioner/calendar
 * has at least one bookable slot for `service_id`.
 *
 * Feeds the visual date picker on the public appointment booking form.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const venueId = searchParams.get('venue_id');
    const practitionerId = searchParams.get('practitioner_id');
    const serviceId = searchParams.get('service_id');
    const yearParam = searchParams.get('year');
    const monthParam = searchParams.get('month');
    const variantId = searchParams.get('variant_id');

    if (!venueId || !practitionerId || !serviceId) {
      return NextResponse.json(
        { error: 'venue_id, practitioner_id and service_id are required' },
        { status: 400 },
      );
    }

    const year = yearParam ? parseInt(yearParam, 10) : NaN;
    const month = monthParam ? parseInt(monthParam, 10) : NaN;
    if (Number.isNaN(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
    }
    if (Number.isNaN(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: 'Invalid month (1–12)' }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();
    const blocked = await nextResponseIfPublicBookingBlockedForVenue(supabase, venueId);
    if (blocked) return blocked;

    const venueMode = await resolveVenueMode(supabase, venueId);
    const supportsAppointments =
      isUnifiedSchedulingVenue(venueMode.bookingModel) ||
      venueUsesUnifiedAppointmentData(venueMode.bookingModel, venueMode.enabledModels);
    if (!supportsAppointments) {
      return NextResponse.json(
        { error: 'This venue does not offer appointment bookings' },
        { status: 403 },
      );
    }

    const variantOverride = variantId
      ? await loadActiveVariantForService({ admin: supabase, venueId, serviceId, variantId })
      : null;
    if (variantId && !variantOverride) {
      return NextResponse.json({ error: 'Invalid variant_id for this service' }, { status: 400 });
    }

    const available_dates = await computeAppointmentAvailableDatesInMonth(
      supabase,
      venueId,
      practitionerId,
      serviceId,
      year,
      month,
      { audience: 'public', variantOverride },
    );

    return NextResponse.json(
      {
        venue_id: venueId,
        practitioner_id: practitionerId,
        service_id: serviceId,
        year,
        month,
        available_dates,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=45, stale-while-revalidate=120',
        },
      },
    );
  } catch (err) {
    console.error('GET /api/booking/appointment-calendar failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
