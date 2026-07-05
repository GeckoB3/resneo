import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import {
  getVenueStaff,
  getStaffManagedCalendarIds,
  requireManagedCalendarAccess,
  requireManagedCalendarIds,
} from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireVenueExposesSecondaryModel } from '@/lib/booking/require-venue-secondary-model';
import { assertResourceAvailabilityClearOnHostCalendar } from '@/lib/booking/resource-host-calendar-conflicts';
import {
  weeklyResourceAvailabilityOverlaps,
  weeklyResourceRestrictedByHostCalendar,
} from '@/lib/booking/resource-weekly-overlap';
import { ensureUnifiedMirrorForPractitionerId } from '@/lib/class-instances/instructor-calendar-block';
import type { WorkingHours } from '@/types/booking-models';
import { DEFAULT_ENTITY_BOOKING_WINDOW } from '@/lib/booking/entity-booking-window';
import {
  DEFAULT_RESOURCE_MIN_BOOKING_MINUTES,
  DEFAULT_RESOURCE_SLOT_INTERVAL_MINUTES,
} from '@/lib/booking/resource-booking-defaults';
import {
  buildEntityNotFoundMessage,
  buildUpcomingBookingsBlockMessage,
  hasUpcomingActiveBookingsForVenueResource,
} from '@/lib/venue/entity-delete-booking-guards';
import { featureFlagDisabledResponse, loadVenueFeatureFlags } from '@/lib/feature-flags';
import { z } from 'zod';

const availabilityExceptionDaySchema = z.union([
  z.object({ closed: z.literal(true) }),
  z.object({
    periods: z.array(z.object({ start: z.string(), end: z.string() })).min(1),
  }),
]);

const paymentRequirementSchema = z.enum(['none', 'deposit', 'full_payment', 'card_hold']);

const resourceFieldSchema = z.object({
  name: z.string().min(1).max(200),
  resource_type: z.string().max(100).optional(),
  // Empty string clears the value; null/undefined are both accepted so PATCH can unset.
  description: z.preprocess((v) => (v === '' ? null : v), z.string().max(2000).nullable().optional()),
  photo_url: z.preprocess((v) => (v === '' ? null : v), z.string().url().max(2000).nullable().optional()),
  min_booking_minutes: z.number().int().min(15).max(480).optional(),
  max_booking_minutes: z.number().int().min(15).max(1440).optional(),
  slot_interval_minutes: z.number().int().min(5).max(480).optional(),
  price_per_slot_pence: z.number().int().min(0).optional(),
  payment_requirement: paymentRequirementSchema.optional(),
  deposit_amount_pence: z.number().int().min(0).optional().nullable(),
  availability_hours: z.record(z.string(), z.array(z.object({ start: z.string(), end: z.string() }))).optional(),
  availability_exceptions: z
    .record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), availabilityExceptionDaySchema)
    .optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  /** Host calendar column (unified_calendars id, non-resource). Required on create. */
  display_on_calendar_id: z.string().uuid().optional().nullable(),
  max_advance_booking_days: z.number().int().min(1).max(365).optional(),
  min_booking_notice_hours: z.number().int().min(0).max(168).optional(),
  cancellation_notice_hours: z.number().int().min(0).max(168).optional(),
  allow_same_day_booking: z.boolean().optional(),
});

function validateResourcePaymentFields(input: {
  payment_requirement: string;
  deposit_amount_pence: number | null | undefined;
  price_per_slot_pence: number | null | undefined;
  slot_interval_minutes: number;
  max_booking_minutes: number;
}): string | null {
  const price = input.price_per_slot_pence ?? 0;
  const req = input.payment_requirement ?? 'none';
  if (price <= 0 && (req === 'deposit' || req === 'full_payment')) {
    return 'Set a price for each start-time step before choosing deposit or full payment online';
  }
  if (req === 'deposit') {
    const d = input.deposit_amount_pence;
    if (d == null || d <= 0) {
      return 'Deposit amount is required';
    }
    const slotInt = input.slot_interval_minutes;
    const maxSlots = Math.max(1, Math.ceil(input.max_booking_minutes / slotInt));
    const maxTotal = price * maxSlots;
    if (price > 0 && d > maxTotal) {
      return 'Deposit cannot exceed the maximum possible booking total for this resource';
    }
  }
  // 'card_hold' has no price relationship (design doc §6.2): the flat no-show fee just
  // has to be at least £1. A zero-fee card hold must be impossible to configure.
  if (req === 'card_hold') {
    const d = input.deposit_amount_pence;
    if (d == null || d < 100) {
      return 'No-show fee must be at least £1';
    }
  }
  return null;
}

/** Columns added in 20260503120000 (payment) and 20260504120000 (display); safe to omit if DB is behind migrations. */
const OPTIONAL_UNIFIED_CALENDAR_MIGRATION_COLUMNS = new Set([
  'display_on_calendar_id',
  'payment_requirement',
  'deposit_amount_pence',
]);

function parseMissingUnifiedCalendarsColumn(message: string): string | null {
  const m1 = message.match(/Could not find the '([^']+)' column of 'unified_calendars'/i);
  if (m1) return m1[1];
  const m2 = message.match(/column "([^"]+)" of relation "unified_calendars" does not exist/i);
  return m2?.[1] ?? null;
}

/** Remove one optional column from insert/update payload; payment fields are stripped together. */
function stripOptionalMigrationColumn(payload: Record<string, unknown>, col: string): void {
  if (!OPTIONAL_UNIFIED_CALENDAR_MIGRATION_COLUMNS.has(col)) return;
  if (col === 'display_on_calendar_id') {
    delete payload.display_on_calendar_id;
    return;
  }
  delete payload.payment_requirement;
  delete payload.deposit_amount_pence;
}

/** Reject an inverted booking-length range (max < min) when both are supplied. */
function bookingLengthRangeError(
  minBookingMinutes: number | null | undefined,
  maxBookingMinutes: number | null | undefined,
): string | null {
  if (
    typeof minBookingMinutes === 'number' &&
    typeof maxBookingMinutes === 'number' &&
    maxBookingMinutes < minBookingMinutes
  ) {
    return 'Maximum booking length cannot be shorter than the minimum booking length';
  }
  return null;
}

const resourceSchema = resourceFieldSchema.superRefine((data, ctx) => {
  const err = validateResourcePaymentFields({
    payment_requirement: data.payment_requirement ?? 'none',
    deposit_amount_pence: data.deposit_amount_pence,
    price_per_slot_pence: data.price_per_slot_pence,
    slot_interval_minutes: data.slot_interval_minutes ?? DEFAULT_RESOURCE_SLOT_INTERVAL_MINUTES,
    max_booking_minutes: data.max_booking_minutes ?? 180,
  });
  if (err) {
    ctx.addIssue({ code: 'custom', message: err, path: ['payment_requirement'] });
  }
  const rangeErr = bookingLengthRangeError(data.min_booking_minutes, data.max_booking_minutes);
  if (rangeErr) {
    ctx.addIssue({ code: 'custom', message: rangeErr, path: ['max_booking_minutes'] });
  }
});

const resourcePatchSchema = resourceFieldSchema.partial();

const AVAILABILITY_CALENDAR_RESTRICTS_RESOURCE_WARNING =
  'This resource has hours outside the selected calendar. It will only be bookable when venue, calendar, and resource hours all allow it.';

async function fetchHostCalendarWorkingHours(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
  hostCalendarId: string,
): Promise<WorkingHours> {
  const { data } = await admin
    .from('unified_calendars')
    .select('working_hours')
    .eq('id', hostCalendarId)
    .eq('venue_id', venueId)
    .maybeSingle();
  return ((data?.working_hours as WorkingHours) ?? {}) as WorkingHours;
}

function availabilityWarningIfHostRestrictsResource(
  resourceHours: WorkingHours,
  hostHours: WorkingHours,
): string | undefined {
  if (!weeklyResourceRestrictedByHostCalendar(resourceHours, hostHours)) return undefined;
  return AVAILABILITY_CALENDAR_RESTRICTS_RESOURCE_WARNING;
}

async function assertResourceDisplayOnCalendarValid(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
  displayOnCalendarId: string,
  workingHours: WorkingHours,
  excludeResourceId?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  let { data: host } = await admin
    .from('unified_calendars')
    .select('id, calendar_type')
    .eq('id', displayOnCalendarId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!host) {
    const { data: legacyHost } = await admin
      .from('practitioners')
      .select('id, name, staff_id, slug, working_hours, break_times, break_times_by_day, days_off, sort_order, is_active')
      .eq('id', displayOnCalendarId)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (legacyHost) {
      await ensureUnifiedMirrorForPractitionerId(admin, venueId, legacyHost as {
        id: string;
        name: string;
        staff_id?: string | null;
        slug?: string | null;
        working_hours?: unknown;
        break_times?: unknown;
        break_times_by_day?: unknown;
        days_off?: unknown;
        sort_order?: number;
        is_active?: boolean;
      });
      const retry = await admin
        .from('unified_calendars')
        .select('id, calendar_type')
        .eq('id', displayOnCalendarId)
        .eq('venue_id', venueId)
        .maybeSingle();
      host = retry.data;
    }
  }
  if (!host) {
    return { ok: false, message: 'Calendar not found' };
  }
  if ((host as { calendar_type: string }).calendar_type === 'resource') {
    return { ok: false, message: 'Assign the resource to a team calendar (not another resource)' };
  }
  const { data: siblings } = await admin
    .from('unified_calendars')
    .select('id, working_hours')
    .eq('venue_id', venueId)
    .eq('calendar_type', 'resource')
    .eq('display_on_calendar_id', displayOnCalendarId);
  for (const row of siblings ?? []) {
    if (excludeResourceId && row.id === excludeResourceId) continue;
    const wh = (row.working_hours as WorkingHours) ?? {};
    if (weeklyResourceAvailabilityOverlaps(workingHours, wh)) {
      return {
        ok: false,
        message:
          'Another resource on this calendar already has overlapping weekly hours. Choose a different calendar or adjust hours so they do not overlap.',
      };
    }
  }

  const scheduleCheck = await assertResourceAvailabilityClearOnHostCalendar(
    admin,
    venueId,
    displayOnCalendarId,
    workingHours,
    { excludeResourceId },
  );
  if (!scheduleCheck.ok) {
    return { ok: false, message: scheduleCheck.message };
  }

  return { ok: true };
}

/** Map a unified_calendars row (calendar_type='resource') to the Resource shape expected by the UI. */
function mapUnifiedCalendarToResource(row: Record<string, unknown>) {
  return {
    id: row.id,
    venue_id: row.venue_id,
    name: row.name,
    resource_type: row.resource_type ?? null,
    description: (row.description as string | null | undefined) ?? null,
    photo_url: (row.photo_url as string | null | undefined) ?? null,
    slot_interval_minutes: row.slot_interval_minutes ?? DEFAULT_RESOURCE_SLOT_INTERVAL_MINUTES,
    min_booking_minutes: row.min_booking_minutes ?? DEFAULT_RESOURCE_MIN_BOOKING_MINUTES,
    max_booking_minutes: row.max_booking_minutes ?? 180,
    price_per_slot_pence: row.price_per_slot_pence ?? null,
    payment_requirement: (row.payment_requirement as string) ?? 'none',
    deposit_amount_pence: row.deposit_amount_pence ?? null,
    is_active: row.is_active ?? true,
    availability_hours: row.working_hours ?? {},
    availability_exceptions: row.availability_exceptions ?? {},
    sort_order: row.sort_order ?? 0,
    created_at: row.created_at,
    display_on_calendar_id: (row.display_on_calendar_id as string | null | undefined) ?? null,
    max_advance_booking_days: (row.max_advance_booking_days as number | undefined) ?? DEFAULT_ENTITY_BOOKING_WINDOW.max_advance_booking_days,
    min_booking_notice_hours: (row.min_booking_notice_hours as number | undefined) ?? DEFAULT_ENTITY_BOOKING_WINDOW.min_booking_notice_hours,
    cancellation_notice_hours:
      (row.cancellation_notice_hours as number | undefined) ?? DEFAULT_ENTITY_BOOKING_WINDOW.cancellation_notice_hours,
    allow_same_day_booking:
      (row.allow_same_day_booking as boolean | undefined) ?? DEFAULT_ENTITY_BOOKING_WINDOW.allow_same_day_booking,
  };
}

async function mapUnifiedCalendarToResourceWithAvailabilityWarning(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
  row: Record<string, unknown>,
  resourceWeeklyHours: WorkingHours,
  hostCalendarId: string | null,
): Promise<Record<string, unknown>> {
  const base = mapUnifiedCalendarToResource(row);
  if (!hostCalendarId) return base;
  const hostWh = await fetchHostCalendarWorkingHours(admin, venueId, hostCalendarId);
  const w = availabilityWarningIfHostRestrictsResource(resourceWeeklyHours, hostWh);
  return w ? { ...base, availability_warning: w } : base;
}

/** GET /api/venue/resources - list resources for the venue. */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from('unified_calendars')
      .select('*')
      .eq('venue_id', staff.venue_id)
      .eq('calendar_type', 'resource')
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('GET /api/venue/resources failed:', error);
      return NextResponse.json({ error: 'Failed to fetch resources' }, { status: 500 });
    }

    return NextResponse.json(
      {
        resources: (data ?? []).map((r) => mapUnifiedCalendarToResource(r as Record<string, unknown>)),
      },
      {
        // Authenticated dashboard route: edits (rename, hours, price) must be visible
        // immediately. Caching here causes stale-after-edit lag (venue-catalog-cache memory).
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (err) {
    console.error('GET /api/venue/resources failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/venue/resources - create a resource (admin or staff on a managed calendar column). */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const modelGate = await requireVenueExposesSecondaryModel(admin, staff.venue_id, 'resource_booking');
    if (!modelGate.ok) return modelGate.response;

    const body = await request.json();
    const parsed = resourceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const payReq = parsed.data.payment_requirement ?? 'none';
    const dep = parsed.data.deposit_amount_pence ?? null;

    // Card hold config is only accepted while the venue flag is on (design doc §6.1/§6.2).
    if (payReq === 'card_hold') {
      const { resolved } = await loadVenueFeatureFlags(admin, staff.venue_id);
      if (!resolved.card_hold_deposits) {
        return featureFlagDisabledResponse('card_hold_deposits');
      }
    }

    if (!parsed.data.display_on_calendar_id) {
      return NextResponse.json(
        { error: 'Choose a calendar column to show this resource on' },
        { status: 400 },
      );
    }

    if (staff.role !== 'admin') {
      const scope = await requireManagedCalendarIds(admin, staff.venue_id, staff);
      if (!scope.ok) {
        return NextResponse.json({ error: scope.error }, { status: 403 });
      }
      const access = await requireManagedCalendarAccess(
        admin,
        staff.venue_id,
        staff,
        parsed.data.display_on_calendar_id,
        'You can only create resources on calendars assigned to your account.',
      );
      if (!access.ok) {
        return NextResponse.json({ error: access.error }, { status: 403 });
      }
    }

    const workingHours = (parsed.data.availability_hours ?? {}) as WorkingHours;
    const displayCheck = await assertResourceDisplayOnCalendarValid(
      admin,
      staff.venue_id,
      parsed.data.display_on_calendar_id,
      workingHours,
    );
    if (!displayCheck.ok) {
      return NextResponse.json({ error: displayCheck.message }, { status: 409 });
    }

    const insertPayload: Record<string, unknown> = {
      venue_id: staff.venue_id,
      calendar_type: 'resource',
      name: parsed.data.name,
      resource_type: parsed.data.resource_type ?? null,
      description: parsed.data.description ?? null,
      photo_url: parsed.data.photo_url ?? null,
      working_hours: parsed.data.availability_hours ?? {},
      availability_exceptions: parsed.data.availability_exceptions ?? {},
      slot_interval_minutes: parsed.data.slot_interval_minutes ?? DEFAULT_RESOURCE_SLOT_INTERVAL_MINUTES,
      min_booking_minutes: parsed.data.min_booking_minutes ?? DEFAULT_RESOURCE_MIN_BOOKING_MINUTES,
      max_booking_minutes: parsed.data.max_booking_minutes ?? 180,
      price_per_slot_pence: parsed.data.price_per_slot_pence ?? null,
      payment_requirement: payReq,
      // 'card_hold' stores the flat no-show fee in the same column (design doc D5).
      deposit_amount_pence: payReq === 'deposit' || payReq === 'card_hold' ? dep : null,
      is_active: parsed.data.is_active ?? true,
      sort_order: parsed.data.sort_order ?? 0,
      display_on_calendar_id: parsed.data.display_on_calendar_id,
      max_advance_booking_days: parsed.data.max_advance_booking_days ?? DEFAULT_ENTITY_BOOKING_WINDOW.max_advance_booking_days,
      min_booking_notice_hours: parsed.data.min_booking_notice_hours ?? DEFAULT_ENTITY_BOOKING_WINDOW.min_booking_notice_hours,
      cancellation_notice_hours:
        parsed.data.cancellation_notice_hours ?? DEFAULT_ENTITY_BOOKING_WINDOW.cancellation_notice_hours,
      allow_same_day_booking: parsed.data.allow_same_day_booking ?? DEFAULT_ENTITY_BOOKING_WINDOW.allow_same_day_booking,
    };

    const MAX_SCHEMA_RETRY = 6;
    let data: Record<string, unknown> | null = null;
    let error: { message: string } | null = null;
    for (let attempt = 0; attempt < MAX_SCHEMA_RETRY; attempt++) {
      const res = await admin.from('unified_calendars').insert(insertPayload).select().single();
      data = (res.data as Record<string, unknown> | null) ?? null;
      error = res.error;
      if (!error) break;
      const col = parseMissingUnifiedCalendarsColumn(error.message ?? '');
      if (!col || !OPTIONAL_UNIFIED_CALENDAR_MIGRATION_COLUMNS.has(col)) break;
      console.warn(
        `POST /api/venue/resources: omitting migration column(s) after "${col}" not in schema. Apply 20260503120000_unified_calendars_resource_payment.sql and 20260504120000_resource_display_on_calendar.sql`,
      );
      stripOptionalMigrationColumn(insertPayload, col);
    }

    if (error) {
      console.error('POST /api/venue/resources failed:', error);
      return NextResponse.json(
        { error: 'Failed to create resource', details: error.message },
        { status: 500 },
      );
    }

    const payload = await mapUnifiedCalendarToResourceWithAvailabilityWarning(
      admin,
      staff.venue_id,
      data as Record<string, unknown>,
      workingHours,
      parsed.data.display_on_calendar_id,
    );
    return NextResponse.json(payload, { status: 201 });
  } catch (err) {
    console.error('POST /api/venue/resources failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH /api/venue/resources - update a resource (admins: any column; staff: managed calendars only). */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const modelGate = await requireVenueExposesSecondaryModel(admin, staff.venue_id, 'resource_booking');
    if (!modelGate.ok) return modelGate.response;

    const body = await request.json();
    const { id, ...rest } = body;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const parsed = resourcePatchSchema.safeParse(rest);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    // Card hold config is only accepted while the venue flag is on (design doc §6.1/§6.2).
    if (parsed.data.payment_requirement === 'card_hold') {
      const { resolved } = await loadVenueFeatureFlags(admin, staff.venue_id);
      if (!resolved.card_hold_deposits) {
        return featureFlagDisabledResponse('card_hold_deposits');
      }
    }

    const { data: existing, error: exErr } = await admin
      .from('unified_calendars')
      .select('*')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .eq('calendar_type', 'resource')
      .maybeSingle();

    if (exErr || !existing) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
    }

    if (staff.role !== 'admin') {
      const scope = await getStaffManagedCalendarIds(admin, staff.venue_id, staff.id);
      if (scope.length === 0) {
        return NextResponse.json(
          { error: 'No calendars are assigned to your account. Ask an admin to assign at least one calendar.' },
          { status: 403 },
        );
      }
      const managedCalendarIds = scope;
      const existingDisplayOn =
        ((existing as Record<string, unknown>).display_on_calendar_id as string | null | undefined) ?? null;
      if (!existingDisplayOn) {
        return NextResponse.json(
          {
            error:
              'Only venue admins can edit resources that are not assigned to a calendar column. Ask an admin to assign this resource to a calendar first.',
          },
          { status: 403 },
        );
      }
      if (!managedCalendarIds.includes(existingDisplayOn)) {
        return NextResponse.json(
          { error: 'You can only edit resources on calendars assigned to your account.' },
          { status: 403 },
        );
      }
      if (parsed.data.display_on_calendar_id === null) {
        return NextResponse.json(
          { error: 'Only venue admins can remove a resource from its calendar column.' },
          { status: 403 },
        );
      }
      if (
        parsed.data.display_on_calendar_id !== undefined &&
        parsed.data.display_on_calendar_id !== null &&
        !managedCalendarIds.includes(parsed.data.display_on_calendar_id)
      ) {
        return NextResponse.json(
          { error: 'You can only move resources to calendars assigned to your account.' },
          { status: 403 },
        );
      }
    }

    const ex = existing as Record<string, unknown>;
    const mergedPaymentRequirement = (parsed.data.payment_requirement ?? ex.payment_requirement) as string;
    const mergedDeposit =
      parsed.data.deposit_amount_pence !== undefined ? parsed.data.deposit_amount_pence : (ex.deposit_amount_pence as number | null);
    const mergedPrice =
      parsed.data.price_per_slot_pence !== undefined ? parsed.data.price_per_slot_pence : (ex.price_per_slot_pence as number | null);
    const mergedSlot =
      parsed.data.slot_interval_minutes ??
      (ex.slot_interval_minutes as number) ??
      DEFAULT_RESOURCE_SLOT_INTERVAL_MINUTES;
    const mergedMax = parsed.data.max_booking_minutes ?? (ex.max_booking_minutes as number) ?? 180;
    const mergedMin =
      parsed.data.min_booking_minutes ??
      (ex.min_booking_minutes as number) ??
      DEFAULT_RESOURCE_MIN_BOOKING_MINUTES;

    const rangeErr = bookingLengthRangeError(mergedMin, mergedMax);
    if (rangeErr) {
      return NextResponse.json({ error: rangeErr }, { status: 400 });
    }

    const paymentErr = validateResourcePaymentFields({
      payment_requirement: mergedPaymentRequirement,
      deposit_amount_pence: mergedDeposit,
      price_per_slot_pence: mergedPrice,
      slot_interval_minutes: mergedSlot,
      max_booking_minutes: mergedMax,
    });
    if (paymentErr) {
      return NextResponse.json({ error: paymentErr }, { status: 400 });
    }

    const updatePayload: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updatePayload.name = parsed.data.name;
    if (parsed.data.resource_type !== undefined) updatePayload.resource_type = parsed.data.resource_type;
    if (parsed.data.description !== undefined) updatePayload.description = parsed.data.description;
    if (parsed.data.photo_url !== undefined) updatePayload.photo_url = parsed.data.photo_url;
    if (parsed.data.availability_hours !== undefined) updatePayload.working_hours = parsed.data.availability_hours;
    if (parsed.data.availability_exceptions !== undefined) updatePayload.availability_exceptions = parsed.data.availability_exceptions;
    if (parsed.data.slot_interval_minutes !== undefined) updatePayload.slot_interval_minutes = parsed.data.slot_interval_minutes;
    if (parsed.data.min_booking_minutes !== undefined) updatePayload.min_booking_minutes = parsed.data.min_booking_minutes;
    if (parsed.data.max_booking_minutes !== undefined) updatePayload.max_booking_minutes = parsed.data.max_booking_minutes;
    if (parsed.data.price_per_slot_pence !== undefined) updatePayload.price_per_slot_pence = parsed.data.price_per_slot_pence;
    if (parsed.data.payment_requirement !== undefined) updatePayload.payment_requirement = parsed.data.payment_requirement;
    if (parsed.data.deposit_amount_pence !== undefined) updatePayload.deposit_amount_pence = parsed.data.deposit_amount_pence;
    if (parsed.data.is_active !== undefined) updatePayload.is_active = parsed.data.is_active;
    if (parsed.data.sort_order !== undefined) updatePayload.sort_order = parsed.data.sort_order;
    if (parsed.data.max_advance_booking_days !== undefined) {
      updatePayload.max_advance_booking_days = parsed.data.max_advance_booking_days;
    }
    if (parsed.data.min_booking_notice_hours !== undefined) {
      updatePayload.min_booking_notice_hours = parsed.data.min_booking_notice_hours;
    }
    if (parsed.data.cancellation_notice_hours !== undefined) {
      updatePayload.cancellation_notice_hours = parsed.data.cancellation_notice_hours;
    }
    if (parsed.data.allow_same_day_booking !== undefined) {
      updatePayload.allow_same_day_booking = parsed.data.allow_same_day_booking;
    }

    if (parsed.data.payment_requirement === 'full_payment' || parsed.data.payment_requirement === 'none') {
      updatePayload.deposit_amount_pence = null;
    }

    const mergedDisplayOn =
      parsed.data.display_on_calendar_id !== undefined
        ? parsed.data.display_on_calendar_id
        : ((ex.display_on_calendar_id as string | null) ?? null);
    const mergedHours = (parsed.data.availability_hours ?? ex.working_hours ?? {}) as WorkingHours;
    if (mergedDisplayOn) {
      const displayCheck = await assertResourceDisplayOnCalendarValid(
        admin,
        staff.venue_id,
        mergedDisplayOn,
        mergedHours,
        id as string,
      );
      if (!displayCheck.ok) {
        return NextResponse.json({ error: displayCheck.message }, { status: 409 });
      }
    }
    if (parsed.data.display_on_calendar_id !== undefined) {
      updatePayload.display_on_calendar_id = parsed.data.display_on_calendar_id;
    }

    const patchPayload: Record<string, unknown> = { ...updatePayload };
    const MAX_PATCH_RETRY = 6;
    let data: Record<string, unknown> | null = null;
    let error: { message: string } | null = null;
    for (let attempt = 0; attempt < MAX_PATCH_RETRY; attempt++) {
      if (Object.keys(patchPayload).length === 0) {
        const payload = await mapUnifiedCalendarToResourceWithAvailabilityWarning(
          admin,
          staff.venue_id,
          existing as Record<string, unknown>,
          mergedHours,
          mergedDisplayOn,
        );
        return NextResponse.json(payload);
      }
      const res = await admin
        .from('unified_calendars')
        .update(patchPayload)
        .eq('id', id)
        .eq('venue_id', staff.venue_id)
        .eq('calendar_type', 'resource')
        .select()
        .single();
      data = (res.data as Record<string, unknown> | null) ?? null;
      error = res.error;
      if (!error) break;
      const col = parseMissingUnifiedCalendarsColumn(error.message ?? '');
      if (!col || !OPTIONAL_UNIFIED_CALENDAR_MIGRATION_COLUMNS.has(col)) break;
      console.warn(
        `PATCH /api/venue/resources: omitting migration column(s) after "${col}" not in schema. Apply 20260503120000_unified_calendars_resource_payment.sql and 20260504120000_resource_display_on_calendar.sql`,
      );
      stripOptionalMigrationColumn(patchPayload, col);
    }

    if (error) {
      console.error('PATCH /api/venue/resources failed:', error);
      return NextResponse.json(
        { error: 'Failed to update resource', details: error.message },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json({ error: 'Failed to update resource' }, { status: 500 });
    }

    const payload = await mapUnifiedCalendarToResourceWithAvailabilityWarning(
      admin,
      staff.venue_id,
      data as Record<string, unknown>,
      (data.working_hours ?? {}) as WorkingHours,
      (data.display_on_calendar_id as string | null | undefined) ?? null,
    );
    return NextResponse.json(payload);
  } catch (err) {
    console.error('PATCH /api/venue/resources failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE /api/venue/resources - delete a resource (admin, or staff if resource is on a calendar they manage). */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const admin = getSupabaseAdminClient();
    const modelGate = await requireVenueExposesSecondaryModel(admin, staff.venue_id, 'resource_booking');
    if (!modelGate.ok) return modelGate.response;

    const { data: row, error: fetchErr } = await admin
      .from('unified_calendars')
      .select('id, display_on_calendar_id')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .eq('calendar_type', 'resource')
      .maybeSingle();

    if (fetchErr) {
      console.error('DELETE /api/venue/resources lookup:', fetchErr);
      return NextResponse.json(
        { error: 'Could not verify the resource. Please try again.' },
        { status: 500 },
      );
    }
    if (!row) {
      return NextResponse.json(
        { error: buildEntityNotFoundMessage('resource') },
        { status: 404 },
      );
    }

    if (staff.role !== 'admin') {
      const displayOn = (row as { display_on_calendar_id: string | null }).display_on_calendar_id;
      if (!displayOn) {
        return NextResponse.json(
          {
            error:
              'Only venue admins can delete resources that are not assigned to a calendar column. Ask an admin to assign this resource or delete it.',
          },
          { status: 403 },
        );
      }
      const access = await requireManagedCalendarAccess(
        admin,
        staff.venue_id,
        staff,
        displayOn,
        'You can only delete resources on calendars assigned to your account.',
      );
      if (!access.ok) {
        return NextResponse.json({ error: access.error }, { status: 403 });
      }
    }

    const bookingGuard = await hasUpcomingActiveBookingsForVenueResource(admin, staff.venue_id, id);
    if (bookingGuard.error) {
      return NextResponse.json({ error: bookingGuard.error }, { status: 500 });
    }
    if (bookingGuard.blocked) {
      return NextResponse.json(
        {
          error: buildUpcomingBookingsBlockMessage('resource', bookingGuard.bookingCount),
          booking_count: bookingGuard.bookingCount,
        },
        { status: 409 },
      );
    }

    const { error } = await admin
      .from('unified_calendars')
      .delete()
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .eq('calendar_type', 'resource');

    if (error) {
      console.error('DELETE /api/venue/resources failed:', error);
      return NextResponse.json(
        { error: 'Failed to delete the resource. Please try again.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/venue/resources failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
