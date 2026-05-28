import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveCallerGrantOverVenue } from '@/lib/linked-accounts/queries';
import type { LinkGrant } from '@/lib/linked-accounts/types';
import {
  formatGuestDisplayName,
  mergeBookingSnapshotWithGuestProfile,
  normaliseGuestNamePart,
} from '@/lib/guests/name';
import { BOOKING_ACTIVE_STATUSES } from '@/lib/table-management/constants';
import { isTableReservationBooking } from '@/lib/booking/infer-booking-row-model';
import { resolveBookingListRowLabels } from '@/lib/booking/booking-list-row-label';
import { calendarDateInTimeZone } from '@/lib/guests/guest-contacts-list';

/**
 * GET /api/venue/bookings/list?date=YYYY-MM-DD&status=Pending|Seated|...
 * or  /api/venue/bookings/list?from=YYYY-MM-DD&to=YYYY-MM-DD&status=...
 * Optional: `guest=<uuid>&guest_history=1` — bookings for that guest across a wide venue-local date window (max 250 rows); use with `guest` filter.
 * Optional: `owner_venue_id=<uuid>` with `guest_history=1` — load history for a linked owner venue (requires an active link grant).
 * Optional: `owner_venue_id=<uuid>` with `experience_event_id` or `class_instance_id` — session bookings for a linked owner venue (requires full_details calendar grant).
 * Optional: service=<uuid>[,<uuid>...] filters table reservations by venue_services.id.
 * Optional: calendar=<uuid> filters schedule bookings by calendar/practitioner/resource id.
 * Optional: experience_event_id=<uuid> or class_instance_id=<uuid> — all bookings for that session (no date range required).
 * Optional: attendance_confirmed=1 — bookings where the guest confirmed via reminder link (guest_attendance_confirmed_at)
 *   or staff pressed Confirm Booking (staff_attendance_confirmed_at). When set, `status` is ignored.
 * Returns bookings for the authenticated venue, with guest name.
 * Sorted by date then time.
 *
 * `view=calendar` — staff schedule grid: narrower row shape, skips table-assignment query (faster for wide date ranges).
 *   Cancelled bookings are excluded from this view by default; pass `status=Cancelled` to opt in.
 */
const BOOKINGS_LIST_SELECT_FULL =
  'id, booking_date, booking_time, party_size, booking_model, status, source, deposit_status, deposit_amount_pence, dietary_notes, occasion, special_requests, internal_notes, client_arrived_at, guest_attendance_confirmed_at, staff_attendance_confirmed_at, estimated_end_time, created_at, guest_id, guest_first_name, guest_last_name, service_id, practitioner_id, appointment_service_id, calendar_id, service_item_id, service_variant_id, processing_time_blocks, experience_event_id, class_instance_id, resource_id, booking_end_time, event_session_id, group_booking_id, person_label, area_id, addons_total_price_pence, addons_total_duration_minutes';

/** Omits columns not used by the practitioner calendar grid to reduce payload and DB I/O. */
const BOOKINGS_LIST_SELECT_CALENDAR =
  'id, booking_date, booking_time, party_size, booking_model, status, source, deposit_status, deposit_amount_pence, special_requests, internal_notes, client_arrived_at, guest_attendance_confirmed_at, staff_attendance_confirmed_at, estimated_end_time, guest_id, guest_first_name, guest_last_name, service_id, practitioner_id, appointment_service_id, calendar_id, service_item_id, service_variant_id, processing_time_blocks, experience_event_id, class_instance_id, resource_id, booking_end_time, event_session_id, group_booking_id, person_label, area_id, addons_total_price_pence, addons_total_duration_minutes';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
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
    /**
     * The dashboard calendar grid shows what is currently scheduled, so cancelled
     * bookings are excluded from `view=calendar` responses unless the caller has
     * explicitly opted in via `status=Cancelled`.
     */
    const calendarExcludeCancelled = calendarView && statusFilter !== 'Cancelled';
    const attendanceConfirmedFilter = request.nextUrl.searchParams.get('attendance_confirmed') === '1';
    const groupBookingId = request.nextUrl.searchParams.get('group_booking_id');
    const unassignedTables = request.nextUrl.searchParams.get('unassigned_tables') === '1';
    const guestIdParam = request.nextUrl.searchParams.get('guest');
    const areaIdParam = request.nextUrl.searchParams.get('area');
    const serviceIdParam = request.nextUrl.searchParams.get('service');
    const calendarIdParam = request.nextUrl.searchParams.get('calendar');
    const experienceEventIdParam = request.nextUrl.searchParams.get('experience_event_id');
    const classInstanceIdParam = request.nextUrl.searchParams.get('class_instance_id');
    const isoRe = /^\d{4}-\d{2}-\d{2}$/;
    const guestUuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const ownerVenueIdParam = request.nextUrl.searchParams.get('owner_venue_id');
    const guestHistoryMode =
      guestIdParam &&
      guestUuidRe.test(guestIdParam) &&
      request.nextUrl.searchParams.get('guest_history') === '1';

    let scopeVenueId = staff.venue_id;
    let scopeDb = staff.db;
    let linkedGuestHistoryGrant: LinkGrant | null = null;

    const linkedOwnerVenueId =
      ownerVenueIdParam &&
      guestUuidRe.test(ownerVenueIdParam) &&
      ownerVenueIdParam !== staff.venue_id
        ? ownerVenueIdParam
        : null;

    const linkedSessionMode =
      linkedOwnerVenueId != null &&
      Boolean(
        (experienceEventIdParam && guestUuidRe.test(experienceEventIdParam)) ||
          (classInstanceIdParam && guestUuidRe.test(classInstanceIdParam)),
      );

    if (linkedOwnerVenueId && (guestHistoryMode || linkedSessionMode)) {
      const admin = getSupabaseAdminClient();
      const access = await resolveCallerGrantOverVenue(admin, staff.venue_id, linkedOwnerVenueId);
      if (!access || access.grant.calendar === 'none') {
        return NextResponse.json(
          { error: 'You do not have access to bookings for that venue.' },
          { status: 403 },
        );
      }
      if (linkedSessionMode && access.grant.calendar === 'time_only') {
        return NextResponse.json(
          { error: 'This link only shows busy time — session bookings are not available.' },
          { status: 403 },
        );
      }
      scopeVenueId = linkedOwnerVenueId;
      scopeDb = admin;
      linkedGuestHistoryGrant = access.grant;
    }

    /** Separate branches avoid a ternary on `.select(...)` which triggers excessively deep Supabase generics. */
    let query = calendarView
      ? scopeDb
          .from('bookings')
          .select(BOOKINGS_LIST_SELECT_CALENDAR)
          .eq('venue_id', scopeVenueId)
          .order('booking_date', { ascending: true })
          .order('booking_time', { ascending: true })
      : scopeDb
          .from('bookings')
          .select(BOOKINGS_LIST_SELECT_FULL)
          .eq('venue_id', scopeVenueId)
          .order('booking_date', { ascending: true })
          .order('booking_time', { ascending: true });

    if (calendarExcludeCancelled) {
      query = query.neq('status', 'Cancelled');
    }

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
    } else if (experienceEventIdParam && guestUuidRe.test(experienceEventIdParam)) {
      query = query.eq('experience_event_id', experienceEventIdParam);
    } else if (classInstanceIdParam && guestUuidRe.test(classInstanceIdParam)) {
      query = query.eq('class_instance_id', classInstanceIdParam);
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
    } else if (guestHistoryMode) {
      const { data: vTzRow } = await scopeDb
        .from('venues')
        .select('timezone')
        .eq('id', scopeVenueId)
        .maybeSingle();
      const tzRaw = (vTzRow as { timezone?: string | null } | null)?.timezone;
      const tz = typeof tzRaw === 'string' && tzRaw.trim() !== '' ? tzRaw.trim() : 'Europe/London';
      const y = Number.parseInt(calendarDateInTimeZone(new Date(), tz).slice(0, 4), 10);
      const fromWide = `${Number.isFinite(y) ? y - 4 : 1970}-01-01`;
      const toWide = `${Number.isFinite(y) ? y + 4 : 2100}-12-31`;
      query = query.gte('booking_date', fromWide).lte('booking_date', toWide).limit(250);
    } else {
      return NextResponse.json(
        {
          error:
            'Provide date=YYYY-MM-DD or from=...&to=... or ids=..., experience_event_id=..., class_instance_id=..., or guest=guestId&guest_history=1',
        },
        { status: 400 },
      );
    }

    const { data: rows, error } = await query;

    if (error) {
      console.error('GET /api/venue/bookings/list failed:', error);
      return NextResponse.json({ error: 'Failed to load bookings' }, { status: 500 });
    }

    type RawBookingRow = Record<string, unknown> & { guest_id: string };
    const rawRows = (rows ?? []) as RawBookingRow[];

    // Count chosen add-ons per booking for the "+N extras" chip. One batched query
    // scoped to the page's booking ids; booking_addons is indexed on booking_id.
    const bookingIdsForAddons = [
      ...new Set(rawRows.map((r) => r.id).filter((x): x is string => typeof x === 'string')),
    ];
    const addonCountByBooking = new Map<string, number>();
    if (bookingIdsForAddons.length > 0) {
      const { data: addonRows } = await scopeDb
        .from('booking_addons')
        .select('booking_id')
        .in('booking_id', bookingIdsForAddons);
      for (const row of (addonRows ?? []) as Array<{ booking_id: string }>) {
        addonCountByBooking.set(row.booking_id, (addonCountByBooking.get(row.booking_id) ?? 0) + 1);
      }
    }

    const guestIds = [...new Set(rawRows.map((r) => r.guest_id))];
    const { data: guestsRows } = guestIds.length
      ? await scopeDb
          .from('guests')
          .select('id, first_name, last_name, email, phone, visit_count, tags')
          .in('id', guestIds)
      : { data: [] };
    const guestsMap = new Map(
      (guestsRows ?? []).map(
        (g: {
          id: string;
          first_name: string | null;
          last_name: string | null;
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
        ? await scopeDb.from('areas').select('id, name').in('id', areaIds)
        : { data: [] as { id: string; name: string }[] };
    const areaNameById = new Map((areaRows ?? []).map((a: { id: string; name: string }) => [a.id, a.name]));

    const calendarIds = [
      ...new Set(
        rawRows
          .map((r) => r.calendar_id as string | null | undefined)
          .filter((cid): cid is string => typeof cid === 'string' && cid.trim() !== ''),
      ),
    ];
    const calendarNameById = new Map<string, string>();
    if (calendarIds.length > 0) {
      const { data: calRows } = await scopeDb
        .from('unified_calendars')
        .select('id, name')
        .eq('venue_id', scopeVenueId)
        .in('id', calendarIds);
      for (const c of calRows ?? []) {
        const row = c as { id: string; name?: string | null };
        const label = typeof row.name === 'string' ? row.name.trim() : '';
        if (label) calendarNameById.set(row.id, label);
      }
    }

    let bookings = rawRows.map((r) => {
      const guest = guestsMap.get(r.guest_id);
      const aid = r.area_id as string | null | undefined;
      const merged = mergeBookingSnapshotWithGuestProfile({
        booking_guest_first_name: r.guest_first_name as string | null | undefined,
        booking_guest_last_name: r.guest_last_name as string | null | undefined,
        profile_first_name: guest?.first_name,
        profile_last_name: guest?.last_name,
      });
      const snapshotPresent =
        Boolean(normaliseGuestNamePart(r.guest_first_name as string | null | undefined)) ||
        Boolean(normaliseGuestNamePart(r.guest_last_name as string | null | undefined));
      const guestLabel =
        guest || snapshotPresent ? formatGuestDisplayName(merged.first, merged.last) : '-';
      const canSeeLinkedPii = !linkedGuestHistoryGrant || linkedGuestHistoryGrant.pii;
      return {
        id: r.id,
        booking_date: r.booking_date,
        booking_time: r.booking_time,
        party_size: r.party_size,
        booking_model: r.booking_model ?? null,
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
        guest_name: guestLabel,
        booking_guest_first_name: normaliseGuestNamePart(r.guest_first_name as string | null | undefined),
        booking_guest_last_name: normaliseGuestNamePart(r.guest_last_name as string | null | undefined),
        guest_first_name: merged.first,
        guest_last_name: merged.last,
        guest_email: canSeeLinkedPii ? (guest?.email ?? null) : null,
        guest_phone: canSeeLinkedPii ? (guest?.phone ?? null) : null,
        guest_visit_count: canSeeLinkedPii ? (guest?.visit_count ?? null) : null,
        guest_tags: canSeeLinkedPii && Array.isArray(guest?.tags) ? guest.tags : [],
        service_id: r.service_id ?? null,
        practitioner_id: r.practitioner_id ?? null,
        calendar_id: r.calendar_id ?? null,
        calendar_name:
          typeof r.calendar_id === 'string' && r.calendar_id.trim() !== ''
            ? calendarNameById.get(r.calendar_id) ?? null
            : null,
        appointment_service_id: r.appointment_service_id ?? null,
        service_item_id: r.service_item_id ?? null,
        service_variant_id: r.service_variant_id ?? null,
        processing_time_blocks: r.processing_time_blocks ?? null,
        experience_event_id: r.experience_event_id ?? null,
        class_instance_id: r.class_instance_id ?? null,
        resource_id: r.resource_id ?? null,
        event_session_id: r.event_session_id ?? null,
        group_booking_id: r.group_booking_id ?? null,
        person_label: r.person_label ?? null,
        area_id: aid ?? null,
        area_name: aid ? areaNameById.get(aid) ?? null : null,
        addons_total_price_pence: (r.addons_total_price_pence as number | null) ?? 0,
        addons_total_duration_minutes: (r.addons_total_duration_minutes as number | null) ?? 0,
        addons_count: addonCountByBooking.get(r.id as string) ?? 0,
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
      const { data: assignRows } = await scopeDb
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
            booking_model: b.booking_model as string | null | undefined,
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

    const labelRows = enriched.map((b: Record<string, unknown>) => ({
      id: b.id as string,
      booking_model: b.booking_model as string | null | undefined,
      experience_event_id: b.experience_event_id as string | null | undefined,
      class_instance_id: b.class_instance_id as string | null | undefined,
      resource_id: b.resource_id as string | null | undefined,
      event_session_id: b.event_session_id as string | null | undefined,
      calendar_id: b.calendar_id as string | null | undefined,
      service_item_id: b.service_item_id as string | null | undefined,
      practitioner_id: b.practitioner_id as string | null | undefined,
      appointment_service_id: b.appointment_service_id as string | null | undefined,
      service_id: b.service_id as string | null | undefined,
    }));
    const labelById = await resolveBookingListRowLabels(scopeDb, labelRows);
    const withItemNames = enriched.map((b: Record<string, unknown>) => ({
      ...b,
      booking_item_name: labelById.get(b.id as string) ?? null,
    }));

    return NextResponse.json({ bookings: withItemNames });
  } catch (err) {
    console.error('GET /api/venue/bookings/list failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
