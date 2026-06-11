import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { matchesTimetableIntervalWeeks } from '@/lib/scheduling/class-timetable-interval';
import { syncCalendarBlockForClassInstance } from '@/lib/class-instances/instructor-calendar-block';

/**
 * POST /api/venue/classes/generate-instances
 * Generates class instances from the timetable for the next N weeks.
 * Skips dates where an instance already exists.
 * Respects recurrence_end_date and total_occurrences per timetable rule.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

    const body = await request.json();
    const weeks = Math.min(Math.max(body.weeks ?? 8, 1), 26);

    const admin = getSupabaseAdminClient();

    const { data: classTypes } = await admin
      .from('class_types')
      .select('id')
      .eq('venue_id', staff.venue_id)
      .eq('is_active', true);

    if (!classTypes || classTypes.length === 0) {
      return NextResponse.json({ created: 0 });
    }

    const typeIds = classTypes.map((ct) => ct.id);

    const { data: timetable } = await admin
      .from('class_timetable')
      .select('*')
      .in('class_type_id', typeIds)
      .eq('is_active', true);

    if (!timetable || timetable.length === 0) {
      return NextResponse.json({ created: 0 });
    }

    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + weeks * 7);

    const todayStr = today.toISOString().slice(0, 10);
    const endStr = endDate.toISOString().slice(0, 10);

    const { data: existing } = await admin
      .from('class_instances')
      .select('class_type_id, instance_date, start_time, timetable_entry_id')
      .in('class_type_id', typeIds)
      .gte('instance_date', todayStr)
      .lte('instance_date', endStr);

    const existingSet = new Set(
      (existing ?? []).map((e) => `${e.class_type_id}|${e.instance_date}|${e.start_time}`),
    );

    const timetableIds = timetable.map((t) => t.id as string);
    const { data: countRows } =
      timetableIds.length > 0
        ? await admin.from('class_instances').select('timetable_entry_id').in('timetable_entry_id', timetableIds)
        : { data: [] };

    const occurrenceCountByEntry = new Map<string, number>();
    for (const row of countRows ?? []) {
      const te = (row as { timetable_entry_id: string | null }).timetable_entry_id;
      if (!te) continue;
      occurrenceCountByEntry.set(te, (occurrenceCountByEntry.get(te) ?? 0) + 1);
    }

    const pendingByEntry = new Map<string, number>();

    const toInsert: Array<{
      class_type_id: string;
      timetable_entry_id: string;
      instance_date: string;
      start_time: string;
    }> = [];

    for (let d = new Date(today); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      const dateStr = d.toISOString().slice(0, 10);

      for (const entry of timetable) {
        if (entry.day_of_week !== dow) continue;

        const recurrenceEnd = (entry as { recurrence_end_date?: string | null }).recurrence_end_date;
        if (recurrenceEnd && dateStr > recurrenceEnd) continue;

        const teId = entry.id as string;
        const maxOcc = (entry as { total_occurrences?: number | null }).total_occurrences;
        if (maxOcc != null && maxOcc > 0) {
          const current = occurrenceCountByEntry.get(teId) ?? 0;
          const pending = pendingByEntry.get(teId) ?? 0;
          if (current + pending >= maxOcc) continue;
        }

        const intervalWeeks = (entry as { interval_weeks?: number }).interval_weeks ?? 1;
        const createdAt = (entry as { created_at?: string }).created_at ?? `${dateStr}T00:00:00Z`;
        if (
          !matchesTimetableIntervalWeeks({
            intervalWeeks,
            timetableCreatedAt: createdAt,
            instanceDateStr: dateStr,
          })
        ) {
          continue;
        }
        const startTime = (entry.start_time as string).slice(0, 5);
        const key = `${entry.class_type_id}|${dateStr}|${startTime}`;
        if (existingSet.has(key)) continue;

        toInsert.push({
          class_type_id: entry.class_type_id,
          timetable_entry_id: entry.id,
          instance_date: dateStr,
          start_time: startTime + ':00',
        });
        existingSet.add(key);
        pendingByEntry.set(teId, (pendingByEntry.get(teId) ?? 0) + 1);
      }
    }

    let created = 0;
    if (toInsert.length > 0) {
      const { data: inserted, error: insertErr } = await admin.from('class_instances').insert(toInsert).select('id, class_type_id, instance_date, start_time');
      if (insertErr) {
        console.error('POST generate-instances: class_instances insert failed:', insertErr);
        return NextResponse.json({ error: 'Failed to generate instances' }, { status: 500 });
      }
      created = inserted?.length ?? 0;
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
    }

    return NextResponse.json({ created });
  } catch (err) {
    console.error('POST /api/venue/classes/generate-instances failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
