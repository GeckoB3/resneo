import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveVenueMode } from '@/lib/venue-mode';
import {
  isUnifiedSchedulingVenue,
  venueUsesUnifiedAppointmentData,
} from '@/lib/booking/unified-scheduling';
import { computeAppointmentAvailableDatesInMonth } from '@/lib/availability/appointment-month-availability';
import { loadActiveVariantForService } from '@/lib/venue/service-variants';

/**
 * GET /api/venue/appointment-calendar?practitioner_id=&service_id=&year=&month=
 * Staff variant of the public appointment-calendar endpoint.
 * Returns month dates with at least one bookable appointment slot for the given
 * practitioner/calendar + service, using staff booking-window rules (same-day allowed).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const { searchParams } = request.nextUrl;
    const practitionerId = searchParams.get('practitioner_id');
    const serviceId = searchParams.get('service_id');
    const yearParam = searchParams.get('year');
    const monthParam = searchParams.get('month');
    const variantId = searchParams.get('variant_id');
    const durationParam = searchParams.get('duration_minutes');

    if (!practitionerId || !serviceId) {
      return NextResponse.json(
        { error: 'practitioner_id and service_id are required' },
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
    const customDurationMinutes = durationParam ? parseInt(durationParam, 10) : null;
    if (customDurationMinutes != null && (!Number.isInteger(customDurationMinutes) || customDurationMinutes < 15 || customDurationMinutes > 14 * 60)) {
      return NextResponse.json({ error: 'Invalid duration_minutes' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const venueMode = await resolveVenueMode(admin, staff.venue_id);
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
      ? await loadActiveVariantForService({
          admin,
          venueId: staff.venue_id,
          serviceId,
          variantId,
        })
      : null;
    if (variantId && !variantOverride) {
      return NextResponse.json({ error: 'Invalid variant_id for this service' }, { status: 400 });
    }

    const available_dates = await computeAppointmentAvailableDatesInMonth(
      admin,
      staff.venue_id,
      practitionerId,
      serviceId,
      year,
      month,
      { audience: 'staff', variantOverride, customDurationMinutes },
    );

    return NextResponse.json(
      {
        venue_id: staff.venue_id,
        practitioner_id: practitionerId,
        service_id: serviceId,
        year,
        month,
        available_dates,
      },
      {
        headers: {
          'Cache-Control': 'private, max-age=45, stale-while-revalidate=120',
        },
      },
    );
  } catch (err) {
    console.error('GET /api/venue/appointment-calendar failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
