import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { logApiPerfIfEnabled, perfApiStart } from '@/lib/perf/api-route-timing';
import {
  classBlockEndTime,
  resolveInstructorCalendarIdForClass,
} from '@/lib/class-instances/instructor-calendar-block';
import { normalizeEnabledModels, venueExposesBookingModel } from '@/lib/booking/enabled-models';
import { inferBookingRowModel } from '@/lib/booking/infer-booking-row-model';
import { isCapacityConsumingStatus } from '@/lib/availability/capacity-status';
import type { BookingModel } from '@/types/booking-models';
import type { ScheduleBlockDTO, ScheduleBlockKind } from '@/types/schedule-blocks';
import { formatGuestDisplayName } from '@/lib/guests/name';

function hhmm(t: string | null | undefined): string {
  if (!t) return '09:00';
  const s = String(t);
  return s.length >= 5 ? s.slice(0, 5) : s;
}

/**
 * End-time for a block as HH:MM, capped at 23:59 so a late-night start + duration that crosses
 * midnight renders "23:59" rather than "24:30" (F15). Reuses the canonical {@link classBlockEndTime}
 * cap (which returns HH:MM:SS) and trims to HH:MM for the feed DTO.
 */
function blockEndHhmm(startHhmm: string, durationMinutes: number): string {
  return classBlockEndTime(startHhmm, durationMinutes).slice(0, 5);
}

/** Max date span (inclusive days) the feed will serve before clamping `to` (F6). */
const MAX_SCHEDULE_SPAN_DAYS = 62;

/** Hard cap on booking + class-instance rows pulled per request (F6). */
const SCHEDULE_ROW_LIMIT = 2000;

/** Add `days` to an ISO YYYY-MM-DD date string (UTC, no DST shift — date-only buckets). */
function addDaysIso(iso: string, days: number): string {
  const [y, mo, d] = iso.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function classTypeFromInstanceRow(
  row: Record<string, unknown> | undefined,
): { name?: string; colour?: string; duration_minutes?: number } | undefined {
  if (!row) return undefined;
  const ct = row.class_types;
  if (!ct) return undefined;
  if (Array.isArray(ct)) return ct[0] as { name?: string; colour?: string; duration_minutes?: number };
  return ct as { name?: string; colour?: string; duration_minutes?: number };
}

/**
 * GET /api/venue/schedule?date=YYYY-MM-DD | from=&to=
 * Merged non–Model-A schedule blocks (events, classes, resources) for PractitionerCalendarView §4.2.
 *
 * Unified-scheduling appointment rows (calendar/service or `event_session_id`) are intentionally excluded from the
 * booking loop below - they render on the practitioner grid only (see `ScheduleBlock` type comment, Option A).
 *
 * **Tenancy:** Uses `getVenueStaff` + venue-scoped queries; mutations belong in other routes. RLS on Supabase should
 * still enforce `venue_id` for defence in depth (§4.6).
 */
export async function GET(request: NextRequest) {
  const perfStarted = perfApiStart();
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const venueId = staff.venue_id;

    const date = request.nextUrl.searchParams.get('date');
    const from = request.nextUrl.searchParams.get('from');
    const to = request.nextUrl.searchParams.get('to');
    const isoRe = /^\d{4}-\d{2}-\d{2}$/;

    let fromStr: string;
    let toStr: string;
    if (date && isoRe.test(date)) {
      fromStr = date;
      toStr = date;
    } else if (from && to && isoRe.test(from) && isoRe.test(to)) {
      fromStr = from;
      toStr = to;
    } else {
      return NextResponse.json({ error: 'Provide date=YYYY-MM-DD or from=...&to=...' }, { status: 400 });
    }

    // Reject inverted ranges; clamp absurd spans so one request can't sweep years of rows (F6).
    if (toStr < fromStr) {
      return NextResponse.json({ error: 'Invalid range: to is before from' }, { status: 400 });
    }
    const maxToStr = addDaysIso(fromStr, MAX_SCHEDULE_SPAN_DAYS - 1);
    if (toStr > maxToStr) {
      toStr = maxToStr;
    }

    const { data: venueRow, error: venueErr } = await staff.db
      .from('venues')
      .select('booking_model, enabled_models')
      .eq('id', venueId)
      .single();

    if (venueErr || !venueRow) {
      console.error('GET /api/venue/schedule venue load failed:', venueErr);
      return NextResponse.json({ error: 'Failed to load venue' }, { status: 500 });
    }

    const primary = (venueRow.booking_model as BookingModel) ?? 'table_reservation';
    const enabledModels = normalizeEnabledModels(
      (venueRow as { enabled_models?: unknown }).enabled_models,
      primary,
    );

    const wantEvents = venueExposesBookingModel(primary, enabledModels, 'event_ticket');
    const wantClasses = venueExposesBookingModel(primary, enabledModels, 'class_session');
    const wantResources = venueExposesBookingModel(primary, enabledModels, 'resource_booking');

    if (!wantEvents && !wantClasses && !wantResources) {
      return NextResponse.json({ blocks: [] as ScheduleBlockDTO[] });
    }

    const blocks: ScheduleBlockDTO[] = [];

    const wantByKind: Record<ScheduleBlockKind, boolean> = {
      event_ticket: wantEvents,
      class_session: wantClasses,
      resource_booking: wantResources,
    };

    const { data: bookingRows, error: bookErr } = await staff.db
      .from('bookings')
      .select(
        'id, booking_date, booking_time, booking_end_time, estimated_end_time, status, party_size, guest_id, client_arrived_at, experience_event_id, class_instance_id, resource_id, calendar_id',
      )
      .eq('venue_id', venueId)
      .or('experience_event_id.not.is.null,class_instance_id.not.is.null,resource_id.not.is.null')
      .gte('booking_date', fromStr)
      .lte('booking_date', toStr)
      .order('booking_date', { ascending: true })
      .order('booking_time', { ascending: true })
      .limit(SCHEDULE_ROW_LIMIT);

    if (bookErr) {
      console.error('GET /api/venue/schedule bookings failed:', bookErr);
      return NextResponse.json({ error: 'Failed to load schedule' }, { status: 500 });
    }

    const rows = (bookingRows ?? []).filter((r) => {
      const inferred = inferBookingRowModel(r as Parameters<typeof inferBookingRowModel>[0]);
      if (inferred === 'table_reservation' || inferred === 'practitioner_appointment' || inferred === 'unified_scheduling') {
        return false;
      }
      // Resource bookings with calendar_id render in calendar columns, not the schedule feed lane
      if (inferred === 'resource_booking' && (r as Record<string, unknown>).calendar_id) {
        return false;
      }
      const kind = inferred as ScheduleBlockKind;
      return wantByKind[kind] === true;
    });
    const guestIds = [...new Set(rows.map((r) => r.guest_id).filter(Boolean))] as string[];
    const { data: guestsRows, error: guestsErr } = guestIds.length
      ? await staff.db.from('guests').select('id, first_name, last_name').in('id', guestIds)
      : { data: [], error: null };
    if (guestsErr) {
      console.error('GET /api/venue/schedule guests failed:', guestsErr);
      return NextResponse.json({ error: 'Failed to load schedule' }, { status: 500 });
    }
    const guestName = new Map(
      (guestsRows ?? []).map((g: { id: string; first_name: string | null; last_name: string | null }) => [
        g.id,
        formatGuestDisplayName(g.first_name, g.last_name),
      ]),
    );

    const eventIds = [...new Set(rows.map((r) => r.experience_event_id).filter(Boolean))] as string[];
    const { data: expEvents, error: expEventsErr } = eventIds.length
      ? await staff.db.from('experience_events').select('id, name, end_time, start_time, calendar_id').in('id', eventIds)
      : { data: [], error: null };
    if (expEventsErr) {
      console.error('GET /api/venue/schedule experience_events enrichment failed:', expEventsErr);
      return NextResponse.json({ error: 'Failed to load schedule' }, { status: 500 });
    }
    const eventMap = new Map((expEvents ?? []).map((e: Record<string, unknown>) => [e.id as string, e]));

    const classInstIds = [...new Set(rows.map((r) => r.class_instance_id).filter(Boolean))] as string[];
    const { data: classInstRows, error: classInstErr } = classInstIds.length
      ? await staff.db
          .from('class_instances')
          .select(
            'id, class_type_id, instance_date, start_time, capacity_override, class_types(id, name, colour, duration_minutes, capacity, instructor_id)',
          )
          .in('id', classInstIds)
      : { data: [], error: null };
    if (classInstErr) {
      console.error('GET /api/venue/schedule class_instances enrichment failed:', classInstErr);
      return NextResponse.json({ error: 'Failed to load schedule' }, { status: 500 });
    }
    const classInstMap = new Map<string, Record<string, unknown>>();
    for (const row of classInstRows ?? []) {
      const r = row as { id: string; class_types?: unknown };
      classInstMap.set(r.id, row as Record<string, unknown>);
    }

    const admin = getSupabaseAdminClient();
    const calendarIdByClassTypeId = new Map<string, string | null>();

    // Cache instructor calendar resolution per instructor id so two class types sharing an
    // instructor don't re-run the (up to 5-hop) resolver.
    const calendarIdByInstructorId = new Map<string | null, string | null>();

    async function ensureCalendarIdsForClassTypes(typeIds: string[]) {
      const uniq = [...new Set(typeIds)].filter((tid) => tid && !calendarIdByClassTypeId.has(tid));
      if (uniq.length === 0) return;

      // Batch the class_types -> instructor_id lookup into one query instead of one per type (F6 N+1).
      const { data: ctRows, error: ctErr } = await admin
        .from('class_types')
        .select('id, instructor_id')
        .eq('venue_id', venueId)
        .in('id', uniq);
      if (ctErr) {
        console.error('GET /api/venue/schedule class_types calendar lookup failed:', ctErr);
        throw ctErr;
      }

      const instructorByTypeId = new Map<string, string | null>();
      for (const ct of ctRows ?? []) {
        const row = ct as { id: string; instructor_id?: string | null };
        instructorByTypeId.set(row.id, row.instructor_id ?? null);
      }

      // Resolve each distinct instructor calendar once, reusing across class types.
      const distinctInstructorIds = [...new Set([...instructorByTypeId.values()])];
      await Promise.all(
        distinctInstructorIds.map(async (instructorId) => {
          if (calendarIdByInstructorId.has(instructorId)) return;
          const cal = await resolveInstructorCalendarIdForClass(admin, venueId, instructorId ?? null);
          calendarIdByInstructorId.set(instructorId, cal);
        }),
      );

      for (const tid of uniq) {
        const instructorId = instructorByTypeId.get(tid) ?? null;
        calendarIdByClassTypeId.set(tid, calendarIdByInstructorId.get(instructorId) ?? null);
      }
    }

    const classTypeIdsFromBookingInstances: string[] = [];
    for (const row of classInstRows ?? []) {
      const ctid = (row as { class_type_id?: string }).class_type_id;
      if (typeof ctid === 'string') classTypeIdsFromBookingInstances.push(ctid);
    }
    await ensureCalendarIdsForClassTypes(classTypeIdsFromBookingInstances);

    const resourceIds = [...new Set(rows.map((r) => r.resource_id).filter(Boolean))] as string[];
    const { data: resourceRows, error: resourceErr } = resourceIds.length
      ? await staff.db
          .from('unified_calendars')
          .select('id, name, display_on_calendar_id, min_booking_minutes')
          .eq('calendar_type', 'resource')
          .in('id', resourceIds)
      : { data: [], error: null };
    if (resourceErr) {
      console.error('GET /api/venue/schedule resources enrichment failed:', resourceErr);
      return NextResponse.json({ error: 'Failed to load schedule' }, { status: 500 });
    }
    const resourceMap = new Map(
      (resourceRows ?? []).map(
        (r: { id: string; name: string; display_on_calendar_id?: string | null; min_booking_minutes?: number }) => [
          r.id,
          r,
        ],
      ),
    );

    const bookedClassIds = new Set<string>();
    const classEnrolledByInstance = new Map<string, number>();
    const eventStats = new Map<string, { bookingCount: number; partyTotal: number; arrivedCount: number }>();
    for (const r of rows) {
      const bmStat = inferBookingRowModel(r as Parameters<typeof inferBookingRowModel>[0]);
      // Only capacity-consuming statuses (Booked/Confirmed/Pending/Seated) count toward uptake — a
      // No-Show or Completed booking must not inflate "X / Y booked" (F4). arrivedCount tracks
      // client_arrived_at only on these still-active rows.
      if (
        bmStat === 'event_ticket' &&
        r.experience_event_id &&
        isCapacityConsumingStatus(r.status as string | null | undefined)
      ) {
        const eid = r.experience_event_id as string;
        const cur = eventStats.get(eid) ?? { bookingCount: 0, partyTotal: 0, arrivedCount: 0 };
        cur.bookingCount += 1;
        cur.partyTotal += Number(r.party_size ?? 1);
        if (r.client_arrived_at) cur.arrivedCount += 1;
        eventStats.set(eid, cur);
      }
    }

    for (const r of rows) {
      if (r.status === 'Cancelled') continue;
      // De-dup: any non-cancelled booking row already renders a per-booking block below, so the
      // empty-shell class loop must skip this instance. (Status-agnostic beyond Cancelled — a
      // No-Show booking still occupies a visible row, just not an uptake spot.)
      if (r.class_instance_id) bookedClassIds.add(r.class_instance_id);
      const bmRow = inferBookingRowModel(r as Parameters<typeof inferBookingRowModel>[0]);
      // Booked-spot uptake counts only capacity-consuming statuses; No-Show/Completed must not
      // inflate "X / Y booked" (F4).
      if (
        bmRow === 'class_session' &&
        r.class_instance_id &&
        isCapacityConsumingStatus(r.status as string | null | undefined)
      ) {
        const cid = r.class_instance_id as string;
        classEnrolledByInstance.set(
          cid,
          (classEnrolledByInstance.get(cid) ?? 0) + Number(r.party_size ?? 1),
        );
      }
    }

    function capacityForClassInstanceRow(row: Record<string, unknown> | undefined): number | null {
      if (!row) return null;
      const ov = row.capacity_override as number | null | undefined;
      if (ov != null && ov > 0) return ov;
      const ctRaw = row.class_types;
      const ct = Array.isArray(ctRaw) ? ctRaw[0] : ctRaw;
      const cap = (ct as { capacity?: number } | undefined)?.capacity;
      return cap != null ? cap : null;
    }

    function calendarIdForClassInstance(instanceId: string | null | undefined): string | null {
      if (!instanceId) return null;
      const ci = classInstMap.get(instanceId);
      if (!ci) return null;
      const ctid = (ci as { class_type_id?: string }).class_type_id;
      if (!ctid) return null;
      return calendarIdByClassTypeId.get(ctid) ?? null;
    }

    function endForBooking(row: (typeof rows)[0], bm: ScheduleBlockKind): string {
      if (row.booking_end_time) return hhmm(row.booking_end_time as string);
      if (row.estimated_end_time) return hhmm(row.estimated_end_time as string);
      if (bm === 'event_ticket' && row.experience_event_id) {
        const ev = eventMap.get(row.experience_event_id) as { end_time?: string } | undefined;
        if (ev?.end_time) return hhmm(ev.end_time);
      }
      if (bm === 'class_session' && row.class_instance_id) {
        const ci = classInstMap.get(row.class_instance_id);
        const ct = ci?.class_types as { duration_minutes?: number } | undefined;
        if (ct?.duration_minutes) {
          return blockEndHhmm(hhmm(row.booking_time as string), ct.duration_minutes);
        }
      }
      if (bm === 'resource_booking' && row.resource_id) {
        const resRow = resourceMap.get(row.resource_id as string) as { min_booking_minutes?: number } | undefined;
        const fallbackMins =
          resRow?.min_booking_minutes != null && resRow.min_booking_minutes > 0 ? resRow.min_booking_minutes : 60;
        return blockEndHhmm(hhmm(row.booking_time as string), fallbackMins);
      }
      return blockEndHhmm(hhmm(row.booking_time as string), 60);
    }

    for (const r of rows) {
      const bm = inferBookingRowModel(r as Parameters<typeof inferBookingRowModel>[0]) as ScheduleBlockKind;
      if (!wantByKind[bm]) continue;
      if (bm === 'event_ticket') continue;

      const gn = (guestName.get(r.guest_id as string) as string | undefined) ?? 'Guest';
      let title = gn;
      if (bm === 'class_session' && r.class_instance_id) {
        const ci = classInstMap.get(r.class_instance_id);
        const ct = classTypeFromInstanceRow(ci);
        const cn = ct?.name ?? 'Class';
        title = cn;
      } else if (bm === 'resource_booking' && r.resource_id) {
        const resRow = resourceMap.get(r.resource_id) as { name?: string } | undefined;
        const rn = resRow?.name ?? 'Resource';
        title = `${rn} · ${gn}`;
      }

      let accent: string | null = null;
      if (bm === 'class_session' && r.class_instance_id) {
        const ci = classInstMap.get(r.class_instance_id);
        const ct = classTypeFromInstanceRow(ci);
        accent = ct?.colour ?? '#22C55E';
      } else if (bm === 'resource_booking') {
        accent = '#64748B';
      }

      const classCap =
        bm === 'class_session' && r.class_instance_id
          ? capacityForClassInstanceRow(classInstMap.get(r.class_instance_id as string))
          : null;
      const classBooked =
        bm === 'class_session' && r.class_instance_id
          ? (classEnrolledByInstance.get(r.class_instance_id as string) ?? null)
          : null;

      const subtitle =
        bm === 'class_session'
          ? null
          : r.party_size && Number(r.party_size) > 1
            ? `${r.party_size} guests`
            : null;

      blocks.push({
        id: `bk-${r.id}`,
        kind: bm,
        date: r.booking_date as string,
        start_time: hhmm(r.booking_time as string),
        end_time: endForBooking(r, bm),
        title,
        subtitle,
        booking_id: r.id as string,
        experience_event_id: r.experience_event_id as string | null,
        class_instance_id: r.class_instance_id as string | null,
        resource_id: r.resource_id as string | null,
        status: r.status as string,
        accent_colour: accent,
        class_capacity: classCap,
        class_booked_spots: classBooked,
        calendar_id:
          bm === 'class_session'
            ? calendarIdForClassInstance(r.class_instance_id as string)
            : bm === 'resource_booking' && r.resource_id
              ? ((resourceMap.get(r.resource_id as string) as { display_on_calendar_id?: string | null } | undefined)
                  ?.display_on_calendar_id ?? null)
              : null,
      });
    }

    if (wantEvents) {
      const { data: evRows, error: evErr } = await staff.db
        .from('experience_events')
        .select('id, name, event_date, start_time, end_time, calendar_id, capacity')
        .eq('venue_id', venueId)
        .eq('is_active', true)
        .gte('event_date', fromStr)
        .lte('event_date', toStr)
        .limit(SCHEDULE_ROW_LIMIT);

      if (evErr) {
        // Fail closed: a sub-query error must surface as 500, not a 200 with events silently
        // missing (which renders as "no events" on the calendar) (F5).
        console.error('GET /api/venue/schedule experience_events failed:', evErr);
        return NextResponse.json({ error: 'Failed to load schedule' }, { status: 500 });
      } else {
        for (const ev of evRows ?? []) {
          const e = ev as {
            id: string;
            name: string;
            event_date: string;
            start_time: string;
            end_time: string;
            calendar_id: string | null;
            capacity: number;
          };
          const st = eventStats.get(e.id);
          const bookingCount = st?.bookingCount ?? 0;
          const partyTotal = st?.partyTotal ?? 0;
          const arrivedCount = st?.arrivedCount ?? 0;
          const subtitle =
            bookingCount === 0
              ? 'No bookings yet'
              : `${bookingCount} booking${bookingCount === 1 ? '' : 's'} · ${partyTotal} guest${partyTotal === 1 ? '' : 's'} · ${arrivedCount} arrived`;

          blocks.push({
            id: `ev-${e.id}`,
            kind: 'event_ticket',
            date: e.event_date,
            start_time: hhmm(e.start_time),
            end_time: hhmm(e.end_time),
            title: e.name,
            subtitle,
            accent_colour: '#F59E0B',
            experience_event_id: e.id,
            calendar_id: e.calendar_id ?? null,
            event_capacity: e.capacity ?? null,
            event_booking_count: bookingCount,
            event_party_total: partyTotal,
            event_arrived_count: arrivedCount,
          });
        }
      }
    }

    if (wantClasses) {
      const { data: ctRows, error: ctRowsErr } = await staff.db
        .from('class_types')
        .select('id')
        .eq('venue_id', venueId)
        .eq('is_active', true);
      if (ctRowsErr) {
        console.error('GET /api/venue/schedule class_types failed:', ctRowsErr);
        return NextResponse.json({ error: 'Failed to load schedule' }, { status: 500 });
      }
      const ctIds = (ctRows ?? []).map((x: { id: string }) => x.id);
      if (ctIds.length > 0) {
        const { data: ciRows, error: ciErr } = await staff.db
          .from('class_instances')
          .select('id, instance_date, start_time, class_type_id, capacity_override')
          .in('class_type_id', ctIds)
          .eq('is_cancelled', false)
          .gte('instance_date', fromStr)
          .lte('instance_date', toStr)
          .limit(SCHEDULE_ROW_LIMIT);

        if (ciErr) {
          console.error('GET /api/venue/schedule class_instances failed:', ciErr);
          return NextResponse.json({ error: 'Failed to load schedule' }, { status: 500 });
        } else {
          const needTypeIds = [...new Set((ciRows ?? []).map((r: { class_type_id: string }) => r.class_type_id))];
          const { data: types, error: typesErr } = await staff.db
            .from('class_types')
            .select('id, name, colour, duration_minutes, capacity, instructor_id')
            .in('id', needTypeIds)
            .eq('is_active', true);
          if (typesErr) {
            console.error('GET /api/venue/schedule class_types detail failed:', typesErr);
            return NextResponse.json({ error: 'Failed to load schedule' }, { status: 500 });
          }
          const typeMap = new Map(
            (types ?? []).map((t: { id: string; name: string; colour: string; duration_minutes: number; capacity: number }) => [
              t.id,
              t,
            ]),
          );

          await ensureCalendarIdsForClassTypes(needTypeIds);

          for (const raw of ciRows ?? []) {
            const row = raw as {
              id: string;
              instance_date: string;
              start_time: string;
              class_type_id: string;
              capacity_override?: number | null;
            };
            if (bookedClassIds.has(row.id)) continue;
            const ct = typeMap.get(row.class_type_id);
            if (!ct) continue;
            const start = hhmm(row.start_time);
            const end = blockEndHhmm(start, ct.duration_minutes);
            const cap =
              row.capacity_override != null && row.capacity_override > 0 ? row.capacity_override : ct.capacity;
            blocks.push({
              id: `ci-${row.id}`,
              kind: 'class_session',
              date: row.instance_date,
              start_time: start,
              end_time: end,
              title: ct.name,
              subtitle: null,
              accent_colour: ct.colour ?? '#22C55E',
              class_instance_id: row.id,
              class_capacity: cap,
              class_booked_spots: 0,
              calendar_id: calendarIdByClassTypeId.get(row.class_type_id) ?? null,
            });
          }
        }
      }
    }

    blocks.sort((a, b) => {
      const dc = a.date.localeCompare(b.date);
      if (dc !== 0) return dc;
      return a.start_time.localeCompare(b.start_time);
    });

    return NextResponse.json({ blocks });
  } catch (err) {
    console.error('GET /api/venue/schedule failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    logApiPerfIfEnabled('GET /api/venue/schedule', perfStarted);
  }
}
