import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireVenueExposesSecondaryModel } from '@/lib/booking/require-venue-secondary-model';
import {
  assertExperienceEventCalendarClearable,
  assertExperienceEventDeletable,
  resolveExperienceEventPatch,
} from '@/lib/experience-events/experience-event-guards';
import { validateEventCalendarPlacement } from '@/lib/experience-events/validate-event-calendar-placement';
import { syncEventTicketTypes } from '@/lib/experience-events/sync-event-ticket-types';
import { buildEntityNotFoundMessage } from '@/lib/venue/entity-delete-booking-guards';
import { z } from 'zod';
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
  calendar_id: z.union([z.string().uuid(), z.null()]).optional(),
  ticket_types: z
    .array(
      z.object({
        name: z.string().min(1),
        price_pence: z.number().int().min(0),
        capacity: z.number().int().min(1).optional(),
        sort_order: z.number().int().optional(),
      }),
    )
    .optional(),
});

/**
 * GET /api/venue/experience-events/[id] — single event with ticket types (any authenticated venue staff).
 *
 * PATCH and DELETE on this path are admin-only. Non-admin staff must use the collection routes instead:
 * - PATCH `/api/venue/experience-events` with `{ id, ... }` for updates when the event is on a managed calendar
 * - DELETE `/api/venue/experience-events` with `{ id }` for deletes under the same rules
 *
 * Calling PATCH/DELETE here as non-admin returns 403 by design. Shared guards live in
 * `lib/experience-events/experience-event-guards.ts`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const { id } = await params;
    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from('experience_events')
      .select('*, ticket_types:event_ticket_types(*)')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (error) {
      console.error('GET /api/venue/experience-events/[id] failed:', error);
      return NextResponse.json({ error: 'Failed to fetch event' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error('GET /api/venue/experience-events/[id] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

    const admin = getSupabaseAdminClient();
    const modelGate = await requireVenueExposesSecondaryModel(admin, staff.venue_id, 'event_ticket');
    if (!modelGate.ok) return modelGate.response;

    const { id } = await params;
    const body = await request.json();
    const { ticket_types, ...rest } = body as { ticket_types?: unknown; [k: string]: unknown };

    const parsed = eventSchema.partial().safeParse(rest);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const resolved = await resolveExperienceEventPatch(admin, staff.venue_id, id, parsed.data);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.error === 'Event not found' ? 404 : 400 });
    }

    if (Object.prototype.hasOwnProperty.call(resolved.payload, 'calendar_id') && resolved.payload.calendar_id === null) {
      const clear = await assertExperienceEventCalendarClearable(admin, staff.venue_id, id);
      if (!clear.ok) {
        return NextResponse.json({ error: clear.error }, { status: 409 });
      }
    }

    // Re-validate the (possibly edited) window against venue/calendar hours and existing events.
    // Previously this admin-only path SKIPPED this check, so an overlapping/closed-hours event could
    // be placed here while the collection PATCH rejected it (CDE review §5.3). Both now share one helper.
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

    if (mergedCalendarId) {
      const placement = await validateEventCalendarPlacement(admin, {
        venueId: staff.venue_id,
        calendarId: mergedCalendarId,
        eventDate: mergedDate,
        startTime: mergedStart,
        endTime: mergedEnd,
        excludeExperienceEventId: id,
      });
      if (!placement.ok) {
        return NextResponse.json({ error: placement.error }, { status: placement.status });
      }
    }

    if (Object.keys(resolved.payload).length > 0) {
      const { error } = await admin
        .from('experience_events')
        .update(resolved.payload)
        .eq('id', id)
        .eq('venue_id', staff.venue_id);

      if (error) {
        console.error('PATCH /api/venue/experience-events/[id] failed:', error);
        return NextResponse.json({ error: 'Failed to update event' }, { status: 500 });
      }
    }

    // Upsert ticket types by id (never delete tiers that have sales) — CDE review C3.
    if (Array.isArray(ticket_types)) {
      const sync = await syncEventTicketTypes(admin, id, ticket_types);
      if (!sync.ok) {
        return NextResponse.json({ error: sync.error ?? 'Failed to update ticket types' }, { status: 500 });
      }
    }

    const { data: full } = await admin
      .from('experience_events')
      .select('*, ticket_types:event_ticket_types(*)')
      .eq('id', id)
      .single();

    return NextResponse.json(full);
  } catch (err) {
    console.error('PATCH /api/venue/experience-events/[id] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

    const admin = getSupabaseAdminClient();
    const modelGate = await requireVenueExposesSecondaryModel(admin, staff.venue_id, 'event_ticket');
    if (!modelGate.ok) return modelGate.response;

    const { id } = await params;

    const { data: existing, error: lookupErr } = await admin
      .from('experience_events')
      .select('id')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();
    if (lookupErr) {
      console.error('DELETE /api/venue/experience-events/[id] lookup:', lookupErr);
      return NextResponse.json(
        { error: 'Could not verify the event. Please try again.' },
        { status: 500 },
      );
    }
    if (!existing) {
      return NextResponse.json(
        { error: buildEntityNotFoundMessage('event') },
        { status: 404 },
      );
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
      console.error('DELETE /api/venue/experience-events/[id] failed:', error);
      return NextResponse.json(
        { error: 'Failed to delete the event. Please try again.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/venue/experience-events/[id] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
