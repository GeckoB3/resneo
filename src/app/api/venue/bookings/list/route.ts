import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { BOOKING_ACTIVE_STATUSES } from '@/lib/table-management/constants';
import { isTableReservationBooking } from '@/lib/booking/infer-booking-row-model';

/**
 * GET /api/venue/bookings/list?date=YYYY-MM-DD&status=Pending|Seated|...
 * or  /api/venue/bookings/list?from=YYYY-MM-DD&to=YYYY-MM-DD&status=...
 * Optional: guest=<uuid> filters to that guest_id (with date/from-to or ids).
 * Optional: service=<uuid>[,<uuid>...] filters table reservations by venue_services.id.
 * Optional: calendar=<uuid> filters schedule bookings by calendar/practitioner/resource id.
 * Optional: attendance_confirmed=1 — bookings where the guest confirmed via reminder link (guest_attendance_confirmed_at)
 *   or staff pressed Confirm Booking (staff_attendance_confirmed_at). When set, `status` is ignored.
 * Returns bookings for the authenticated venue, with guest name.
 * Sorted by date then time.
 *
 * `view=calendar` — staff schedule grid: narrower row shape, skips table-assignment query (faster for wide date ranges).
 */
const BOOKINGS_LIST_SELECT_FULL =
  'id, booking_date, booking_time, party_size, status, source, deposit_status, deposit_amount_pence, dietary_notes, occasion, special_requests, internal_notes, client_arrived_at, guest_attendance_confirmed_at, staff_attendance_confirmed_at, estimated_end_time, created_at, guest_id, service_id, practitioner_id, appointment_service_id, calendar_id, service_item_id, experience_event_id, class_instance_id, resource_id, booking_end_time, event_session_id, group_booking_id, person_label, area_id';

/** Omits columns not used by the practitioner calendar grid to reduce payload and DB I/O. */
const BOOKINGS_LIST_SELECT_CALENDAR =
  'id, booking_date, booking_time, party_size, status, source, deposit_status, deposit_amount_pence, special_requests, internal_notes, client_arrived_at, guest_attendance_confirmed_at, staff_attendance_confirmed_at, estimated_end_time, guest_id, service_id, practitioner_id, appointment_service_id, calendar_id, service_item_id, experience_event_id, class_instance_id, resource_id, booking_end_time, event_session_id, group_booking_id, person_label, area_id';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const calendarView = request.nextUrl.searchParams.get('view') === 'calendar';

    const date = request.nextUrl.searchParams.get('date');
    const from = request.nextUrl.searchParams.get('from');
    const to = request.nextUrl.searchParams.get('to');
    const ids = request.nextUrl.searchParams.get('ids');
    const statusFilter = request.nextUrl.searchParams.get('status');
    const attendanceConfirmedFilter = request.nextUrl.searchParams.get('attendance_confirmed') === '1';
    const groupBookingId = request.nextUrl.searchParams.get('group_booking_id');
    const unassignedTables = request.nextUrl.searchParams.get('unassigned_tables') === '1';
    const guestIdParam = request.nextUrl.searchParams.get('guest');
    const areaIdParam = request.nextUrl.searchParams.get('area');
    const serviceIdParam = request.nextUrl.searchParams.get('service');
    const calendarIdParam = request.nextUrl.searchParams.get('calendar');
    const isoRe = /^\d{4}-\d{2}-\d{2}$/;
    const guestUuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    /** Separate branches avoid a ternary on `.select(...)` which triggers excessively deep Supabase generics. */
    let query = calendarView
      ? staff.db
          .from('bookings')
          .select(BOOKINGS_LIST_SELECT_CALENDAR)
          .eq('venue_id', staff.venue_id)
          .order('booking_date', { ascending: true })
          .order('booking_time', { ascending: true })
      : staff.db
          .from('bookings')
          .select(BOOKINGS_LIST_SELECT_FULL)
          .eq('venue_id', staff.venue_id)
          .order('booking_date', { ascending: true })
          .order('booking_time', { ascending: true });

    if (guestIdParam && guestUuidRe.test(guestIdParam)) {
      query = query.eq('guest_id', guestIdParam);
    }

    if (areaIdParam && guestUuidRe.test(areaIdParam)) {
      query = query.eq('area_id', areaIdParam);
    }

    if (serviceIdParam) {
      const serviceIds = serviceIdParam
        .split(',')
        .map((id) => id.trim())
        .filter((id) => guestUuidRe.test(id));
      if (serviceIds.length === 1) {
        query = query.eq('service_id', serviceIds[0]!);
      } else if (serviceIds.length > 1) {
        query = query.in('service_id', serviceIds);
      }
    }

    if (calendarIdParam && guestUuidRe.test(calendarIdParam)) {
      query = query.or(
        `calendar_id.eq.${calendarIdParam},practitioner_id.eq.${calendarIdParam},resource_id.eq.${calendarIdParam}`,
      );
    }

    if (groupBookingId) {
      query = query.eq('group_booking_id', groupBookingId);
    } else if (ids) {
      const idList = ids.split(',').filter(Boolean);
      if (idList.length === 0) {
        return NextResponse.json({ bookings: [] });
      }
      query = query.in('id', idList);
    } else if (date && isoRe.test(date)) {
      query = query.eq('booking_date', date);
    } else if (from && to && isoRe.test(from) && isoRe.test(to)) {
      query = query.gte('booking_date', from).lte('booking_date', to);
    } else {
      return NextResponse.json({ error: 'Provide date=YYYY-MM-DD or from=...&to=... or ids=...' }, { status: 400 });
    }

    const { data: rows, error } = await query;

    if (error) {
      console.error('GET /api/venue/bookings/list failed:', error);
      return NextResponse.json({ error: 'Failed to load bookings' }, { status: 500 });
    }

    type RawBookingRow = Record<string, unknown> & { guest_id: string };
    const rawRows = (rows ?? []) as RawBookingRow[];
    const guestIds = [...new Set(rawRows.map((r) => r.guest_id))];
    const { data: guestsRows } = guestIds.length
      ? await staff.db.from('guests').select('id, name, email, phone, visit_count, tags').in('id', guestIds)
      : { data: [] };
    const guestsMap = new Map(
      (guestsRows ?? []).map(
        (g: {
          id: string;
          name: string | null;
          email: string | null;
          phone: string | null;
          visit_count?: number | null;
          tags?: string[] | null;
        }) => [
          g.id,
          g,
        ],
      ),
    );

    const areaIds = [...new Set(rawRows.map((r) => r.area_id).filter((x): x is string => typeof x === 'string'))];
    const { data: areaRows } =
      areaIds.length > 0
        ? await staff.db.from('areas').select('id, name').in('id', areaIds)
        : { data: [] as { id: string; name: string }[] };
    const areaNameById = new Map((areaRows ?? []).map((a: { id: string; name: string }) => [a.id, a.name]));

    let bookings = rawRows.map((r) => {
      const guest = guestsMap.get(r.guest_id);
      const aid = r.area_id as string | null | undefined;
      return {
        id: r.id,
        booking_date: r.booking_date,
        booking_time: r.booking_time,
        party_size: r.party_size,
        status: r.status,
        source: r.source ?? null,
        deposit_status: r.deposit_status,
        deposit_amount_pence: r.deposit_amount_pence,
        dietary_notes: calendarView ? null : r.dietary_notes,
        occasion: calendarView ? null : r.occasion,
        special_requests: r.special_requests ?? null,
        internal_notes: r.internal_notes ?? null,
        client_arrived_at: r.client_arrived_at ?? null,
        guest_attendance_confirmed_at: r.guest_attendance_confirmed_at ?? null,
        staff_attendance_confirmed_at: r.staff_attendance_confirmed_at ?? null,
        estimated_end_time: r.estimated_end_time,
        booking_end_time: r.booking_end_time,
        created_at: calendarView ? null : r.created_at,
        guest_id: r.guest_id,
        guest_name: guest?.name ?? '-',
        guest_email: guest?.email ?? null,
        guest_phone: guest?.phone ?? null,
        guest_visit_count: guest?.visit_count ?? null,
        guest_tags: Array.isArray(guest?.tags) ? guest.tags : [],
        service_id: r.service_id ?? null,
        practitioner_id: r.practitioner_id ?? null,
        calendar_id: r.calendar_id ?? null,
        appointment_service_id: r.appointment_service_id ?? null,
        service_item_id: r.service_item_id ?? null,
        experience_event_id: r.experience_event_id ?? null,
        class_instance_id: r.class_instance_id ?? null,
        resource_id: r.resource_id ?? null,
        event_session_id: r.event_session_id ?? null,
        group_booking_id: r.group_booking_id ?? null,
        person_label: r.person_label ?? null,
        area_id: aid ?? null,
        area_name: aid ? areaNameById.get(aid) ?? null : null,
      };
    });

    if (attendanceConfirmedFilter) {
      // `Confirmed` is the canonical signal that attendance is confirmed; we
      // also include any booking whose attendance timestamps are set, for
      // back-compat with rows that pre-date the dedicated `Confirmed` status.
      bookings = bookings.filter((b: Record<string, unknown>) => {
        if (b.status === 'Confirmed') return true;
        const g = b.guest_attendance_confirmed_at;
        const s = b.staff_attendance_confirmed_at;
        const guestOn = typeof g === 'string' && g.trim().length > 0;
        const staffOn = typeof s === 'string' && s.trim().length > 0;
        return guestOn || staffOn;
      });
    } else if (statusFilter) {
      bookings = bookings.filter((b: Record<string, unknown>) => b.status === statusFilter);
    }

    const bookingIds = bookings.map((b: Record<string, unknown>) => b.id as string);
    const assignmentsMap = new Map<string, Array<{ id: string; name: string }>>();
    if (!calendarView && bookingIds.length > 0) {
      const { data: assignRows } = await staff.db
        .from('booking_table_assignments')
        .select('booking_id, table_id, table:venue_tables(id, name)')
        .in('booking_id', bookingIds);
      for (const row of assignRows ?? []) {
        const r = row as unknown as { booking_id: string; table_id: string; table: Array<{ id: string; name: string }> | { id: string; name: string } | null };
        const tableObj = Array.isArray(r.table) ? r.table[0] : r.table;
        const existing = assignmentsMap.get(r.booking_id) ?? [];
        existing.push({ id: tableObj?.id ?? r.table_id, name: tableObj?.name ?? 'Unknown' });
        assignmentsMap.set(r.booking_id, existing);
      }
    }

    let enriched = bookings.map((b: Record<string, unknown>) => ({
      ...b,
      table_assignments: calendarView ? [] : assignmentsMap.get(b.id as string) ?? [],
    }));

    if (unassignedTables) {
      const { data: venueRow } = await staff.db
        .from('venues')
        .select('table_management_enabled')
        .eq('id', staff.venue_id)
        .maybeSingle();
      if (venueRow?.table_management_enabled) {
        const active = new Set<string>(BOOKING_ACTIVE_STATUSES);
        enriched = enriched.filter((b: Record<string, unknown>) => {
          const assigns = (b.table_assignments as Array<unknown>) ?? [];
          if (typeof b.status !== 'string' || !active.has(b.status as string) || assigns.length > 0) {
            return false;
          }
          return isTableReservationBooking({
            experience_event_id: b.experience_event_id as string | null | undefined,
            class_instance_id: b.class_instance_id as string | null | undefined,
            resource_id: b.resource_id as string | null | undefined,
            event_session_id: b.event_session_id as string | null | undefined,
            calendar_id: b.calendar_id as string | null | undefined,
            service_item_id: b.service_item_id as string | null | undefined,
            practitioner_id: b.practitioner_id as string | null | undefined,
            appointment_service_id: b.appointment_service_id as string | null | undefined,
          });
        });
      }
    }

    return NextResponse.json({ bookings: enriched });
  } catch (err) {
    console.error('GET /api/venue/bookings/list failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
