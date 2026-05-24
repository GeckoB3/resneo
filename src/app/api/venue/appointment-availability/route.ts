import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveVenueMode } from '@/lib/venue-mode';
import {
  isUnifiedSchedulingVenue,
  venueUsesUnifiedAppointmentData,
} from '@/lib/booking/unified-scheduling';
import {
  attachVenueClockToAppointmentInput,
  computeAppointmentAvailability,
  fetchAppointmentInput,
  validateAppointmentCustomInterval,
} from '@/lib/availability/appointment-engine';
import { applyVariantToAppointmentInput } from '@/lib/appointments/service-variant';
import { loadActiveVariantForService } from '@/lib/venue/service-variants';
import {
  DEFAULT_ENTITY_BOOKING_WINDOW,
  isStaffWalkInBookingDateAllowed,
  loadServiceEntityBookingWindow,
} from '@/lib/booking/entity-booking-window';
import { resolveLinkedStaffCatalogScope } from '@/lib/booking/staff-booking-access';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toMinutes(value: string): number {
  const [h, m] = value.slice(0, 5).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * GET /api/venue/appointment-availability
 * Staff day-level appointment slots using staff booking-window rules (same-day allowed,
 * past slots on today allowed). Supports linked-owner venues and reschedule exclusion.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const { searchParams } = request.nextUrl;
    const date = searchParams.get('date');
    const practitionerId = searchParams.get('practitioner_id');
    const serviceId = searchParams.get('service_id');
    const variantId = searchParams.get('variant_id');
    const durationParam = searchParams.get('duration_minutes');
    const excludeBookingId = searchParams.get('exclude_booking_id');

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Valid date query parameter is required' }, { status: 400 });
    }
    if (!practitionerId || !serviceId) {
      return NextResponse.json(
        { error: 'practitioner_id and service_id are required' },
        { status: 400 },
      );
    }

    const customDurationMinutes = durationParam ? parseInt(durationParam, 10) : null;
    if (
      customDurationMinutes != null &&
      (!Number.isInteger(customDurationMinutes) || customDurationMinutes < 15 || customDurationMinutes > 14 * 60)
    ) {
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
      venueMode.bookingModel === 'practitioner_appointment' ||
      venueUsesUnifiedAppointmentData(venueMode.bookingModel, venueMode.enabledModels);
    if (!supportsAppointments) {
      return NextResponse.json(
        { error: 'This venue does not offer appointment bookings' },
        { status: 403 },
      );
    }

    let variantOverride: Awaited<ReturnType<typeof loadActiveVariantForService>> = null;
    if (variantId) {
      variantOverride = await loadActiveVariantForService({
        admin,
        venueId: calendarVenueId,
        serviceId,
        variantId,
      });
      if (!variantOverride) {
        return NextResponse.json({ error: 'Invalid variant_id for this service' }, { status: 400 });
      }
    }

    const { data: venueClock } = await admin
      .from('venues')
      .select('timezone, booking_rules, opening_hours, venue_opening_exceptions')
      .eq('id', calendarVenueId)
      .single();
    const bookingWindow =
      (await loadServiceEntityBookingWindow(admin, calendarVenueId, venueMode.bookingModel, serviceId)) ??
      DEFAULT_ENTITY_BOOKING_WINDOW;
    const tz =
      typeof venueClock?.timezone === 'string' && venueClock.timezone.trim() !== ''
        ? venueClock.timezone.trim()
        : 'Europe/London';

    if (!isStaffWalkInBookingDateAllowed(date, bookingWindow, tz)) {
      return NextResponse.json({ date, venue_id: calendarVenueId, practitioners: [] });
    }

    const input = await fetchAppointmentInput({
      supabase: admin,
      venueId: calendarVenueId,
      date,
      practitionerId,
      serviceId,
    });
    if (excludeBookingId && UUID_RE.test(excludeBookingId)) {
      const excludeLc = excludeBookingId.toLowerCase();
      input.existingBookings = input.existingBookings.filter((b) => b.id.toLowerCase() !== excludeLc);
    }
    if (variantOverride) {
      applyVariantToAppointmentInput({ services: input.services, serviceId, variant: variantOverride });
    }
    attachVenueClockToAppointmentInput(input, venueClock ?? {}, bookingWindow);
    input.skipPastSlotFilter = true;

    const result = computeAppointmentAvailability(input);
    if (customDurationMinutes != null) {
      result.practitioners = result.practitioners.map((practitioner) => ({
        ...practitioner,
        slots: practitioner.slots.filter((slot) => {
          if (slot.service_id !== serviceId) return true;
          const startMin = toMinutes(slot.start_time);
          const endMinutes = startMin + customDurationMinutes;
          const endHHmm = `${String(Math.floor((endMinutes % (24 * 60)) / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
          return validateAppointmentCustomInterval(
            input,
            practitioner.id,
            serviceId,
            slot.start_time,
            endHHmm,
            excludeBookingId ?? undefined,
          ).ok;
        }),
      }));
    }

    return NextResponse.json({
      date,
      venue_id: calendarVenueId,
      ...result,
    });
  } catch (err) {
    console.error('GET /api/venue/appointment-availability failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
