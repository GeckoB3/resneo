import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import {
  getVenueStaff,
  requireAdmin,
  requireManagedCalendarAccess,
  requireManagedCalendarIds,
} from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { listActiveHostCalendarIds, requireVenueHostCalendarId } from '@/lib/venue-calendar-resolve';
import { findClosureBookingConflicts, describeClosureBookingConflict } from '@/lib/calendar/closure-booking-conflicts';
import { z } from 'zod';

const LEAVE_SELECT =
  'id, practitioner_id, start_date, end_date, leave_type, notes, created_at, unavailable_start_time, unavailable_end_time';

async function calendarNamesById(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
  calendarIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (calendarIds.length === 0) return map;

  const { data: ucRows, error: ucErr } = await admin
    .from('unified_calendars')
    .select('id, name')
    .eq('venue_id', venueId)
    .in('id', calendarIds);

  if (ucErr) {
    console.error('[practitioner-leave] unified_calendars name lookup failed:', ucErr.message);
  } else {
    for (const row of ucRows ?? []) {
      map.set((row as { id: string }).id, (row as { name: string }).name);
    }
  }

  const missing = calendarIds.filter((id) => !map.has(id));
  if (missing.length > 0) {
    const { data: prRows, error: prErr } = await admin
      .from('practitioners')
      .select('id, name')
      .eq('venue_id', venueId)
      .in('id', missing);
    if (prErr) {
      console.error('[practitioner-leave] practitioners name lookup failed:', prErr.message);
    } else {
      for (const row of prRows ?? []) {
        const r = row as { id: string; name: string };
        if (!map.has(r.id)) map.set(r.id, r.name);
      }
    }
  }

  return map;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^\d{2}:\d{2}$/);

const postSchema = z
  .object({
    practitioner_id: z.string().uuid().optional(),
    apply_to_all_active: z.boolean().optional(),
    start_date: isoDate,
    end_date: isoDate,
    leave_type: z.enum(['annual', 'sick', 'other']),
    notes: z.string().max(500).optional().nullable(),
    unavailable_start_time: z.union([hhmm, z.null()]).optional(),
    unavailable_end_time: z.union([hhmm, z.null()]).optional(),
  })
  .refine((d) => d.end_date >= d.start_date, { message: 'End date must be on or after start date' })
  .refine((d) => Boolean(d.practitioner_id) || d.apply_to_all_active === true, {
    message: 'Choose a calendar or select all calendars',
  });

const patchSchema = z.object({
  id: z.string().uuid(),
  start_date: isoDate.optional(),
  end_date: isoDate.optional(),
  leave_type: z.enum(['annual', 'sick', 'other']).optional(),
  notes: z.union([z.string().max(500), z.null()]).optional(),
  unavailable_start_time: z.union([hhmm, z.null()]).optional(),
  unavailable_end_time: z.union([hhmm, z.null()]).optional(),
});

/** Both null = full day; both HH:mm = partial; mismatched is invalid. */
function normalizeUnavailableTimePair(
  start: string | null | undefined,
  end: string | null | undefined,
): { ok: true; start: string | null; end: string | null } | { ok: false; error: string } {
  const s = start === undefined ? null : start;
  const e = end === undefined ? null : end;
  if (s === null && e === null) return { ok: true, start: null, end: null };
  if (s !== null && e !== null) {
    if (s >= e) return { ok: false, error: 'End time must be after start time' };
    return { ok: true, start: s, end: e };
  }
  return { ok: false, error: 'Provide both start and end times, or neither for a full day' };
}

/** GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&practitioner_id=optional */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const practitionerId = searchParams.get('practitioner_id') ?? undefined;
    if (!from || !to) {
      return NextResponse.json({ error: 'Missing from or to (YYYY-MM-DD)' }, { status: 400 });
    }
    if (from > to) {
      return NextResponse.json({ error: 'from must be on or before to' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();

    const filterPractitionerId: string | undefined = practitionerId ?? undefined;

    let query = admin
      .from('practitioner_leave_periods')
      .select(LEAVE_SELECT)
      .eq('venue_id', staff.venue_id)
      .lte('start_date', to)
      .gte('end_date', from)
      .order('start_date', { ascending: true });

    if (staff.role !== 'admin') {
      const scope = await requireManagedCalendarIds(admin, staff.venue_id, staff);
      if (!scope.ok) {
        return NextResponse.json({ periods: [] });
      }
      if (filterPractitionerId) {
        const access = await requireManagedCalendarAccess(
          admin,
          staff.venue_id,
          staff,
          filterPractitionerId,
          'You can only view unavailability for calendars assigned to your account.',
        );
        if (!access.ok) {
          return NextResponse.json({ error: access.error }, { status: 403 });
        }
      } else if (scope.managedCalendarIds.length > 0) {
        query = query.in('practitioner_id', scope.managedCalendarIds);
      } else {
        return NextResponse.json({ periods: [] });
      }
    } else if (filterPractitionerId) {
      const cal = await requireVenueHostCalendarId(admin, staff.venue_id, filterPractitionerId);
      if (!cal.ok) {
        return NextResponse.json({ error: 'Calendar not found' }, { status: 404 });
      }
    }

    if (filterPractitionerId) {
      query = query.eq('practitioner_id', filterPractitionerId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('GET /api/venue/practitioner-leave failed:', error);
      return NextResponse.json({ error: 'Failed to load unavailability' }, { status: 500 });
    }

    const calendarIds = [
      ...new Set((data ?? []).map((row) => (row as { practitioner_id: string }).practitioner_id)),
    ];
    const nameById = await calendarNamesById(admin, staff.venue_id, calendarIds);

    const periods = (data ?? []).map((row: Record<string, unknown>) => {
      const practitionerId = row.practitioner_id as string;
      const ust = row.unavailable_start_time;
      const uen = row.unavailable_end_time;
      const startT =
        typeof ust === 'string'
          ? ust.slice(0, 5)
          : ust instanceof Date
            ? ust.toISOString().slice(11, 16)
            : null;
      const endT =
        typeof uen === 'string'
          ? uen.slice(0, 5)
          : uen instanceof Date
            ? uen.toISOString().slice(11, 16)
            : null;
      return {
        id: row.id,
        practitioner_id: row.practitioner_id,
        practitioner_name: nameById.get(practitionerId) ?? 'Calendar',
        start_date: row.start_date,
        end_date: row.end_date,
        leave_type: row.leave_type,
        notes: row.notes,
        created_at: row.created_at,
        unavailable_start_time: startT,
        unavailable_end_time: endT,
      };
    });

    return NextResponse.json({ periods });
  } catch (err) {
    console.error('GET /api/venue/practitioner-leave failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const body = await request.json();
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const {
      practitioner_id,
      apply_to_all_active,
      start_date,
      end_date,
      leave_type,
      notes,
      unavailable_start_time: ustIn,
      unavailable_end_time: uenIn,
    } = parsed.data;

    const timeNorm = normalizeUnavailableTimePair(ustIn, uenIn);
    if (!timeNorm.ok) {
      return NextResponse.json({ error: timeNorm.error }, { status: 400 });
    }

    // Unavailability cannot be inserted over existing bookings on the affected calendar(s).
    // Full-day (no times) conflicts with any booking on a covered date; a partial window
    // conflicts only where it overlaps. Returns a 409 response to send, or null when clear.
    const closureScope: 'time' | 'day' = timeNorm.start ? 'time' : 'day';
    const bookingConflictResponse = async (columnIds: string[]): Promise<NextResponse | null> => {
      try {
        const conflict = await findClosureBookingConflicts(admin, {
          venueId: staff.venue_id,
          calendarColumnIds: columnIds,
          startDate: start_date,
          endDate: end_date,
          startTime: timeNorm.start,
          endTime: timeNorm.end,
        });
        if (!conflict) return null;
        const names = await calendarNamesById(admin, staff.venue_id, [conflict.calendarColumnId]);
        return NextResponse.json(
          {
            error: describeClosureBookingConflict(conflict, {
              scope: closureScope,
              calendarName: names.get(conflict.calendarColumnId) ?? null,
            }),
          },
          { status: 409 },
        );
      } catch (e) {
        console.error('POST /api/venue/practitioner-leave conflict check:', e);
        return NextResponse.json(
          { error: 'Could not verify existing bookings for this calendar. Please try again.' },
          { status: 500 },
        );
      }
    };

    if (staff.role !== 'admin') {
      const scope = await requireManagedCalendarIds(admin, staff.venue_id, staff);
      if (!scope.ok) {
        return NextResponse.json({ error: scope.error }, { status: 403 });
      }
      if (apply_to_all_active) {
        return NextResponse.json({ error: 'Only admins can add unavailability for all calendars' }, { status: 403 });
      }
      if (practitioner_id) {
        const cal = await requireVenueHostCalendarId(admin, staff.venue_id, practitioner_id);
        if (!cal.ok) {
          return NextResponse.json({ error: 'Calendar not found' }, { status: 404 });
        }
      }
      const access = await requireManagedCalendarAccess(
        admin,
        staff.venue_id,
        staff,
        practitioner_id,
        'You can only add unavailability for calendars assigned to your account.',
      );
      if (!access.ok) {
        return NextResponse.json({ error: access.error }, { status: 403 });
      }
      const staffConflictResp = await bookingConflictResponse(practitioner_id ? [practitioner_id] : []);
      if (staffConflictResp) return staffConflictResp;

      const rows = [
        {
          venue_id: staff.venue_id,
          practitioner_id,
          start_date,
          end_date,
          leave_type,
          notes: notes?.trim() ?? null,
          unavailable_start_time: timeNorm.start,
          unavailable_end_time: timeNorm.end,
        },
      ];
      const { data, error } = await admin.from('practitioner_leave_periods').insert(rows).select('id');
      if (error) {
        console.error('POST /api/venue/practitioner-leave (staff) failed:', error);
        return NextResponse.json({ error: 'Failed to save unavailability' }, { status: 500 });
      }
      return NextResponse.json(
        { created: data?.length ?? 0, ids: (data ?? []).map((r: { id: string }) => r.id) },
        { status: 201 },
      );
    }

    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

    let practitionerIds: string[] = [];
    if (apply_to_all_active) {
      practitionerIds = await listActiveHostCalendarIds(admin, staff.venue_id);
      if (practitionerIds.length === 0) {
        return NextResponse.json({ error: 'No active calendars to add unavailability for' }, { status: 400 });
      }
    } else if (practitioner_id) {
      const cal = await requireVenueHostCalendarId(admin, staff.venue_id, practitioner_id);
      if (!cal.ok) {
        return NextResponse.json({ error: 'Calendar not found' }, { status: 404 });
      }
      practitionerIds = [cal.id];
    }

    const adminConflictResp = await bookingConflictResponse(practitionerIds);
    if (adminConflictResp) return adminConflictResp;

    const rows = practitionerIds.map((pid) => ({
      venue_id: staff.venue_id,
      practitioner_id: pid,
      start_date,
      end_date,
      leave_type,
      notes: notes?.trim() || null,
      unavailable_start_time: timeNorm.start,
      unavailable_end_time: timeNorm.end,
    }));

    const { data, error } = await admin.from('practitioner_leave_periods').insert(rows).select('id');

    if (error) {
      console.error('POST /api/venue/practitioner-leave failed:', error);
      return NextResponse.json({ error: 'Failed to save unavailability' }, { status: 500 });
    }

    return NextResponse.json({ created: data?.length ?? 0, ids: (data ?? []).map((r: { id: string }) => r.id) }, { status: 201 });
  } catch (err) {
    console.error('POST /api/venue/practitioner-leave failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const body = await request.json() as Record<string, unknown>;
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const { id, ...patchRest } = parsed.data;
    const hasUst = 'unavailable_start_time' in body;
    const hasUen = 'unavailable_end_time' in body;
    if (hasUst !== hasUen) {
      return NextResponse.json(
        { error: 'Include both unavailable_start_time and unavailable_end_time when changing times' },
        { status: 400 },
      );
    }
    let mergedUpdates: Record<string, unknown> = { ...patchRest };
    if (hasUst && hasUen) {
      const tnorm = normalizeUnavailableTimePair(
        parsed.data.unavailable_start_time as string | null | undefined,
        parsed.data.unavailable_end_time as string | null | undefined,
      );
      if (!tnorm.ok) {
        return NextResponse.json({ error: tnorm.error }, { status: 400 });
      }
      mergedUpdates = {
        ...mergedUpdates,
        unavailable_start_time: tnorm.start,
        unavailable_end_time: tnorm.end,
      };
    }

    const updates = Object.fromEntries(
      Object.entries(mergedUpdates).filter(([, v]) => v !== undefined),
    ) as Record<string, unknown>;
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    if (
      typeof updates.start_date === 'string' &&
      typeof updates.end_date === 'string' &&
      updates.end_date < updates.start_date
    ) {
      return NextResponse.json({ error: 'End date must be on or after start date' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();

    if (staff.role !== 'admin') {
      const scope = await requireManagedCalendarIds(admin, staff.venue_id, staff);
      if (!scope.ok) {
        return NextResponse.json({ error: scope.error }, { status: 403 });
      }
      const { data: leaveRow, error: leaveErr } = await admin
        .from('practitioner_leave_periods')
        .select('id, practitioner_id, start_date, end_date')
        .eq('id', id)
        .eq('venue_id', staff.venue_id)
        .maybeSingle();
      if (leaveErr || !leaveRow) {
        return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
      }
      const access = await requireManagedCalendarAccess(
        admin,
        staff.venue_id,
        staff,
        leaveRow.practitioner_id,
        'You can only edit unavailability on calendars assigned to your account.',
      );
      if (!access.ok) {
        return NextResponse.json({ error: access.error }, { status: 403 });
      }
    } else if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const { data: existing, error: exErr } = await admin
      .from('practitioner_leave_periods')
      .select('id, practitioner_id, start_date, end_date, unavailable_start_time, unavailable_end_time')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (exErr || !existing) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }

    const nextStart = (updates.start_date as string | undefined) ?? (existing as { start_date: string }).start_date;
    const nextEnd = (updates.end_date as string | undefined) ?? (existing as { end_date: string }).end_date;
    if (nextEnd < nextStart) {
      return NextResponse.json({ error: 'End date must be on or after start date' }, { status: 400 });
    }

    // Editing the dates/times of an existing closure must not extend it over bookings.
    const datesOrTimesChanged =
      updates.start_date !== undefined ||
      updates.end_date !== undefined ||
      'unavailable_start_time' in updates;
    if (datesOrTimesChanged) {
      const toHHmm = (v: unknown): string | null =>
        typeof v === 'string' ? v.slice(0, 5) : v instanceof Date ? v.toISOString().slice(11, 16) : null;
      const nextStartTime =
        'unavailable_start_time' in updates
          ? (updates.unavailable_start_time as string | null)
          : toHHmm((existing as { unavailable_start_time?: unknown }).unavailable_start_time);
      const nextEndTime =
        'unavailable_end_time' in updates
          ? (updates.unavailable_end_time as string | null)
          : toHHmm((existing as { unavailable_end_time?: unknown }).unavailable_end_time);
      try {
        const conflict = await findClosureBookingConflicts(admin, {
          venueId: staff.venue_id,
          calendarColumnIds: [(existing as { practitioner_id: string }).practitioner_id],
          startDate: nextStart,
          endDate: nextEnd,
          startTime: nextStartTime,
          endTime: nextEndTime,
        });
        if (conflict) {
          const names = await calendarNamesById(admin, staff.venue_id, [conflict.calendarColumnId]);
          return NextResponse.json(
            {
              error: describeClosureBookingConflict(conflict, {
                scope: nextStartTime ? 'time' : 'day',
                calendarName: names.get(conflict.calendarColumnId) ?? null,
              }),
            },
            { status: 409 },
          );
        }
      } catch (e) {
        console.error('PATCH /api/venue/practitioner-leave conflict check:', e);
        return NextResponse.json(
          { error: 'Could not verify existing bookings for this calendar. Please try again.' },
          { status: 500 },
        );
      }
    }

    const { data, error } = await admin
      .from('practitioner_leave_periods')
      .update(updates)
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .select()
      .single();

    if (error) {
      console.error('PATCH /api/venue/practitioner-leave failed:', error);
      return NextResponse.json({ error: 'Failed to update unavailability' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error('PATCH /api/venue/practitioner-leave failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const body = await request.json();
    const id = body?.id as string | undefined;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const admin = getSupabaseAdminClient();

    if (staff.role !== 'admin') {
      const scope = await requireManagedCalendarIds(admin, staff.venue_id, staff);
      if (!scope.ok) {
        return NextResponse.json({ error: scope.error }, { status: 403 });
      }
      const { data: leaveRow, error: leaveErr } = await admin
        .from('practitioner_leave_periods')
        .select('id, practitioner_id')
        .eq('id', id)
        .eq('venue_id', staff.venue_id)
        .maybeSingle();
      if (leaveErr || !leaveRow) {
        return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
      }
      const access = await requireManagedCalendarAccess(
        admin,
        staff.venue_id,
        staff,
        leaveRow.practitioner_id,
        'You can only delete unavailability on calendars assigned to your account.',
      );
      if (!access.ok) {
        return NextResponse.json({ error: access.error }, { status: 403 });
      }
    } else if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const { error } = await admin
      .from('practitioner_leave_periods')
      .delete()
      .eq('id', id)
      .eq('venue_id', staff.venue_id);

    if (error) {
      console.error('DELETE /api/venue/practitioner-leave failed:', error);
      return NextResponse.json({ error: 'Failed to delete unavailability' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/venue/practitioner-leave failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
