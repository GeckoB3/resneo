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
 * PATCH - a calendar's own values for one service: name, description, length, buffer, price,
 * deposit and colour (W8, D4, D5).
 *
 * Who may set them (D4): a staff member on a calendar they manage, for each field whose
 * `staff_may_customize_*` flag is on; or one of the venue's admins, on any calendar at the venue,
 * whatever the flags say. `null` clears a value back to the service's own.
 *
 * Every venue is on unified scheduling, so values are stored on `calendar_service_assignments`.
 * Before migration 20270214140000 only length and price had storage there and the other five were
 * refused or silently dropped (PB-01). The legacy branch below is kept for the old model only.
 */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const { service_id, calendar_id: calendarIdOpt, ...rawPatch } = parsed.data;
    const admin = getSupabaseAdminClient();
    const isAdmin = staff.role === 'admin';

    const useUnified = await venueUsesUnifiedAppointmentServiceData(admin, staff.venue_id);

    if (!useUnified && isAdmin) {
      return NextResponse.json(
        { error: 'Use the Services page or admin tools to edit venue-wide settings.' },
        { status: 403 },
      );
    }

    if (useUnified) {
      let calendarId: string;
      if (isAdmin) {
        // D4: an admin chooses the calendar, which must be one of this venue's.
        if (!calendarIdOpt) {
          return NextResponse.json({ error: 'Choose which calendar to update (calendar_id).' }, { status: 400 });
        }
        const { data: cal } = await admin
          .from('unified_calendars')
          .select('id')
          .eq('id', calendarIdOpt)
          .eq('venue_id', staff.venue_id)
          .maybeSingle();
        if (!cal) {
          return NextResponse.json({ error: 'That calendar is not part of your venue.' }, { status: 403 });
        }
        calendarId = calendarIdOpt;
      } else if (calendarIdOpt) {
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
                'You manage more than one calendar. Choose which calendar to update (calendar_id in the request body).',
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
        // The staff_may_customize_* flags are the whole authorisation model for staff on this
        // route; selecting only `id` is what once let the gate go missing.
        .select('*')
        .eq('id', service_id)
        .eq('venue_id', staff.venue_id)
        .maybeSingle();

      if (svcErr || !svc) {
        return NextResponse.json({ error: 'Service not found' }, { status: 404 });
      }

      const unifiedService = svc as AppointmentService;

      const updates: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rawPatch)) {
        if (value === undefined) continue;
        const perm = OVERRIDE_TO_PERMISSION[key];
        if (!perm) continue;
        if (!isAdmin && !Boolean(unifiedService[perm])) {
          return NextResponse.json(
            { error: `You are not allowed to customise this field for this service (${key}).` },
            { status: 403 },
          );
        }
        updates[key] = typeof value === 'string' && key === 'custom_name' ? value.trim() : value;
      }

      if (Object.keys(updates).length === 0) {
        return NextResponse.json({ error: 'No values to update.' }, { status: 400 });
      }
      if (updates.custom_name === '') {
        return NextResponse.json(
          { error: 'Enter a name, or clear it to use the service name.' },
          { status: 400 },
        );
      }

      // On a card-hold service a calendar's deposit is its no-show fee, with the same 1.00 floor as
      // the service's own fee. Null clears it back to the service fee and stays allowed.
      if (
        unifiedService.payment_requirement === 'card_hold' &&
        typeof updates.custom_deposit_pence === 'number' &&
        updates.custom_deposit_pence < 100
      ) {
        return NextResponse.json(
          { error: 'Set a no-show fee of at least £1, or leave it blank to use the service fee.' },
          { status: 400 },
        );
      }

      // "Last changed by". Best effort: a session that cannot be read must not lose the save.
      let userId: string | null = null;
      try {
        const { data: userData } = await supabase.auth.getUser();
        userId = userData?.user?.id ?? null;
      } catch {
        userId = null;
      }
      const stamp = { updated_by_venue_id: staff.venue_id, updated_by_user_id: userId };

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

      if (existing?.id) {
        const { error: upErr } = await admin
          .from('calendar_service_assignments')
          .update({ ...updates, ...stamp })
          .eq('id', existing.id);
        if (upErr) {
          console.error('PATCH practitioner-service-overrides (USE) update:', upErr);
          return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
        }
      } else {
        const { error: insErr } = await admin.from('calendar_service_assignments').insert({
          calendar_id: calendarId,
          service_item_id: service_id,
          ...updates,
          ...stamp,
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
          { error: 'You manage more than one calendar. Choose which calendar to update (calendar_id in the request body).' },
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
