/**
 * Month-level table-reservation availability for the visual calendar date picker.
 *
 * Fetches all month-scoped source data in a single parallel batch, then evaluates
 * each day in memory using the same service engine as the per-day availability
 * endpoint. This avoids 28–31 separate DB round-trips.
 *
 * Note: physical table-management filtering (combination engine) is intentionally
 * omitted here — the service engine covers the vast majority of cases and keeping
 * this path lightweight is important for calendar load latency.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { computeAvailability } from '@/lib/availability/engine';
import { listActiveAreasForVenue } from '@/lib/areas/resolve-default-area';
import type {
  AvailabilityBlock,
  BookingForEngine,
  BookingRestriction,
  BookingRestrictionException,
  EngineInput,
  PartySizeDuration,
  ServiceCapacityRule,
  ServiceScheduleException,
  VenueService,
} from '@/types/availability';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function monthBounds(year: number, month: number): { monthStart: string; monthEnd: string; dates: string[] } {
  const lastDay = new Date(year, month, 0).getDate(); // month is 1-indexed here; new Date(y, m, 0) = last day of m
  const dates = Array.from({ length: lastDay }, (_, i) => `${year}-${pad2(month)}-${pad2(i + 1)}`);
  return { monthStart: dates[0]!, monthEnd: dates[dates.length - 1]!, dates };
}

function depositFromJson(cfg: unknown): number | null {
  if (!cfg || typeof cfg !== 'object') return null;
  const n = (cfg as { amount_per_person_gbp?: unknown }).amount_per_person_gbp;
  return typeof n === 'number' && !Number.isNaN(n) ? n : null;
}

/**
 * Returns YYYY-MM-DD strings within the given month where the venue has at
 * least one available table-reservation slot for `partySize` guests.
 *
 * @param month 1-indexed (January = 1)
 */
export async function computeTableAvailableDatesInMonth(
  supabase: SupabaseClient,
  venueId: string,
  year: number,
  month: number,
  partySize: number,
  areaId?: string | null,
): Promise<string[]> {
  const { monthStart, monthEnd, dates } = monthBounds(year, month);
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

  // Resolve areas — mirror the same logic as the per-day availability route
  const areas = await listActiveAreasForVenue(supabase, venueId);
  if (areas.length === 0) return [];

  const areasToEvaluate = areaId
    ? areas.filter((a) => a.id === areaId)
    : areas;
  if (areasToEvaluate.length === 0) return [];

  // ── Fetch static / month-scoped data for each area in parallel ───────────
  const areaDataResults = await Promise.all(
    areasToEvaluate.map((area) => fetchAreaMonthData(supabase, venueId, area.id, monthStart, monthEnd)),
  );

  // Venue-level deposit config (shared across areas)
  const { data: venueRow } = await supabase
    .from('venues')
    .select('deposit_config')
    .eq('id', venueId)
    .single();
  const venueDeposit = depositFromJson(venueRow?.deposit_config);

  // ── Evaluate each date ────────────────────────────────────────────────────
  const availableDates: string[] = [];

  for (const dateStr of dates) {
    // Skip past dates — no point showing green on days already gone
    if (dateStr < todayStr) continue;

    let dateHasSlots = false;

    for (const areaData of areaDataResults) {
      if (dateHasSlots) break;

      const bookingsForDate = areaData.bookingsByDate.get(dateStr) ?? [];
      const blocksForDate = areaData.allBlocks.filter(
        (b) => b.date_start <= dateStr && b.date_end >= dateStr,
      );
      const schedExcForDate = areaData.allScheduleExc.filter(
        (e) => e.date_start <= dateStr && e.date_end >= dateStr,
      );
      const restrictExcForDate = areaData.allRestrictionExc.filter(
        (e) => e.date_start <= dateStr && e.date_end >= dateStr,
      );

      const deposit_legacy =
        depositFromJson(areaData.areaDeposit) ?? venueDeposit;

      const input: EngineInput = {
        venue_id: venueId,
        date: dateStr,
        party_size: partySize,
        services: areaData.services,
        capacity_rules: areaData.capacityRules,
        durations: areaData.durations,
        restrictions: areaData.restrictions,
        blocks: blocksForDate,
        bookings: bookingsForDate,
        schedule_exceptions: schedExcForDate,
        restriction_exceptions: restrictExcForDate,
        deposit_legacy_amount_per_person_gbp: deposit_legacy,
        now,
      };

      const results = computeAvailability(input);
      if (results.some((r) => r.slots.length > 0)) {
        dateHasSlots = true;
      }
    }

    if (dateHasSlots) {
      availableDates.push(dateStr);
    }
  }

  return availableDates;
}

// ── Per-area data bundle ──────────────────────────────────────────────────

interface AreaMonthData {
  services: VenueService[];
  capacityRules: ServiceCapacityRule[];
  durations: PartySizeDuration[];
  restrictions: BookingRestriction[];
  areaDeposit: unknown;
  bookingsByDate: Map<string, BookingForEngine[]>;
  allBlocks: AvailabilityBlock[];
  allScheduleExc: ServiceScheduleException[];
  allRestrictionExc: BookingRestrictionException[];
}

async function fetchAreaMonthData(
  supabase: SupabaseClient,
  venueId: string,
  areaId: string,
  monthStart: string,
  monthEnd: string,
): Promise<AreaMonthData> {
  // Fetch services first (needed to get service IDs for subsequent queries)
  const { data: servicesRaw } = await supabase
    .from('venue_services')
    .select('id, venue_id, name, days_of_week, start_time, end_time, last_booking_time, is_active, sort_order')
    .eq('venue_id', venueId)
    .eq('area_id', areaId)
    .eq('is_active', true);

  const services: VenueService[] = (servicesRaw ?? []).map((r) => ({
    ...r,
    start_time: String(r.start_time).slice(0, 5),
    end_time: String(r.end_time).slice(0, 5),
    last_booking_time: String(r.last_booking_time).slice(0, 5),
  }));

  const serviceIds = services.map((s) => s.id);

  // Fetch everything else in parallel
  const [
    capacityRulesRes,
    durationsRes,
    restrictionsRes,
    areaRes,
    bookingsRes,
    blocksRes,
    scheduleExcRes,
    restrictionExcRes,
  ] = await Promise.all([
    serviceIds.length > 0
      ? supabase
          .from('service_capacity_rules')
          .select('id, service_id, max_covers_per_slot, max_bookings_per_slot, slot_interval_minutes, buffer_minutes, day_of_week, time_range_start, time_range_end')
          .in('service_id', serviceIds)
      : Promise.resolve({ data: [] }),
    serviceIds.length > 0
      ? supabase
          .from('party_size_durations')
          .select('id, service_id, min_party_size, max_party_size, duration_minutes, day_of_week')
          .in('service_id', serviceIds)
      : Promise.resolve({ data: [] }),
    serviceIds.length > 0
      ? supabase
          .from('booking_restrictions')
          .select('id, service_id, min_advance_minutes, max_advance_days, min_party_size_online, max_party_size_online, large_party_threshold, large_party_message, deposit_required_from_party_size, deposit_amount_per_person_gbp, online_requires_deposit, cancellation_notice_hours')
          .in('service_id', serviceIds)
      : Promise.resolve({ data: [] }),
    supabase.from('areas').select('deposit_config').eq('id', areaId).maybeSingle(),
    // Bookings for the whole month (grouped by date in-memory)
    supabase
      .from('bookings')
      .select('id, booking_date, booking_time, party_size, status, service_id, estimated_end_time')
      .eq('venue_id', venueId)
      .eq('area_id', areaId)
      .gte('booking_date', monthStart)
      .lte('booking_date', monthEnd),
    // Availability blocks that overlap the month
    supabase
      .from('availability_blocks')
      .select('id, venue_id, area_id, service_id, block_type, date_start, date_end, time_start, time_end, override_max_covers, reason, yield_overrides, override_periods')
      .eq('venue_id', venueId)
      .lte('date_start', monthEnd)
      .gte('date_end', monthStart),
    // Schedule exceptions that overlap the month
    supabase
      .from('service_schedule_exceptions')
      .select('id, venue_id, service_id, date_start, date_end, is_closed, opens_extra_day, start_time, end_time, last_booking_time, reason')
      .eq('venue_id', venueId)
      .lte('date_start', monthEnd)
      .gte('date_end', monthStart),
    // Restriction exceptions that overlap the month
    supabase
      .from('booking_restriction_exceptions')
      .select('id, venue_id, service_id, date_start, date_end, time_start, time_end, min_advance_minutes, max_advance_days, min_party_size_online, max_party_size_online, large_party_threshold, large_party_message, deposit_required_from_party_size, reason')
      .eq('venue_id', venueId)
      .lte('date_start', monthEnd)
      .gte('date_end', monthStart),
  ]);

  // Group bookings by date
  const bookingsByDate = new Map<string, BookingForEngine[]>();
  for (const b of (bookingsRes.data ?? []) as Array<Record<string, unknown>>) {
    const dateKey = String(b.booking_date ?? '');
    if (!dateKey) continue;
    const list = bookingsByDate.get(dateKey) ?? [];
    list.push({
      id: b.id as string,
      booking_date: dateKey,
      booking_time: typeof b.booking_time === 'string' ? b.booking_time.slice(0, 5) : '00:00',
      party_size: b.party_size as number,
      status: b.status as string,
      service_id: (b.service_id as string | null) ?? null,
      estimated_end_time: (b.estimated_end_time as string | null) ?? null,
    });
    bookingsByDate.set(dateKey, list);
  }

  // Filter blocks by area (same as fetch.ts)
  const allBlocks = ((blocksRes.data ?? []) as Array<Record<string, unknown>>)
    .filter((b) => {
      const aid = b.area_id as string | null | undefined;
      return aid == null || aid === areaId;
    }) as unknown as AvailabilityBlock[];

  const capacityRules: ServiceCapacityRule[] = ((capacityRulesRes.data ?? []) as ServiceCapacityRule[]).map((r) => ({
    ...r,
    time_range_start: r.time_range_start ? String(r.time_range_start).slice(0, 5) : null,
    time_range_end: r.time_range_end ? String(r.time_range_end).slice(0, 5) : null,
  }));

  const restrictions: BookingRestriction[] = ((restrictionsRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    ...(r as unknown as BookingRestriction),
    deposit_amount_per_person_gbp:
      r.deposit_amount_per_person_gbp != null && r.deposit_amount_per_person_gbp !== ''
        ? Number(r.deposit_amount_per_person_gbp)
        : null,
    online_requires_deposit: r.online_requires_deposit !== false,
  }));

  const allScheduleExc: ServiceScheduleException[] = ((scheduleExcRes.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    venue_id: row.venue_id as string,
    service_id: row.service_id as string,
    date_start: row.date_start as string,
    date_end: row.date_end as string,
    is_closed: Boolean(row.is_closed),
    opens_extra_day: Boolean(row.opens_extra_day),
    start_time: row.start_time != null ? String(row.start_time).slice(0, 5) : null,
    end_time: row.end_time != null ? String(row.end_time).slice(0, 5) : null,
    last_booking_time: row.last_booking_time != null ? String(row.last_booking_time).slice(0, 5) : null,
    reason: (row.reason as string | null) ?? null,
  }));

  const allRestrictionExc: BookingRestrictionException[] = ((restrictionExcRes.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    venue_id: row.venue_id as string,
    service_id: (row.service_id as string | null) ?? null,
    date_start: row.date_start as string,
    date_end: row.date_end as string,
    time_start: row.time_start != null ? String(row.time_start).slice(0, 5) : null,
    time_end: row.time_end != null ? String(row.time_end).slice(0, 5) : null,
    min_advance_minutes: (row.min_advance_minutes as number | null) ?? null,
    max_advance_days: (row.max_advance_days as number | null) ?? null,
    min_party_size_online: (row.min_party_size_online as number | null) ?? null,
    max_party_size_online: (row.max_party_size_online as number | null) ?? null,
    large_party_threshold: (row.large_party_threshold as number | null) ?? null,
    large_party_message: (row.large_party_message as string | null) ?? null,
    deposit_required_from_party_size: (row.deposit_required_from_party_size as number | null) ?? null,
    reason: (row.reason as string | null) ?? null,
  }));

  return {
    services,
    capacityRules,
    durations: (durationsRes.data ?? []) as PartySizeDuration[],
    restrictions,
    areaDeposit: areaRes.data?.deposit_config ?? null,
    bookingsByDate,
    allBlocks,
    allScheduleExc,
    allRestrictionExc,
  };
}
