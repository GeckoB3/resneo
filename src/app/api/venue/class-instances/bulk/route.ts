import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireVenueExposesSecondaryModel } from '@/lib/booking/require-venue-secondary-model';
import { assertClassSessionWindowFreeOnCalendar } from '@/lib/experience-events/calendar-event-window-conflicts';
import { syncCalendarBlockForClassInstance } from '@/lib/class-instances/instructor-calendar-block';
import { staffMayManageClassTypeSessions } from '@/lib/class-instances/class-staff-scope';

function normalizeTimeForDb(t: string): string {
  const s = t.trim();
  if (s.length === 5) return `${s}:00`;
  if (s.length >= 8) return s.slice(0, 8);
  return `${s}:00`;
}

const bodySchema = z.object({
  class_type_id: z.string().uuid(),
  instances: z
    .array(
      z.object({
        instance_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        start_time: z.string().min(5).max(8),
        capacity_override: z.number().int().min(1).optional(),
      }),
    )
    .min(1)
    .max(100),
});

/**
 * POST /api/venue/class-instances/bulk - create many one-off instances (admin).
 * Skips rows that duplicate an existing (class_type_id, instance_date, start_time).
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const json = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const modelGate = await requireVenueExposesSecondaryModel(admin, staff.venue_id, 'class_session');
    if (!modelGate.ok) return modelGate.response;

    const { class_type_id, instances: rawInstances } = parsed.data;

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

    const normalized = rawInstances.map((row) => ({
      instance_date: row.instance_date,
      start_time: normalizeTimeForDb(row.start_time),
      capacity_override: row.capacity_override ?? null,
    }));

    const { data: existingRows } = await admin
      .from('class_instances')
      .select('instance_date, start_time')
      .eq('class_type_id', class_type_id);

    const existingSet = new Set(
      (existingRows ?? []).map((e) => {
        const st = String((e as { start_time: string }).start_time);
        const norm = st.length >= 8 ? st.slice(0, 8) : normalizeTimeForDb(st);
        return `${(e as { instance_date: string }).instance_date}|${norm}`;
      }),
    );

    const toInsert: Array<{
      class_type_id: string;
      timetable_entry_id: null;
      instance_date: string;
      start_time: string;
      capacity_override: number | null;
      is_cancelled: boolean;
      cancel_reason: null;
    }> = [];

    for (const row of normalized) {
      const key = `${row.instance_date}|${row.start_time}`;
      if (existingSet.has(key)) continue;
      existingSet.add(key);
      toInsert.push({
        class_type_id,
        timetable_entry_id: null,
        instance_date: row.instance_date,
        start_time: row.start_time,
        capacity_override: row.capacity_override,
        is_cancelled: false,
        cancel_reason: null,
      });
    }

    const skipped = normalized.length - toInsert.length;

    if (toInsert.length === 0) {
      return NextResponse.json({ created: 0, skipped });
    }

    const ctRow = ct as { instructor_id: string | null; duration_minutes: number };
    for (const row of toInsert) {
      const conflict = await assertClassSessionWindowFreeOnCalendar(admin, staff.venue_id, {
        instructorId: ctRow.instructor_id,
        durationMinutes: ctRow.duration_minutes,
        instanceDate: row.instance_date,
        startTime: row.start_time,
      });
      if (conflict) {
        return NextResponse.json({ error: conflict }, { status: 409 });
      }
    }

    const { data: inserted, error: insertErr } = await admin
      .from('class_instances')
      .insert(toInsert)
      .select('id, class_type_id, instance_date, start_time');

    if (insertErr) {
      console.error('POST class-instances/bulk insert failed:', insertErr);
      return NextResponse.json({ error: 'Failed to create instances' }, { status: 500 });
    }

    const venueId = staff.venue_id;
    await Promise.all(
      (inserted ?? []).map((row) =>
        syncCalendarBlockForClassInstance(admin, {
          venueId,
          classInstanceId: (row as { id: string }).id,
          instanceDate: String((row as { instance_date: string }).instance_date),
          startTime: String((row as { start_time: string }).start_time),
          classTypeId: (row as { class_type_id: string }).class_type_id,
          skipBlock: false,
          createdByStaffId: staff.id,
        }),
      ),
    );

    return NextResponse.json({ created: inserted?.length ?? 0, skipped });
  } catch (err) {
    console.error('POST /api/venue/class-instances/bulk failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
