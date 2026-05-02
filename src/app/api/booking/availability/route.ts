import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { computeAvailability, fetchEngineInput } from '@/lib/availability';
import { AVAILABILITY_SETUP_REQUIRED_MESSAGE } from '@/lib/availability/availability-errors';
import { resolveVenueMode } from '@/lib/venue-mode';
import type { VenueTable } from '@/types/table-management';
import { BOOKING_ACTIVE_STATUSES } from '@/lib/table-management/constants';
import {
  detectAdjacentTables,
  findValidCombinations,
  type AutoCombinationOverrideInput,
  type CombinationBooking,
  type CombinationBlock,
  type CombinationTable,
  type ManualCombination,
} from '@/lib/table-management/combination-engine';
import {
  attachVenueClockToAppointmentInput,
  computeAppointmentAvailability,
  fetchAppointmentInput,
  type PhantomBooking,
} from '@/lib/availability/appointment-engine';
import { applyVariantToAppointmentInput } from '@/lib/appointments/service-variant';
import { loadActiveVariantForService } from '@/lib/venue/service-variants';
import { computeEventAvailability, fetchEventInput } from '@/lib/availability/event-ticket-engine';
import { computeClassAvailability, fetchClassInput } from '@/lib/availability/class-session-engine';
import { computeResourceAvailability, fetchResourceInput } from '@/lib/availability/resource-booking-engine';
import { isUnifiedSchedulingVenue, venueUsesUnifiedAppointmentData } from '@/lib/booking/unified-scheduling';
import { venueExposesBookingModel } from '@/lib/booking/enabled-models';
import type { BookingModel } from '@/types/booking-models';
import { DEFAULT_ENTITY_BOOKING_WINDOW, loadServiceEntityBookingWindow } from '@/lib/booking/entity-booking-window';
import { listActiveAreasForVenue } from '@/lib/areas/resolve-default-area';
import { nextResponseIfPublicBookingBlockedForVenue } from '@/lib/booking/light-plan-public-block';
import type { EngineServiceResult, ServiceAvailableSlot } from '@/types/availability';

/** Public availability can request C/D/E explicitly when the venue primary is another model (multi-tab embed). */
const AVAILABILITY_REQUEST_MODELS = new Set<BookingModel>(['event_ticket', 'class_session', 'resource_booking']);

function toMinutes(value: string): number {
  const [h, m] = value.slice(0, 5).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function durationFromSlot(start: string, end?: string | null): number {
  if (!end) return 90;
  const startMin = toMinutes(start);
  let endMin = toMinutes(end);
  if (endMin <= startMin) endMin += 24 * 60;
  return Math.max(15, endMin - startMin);
}

/**
 * Batch-check which time slots have at least one table/combination available.
 * Fetches all shared data once, then runs the in-memory combination algorithm
 * per slot. This replaces the old sequential-per-slot approach that made N
 * separate DB round-trips.
 */
async function buildTableFilterByTime(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
  date: string,
  slots: Array<{ start_time?: string; key?: string; end_time?: string }>,
  partySize: number,
  bookingModel: BookingModel = 'table_reservation',
  areaId?: string | null,
): Promise<Set<string>> {
  const uniqueTimes = new Map<string, number>();
  for (const slot of slots) {
    const time = slot.start_time ?? slot.key;
    if (!time) continue;
    const duration = durationFromSlot(time, slot.end_time ?? null);
    if (!uniqueTimes.has(time)) uniqueTimes.set(time, duration);
  }
  if (uniqueTimes.size === 0) return new Set();

  let assignmentsQuery = supabase
    .from('booking_table_assignments')
    .select('table_id, booking:bookings!inner(id, booking_date, booking_time, estimated_end_time, party_size, status, area_id)')
    .eq('booking.booking_date', date)
    .in('booking.status', [...BOOKING_ACTIVE_STATUSES]);
  if (areaId) {
    assignmentsQuery = assignmentsQuery.eq('booking.area_id', areaId);
  }

  const [venueRes, tablesRes, blocksRes, assignmentsRes, combinationsRes, overridesRes] = await Promise.all([
    supabase.from('venues').select('combination_threshold').eq('id', venueId).single(),
    areaId
      ? supabase
          .from('venue_tables')
          .select('*')
          .eq('venue_id', venueId)
          .eq('area_id', areaId)
          .eq('is_active', true)
          .order('sort_order')
      : supabase.from('venue_tables').select('*').eq('venue_id', venueId).eq('is_active', true).order('sort_order'),
    supabase.from('table_blocks').select('id, table_id, start_at, end_at, reason')
      .eq('venue_id', venueId)
      .lt('start_at', `${date}T23:59:59.999Z`)
      .gt('end_at', `${date}T00:00:00.000Z`),
    assignmentsQuery,
    areaId
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
          .eq('is_active', true),
    areaId
      ? supabase.from('combination_auto_overrides').select('*').eq('venue_id', venueId).eq('area_id', areaId)
      : supabase.from('combination_auto_overrides').select('*').eq('venue_id', venueId),
  ]);

  const tables = (tablesRes.data ?? []) as VenueTable[];
  if (tables.length === 0) return new Set();

  const bookingsById = new Map<string, CombinationBooking>();
  if (assignmentsRes.data) {
    for (const a of assignmentsRes.data) {
      const b = a.booking as unknown as {
        id: string; booking_time: string; estimated_end_time: string | null; status: string;
      };
      if (!BOOKING_ACTIVE_STATUSES.includes(b.status as (typeof BOOKING_ACTIVE_STATUSES)[number])) continue;
      const existing = bookingsById.get(b.id) ?? {
        id: b.id, status: b.status, booking_time: b.booking_time,
        estimated_end_time: b.estimated_end_time, table_ids: [],
      };
      if (!existing.table_ids.includes(a.table_id)) existing.table_ids.push(a.table_id);
      bookingsById.set(b.id, existing);
    }
  }

  const algorithmTables: CombinationTable[] = tables.map((t) => ({
    id: t.id, name: t.name, max_covers: t.max_covers, is_active: t.is_active,
    position_x: t.position_x, position_y: t.position_y,
    width: t.width, height: t.height, rotation: t.rotation,
  }));
  const tableIdSet = new Set(tables.map((t) => t.id));
  const algorithmBlocks: CombinationBlock[] = (blocksRes.data ?? [])
    .filter((b: { table_id: string }) => tableIdSet.has(b.table_id))
    .map((b: { table_id: string; start_at: string; end_at: string }) => ({
      table_id: b.table_id,
      start_at: b.start_at,
      end_at: b.end_at,
    }));
  const manualCombinations: ManualCombination[] = (combinationsRes.data ?? []).map((c: Record<string, unknown>) => ({
    id: c.id as string,
    name: c.name as string,
    combined_min_covers: c.combined_min_covers as number,
    combined_max_covers: c.combined_max_covers as number,
    is_active: c.is_active as boolean,
    table_ids: ((c.members ?? []) as Array<{ table_id: string }>).map((m) => m.table_id),
    days_of_week: (c.days_of_week as number[] | undefined) ?? undefined,
    time_start: (c.time_start as string | null | undefined) ?? null,
    time_end: (c.time_end as string | null | undefined) ?? null,
    booking_type_filters: (c.booking_type_filters as string[] | null | undefined) ?? null,
    requires_manager_approval: (c.requires_manager_approval as boolean | undefined) ?? false,
    internal_notes: (c.internal_notes as string | null | undefined) ?? null,
  }));

  const autoOverrides = new Map<string, AutoCombinationOverrideInput>();
  if (!overridesRes.error && overridesRes.data) {
    for (const row of overridesRes.data as Record<string, unknown>[]) {
      autoOverrides.set(row.table_group_key as string, {
        id: row.id as string,
        table_group_key: row.table_group_key as string,
        disabled: row.disabled as boolean,
        locked: (row.locked as boolean) ?? false,
        display_name: (row.display_name as string | null) ?? null,
        combined_min_covers: (row.combined_min_covers as number | null) ?? null,
        combined_max_covers: (row.combined_max_covers as number | null) ?? null,
        days_of_week: (row.days_of_week as number[]) ?? [1, 2, 3, 4, 5, 6, 7],
        time_start: (row.time_start as string | null) ?? null,
        time_end: (row.time_end as string | null) ?? null,
        booking_type_filters: (row.booking_type_filters as string[] | null) ?? null,
        requires_manager_approval: (row.requires_manager_approval as boolean) ?? false,
        internal_notes: (row.internal_notes as string | null) ?? null,
      });
    }
  } else if (overridesRes.error) {
    console.error('buildTableFilterByTime combination_auto_overrides:', overridesRes.error.message);
  }

  const threshold = venueRes.data?.combination_threshold ?? 80;
  const adjacencyMap = detectAdjacentTables(algorithmTables, threshold);
  const allBookings = Array.from(bookingsById.values());
  const bufferMinutes = 15;

  const timesWithTable = new Set<string>();
  for (const [time, duration] of uniqueTimes.entries()) {
    const timePart = time.length >= 5 ? time.slice(0, 5) : time;
    const results = findValidCombinations({
      partySize,
      datetime: `${date}T${timePart}:00.000Z`,
      durationMinutes: duration + bufferMinutes,
      tables: algorithmTables,
      bookings: allBookings,
      blocks: algorithmBlocks,
      adjacencyMap,
      manualCombinations,
      autoOverrides,
      bookingContext: {
        bookingDate: date,
        bookingTime: timePart,
        bookingModel,
      },
    });
    const usable = results.filter((s) => s.source === 'single' || !s.requires_manager_approval);
    if (usable.length > 0) {
      timesWithTable.add(time);
    }
  }

  return timesWithTable;
}

function tagSlotsForArea(
  slots: ServiceAvailableSlot[],
  area: { id: string; name: string; colour: string },
  multiArea: boolean,
): ServiceAvailableSlot[] {
  return slots.map((s) => ({
    ...s,
    key: multiArea ? `${area.id}_${s.key}` : s.key,
    /** Keep label as the clock time only; area is on `area_id` / `area_name` for consumers that need it. */
    label: s.label,
    area_id: area.id,
    area_name: area.name,
    area_colour: area.colour,
  }));
}

async function runTableReservationAvailabilityForArea(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
  dateStr: string,
  partySize: number,
  venueMode: Awaited<ReturnType<typeof resolveVenueMode>>,
  area: { id: string; name: string; colour: string },
  multiArea: boolean,
): Promise<{
  activeResults: EngineServiceResult[];
  allSlots: ServiceAvailableSlot[];
  largePartyRedirect: EngineServiceResult | undefined;
}> {
  const tablePartySize = partySize;
  const engineInput = await fetchEngineInput({
    supabase,
    venueId,
    date: dateStr,
    partySize: tablePartySize,
    areaId: area.id,
  });
  const results = computeAvailability(engineInput);
  let activeResults = results.filter((r) => r.slots.length > 0 || r.large_party_redirect);

  if (venueMode.tableManagementEnabled) {
    const allSlotsRaw = activeResults.flatMap((r) => r.slots);
    const timesWithTable = await buildTableFilterByTime(
      supabase,
      venueId,
      dateStr,
      allSlotsRaw.map((slot) => ({
        start_time: slot.start_time,
        end_time: slot.end_time,
      })),
      tablePartySize,
      'table_reservation',
      area.id,
    );
    activeResults = activeResults
      .map((serviceResult) => ({
        ...serviceResult,
        slots: serviceResult.slots.filter((slot) => timesWithTable.has(slot.start_time)),
      }))
      .filter((serviceResult) => serviceResult.slots.length > 0 || serviceResult.large_party_redirect);
  }

  const tagged = activeResults.map((r) => ({
    ...r,
    slots: tagSlotsForArea(r.slots, area, multiArea),
  }));
  const allSlots = tagged.flatMap((r) => r.slots);
  const largePartyRedirect = tagged.find((r) => r.large_party_redirect);
  return { activeResults: tagged, allSlots, largePartyRedirect };
}

/** GET /api/booking/availability?venue_id=uuid&date=YYYY-MM-DD&party_size=N [&booking_model=event_ticket|class_session|resource_booking] */
export async function GET(request: NextRequest) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  try {
    const { searchParams } = new URL(request.url);
    const venueId = searchParams.get('venue_id');
    const dateStr = searchParams.get('date');
    const partySizeParam = searchParams.get('party_size');

    if (!venueId || !dateStr) {
      return NextResponse.json(
        { error: 'Missing required query params: venue_id, date' },
        { status: 400 }
      );
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateStr)) {
      return NextResponse.json(
        { error: 'Invalid date format; use YYYY-MM-DD' },
        { status: 400 }
      );
    }

    const partySize = partySizeParam ? parseInt(partySizeParam, 10) : null;
    if (partySize != null && (Number.isNaN(partySize) || partySize < 1)) {
      return NextResponse.json(
        { error: 'party_size must be a positive integer' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdminClient();
    const blocked = await nextResponseIfPublicBookingBlockedForVenue(supabase, venueId);
    if (blocked) return blocked;

    const venueMode = await resolveVenueMode(supabase, venueId);

    const serviceIdParam = searchParams.get('service_id');
    const practitionerIdParam = searchParams.get('practitioner_id');
    if (
      serviceIdParam &&
      practitionerIdParam &&
      venueUsesUnifiedAppointmentData(venueMode.bookingModel, venueMode.enabledModels)
    ) {
      return handleAppointmentAvailability(supabase, venueId, dateStr, searchParams);
    }

    const bookingModelParam = searchParams.get('booking_model');
    if (bookingModelParam) {
      if (!AVAILABILITY_REQUEST_MODELS.has(bookingModelParam as BookingModel)) {
        return NextResponse.json(
          { error: 'Invalid booking_model; use event_ticket, class_session, or resource_booking' },
          { status: 400 },
        );
      }
      const requested = bookingModelParam as BookingModel;
      if (!venueExposesBookingModel(venueMode.bookingModel, venueMode.enabledModels, requested)) {
        return NextResponse.json(
          { error: 'This booking type is not enabled for this venue' },
          { status: 403 },
        );
      }
      if (requested === 'event_ticket') {
        return handleEventAvailability(supabase, venueId, dateStr);
      }
      if (requested === 'class_session') {
        return handleClassAvailability(supabase, venueId, dateStr);
      }
      return handleResourceAvailability(supabase, venueId, dateStr, searchParams);
    }

    // Dispatch to model-specific availability engines (primary model when booking_model omitted)
    if (isUnifiedSchedulingVenue(venueMode.bookingModel)) {
      return handleAppointmentAvailability(supabase, venueId, dateStr, searchParams);
    }
    if (venueMode.bookingModel === 'event_ticket') {
      return handleEventAvailability(supabase, venueId, dateStr);
    }
    if (venueMode.bookingModel === 'class_session') {
      return handleClassAvailability(supabase, venueId, dateStr);
    }
    if (venueMode.bookingModel === 'resource_booking') {
      return handleResourceAvailability(supabase, venueId, dateStr, searchParams);
    }

    // Model A: table reservation
    const useServiceEngine = venueMode.availabilityEngine === 'service';

    if (!useServiceEngine) {
      return NextResponse.json({ error: AVAILABILITY_SETUP_REQUIRED_MESSAGE }, { status: 503 });
    }

    const tablePartySize = partySize ?? 2;

    const { data: venueAreaRow } = await supabase
      .from('venues')
      .select('public_booking_area_mode')
      .eq('id', venueId)
      .maybeSingle();
    const publicBookingAreaMode =
      (venueAreaRow as { public_booking_area_mode?: string } | null)?.public_booking_area_mode ?? 'auto';

    const areas = await listActiveAreasForVenue(supabase, venueId);
    const areaIdParam = searchParams.get('area_id');

    if (areas.length === 0) {
      return NextResponse.json({ error: AVAILABILITY_SETUP_REQUIRED_MESSAGE }, { status: 503 });
    }

    const multiArea = areas.length > 1;

    if (multiArea && publicBookingAreaMode === 'manual' && !areaIdParam) {
      return NextResponse.json(
        {
          error: 'area_id is required for this venue',
          public_booking_area_mode: publicBookingAreaMode,
          areas,
        },
        { status: 400 },
      );
    }

    const areasToEvaluate = areaIdParam
      ? areas.filter((a) => a.id === areaIdParam)
      : areas;

    if (areasToEvaluate.length === 0) {
      return NextResponse.json({ error: 'Invalid area_id' }, { status: 400 });
    }

    const mergedActive: EngineServiceResult[] = [];
    const mergedSlots: ServiceAvailableSlot[] = [];
    let mergedLarge: EngineServiceResult | undefined;

    for (const area of areasToEvaluate) {
      const { activeResults, allSlots, largePartyRedirect } = await runTableReservationAvailabilityForArea(
        supabase,
        venueId,
        dateStr,
        tablePartySize,
        venueMode,
        area,
        multiArea,
      );
      mergedActive.push(...activeResults);
      mergedSlots.push(...allSlots);
      if (!mergedLarge && largePartyRedirect) {
        mergedLarge = largePartyRedirect;
      }
    }

    mergedSlots.sort((a, b) => {
      const t = a.start_time.localeCompare(b.start_time);
      if (t !== 0) return t;
      return (a.area_name ?? '').localeCompare(b.area_name ?? '');
    });

    const responseBody: Record<string, unknown> = {
      date: dateStr,
      venue_id: venueId,
      slots: mergedSlots,
      services: mergedActive.map((r) => ({
        id: r.service.id,
        name: r.service.name,
        slots: r.slots,
        large_party_redirect: r.large_party_redirect,
        large_party_message: r.large_party_message,
      })),
      large_party_redirect: mergedLarge?.large_party_redirect ?? false,
      large_party_message: mergedLarge?.large_party_message ?? null,
    };

    if (multiArea) {
      responseBody.public_booking_area_mode = publicBookingAreaMode;
      responseBody.areas = areas;
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    console.error('Availability fetch failed:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  } finally {
    if (process.env.DEBUG_PERF_API === '1' && typeof performance !== 'undefined') {
      console.info('[GET /api/booking/availability]', { ms: Math.round(performance.now() - t0) });
    }
  }
}

// ---------------------------------------------------------------------------
// Model B: Practitioner appointment availability
// ---------------------------------------------------------------------------
async function handleAppointmentAvailability(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
  date: string,
  searchParams: URLSearchParams,
) {
  const practitionerId = searchParams.get('practitioner_id') ?? undefined;
  const serviceId = searchParams.get('service_id') ?? undefined;

  const phantomsParam = searchParams.get('phantoms');
  let phantomBookings: PhantomBooking[] = [];
  if (phantomsParam) {
    try {
      phantomBookings = JSON.parse(phantomsParam);
    } catch (e) {
      console.warn('[booking/availability] invalid phantoms JSON ignored', { length: phantomsParam.length, e });
    }
  }

  const input = await fetchAppointmentInput({ supabase, venueId, date, practitionerId, serviceId });
  if (phantomBookings.length > 0) {
    input.phantomBookings = phantomBookings;
  }

  const variantId = searchParams.get('variant_id');
  if (variantId && serviceId) {
    const variant = await loadActiveVariantForService({
      admin: supabase,
      venueId,
      serviceId,
      variantId,
    });
    if (!variant) {
      return NextResponse.json({ error: 'Invalid variant_id for this service' }, { status: 400 });
    }
    applyVariantToAppointmentInput({ services: input.services, serviceId, variant });
  }

  const { data: venueClock } = await supabase
    .from('venues')
    .select('timezone, booking_rules, opening_hours, venue_opening_exceptions')
    .eq('id', venueId)
    .single();
  const venueMode = await resolveVenueMode(supabase, venueId);
  const bookingWindow = serviceId
    ? await loadServiceEntityBookingWindow(supabase, venueId, venueMode.bookingModel, serviceId)
    : DEFAULT_ENTITY_BOOKING_WINDOW;
  attachVenueClockToAppointmentInput(input, venueClock ?? {}, bookingWindow);
  const result = computeAppointmentAvailability(input);

  return NextResponse.json({ date, venue_id: venueId, ...result });
}

// ---------------------------------------------------------------------------
// Model C: Event / experience availability
// ---------------------------------------------------------------------------
async function handleEventAvailability(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
  date: string,
) {
  const input = await fetchEventInput({ supabase, venueId, date });
  const { data: v } = await supabase.from('venues').select('timezone').eq('id', venueId).maybeSingle();
  const tz =
    typeof (v as { timezone?: string | null } | null)?.timezone === 'string' &&
    String((v as { timezone?: string | null }).timezone).trim() !== ''
      ? String((v as { timezone?: string | null }).timezone).trim()
      : 'Europe/London';
  const result = computeEventAvailability(input, { venueTimezone: tz });

  return NextResponse.json({ date, venue_id: venueId, events: result });
}

// ---------------------------------------------------------------------------
// Model D: Class session availability
// ---------------------------------------------------------------------------
async function handleClassAvailability(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
  date: string,
) {
  const input = await fetchClassInput({ supabase, venueId, date, forPublicBooking: true });
  const result = computeClassAvailability(input);

  return NextResponse.json({ date, venue_id: venueId, classes: result });
}

// ---------------------------------------------------------------------------
// Model E: Resource booking availability
// ---------------------------------------------------------------------------
async function handleResourceAvailability(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
  date: string,
  searchParams: URLSearchParams,
) {
  const resourceId = searchParams.get('resource_id') ?? undefined;
  const durationMinutes = parseInt(searchParams.get('duration') ?? '60', 10) || 60;

  const input = await fetchResourceInput({ supabase, venueId, date, resourceId });
  const result = computeResourceAvailability(input, durationMinutes);

  return NextResponse.json({ date, venue_id: venueId, resources: result });
}
