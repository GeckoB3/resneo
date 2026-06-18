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
  hasBlockingBookingsRemovingServicesFromCalendarLegacy,
  hasBlockingBookingsRemovingServicesFromCalendarUnified,
  SERVICE_REMOVAL_BLOCKED_BY_BOOKINGS,
} from '@/lib/venue/service-calendar-removal';
import { z } from 'zod';
import { venueUsesUnifiedAppointmentServiceData } from '@/lib/booking/uses-unified-appointment-data';

const syncSchema = z.object({
  practitioner_id: z.string().uuid(),
  service_ids: z.array(z.string().uuid()),
});

/**
 * PUT /api/venue/practitioner-services
 * Replaces all service links for a practitioner calendar with the provided set.
 * For `unified_scheduling`, `practitioner_id` is a `unified_calendars.id`.
 * Removing a service from this calendar does not assign it elsewhere; links on other calendars are unchanged.
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

    const { practitioner_id, service_ids } = parsed.data;
    const admin = getSupabaseAdminClient();

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

      const { data: existingRows } = await admin
        .from('calendar_service_assignments')
        .select('*')
        .eq('calendar_id', practitioner_id);

      const preserve = new Map(
        (existingRows ?? []).map((r) => {
          const row = r as { service_item_id: string; custom_price_pence: number | null; custom_duration_minutes: number | null };
          return [row.service_item_id, row] as const;
        }),
      );

      const previousServiceIds = new Set(preserve.keys());
      const nextServiceIds = new Set(effectiveServiceIds);
      const removedServiceIds = [...previousServiceIds].filter((sid) => !nextServiceIds.has(sid));
      if (removedServiceIds.length > 0) {
        const check = await hasBlockingBookingsRemovingServicesFromCalendarUnified(admin, {
          venueId: staff.venue_id,
          calendarId: practitioner_id,
          serviceItemIds: removedServiceIds,
        });
        if (check.error) {
          return NextResponse.json({ error: check.error }, { status: 500 });
        }
        if (check.blocked) {
          return NextResponse.json({ error: SERVICE_REMOVAL_BLOCKED_BY_BOOKINGS }, { status: 409 });
        }
      }

      await admin.from('calendar_service_assignments').delete().eq('calendar_id', practitioner_id);

      if (effectiveServiceIds.length > 0) {
        const links = effectiveServiceIds.map((sid) => {
          const prev = preserve.get(sid) as
            | { custom_price_pence: number | null; custom_duration_minutes: number | null }
            | undefined;
          return {
            calendar_id: practitioner_id,
            service_item_id: sid,
            custom_price_pence: prev?.custom_price_pence ?? null,
            custom_duration_minutes: prev?.custom_duration_minutes ?? null,
          };
        });
        const { error } = await admin.from('calendar_service_assignments').insert(links);
        if (error) {
          console.error('PUT /api/venue/practitioner-services (USE) insert failed:', error);
          return NextResponse.json({ error: 'Failed to save service links' }, { status: 500 });
        }
      }

      return NextResponse.json({ success: true });
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
    if (removedLegacyIds.length > 0) {
      const check = await hasBlockingBookingsRemovingServicesFromCalendarLegacy(admin, {
        venueId: staff.venue_id,
        practitionerId: practitioner_id,
        appointmentServiceIds: removedLegacyIds,
      });
      if (check.error) {
        return NextResponse.json({ error: check.error }, { status: 500 });
      }
      if (check.blocked) {
        return NextResponse.json({ error: SERVICE_REMOVAL_BLOCKED_BY_BOOKINGS }, { status: 409 });
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
