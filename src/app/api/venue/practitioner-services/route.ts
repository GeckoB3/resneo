import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import {
  getVenueStaff,
  requireManagedCalendarAccess,
  requireManagedCalendarIds,
} from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import type { PractitionerService } from '@/types/booking-models';
import {
  findBookingsAffectedByRemovingServicesLegacy,
  findBookingsAffectedByRemovingServicesUnified,
  serviceRemovalConfirmationPayload,
} from '@/lib/venue/service-calendar-removal';
import { z } from 'zod';
import { venueUsesUnifiedAppointmentServiceData } from '@/lib/booking/uses-unified-appointment-data';
import {
  sameIdSet,
  setCalendarServiceAssignments,
  STALE_CALENDAR_SERVICES_MESSAGE,
} from '@/lib/venue/calendar-service-assignment-writes';
import { apiError } from '@/lib/api/error-codes';

const syncSchema = z.object({
  practitioner_id: z.string().uuid(),
  service_ids: z.array(z.string().uuid()),
  /** The calendar's service ids as the client loaded them. A mismatch answers 412 and writes nothing. */
  expected_service_ids: z.array(z.string().uuid()).optional(),
});

/**
 * PUT /api/venue/practitioner-services
 * Sets which services a calendar offers. The stored set is changed by a diff in one transaction,
 * so kept rows keep their id and custom values; with `expected_service_ids` a save made from a
 * stale copy answers 412 STALE_RESOURCE instead of undoing someone else's change.
 * For `unified_scheduling`, `practitioner_id` is a `unified_calendars.id`.
 * Removing a service from this calendar does not assign it elsewhere; links on other calendars are unchanged.
 *
 * Removing one that already has upcoming bookings is allowed: the calendar stops offering it
 * to new guests and the bookings already taken stay exactly where they are. The first attempt
 * answers 409 with those bookings listed so the dashboard can show them and offer to move
 * them; `?acknowledge_affected_bookings=true` then carries the same save through.
 */
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const body = await request.json();
    const parsed = syncSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const { practitioner_id, service_ids, expected_service_ids } = parsed.data;
    const admin = getSupabaseAdminClient();
    const acknowledgeAffectedBookings =
      request.nextUrl.searchParams.get('acknowledge_affected_bookings') === 'true';

    const useUnified = await venueUsesUnifiedAppointmentServiceData(admin, staff.venue_id);

    /** Empty array clears all service links for that calendar (classes/resources can still use the column). */
    const effectiveServiceIds = [...service_ids];

    if (useUnified) {
      const { data: cal, error: calErr } = await admin
        .from('unified_calendars')
        .select('id')
        .eq('id', practitioner_id)
        .eq('venue_id', staff.venue_id)
        .single();

      if (calErr || !cal) {
        return NextResponse.json({ error: 'Calendar not found' }, { status: 404 });
      }

      if (staff.role !== 'admin') {
        const access = await requireManagedCalendarAccess(
          admin,
          staff.venue_id,
          staff,
          practitioner_id,
          'You can only update service links for calendars assigned to your account.',
        );
        if (!access.ok) {
          return NextResponse.json({ error: access.error }, { status: 403 });
        }
      }

      const { data: existingRows, error: existingErr } = await admin
        .from('calendar_service_assignments')
        .select('service_item_id')
        .eq('calendar_id', practitioner_id);
      if (existingErr) {
        console.error('PUT /api/venue/practitioner-services (USE) read failed:', existingErr);
        return NextResponse.json({ error: 'Failed to save service links' }, { status: 500 });
      }

      const previousServiceIds = new Set(
        (existingRows ?? []).map((r) => (r as { service_item_id: string }).service_item_id),
      );
      if (expected_service_ids && !sameIdSet([...previousServiceIds], expected_service_ids)) {
        return NextResponse.json(apiError(STALE_CALENDAR_SERVICES_MESSAGE, 'STALE_RESOURCE'), { status: 412 });
      }
      const nextServiceIds = new Set(effectiveServiceIds);
      const removedServiceIds = [...previousServiceIds].filter((sid) => !nextServiceIds.has(sid));
      if (removedServiceIds.length > 0 && !acknowledgeAffectedBookings) {
        const impact = await findBookingsAffectedByRemovingServicesUnified(admin, {
          venueId: staff.venue_id,
          calendarIds: [practitioner_id],
          serviceItemIds: removedServiceIds,
        });
        if (impact.error) {
          return NextResponse.json({ error: impact.error }, { status: 500 });
        }
        if (impact.total > 0) {
          return NextResponse.json(serviceRemovalConfirmationPayload(impact), { status: 409 });
        }
      }

      const written = await setCalendarServiceAssignments(admin, {
        venueId: staff.venue_id,
        calendarId: practitioner_id,
        serviceItemIds: effectiveServiceIds,
        expectedServiceItemIds: expected_service_ids ?? null,
      });
      if (!written.ok) {
        if (written.reason === 'stale') {
          return NextResponse.json(apiError(STALE_CALENDAR_SERVICES_MESSAGE, 'STALE_RESOURCE'), { status: 412 });
        }
        if (written.reason === 'not_at_venue') {
          return NextResponse.json({ error: 'One or more services were not found at this venue.' }, { status: 403 });
        }
        console.error('PUT /api/venue/practitioner-services (USE) write failed:', written.message);
        return NextResponse.json({ error: 'Failed to save service links' }, { status: 500 });
      }

      return NextResponse.json({ success: true, added: written.added, removed: written.removed });
    }

    const { data: prac } = await admin
      .from('practitioners')
      .select('id, staff_id')
      .eq('id', practitioner_id)
      .eq('venue_id', staff.venue_id)
      .single();

    if (!prac) {
      return NextResponse.json({ error: 'Practitioner not found' }, { status: 404 });
    }

    if (staff.role !== 'admin') {
      const scope = await requireManagedCalendarIds(admin, staff.venue_id, staff);
      if (!scope.ok) {
        return NextResponse.json({ error: scope.error }, { status: 403 });
      }
      if (!scope.managedCalendarIds.includes(practitioner_id)) {
        return NextResponse.json({ error: 'You can only update service links for your own calendar.' }, { status: 403 });
      }
    }

    const { data: existingRows } = await admin
      .from('practitioner_services')
      .select('*')
      .eq('practitioner_id', practitioner_id);

    const preserve = new Map(
      (existingRows ?? []).map((r: PractitionerService) => [r.service_id, r]),
    );

    const previousLegacyIds = new Set(preserve.keys());
    const nextLegacyIds = new Set(effectiveServiceIds);
    const removedLegacyIds = [...previousLegacyIds].filter((sid) => !nextLegacyIds.has(sid));
    if (removedLegacyIds.length > 0 && !acknowledgeAffectedBookings) {
      const impact = await findBookingsAffectedByRemovingServicesLegacy(admin, {
        venueId: staff.venue_id,
        practitionerIds: [practitioner_id],
        appointmentServiceIds: removedLegacyIds,
      });
      if (impact.error) {
        return NextResponse.json({ error: impact.error }, { status: 500 });
      }
      if (impact.total > 0) {
        return NextResponse.json(serviceRemovalConfirmationPayload(impact), { status: 409 });
      }
    }

    await admin.from('practitioner_services').delete().eq('practitioner_id', practitioner_id);

    if (effectiveServiceIds.length > 0) {
      const links = effectiveServiceIds.map((sid) => {
        const prev = preserve.get(sid);
        return {
          practitioner_id,
          service_id: sid,
          custom_price_pence: prev?.custom_price_pence ?? null,
          custom_duration_minutes: prev?.custom_duration_minutes ?? null,
          custom_name: prev?.custom_name ?? null,
          custom_description: prev?.custom_description ?? null,
          custom_buffer_minutes: prev?.custom_buffer_minutes ?? null,
          custom_deposit_pence: prev?.custom_deposit_pence ?? null,
          custom_colour: prev?.custom_colour ?? null,
        };
      });
      const { error } = await admin.from('practitioner_services').insert(links);
      if (error) {
        console.error('PUT /api/venue/practitioner-services insert failed:', error);
        return NextResponse.json({ error: 'Failed to save service links' }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('PUT /api/venue/practitioner-services failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
