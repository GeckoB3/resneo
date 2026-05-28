import { NextRequest, NextResponse } from 'next/server';
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
import { nextResponseIfPublicBookingBlockedForVenue } from '@/lib/booking/light-plan-public-block';
import { loadActiveVariantForService } from '@/lib/venue/service-variants';
import { loadAddonsForBooking } from '@/lib/addons/addon-resolution';
import { validateAddonSelections } from '@/lib/addons/addon-selection-validation';
import { venueUsesUnifiedAppointmentServiceData } from '@/lib/booking/uses-unified-appointment-data';

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
    const anyAvailable =
      searchParams.get('any_available') === '1' || searchParams.get('any_available') === 'true';
    const yearParam = searchParams.get('year');
    const monthParam = searchParams.get('month');
    const variantId = searchParams.get('variant_id');
    const durationParam = searchParams.get('duration_minutes');

    if (!venueId || !serviceId) {
      return NextResponse.json(
        { error: 'venue_id and service_id are required' },
        { status: 400 },
      );
    }
    if (!practitionerId && !anyAvailable) {
      return NextResponse.json(
        { error: 'practitioner_id is required unless any_available is set' },
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

    // Add-ons: extend the service duration so month dates that don't fit the longer
    // total (base + variant + add-ons) are correctly hidden in the date picker.
    const addonIds = searchParams.getAll('addon_ids').filter(Boolean);
    let additionalAddonMinutes = 0;
    if (addonIds.length > 0) {
      const useUnified = await venueUsesUnifiedAppointmentServiceData(supabase, venueId);
      const schema = useUnified ? 'service_item' : 'appointment_service';
      const { groups } = await loadAddonsForBooking({
        admin: supabase,
        venueId,
        schema,
        parentId: serviceId,
        includeHidden: false,
      });
      const validation = validateAddonSelections({
        selections: addonIds.map((id) => ({ addon_id: id })),
        groupsForService: groups,
        source: 'public',
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

    if (anyAvailable) {
      const { data: venueFlagsRow } = await supabase
        .from('venues')
        .select('feature_flags')
        .eq('id', venueId)
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

    const available_dates = anyAvailable
      ? await computeAnyAvailableAppointmentDatesInMonth(
          supabase,
          venueId,
          serviceId,
          year,
          month,
          { audience: 'public', variantOverride, customDurationMinutes, additionalAddonMinutes },
        )
      : await computeAppointmentAvailableDatesInMonth(
          supabase,
          venueId,
          practitionerId!,
          serviceId,
          year,
          month,
          { audience: 'public', variantOverride, customDurationMinutes, additionalAddonMinutes },
        );

    return NextResponse.json(
      {
        venue_id: venueId,
        practitioner_id: anyAvailable ? ANY_AVAILABLE_PRACTITIONER_ID : practitionerId,
        service_id: serviceId,
        year,
        month,
        available_dates,
        any_available: anyAvailable || undefined,
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
