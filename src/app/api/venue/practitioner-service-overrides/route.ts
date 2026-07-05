import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireManagedCalendarAccess, requireManagedCalendarIds } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { z } from 'zod';
import type { AppointmentService } from '@/types/booking-models';
import { venueUsesUnifiedAppointmentServiceData } from '@/lib/booking/uses-unified-appointment-data';

const patchSchema = z.object({
  service_id: z.string().uuid(),
  /** Required when the staff member manages more than one bookable calendar (unified scheduling). */
  calendar_id: z.string().uuid().optional(),
  custom_name: z.union([z.string().min(1).max(200), z.null()]).optional(),
  custom_description: z.union([z.string().max(2000), z.null()]).optional(),
  custom_duration_minutes: z.union([z.number().int().min(5).max(480), z.null()]).optional(),
  custom_buffer_minutes: z.union([z.number().int().min(0).max(120), z.null()]).optional(),
  custom_price_pence: z.union([z.number().int().min(0), z.null()]).optional(),
  custom_deposit_pence: z.union([z.number().int().min(0), z.null()]).optional(),
  custom_colour: z.union([z.string().max(20), z.null()]).optional(),
});

const OVERRIDE_TO_PERMISSION: Record<
  string,
  keyof Pick<
    AppointmentService,
    | 'staff_may_customize_name'
    | 'staff_may_customize_description'
    | 'staff_may_customize_duration'
    | 'staff_may_customize_buffer'
    | 'staff_may_customize_price'
    | 'staff_may_customize_deposit'
    | 'staff_may_customize_colour'
  >
> = {
  custom_name: 'staff_may_customize_name',
  custom_description: 'staff_may_customize_description',
  custom_duration_minutes: 'staff_may_customize_duration',
  custom_buffer_minutes: 'staff_may_customize_buffer',
  custom_price_pence: 'staff_may_customize_price',
  custom_deposit_pence: 'staff_may_customize_deposit',
  custom_colour: 'staff_may_customize_colour',
};

async function practitionerOffersService(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  practitionerId: string,
  serviceId: string,
): Promise<boolean> {
  const { data: links, error } = await admin
    .from('practitioner_services')
    .select('service_id')
    .eq('practitioner_id', practitionerId);
  if (error) {
    console.error('practitionerOffersService:', error.message);
    return false;
  }
  const list = links ?? [];
  if (list.length === 0) return false;
  return list.some((l: { service_id: string }) => l.service_id === serviceId);
}

async function calendarOffersServiceItem(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  calendarId: string,
  serviceItemId: string,
): Promise<boolean> {
  const { data: links, error } = await admin
    .from('calendar_service_assignments')
    .select('service_item_id')
    .eq('calendar_id', calendarId);
  if (error) {
    console.error('calendarOffersServiceItem:', error.message);
    return false;
  }
  const list = links ?? [];
  if (list.length === 0) return false;
  return list.some((l: { service_item_id: string }) => l.service_item_id === serviceItemId);
}

/**
 * PATCH - staff only. Upsert per-practitioner overrides for one service (price, duration, etc.)
 * when the venue admin has enabled the matching staff_may_customize_* flags on the service.
 */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (staff.role === 'admin') {
      return NextResponse.json(
        { error: 'Use the Services page or admin tools to edit venue-wide settings.' },
        { status: 403 },
      );
    }

    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const { service_id, calendar_id: calendarIdOpt, ...rawPatch } = parsed.data;
    const admin = getSupabaseAdminClient();

    const useUnified = await venueUsesUnifiedAppointmentServiceData(admin, staff.venue_id);

    if (useUnified) {
      let calendarId: string;
      if (calendarIdOpt) {
        const access = await requireManagedCalendarAccess(
          admin,
          staff.venue_id,
          staff,
          calendarIdOpt,
          'That calendar is not assigned to your account',
        );
        if (!access.ok) {
          return NextResponse.json({ error: access.error }, { status: 403 });
        }
        calendarId = calendarIdOpt;
      } else {
        const scope = await requireManagedCalendarIds(admin, staff.venue_id, staff);
        if (!scope.ok) {
          return NextResponse.json({ error: scope.error }, { status: 403 });
        }
        if (scope.managedCalendarIds.length === 1) {
          calendarId = scope.managedCalendarIds[0];
        } else {
          return NextResponse.json(
            {
              error:
                'You manage more than one calendar — choose which calendar to update (calendar_id in the request body).',
            },
            { status: 400 },
          );
        }
      }

      const offers = await calendarOffersServiceItem(admin, calendarId, service_id);
      if (!offers) {
        return NextResponse.json({ error: 'This service is not offered on your calendar' }, { status: 400 });
      }

      const { data: svc, error: svcErr } = await admin
        .from('service_items')
        .select('id')
        .eq('id', service_id)
        .eq('venue_id', staff.venue_id)
        .maybeSingle();

      if (svcErr || !svc) {
        return NextResponse.json({ error: 'Service not found' }, { status: 404 });
      }

      const updates: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rawPatch)) {
        if (value === undefined) continue;
        if (key !== 'custom_duration_minutes' && key !== 'custom_price_pence') continue;
        updates[key] = value;
      }

      if (Object.keys(updates).length === 0) {
        return NextResponse.json(
          { error: 'No valid fields to update (unified scheduling supports duration and price overrides only).' },
          { status: 400 },
        );
      }

      const { data: existing, error: exErr } = await admin
        .from('calendar_service_assignments')
        .select('id')
        .eq('calendar_id', calendarId)
        .eq('service_item_id', service_id)
        .maybeSingle();

      if (exErr) {
        console.error('PATCH practitioner-service-overrides (USE) lookup:', exErr);
        return NextResponse.json({ error: 'Failed to load link' }, { status: 500 });
      }

      const useUpdates: Record<string, unknown> = {};
      if (updates.custom_duration_minutes !== undefined) {
        useUpdates.custom_duration_minutes = updates.custom_duration_minutes;
      }
      if (updates.custom_price_pence !== undefined) {
        useUpdates.custom_price_pence = updates.custom_price_pence;
      }

      if (existing?.id) {
        const { error: upErr } = await admin
          .from('calendar_service_assignments')
          .update(useUpdates)
          .eq('id', existing.id);
        if (upErr) {
          console.error('PATCH practitioner-service-overrides (USE) update:', upErr);
          return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
        }
      } else {
        const { error: insErr } = await admin.from('calendar_service_assignments').insert({
          calendar_id: calendarId,
          service_item_id: service_id,
          ...useUpdates,
        });
        if (insErr) {
          console.error('PATCH practitioner-service-overrides (USE) insert:', insErr);
          return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
        }
      }

      return NextResponse.json({ success: true });
    }

    const scope = await requireManagedCalendarIds(admin, staff.venue_id, staff);
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: 403 });
    }
    if (scope.managedCalendarIds.length === 0) {
      return NextResponse.json({ error: 'No calendars are assigned to your account. Ask an admin to assign at least one calendar.' }, { status: 403 });
    }

    const { data: practitionerRows, error: practitionerErr } = await admin
      .from('practitioners')
      .select('id')
      .eq('venue_id', staff.venue_id)
      .in('id', scope.managedCalendarIds);
    if (practitionerErr) {
      console.error('PATCH practitioner-service-overrides practitioners lookup:', practitionerErr.message);
      return NextResponse.json({ error: 'Could not verify your assigned appointment calendars.' }, { status: 500 });
    }
    const practitionerIds = new Set((practitionerRows ?? []).map((r) => r.id as string));

    let practitionerId: string;
    if (calendarIdOpt) {
      if (!scope.managedCalendarIds.includes(calendarIdOpt) || !practitionerIds.has(calendarIdOpt)) {
        return NextResponse.json({ error: 'That calendar is not assigned to your account' }, { status: 403 });
      }
      practitionerId = calendarIdOpt;
    } else {
      const assignedPractitionerIds = scope.managedCalendarIds.filter((id) => practitionerIds.has(id));
      if (assignedPractitionerIds.length === 0) {
        return NextResponse.json(
          { error: 'No appointment calendar is assigned to your account. Ask an admin to assign one.' },
          { status: 403 },
        );
      }
      if (assignedPractitionerIds.length > 1) {
        return NextResponse.json(
          { error: 'You manage more than one calendar — choose which calendar to update (calendar_id in the request body).' },
          { status: 400 },
        );
      }
      practitionerId = assignedPractitionerIds[0];
    }

    const offers = await practitionerOffersService(admin, practitionerId, service_id);
    if (!offers) {
      return NextResponse.json({ error: 'This service is not offered on your calendar' }, { status: 400 });
    }

    const { data: svc, error: svcErr } = await admin
      .from('appointment_services')
      .select('*')
      .eq('id', service_id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (svcErr || !svc) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }

    const service = svc as AppointmentService;

    // On a card_hold service the deposit override becomes the effective no-show fee
    // via the merge, so it carries the same £1 floor as the base fee (§6.2). Null
    // clears the override (falls back to the service fee) and stays allowed.
    if (
      service.payment_requirement === 'card_hold' &&
      rawPatch.custom_deposit_pence != null &&
      rawPatch.custom_deposit_pence < 100
    ) {
      return NextResponse.json(
        { error: 'Set a no-show fee of at least £1, or leave it blank to use the service fee.' },
        { status: 400 },
      );
    }

    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawPatch)) {
      if (value === undefined) continue;
      const perm = OVERRIDE_TO_PERMISSION[key];
      if (!perm) continue;
      if (!Boolean(service[perm])) {
        return NextResponse.json(
          { error: `You are not allowed to customise this field for this service (${key}).` },
          { status: 403 },
        );
      }
      updates[key] = value;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { data: existing, error: exErr } = await admin
      .from('practitioner_services')
      .select('id')
      .eq('practitioner_id', practitionerId)
      .eq('service_id', service_id)
      .maybeSingle();

    if (exErr) {
      console.error('PATCH practitioner-service-overrides lookup:', exErr);
      return NextResponse.json({ error: 'Failed to load link' }, { status: 500 });
    }

    if (existing?.id) {
      const { error: upErr } = await admin
        .from('practitioner_services')
        .update(updates)
        .eq('id', existing.id);
      if (upErr) {
        console.error('PATCH practitioner-service-overrides update:', upErr);
        return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
      }
    } else {
      const { error: insErr } = await admin.from('practitioner_services').insert({
        practitioner_id: practitionerId,
        service_id,
        ...updates,
      });
      if (insErr) {
        console.error('PATCH practitioner-service-overrides insert:', insErr);
        return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('PATCH /api/venue/practitioner-service-overrides failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
