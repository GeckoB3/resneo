import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireVenueExposesSecondaryModel } from '@/lib/booking/require-venue-secondary-model';
import { assertClassSessionWindowFreeOnCalendar } from '@/lib/experience-events/calendar-event-window-conflicts';
import { staffMayManageClassTypeSessions } from '@/lib/class-instances/class-staff-scope';
import { z } from 'zod';

const createBodySchema = z.object({
  class_type_id: z.string().uuid(),
  instance_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  capacity_override: z.number().int().min(1).optional(),
});

/**
 * POST /api/venue/class-instances - create a one-off class instance (no timetable entry).
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const modelGate = await requireVenueExposesSecondaryModel(admin, staff.venue_id, 'class_session');
    if (!modelGate.ok) return modelGate.response;

    const body = await request.json();
    const parsed = createBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const { class_type_id, instance_date, start_time, capacity_override } = parsed.data;

    const { data: ct, error: ctErr } = await admin
      .from('class_types')
      .select('id, instructor_id, duration_minutes')
      .eq('id', class_type_id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (ctErr || !ct) {
      return NextResponse.json({ error: 'Class type not found' }, { status: 404 });
    }

    const scope = await staffMayManageClassTypeSessions(admin, staff.venue_id, staff, class_type_id);
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }

    const startNorm = start_time.length === 5 ? `${start_time}:00` : start_time;

    const conflict = await assertClassSessionWindowFreeOnCalendar(admin, staff.venue_id, {
      instructorId: (ct as { instructor_id: string | null }).instructor_id,
      durationMinutes: (ct as { duration_minutes: number }).duration_minutes,
      instanceDate: instance_date,
      startTime: startNorm,
    });
    if (conflict) {
      return NextResponse.json({ error: conflict }, { status: 409 });
    }

    const { data: row, error } = await admin
      .from('class_instances')
      .insert({
        class_type_id,
        timetable_entry_id: null,
        instance_date,
        start_time: startNorm,
        capacity_override: capacity_override ?? null,
        is_cancelled: false,
        cancel_reason: null,
      })
      .select()
      .single();

    if (error) {
      // Unique index (class_type_id, instance_date, start_time): a session already
      // exists at this slot — surface as a friendly conflict, not a 500.
      if ((error as { code?: string }).code === '23505') {
        return NextResponse.json(
          { error: 'A session already exists at this date and time.' },
          { status: 409 },
        );
      }
      console.error('POST /api/venue/class-instances failed:', error);
      return NextResponse.json({ error: 'Failed to create class instance' }, { status: 500 });
    }

    // No calendar-block sync needed on create: class sessions render from the schedule feed
    // (not `calendar_blocks`), and a brand-new instance has no block to clear.

    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    console.error('POST /api/venue/class-instances failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
