import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireManagedCalendarAccess, requireManagedCalendarIds } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { checkExperienceEventBatchLimit } from '@/lib/tier-enforcement';
import { requireVenueExposesSecondaryModel } from '@/lib/booking/require-venue-secondary-model';
import { expandWeeklyOccurrences, normaliseCustomDates } from '@/lib/scheduling/experience-event-dates';
import { MAX_MATERIALISED_EVENT_OCCURRENCES } from '@/lib/scheduling/cde-scheduling-rules';
import {
  assertExperienceEventDeletable,
  resolveExperienceEventPatch,
  validateStartEndTimes,
  assertExperienceEventCalendarClearable,
} from '@/lib/experience-events/experience-event-guards';
import { buildEntityNotFoundMessage } from '@/lib/venue/entity-delete-booking-guards';
import { assertExperienceEventWindowFreeOnCalendar } from '@/lib/experience-events/calendar-event-window-conflicts';
import { validateExperienceEventWindowAgainstVenueAndCalendar } from '@/lib/experience-events/event-hours-vs-venue-calendar';
import { createTeamCalendarForEvent } from '@/lib/experience-events/create-team-calendar';
import { z } from 'zod';
import { DEFAULT_ENTITY_BOOKING_WINDOW } from '@/lib/booking/entity-booking-window';
import type { OpeningHours } from '@/types/availability';
import { parseVenueOpeningExceptions } from '@/types/venue-opening-exceptions';
import { rowsToVenueWideBlocks, venueWideBlocksQueryForDate, venueWideBlocksQueryForRange } from '@/lib/availability/venue-wide-blocks-fetch';
import { zExperienceEventDescription, zExperienceEventHhMm } from '@/lib/experience-events/experience-event-zod';

const eventSchema = z.object({
  name: z.string().min(1).max(200),
  description: zExperienceEventDescription,
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: zExperienceEventHhMm,
  end_time: zExperienceEventHhMm,
  capacity: z.number().int().min(1),
  image_url: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().url().optional()),
  is_recurring: z.boolean().optional(),
  recurrence_rule: z.string().optional(),
  parent_event_id: z.string().uuid().optional(),
  is_active: z.boolean().optional(),
  /** Unified calendar column for staff calendar placement; null clears. */
  calendar_id: z.union([z.string().uuid(), z.null()]).optional(),
  max_advance_booking_days: z.number().int().min(1).max(365).optional(),
  min_booking_notice_hours: z.number().int().min(0).max(168).optional(),
  cancellation_notice_hours: z.number().int().min(0).max(168).optional(),
  allow_same_day_booking: z.boolean().optional(),
  payment_requirement: z.enum(['none', 'deposit', 'full_payment']).optional(),
  deposit_amount_pence: z.number().int().min(0).nullish(),
  ticket_types: z.array(z.object({
    name: z.string().min(1),
    price_pence: z.number().int().min(0),
    capacity: z.number().int().min(1).optional(),
    sort_order: z.number().int().optional(),
  })).optional(),
});

const scheduleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('single') }),
  z.object({
    type: z.literal('weekly'),
    until_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({
    type: z.literal('custom'),
    dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1),
  }),
]);

const createEventBodySchema = eventSchema.extend({
  schedule: scheduleSchema.optional(),
  /** Creates a new team calendar row and assigns this event to it (unified scheduling only). */
  new_calendar_name: z.string().min(1).max(200).optional(),
});

const patchEventBodySchema = eventSchema.partial().extend({
  new_calendar_name: z.string().min(1).max(200).optional(),
});

function timeHhMm(t: string): string {
  const s = String(t).trim();
  return s.length >= 5 ? s.slice(0, 5) : s;
}

/** GET /api/venue/experience-events - list events with ticket types. */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const from = request.nextUrl.searchParams.get('from');
    const to = request.nextUrl.searchParams.get('to');

    let query = admin
      .from('experience_events')
      .select('*, ticket_types:event_ticket_types(*)')
      .eq('venue_id', staff.venue_id)
      .order('event_date', { ascending: true });

    if (from) query = query.gte('event_date', from);
    if (to) query = query.lte('event_date', to);

    const { data, error } = await query;
    if (error) {
      console.error('GET /api/venue/experience-events failed:', error);
      return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
    }

    return NextResponse.json({ events: data });
  } catch (err) {
    console.error('GET /api/venue/experience-events failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/venue/experience-events - create an event with ticket types (admin or staff on a managed calendar). */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const modelGate = await requireVenueExposesSecondaryModel(admin, staff.venue_id, 'event_ticket');
    if (!modelGate.ok) return modelGate.response;

    const body = await request.json();
    const parsed = createEventBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const {
      ticket_types, schedule, new_calendar_name,
      calendar_id: requestedCalendarId, payment_requirement, deposit_amount_pence,
      ...eventFields
    } = parsed.data;

    if (payment_requirement === 'deposit' && (!deposit_amount_pence || deposit_amount_pence <= 0)) {
      return NextResponse.json(
        { error: 'Deposit amount must be greater than zero when payment requirement is deposit.' },
        { status: 400 },
      );
    }

    if (new_calendar_name && requestedCalendarId !== undefined) {
      return NextResponse.json(
        { error: 'Use either calendar_id or new_calendar_name, not both.' },
        { status: 400 },
      );
    }

    if (staff.role !== 'admin' && new_calendar_name) {
      return NextResponse.json(
        {
          error:
            'Only venue admins can create new calendar columns. Pick an existing calendar or ask an admin.',
        },
        { status: 403 },
      );
    }

    let resolvedCalendarId: string | null | undefined;
    if (new_calendar_name) {
      const created = await createTeamCalendarForEvent(admin, staff.venue_id, new_calendar_name);
      if (!created.ok) {
        return NextResponse.json({ error: created.error }, { status: created.status });
      }
      resolvedCalendarId = created.id;
    } else if (requestedCalendarId !== undefined) {
      resolvedCalendarId = requestedCalendarId;
    } else {
      resolvedCalendarId = undefined;
    }

    if (staff.role !== 'admin') {
      if (!resolvedCalendarId) {
        return NextResponse.json(
          { error: 'Choose a calendar column for this event.' },
          { status: 400 },
        );
      }
      const { data: ucRow } = await admin
        .from('unified_calendars')
        .select('id')
        .eq('venue_id', staff.venue_id)
        .eq('id', resolvedCalendarId)
        .maybeSingle();
      if (!ucRow) {
        return NextResponse.json(
          {
            error:
              'That staff calendar column was not found for this venue. Add it under Calendar availability first.',
          },
          { status: 400 },
        );
      }
      const access = await requireManagedCalendarAccess(
        admin,
        staff.venue_id,
        staff,
        resolvedCalendarId,
        'You can only create events on calendars assigned to your account.',
      );
      if (!access.ok) {
        return NextResponse.json({ error: access.error }, { status: 403 });
      }
    }

    const timeErr = validateStartEndTimes(eventFields.start_time, eventFields.end_time);
    if (timeErr) {
      return NextResponse.json({ error: timeErr }, { status: 400 });
    }

    let datesToCreate: string[] = [eventFields.event_date];
    const sched = schedule ?? { type: 'single' as const };
    if (sched.type === 'weekly') {
      datesToCreate = expandWeeklyOccurrences(eventFields.event_date, sched.until_date);
    } else if (sched.type === 'custom') {
      datesToCreate = normaliseCustomDates(sched.dates);
    }

    if (datesToCreate.length === 0) {
      return NextResponse.json({ error: 'No valid event dates to create' }, { status: 400 });
    }
    if (datesToCreate.length > MAX_MATERIALISED_EVENT_OCCURRENCES) {
      return NextResponse.json(
        { error: `At most ${MAX_MATERIALISED_EVENT_OCCURRENCES} occurrences per save` },
        { status: 400 },
      );
    }

    const batchCheck = await checkExperienceEventBatchLimit(staff.venue_id, datesToCreate.length);
    if (!batchCheck.allowed) {
      return NextResponse.json(
        {
          error: 'Calendar limit reached for your plan',
          current: batchCheck.current,
          limit: batchCheck.limit,
          upgrade_required: true,
        },
        { status: 403 },
      );
    }

    const baseInsert = {
      venue_id: staff.venue_id,
      name: eventFields.name,
      description: eventFields.description ?? null,
      start_time: eventFields.start_time.length === 5 ? `${eventFields.start_time}:00` : eventFields.start_time,
      end_time: eventFields.end_time.length === 5 ? `${eventFields.end_time}:00` : eventFields.end_time,
      capacity: eventFields.capacity,
      image_url: eventFields.image_url ?? null,
      is_recurring: false,
      recurrence_rule: null as string | null,
      parent_event_id: null as string | null,
      is_active: eventFields.is_active ?? true,
      calendar_id: resolvedCalendarId ?? null,
      max_advance_booking_days:
        eventFields.max_advance_booking_days ?? DEFAULT_ENTITY_BOOKING_WINDOW.max_advance_booking_days,
      min_booking_notice_hours:
        eventFields.min_booking_notice_hours ?? DEFAULT_ENTITY_BOOKING_WINDOW.min_booking_notice_hours,
      cancellation_notice_hours:
        eventFields.cancellation_notice_hours ?? DEFAULT_ENTITY_BOOKING_WINDOW.cancellation_notice_hours,
      allow_same_day_booking:
        eventFields.allow_same_day_booking ?? DEFAULT_ENTITY_BOOKING_WINDOW.allow_same_day_booking,
      payment_requirement: payment_requirement ?? 'none',
      deposit_amount_pence: payment_requirement === 'deposit' ? (deposit_amount_pence ?? null) : null,
    };

    const startHm = timeHhMm(baseInsert.start_time);
    const endHm = timeHhMm(baseInsert.end_time);

    const createdIds: string[] = [];

    let venueHoursPayload: {
      opening_hours: OpeningHours | null;
      venue_opening_exceptions: ReturnType<typeof parseVenueOpeningExceptions>;
      availability_blocks: ReturnType<typeof rowsToVenueWideBlocks>;
    } | null = null;
    let calendarRowForHours: Record<string, unknown> | null = null;

    if (resolvedCalendarId) {
      const sortedCreateDates = [...datesToCreate].sort();
      const minCreateDate = sortedCreateDates[0]!;
      const maxCreateDate = sortedCreateDates[sortedCreateDates.length - 1]!;
      const [{ data: venueRow }, { data: venueWideBlockRows, error: venueBlocksErr }, { data: ucFull, error: ucFullErr }] =
        await Promise.all([
          admin.from('venues').select('opening_hours, venue_opening_exceptions').eq('id', staff.venue_id).single(),
          venueWideBlocksQueryForRange(admin, staff.venue_id, minCreateDate, maxCreateDate),
          admin
            .from('unified_calendars')
            .select('*')
            .eq('id', resolvedCalendarId)
            .eq('venue_id', staff.venue_id)
            .maybeSingle(),
        ]);
      if (venueBlocksErr) {
        console.warn('POST /api/venue/experience-events availability_blocks:', venueBlocksErr.message);
      }
      if (ucFullErr || !ucFull) {
        return NextResponse.json({ error: 'Calendar column not found for this venue.' }, { status: 400 });
      }
      calendarRowForHours = ucFull as Record<string, unknown>;
      venueHoursPayload = {
        opening_hours: (venueRow?.opening_hours as OpeningHours | null) ?? null,
        venue_opening_exceptions: parseVenueOpeningExceptions(venueRow?.venue_opening_exceptions),
        availability_blocks: rowsToVenueWideBlocks(venueWideBlockRows),
      };
    }

    for (const eventDate of datesToCreate) {
      if (resolvedCalendarId && venueHoursPayload && calendarRowForHours) {
        const hoursErr = validateExperienceEventWindowAgainstVenueAndCalendar(
          eventDate,
          startHm,
          endHm,
          venueHoursPayload,
          calendarRowForHours,
        );
        if (hoursErr) {
          return NextResponse.json({ error: hoursErr }, { status: 400 });
        }
      }
      if (resolvedCalendarId) {
        const conflict = await assertExperienceEventWindowFreeOnCalendar(
          admin,
          staff.venue_id,
          resolvedCalendarId,
          eventDate,
          startHm,
          endHm,
        );
        if (conflict) {
          return NextResponse.json({ error: conflict }, { status: 409 });
        }
      }

      const { data: event, error } = await admin
        .from('experience_events')
        .insert({
          ...baseInsert,
          event_date: eventDate,
        })
        .select('id')
        .single();

      if (error || !event) {
        console.error('POST /api/venue/experience-events failed:', error);
        return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
      }

      const eid = event.id as string;
      createdIds.push(eid);

      if (ticket_types && ticket_types.length > 0) {
        const ttRows = ticket_types.map((tt, i) => ({
          event_id: eid,
          name: tt.name,
          price_pence: tt.price_pence,
          capacity: tt.capacity ?? null,
          sort_order: tt.sort_order ?? i,
        }));
        await admin.from('event_ticket_types').insert(ttRows);
      }
    }

    const { data: full } = await admin
      .from('experience_events')
      .select('*, ticket_types:event_ticket_types(*)')
      .eq('id', createdIds[0]!)
      .single();

    return NextResponse.json(
      { created: createdIds.length, event_ids: createdIds, ...(full ?? {}) },
      { status: 201 },
    );
  } catch (err) {
    console.error('POST /api/venue/experience-events failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/venue/experience-events — update an event (JSON body must include `id`).
 * Venue admins may edit any event. Non-admin staff may edit only events already assigned to a calendar they
 * manage; they cannot use `new_calendar_name` (admin-only). For PATCH/DELETE by path segment
 * `/api/venue/experience-events/[id]`, see that route (admin-only on those paths).
 */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const modelGate = await requireVenueExposesSecondaryModel(admin, staff.venue_id, 'event_ticket');
    if (!modelGate.ok) return modelGate.response;

    const body = await request.json();
    const { id, ticket_types, ...rest } = body;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const parsed = patchEventBodySchema.safeParse(rest);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const { new_calendar_name: newCalendarName, payment_requirement: patchPayReq, deposit_amount_pence: patchDepositPence, ...fieldsForResolve } = parsed.data;

    if (patchPayReq === 'deposit' && (patchDepositPence === undefined || patchDepositPence === null || patchDepositPence <= 0)) {
      return NextResponse.json(
        { error: 'Deposit amount must be greater than zero when payment requirement is deposit.' },
        { status: 400 },
      );
    }

    if (newCalendarName && fieldsForResolve.calendar_id !== undefined) {
      return NextResponse.json(
        { error: 'Use either calendar_id or new_calendar_name, not both.' },
        { status: 400 },
      );
    }
    if (staff.role !== 'admin' && newCalendarName) {
      return NextResponse.json(
        { error: 'Only admins can create new calendars. Ask an admin to create it first.' },
        { status: 403 },
      );
    }

    /** `calendar_id` references `unified_calendars.id` — validate venue ownership (works for USE primaries and mixed venues with team columns). */
    if (fieldsForResolve.calendar_id !== undefined && fieldsForResolve.calendar_id !== null) {
      const cid = fieldsForResolve.calendar_id;
      const { data: ucRow } = await admin
        .from('unified_calendars')
        .select('id')
        .eq('venue_id', staff.venue_id)
        .eq('id', cid)
        .maybeSingle();
      if (!ucRow) {
        return NextResponse.json(
          { error: 'That staff calendar column was not found for this venue. Add it under Calendar availability first.' },
          { status: 400 },
        );
      }
    }

    const paymentPatch: Record<string, unknown> = {};
    if (patchPayReq !== undefined) {
      paymentPatch.payment_requirement = patchPayReq;
      paymentPatch.deposit_amount_pence = patchPayReq === 'deposit' ? (patchDepositPence ?? null) : null;
    }

    let patchInput = { ...fieldsForResolve, ...paymentPatch };
    if (newCalendarName) {
      const created = await createTeamCalendarForEvent(admin, staff.venue_id, newCalendarName);
      if (!created.ok) {
        return NextResponse.json({ error: created.error }, { status: created.status });
      }
      patchInput = { ...fieldsForResolve, ...paymentPatch, calendar_id: created.id };
    }

    const resolved = await resolveExperienceEventPatch(admin, staff.venue_id, id, patchInput);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.error === 'Event not found' ? 404 : 400 });
    }

    if (Object.prototype.hasOwnProperty.call(resolved.payload, 'calendar_id') && resolved.payload.calendar_id === null) {
      const clear = await assertExperienceEventCalendarClearable(admin, staff.venue_id, id);
      if (!clear.ok) {
        return NextResponse.json({ error: clear.error }, { status: 409 });
      }
    }

    const { data: existingRow } = await admin
      .from('experience_events')
      .select('event_date, start_time, end_time, calendar_id')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (!existingRow) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const ex = existingRow as {
      event_date: string;
      start_time: string;
      end_time: string;
      calendar_id: string | null;
    };
    const mergedDate = (resolved.payload.event_date as string | undefined) ?? ex.event_date;
    const mergedStart = (resolved.payload.start_time as string | undefined) ?? ex.start_time;
    const mergedEnd = (resolved.payload.end_time as string | undefined) ?? ex.end_time;
    const mergedCalendarId =
      resolved.payload.calendar_id !== undefined
        ? (resolved.payload.calendar_id as string | null)
        : ex.calendar_id;

    if (staff.role !== 'admin') {
      const scope = await requireManagedCalendarIds(admin, staff.venue_id, staff);
      if (!scope.ok) {
        return NextResponse.json({ error: scope.error }, { status: 403 });
      }
      const managedCalendarIds = scope.managedCalendarIds;
      if (!ex.calendar_id) {
        return NextResponse.json(
          {
            error:
              'Only venue admins can edit events that are not assigned to a calendar. Ask an admin to assign this event to a calendar first.',
          },
          { status: 403 },
        );
      }
      if (!managedCalendarIds.includes(ex.calendar_id)) {
        return NextResponse.json(
          { error: 'You can only update events on calendars assigned to your account.' },
          { status: 403 },
        );
      }
      if (mergedCalendarId && !managedCalendarIds.includes(mergedCalendarId)) {
        return NextResponse.json(
          { error: 'You can only assign events to calendars assigned to your account.' },
          { status: 403 },
        );
      }
    }

    if (mergedCalendarId) {
      const [{ data: venueRowPatch }, { data: patchBlockRows, error: patchBlocksErr }, { data: ucPatch, error: ucPatchErr }] =
        await Promise.all([
          admin.from('venues').select('opening_hours, venue_opening_exceptions').eq('id', staff.venue_id).single(),
          venueWideBlocksQueryForDate(admin, staff.venue_id, mergedDate),
          admin
            .from('unified_calendars')
            .select('*')
            .eq('id', mergedCalendarId)
            .eq('venue_id', staff.venue_id)
            .maybeSingle(),
        ]);
      if (patchBlocksErr) {
        console.warn('PATCH /api/venue/experience-events availability_blocks:', patchBlocksErr.message);
      }
      if (ucPatchErr || !ucPatch) {
        return NextResponse.json({ error: 'Calendar column not found for this venue.' }, { status: 400 });
      }
      const hoursErrPatch = validateExperienceEventWindowAgainstVenueAndCalendar(
        mergedDate,
        timeHhMm(mergedStart),
        timeHhMm(mergedEnd),
        {
          opening_hours: (venueRowPatch?.opening_hours as OpeningHours | null) ?? null,
          venue_opening_exceptions: parseVenueOpeningExceptions(venueRowPatch?.venue_opening_exceptions),
          availability_blocks: rowsToVenueWideBlocks(patchBlockRows),
        },
        ucPatch as Record<string, unknown>,
      );
      if (hoursErrPatch) {
        return NextResponse.json({ error: hoursErrPatch }, { status: 400 });
      }

      const conflict = await assertExperienceEventWindowFreeOnCalendar(
        admin,
        staff.venue_id,
        mergedCalendarId,
        mergedDate,
        timeHhMm(mergedStart),
        timeHhMm(mergedEnd),
        { excludeExperienceEventId: id },
      );
      if (conflict) {
        return NextResponse.json({ error: conflict }, { status: 409 });
      }
    }

    if (Object.keys(resolved.payload).length > 0) {
      const { error } = await admin
        .from('experience_events')
        .update(resolved.payload)
        .eq('id', id)
        .eq('venue_id', staff.venue_id);

      if (error) {
        console.error('PATCH /api/venue/experience-events failed:', error);
        return NextResponse.json({ error: 'Failed to update event' }, { status: 500 });
      }
    }

    // Replace ticket types if provided
    if (Array.isArray(ticket_types)) {
      await admin.from('event_ticket_types').delete().eq('event_id', id);
      if (ticket_types.length > 0) {
        const ttRows = ticket_types.map((tt: { name: string; price_pence: number; capacity?: number; sort_order?: number }, i: number) => ({
          event_id: id,
          name: tt.name,
          price_pence: tt.price_pence,
          capacity: tt.capacity ?? null,
          sort_order: tt.sort_order ?? i,
        }));
        await admin.from('event_ticket_types').insert(ttRows);
      }
    }

    const { data: full } = await admin
      .from('experience_events')
      .select('*, ticket_types:event_ticket_types(*)')
      .eq('id', id)
      .single();

    return NextResponse.json(full);
  } catch (err) {
    console.error('PATCH /api/venue/experience-events failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE /api/venue/experience-events - delete an event (admin, or staff if event is on a calendar they manage). */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const admin = getSupabaseAdminClient();
    const modelGate = await requireVenueExposesSecondaryModel(admin, staff.venue_id, 'event_ticket');
    if (!modelGate.ok) return modelGate.response;

    const { data: eventRow, error: evErr } = await admin
      .from('experience_events')
      .select('id, calendar_id')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (evErr) {
      console.error('DELETE /api/venue/experience-events lookup:', evErr);
      return NextResponse.json(
        { error: 'Could not verify the event. Please try again.' },
        { status: 500 },
      );
    }
    if (!eventRow) {
      return NextResponse.json(
        { error: buildEntityNotFoundMessage('event') },
        { status: 404 },
      );
    }

    if (staff.role !== 'admin') {
      const calId = (eventRow as { calendar_id: string | null }).calendar_id;
      if (!calId) {
        return NextResponse.json(
          {
            error:
              'Only venue admins can delete events that are not assigned to a calendar. Ask an admin to assign this event to a calendar first, or ask an admin to delete it.',
          },
          { status: 403 },
        );
      }
      const access = await requireManagedCalendarAccess(
        admin,
        staff.venue_id,
        staff,
        calId,
        'You can only delete events on calendars assigned to your account.',
      );
      if (!access.ok) {
        return NextResponse.json({ error: access.error }, { status: 403 });
      }
    }

    const canDelete = await assertExperienceEventDeletable(admin, staff.venue_id, id);
    if (!canDelete.ok) {
      return NextResponse.json(
        { error: canDelete.error, booking_count: canDelete.booking_count },
        { status: 409 },
      );
    }

    const { error } = await admin
      .from('experience_events')
      .delete()
      .eq('id', id)
      .eq('venue_id', staff.venue_id);

    if (error) {
      console.error('DELETE /api/venue/experience-events failed:', error);
      return NextResponse.json(
        { error: 'Failed to delete the event. Please try again.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/venue/experience-events failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
