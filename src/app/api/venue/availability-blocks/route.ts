import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import {
  describeVenueClosureConflicts,
  findVenueClosureBookingConflicts,
} from '@/lib/calendar/closure-booking-conflicts';
import { z } from 'zod';

/** Block types that make the venue unavailable, so existing bookings are stranded. */
const CLOSING_BLOCK_TYPES = new Set(['closed', 'special_event']);

/**
 * Returns a 409 asking the admin to confirm when a proposed closure covers bookings
 * that already exist, or `null` to proceed. Mirrors the opening-hours flow: warn once,
 * then honour `?acknowledge_affected_bookings=true` on the retry.
 */
async function guardVenueClosureConflicts(
  request: NextRequest,
  admin: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
  block: {
    block_type?: string;
    date_start?: string;
    date_end?: string;
    time_start?: string | null;
    time_end?: string | null;
  },
): Promise<NextResponse | null> {
  if (!block.block_type || !CLOSING_BLOCK_TYPES.has(block.block_type)) return null;
  if (!block.date_start || !block.date_end) return null;
  if (request.nextUrl.searchParams.get('acknowledge_affected_bookings') === 'true') return null;

  try {
    const conflicts = await findVenueClosureBookingConflicts(admin, {
      venueId,
      startDate: block.date_start,
      endDate: block.date_end,
      startTime: block.time_start,
      endTime: block.time_end,
    });
    if (!conflicts) return null;
    return NextResponse.json(
      {
        requires_confirmation: true,
        affected_count: conflicts.totalConflicts,
        message: describeVenueClosureConflicts(conflicts),
      },
      { status: 409 },
    );
  } catch (e) {
    // Fail loudly rather than closing over bookings without a word.
    console.error('[availability-blocks] closure conflict check:', e);
    return NextResponse.json(
      { error: 'Could not verify existing bookings. Please try again.' },
      { status: 500 },
    );
  }
}

const yieldOverridesSchema = z
  .object({
    max_bookings_per_slot: z.number().int().min(1).max(500).optional(),
    slot_interval_minutes: z.number().int().min(5).max(120).optional(),
    buffer_minutes: z.number().int().min(0).max(120).optional(),
    duration_minutes: z.number().int().min(15).max(300).optional(),
  })
  .strict()
  .nullable()
  .optional();

const overridePeriodsSchema = z
  .array(
    z.object({
      open: z.string().regex(/^\d{2}:\d{2}$/),
      close: z.string().regex(/^\d{2}:\d{2}$/),
    }),
  )
  .min(1)
  .max(4)
  .nullable()
  .optional();

/**
 * Ordering rules that apply to a WHOLE block, whichever verb produced it.
 *
 * `date_end < date_start` and `time_end <= time_start` were accepted by both schemas. An
 * inverted time window is not inert: on the appointment path
 * `blocksToVenueOpeningExceptions` discards the times and closes the entire day, while the
 * venue resolver requires `end > start` and so applies no constraint at all. The same row
 * therefore means "shut" to one model and "open" to every other one.
 */
function blockOrderingError(v: {
  block_type?: string | null;
  date_start?: string | null;
  date_end?: string | null;
  time_start?: string | null;
  time_end?: string | null;
  override_periods?: unknown;
}): string | null {
  if (v.date_start && v.date_end && v.date_end < v.date_start) {
    return 'The end date cannot be before the start date.';
  }
  if (v.time_start && v.time_end && v.time_end <= v.time_start) {
    return 'The end time must be after the start time.';
  }
  if (
    v.block_type === 'amended_hours' &&
    !(Array.isArray(v.override_periods) && v.override_periods.length > 0)
  ) {
    // An amended block with no periods resolves to a silent full-day closure for classes,
    // events, resources and the diary, and is ignored entirely on the appointment path.
    // The POST schema has always refused it; PATCH could still create one.
    return 'At least one open period is required for amended hours.';
  }
  return null;
}

const blockSchema = z
  .object({
    service_id: z.string().uuid().nullable().optional(),
    block_type: z.enum(['closed', 'reduced_capacity', 'special_event', 'amended_hours']),
    date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time_start: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    time_end: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    override_max_covers: z.number().int().min(0).nullable().optional(),
    reason: z.string().max(500).nullable().optional(),
    yield_overrides: yieldOverridesSchema,
    override_periods: overridePeriodsSchema,
  })
  .refine(
    (v) => v.block_type !== 'amended_hours' || (Array.isArray(v.override_periods) && v.override_periods.length > 0),
    { message: 'override_periods required for amended_hours', path: ['override_periods'] },
  )
  .superRefine((v, ctx) => {
    const message = blockOrderingError(v);
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  });

const blockPatchSchema = z
  .object({
    id: z.string().uuid(),
    service_id: z.string().uuid().nullable().optional(),
    block_type: z.enum(['closed', 'reduced_capacity', 'special_event', 'amended_hours']).optional(),
    date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    time_start: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    time_end: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    override_max_covers: z.number().int().min(0).nullable().optional(),
    reason: z.string().max(500).nullable().optional(),
    yield_overrides: yieldOverridesSchema,
    override_periods: overridePeriodsSchema,
  })
  /**
   * Only the pairs present in THIS patch can be judged here; a `{id, date_end}` patch has
   * nothing to compare against. The authoritative check runs on the merged row in the
   * handler, which is why this schema stays a genuine partial-update schema rather than
   * inheriting the POST refine.
   */
  .superRefine((v, ctx) => {
    const message = blockOrderingError(v);
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  });

const blockDeleteSchema = z.object({ id: z.string().uuid() });

/** GET /api/venue/availability-blocks */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from('availability_blocks')
      .select('*')
      .eq('venue_id', staff.venue_id)
      .order('date_start', { ascending: true });

    if (error) {
      console.error('GET /api/venue/availability-blocks failed:', error);
      return NextResponse.json({ error: 'Failed to fetch blocks' }, { status: 500 });
    }

    return NextResponse.json({ blocks: data });
  } catch (err) {
    console.error('GET /api/venue/availability-blocks failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/venue/availability-blocks - create a block (admin only). */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

    const body = await request.json();
    const parsed = blockSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();

    // Closing a date never cancels or notifies the people already booked on it, so
    // without this an owner closes for an emergency and clients still turn up.
    // Non-blocking (you must be able to close Christmas Day with a booking on it):
    // surface the conflict once, then proceed when the admin acknowledges it.
    const conflictCheck = await guardVenueClosureConflicts(request, admin, staff.venue_id, {
      block_type: parsed.data.block_type,
      date_start: parsed.data.date_start,
      date_end: parsed.data.date_end,
      time_start: parsed.data.time_start ?? null,
      time_end: parsed.data.time_end ?? null,
    });
    if (conflictCheck) return conflictCheck;

    const { data, error } = await admin
      .from('availability_blocks')
      .insert({ venue_id: staff.venue_id, ...parsed.data })
      .select('*')
      .single();

    if (error) {
      console.error('POST /api/venue/availability-blocks failed:', error);
      return NextResponse.json({ error: 'Failed to create block' }, { status: 500 });
    }

    return NextResponse.json({ block: data }, { status: 201 });
  } catch (err) {
    console.error('POST /api/venue/availability-blocks failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH /api/venue/availability-blocks */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

    const body = await request.json();
    const parsed = blockPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const { id, ...fields } = parsed.data;
    const admin = getSupabaseAdminClient();

    // Editing can widen a closure over bookings just as easily as creating one, so
    // merge the patch onto the stored row and run the same check.
    const { data: existing } = await admin
      .from('availability_blocks')
      .select('block_type, date_start, date_end, time_start, time_end, override_periods')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    // A missing row used to skip the conflict guard and fall through to an unconditional
    // update, which then matched nothing and 500'd on `.single()`. Say so plainly instead.
    if (!existing) {
      return NextResponse.json({ error: 'Block not found' }, { status: 404 });
    }

    const merged = { ...(existing as Record<string, unknown>), ...fields } as {
      block_type?: string;
      date_start?: string;
      date_end?: string;
      time_start?: string | null;
      time_end?: string | null;
      override_periods?: unknown;
    };

    // Validate the row this PATCH will actually produce, not just the fields it carries.
    // Porting the POST refine onto the patch schema would break partial updates: a normal
    // `{id, date_end}` patch has no block_type to test. Merging first is what lets a
    // partial-update schema stay partial while the stored result is still guaranteed valid.
    const orderingError = blockOrderingError(merged);
    if (orderingError) {
      return NextResponse.json({ error: orderingError }, { status: 400 });
    }

    const conflictCheck = await guardVenueClosureConflicts(request, admin, staff.venue_id, merged);
    if (conflictCheck) return conflictCheck;

    const { data, error } = await admin
      .from('availability_blocks')
      .update(fields)
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .select('*')
      .single();

    if (error) {
      console.error('PATCH /api/venue/availability-blocks failed:', error);
      return NextResponse.json({ error: 'Failed to update block' }, { status: 500 });
    }

    return NextResponse.json({ block: data });
  } catch (err) {
    console.error('PATCH /api/venue/availability-blocks failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE /api/venue/availability-blocks */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

    const body = await request.json();
    const parsedDelete = blockDeleteSchema.safeParse(body);
    if (!parsedDelete.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsedDelete.error.flatten() }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const { error } = await admin
      .from('availability_blocks')
      .delete()
      .eq('id', parsedDelete.data.id)
      .eq('venue_id', staff.venue_id);
    if (error) {
      console.error('DELETE /api/venue/availability-blocks failed:', error);
      return NextResponse.json({ error: 'Failed to delete block' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/venue/availability-blocks failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
