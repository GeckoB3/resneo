import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getSupabaseAdminClient } from '@/lib/supabase';
import {
  getVenueStaff,
  requireAdmin,
  requireManagedCalendarAccess,
  requireManagedCalendarIds,
  type VenueStaff,
} from '@/lib/venue-auth';
import { listActiveHostCalendarIds, requireVenueHostCalendarId } from '@/lib/venue-calendar-resolve';
import { getVenueLocalDateAndMinutes } from '@/lib/venue/venue-local-clock';
import { calendarHours, type CalendarScheduleRow } from '@/lib/availability/calendar-hours';
import {
  AMENDED_HOURS_MAX_DATES,
  AMENDED_HOURS_MAX_REASON_LENGTH,
  amendedHoursEntries,
  applyAmendedHours,
  enumerateDatesInclusive,
  firstFullDayLeaveDate,
  hoursOverrideMirrorRows,
  normaliseHoursPeriods,
  readOverrideMap,
  removeDateOverrides,
  type DateOverrideMap,
} from '@/lib/availability/calendar-amended-hours';
import { mirrorCalendarHoursOverrides } from '@/lib/availability/calendar-date-overrides-mirror';
import { describeHoursChangeOrphans, findBookingsOrphanedByHoursChange } from '@/lib/calendar/hours-change-orphans';

/**
 * Amended hours for one calendar: "on these dates this calendar works these hours".
 *
 * Writes `unified_calendars.availability_exceptions`, the per-date map `calendarHours`
 * already reads first, so every engine and the diary honour a save with no further wiring.
 * A dedicated route rather than more keys on `PATCH /api/venue/practitioners`: that PATCH
 * replaces whole columns, so two people amending different dates would clobber each other,
 * and its staff allowlist is deliberately narrow. Auth mirrors `practitioner-leave`.
 *
 * See Docs/calendar-amended-hours-plan.md.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const periodSchema = z.object({ start: z.string(), end: z.string() });

type PutBody = z.infer<typeof putBodySchema>;

const putBodySchema = z
  .object({
    practitioner_id: z.string().uuid().optional(),
    apply_to_all_active: z.boolean().optional(),
    date_start: isoDate,
    date_end: isoDate,
    periods: z.array(periodSchema).min(1).max(6),
    reason: z.string().max(AMENDED_HOURS_MAX_REASON_LENGTH).nullable().optional(),
    replace: z.object({ date_start: isoDate, date_end: isoDate }).nullable().optional(),
  })
  .refine((d) => d.date_end >= d.date_start, { message: 'End date must be on or after start date' })
  .refine((d) => Boolean(d.practitioner_id) || d.apply_to_all_active === true, {
    message: 'Choose a calendar or select all calendars',
  })
  .refine((d) => !d.replace || d.replace.date_end >= d.replace.date_start, {
    message: 'Replaced range end must be on or after its start',
  });

const deleteSchema = z
  .object({
    practitioner_id: z.string().uuid(),
    date_start: isoDate,
    date_end: isoDate,
  })
  .refine((d) => d.date_end >= d.date_start, { message: 'End date must be on or after start date' });

type Admin = ReturnType<typeof getSupabaseAdminClient>;

/** "Mon 21 Sep" for a refusal message. Pure string arithmetic, no locale. */
function describeYmdShort(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getUTCDay()];
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getUTCMonth()];
  return `${weekday} ${dt.getUTCDate()} ${month}`;
}

const CALENDAR_SELECT =
  'id, name, working_hours, schedule_periods, working_hours_rota, days_off, availability_exceptions';

interface CalendarRow extends CalendarScheduleRow {
  id: string;
  name: string;
}

async function loadCalendars(admin: Admin, venueId: string, ids: string[]): Promise<CalendarRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await admin
    .from('unified_calendars')
    .select(CALENDAR_SELECT)
    .eq('venue_id', venueId)
    .in('id', ids);
  if (error) throw new Error(`unified_calendars read failed: ${error.message}`);
  return (data ?? []) as unknown as CalendarRow[];
}

/** Which calendars this request may read or write, or a response refusing it. */
async function resolveScope(
  admin: Admin,
  staff: Pick<VenueStaff, 'id' | 'role' | 'venue_id'>,
  practitionerId: string | undefined,
  applyToAll: boolean,
  intent: 'read' | 'write',
): Promise<{ ok: true; ids: string[] } | { ok: false; response: NextResponse }> {
  if (staff.role !== 'admin') {
    const scope = await requireManagedCalendarIds(admin, staff.venue_id, staff);
    if (!scope.ok) {
      return intent === 'read'
        ? { ok: true, ids: [] }
        : { ok: false, response: NextResponse.json({ error: scope.error }, { status: 403 }) };
    }
    if (applyToAll) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Only admins can amend hours for all calendars' }, { status: 403 }),
      };
    }
    if (!practitionerId) return { ok: true, ids: scope.managedCalendarIds };
    const access = await requireManagedCalendarAccess(
      admin,
      staff.venue_id,
      staff,
      practitionerId,
      intent === 'read'
        ? 'You can only view amended hours for calendars assigned to your account.'
        : 'You can only amend hours for calendars assigned to your account.',
    );
    if (!access.ok) return { ok: false, response: NextResponse.json({ error: access.error }, { status: 403 }) };
    const cal = await requireVenueHostCalendarId(admin, staff.venue_id, practitionerId);
    if (!cal.ok) return { ok: false, response: NextResponse.json({ error: 'Calendar not found' }, { status: 404 }) };
    return { ok: true, ids: [cal.id] };
  }
  if (applyToAll) {
    const ids = await listActiveHostCalendarIds(admin, staff.venue_id);
    if (ids.length === 0) {
      return { ok: false, response: NextResponse.json({ error: 'No active calendars to amend hours for' }, { status: 400 }) };
    }
    return { ok: true, ids };
  }
  if (practitionerId) {
    const cal = await requireVenueHostCalendarId(admin, staff.venue_id, practitionerId);
    if (!cal.ok) return { ok: false, response: NextResponse.json({ error: 'Calendar not found' }, { status: 404 }) };
    return { ok: true, ids: [cal.id] };
  }
  return { ok: true, ids: await listActiveHostCalendarIds(admin, staff.venue_id) };
}

/** GET ?practitioner_id=optional&from=YYYY-MM-DD&to=YYYY-MM-DD */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const practitionerId = searchParams.get('practitioner_id') ?? undefined;
    if (!from || !to || !isoDate.safeParse(from).success || !isoDate.safeParse(to).success) {
      return NextResponse.json({ error: 'Missing from or to (YYYY-MM-DD)' }, { status: 400 });
    }
    if (from > to) return NextResponse.json({ error: 'from must be on or before to' }, { status: 400 });

    const admin = getSupabaseAdminClient();
    const scope = await resolveScope(admin, staff, practitionerId, false, 'read');
    if (!scope.ok) return scope.response;

    const calendars = await loadCalendars(admin, staff.venue_id, scope.ids);
    const entries = calendars.flatMap((cal) =>
      amendedHoursEntries(readOverrideMap(cal.availability_exceptions), { from, to }).map((e) => ({
        ...e,
        calendar_id: cal.id,
        calendar_name: cal.name,
      })),
    );
    entries.sort((a, b) => a.date_start.localeCompare(b.date_start) || a.calendar_name.localeCompare(b.calendar_name));
    return NextResponse.json({ entries });
  } catch (err) {
    console.error('GET /api/venue/calendar-amended-hours failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function venueTimezone(admin: Admin, venueId: string): Promise<string> {
  const { data } = await admin.from('venues').select('timezone').eq('id', venueId).single();
  const tz = (data as { timezone?: string | null } | null)?.timezone;
  return typeof tz === 'string' && tz.trim() ? tz.trim() : 'Europe/London';
}

async function writeMap(
  admin: Admin,
  venueId: string,
  calendarId: string,
  map: DateOverrideMap,
  source: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin
    .from('unified_calendars')
    .update({ availability_exceptions: map })
    .eq('id', calendarId)
    .eq('venue_id', venueId);
  if (error) return { ok: false, error: error.message };
  await mirrorCalendarHoursOverrides(
    admin,
    { venueId, calendarId, rows: hoursOverrideMirrorRows(venueId, calendarId, map) },
    source,
  );
  return { ok: true };
}

/**
 * PUT: set the hours for every date in the range on one calendar (or every active one).
 *
 * Refuses a range that includes a full-day leave date on that calendar: leave is `hard`
 * and outranks hours, so the override would save and do nothing there. Narrowing an
 * existing day warns like a weekly-hours change (`409 requires_confirmation`, bypassed with
 * `?acknowledge_affected_bookings=true`): the bookings are grandfathered, not refused.
 */
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const parsed = putBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }
    const body: PutBody = parsed.data;
    const dates = enumerateDatesInclusive(body.date_start, body.date_end);
    if (dates.length > AMENDED_HOURS_MAX_DATES) {
      return NextResponse.json(
        { error: `Amend up to ${AMENDED_HOURS_MAX_DATES} days at a time. For a lasting change, plan your hours ahead on the Availability tab.` },
        { status: 400 },
      );
    }
    const periods = normaliseHoursPeriods(body.periods);
    if (!periods.ok) return NextResponse.json({ error: periods.error }, { status: 400 });

    const admin = getSupabaseAdminClient();
    const scope = await resolveScope(admin, staff, body.practitioner_id, body.apply_to_all_active === true, 'write');
    if (!scope.ok) return scope.response;
    if (body.apply_to_all_active && !requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const calendars = await loadCalendars(admin, staff.venue_id, scope.ids);
    if (calendars.length === 0) return NextResponse.json({ error: 'Calendar not found' }, { status: 404 });

    // Full-day leave check, across every targeted calendar.
    const { data: leaveRows, error: leaveErr } = await admin
      .from('practitioner_leave_periods')
      .select('practitioner_id, start_date, end_date, unavailable_start_time, unavailable_end_time')
      .eq('venue_id', staff.venue_id)
      .in('practitioner_id', calendars.map((c) => c.id))
      .lte('start_date', body.date_end)
      .gte('end_date', body.date_start);
    if (leaveErr) {
      console.error('PUT /api/venue/calendar-amended-hours leave check:', leaveErr);
      return NextResponse.json({ error: 'Could not check this calendar for closures. Please try again.' }, { status: 500 });
    }
    for (const cal of calendars) {
      const onCal = (leaveRows ?? []).filter((l) => (l as { practitioner_id: string }).practitioner_id === cal.id) as Array<{
        start_date: string;
        end_date: string;
        unavailable_start_time: string | null;
        unavailable_end_time: string | null;
      }>;
      const blocked = firstFullDayLeaveDate(body.date_start, body.date_end, onCal);
      if (blocked) {
        return NextResponse.json(
          {
            error: `${cal.name} is closed all day on ${describeYmdShort(blocked)}. Remove that closure first, or shorten the range.`,
          },
          { status: 409 },
        );
      }
    }

    const nextMaps = new Map<string, DateOverrideMap>();
    for (const cal of calendars) {
      nextMaps.set(
        cal.id,
        applyAmendedHours(readOverrideMap(cal.availability_exceptions), {
          date_start: body.date_start,
          date_end: body.date_end,
          periods: periods.periods,
          reason: body.reason ?? null,
          replace: body.replace ?? null,
        }),
      );
    }

    if (request.nextUrl.searchParams.get('acknowledge_affected_bookings') !== 'true') {
      try {
        const tz = await venueTimezone(admin, staff.venue_id);
        const fromDate = getVenueLocalDateAndMinutes(tz, new Date()).dateYmd;
        // The comparison covers the saved range and the run being replaced: a date that
        // leaves the run goes back to its weekly hours, which can strand a booking too.
        const lo = body.replace && body.replace.date_start < body.date_start ? body.replace.date_start : body.date_start;
        const hi = body.replace && body.replace.date_end > body.date_end ? body.replace.date_end : body.date_end;
        for (const cal of calendars) {
          const after: CalendarScheduleRow = { ...cal, availability_exceptions: nextMaps.get(cal.id) };
          const orphans = await findBookingsOrphanedByHoursChange(admin, {
            venueId: staff.venue_id,
            fromDate,
            calendarColumnId: cal.id,
            oldPeriodsForDate: (d) => calendarHours(cal, d),
            newPeriodsForDate: (d) => calendarHours(after, d),
            skipDate: (d) => d < lo || d > hi,
          });
          if (orphans.total > 0) {
            return NextResponse.json(
              {
                requires_confirmation: true,
                affected_count: orphans.total,
                affected_bookings: orphans.sample,
                message: describeHoursChangeOrphans(orphans, { scope: 'calendar', calendarName: cal.name }),
              },
              { status: 409 },
            );
          }
        }
      } catch (e) {
        console.error('PUT /api/venue/calendar-amended-hours orphan check:', e);
        return NextResponse.json({ error: 'Could not verify existing bookings. Please try again.' }, { status: 500 });
      }
    }

    for (const cal of calendars) {
      const written = await writeMap(admin, staff.venue_id, cal.id, nextMaps.get(cal.id)!, 'PUT /api/venue/calendar-amended-hours');
      if (!written.ok) {
        console.error('PUT /api/venue/calendar-amended-hours write failed:', written.error);
        return NextResponse.json({ error: 'Failed to save amended hours' }, { status: 500 });
      }
    }
    return NextResponse.json({ updated: calendars.length, calendar_ids: calendars.map((c) => c.id) });
  } catch (err) {
    console.error('PUT /api/venue/calendar-amended-hours failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE: remove every override key in the range on one calendar. */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const parsed = deleteSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }
    const admin = getSupabaseAdminClient();
    const scope = await resolveScope(admin, staff, parsed.data.practitioner_id, false, 'write');
    if (!scope.ok) return scope.response;
    const [cal] = await loadCalendars(admin, staff.venue_id, scope.ids);
    if (!cal) return NextResponse.json({ error: 'Calendar not found' }, { status: 404 });

    const next = removeDateOverrides(readOverrideMap(cal.availability_exceptions), parsed.data.date_start, parsed.data.date_end);
    const written = await writeMap(admin, staff.venue_id, cal.id, next, 'DELETE /api/venue/calendar-amended-hours');
    if (!written.ok) {
      console.error('DELETE /api/venue/calendar-amended-hours write failed:', written.error);
      return NextResponse.json({ error: 'Failed to remove amended hours' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/venue/calendar-amended-hours failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
