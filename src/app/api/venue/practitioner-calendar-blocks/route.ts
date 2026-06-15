import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, OUTSIDE_ASSIGNED_CALENDARS_ERROR, staffManagesCalendar } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { findClosureBookingConflicts, describeClosureBookingConflict } from '@/lib/calendar/closure-booking-conflicts';
import { z } from 'zod';

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const hm = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** `practitioner_id` is the staff-column id from the calendar UI: legacy `practitioners.id` or `unified_calendars.id`. */
const createSchema = z.object({
  practitioner_id: z.string().uuid(),
  block_date: z.string().regex(isoDate),
  start_time: z.string().regex(hm),
  end_time: z.string().regex(hm),
  reason: z.string().max(200).optional(),
});

function toPgTime(s: string): string {
  return s.length === 5 ? `${s}:00` : s;
}

/** Merged shape for GET: legacy practitioner blocks + unified `calendar_blocks`. */
type MergedBlockRow = {
  id: string;
  practitioner_id: string | null;
  calendar_id: string | null;
  block_date: string;
  start_time: string;
  end_time: string;
  reason: string | null;
  block_type: string;
  source: string;
  class_instance_id: string | null;
  created_at: unknown;
};

/** GET - list blocks for date=YYYY-MM-DD or from & to (inclusive). */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const date = request.nextUrl.searchParams.get('date');
    const from = request.nextUrl.searchParams.get('from');
    const to = request.nextUrl.searchParams.get('to');

    let q = staff.db
      .from('practitioner_calendar_blocks')
      .select('id, practitioner_id, block_date, start_time, end_time, reason, created_at')
      .eq('venue_id', staff.venue_id)
      .order('block_date', { ascending: true })
      .order('start_time', { ascending: true });

    if (date && isoDate.test(date)) {
      q = q.eq('block_date', date);
    } else if (from && to && isoDate.test(from) && isoDate.test(to)) {
      q = q.gte('block_date', from).lte('block_date', to);
    } else {
      return NextResponse.json({ error: 'Provide date=YYYY-MM-DD or from=&to=' }, { status: 400 });
    }

    const { data, error } = await q;
    if (error) {
      console.error('GET practitioner-calendar-blocks:', error);
      return NextResponse.json({ error: 'Failed to load blocks' }, { status: 500 });
    }

    const legacyBlocks: MergedBlockRow[] = (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      practitioner_id: row.practitioner_id as string,
      calendar_id: null,
      block_date: row.block_date as string,
      start_time: String(row.start_time).slice(0, 5),
      end_time: String(row.end_time).slice(0, 5),
      reason: (row.reason as string | null) ?? null,
      block_type: 'manual',
      source: 'practitioner_table',
      class_instance_id: null,
      created_at: row.created_at,
    }));

    /** Unified calendars: manual + class teaching blocks (`calendar_blocks`). */
    const unifiedBlocks: MergedBlockRow[] = [];
    let uq = staff.db
      .from('calendar_blocks')
      .select('id, calendar_id, block_date, start_time, end_time, reason, block_type, class_instance_id')
      .eq('venue_id', staff.venue_id)
      .order('block_date', { ascending: true })
      .order('start_time', { ascending: true });
    if (date && isoDate.test(date)) {
      uq = uq.eq('block_date', date);
    } else if (from && to && isoDate.test(from) && isoDate.test(to)) {
      uq = uq.gte('block_date', from).lte('block_date', to);
    }
    const { data: ucRows, error: ucErr } = await uq;

    if (!ucErr) {
      for (const row of ucRows ?? []) {
        const r = row as Record<string, unknown>;
        unifiedBlocks.push({
          id: r.id as string,
          practitioner_id: null,
          calendar_id: r.calendar_id as string,
          block_date: r.block_date as string,
          start_time: String(r.start_time).slice(0, 5),
          end_time: String(r.end_time).slice(0, 5),
          reason: (r.reason as string | null) ?? null,
          block_type: String(r.block_type ?? 'manual'),
          source: 'calendar_blocks',
          class_instance_id: (r.class_instance_id as string | null) ?? null,
          created_at: null,
        });
      }
    } else {
      console.error('GET practitioner-calendar-blocks (calendar_blocks):', ucErr);
    }

    return NextResponse.json({ blocks: [...legacyBlocks, ...unifiedBlocks] });
  } catch (err) {
    console.error('GET practitioner-calendar-blocks failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST - create a block. */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const { practitioner_id: columnId, block_date, start_time, end_time, reason } = parsed.data;

    if (end_time <= start_time) {
      return NextResponse.json({ error: 'End time must be after start time' }, { status: 400 });
    }

    // A blocked-time window cannot be inserted over existing bookings on the column.
    try {
      const conflict = await findClosureBookingConflicts(getSupabaseAdminClient(), {
        venueId: staff.venue_id,
        calendarColumnIds: [columnId],
        startDate: block_date,
        endDate: block_date,
        startTime: start_time,
        endTime: end_time,
      });
      if (conflict) {
        return NextResponse.json(
          { error: describeClosureBookingConflict(conflict, { scope: 'time' }) },
          { status: 409 },
        );
      }
    } catch (e) {
      console.error('POST practitioner-calendar-blocks conflict check:', e);
      return NextResponse.json(
        { error: 'Could not verify existing bookings for this time. Please try again.' },
        { status: 500 },
      );
    }

    const { data: prac } = await staff.db
      .from('practitioners')
      .select('id')
      .eq('id', columnId)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (prac?.id) {
      const { data: inserted, error: insErr } = await staff.db
        .from('practitioner_calendar_blocks')
        .insert({
          venue_id: staff.venue_id,
          practitioner_id: columnId,
          block_date,
          start_time: toPgTime(start_time),
          end_time: toPgTime(end_time),
          reason: reason?.trim() || null,
          created_by: staff.id,
        })
        .select('id, practitioner_id, block_date, start_time, end_time, reason, created_at')
        .single();

      if (insErr || !inserted) {
        console.error('POST practitioner-calendar-blocks:', insErr);
        return NextResponse.json({ error: 'Failed to create block' }, { status: 500 });
      }

      return NextResponse.json({
        block: {
          ...inserted,
          start_time: String(inserted.start_time).slice(0, 5),
          end_time: String(inserted.end_time).slice(0, 5),
        },
      });
    }

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

    const { data: inserted, error: insErr } = await staff.db
      .from('calendar_blocks')
      .insert({
        venue_id: staff.venue_id,
        calendar_id: columnId,
        block_date,
        start_time: toPgTime(start_time),
        end_time: toPgTime(end_time),
        reason: reason?.trim() || null,
        block_type: 'manual',
        created_by: staff.id,
      })
      .select('id, calendar_id, block_date, start_time, end_time, reason, created_at')
      .single();

    if (insErr || !inserted) {
      console.error('POST practitioner-calendar-blocks (calendar_blocks):', insErr);
      return NextResponse.json({ error: 'Failed to create block' }, { status: 500 });
    }

    return NextResponse.json({
      block: {
        id: inserted.id,
        practitioner_id: null,
        calendar_id: inserted.calendar_id,
        block_date: inserted.block_date,
        start_time: String(inserted.start_time).slice(0, 5),
        end_time: String(inserted.end_time).slice(0, 5),
        reason: inserted.reason,
        created_at: inserted.created_at,
      },
    });
  } catch (err) {
    console.error('POST practitioner-calendar-blocks failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
