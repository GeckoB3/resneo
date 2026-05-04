import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff, requireManagedCalendarAccess } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireVenueExposesSecondaryModel } from '@/lib/booking/require-venue-secondary-model';
import { assertClassSessionWindowFreeOnCalendar } from '@/lib/experience-events/calendar-event-window-conflicts';
import {
  resolveInstructorCalendarIdForClass,
  syncCalendarBlockForClassInstance,
} from '@/lib/class-instances/instructor-calendar-block';
import { staffMayManageClassTypeSessions } from '@/lib/class-instances/class-staff-scope';
import { DEFAULT_ENTITY_BOOKING_WINDOW } from '@/lib/booking/entity-booking-window';
import {
  hasActiveBookingsForClassInstance,
  hasUpcomingActiveBookingsForClassTimetableEntry,
  hasUpcomingActiveBookingsForClassType,
  UPCOMING_ACTIVE_BOOKINGS_BLOCK_DELETE,
} from '@/lib/venue/entity-delete-booking-guards';
import { z } from 'zod';

const classPaymentRequirementSchema = z.enum(['none', 'deposit', 'full_payment']);

const classTypeSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional().nullable(),
    duration_minutes: z.number().int().min(5).max(480),
    capacity: z.number().int().min(1),
    /** Unified calendar or legacy practitioner — required so sessions can be placed on a team column. */
    instructor_id: z.string().uuid(),
    /** Optional guest-facing label; when empty, the calendar/practitioner name is shown. */
    instructor_name: z.string().max(200).optional().nullable(),
    price_pence: z.number().int().min(0).optional().nullable(),
    payment_requirement: classPaymentRequirementSchema.optional(),
    deposit_amount_pence: z.number().int().min(0).optional().nullable(),
    colour: z.string().max(20).optional(),
    is_active: z.boolean().optional(),
    max_advance_booking_days: z.number().int().min(1).max(365).optional(),
    min_booking_notice_hours: z.number().int().min(0).max(168).optional(),
    cancellation_notice_hours: z.number().int().min(0).max(168).optional(),
    allow_same_day_booking: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const price = data.price_pence ?? 0;
    const req = data.payment_requirement ?? 'none';
    if (price <= 0 && (req === 'deposit' || req === 'full_payment')) {
      ctx.addIssue({
        code: 'custom',
        message: 'Set a price per person before choosing deposit or full payment',
        path: ['payment_requirement'],
      });
    }
    if (req === 'deposit') {
      const d = data.deposit_amount_pence;
      if (d == null || d <= 0) {
        ctx.addIssue({ code: 'custom', message: 'Deposit amount is required', path: ['deposit_amount_pence'] });
      } else if (price > 0 && d > price) {
        ctx.addIssue({
          code: 'custom',
          message: 'Deposit cannot exceed price per person',
          path: ['deposit_amount_pence'],
        });
      }
    }
  });

/**
 * Full class type row when `instructor_id` may be null (unassigned from any team calendar).
 * Used after PATCH merge only — POST still uses {@link classTypeSchema}.
 */
const classTypeMergedSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional().nullable(),
    duration_minutes: z.number().int().min(5).max(480),
    capacity: z.number().int().min(1),
    instructor_id: z.string().uuid().nullable(),
    instructor_name: z.string().max(200).optional().nullable(),
    price_pence: z.number().int().min(0).optional().nullable(),
    payment_requirement: classPaymentRequirementSchema.optional(),
    deposit_amount_pence: z.number().int().min(0).optional().nullable(),
    colour: z.string().max(20).optional(),
    is_active: z.boolean().optional(),
    max_advance_booking_days: z.number().int().min(1).max(365).optional(),
    min_booking_notice_hours: z.number().int().min(0).max(168).optional(),
    cancellation_notice_hours: z.number().int().min(0).max(168).optional(),
    allow_same_day_booking: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const price = data.price_pence ?? 0;
    const req = data.payment_requirement ?? 'none';
    if (price <= 0 && (req === 'deposit' || req === 'full_payment')) {
      ctx.addIssue({
        code: 'custom',
        message: 'Set a price per person before choosing deposit or full payment',
        path: ['payment_requirement'],
      });
    }
    if (req === 'deposit') {
      const d = data.deposit_amount_pence;
      if (d == null || d <= 0) {
        ctx.addIssue({ code: 'custom', message: 'Deposit amount is required', path: ['deposit_amount_pence'] });
      } else if (price > 0 && d > price) {
        ctx.addIssue({
          code: 'custom',
          message: 'Deposit cannot exceed price per person',
          path: ['deposit_amount_pence'],
        });
      }
    }
  });

/** Partial updates: cannot use .partial() on classTypeSchema (Zod forbids .partial() when superRefine is used). */
const classTypePatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  duration_minutes: z.number().int().min(5).max(480).optional(),
  capacity: z.number().int().min(1).optional(),
  instructor_id: z.string().uuid().optional().nullable(),
  instructor_name: z.string().max(200).optional().nullable(),
  price_pence: z.number().int().min(0).optional().nullable(),
  payment_requirement: classPaymentRequirementSchema.optional(),
  deposit_amount_pence: z.number().int().min(0).optional().nullable(),
  colour: z.string().max(20).optional(),
  is_active: z.boolean().optional(),
  max_advance_booking_days: z.number().int().min(1).max(365).optional(),
  min_booking_notice_hours: z.number().int().min(0).max(168).optional(),
  cancellation_notice_hours: z.number().int().min(0).max(168).optional(),
  allow_same_day_booking: z.boolean().optional(),
});

const timetableEntrySchema = z.object({
  class_type_id: z.string().uuid(),
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  is_active: z.boolean().optional(),
  interval_weeks: z.number().int().min(1).max(8).optional(),
  recurrence_type: z.string().max(32).optional(),
  recurrence_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  total_occurrences: z.number().int().min(1).optional().nullable(),
});

/**
 * Clearing `instructor_id` is only allowed when there is nothing that would still imply sessions on a calendar
 * (future instances or an active recurring timetable rule).
 */
async function assertCanClearClassInstructor(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  classTypeId: string,
): Promise<string | null> {
  const today = new Date().toISOString().slice(0, 10);
  const { count: instCount, error: instErr } = await admin
    .from('class_instances')
    .select('id', { count: 'exact', head: true })
    .eq('class_type_id', classTypeId)
    .eq('is_cancelled', false)
    .gte('instance_date', today);
  if (instErr) {
    console.error('assertCanClearClassInstructor (instances):', instErr.message);
    return 'Could not verify class sessions.';
  }
  if ((instCount ?? 0) > 0) {
    return 'Cannot remove this class from the calendar while future sessions are scheduled. Cancel or reschedule those sessions first.';
  }
  const { count: ttCount, error: ttErr } = await admin
    .from('class_timetable')
    .select('id', { count: 'exact', head: true })
    .eq('class_type_id', classTypeId)
    .eq('is_active', true);
  if (ttErr) {
    console.error('assertCanClearClassInstructor (timetable):', ttErr.message);
    return 'Could not verify class schedule.';
  }
  if ((ttCount ?? 0) > 0) {
    return 'Remove this class’s recurring schedule in Class timetable before removing it from the calendar.';
  }
  return null;
}

/**
 * Team calendar columns for the class-type picker — must match the Calendars tab source:
 * `GET /api/venue/practitioners?roster=1` uses `unified_calendars` only when `booking_model === 'unified_scheduling'`,
 * otherwise legacy `practitioners` rows (e.g. table + class_session venues).
 */
async function fetchTeamCalendarColumnsForClassPicker(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
  bookingModel: string,
): Promise<Array<{ id: string; name: string; sort_order: number | null }>> {
  if (bookingModel === 'unified_scheduling') {
    const { data, error } = await admin
      .from('unified_calendars')
      .select('id, name, sort_order')
      .eq('venue_id', venueId)
      .neq('calendar_type', 'resource')
      .order('sort_order', { ascending: true });
    if (error) {
      console.error('fetchTeamCalendarColumnsForClassPicker (unified_calendars):', error);
      return [];
    }
    return (data ?? []) as Array<{ id: string; name: string; sort_order: number | null }>;
  }
  const { data, error } = await admin
    .from('practitioners')
    .select('id, name, sort_order')
    .eq('venue_id', venueId)
    .order('sort_order', { ascending: true });
  if (error) {
    console.error('fetchTeamCalendarColumnsForClassPicker (practitioners):', error);
    return [];
  }
  return (data ?? []) as Array<{ id: string; name: string; sort_order: number | null }>;
}

/** GET /api/venue/classes - list class types, timetable, and upcoming instances. */
export async function GET() {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const admin = getSupabaseAdminClient();

    const { data: classTypes, error: typesError } = await admin
      .from('class_types')
      .select('*')
      .eq('venue_id', staff.venue_id)
      .order('name');

    if (typesError) {
      console.error('GET /api/venue/classes failed (class_types):', typesError);
      return NextResponse.json({ error: 'Failed to fetch class types' }, { status: 500 });
    }

    const { data: venueRow } = await admin
      .from('venues')
      .select('booking_model')
      .eq('id', staff.venue_id)
      .maybeSingle();
    const bookingModel = (venueRow as { booking_model?: string } | null)?.booking_model ?? '';

    const teamCalendarPicklist = await fetchTeamCalendarColumnsForClassPicker(admin, staff.venue_id, bookingModel);

    const ids = (classTypes ?? []).map((ct) => ct.id as string);
    if (ids.length === 0) {
      const { data: practitioners } = await admin
        .from('practitioners')
        .select('id, name, sort_order')
        .eq('venue_id', staff.venue_id)
        .order('sort_order', { ascending: true });
      return NextResponse.json({
        class_types: [],
        timetable: [],
        instances: [],
        practitioners: practitioners ?? [],
        unified_calendars: teamCalendarPicklist,
      });
    }

    const [timetableRes, instancesRes, practitionersRes] = await Promise.all([
      admin.from('class_timetable').select('*').in('class_type_id', ids),
      admin
        .from('class_instances')
        .select('*')
        .in('class_type_id', ids)
        .gte('instance_date', new Date().toISOString().slice(0, 10))
        .order('instance_date')
        .limit(200),
      admin.from('practitioners').select('id, name, sort_order').eq('venue_id', staff.venue_id).order('sort_order', { ascending: true }),
    ]);

    if (timetableRes.error) {
      console.error('GET /api/venue/classes failed (timetable):', timetableRes.error);
      return NextResponse.json({ error: 'Failed to fetch timetable' }, { status: 500 });
    }
    if (instancesRes.error) {
      console.error('GET /api/venue/classes failed (instances):', instancesRes.error);
      return NextResponse.json({ error: 'Failed to fetch instances' }, { status: 500 });
    }
    if (practitionersRes.error) {
      console.error('GET /api/venue/classes failed (practitioners):', practitionersRes.error);
      return NextResponse.json({ error: 'Failed to fetch practitioners' }, { status: 500 });
    }

    const rawInstances = instancesRes.data ?? [];
    const instanceIds = rawInstances.map((row: { id: string }) => row.id);
    const bookedByInstance: Record<string, number> = {};
    if (instanceIds.length > 0) {
      const { data: bookingRows, error: bookErr } = await admin
        .from('bookings')
        .select('class_instance_id, party_size, status')
        .eq('venue_id', staff.venue_id)
        .in('class_instance_id', instanceIds);
      if (bookErr) {
        console.error('GET /api/venue/classes booking counts failed:', bookErr);
      } else {
        for (const b of bookingRows ?? []) {
          if ((b as { status?: string }).status === 'Cancelled') continue;
          const cid = (b as { class_instance_id: string | null }).class_instance_id;
          if (!cid) continue;
          bookedByInstance[cid] =
            (bookedByInstance[cid] ?? 0) + Number((b as { party_size?: number }).party_size ?? 1);
        }
      }
    }

    const instances = rawInstances.map((row: { id: string }) => ({
      ...row,
      booked_spots: bookedByInstance[row.id] ?? 0,
    }));

    const rawTypes = classTypes ?? [];
    const instructorIds = [
      ...new Set(
        rawTypes
          .map((ct) => (ct as { instructor_id?: string | null }).instructor_id)
          .filter((x): x is string => Boolean(x)),
      ),
    ];
    const resolvedByInstructor = new Map<string, string | null>();
    for (const iid of instructorIds) {
      resolvedByInstructor.set(iid, await resolveInstructorCalendarIdForClass(admin, staff.venue_id, iid));
    }
    const enrichedClassTypes = rawTypes.map((ct) => {
      const row = ct as { instructor_id?: string | null };
      const iid = row.instructor_id;
      const resolved = iid ? resolvedByInstructor.get(iid) ?? null : null;
      const instructor_calendar_id = iid ? resolved ?? iid : null;
      return { ...(ct as Record<string, unknown>), instructor_calendar_id };
    });

    return NextResponse.json({
      class_types: enrichedClassTypes,
      timetable: timetableRes.data ?? [],
      instances,
      practitioners: practitionersRes.data ?? [],
      unified_calendars: teamCalendarPicklist,
    });
  } catch (err) {
    console.error('GET /api/venue/classes failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/venue/classes - create a class type or timetable entry (admin or scoped staff). */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const modelGate = await requireVenueExposesSecondaryModel(admin, staff.venue_id, 'class_session');
    if (!modelGate.ok) return modelGate.response;

    const body = await request.json();

    // Determine what to create based on body shape
    if (body.day_of_week !== undefined) {
      // Timetable entry
      const parsed = timetableEntrySchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
      }
      if (staff.role !== 'admin') {
        const scope = await staffMayManageClassTypeSessions(
          admin,
          staff.venue_id,
          staff,
          parsed.data.class_type_id,
        );
        if (!scope.ok) {
          return NextResponse.json({ error: scope.error }, { status: scope.status });
        }
      }
      const { data, error } = await admin.from('class_timetable').insert(parsed.data).select().single();
      if (error) {
        console.error('POST /api/venue/classes (timetable) failed:', error);
        return NextResponse.json({ error: 'Failed to create timetable entry' }, { status: 500 });
      }
      return NextResponse.json({ type: 'timetable', data }, { status: 201 });
    }

    // Class type
    const parsed = classTypeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const insertRow = {
      venue_id: staff.venue_id,
      ...parsed.data,
      max_advance_booking_days: parsed.data.max_advance_booking_days ?? DEFAULT_ENTITY_BOOKING_WINDOW.max_advance_booking_days,
      min_booking_notice_hours: parsed.data.min_booking_notice_hours ?? DEFAULT_ENTITY_BOOKING_WINDOW.min_booking_notice_hours,
      cancellation_notice_hours: parsed.data.cancellation_notice_hours ?? DEFAULT_ENTITY_BOOKING_WINDOW.cancellation_notice_hours,
      allow_same_day_booking: parsed.data.allow_same_day_booking ?? DEFAULT_ENTITY_BOOKING_WINDOW.allow_same_day_booking,
    };

    const calendarForScheduling = await resolveInstructorCalendarIdForClass(
      admin,
      staff.venue_id,
      parsed.data.instructor_id,
    );
    if (!calendarForScheduling) {
      return NextResponse.json(
        {
          error:
            'That calendar column cannot be used for class scheduling. Refresh the page, pick a calendar from the list, and try again.',
        },
        { status: 400 },
      );
    }

    if (staff.role !== 'admin') {
      const access = await requireManagedCalendarAccess(
        admin,
        staff.venue_id,
        staff,
        calendarForScheduling,
        'You can only create classes on calendars assigned to your account.',
      );
      if (!access.ok) {
        return NextResponse.json({ error: access.error }, { status: 403 });
      }
    }

    const { data, error } = await admin.from('class_types').insert(insertRow).select().single();

    if (error) {
      console.error('POST /api/venue/classes (class_type) failed:', error);
      return NextResponse.json({ error: 'Failed to create class type' }, { status: 500 });
    }

    return NextResponse.json({ type: 'class_type', data }, { status: 201 });
  } catch (err) {
    console.error('POST /api/venue/classes failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH /api/venue/classes - update class type, timetable entry, or instance. */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const modelGate = await requireVenueExposesSecondaryModel(admin, staff.venue_id, 'class_session');
    if (!modelGate.ok) return modelGate.response;

    const body = await request.json();
    const { id, entity_type, ...rest } = body;
    if (!id || !entity_type) return NextResponse.json({ error: 'Missing id or entity_type' }, { status: 400 });

    if (entity_type === 'class_type' && staff.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden: only venue admins can edit class types.' }, { status: 403 });
    }

    if (entity_type === 'timetable') {
      const { data: ttRow, error: ttFetchErr } = await admin
        .from('class_timetable')
        .select('id, class_type_id')
        .eq('id', id)
        .maybeSingle();
      if (ttFetchErr) {
        console.error('PATCH /api/venue/classes (timetable) fetch failed:', ttFetchErr);
        return NextResponse.json({ error: 'Failed to update timetable entry' }, { status: 500 });
      }
      if (!ttRow) {
        return NextResponse.json({ error: 'Timetable entry not found' }, { status: 404 });
      }
      const ctId = (ttRow as { class_type_id: string }).class_type_id;
      const scope = await staffMayManageClassTypeSessions(admin, staff.venue_id, staff, ctId);
      if (!scope.ok) {
        return NextResponse.json({ error: scope.error }, { status: scope.status });
      }
      const { data, error } = await admin.from('class_timetable').update(rest).eq('id', id).select().single();
      if (error) return NextResponse.json({ error: 'Failed to update timetable entry' }, { status: 500 });
      return NextResponse.json(data);
    }

    if (entity_type === 'instance') {
      const { data: existingInst, error: fetchInstErr } = await admin
        .from('class_instances')
        .select('id, instance_date, start_time, class_type_id, is_cancelled')
        .eq('id', id)
        .maybeSingle();

      if (fetchInstErr) {
        console.error('PATCH /api/venue/classes (instance) fetch failed:', fetchInstErr);
        return NextResponse.json({ error: 'Failed to update instance' }, { status: 500 });
      }
      if (!existingInst) {
        return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
      }

      const { data: ctRow, error: ctFetchErr } = await admin
        .from('class_types')
        .select('id, instructor_id, duration_minutes')
        .eq('id', (existingInst as { class_type_id: string }).class_type_id)
        .eq('venue_id', staff.venue_id)
        .maybeSingle();

      if (ctFetchErr || !ctRow) {
        return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
      }

      const sessionScope = await staffMayManageClassTypeSessions(
        admin,
        staff.venue_id,
        staff,
        (existingInst as { class_type_id: string }).class_type_id,
      );
      if (!sessionScope.ok) {
        return NextResponse.json({ error: sessionScope.error }, { status: sessionScope.status });
      }

      const mergedInst = { ...existingInst, ...rest } as {
        instance_date: string;
        start_time: string;
        is_cancelled?: boolean | null;
      };
      const nextCancelled = Boolean(mergedInst.is_cancelled);

      if (!nextCancelled) {
        const conflict = await assertClassSessionWindowFreeOnCalendar(admin, staff.venue_id, {
          instructorId: (ctRow as { instructor_id: string | null }).instructor_id,
          durationMinutes: (ctRow as { duration_minutes: number }).duration_minutes,
          instanceDate: String(mergedInst.instance_date),
          startTime: String(mergedInst.start_time),
          excludeClassInstanceId: id as string,
        });
        if (conflict) {
          return NextResponse.json({ error: conflict }, { status: 409 });
        }
      }

      const { data, error } = await admin.from('class_instances').update(rest).eq('id', id).select().single();
      if (error) return NextResponse.json({ error: 'Failed to update instance' }, { status: 500 });
      const row = data as {
        instance_date: string;
        start_time: string;
        class_type_id: string;
        is_cancelled?: boolean | null;
      };
      await syncCalendarBlockForClassInstance(admin, {
        venueId: staff.venue_id,
        classInstanceId: id as string,
        instanceDate: String(row.instance_date),
        startTime: String(row.start_time),
        classTypeId: String(row.class_type_id),
        skipBlock: Boolean(row.is_cancelled),
        createdByStaffId: staff.id,
      });
      return NextResponse.json(data);
    }

    // class_type - validate patch shape, merge with row, then run full classTypeSchema (payment rules).
    const patchParsed = classTypePatchSchema.safeParse(rest);
    if (!patchParsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: patchParsed.error.flatten() }, { status: 400 });
    }

    const { data: existing, error: fetchErr } = await admin
      .from('class_types')
      .select(
        'name, description, duration_minutes, capacity, instructor_id, instructor_name, price_pence, payment_requirement, deposit_amount_pence, colour, is_active, max_advance_booking_days, min_booking_notice_hours, cancellation_notice_hours, allow_same_day_booking',
      )
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (fetchErr) {
      console.error('PATCH /api/venue/classes (class_type) fetch failed:', fetchErr);
      return NextResponse.json({ error: 'Failed to update class type' }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: 'Class type not found' }, { status: 404 });
    }

    const patch = patchParsed.data;

    const merged = {
      ...existing,
      ...patch,
    };

    if (patch.instructor_id === null) {
      const block = await assertCanClearClassInstructor(admin, id as string);
      if (block) {
        return NextResponse.json({ error: block }, { status: 409 });
      }
    }

    const fullParsed = (merged.instructor_id === null ? classTypeMergedSchema : classTypeSchema).safeParse(merged);
    if (!fullParsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: fullParsed.error.flatten() }, { status: 400 });
    }

    if (fullParsed.data.instructor_id != null) {
      const calendarForScheduling = await resolveInstructorCalendarIdForClass(
        admin,
        staff.venue_id,
        fullParsed.data.instructor_id,
      );
      if (!calendarForScheduling) {
        return NextResponse.json(
          {
            error:
              'That calendar column cannot be used for class scheduling. Refresh the page, pick a calendar from the list, and try again.',
          },
          { status: 400 },
        );
      }
    }

    const oldInst = String(existing.instructor_id ?? '');
    const newInst = fullParsed.data.instructor_id;
    const oldDur = Number(existing.duration_minutes);
    const newDur = fullParsed.data.duration_minutes;

    if (newInst != null && (oldInst !== newInst || oldDur !== newDur)) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: futureInstances, error: instListErr } = await admin
        .from('class_instances')
        .select('id, instance_date, start_time')
        .eq('class_type_id', id)
        .eq('is_cancelled', false)
        .gte('instance_date', today);

      if (instListErr) {
        console.error('PATCH /api/venue/classes (class_type) future instances:', instListErr);
        return NextResponse.json({ error: 'Could not verify calendar availability.' }, { status: 500 });
      }

      for (const raw of futureInstances ?? []) {
        const inst = raw as { id: string; instance_date: string; start_time: string };
        const conflict = await assertClassSessionWindowFreeOnCalendar(admin, staff.venue_id, {
          instructorId: newInst,
          durationMinutes: newDur,
          instanceDate: inst.instance_date,
          startTime: inst.start_time,
          excludeClassInstanceId: inst.id,
        });
        if (conflict) {
          return NextResponse.json({ error: conflict }, { status: 409 });
        }
      }
    }

    const { data, error } = await admin
      .from('class_types')
      .update(patch)
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .select()
      .single();

    if (error) {
      console.error('PATCH /api/venue/classes failed:', error);
      return NextResponse.json({ error: 'Failed to update class type' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error('PATCH /api/venue/classes failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE /api/venue/classes - delete class type, timetable entry or instance (admin or scoped staff). */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const { id, entity_type } = await request.json();
    if (!id || !entity_type) return NextResponse.json({ error: 'Missing id or entity_type' }, { status: 400 });

    const admin = getSupabaseAdminClient();
    const modelGate = await requireVenueExposesSecondaryModel(admin, staff.venue_id, 'class_session');
    if (!modelGate.ok) return modelGate.response;

    if (entity_type === 'instance') {
      const { data: inst, error: instErr } = await admin
        .from('class_instances')
        .select('id, class_type_id')
        .eq('id', id)
        .maybeSingle();
      if (instErr) {
        console.error('DELETE /api/venue/classes (instance) lookup failed:', instErr);
        return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
      }
      if (!inst) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
      }
      const { data: ct, error: ctErr } = await admin
        .from('class_types')
        .select('id')
        .eq('id', (inst as { class_type_id: string }).class_type_id)
        .eq('venue_id', staff.venue_id)
        .maybeSingle();
      if (ctErr || !ct) {
        return NextResponse.json({ error: 'Forbidden or not found' }, { status: 404 });
      }
      if (staff.role !== 'admin') {
        const scope = await staffMayManageClassTypeSessions(
          admin,
          staff.venue_id,
          staff,
          (inst as { class_type_id: string }).class_type_id,
        );
        if (!scope.ok) {
          return NextResponse.json({ error: scope.error }, { status: scope.status });
        }
      }
      const instGuard = await hasActiveBookingsForClassInstance(admin, staff.venue_id, id);
      if (instGuard.error) {
        return NextResponse.json({ error: instGuard.error }, { status: 500 });
      }
      if (instGuard.blocked) {
        return NextResponse.json({ error: UPCOMING_ACTIVE_BOOKINGS_BLOCK_DELETE }, { status: 409 });
      }
      const { error } = await admin.from('class_instances').delete().eq('id', id);
      if (error) {
        console.error('DELETE /api/venue/classes (instance) failed:', error);
        return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    if (entity_type === 'timetable') {
      const { data: ttRow, error: ttErr } = await admin
        .from('class_timetable')
        .select('id, class_type_id')
        .eq('id', id)
        .maybeSingle();
      if (ttErr) {
        console.error('DELETE /api/venue/classes (timetable) lookup failed:', ttErr);
        return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
      }
      if (!ttRow) {
        return NextResponse.json({ error: 'Schedule entry not found' }, { status: 404 });
      }
      const { data: ct, error: ctErr } = await admin
        .from('class_types')
        .select('id')
        .eq('id', (ttRow as { class_type_id: string }).class_type_id)
        .eq('venue_id', staff.venue_id)
        .maybeSingle();
      if (ctErr || !ct) {
        return NextResponse.json({ error: 'Forbidden or not found' }, { status: 404 });
      }
      if (staff.role !== 'admin') {
        const scope = await staffMayManageClassTypeSessions(
          admin,
          staff.venue_id,
          staff,
          (ttRow as { class_type_id: string }).class_type_id,
        );
        if (!scope.ok) {
          return NextResponse.json({ error: scope.error }, { status: scope.status });
        }
      }
      const ttGuard = await hasUpcomingActiveBookingsForClassTimetableEntry(admin, staff.venue_id, id);
      if (ttGuard.error) {
        return NextResponse.json({ error: ttGuard.error }, { status: 500 });
      }
      if (ttGuard.blocked) {
        return NextResponse.json({ error: UPCOMING_ACTIVE_BOOKINGS_BLOCK_DELETE }, { status: 409 });
      }
      const { error } = await admin.from('class_timetable').delete().eq('id', id);
      if (error) {
        console.error('DELETE /api/venue/classes (timetable) failed:', error);
        return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    if (entity_type !== 'class_type') {
      return NextResponse.json({ error: 'Invalid entity_type' }, { status: 400 });
    }

    if (staff.role !== 'admin') {
      const scope = await staffMayManageClassTypeSessions(admin, staff.venue_id, staff, id);
      if (!scope.ok) {
        return NextResponse.json({ error: scope.error }, { status: scope.status });
      }
    }

    const typeGuard = await hasUpcomingActiveBookingsForClassType(admin, staff.venue_id, id);
    if (typeGuard.error) {
      return NextResponse.json({ error: typeGuard.error }, { status: 500 });
    }
    if (typeGuard.blocked) {
      return NextResponse.json({ error: UPCOMING_ACTIVE_BOOKINGS_BLOCK_DELETE }, { status: 409 });
    }

    const { error } = await admin.from('class_types').delete().eq('id', id).eq('venue_id', staff.venue_id);
    if (error) {
      console.error('DELETE /api/venue/classes (class_type) failed:', error);
      return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/venue/classes failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
