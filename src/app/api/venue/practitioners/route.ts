import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { VENUE_CATALOG_CACHE_CONTROL } from '@/lib/realtime/dashboard-sync-constants';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import {
  getVenueStaff,
  requireAdmin,
  getStaffManagedCalendarIds,
  requireManagedCalendarAccess,
  OUTSIDE_ASSIGNED_CALENDARS_ERROR,
} from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getVenueLocalDateAndMinutes } from '@/lib/venue/venue-local-clock';
import {
  describeHoursChangeOrphans,
  findBookingsOrphanedByHoursChange,
  calendarWorkingMinutesForDate,
} from '@/lib/calendar/hours-change-orphans';
import { checkCalendarLimit, isAppointmentPlanTier } from '@/lib/tier-enforcement';
import { defaultNewUnifiedCalendarWorkingHours } from '@/lib/availability/practitioner-defaults';
import { venueUsesUnifiedAppointmentServiceData } from '@/lib/booking/uses-unified-appointment-data';
import { resolveLinkedStaffCatalogScope } from '@/lib/booking/staff-booking-access';
import { ensureUnifiedMirrorForPractitionerId } from '@/lib/class-instances/instructor-calendar-block';
import { planDisplayName } from '@/lib/pricing-constants';
import { z } from 'zod';

/** Map unified_calendars rows to the practitioner shape expected by dashboard + booking UI. */
function unifiedCalendarToPractitionerRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: row.id,
    venue_id: row.venue_id,
    staff_id: row.staff_id ?? null,
    name: row.name,
    email: null,
    phone: null,
    slug: row.slug ?? null,
    working_hours: row.working_hours ?? {},
    break_times: row.break_times ?? [],
    break_times_by_day: row.break_times_by_day ?? null,
    days_off: row.days_off ?? [],
    is_active: row.is_active,
    sort_order: row.sort_order ?? 0,
    created_at: row.created_at,
    photo_url: row.photo_url ?? null,
    colour: row.colour ?? null,
    calendar_type: row.calendar_type,
  };
}

interface VenueCalendarMode {
  bookingModel: string;
  pricingTier: string | null;
}

async function getVenueBookingModel(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
): Promise<string> {
  const { data } = await admin.from('venues').select('booking_model').eq('id', venueId).maybeSingle();
  return ((data as { booking_model?: string } | null)?.booking_model as string) ?? '';
}

async function getVenueCalendarMode(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
): Promise<VenueCalendarMode> {
  const { data } = await admin
    .from('venues')
    .select('booking_model, pricing_tier')
    .eq('id', venueId)
    .maybeSingle();
  return {
    bookingModel: ((data as { booking_model?: string } | null)?.booking_model as string) ?? '',
    pricingTier: ((data as { pricing_tier?: string | null } | null)?.pricing_tier as string | null) ?? null,
  };
}

/**
 * True when calendar columns are read from `unified_calendars` (must match GET /api/venue/practitioners).
 * Classes/events and USE share the same UUID space; `booking_model` alone is not enough.
 */
async function checkVenueUsesUnifiedCalendarList(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
  bookingModel: string,
  pricingTier?: string | null,
): Promise<boolean> {
  if (bookingModel === 'unified_scheduling') return true;
  if (isAppointmentPlanTier(pricingTier)) return true;
  const tier =
    pricingTier === undefined
      ? (await getVenueCalendarMode(admin, venueId)).pricingTier
      : pricingTier;
  if (isAppointmentPlanTier(tier)) return true;
  const { count } = await admin
    .from('unified_calendars')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId);
  return (count ?? 0) > 0;
}

async function mirrorLegacyPractitionersToUnifiedCalendars(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
): Promise<void> {
  const { data: legacyRows, error } = await admin
    .from('practitioners')
    .select('id, name, staff_id, slug, working_hours, break_times, break_times_by_day, days_off, sort_order, is_active')
    .eq('venue_id', venueId)
    .order('sort_order', { ascending: true });
  if (error) {
    console.error('mirrorLegacyPractitionersToUnifiedCalendars failed:', error);
    return;
  }
  for (const row of legacyRows ?? []) {
    await ensureUnifiedMirrorForPractitionerId(admin, venueId, row as {
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
  }
}

/** Booking link slug uniqueness: `unified_calendars` when that table is the column source of truth, else `practitioners`. */
async function isPractitionerSlugTaken(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
  slug: string,
  excludePractitionerId?: string,
  bookingModel?: string,
): Promise<boolean> {
  const useUnified = await checkVenueUsesUnifiedCalendarList(admin, venueId, bookingModel ?? '');
  if (useUnified) {
    let q = admin.from('unified_calendars').select('id').eq('venue_id', venueId).eq('slug', slug).limit(1);
    if (excludePractitionerId) {
      q = q.neq('id', excludePractitionerId);
    }
    const { data } = await q.maybeSingle();
    return Boolean(data);
  }
  let q = admin.from('practitioners').select('id').eq('venue_id', venueId).eq('slug', slug).limit(1);
  if (excludePractitionerId) {
    q = q.neq('id', excludePractitionerId);
  }
  const { data } = await q.maybeSingle();
  return Boolean(data);
}

function normalisePractitionerSlugInput(
  raw: string | null | undefined,
): { ok: true; value: string | null | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: true, value: null };
  const t = raw.trim().toLowerCase();
  if (t === '') return { ok: true, value: null };
  if (t.length > 64) return { ok: false, error: 'Booking link must be 64 characters or fewer.' };
  if (!/^[a-z0-9-]+$/.test(t)) {
    return { ok: false, error: 'Booking link may only use lowercase letters, numbers, and hyphens.' };
  }
  return { ok: true, value: t };
}

const optionalEmail = z.preprocess(
  (val) => (val === '' || val === null || val === undefined ? undefined : val),
  z.string().email().optional(),
);

const timeRangeArraySchema = z.array(z.object({ start: z.string(), end: z.string() }));

const practitionerSchema = z.object({
  name: z.string().min(1).max(200),
  email: optionalEmail,
  phone: z.string().max(24).optional().or(z.literal('')),
  /** Public URL segment: /book/{venue-slug}/{slug} - lowercase, numbers, hyphens; empty clears */
  slug: z.string().max(64).nullable().optional(),
  working_hours: z.record(z.string(), timeRangeArraySchema).optional(),
  break_times: z.array(z.object({ start: z.string(), end: z.string() })).optional(),
  /** Non-null object = per-weekday breaks; null clears to “same every day” mode (uses break_times). */
  break_times_by_day: z.record(z.string(), timeRangeArraySchema).nullable().optional(),
  days_off: z.array(z.string()).optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  staff_id: z.string().uuid().optional(),
});

/**
 * GET /api/venue/practitioners - list practitioners for the venue.
 * Non-admin staff normally receive only their linked practitioner row (settings / availability).
 * Pass `?roster=1` for the full venue roster (read-only) - used by appointments list and calendar
 * so staff can filter by colleague while other flows stay scoped.
 * Pass `?active_only=1` to return only active calendars/practitioners (staff new-booking pickers).
 * Pass `?staff_assignable=1` for Settings → Staff: active practitioner/class columns only (excludes
 * resource calendars e.g. courts/rooms — those are not staff-managed bookable columns).
 * Omit it for admin flows that must list inactive rows (e.g. availability settings).
 */
const OWNER_VENUE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  try {
    // Bearer (mobile) + cookie (web) auth — see createVenueRouteClient.
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const roster = request.nextUrl.searchParams.get('roster') === '1';
    const activeOnly = request.nextUrl.searchParams.get('active_only') === '1';
    const staffAssignable = request.nextUrl.searchParams.get('staff_assignable') === '1';

    const admin = getSupabaseAdminClient();
    const ownerVenueParam = request.nextUrl.searchParams.get('owner_venue_id');
    const scope = await resolveLinkedStaffCatalogScope(
      admin,
      staff.venue_id,
      ownerVenueParam && OWNER_VENUE_UUID_RE.test(ownerVenueParam) ? ownerVenueParam : null,
    );
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }
    const catalogVenueId = scope.venueId;

    const venueMode = await getVenueCalendarMode(admin, catalogVenueId);
    const bookingModel = venueMode.bookingModel;

    /** Experience events, classes, etc. use `unified_calendars.id`. Prefer UC list whenever rows exist (mirrors share practitioner ids). */
    const useUnifiedCalendarList = await checkVenueUsesUnifiedCalendarList(
      admin,
      catalogVenueId,
      bookingModel,
      venueMode.pricingTier,
    );

    if (useUnifiedCalendarList) {
      let { data, error } = await admin
        .from('unified_calendars')
        .select('*')
        .eq('venue_id', catalogVenueId)
        .order('sort_order', { ascending: true });

      if (error) {
        console.error('GET /api/venue/practitioners (unified_calendars) failed:', error);
        return NextResponse.json({ error: 'Failed to fetch practitioners' }, { status: 500 });
      }

      if ((data ?? []).length === 0 && isAppointmentPlanTier(venueMode.pricingTier)) {
        await mirrorLegacyPractitionersToUnifiedCalendars(admin, catalogVenueId);
        const retry = await admin
          .from('unified_calendars')
          .select('*')
          .eq('venue_id', catalogVenueId)
          .order('sort_order', { ascending: true });
        data = retry.data;
        error = retry.error;
        if (error) {
          console.error('GET /api/venue/practitioners (unified_calendars retry) failed:', error);
          return NextResponse.json({ error: 'Failed to fetch practitioners' }, { status: 500 });
        }
      }

      const { data: assignRows, error: assignErr } = await admin
        .from('staff_calendar_assignments')
        .select('calendar_id, staff_id')
        .eq('venue_id', catalogVenueId);

      if (assignErr) {
        console.error(
          'GET /api/venue/practitioners: staff_calendar_assignments query failed (run migration 20260507120000 if missing):',
          assignErr.message,
        );
      }

      const staffIdsByCalendar = new Map<string, string[]>();
      for (const ar of assignRows ?? []) {
        const cid = ar.calendar_id as string;
        const sid = ar.staff_id as string;
        const cur = staffIdsByCalendar.get(cid);
        if (cur) cur.push(sid);
        else staffIdsByCalendar.set(cid, [sid]);
      }

      let list = (data ?? []).map((r) => {
        const row = r as { id: string; staff_id?: string | null };
        const fromJunction = staffIdsByCalendar.get(row.id) ?? [];
        const legacy = row.staff_id ? [row.staff_id] : [];
        const mergedStaffIds = [...new Set([...fromJunction, ...legacy])];
        const base = unifiedCalendarToPractitionerRow(r as Record<string, unknown>) as Record<string, unknown>;
        return {
          ...base,
          staff_ids: mergedStaffIds,
          staff_id: (mergedStaffIds[0] ?? base.staff_id ?? null) as string | null,
        };
      });
      if (staff.role !== 'admin' && !roster) {
        const linkedIds = await getStaffManagedCalendarIds(admin, staff.venue_id, staff.id);
        list =
          linkedIds.length > 0
            ? list.filter((p) => linkedIds.includes(String((p as Record<string, unknown>).id)))
            : [];
      }
      if (staffAssignable) {
        list = list.filter((p) => {
          const row = p as { is_active?: boolean; calendar_type?: string | null };
          return (
            row.is_active === true && (row.calendar_type ?? 'practitioner') !== 'resource'
          );
        });
      } else if (activeOnly) {
        list = list.filter((p) => (p as { is_active?: boolean }).is_active === true);
      }
      return NextResponse.json(
        { practitioners: list },
        roster ? { headers: { 'Cache-Control': VENUE_CATALOG_CACHE_CONTROL } } : undefined,
      );
    }

    const { data, error } = await admin
      .from('practitioners')
      .select('*')
      .eq('venue_id', catalogVenueId)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('GET /api/venue/practitioners failed:', error);
      return NextResponse.json({ error: 'Failed to fetch practitioners' }, { status: 500 });
    }

    let list = data ?? [];
    if (staff.role !== 'admin' && !roster) {
      list = list.filter((p) => p.staff_id === staff.id);
    }
    if (staffAssignable) {
      list = list.filter((p) => p.is_active === true);
    } else if (activeOnly) {
      list = list.filter((p) => p.is_active === true);
    }

    return NextResponse.json(
      { practitioners: list },
      roster ? { headers: { 'Cache-Control': VENUE_CATALOG_CACHE_CONTROL } } : undefined,
    );
  } catch (err) {
    console.error('GET /api/venue/practitioners failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/venue/practitioners - create a new practitioner (admin only). */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

    const body = await request.json();
    const parsed = practitionerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const limitCheck = await checkCalendarLimit(staff.venue_id, 'practitioners');
    if (!limitCheck.allowed) {
      const { data: venue } = await admin
        .from('venues')
        .select('pricing_tier')
        .eq('id', staff.venue_id)
        .maybeSingle();
      const planName = planDisplayName((venue as { pricing_tier?: string | null } | null)?.pricing_tier);
      const limit = limitCheck.limit ?? 0;
      const calendarLabel = `bookable calendar${limit === 1 ? '' : 's'}`;
      return NextResponse.json(
        {
          error:
            `Your ${planName} plan includes up to ${limit} ${calendarLabel}. ` +
            'Deactivate an existing calendar or upgrade under Settings > Plan to add more.',
          current: limitCheck.current,
          limit: limitCheck.limit,
          upgrade_required: true,
        },
        { status: 403 }
      );
    }

    const venueMode = await getVenueCalendarMode(admin, staff.venue_id);
    const bookingModel = venueMode.bookingModel;
    const useUnifiedListForCreate = await checkVenueUsesUnifiedCalendarList(
      admin,
      staff.venue_id,
      bookingModel,
      venueMode.pricingTier,
    );
    const { slug: rawSlug, ...createRest } = parsed.data;
    const slugNorm = normalisePractitionerSlugInput(rawSlug);
    if (!slugNorm.ok) {
      return NextResponse.json({ error: slugNorm.error }, { status: 400 });
    }
    if (slugNorm.value) {
      const taken = await isPractitionerSlugTaken(
        admin,
        staff.venue_id,
        slugNorm.value,
        undefined,
        bookingModel,
      );
      if (taken) {
        return NextResponse.json(
          { error: 'That booking link is already used for another calendar at your venue.' },
          { status: 409 },
        );
      }
    }

    const insertRow: Record<string, unknown> = {
      venue_id: staff.venue_id,
      ...createRest,
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
      working_hours: parsed.data.working_hours ?? {},
      break_times: parsed.data.break_times ?? [],
      days_off: parsed.data.days_off ?? [],
    };
    if (slugNorm.value !== undefined) {
      insertRow.slug = slugNorm.value;
    }

    if (useUnifiedListForCreate) {
      const calendarId = randomUUID();
      const initialWorkingHours =
        parsed.data.working_hours !== undefined &&
        parsed.data.working_hours !== null &&
        typeof parsed.data.working_hours === 'object' &&
        Object.keys(parsed.data.working_hours).length > 0
          ? parsed.data.working_hours
          : defaultNewUnifiedCalendarWorkingHours();
      const { data: ucRow, error: ucErr } = await admin
        .from('unified_calendars')
        .insert({
          id: calendarId,
          venue_id: staff.venue_id,
          name: parsed.data.name,
          staff_id: null,
          slug: slugNorm.value ?? null,
          working_hours: initialWorkingHours,
          break_times: parsed.data.break_times ?? [],
          break_times_by_day: parsed.data.break_times_by_day ?? null,
          days_off: parsed.data.days_off ?? [],
          sort_order: parsed.data.sort_order ?? 0,
          is_active: parsed.data.is_active ?? true,
          colour: '#3B82F6',
          calendar_type: 'practitioner',
        })
        .select()
        .single();
      if (ucErr) {
        console.error('POST /api/venue/practitioners unified_calendars failed:', ucErr);
        if (ucErr.code === '23505') {
          return NextResponse.json(
            { error: 'That booking link is already used for another calendar at your venue.' },
            { status: 409 },
          );
        }
        return NextResponse.json({ error: 'Failed to create calendar' }, { status: 500 });
      }

      if (parsed.data.staff_id) {
        const { error: assignErr } = await admin.from('staff_calendar_assignments').insert({
          venue_id: staff.venue_id,
          staff_id: parsed.data.staff_id,
          calendar_id: calendarId,
        });
        if (assignErr) {
          console.error('POST /api/venue/practitioners staff_calendar_assignments failed:', assignErr);
        }
      }

      return NextResponse.json(unifiedCalendarToPractitionerRow(ucRow as Record<string, unknown>), { status: 201 });
    }

    const { data, error } = await admin.from('practitioners').insert(insertRow).select().single();

    if (error) {
      console.error('POST /api/venue/practitioners failed:', error);
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'That booking link is already used for another calendar at your venue.' },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: 'Failed to create practitioner' }, { status: 500 });
    }

    const useUnifiedServices = await venueUsesUnifiedAppointmentServiceData(admin, staff.venue_id);
    if (useUnifiedServices && data) {
      const prRow = data as Record<string, unknown>;
      const mirrored = await ensureUnifiedMirrorForPractitionerId(admin, staff.venue_id, {
        id: prRow.id as string,
        name: String(prRow.name ?? ''),
        staff_id: (prRow.staff_id as string | null | undefined) ?? null,
        slug: (prRow.slug as string | null | undefined) ?? null,
        working_hours: prRow.working_hours,
        break_times: prRow.break_times,
        break_times_by_day: prRow.break_times_by_day,
        days_off: prRow.days_off,
        sort_order: typeof prRow.sort_order === 'number' ? prRow.sort_order : undefined,
        is_active: prRow.is_active !== false,
      });
      if (!mirrored) {
        await admin.from('practitioners').delete().eq('id', prRow.id).eq('venue_id', staff.venue_id);
        return NextResponse.json(
          { error: 'Could not create calendar for service links. Please try again or contact support.' },
          { status: 500 },
        );
      }
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error('POST /api/venue/practitioners failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

const staffBreaksOnlySchema = z.object({
  break_times: practitionerSchema.shape.break_times.optional(),
  break_times_by_day: practitionerSchema.shape.break_times_by_day.optional(),
});

/** PATCH /api/venue/practitioners - admin: any field; staff: only breaks for their linked practitioner row. */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const body = await request.json();
    const { id, ...rest } = body;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const admin = getSupabaseAdminClient();

    // Narrowing a calendar's working hours can leave existing upcoming bookings outside the
    // new hours. Warn (don't block) unless the caller acknowledged the affected bookings.
    if (
      rest.working_hours !== undefined &&
      rest.working_hours !== null &&
      typeof rest.working_hours === 'object' &&
      !Array.isArray(rest.working_hours) &&
      request.nextUrl.searchParams.get('acknowledge_affected_bookings') !== 'true'
    ) {
      let found = false;
      let oldWorking: Record<string, Array<{ start: string; end: string }>> = {};
      let calName: string | null = null;
      const { data: pracRow } = await admin
        .from('practitioners')
        .select('working_hours, name')
        .eq('id', id)
        .eq('venue_id', staff.venue_id)
        .maybeSingle();
      if (pracRow) {
        found = true;
        oldWorking = (pracRow.working_hours as Record<string, Array<{ start: string; end: string }>>) ?? {};
        calName = (pracRow.name as string | null) ?? null;
      } else {
        const { data: ucRow } = await admin
          .from('unified_calendars')
          .select('working_hours, name')
          .eq('id', id)
          .eq('venue_id', staff.venue_id)
          .maybeSingle();
        if (ucRow) {
          found = true;
          oldWorking = (ucRow.working_hours as Record<string, Array<{ start: string; end: string }>>) ?? {};
          calName = (ucRow.name as string | null) ?? null;
        }
      }
      if (found) {
        if (staff.role !== 'admin') {
          const access = await requireManagedCalendarAccess(
            admin,
            staff.venue_id,
            staff,
            id,
            OUTSIDE_ASSIGNED_CALENDARS_ERROR,
          );
          if (!access.ok) {
            return NextResponse.json({ error: access.error }, { status: 403 });
          }
        }
        try {
          const { data: venueRow } = await admin
            .from('venues')
            .select('timezone')
            .eq('id', staff.venue_id)
            .single();
          const tz =
            typeof venueRow?.timezone === 'string' && venueRow.timezone.trim()
              ? venueRow.timezone.trim()
              : 'Europe/London';
          const fromDate = getVenueLocalDateAndMinutes(tz, new Date()).dateYmd;
          const orphans = await findBookingsOrphanedByHoursChange(admin, {
            venueId: staff.venue_id,
            fromDate,
            calendarColumnId: id,
            oldPeriodsForDate: calendarWorkingMinutesForDate(oldWorking),
            newPeriodsForDate: calendarWorkingMinutesForDate(
              rest.working_hours as Record<string, Array<{ start: string; end: string }>>,
            ),
          });
          if (orphans.total > 0) {
            return NextResponse.json(
              {
                requires_confirmation: true,
                affected_count: orphans.total,
                affected_bookings: orphans.sample,
                message: describeHoursChangeOrphans(orphans, { scope: 'calendar', calendarName: calName }),
              },
              { status: 409 },
            );
          }
        } catch (e) {
          console.error('PATCH /api/venue/practitioners orphan check:', e);
          return NextResponse.json(
            { error: 'Could not verify existing bookings. Please try again.' },
            { status: 500 },
          );
        }
      }
    }

    if (staff.role !== 'admin') {
      const keys = Object.keys(rest);
      if (keys.length === 0) {
        return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
      }
      const allowed = new Set(['break_times', 'break_times_by_day', 'working_hours']);
      if (keys.some((k) => !allowed.has(k))) {
        return NextResponse.json(
          { error: 'You can only update your own working hours and breaks. Ask an admin for other changes.' },
          { status: 403 },
        );
      }

      const parsed = staffBreaksOnlySchema
        .extend({ working_hours: practitionerSchema.shape.working_hours.optional() })
        .safeParse(rest);
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
      }

      const bookingModelStaff = await getVenueBookingModel(admin, staff.venue_id);
      const useUnifiedStaffList = await checkVenueUsesUnifiedCalendarList(
        admin,
        staff.venue_id,
        bookingModelStaff,
      );

      if (useUnifiedStaffList) {
        const { data: cal, error: calErr } = await admin
          .from('unified_calendars')
          .select('id')
          .eq('id', id)
          .eq('venue_id', staff.venue_id)
          .maybeSingle();

        if (calErr || !cal) {
          return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
        }
        const access = await requireManagedCalendarAccess(admin, staff.venue_id, staff, id, OUTSIDE_ASSIGNED_CALENDARS_ERROR);
        if (!access.ok) {
          return NextResponse.json({ error: access.error }, { status: 403 });
        }

        const { data, error } = await admin
          .from('unified_calendars')
          .update(parsed.data)
          .eq('id', id)
          .eq('venue_id', staff.venue_id)
          .select()
          .single();

        if (error) {
          console.error('PATCH /api/venue/practitioners (staff schedule, unified) failed:', error);
          return NextResponse.json({ error: 'Failed to update schedule' }, { status: 500 });
        }

        return NextResponse.json(unifiedCalendarToPractitionerRow(data as Record<string, unknown>));
      }

      const { data: prac, error: pracErr } = await admin
        .from('practitioners')
        .select('id, staff_id')
        .eq('id', id)
        .eq('venue_id', staff.venue_id)
        .maybeSingle();

      if (pracErr || !prac) {
        return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
      }
      const access = await requireManagedCalendarAccess(
        admin,
        staff.venue_id,
        staff,
        prac.id,
        'You can only edit the calendar linked to your account.',
      );
      if (!access.ok) {
        return NextResponse.json({ error: access.error }, { status: 403 });
      }

      const { data, error } = await admin
        .from('practitioners')
        .update(parsed.data)
        .eq('id', id)
        .eq('venue_id', staff.venue_id)
        .select()
        .single();

      if (error) {
        console.error('PATCH /api/venue/practitioners (staff schedule) failed:', error);
        return NextResponse.json({ error: 'Failed to update schedule' }, { status: 500 });
      }

      return NextResponse.json(data);
    }

    const parsed = practitionerSchema.partial().safeParse(rest);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const bookingModel = await getVenueBookingModel(admin, staff.venue_id);
    const useUnifiedAdminList = await checkVenueUsesUnifiedCalendarList(admin, staff.venue_id, bookingModel);

    const updatePayload: Record<string, unknown> = { ...parsed.data };
    if (Object.prototype.hasOwnProperty.call(parsed.data, 'slug')) {
      const slugNorm = normalisePractitionerSlugInput(parsed.data.slug);
      if (!slugNorm.ok) {
        return NextResponse.json({ error: slugNorm.error }, { status: 400 });
      }
      if (slugNorm.value) {
        const taken = await isPractitionerSlugTaken(
          admin,
          staff.venue_id,
          slugNorm.value,
          id,
          bookingModel,
        );
        if (taken) {
          return NextResponse.json(
            { error: 'That booking link is already used for another calendar at your venue.' },
            { status: 409 },
          );
        }
      }
      updatePayload.slug = slugNorm.value === undefined ? undefined : slugNorm.value;
    }

    if (useUnifiedAdminList) {
      const ucPayload: Record<string, unknown> = {};
      const ucKeys = [
        'name',
        'slug',
        'working_hours',
        'break_times',
        'break_times_by_day',
        'days_off',
        'sort_order',
        'is_active',
      ] as const;
      for (const k of ucKeys) {
        if (Object.prototype.hasOwnProperty.call(updatePayload, k)) {
          ucPayload[k] = updatePayload[k];
        }
      }
      const { data: ucData, error: ucErr } = await admin
        .from('unified_calendars')
        .update(ucPayload)
        .eq('id', id)
        .eq('venue_id', staff.venue_id)
        .select()
        .single();

      if (ucErr) {
        console.error('PATCH /api/venue/practitioners (admin unified) failed:', ucErr);
        if (ucErr.code === '23505') {
          return NextResponse.json(
            { error: 'That booking link is already used for another calendar at your venue.' },
            { status: 409 },
          );
        }
        return NextResponse.json({ error: 'Failed to update calendar' }, { status: 500 });
      }

      return NextResponse.json(unifiedCalendarToPractitionerRow(ucData as Record<string, unknown>));
    }

    const { data, error } = await admin
      .from('practitioners')
      .update(updatePayload)
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .select()
      .single();

    if (error) {
      console.error('PATCH /api/venue/practitioners failed:', error);
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'That booking link is already used for another calendar at your venue.' },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: 'Failed to update practitioner' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error('PATCH /api/venue/practitioners failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE /api/venue/practitioners - delete a practitioner (admin only). */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const admin = getSupabaseAdminClient();
    const bookingModel = await getVenueBookingModel(admin, staff.venue_id);
    const useUnifiedList = await checkVenueUsesUnifiedCalendarList(admin, staff.venue_id, bookingModel);

    if (useUnifiedList) {
      const { data: ucRow, error: ucFetchErr } = await admin
        .from('unified_calendars')
        .select('id, calendar_type')
        .eq('id', id)
        .eq('venue_id', staff.venue_id)
        .maybeSingle();

      if (ucFetchErr) {
        console.error('DELETE /api/venue/practitioners unified row lookup failed:', ucFetchErr);
        return NextResponse.json({ error: 'Failed to verify calendar' }, { status: 500 });
      }
      if (!ucRow) {
        return NextResponse.json({ error: 'Calendar not found' }, { status: 404 });
      }
      if ((ucRow as { calendar_type?: string | null }).calendar_type === 'resource') {
        return NextResponse.json(
          { error: 'Resource calendars are removed from Resource settings, not here.' },
          { status: 400 },
        );
      }

      const { count: teamCount, error: countErr } = await admin
        .from('unified_calendars')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', staff.venue_id)
        .neq('calendar_type', 'resource');

      if (countErr) {
        console.error('DELETE /api/venue/practitioners (unified team count) failed:', countErr);
        return NextResponse.json({ error: 'Failed to verify calendars' }, { status: 500 });
      }
      if ((teamCount ?? 0) <= 1) {
        return NextResponse.json(
          { error: 'You must keep at least one team calendar column for scheduling.' },
          { status: 400 },
        );
      }

      const { error: delUc } = await admin
        .from('unified_calendars')
        .delete()
        .eq('id', id)
        .eq('venue_id', staff.venue_id);
      if (delUc) {
        console.error('DELETE /api/venue/practitioners unified_calendars failed:', delUc);
        return NextResponse.json({ error: 'Failed to delete calendar' }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    const { count: calendarCount, error: countErr } = await admin
      .from('practitioners')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', staff.venue_id);

    if (countErr) {
      console.error('DELETE /api/venue/practitioners count failed:', countErr);
      return NextResponse.json({ error: 'Failed to verify calendars' }, { status: 500 });
    }
    if ((calendarCount ?? 0) <= 1) {
      return NextResponse.json(
        { error: 'You must keep at least one bookable calendar for appointment bookings.' },
        { status: 400 },
      );
    }

    const { error } = await admin
      .from('practitioners')
      .delete()
      .eq('id', id)
      .eq('venue_id', staff.venue_id);

    if (error) {
      console.error('DELETE /api/venue/practitioners failed:', error);
      return NextResponse.json({ error: 'Failed to delete practitioner' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/venue/practitioners failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
