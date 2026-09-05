import {
  MAX_APPOINTMENT_CORE_DURATION_MINUTES,
  MIN_APPOINTMENT_CORE_DURATION_MINUTES,
} from '@/lib/availability/appointment-engine';
import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveVenueMode } from '@/lib/venue-mode';
import { VENUE_CATALOG_CACHE_CONTROL } from '@/lib/realtime/dashboard-sync-constants';
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
import { resolveStaffCollectiveScope } from '@/lib/linked-accounts/collective-staff-scope';
import { loadCollectiveMonthAvailableDates } from '@/lib/linked-accounts/collective-booking-bridge';
import { loadAddonsForBooking } from '@/lib/addons/addon-resolution';
import { validateAddonSelections } from '@/lib/addons/addon-selection-validation';
import { venueUsesUnifiedAppointmentServiceData } from '@/lib/booking/uses-unified-appointment-data';
import { withScheduleFailClosed } from '@/lib/availability/schedule-unavailable-response';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET /api/venue/appointment-calendar?practitioner_id=&service_id=&year=&month=
 * Staff variant of the public appointment-calendar endpoint.
 * Returns month dates with at least one bookable appointment slot for the given
 * practitioner/calendar + service, using staff booking-window rules (same-day allowed).
 */
/**
 * Stage 7 (decision J): fail closed rather than open.
 *
 * The month path is the most exposed surface in the programme:
 * `appointment-month-availability.ts` carries TWELVE fail-open reads, and a failure there
 * does not remove one time, it removes whole DATES from the picker. The guest copy was
 * wrapped in Stage 7 and this, the staff copy on the same module, was not. It is the
 * mobile app's date picker (R20-1), which DISABLES the dates this route omits.
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
  return withScheduleFailClosed(() => handleStaffAppointmentCalendarGet(request));
}

async function handleStaffAppointmentCalendarGet(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
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
    if (customDurationMinutes != null && (!Number.isInteger(customDurationMinutes) ||
      customDurationMinutes < MIN_APPOINTMENT_CORE_DURATION_MINUTES ||
      customDurationMinutes > MAX_APPOINTMENT_CORE_DURATION_MINUTES)) {
      return NextResponse.json({ error: 'Invalid duration_minutes' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();

    const ownerVenueParam = searchParams.get('owner_venue_id');
    const ownerVenueId = ownerVenueParam && UUID_RE.test(ownerVenueParam) ? ownerVenueParam : null;

    // A live venue collective the caller belongs to: the staff form books for the
    // whole collective, so the month is the union of every provider calendar's
    // real availability, exactly as the combined public page computes it.
    const collective = ownerVenueId
      ? await resolveStaffCollectiveScope(admin, staff.venue_id, ownerVenueId)
      : null;
    if (collective) {
      const payload = await loadCollectiveMonthAvailableDates(admin, {
        collectiveId: collective.collectiveId,
        offeringId: serviceId,
        calendarId: anyAvailable ? null : practitionerId,
        anyAvailable,
        year,
        month,
        durationMinutes: customDurationMinutes,
        variantId: variantId ?? null,
        addonIds: searchParams.getAll('addon_ids').filter(Boolean),
        audience: 'staff',
        excludeBookingId: excludeBookingId && UUID_RE.test(excludeBookingId) ? excludeBookingId : null,
        // Staff also book each member's own services, not only the combined offerings.
        includeMemberOwnServices: true,
      });
      return NextResponse.json(payload, { headers: { 'Cache-Control': VENUE_CATALOG_CACHE_CONTROL } });
    }

    const scope = await resolveLinkedStaffCatalogScope(admin, staff.venue_id, ownerVenueId);
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
          // Was `private, max-age=45, stale-while-revalidate=120`, giving a ~165s
          // window in which a staff member returning to a month they already
          // viewed could book a slot someone else had since taken. The rest of the
          // venue catalog migrated to no-store after the same class of staleness
          // bug; this endpoint was missed. It is user-driven rather than polled,
          // and the cache was `private` so it never reduced load across users, so
          // removing it does not materially change traffic.
          'Cache-Control': VENUE_CATALOG_CACHE_CONTROL,
        },
      },
    );
  } catch (err) {
    console.error('GET /api/venue/appointment-calendar failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
