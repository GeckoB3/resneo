/**
 * Table availability engine - optional layer on top of covers-based system.
 *
 * When table_management_enabled, BOTH covers AND table availability must pass.
 * This module provides two core functions:
 *   1. getAvailableTablesForBooking - find best table(s) for a booking
 *   2. getTableAvailabilityGrid - full grid data for timeline view
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { VenueTable, TableAvailabilityCandidate, TableGridData, TableGridCell } from '@/types/table-management';
import type { BookingModel } from '@/types/booking-models';
import { timeToMinutes, minutesToTime } from '@/lib/availability';
import { BOOKING_ACTIVE_STATUSES, BOOKING_TIMELINE_GRID_STATUSES } from '@/lib/table-management/constants';
import { inferBookingRowModel, isTableReservationBooking } from '@/lib/booking/infer-booking-row-model';
import {
  detectAdjacentTables,
  findValidCombinations,
  type AutoCombinationOverrideInput,
  type CombinationBooking,
  type CombinationBlock,
  type CombinationTable,
  type ManualCombination,
} from '@/lib/table-management/combination-engine';

interface BookingWithTime {
  id: string;
  booking_time: string;
  estimated_end_time: string | null;
  party_size: number;
  status: string;
  deposit_status?: string | null;
  deposit_amount_pence?: number | null;
  guest_attendance_confirmed_at?: string | null;
  staff_attendance_confirmed_at?: string | null;
  guest_name: string;
  dietary_notes: string | null;
  occasion: string | null;
  internal_notes?: string | null;
  actual_departed_time?: string | null;
  table_ids: string[];
}

interface TableBlock {
  id: string;
  table_id: string;
  start_at: string;
  end_at: string;
  reason: string | null;
}

function getBookingTimeRange(b: BookingWithTime, defaultDuration = 90): { startMin: number; endMin: number } {
  const startMin = timeToMinutes(b.booking_time);
  let endMin: number;
  if (b.estimated_end_time) {
    const timePart = b.estimated_end_time.split('T')[1];
    endMin = timePart ? timeToMinutes(timePart) : startMin + defaultDuration;
  } else {
    endMin = startMin + defaultDuration;
  }
  if (endMin <= startMin) {
    endMin += 24 * 60;
  }
  return { startMin, endMin };
}

function getBlockTimeRange(block: TableBlock): { startMin: number; endMin: number } {
  const startMin = timeToMinutes((block.start_at.split('T')[1] ?? '00:00:00').slice(0, 5));
  let endMin = timeToMinutes((block.end_at.split('T')[1] ?? '00:00:00').slice(0, 5));
  if (endMin <= startMin) {
    endMin += 24 * 60;
  }
  return { startMin, endMin };
}

function doIntervalsOverlap(s1: number, e1: number, s2: number, e2: number): boolean {
  return s1 < e2 && s2 < e1;
}

/**
 * Find the best available table(s) for a booking.
 * Returns sorted candidates: single tables first (smallest adequate), then combinations.
 */
export async function getAvailableTablesForBooking(
  supabase: SupabaseClient,
  venueId: string,
  date: string,
  startTime: string,
  durationMinutes: number,
  bufferMinutes: number,
  partySize: number,
  opts?: {
    bookingContext?: { bookingDate: string; bookingTime: string; bookingModel: BookingModel };
    /** When set, only tables/combinations/bookings in this dining area are considered. */
    areaId?: string | null;
  },
): Promise<TableAvailabilityCandidate[]> {
  const areaId = opts?.areaId ?? null;

  const [venueRes, tablesRes, blocksRes] = await Promise.all([
    supabase
      .from('venues')
      .select('combination_threshold')
      .eq('id', venueId)
      .single(),
    areaId
      ? supabase
          .from('venue_tables')
          .select('*')
          .eq('venue_id', venueId)
          .eq('area_id', areaId)
          .eq('is_active', true)
          .order('sort_order')
      : supabase
          .from('venue_tables')
          .select('*')
          .eq('venue_id', venueId)
          .eq('is_active', true)
          .order('sort_order'),
    supabase
      .from('table_blocks')
      .select('id, table_id, start_at, end_at, reason')
      .eq('venue_id', venueId)
      .lt('start_at', `${date}T23:59:59.999Z`)
      .gt('end_at', `${date}T00:00:00.000Z`),
  ]);
  const tables = tablesRes.data;
  const blocks = (blocksRes.data ?? []) as TableBlock[];

  if (!tables?.length) return [];

  let assignmentsQuery = supabase
    .from('booking_table_assignments')
    .select('table_id, booking:bookings!inner(id, booking_date, booking_time, estimated_end_time, party_size, status, area_id)')
    .eq('booking.booking_date', date)
    .in('booking.status', [...BOOKING_ACTIVE_STATUSES]);
  if (areaId) {
    assignmentsQuery = assignmentsQuery.eq('booking.area_id', areaId);
  }
  const { data: assignments } = await assignmentsQuery;

  const bookingsById = new Map<string, CombinationBooking>();
  if (assignments) {
    for (const a of assignments) {
      const b = a.booking as unknown as {
        id: string;
        booking_time: string;
        estimated_end_time: string | null;
        status: string;
      };
      if (!BOOKING_ACTIVE_STATUSES.includes(b.status as (typeof BOOKING_ACTIVE_STATUSES)[number])) continue;

      const existingBooking = bookingsById.get(b.id) ?? {
        id: b.id,
        status: b.status,
        booking_time: b.booking_time,
        estimated_end_time: b.estimated_end_time,
        table_ids: [],
      };
      if (!existingBooking.table_ids.includes(a.table_id)) {
        existingBooking.table_ids.push(a.table_id);
      }
      bookingsById.set(b.id, existingBooking);
    }
  }

  const tableIdSet = new Set((tables as VenueTable[]).map((t) => t.id));
  const blocksForTables = blocks.filter((b) => tableIdSet.has(b.table_id));

  const blockRangesByTable = new Map<string, Array<{ startMin: number; endMin: number }>>();
  for (const block of blocksForTables) {
    const range = {
      startMin: timeToMinutes((block.start_at.split('T')[1] ?? '00:00:00').slice(0, 5)),
      endMin: timeToMinutes((block.end_at.split('T')[1] ?? '00:00:00').slice(0, 5)),
    };
    const existing = blockRangesByTable.get(block.table_id) ?? [];
    existing.push(range);
    blockRangesByTable.set(block.table_id, existing);
  }

  const combinationsQuery = areaId
    ? supabase
        .from('table_combinations')
        .select('*, members:table_combination_members(id, table_id)')
        .eq('venue_id', venueId)
        .eq('area_id', areaId)
        .eq('is_active', true)
    : supabase
        .from('table_combinations')
        .select('*, members:table_combination_members(id, table_id)')
        .eq('venue_id', venueId)
        .eq('is_active', true);

  const { data: combinations } = await combinationsQuery;

  let overrideRows: Record<string, unknown>[] = [];
  const ovRes = areaId
    ? await supabase.from('combination_auto_overrides').select('*').eq('venue_id', venueId).eq('area_id', areaId)
    : await supabase.from('combination_auto_overrides').select('*').eq('venue_id', venueId);
  if (ovRes.error) {
    console.error('load combination_auto_overrides:', ovRes.error.message);
  } else {
    overrideRows = (ovRes.data ?? []) as Record<string, unknown>[];
  }

  const algorithmTables: CombinationTable[] = (tables as VenueTable[]).map((table) => ({
    id: table.id,
    name: table.name,
    max_covers: table.max_covers,
    is_active: table.is_active,
    position_x: table.position_x,
    position_y: table.position_y,
    width: table.width,
    height: table.height,
    rotation: table.rotation,
  }));

  const algorithmBlocks: CombinationBlock[] = blocksForTables.map((block) => ({
    table_id: block.table_id,
    start_at: block.start_at,
    end_at: block.end_at,
  }));

  const manualCombinations: ManualCombination[] = (combinations ?? []).map((combo: Record<string, unknown>) => ({
    id: combo.id as string,
    name: combo.name as string,
    combined_min_covers: combo.combined_min_covers as number,
    combined_max_covers: combo.combined_max_covers as number,
    is_active: combo.is_active as boolean,
    table_ids: ((combo.members as { table_id: string }[]) ?? []).map((m) => m.table_id),
    days_of_week: (combo.days_of_week as number[] | undefined) ?? undefined,
    time_start: (combo.time_start as string | null | undefined) ?? null,
    time_end: (combo.time_end as string | null | undefined) ?? null,
    booking_type_filters: (combo.booking_type_filters as string[] | null | undefined) ?? null,
    requires_manager_approval: (combo.requires_manager_approval as boolean | undefined) ?? false,
    internal_notes: (combo.internal_notes as string | null | undefined) ?? null,
  }));

  const autoOverrides = new Map<string, AutoCombinationOverrideInput>();
  for (const row of overrideRows ?? []) {
    const r = row as Record<string, unknown>;
    autoOverrides.set(r.table_group_key as string, {
      id: r.id as string,
      table_group_key: r.table_group_key as string,
      disabled: r.disabled as boolean,
      locked: (r.locked as boolean) ?? false,
      display_name: (r.display_name as string | null) ?? null,
      combined_min_covers: (r.combined_min_covers as number | null) ?? null,
      combined_max_covers: (r.combined_max_covers as number | null) ?? null,
      days_of_week: (r.days_of_week as number[]) ?? [1, 2, 3, 4, 5, 6, 7],
      time_start: (r.time_start as string | null) ?? null,
      time_end: (r.time_end as string | null) ?? null,
      booking_type_filters: (r.booking_type_filters as string[] | null) ?? null,
      requires_manager_approval: (r.requires_manager_approval as boolean) ?? false,
      internal_notes: (r.internal_notes as string | null) ?? null,
    });
  }

  const timePart = startTime.length >= 5 ? startTime.slice(0, 5) : startTime;

  const threshold = venueRes.data?.combination_threshold ?? 80;
  const suggestions = findValidCombinations({
    partySize,
    datetime: `${date}T${timePart}:00.000Z`,
    durationMinutes: durationMinutes + bufferMinutes,
    tables: algorithmTables,
    bookings: Array.from(bookingsById.values()),
    blocks: algorithmBlocks,
    adjacencyMap: detectAdjacentTables(algorithmTables, threshold),
    manualCombinations,
    autoOverrides,
    bookingContext: opts?.bookingContext,
  });

  const tableMap = new Map((tables as VenueTable[]).map((table) => [table.id, table]));
  const manualByKey = new Map(
    manualCombinations.map((combo) => [[...combo.table_ids].sort().join('|'), combo] as const)
  );

  return suggestions.map((suggestion) => {
    const comboKey = [...suggestion.table_ids].sort().join('|');
    const manual = manualByKey.get(comboKey);
    if (suggestion.source === 'single') {
      const table = tableMap.get(suggestion.table_ids[0]!);
      return {
        type: 'single',
        source: 'single',
        table_ids: suggestion.table_ids,
        table_names: suggestion.table_names,
        min_covers: table?.min_covers ?? 1,
        max_covers: suggestion.combined_capacity,
        spare_covers: suggestion.spare_covers,
        score: suggestion.score,
      } satisfies TableAvailabilityCandidate;
    }

    return {
      type: 'combination',
      source: suggestion.source,
      table_ids: suggestion.table_ids,
      table_names: suggestion.table_names,
      min_covers: manual?.combined_min_covers ?? 1,
      max_covers: manual?.combined_max_covers ?? suggestion.combined_capacity,
      combination_id: manual?.id,
      combination_name: manual?.name,
      auto_override_id: suggestion.auto_override_id,
      spare_covers: suggestion.spare_covers,
      score: suggestion.score,
      requires_manager_approval: suggestion.requires_manager_approval,
      internal_notes: suggestion.internal_notes ?? null,
    } satisfies TableAvailabilityCandidate;
  });
}

/**
 * Get full grid data for the timeline grid view.
 * Returns all tables, occupied cells, and unassigned bookings.
 */
export async function getTableAvailabilityGrid(
  supabase: SupabaseClient,
  venueId: string,
  date: string,
  serviceStartTime?: string,
  serviceEndTime?: string,
  slotInterval = 15,
  areaId?: string | null,
): Promise<TableGridData> {
  const tablesQuery = supabase
    .from('venue_tables')
    .select('*')
    .eq('venue_id', venueId)
    .eq('is_active', true)
    .order('sort_order');
  const scopedTables = areaId ? tablesQuery.eq('area_id', areaId) : tablesQuery;

  let bookingsQuery = supabase
    .from('bookings')
    .select(
      'id, booking_time, estimated_end_time, party_size, status, deposit_status, deposit_amount_pence, guest_attendance_confirmed_at, staff_attendance_confirmed_at, actual_departed_time, dietary_notes, occasion, internal_notes, experience_event_id, class_instance_id, resource_id, event_session_id, calendar_id, service_item_id, practitioner_id, appointment_service_id, guest:guests!inner(name)',
    )
    .eq('venue_id', venueId)
    .eq('booking_date', date)
    .in('status', [...BOOKING_TIMELINE_GRID_STATUSES]);
  if (areaId) {
    bookingsQuery = bookingsQuery.eq('area_id', areaId);
  }

  const [tablesRes, bookingsRes, blocksRes] = await Promise.all([
    scopedTables,
    bookingsQuery,
    supabase
      .from('table_blocks')
      .select('id, table_id, start_at, end_at, reason')
      .eq('venue_id', venueId)
      .lt('start_at', `${date}T23:59:59.999Z`)
      .gt('end_at', `${date}T00:00:00.000Z`),
  ]);

  const tables = (tablesRes.data ?? []) as VenueTable[];
  const activeTableIds = new Set(tables.map((table) => table.id));
  const blocksRaw = (blocksRes.data ?? []) as TableBlock[];
  const blocks = areaId
    ? blocksRaw.filter((block) => activeTableIds.has(block.table_id))
    : blocksRaw;
  const rawBookings = (bookingsRes.data ?? []) as Array<{
    id: string;
    booking_time: string;
    estimated_end_time: string | null;
    party_size: number;
    status: string;
    deposit_status?: string | null;
    deposit_amount_pence?: number | null;
    guest_attendance_confirmed_at?: string | null;
    staff_attendance_confirmed_at?: string | null;
    actual_departed_time?: string | null;
    dietary_notes: string | null;
    occasion: string | null;
    internal_notes?: string | null;
    experience_event_id?: string | null;
    class_instance_id?: string | null;
    resource_id?: string | null;
    event_session_id?: string | null;
    calendar_id?: string | null;
    service_item_id?: string | null;
    practitioner_id?: string | null;
    appointment_service_id?: string | null;
    guest: { name: string } | { name: string }[];
  }>;
  const bookingIds = rawBookings.map((b) => b.id);

  const assignmentMap = new Map<string, string[]>();
  const bookingToTables = new Map<string, string[]>();

  if (bookingIds.length > 0) {
    const { data: allAssignments } = await supabase
      .from('booking_table_assignments')
      .select('booking_id, table_id')
      .in('booking_id', bookingIds);

    if (allAssignments) {
      for (const a of allAssignments) {
        if (!activeTableIds.has(a.table_id)) {
          continue;
        }
        const existing = assignmentMap.get(a.table_id) ?? [];
        existing.push(a.booking_id);
        assignmentMap.set(a.table_id, existing);

        const bTables = bookingToTables.get(a.booking_id) ?? [];
        bTables.push(a.table_id);
        bookingToTables.set(a.booking_id, bTables);
      }
    }
  }

  const bookings: BookingWithTime[] = rawBookings.map((b) => {
    const guestName = Array.isArray(b.guest) ? b.guest[0]?.name ?? '' : b.guest?.name ?? '';
    return {
      id: b.id,
      booking_time: b.booking_time,
      estimated_end_time: b.estimated_end_time,
      party_size: b.party_size,
      status: b.status,
      deposit_status: b.deposit_status ?? null,
      deposit_amount_pence: b.deposit_amount_pence ?? null,
      guest_attendance_confirmed_at: b.guest_attendance_confirmed_at ?? null,
      staff_attendance_confirmed_at: b.staff_attendance_confirmed_at ?? null,
      guest_name: guestName,
      dietary_notes: b.dietary_notes,
      occasion: b.occasion,
      internal_notes: b.internal_notes ?? null,
      actual_departed_time: b.actual_departed_time ?? null,
      table_ids: bookingToTables.get(b.id) ?? [],
    };
  });
  const tableNameById = new Map(tables.map((table) => [table.id, table.name]));

  const startMin = serviceStartTime ? timeToMinutes(serviceStartTime) : 9 * 60;
  const configuredEndMin = serviceEndTime ? timeToMinutes(serviceEndTime) : 23 * 60;
  const latestBookingEndMin = bookings.reduce(
    (latest, booking) => Math.max(latest, getBookingTimeRange(booking).endMin),
    configuredEndMin,
  );
  const latestBlockEndMin = blocks.reduce(
    (latest, block) => Math.max(latest, getBlockTimeRange(block).endMin),
    latestBookingEndMin,
  );
  const endMin = Math.ceil(latestBlockEndMin / slotInterval) * slotInterval;

  const cells: TableGridCell[] = [];
  const tablesInUse = new Set<string>();
  let totalCoversBooked = 0;
  const activeBookingStatusSet = new Set<string>(BOOKING_ACTIVE_STATUSES);

  for (const table of tables) {
    const tableBookingIds = assignmentMap.get(table.id) ?? [];
    const tableBookings = bookings
      .filter((b) => tableBookingIds.includes(b.id))
      .sort((a, b) => {
        const rank = (s: string) => (activeBookingStatusSet.has(s) ? 0 : 1);
        const dr = rank(a.status) - rank(b.status);
        if (dr !== 0) return dr;
        return a.booking_time.localeCompare(b.booking_time);
      });

    const tableBlocks = blocks.filter((block) => block.table_id === table.id);
    for (let m = startMin; m < endMin; m += slotInterval) {
      const timeStr = minutesToTime(m);
      let matchedBooking: BookingWithTime | null = null;

      for (const b of tableBookings) {
        const range = getBookingTimeRange(b);
        if (doIntervalsOverlap(m, m + slotInterval, range.startMin, range.endMin)) {
          matchedBooking = b;
          break;
        }
      }

      let matchedBlock: TableBlock | null = null;
      let matchedBlockRange: { startMin: number; endMin: number } | null = null;
      for (const block of tableBlocks) {
        const blockRange = getBlockTimeRange(block);
        if (doIntervalsOverlap(m, m + slotInterval, blockRange.startMin, blockRange.endMin)) {
          matchedBlock = block;
          matchedBlockRange = blockRange;
          break;
        }
      }

      cells.push({
        table_id: table.id,
        time: timeStr,
        is_available: !matchedBooking && !matchedBlock,
        is_blocked: Boolean(matchedBlock),
        booking_id: matchedBooking?.id ?? null,
        block_id: matchedBlock?.id ?? null,
        block_details: matchedBlock
          ? {
              id: matchedBlock.id,
              reason: matchedBlock.reason,
              start_time: minutesToTime(matchedBlockRange?.startMin ?? 0),
              end_time: minutesToTime(matchedBlockRange?.endMin ?? 0),
            }
          : null,
        booking_details: matchedBooking
          ? {
              guest_name: matchedBooking.guest_name,
              party_size: matchedBooking.party_size,
              status: matchedBooking.status,
              deposit_status: matchedBooking.deposit_status ?? null,
              deposit_amount_pence: matchedBooking.deposit_amount_pence ?? null,
              guest_attendance_confirmed_at: matchedBooking.guest_attendance_confirmed_at ?? null,
              staff_attendance_confirmed_at: matchedBooking.staff_attendance_confirmed_at ?? null,
              start_time: matchedBooking.booking_time,
              end_time: minutesToTime(getBookingTimeRange(matchedBooking).endMin),
              actual_departed_time: matchedBooking.actual_departed_time ?? null,
              table_ids: matchedBooking.table_ids,
              table_names: matchedBooking.table_ids.map((tableId) => tableNameById.get(tableId) ?? tableId),
              dietary_notes: matchedBooking.dietary_notes,
              occasion: matchedBooking.occasion,
              internal_notes: matchedBooking.internal_notes ?? null,
            }
          : null,
      });

      if (
        matchedBooking &&
        BOOKING_ACTIVE_STATUSES.includes(matchedBooking.status as (typeof BOOKING_ACTIVE_STATUSES)[number])
      ) {
        tablesInUse.add(table.id);
      }
    }
  }

  const assignedBookingIds = new Set(
    Array.from(bookingToTables.keys()),
  );
  /** Only Model A table reservations need a physical table; appointments/C/D/E do not. */
  const tableReservationIds = new Set(
    rawBookings.filter((row) => isTableReservationBooking(row)).map((row) => row.id),
  );
  const unassigned = bookings
    .filter((b) => !assignedBookingIds.has(b.id) && tableReservationIds.has(b.id))
    .map((b) => {
      const range = getBookingTimeRange(b);
      return {
        id: b.id,
        guest_name: b.guest_name,
        party_size: b.party_size,
        start_time: b.booking_time,
        end_time: minutesToTime(range.endMin),
        status: b.status,
        deposit_status: b.deposit_status ?? null,
        deposit_amount_pence: b.deposit_amount_pence ?? null,
        guest_attendance_confirmed_at: b.guest_attendance_confirmed_at ?? null,
        staff_attendance_confirmed_at: b.staff_attendance_confirmed_at ?? null,
        dietary_notes: b.dietary_notes,
        occasion: b.occasion,
        internal_notes: b.internal_notes ?? null,
        actual_departed_time: b.actual_departed_time ?? null,
      };
    });

  for (const b of bookings) {
    if (BOOKING_ACTIVE_STATUSES.includes(b.status as (typeof BOOKING_ACTIVE_STATUSES)[number])) {
      totalCoversBooked += b.party_size;
    }
  }

  const activeBookingIds = new Set(
    bookings
      .filter((b) => BOOKING_ACTIVE_STATUSES.includes(b.status as (typeof BOOKING_ACTIVE_STATUSES)[number]))
      .map((b) => b.id),
  );
  const comboBookingsInUse = Array.from(bookingToTables.entries()).filter(
    ([bid, tableIds]) => tableIds.length > 1 && activeBookingIds.has(bid),
  ).length;

  const totalCapacity = tables.reduce((sum, t) => sum + t.max_covers, 0);


  return {
    tables,
    cells,
    slot_interval_minutes: slotInterval,
    unassigned_bookings: unassigned,
    summary: {
      total_covers_booked: totalCoversBooked,
      total_covers_capacity: totalCapacity,
      tables_in_use: tablesInUse.size,
      tables_total: tables.length,
      unassigned_count: unassigned.length,
      combos_in_use: comboBookingsInUse,
    },
  };
}

/**
 * Auto-assign a table to a booking. Returns the assigned table(s) or null.
 */
export async function autoAssignTable(
  supabase: SupabaseClient,
  venueId: string,
  bookingId: string,
  date: string,
  startTime: string,
  durationMinutes: number,
  bufferMinutes: number,
  partySize: number,
): Promise<TableAvailabilityCandidate | null> {
    const { data: bookingRow } = await supabase
    .from('bookings')
    .select(
      'experience_event_id, class_instance_id, resource_id, event_session_id, calendar_id, service_item_id, practitioner_id, appointment_service_id, area_id',
    )
    .eq('id', bookingId)
    .single();

  const timePart = startTime.length >= 5 ? startTime.slice(0, 5) : startTime;
  const bookingModel = inferBookingRowModel(bookingRow ?? {});
  const areaId = (bookingRow as { area_id?: string | null } | null)?.area_id ?? null;

  const candidates = await getAvailableTablesForBooking(
    supabase,
    venueId,
    date,
    startTime,
    durationMinutes,
    bufferMinutes,
    partySize,
    {
      bookingContext: {
        bookingDate: date,
        bookingTime: timePart,
        bookingModel,
      },
      areaId,
    },
  );

  const assignable = candidates.filter((c) => !c.requires_manager_approval);
  if (assignable.length === 0) {
    const { logTableAutoAssignMiss } = await import('@/lib/table-management/auto-assign-policy');
    logTableAutoAssignMiss({
      venueId,
      bookingId,
      date,
      startTime,
      partySize,
      durationMinutes,
      bufferMinutes,
      reason: 'no_candidate',
    });
    return null;
  }

  const best = assignable[0]!;

  const inserts = best.table_ids.map((tableId) => ({
    booking_id: bookingId,
    table_id: tableId,
  }));

  const { error } = await supabase
    .from('booking_table_assignments')
    .insert(inserts);

  if (error) {
    console.error('Auto-assign table failed:', error);
    const { logTableAutoAssignMiss } = await import('@/lib/table-management/auto-assign-policy');
    logTableAutoAssignMiss({
      venueId,
      bookingId,
      date,
      startTime,
      partySize,
      durationMinutes,
      bufferMinutes,
      reason: 'insert_failed',
    });
    return null;
  }

  return best;
}
