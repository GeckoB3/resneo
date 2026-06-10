import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, OUTSIDE_ASSIGNED_CALENDARS_ERROR, staffManagesCalendar } from '@/lib/venue-auth';
import { z } from 'zod';

const patchBodySchema = z.object({
  start_time: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/).optional(),
  end_time: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/).optional(),
  block_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Staff column id: legacy `practitioners.id` or `unified_calendars.id`. */
  practitioner_id: z.string().uuid().optional(),
  reason: z.string().max(500).nullable().optional(),
});

function normalizeTimeForDb(t: string): string {
  return t.length === 5 ? `${t}:00` : t;
}

function timeToMinutes(t: string): number {
  const part = t.slice(0, 8);
  const [hh, mm] = part.split(':').map(Number);
  return (hh ?? 0) * 60 + (mm ?? 0);
}

/** PATCH - update block end time and/or reason. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { id } = await params;
    const parsed = patchBodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const { data: existingPrac, error: fetchPracErr } = await staff.db
      .from('practitioner_calendar_blocks')
      .select('id, venue_id, start_time, end_time, reason, practitioner_id, block_date')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (fetchPracErr) {
      console.error('PATCH practitioner-calendar-blocks (practitioner lookup):', fetchPracErr);
      return NextResponse.json({ error: 'Failed to load block' }, { status: 500 });
    }

    const { data: existingCal, error: fetchCalErr } = existingPrac
      ? { data: null as null, error: null as null }
      : await staff.db
          .from('calendar_blocks')
          .select('id, venue_id, start_time, end_time, reason, block_date, calendar_id, class_instance_id')
          .eq('id', id)
          .eq('venue_id', staff.venue_id)
          .maybeSingle();

    if (!existingPrac && fetchCalErr) {
      console.error('PATCH practitioner-calendar-blocks (calendar_blocks lookup):', fetchCalErr);
      return NextResponse.json({ error: 'Failed to load block' }, { status: 500 });
    }

    const existing = existingPrac ?? existingCal;
    if (!existing) {
      return NextResponse.json({ error: 'Block not found' }, { status: 404 });
    }

    if (existingCal && existingCal.class_instance_id) {
      return NextResponse.json(
        { error: 'This block is tied to a class and cannot be edited here.' },
        { status: 400 },
      );
    }

    if (staff.role === 'staff' && existingCal?.calendar_id) {
      const allowed = await staffManagesCalendar(staff.db, staff.venue_id, staff.id, existingCal.calendar_id);
      if (!allowed) {
        return NextResponse.json({ error: OUTSIDE_ASSIGNED_CALENDARS_ERROR }, { status: 403 });
      }
    }

    const updates: Record<string, unknown> = {};
    const startRaw = typeof existing.start_time === 'string' ? existing.start_time : String(existing.start_time);
    const endRaw = typeof existing.end_time === 'string' ? existing.end_time : String(existing.end_time);
    const dateRaw =
      typeof existing.block_date === 'string' ? existing.block_date : String(existing.block_date);

    const nextStartNorm =
      parsed.data.start_time !== undefined
        ? normalizeTimeForDb(parsed.data.start_time)
        : startRaw.length === 5
          ? `${startRaw}:00`
          : startRaw;
    const nextEndNorm =
      parsed.data.end_time !== undefined
        ? normalizeTimeForDb(parsed.data.end_time)
        : endRaw.length === 5
          ? `${endRaw}:00`
          : endRaw;
    const nextDate = parsed.data.block_date ?? dateRaw;

    if (timeToMinutes(nextEndNorm) <= timeToMinutes(nextStartNorm)) {
      return NextResponse.json({ error: 'End time must be after start time' }, { status: 400 });
    }

    if (parsed.data.start_time !== undefined) {
      updates.start_time = nextStartNorm;
    }
    if (parsed.data.end_time !== undefined) {
      updates.end_time = nextEndNorm;
    }
    if (parsed.data.block_date !== undefined) {
      updates.block_date = nextDate;
    }

    if (parsed.data.practitioner_id !== undefined) {
      const columnId = parsed.data.practitioner_id;
      if (existingPrac) {
        const { data: prac } = await staff.db
          .from('practitioners')
          .select('id')
          .eq('id', columnId)
          .eq('venue_id', staff.venue_id)
          .maybeSingle();
        if (!prac?.id) {
          return NextResponse.json({ error: 'Calendar or practitioner not found' }, { status: 400 });
        }
        updates.practitioner_id = columnId;
      } else if (existingCal) {
        const { data: calendar } = await staff.db
          .from('unified_calendars')
          .select('id')
          .eq('id', columnId)
          .eq('venue_id', staff.venue_id)
          .maybeSingle();
        if (!calendar?.id) {
          return NextResponse.json({ error: 'Calendar or practitioner not found' }, { status: 400 });
        }
        if (staff.role === 'staff') {
          const allowed = await staffManagesCalendar(staff.db, staff.venue_id, staff.id, columnId);
          if (!allowed) {
            return NextResponse.json({ error: OUTSIDE_ASSIGNED_CALENDARS_ERROR }, { status: 403 });
          }
        }
        updates.calendar_id = columnId;
      }
    }

    if (parsed.data.reason !== undefined) {
      updates.reason = parsed.data.reason === '' ? null : parsed.data.reason;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const table = existingPrac ? 'practitioner_calendar_blocks' : 'calendar_blocks';
    const { data: updated, error } = await staff.db.from(table).update(updates).eq('id', id).eq('venue_id', staff.venue_id).select().single();

    if (error) {
      console.error('PATCH practitioner-calendar-blocks:', error);
      return NextResponse.json({ error: 'Failed to update block' }, { status: 500 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error('PATCH practitioner-calendar-blocks failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE - remove a block. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { id } = await params;

    const { data: pracRow } = await staff.db
      .from('practitioner_calendar_blocks')
      .select('id')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (pracRow) {
      const { error } = await staff.db.from('practitioner_calendar_blocks').delete().eq('id', id).eq('venue_id', staff.venue_id);
      if (error) {
        console.error('DELETE practitioner-calendar-blocks:', error);
        return NextResponse.json({ error: 'Failed to delete block' }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    const { data: calRow } = await staff.db
      .from('calendar_blocks')
      .select('id, calendar_id, class_instance_id')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (!calRow) {
      return NextResponse.json({ error: 'Block not found' }, { status: 404 });
    }

    if (calRow.class_instance_id) {
      return NextResponse.json(
        { error: 'This block is tied to a class and cannot be removed here.' },
        { status: 400 },
      );
    }

    if (staff.role === 'staff') {
      const allowed = await staffManagesCalendar(staff.db, staff.venue_id, staff.id, calRow.calendar_id);
      if (!allowed) {
        return NextResponse.json({ error: OUTSIDE_ASSIGNED_CALENDARS_ERROR }, { status: 403 });
      }
    }

    const { error } = await staff.db.from('calendar_blocks').delete().eq('id', id).eq('venue_id', staff.venue_id);
    if (error) {
      console.error('DELETE practitioner-calendar-blocks (calendar_blocks):', error);
      return NextResponse.json({ error: 'Failed to delete block' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE practitioner-calendar-blocks failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
