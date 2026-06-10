import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import {
  computeAvailability,
  computeEffectiveMinSlotCoverCap,
  fetchEngineInput,
  resolveServiceForDate,
  timeToMinutes,
  getDayOfWeek,
} from '@/lib/availability';
import { nowInVenueTz, dietarySummary } from '@/lib/day-sheet';
import { resolveVenueMode } from '@/lib/venue-mode';
import { getDefaultAreaIdForVenue, listActiveAreasForVenue } from '@/lib/areas/resolve-default-area';
import { formatGuestDisplayName } from '@/lib/guests/name';

interface DaySheetBookingRow {
  id: string;
  booking_time: string;
  estimated_end_time: string | null;
  party_size: number;
  status: string;
  source: string;
  deposit_status: string;
  deposit_amount_pence: number | null;
  dietary_notes: string | null;
  special_requests: string | null;
  internal_notes: string | null;
  occasion: string | null;
  guest_id: string;
  created_at: string;
  booking_date: string;
  experience_event_id: string | null;
  class_instance_id: string | null;
  resource_id: string | null;
  event_session_id: string | null;
  calendar_id: string | null;
  service_item_id: string | null;
  practitioner_id: string | null;
  appointment_service_id: string | null;
  guest_attendance_confirmed_at: string | null;
  staff_attendance_confirmed_at: string | null;
  client_arrived_at: string | null;
  service_id: string | null;
  area_id: string | null;
  booking_model: string | null;
}

export interface DaySheetBooking {
  id: string;
  booking_time: string;
  estimated_end_time: string | null;
  party_size: number;
  status: string;
  source: string;
  deposit_status: string;
  deposit_amount_pence: number | null;
  dietary_notes: string | null;
  special_requests: string | null;
  internal_notes: string | null;
  occasion: string | null;
  guest_name: string;
  guest_phone: string | null;
  guest_email: string | null;
  guest_id: string;
  visit_count: number;
  no_show_count: number;
  last_visit_date: string | null;
  created_at: string;
  guest_tags: string[];
  experience_event_id: string | null;
  class_instance_id: string | null;
  resource_id: string | null;
  event_session_id: string | null;
  calendar_id: string | null;
  service_item_id: string | null;
  practitioner_id: string | null;
  appointment_service_id: string | null;
  guest_attendance_confirmed_at: string | null;
  staff_attendance_confirmed_at: string | null;
  client_arrived_at: string | null;
  /** Set when multiple dining areas exist and the sheet is not filtered to one area. */
  area_name?: string | null;
  booking_model?: string | null;
}

export interface DaySheetPeriod {
  key: string;
  label: string;
  start_time: string;
  end_time: string;
  max_covers: number | null;
  booked_covers: number;
  bookings: DaySheetBooking[];
}

function timeStr(t: string): string {
  return typeof t === 'string' ? t.slice(0, 5) : '12:00';
}

const ACTIVE_STATUSES = ['Pending', 'Booked', 'Confirmed', 'Seated'];

/** Narrow select for day-sheet list (avoid `*` payload). */
const DAY_SHEET_BOOKING_SELECT =
  'id, booking_time, estimated_end_time, party_size, booking_model, status, source, deposit_status, deposit_amount_pence, dietary_notes, special_requests, internal_notes, occasion, guest_id, created_at, booking_date, experience_event_id, class_instance_id, resource_id, event_session_id, calendar_id, service_item_id, practitioner_id, appointment_service_id, guest_attendance_confirmed_at, staff_attendance_confirmed_at, client_arrived_at, service_id, area_id';

/**
 * GET /api/venue/day-sheet?date=YYYY-MM-DD
 * Returns comprehensive day sheet data: periods with capacity, extended booking data,
 * guest history, and summary statistics.
 */
export async function GET(request: NextRequest) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { data: venue, error: venueErr } = await staff.db
      .from('venues')
      .select('id, name, timezone, table_management_enabled, no_show_grace_minutes')
      .eq('id', staff.venue_id)
      .single();

    if (venueErr || !venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 500 });
    }

    const tz = (venue.timezone as string) ?? 'Europe/London';
    const now = nowInVenueTz(tz);

    const requestedDate = request.nextUrl.searchParams.get('date');
    const dateStr = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
      ? requestedDate
      : now.dateStr;

    const areaUuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const areaParamRaw = request.nextUrl.searchParams.get('area');
    const areasForVenue = await listActiveAreasForVenue(staff.db, staff.venue_id);
    const areaParam =
      areaParamRaw && areaUuidRe.test(areaParamRaw) && areasForVenue.some((a) => a.id === areaParamRaw)
        ? areaParamRaw
        : null;

    let bookingQuery = staff.db
      .from('bookings')
      .select(DAY_SHEET_BOOKING_SELECT)
      .eq('venue_id', staff.venue_id)
      .eq('booking_date', dateStr);
    if (areaParam) {
      bookingQuery = bookingQuery.eq('area_id', areaParam);
    }
    const { data: bookingRows, error: bookErr } = await bookingQuery;

    if (bookErr) {
      console.error('GET /api/venue/day-sheet bookings failed:', bookErr);
      return NextResponse.json({ error: 'Failed to load bookings' }, { status: 500 });
    }

    const allBookings: DaySheetBookingRow[] = (bookingRows ?? []).map((b: Record<string, unknown>) => ({
      id: b.id as string,
      booking_time: timeStr(b.booking_time as string),
      estimated_end_time: b.estimated_end_time ? timeStr(b.estimated_end_time as string) : null,
      party_size: b.party_size as number,
      status: b.status as string,
      source: (b.source as string) ?? 'Phone',
      deposit_status: (b.deposit_status as string) ?? 'N/A',
      deposit_amount_pence: (b.deposit_amount_pence as number | null) ?? null,
      dietary_notes: (b.dietary_notes as string | null) ?? null,
      special_requests: (b.special_requests as string | null) ?? null,
      internal_notes: (b.internal_notes as string | null) ?? null,
      occasion: (b.occasion as string | null) ?? null,
      guest_id: b.guest_id as string,
      created_at: b.created_at as string,
      booking_date: b.booking_date as string,
      experience_event_id: (b.experience_event_id as string | null) ?? null,
      class_instance_id: (b.class_instance_id as string | null) ?? null,
      resource_id: (b.resource_id as string | null) ?? null,
      event_session_id: (b.event_session_id as string | null) ?? null,
      calendar_id: (b.calendar_id as string | null) ?? null,
      service_item_id: (b.service_item_id as string | null) ?? null,
      practitioner_id: (b.practitioner_id as string | null) ?? null,
      appointment_service_id: (b.appointment_service_id as string | null) ?? null,
      guest_attendance_confirmed_at: (b.guest_attendance_confirmed_at as string | null) ?? null,
      staff_attendance_confirmed_at: (b.staff_attendance_confirmed_at as string | null) ?? null,
      client_arrived_at: (b.client_arrived_at as string | null) ?? null,
      service_id: (b.service_id as string | null) ?? null,
      area_id: (b.area_id as string | null) ?? null,
      booking_model: (b.booking_model as string | null) ?? null,
    }));

    // Fetch guest details with visit history
    const guestIds = [...new Set(allBookings.map((b) => b.guest_id))];
    const { data: guestRows } = guestIds.length
      ? await staff.db
          .from('guests')
          .select('id, first_name, last_name, email, phone, visit_count, no_show_count, last_visit_date, tags')
          .in('id', guestIds)
      : { data: [] };
    const guestMap = new Map(
      (guestRows ?? []).map((g: {
        id: string;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
        phone: string | null;
        visit_count: number | null;
        no_show_count: number | null;
        last_visit_date: string | null;
        tags?: string[] | null;
      }) => [g.id, g]),
    );

    const areaNameById = new Map(areasForVenue.map((a) => [a.id, a.name]));
    const showAreaNamesOnRows = !areaParam && areasForVenue.length > 1;

    function toSheetBooking(row: DaySheetBookingRow): DaySheetBooking {
      const guest = guestMap.get(row.guest_id);
      return {
        id: row.id,
        booking_time: row.booking_time,
        estimated_end_time: row.estimated_end_time,
        party_size: row.party_size,
        status: row.status,
        source: row.source,
        deposit_status: row.deposit_status,
        deposit_amount_pence: row.deposit_amount_pence,
        dietary_notes: row.dietary_notes,
        special_requests: row.special_requests,
        internal_notes: row.internal_notes,
        occasion: row.occasion,
        guest_name: formatGuestDisplayName(guest?.first_name, guest?.last_name, 'walk-in'),
        guest_phone: guest?.phone ?? null,
        guest_email: guest?.email ?? null,
        guest_id: row.guest_id,
        visit_count: guest?.visit_count ?? 0,
        no_show_count: guest?.no_show_count ?? 0,
        last_visit_date: guest?.last_visit_date ?? null,
        created_at: row.created_at,
        guest_tags: Array.isArray(guest?.tags) ? guest.tags : [],
        experience_event_id: row.experience_event_id,
        class_instance_id: row.class_instance_id,
        resource_id: row.resource_id,
        event_session_id: row.event_session_id,
        calendar_id: row.calendar_id,
        service_item_id: row.service_item_id,
        practitioner_id: row.practitioner_id,
        appointment_service_id: row.appointment_service_id,
        guest_attendance_confirmed_at: row.guest_attendance_confirmed_at,
        staff_attendance_confirmed_at: row.staff_attendance_confirmed_at,
        client_arrived_at: row.client_arrived_at,
        booking_model: row.booking_model,
        ...(showAreaNamesOnRows && row.area_id
          ? { area_name: areaNameById.get(row.area_id) ?? null }
          : {}),
      };
    }

    // Resolve service periods
    const venueMode = await resolveVenueMode(staff.db, staff.venue_id);
    const periods: DaySheetPeriod[] = [];
    let capacityConfigured = false;
    let serviceDurationMin: number | null = null;

    // Track assigned booking IDs to prevent a booking from appearing in multiple periods
    const assignedBookingIds = new Set<string>();

    if (venueMode.availabilityEngine === 'service') {
      const defaultAreaId = await getDefaultAreaIdForVenue(staff.db, staff.venue_id);
      const engineAreas =
        areaParam != null
          ? [{ id: areaParam, name: areaNameById.get(areaParam) ?? 'Area' }]
          : areasForVenue.length > 0
            ? areasForVenue
            : defaultAreaId
              ? [{ id: defaultAreaId, name: 'Dining' }]
              : [];

      if (engineAreas.length === 0) {
        const engineInput = await fetchEngineInput({
          supabase: staff.db,
          venueId: staff.venue_id,
          date: dateStr,
          partySize: 1,
          areaId: null,
        });
        const serviceResults = computeAvailability(engineInput);
        if (engineInput.durations.length > 0) {
          serviceDurationMin = engineInput.durations[0]!.duration_minutes;
        }
        const dayOfWeek = getDayOfWeek(dateStr);
        for (const result of serviceResults) {
          const service = result.service;
          const effectiveService = resolveServiceForDate(
            service,
            engineInput.schedule_exceptions,
            staff.venue_id,
            dateStr,
            dayOfWeek,
          );
          if (!effectiveService) continue;
          const startMin = timeToMinutes(effectiveService.start_time);
          const endMin = timeToMinutes(effectiveService.end_time);
          const rules = engineInput.capacity_rules.filter((r) => r.service_id === service.id);
          const dayRule = rules.find((r) => r.day_of_week === dayOfWeek && !r.time_range_start);
          const defaultRule = rules.find((r) => r.day_of_week == null && !r.time_range_start);
          const rule = dayRule ?? defaultRule;
          const effectiveMax = computeEffectiveMinSlotCoverCap(
            engineInput,
            service,
            effectiveService,
            dayOfWeek,
          );
          const maxCovers = effectiveMax ?? rule?.max_covers_per_slot ?? null;
          if (maxCovers != null) capacityConfigured = true;
          const periodBookings = allBookings
            .filter((b) => {
              if (assignedBookingIds.has(b.id)) return false;
              const bMin = timeToMinutes(b.booking_time);
              if (!(bMin >= startMin && bMin < endMin)) return false;
              if (b.service_id && b.service_id !== service.id) return false;
              return true;
            })
            .map((b) => {
              assignedBookingIds.add(b.id);
              return b;
            })
            .map(toSheetBooking)
            .sort((a, b) => a.booking_time.localeCompare(b.booking_time));
          const bookedCovers = periodBookings
            .filter((b) => ACTIVE_STATUSES.includes(b.status))
            .reduce((sum, b) => sum + b.party_size, 0);
          periods.push({
            key: service.id,
            label: service.name,
            start_time: effectiveService.start_time.slice(0, 5),
            end_time: effectiveService.end_time.slice(0, 5),
            max_covers: maxCovers,
            booked_covers: bookedCovers,
            bookings: periodBookings,
          });
        }
      }

      const perAreaEngine = await Promise.all(
        engineAreas.map(async (area) => {
          const engineInput = await fetchEngineInput({
            supabase: staff.db,
            venueId: staff.venue_id,
            date: dateStr,
            partySize: 1,
            areaId: area.id,
          });
          const serviceResults = computeAvailability(engineInput);
          return { area, engineInput, serviceResults };
        }),
      );

      for (const { area, engineInput, serviceResults } of perAreaEngine) {
        if (serviceDurationMin == null && engineInput.durations.length > 0) {
          serviceDurationMin = engineInput.durations[0]!.duration_minutes;
        }

        const dayOfWeek = getDayOfWeek(dateStr);
        const multiAreaLabels = !areaParam && areasForVenue.length > 1;

        for (const result of serviceResults) {
          const service = result.service;

          const effectiveService = resolveServiceForDate(
            service,
            engineInput.schedule_exceptions,
            staff.venue_id,
            dateStr,
            dayOfWeek,
          );
          if (!effectiveService) continue;

          const startMin = timeToMinutes(effectiveService.start_time);
          const endMin = timeToMinutes(effectiveService.end_time);

          const rules = engineInput.capacity_rules.filter((r) => r.service_id === service.id);
          const dayRule = rules.find((r) => r.day_of_week === dayOfWeek && !r.time_range_start);
          const defaultRule = rules.find((r) => r.day_of_week == null && !r.time_range_start);
          const rule = dayRule ?? defaultRule;

          const effectiveMax = computeEffectiveMinSlotCoverCap(
            engineInput,
            service,
            effectiveService,
            dayOfWeek,
          );
          const maxCovers = effectiveMax ?? rule?.max_covers_per_slot ?? null;
          if (maxCovers != null) capacityConfigured = true;

          const periodBookings = allBookings
            .filter((b) => {
              if (assignedBookingIds.has(b.id)) return false;
              const bMin = timeToMinutes(b.booking_time);
              if (!(bMin >= startMin && bMin < endMin)) return false;
              if (b.service_id && b.service_id !== service.id) return false;
              if (b.area_id && b.area_id !== area.id) return false;
              return true;
            })
            .map((b) => {
              assignedBookingIds.add(b.id);
              return b;
            })
            .map(toSheetBooking)
            .sort((a, b) => a.booking_time.localeCompare(b.booking_time));

          const bookedCovers = periodBookings
            .filter((b) => ACTIVE_STATUSES.includes(b.status))
            .reduce((sum, b) => sum + b.party_size, 0);

          periods.push({
            key: multiAreaLabels ? `${area.id}:${service.id}` : service.id,
            label: multiAreaLabels ? `${service.name} — ${area.name}` : service.name,
            start_time: effectiveService.start_time.slice(0, 5),
            end_time: effectiveService.end_time.slice(0, 5),
            max_covers: maxCovers,
            booked_covers: bookedCovers,
            bookings: periodBookings,
          });
        }
      }
    } else {
      const mapped = allBookings
        .map((b) => {
          assignedBookingIds.add(b.id);
          return b;
        })
        .map(toSheetBooking)
        .sort((a, b) => a.booking_time.localeCompare(b.booking_time));

      const bookedCovers = mapped
        .filter((b) => ACTIVE_STATUSES.includes(b.status))
        .reduce((sum, b) => sum + b.party_size, 0);

      periods.push({
        key: 'all',
        label: 'All Bookings',
        start_time: '00:00',
        end_time: '23:59',
        max_covers: null,
        booked_covers: bookedCovers,
        bookings: mapped,
      });
    }

    // Assign bookings not falling in any period to an "Other" group
    const unassigned = allBookings.filter((b) => !assignedBookingIds.has(b.id));
    if (unassigned.length > 0) {
      const mapped = unassigned.map(toSheetBooking).sort((a, b) => a.booking_time.localeCompare(b.booking_time));
      const bookedCovers = mapped
        .filter((b) => ACTIVE_STATUSES.includes(b.status))
        .reduce((sum, b) => sum + b.party_size, 0);
      periods.push({
        key: 'other',
        label: 'Other',
        start_time: '00:00',
        end_time: '23:59',
        max_covers: null,
        booked_covers: bookedCovers,
        bookings: mapped,
      });
    }

    // Summary - deduplicate by booking ID as a safety net
    const allMappedRaw = periods.flatMap((p) => p.bookings);
    const seenIds = new Set<string>();
    const allMapped = allMappedRaw.filter((b) => {
      if (seenIds.has(b.id)) return false;
      seenIds.add(b.id);
      return true;
    });
    const totalBookings = allMapped.filter((b) => b.status !== 'Cancelled').length;
    const totalCovers = allMapped
      .filter((b) => ACTIVE_STATUSES.includes(b.status))
      .reduce((s, b) => s + b.party_size, 0);
    const pendingCount = allMapped.filter((b) => b.status === 'Pending').length;
    const seatedCovers = allMapped
      .filter((b) => b.status === 'Seated')
      .reduce((s, b) => s + b.party_size, 0);
    const completedCovers = allMapped
      .filter((b) => b.status === 'Completed')
      .reduce((s, b) => s + b.party_size, 0);
    const noShowCovers = allMapped
      .filter((b) => b.status === 'No-Show')
      .reduce((s, b) => s + b.party_size, 0);
    const cancelledCovers = allMapped
      .filter((b) => b.status === 'Cancelled')
      .reduce((s, b) => s + b.party_size, 0);

    // Venue-level max CONCURRENT capacity (physical seats - the most covers that can be
    // seated at the same time). Use MAX across periods, not SUM, because all periods
    // share the same physical space.
    let venueMaxCapacity: number | null = null;
    if (capacityConfigured && venueMode.availabilityEngine === 'service') {
      const caps = periods.map((p) => p.max_covers ?? 0).filter((c) => c > 0);
      venueMaxCapacity = caps.length > 0 ? Math.max(...caps) : null;
    }

    const coversRemaining = venueMaxCapacity != null ? Math.max(0, venueMaxCapacity - totalCovers) : null;

    // Time-aware fields (meaningful when viewing today)
    const isToday = dateStr === now.dateStr;
    const nowMinutes = now.minutesSinceMidnight;

    let defaultDurationMin = 90;
    if (serviceDurationMin != null) {
      defaultDurationMin = serviceDurationMin;
    }

    // Covers currently in use (Seated right now)
    const coversInUse = seatedCovers;

    // Available right now: venue capacity minus seated covers
    const coversAvailableNow = venueMaxCapacity != null ? Math.max(0, venueMaxCapacity - coversInUse) : null;

    // Covers freeing up in next 30 minutes (seated bookings whose estimated end time is within 30 mins)
    const freeingSoon = isToday
      ? allMapped
          .filter((b) => {
            if (b.status !== 'Seated') return false;
            const startMin = timeToMinutes(b.booking_time);
            const endMin = b.estimated_end_time
              ? timeToMinutes(b.estimated_end_time)
              : startMin + defaultDurationMin;
            return endMin > nowMinutes && endMin <= nowMinutes + 30;
          })
          .reduce((s, b) => s + b.party_size, 0)
      : 0;

    // Covers arriving in next 30 minutes (confirmed/pending bookings about to start)
    const arrivingSoon = isToday
      ? allMapped
          .filter((b) => {
            if (b.status !== 'Confirmed' && b.status !== 'Booked' && b.status !== 'Pending') return false;
            const startMin = timeToMinutes(b.booking_time);
            return startMin > nowMinutes && startMin <= nowMinutes + 30;
          })
          .reduce((s, b) => s + b.party_size, 0)
      : 0;

    // Fetch active venue tables for table status strip + selector
    let venueTablesQuery = staff.db
      .from('venue_tables')
      .select('id, name, max_covers, sort_order')
      .eq('venue_id', staff.venue_id)
      .eq('is_active', true)
      .order('sort_order');
    if (areaParam) {
      venueTablesQuery = venueTablesQuery.eq('area_id', areaParam);
    }
    const { data: venueTablesRows } = await venueTablesQuery;
    const activeTables = (venueTablesRows ?? []).map((t: { id: string; name: string; max_covers: number; sort_order: number }) => ({
      id: t.id,
      name: t.name,
      max_covers: t.max_covers,
      sort_order: t.sort_order,
    }));

    // Fetch table assignments for today's bookings
    const bookingIds = allBookings.map((b) => b.id);
    const assignmentsMap = new Map<string, Array<{ id: string; name: string }>>();
    if (bookingIds.length > 0 && activeTables.length > 0) {
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

    // Attach table_assignments to each booking in periods
    for (const period of periods) {
      for (const booking of period.bookings) {
        (booking as DaySheetBooking & { table_assignments?: Array<{ id: string; name: string }> }).table_assignments =
          assignmentsMap.get(booking.id) ?? [];
      }
    }

    // Dietary summary (only active bookings - includes special_requests for allergy detection)
    const dietaryInput = allBookings
      .filter((b) => ACTIVE_STATUSES.includes(b.status))
      .map((b) => ({ dietary_notes: b.dietary_notes, occasion: b.occasion, special_requests: b.special_requests }));
    const dietary = dietarySummary(dietaryInput);

    return NextResponse.json({
      date: dateStr,
      venue_name: (venue.name as string) ?? '',
      areas: areasForVenue.map((a) => ({ id: a.id, name: a.name, colour: a.colour })),
      selected_area_id: areaParam,
      periods,
      summary: {
        total_bookings: totalBookings,
        total_covers: totalCovers,
        covers_remaining: coversRemaining,
        pending_count: pendingCount,
        seated_covers: seatedCovers,
        completed_covers: completedCovers,
        no_show_covers: noShowCovers,
        cancelled_covers: cancelledCovers,
        venue_max_capacity: venueMaxCapacity,
        covers_in_use: coversInUse,
        covers_available_now: coversAvailableNow,
        freeing_soon: freeingSoon,
        arriving_soon: arrivingSoon,
        is_today: isToday,
        default_duration_minutes: defaultDurationMin,
      },
      dietary_summary: dietary,
      no_show_grace_minutes: Math.min(60, Math.max(10, venue.no_show_grace_minutes ?? 15)),
      capacity_configured: capacityConfigured,
      active_tables: activeTables,
    });
  } catch (err) {
    console.error('GET /api/venue/day-sheet failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    if (process.env.DEBUG_PERF_API === '1' && typeof performance !== 'undefined') {
      console.info('[GET /api/venue/day-sheet]', { ms: Math.round(performance.now() - t0) });
    }
  }
}
