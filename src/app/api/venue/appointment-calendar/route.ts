import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveVenueMode } from '@/lib/venue-mode';
import {
  isUnifiedSchedulingVenue,
  venueUsesUnifiedAppointmentData,
} from '@/lib/booking/unified-scheduling';
import {
  computeAnyAvailableAppointmentDatesInMonth,
  computeAppointmentAvailableDatesInMonth,
} from '@/lib/availability/appointment-month-availability';
import { ANY_AVAILABLE_PRACTITIONER_ID } from '@/lib/availability/appointment-any-practitioner';
import {
  assertAppointmentsFeatureEnabled,
  featureFlagDisabledResponse,
  parseVenueFeatureFlags,
} from '@/lib/feature-flags';
import { loadActiveVariantForService } from '@/lib/venue/service-variants';
import { resolveLinkedStaffCatalogScope } from '@/lib/booking/staff-booking-access';
import { loadAddonsForBooking } from '@/lib/addons/addon-resolution';
import { validateAddonSelections } from '@/lib/addons/addon-selection-validation';
import { venueUsesUnifiedAppointmentServiceData } from '@/lib/booking/uses-unified-appointment-data';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    const anyAvailable =
      searchParams.get('any_available') === '1' || searchParams.get('any_available') === 'true';
    const yearParam = searchParams.get('year');
    const monthParam = searchParams.get('month');
    const variantId = searchParams.get('variant_id');
    const durationParam = searchParams.get('duration_minutes');
    const excludeBookingId = searchParams.get('exclude_booking_id');

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

    const ownerVenueParam = searchParams.get('owner_venue_id');
    const scope = await resolveLinkedStaffCatalogScope(
      admin,
      staff.venue_id,
      ownerVenueParam && UUID_RE.test(ownerVenueParam) ? ownerVenueParam : null,
    );
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }
    const calendarVenueId = scope.venueId;

    const venueMode = await resolveVenueMode(admin, calendarVenueId);
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
          venueId: calendarVenueId,
          serviceId,
          variantId,
        })
      : null;
    if (variantId && !variantOverride) {
      return NextResponse.json({ error: 'Invalid variant_id for this service' }, { status: 400 });
    }

    if (anyAvailable) {
      const { data: venueFlagsRow } = await admin
        .from('venues')
        .select('feature_flags')
        .eq('id', calendarVenueId)
        .maybeSingle();
      const venueFlags = parseVenueFeatureFlags(
        (venueFlagsRow as { feature_flags?: unknown } | null)?.feature_flags,
      );
      try {
        assertAppointmentsFeatureEnabled('any_available_practitioner', venueFlags);
      } catch {
        return featureFlagDisabledResponse('any_available_practitioner');
      }
    }

    // Add-ons: staff path honours hidden_from_online groups.
    const addonIds = searchParams.getAll('addon_ids').filter(Boolean);
    let additionalAddonMinutes = 0;
    if (addonIds.length > 0) {
      const useUnified = await venueUsesUnifiedAppointmentServiceData(admin, calendarVenueId);
      const schema = useUnified ? 'service_item' : 'appointment_service';
      const { groups } = await loadAddonsForBooking({
        admin,
        venueId: calendarVenueId,
        schema,
        parentId: serviceId,
        includeHidden: true,
      });
      const validation = validateAddonSelections({
        selections: addonIds.map((id) => ({ addon_id: id })),
        groupsForService: groups,
        source: 'staff',
      });
      if (!validation.ok) {
        return NextResponse.json(
          { error: 'INVALID_ADDON_SELECTION', details: validation.errors },
          { status: 400 },
        );
      }
      for (const a of validation.resolvedAddons) {
        additionalAddonMinutes += a.additional_duration_minutes;
      }
    }

    const monthOptions = {
      audience: 'staff' as const,
      variantOverride,
      customDurationMinutes,
      additionalAddonMinutes,
      excludeBookingId:
        excludeBookingId && UUID_RE.test(excludeBookingId) ? excludeBookingId : null,
    };

    const available_dates = anyAvailable
      ? await computeAnyAvailableAppointmentDatesInMonth(
          admin,
          calendarVenueId,
          serviceId,
          year,
          month,
          monthOptions,
        )
      : await computeAppointmentAvailableDatesInMonth(
          admin,
          calendarVenueId,
          practitionerId!,
          serviceId,
          year,
          month,
          monthOptions,
        );

    return NextResponse.json(
      {
        venue_id: staff.venue_id,
        practitioner_id: anyAvailable ? ANY_AVAILABLE_PRACTITIONER_ID : practitionerId,
        service_id: serviceId,
        year,
        month,
        available_dates,
        any_available: anyAvailable || undefined,
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
