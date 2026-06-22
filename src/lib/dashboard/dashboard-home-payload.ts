import type { SupabaseClient } from '@supabase/supabase-js';
import { nowInVenueTz } from '@/lib/day-sheet';
import { getDayOfWeek, fetchEngineInput, resolveServiceForDate, timeToMinutes } from '@/lib/availability';
import {
  peakOverlappingCovers,
  resolveOpeningWindowMinutes,
  coversOverlappingNow,
  coversArrivingWithin,
  resolveVenueConcurrentCapLegacy,
  type DashboardLoadBooking,
} from '@/lib/dashboard/load-metrics';
import {
  resolveServiceEngineConcurrentCapFromInput,
  perServiceConcurrentSlotCaps,
  defaultDurationForDashboardDay,
} from '@/lib/dashboard/resolve-venue-concurrent-cap';
import { getDefaultAreaIdForVenue } from '@/lib/areas/resolve-default-area';
import { resolveVenueMode } from '@/lib/venue-mode';
import { computeGuestBookingReady } from '@/lib/setup-guest-booking-ready';
import type { AvailabilityConfig, EngineInput, OpeningHours } from '@/types/availability';
import type { BookingModel } from '@/types/booking-models';
import { isAppointmentDashboardExperience, isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import { isAppointmentPlanTier, isRestaurantTableProductTier } from '@/lib/tier-enforcement';
import { inferBookingRowModel, bookingModelShortLabel } from '@/lib/booking/infer-booking-row-model';
import { BOOKING_MODEL_ORDER } from '@/lib/booking/enabled-models';
import { isAttendanceConfirmed } from '@/lib/booking/booking-staff-indicators';
import type { VenueStaff } from '@/lib/venue-auth';
import { formatGuestDisplayName } from '@/lib/guests/name';

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function addDaysToDateStr(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + delta));
  return t.toISOString().slice(0, 10);
}

function weekdayShortForDateStr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const wd = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return WEEKDAYS_SHORT[wd]!;
}

function activeBookingModelsInOrder(primary: BookingModel, enabled: BookingModel[]): BookingModel[] {
  const active = new Set<BookingModel>([primary, ...enabled]);
  return BOOKING_MODEL_ORDER.filter((m) => active.has(m));
}

function mergeTodayByModelWithActiveModels(
  counts: Record<string, number>,
  primary: BookingModel,
  enabled: BookingModel[],
): Record<string, number> {
  const ordered = activeBookingModelsInOrder(primary, enabled);
  const out: Record<string, number> = {};
  for (const m of ordered) {
    out[m] = counts[m] ?? 0;
  }
  for (const [k, v] of Object.entries(counts)) {
    if (out[k] === undefined) out[k] = v;
  }
  return out;
}

function toLoadBookings(
  rows: Array<{
    booking_time?: string | null;
    party_size: number;
    status: string;
    estimated_end_time?: string | null;
  }>,
): DashboardLoadBooking[] {
  return rows.map((b) => ({
    booking_time: typeof b.booking_time === 'string' ? b.booking_time : '',
    party_size: b.party_size,
    status: b.status,
    estimated_end_time: b.estimated_end_time ?? null,
  }));
}

/** JSON shape returned by `GET /api/venue/dashboard-home` and server-rendered dashboard home. */
export interface DashboardHomePayload {
  booking_model?: string;
  /** Appointments vs restaurant SKU — drives appointment-style dashboard copy when primary `booking_model` is C/D/E only. */
  pricing_tier?: string | null;
  active_booking_models?: unknown;
  enabled_models?: unknown;
  today_by_booking_model?: Record<string, number>;
  today: {
    covers: number;
    bookings: number;
    confirmed: number;
    pending: number;
    seated: number;
    revenue: number;
    next_booking: { time: string; party_size: number } | null;
    peak_in_house_covers: number;
    concurrent_cap: number | null;
    peak_fill_percent: number | null;
    covers_in_house_now: number;
    arriving_within_30_min: number;
  };
  forecast: Array<{ date: string; day: string; covers: number; bookings: number }>;
  heatmap: Array<{
    date: string;
    day: string;
    daily_total_covers: number;
    peak_in_house_covers: number;
    concurrent_cap: number | null;
    fill_percent: number | null;
    /** Restaurant + service engine: one segment per dining service for that day. */
    by_service?: Array<{
      service_id: string;
      service_name: string;
      daily_total_covers: number;
      peak_in_house_covers: number;
      concurrent_cap: number | null;
      fill_percent: number | null;
    }>;
  }>;
  alerts: Array<{ type: string; message: string }>;
  recent_bookings: Array<{
    id: string;
    time: string;
    party_size: number;
    status: string;
    guest_name: string;
    deposit_status: string;
    kind_label?: string;
    booking_model?: string;
  }>;
  /**
   * Restaurant table-primary venue with secondary enabled models (`enabled_models`): dining metrics (`today`,
   * `forecast`, `heatmap`) reflect **table** bookings only. See `secondary_booking_activity` for combined non-table totals.
   */
  table_focus_secondaries_enabled?: boolean;
  /** Bookings inferred as non-table reservations (today + 7-day forecast; no dining heatmap). */
  secondary_booking_activity?: {
    today: Pick<
      DashboardHomePayload['today'],
      | 'covers'
      | 'bookings'
      | 'confirmed'
      | 'pending'
      | 'seated'
      | 'revenue'
      | 'next_booking'
    >;
    forecast: DashboardHomePayload['forecast'];
  };
  /**
   * At-a-glance cards for class/event/resource venues (today only). Present when the venue has any
   * C/D/E model active; each sub-block is present only for the models that are active.
   */
  cde_today?: {
    classes?: {
      /** Booking rows tied to a class instance today. */
      bookings: number;
      /** Total attendees booked (Σ party_size). */
      attendees: number;
      /** Combined capacity of the distinct class instances booked today (null if unknown). */
      capacity: number | null;
      /** attendees / capacity, 0-100 (null when capacity unknown). */
      fill_percent: number | null;
    };
    events?: {
      /** Event ticket booking rows today. */
      bookings: number;
      /** Tickets sold today (Σ party_size). */
      tickets: number;
      /** Deposit/prepayment taken today, in major currency units. */
      revenue: number;
    };
    resources?: {
      /** Resource booking rows today. */
      bookings: number;
    };
  };
}

type DashboardBookingOpsRow = {
  /** Present on week-scope rows only; omit for same-day aggregates. */
  booking_date?: string;
  booking_time?: string | null;
  party_size: number;
  status: string;
  deposit_amount_pence?: number | null;
  estimated_end_time?: string | null;
  guest_attendance_confirmed_at?: string | null;
  staff_attendance_confirmed_at?: string | null;
} & Record<string, unknown>;

function inferBookingRowModelFromFetchedRow(row: DashboardBookingOpsRow): BookingModel {
  return inferBookingRowModel({
    experience_event_id: row.experience_event_id as string | null | undefined,
    class_instance_id: row.class_instance_id as string | null | undefined,
    resource_id: row.resource_id as string | null | undefined,
    event_session_id: row.event_session_id as string | null | undefined,
    calendar_id: row.calendar_id as string | null | undefined,
    service_item_id: row.service_item_id as string | null | undefined,
    practitioner_id: row.practitioner_id as string | null | undefined,
    appointment_service_id: row.appointment_service_id as string | null | undefined,
  });
}

function computeBookingForecastAndTodayOps(input: {
  todayBookings: DashboardBookingOpsRow[];
  weekBookingsForOps: DashboardBookingOpsRow[];
  dateStrs: string[];
  nowMinutes: number;
}): {
  forecast: DashboardHomePayload['forecast'];
  today: NonNullable<DashboardHomePayload['secondary_booking_activity']>['today'];
} {
  const { todayBookings, weekBookingsForOps, dateStrs, nowMinutes } = input;
  const todayCovers = todayBookings.reduce((sum, b) => sum + b.party_size, 0);
  const todayBookingCount = todayBookings.length;
  const todayRevenue =
    todayBookings.reduce((sum, b) => sum + (b.deposit_amount_pence ?? 0), 0) / 100;
  const confirmedCount = todayBookings.filter((b) => isAttendanceConfirmed(b)).length;
  const pendingCount = todayBookings.filter((b) => b.status === 'Pending').length;
  const seatedCount = todayBookings.filter((b) => b.status === 'Seated').length;

  let nextBooking: { time: string; party_size: number } | null = null;
  for (const b of [...todayBookings].sort((a, c) =>
    String(a.booking_time ?? '').localeCompare(String(c.booking_time ?? '')),
  )) {
    const t = String(b.booking_time ?? '');
    const [h, mPart] = t.split(':').map(Number);
    if ((h ?? 0) * 60 + (mPart ?? 0) > nowMinutes) {
      nextBooking = { time: t.slice(0, 5), party_size: b.party_size };
      break;
    }
  }

  const forecast: DashboardHomePayload['forecast'] = [];
  for (const dateStr of dateStrs) {
    const dayBookings = weekBookingsForOps.filter((b) => b.booking_date === dateStr);
    forecast.push({
      date: dateStr,
      day: weekdayShortForDateStr(dateStr),
      covers: dayBookings.reduce((sum, b) => sum + b.party_size, 0),
      bookings: dayBookings.length,
    });
  }

  return {
    forecast,
    today: {
      covers: todayCovers ?? 0,
      bookings: todayBookingCount ?? 0,
      confirmed: confirmedCount ?? 0,
      pending: pendingCount ?? 0,
      seated: seatedCount ?? 0,
      revenue: todayRevenue ?? 0,
      next_booking: nextBooking,
    },
  };
}

/** Dining load: forecast rows, heatmap, and aggregated `today` block (covers in house, fills, deposits, etc.). */
function computeRestaurantTableLoadSlice(input: {
  todayBookings: DashboardBookingOpsRow[];
  weekBookingsForOps: DashboardBookingOpsRow[];
  dateStrs: string[];
  todayStrVenue: string;
  nowMinutes: number;
  openingHours: OpeningHours | null;
  availabilityConfig: AvailabilityConfig | null;
  engine: 'legacy' | 'service';
  engineInputsByDate: Map<string, EngineInput> | null;
  useServiceAreaScope: boolean;
  venueId: string;
  caps: Array<number | null>;
}): {
  forecast: DashboardHomePayload['forecast'];
  heatmap: DashboardHomePayload['heatmap'];
  today: DashboardHomePayload['today'];
} {
  const {
    todayBookings,
    weekBookingsForOps,
    dateStrs,
    todayStrVenue,
    nowMinutes,
    openingHours,
    availabilityConfig,
    engine,
    engineInputsByDate,
    useServiceAreaScope,
    venueId,
    caps,
  } = input;

  const ops = computeBookingForecastAndTodayOps({
    todayBookings,
    weekBookingsForOps,
    dateStrs,
    nowMinutes,
  });
  const forecast = ops.forecast;
  const todayCovers = ops.today.covers;
  const todayBookingCount = ops.today.bookings;
  const confirmedCount = ops.today.confirmed;
  const pendingCount = ops.today.pending;
  const seatedCount = ops.today.seated;
  const todayRevenue = ops.today.revenue;
  const nextBooking = ops.today.next_booking;

  const heatmap: DashboardHomePayload['heatmap'] = [];

  for (let i = 0; i < 7; i++) {
    const dateStr = dateStrs[i]!;
    const dayBookings = weekBookingsForOps.filter((b) => b.booking_date === dateStr);
    const engineInput = engine === 'service' ? engineInputsByDate?.get(dateStr) ?? null : null;
    const defaultDur = defaultDurationForDashboardDay(engine, engineInput, availabilityConfig);

    const dayOfWeek = getDayOfWeek(dateStr);
    const window = resolveOpeningWindowMinutes(openingHours, dayOfWeek);
    const earliestMin = window?.startMin ?? 11 * 60;
    const latestMin = window?.endMin ?? 23 * 60;

    const peak = peakOverlappingCovers(toLoadBookings(dayBookings), {
      earliestMin,
      latestMin,
      stepMinutes: 30,
      defaultDurationMinutes: defaultDur,
    });

    const cap = caps[i] ?? null;
    const fillPercent = cap != null && cap > 0 ? Math.min(100, Math.round((peak / cap) * 100)) : null;

    let by_service:
      | Array<{
          service_id: string;
          service_name: string;
          daily_total_covers: number;
          peak_in_house_covers: number;
          concurrent_cap: number | null;
          fill_percent: number | null;
        }>
      | undefined;
    if (useServiceAreaScope && engineInput && engineInput.services.length > 0) {
      const capRows = perServiceConcurrentSlotCaps(engineInput, venueId, dateStr);
      const capMap = new Map(capRows.map((r) => [r.serviceId, r] as const));
      const sortedServices = [...engineInput.services].sort((a, b) => a.sort_order - b.sort_order);
      by_service = sortedServices.map((service) => {
        const capRow = capMap.get(service.id);
        const svcCap = capRow?.cap ?? null;
        const effective = resolveServiceForDate(
          service,
          engineInput.schedule_exceptions,
          venueId,
          dateStr,
          dayOfWeek,
        );
        if (!effective) {
          return {
            service_id: service.id,
            service_name: service.name,
            daily_total_covers: 0,
            peak_in_house_covers: 0,
            concurrent_cap: null,
            fill_percent: null,
          };
        }
        const winStart = timeToMinutes(effective.start_time);
        let winEnd = timeToMinutes(effective.end_time);
        if (winEnd <= winStart) winEnd += 24 * 60;
        const svcDurations = engineInput.durations.filter((d) => d.service_id === service.id);
        const svcDur =
          svcDurations.length > 0 ? Math.min(...svcDurations.map((d) => d.duration_minutes)) : defaultDur;
        const svcBookings = dayBookings.filter(
          (b) => String((b as { service_id?: string | null }).service_id ?? '') === service.id,
        );
        const svcPeak = peakOverlappingCovers(toLoadBookings(svcBookings), {
          earliestMin: winStart,
          latestMin: winEnd,
          stepMinutes: 30,
          defaultDurationMinutes: svcDur,
        });
        const svcDaily = svcBookings.reduce((sum, b) => sum + b.party_size, 0);
        const svcFill =
          svcCap != null && svcCap > 0 ? Math.min(100, Math.round((svcPeak / svcCap) * 100)) : null;
        return {
          service_id: service.id,
          service_name: service.name,
          daily_total_covers: svcDaily,
          peak_in_house_covers: svcPeak,
          concurrent_cap: svcCap,
          fill_percent: svcFill,
        };
      });
    }

    heatmap.push({
      date: dateStr,
      day: forecast[i]!.day,
      daily_total_covers: forecast[i]!.covers ?? 0,
      peak_in_house_covers: peak ?? 0,
      concurrent_cap: cap ?? null,
      fill_percent: fillPercent ?? null,
      ...(by_service && by_service.length > 0 ? { by_service } : {}),
    });
  }

  const todayHeat = heatmap[0]!;
  const todayEngineInput = engine === 'service' ? engineInputsByDate?.get(todayStrVenue) ?? null : null;
  const todayDefaultDur = defaultDurationForDashboardDay(engine, todayEngineInput, availabilityConfig);
  const todayLoadBookings = toLoadBookings(todayBookings);

  const coversInHouseNow = coversOverlappingNow(todayLoadBookings, nowMinutes, todayDefaultDur);
  const arrivingWithin30 = coversArrivingWithin(todayLoadBookings, nowMinutes, 30, todayDefaultDur);

  return {
    forecast,
    heatmap,
    today: {
      covers: todayCovers ?? 0,
      bookings: todayBookingCount ?? 0,
      confirmed: confirmedCount ?? 0,
      pending: pendingCount ?? 0,
      seated: seatedCount ?? 0,
      revenue: todayRevenue ?? 0,
      next_booking: nextBooking,
      peak_in_house_covers: todayHeat.peak_in_house_covers ?? 0,
      concurrent_cap: todayHeat.concurrent_cap ?? null,
      peak_fill_percent: todayHeat.fill_percent ?? null,
      covers_in_house_now: coversInHouseNow ?? 0,
      arriving_within_30_min: arrivingWithin30 ?? 0,
    },
  };
}

/**
 * At-a-glance CDE cards for today (classes fill %, event ticket sales, resource bookings).
 * Only computes sub-blocks for the models the venue actually has active. Class fill % needs the
 * booked instances' capacities, so it issues one extra query when there are class bookings today.
 */
async function computeCdeTodaySummary(
  admin: SupabaseClient,
  todayBookings: DashboardBookingOpsRow[],
  activeModels: Set<BookingModel>,
): Promise<DashboardHomePayload['cde_today']> {
  const wantClasses = activeModels.has('class_session');
  const wantEvents = activeModels.has('event_ticket');
  const wantResources = activeModels.has('resource_booking');
  if (!wantClasses && !wantEvents && !wantResources) return undefined;

  const out: NonNullable<DashboardHomePayload['cde_today']> = {};

  if (wantClasses) {
    const classRows = todayBookings.filter(
      (b) => inferBookingRowModelFromFetchedRow(b) === 'class_session',
    );
    const attendees = classRows.reduce((sum, b) => sum + (b.party_size ?? 0), 0);
    const instanceIds = [
      ...new Set(
        classRows
          .map((b) => (b.class_instance_id as string | null | undefined) ?? null)
          .filter((v): v is string => Boolean(v)),
      ),
    ];
    let capacity: number | null = null;
    if (instanceIds.length > 0) {
      // Effective capacity = instance override ?? parent class type capacity (matches the engine).
      const { data: caps } = await admin
        .from('class_instances')
        .select('id, capacity_override, class_types(capacity)')
        .in('id', instanceIds);
      if (caps && caps.length > 0) {
        capacity = caps.reduce((sum, r) => {
          const row = r as {
            capacity_override?: number | null;
            class_types?: { capacity?: number | null } | { capacity?: number | null }[] | null;
          };
          const typeCap = Array.isArray(row.class_types)
            ? row.class_types[0]?.capacity
            : row.class_types?.capacity;
          const eff = row.capacity_override ?? typeCap ?? 0;
          return sum + (Number(eff) || 0);
        }, 0);
        if (capacity <= 0) capacity = null;
      }
    }
    const fillPercent =
      capacity != null && capacity > 0 ? Math.min(100, Math.round((attendees / capacity) * 100)) : null;
    out.classes = { bookings: classRows.length, attendees, capacity, fill_percent: fillPercent };
  }

  if (wantEvents) {
    const eventRows = todayBookings.filter(
      (b) => inferBookingRowModelFromFetchedRow(b) === 'event_ticket',
    );
    const tickets = eventRows.reduce((sum, b) => sum + (b.party_size ?? 0), 0);
    const revenue =
      eventRows.reduce((sum, b) => sum + (b.deposit_amount_pence ?? 0), 0) / 100;
    out.events = { bookings: eventRows.length, tickets, revenue };
  }

  if (wantResources) {
    const resourceRows = todayBookings.filter(
      (b) => inferBookingRowModelFromFetchedRow(b) === 'resource_booking',
    );
    out.resources = { bookings: resourceRows.length };
  }

  return out;
}

/**
 * Build dashboard home summary for an authenticated venue staff member.
 * Caller must use the service-role client from `VenueStaff` (same as API routes).
 */
export async function buildDashboardHomePayload(
  admin: SupabaseClient,
  staff: VenueStaff,
): Promise<DashboardHomePayload> {
  const { data: venueRow, error: venueErr } = await admin
    .from('venues')
    .select('availability_config, opening_hours, timezone, booking_model, enabled_models, active_booking_models, pricing_tier')
    .eq('id', staff.venue_id)
    .single();

  if (venueErr || !venueRow) {
    console.error('dashboard-home venue failed:', venueErr);
    throw new Error('Venue not found');
  }

  const tz = (venueRow.timezone as string) ?? 'Europe/London';
  const { dateStr: todayStrVenue, minutesSinceMidnight: nowMinutes } = nowInVenueTz(tz);
  const weekEndStr = addDaysToDateStr(todayStrVenue, 6);

  const availabilityConfig = venueRow.availability_config as AvailabilityConfig | null;
  const openingHours = venueRow.opening_hours;
  const venueMode = await resolveVenueMode(admin, staff.venue_id);
  const engine: 'legacy' | 'service' = venueMode.availabilityEngine === 'service' ? 'service' : 'legacy';

  const dateStrs = Array.from({ length: 7 }, (_, i) => addDaysToDateStr(todayStrVenue, i));

  let engineInputsByDate: Map<string, EngineInput> | null = null;
  if (engine === 'service') {
    const inputs = await Promise.all(
      dateStrs.map((d) =>
        fetchEngineInput({
          supabase: admin,
          venueId: staff.venue_id,
          date: d,
          partySize: 1,
        }),
      ),
    );
    engineInputsByDate = new Map(dateStrs.map((d, i) => [d, inputs[i]!]));
  }

  const defaultAreaId =
    engine === 'service' ? await getDefaultAreaIdForVenue(admin, staff.venue_id) : null;
  const useServiceAreaScope =
    engine === 'service' &&
    venueMode.bookingModel === 'table_reservation' &&
    Boolean(defaultAreaId);

  const bookingListCols =
    'id, booking_time, party_size, status, deposit_amount_pence, guest_id, estimated_end_time, deposit_status, guest_attendance_confirmed_at, staff_attendance_confirmed_at, experience_event_id, class_instance_id, resource_id, event_session_id, calendar_id, service_item_id, practitioner_id, appointment_service_id';

  const [todayBookingsRes, weekBookingsRes] = await Promise.all([
    admin
      .from('bookings')
      .select(bookingListCols)
      .eq('venue_id', staff.venue_id)
      .eq('booking_date', todayStrVenue)
      .in('status', ['Booked', 'Confirmed', 'Pending', 'Seated']),
    admin
      .from('bookings')
      .select(
        `id, booking_date, booking_time, party_size, status, deposit_amount_pence, guest_id, estimated_end_time, deposit_status, guest_attendance_confirmed_at, staff_attendance_confirmed_at, experience_event_id, class_instance_id, resource_id, event_session_id, calendar_id, service_item_id, practitioner_id, appointment_service_id, service_id, area_id`,
      )
      .eq('venue_id', staff.venue_id)
      .gte('booking_date', todayStrVenue)
      .lte('booking_date', weekEndStr)
      .in('status', ['Booked', 'Confirmed', 'Pending', 'Seated']),
  ]);

  const todayBookings = todayBookingsRes.data ?? [];
  const weekBookings = weekBookingsRes.data ?? [];
  const weekBookingsForOps = useServiceAreaScope
    ? weekBookings.filter((b) => String((b as { area_id?: string | null }).area_id ?? '') === String(defaultAreaId))
    : weekBookings;

  const todayByModel: Record<string, number> = {};
  for (const b of todayBookings) {
    const row = b as Record<string, unknown>;
    const m = inferBookingRowModel({
      experience_event_id: row.experience_event_id as string | null | undefined,
      class_instance_id: row.class_instance_id as string | null | undefined,
      resource_id: row.resource_id as string | null | undefined,
      event_session_id: row.event_session_id as string | null | undefined,
      calendar_id: row.calendar_id as string | null | undefined,
      service_item_id: row.service_item_id as string | null | undefined,
      practitioner_id: row.practitioner_id as string | null | undefined,
      appointment_service_id: row.appointment_service_id as string | null | undefined,
    });
    todayByModel[m] = (todayByModel[m] ?? 0) + 1;
  }

  const venueBookingModel = venueMode.bookingModel;
  const pricingTier = (venueRow as { pricing_tier?: string | null }).pricing_tier;
  const enabledModelsNorm = venueMode.enabledModels;

  const tableFocusSecondariesEnabled =
    venueBookingModel === 'table_reservation' &&
    isRestaurantTableProductTier(pricingTier) &&
    enabledModelsNorm.length > 0;

  const toOpsRow = (b: unknown) => b as DashboardBookingOpsRow;

  const todayForTableMetrics = todayBookings.filter((b) => {
    if (!tableFocusSecondariesEnabled) return true;
    return inferBookingRowModelFromFetchedRow(toOpsRow(b)) === 'table_reservation';
  });
  const weekForTableMetrics = weekBookingsForOps.filter((b) => {
    if (!tableFocusSecondariesEnabled) return true;
    return inferBookingRowModelFromFetchedRow(toOpsRow(b)) === 'table_reservation';
  });

  const todayNonTable = tableFocusSecondariesEnabled
    ? todayBookings.filter((b) => inferBookingRowModelFromFetchedRow(toOpsRow(b)) !== 'table_reservation')
    : [];
  const weekNonTableFull = tableFocusSecondariesEnabled
    ? weekBookings.filter((b) => inferBookingRowModelFromFetchedRow(toOpsRow(b)) !== 'table_reservation')
    : [];

  const caps: Array<number | null> = dateStrs.map((dateStr) => {
    if (engine === 'service' && engineInputsByDate) {
      const input = engineInputsByDate.get(dateStr);
      if (!input) return null;
      return resolveServiceEngineConcurrentCapFromInput(input, staff.venue_id, dateStr);
    }
    return resolveVenueConcurrentCapLegacy(availabilityConfig, dateStr);
  });

  const { forecast, heatmap, today } = computeRestaurantTableLoadSlice({
    todayBookings: todayForTableMetrics,
    weekBookingsForOps: weekForTableMetrics,
    dateStrs,
    todayStrVenue,
    nowMinutes,
    openingHours: openingHours as OpeningHours | null,
    availabilityConfig,
    engine,
    engineInputsByDate,
    useServiceAreaScope,
    venueId: staff.venue_id,
    caps,
  });

  const todayHeat = heatmap[0]!;

  const secondaryBookingActivity: DashboardHomePayload['secondary_booking_activity'] =
    tableFocusSecondariesEnabled
      ? (() => {
          const s = computeBookingForecastAndTodayOps({
            todayBookings: todayNonTable,
            weekBookingsForOps: weekNonTableFull,
            dateStrs,
            nowMinutes,
          });
          return { today: s.today, forecast: s.forecast };
        })()
      : undefined;

  const isAppt = isAppointmentDashboardExperience(pricingTier, venueBookingModel, venueMode.enabledModels);
  const alertsUseAppointmentTone = isAppt && !tableFocusSecondariesEnabled;
  const alerts: Array<{ type: string; message: string }> = [];

  if (
    staff.role === 'admin' &&
    (venueBookingModel === 'table_reservation' ||
      isUnifiedSchedulingVenue(venueBookingModel as BookingModel) ||
      isAppointmentPlanTier(pricingTier))
  ) {
    const guestReady = await computeGuestBookingReady(
      admin,
      staff.venue_id,
      venueBookingModel as BookingModel,
      true,
    );
    if (!guestReady) {
      alerts.push({
        type: 'warning',
        message:
          isUnifiedSchedulingVenue(venueBookingModel as BookingModel)
            ? 'Public bookings are off until at least one team member has an active linked service. Open Appointment Services to finish setup.'
            : isAppointmentPlanTier(pricingTier)
              ? 'Public bookings are off until services and availability are configured for your active booking types. Use the setup checklist or relevant dashboard sections to finish setup.'
              : 'Public table booking is off until you have at least one active service and availability configured. Use the setup wizard or Availability.',
      });
    }
  }
  if (
    venueBookingModel === 'table_reservation' &&
    todayHeat.fill_percent != null &&
    todayHeat.fill_percent >= 80
  ) {
    alerts.push({
      type: 'warning',
      message: `Today is ${todayHeat.fill_percent}% full at the busiest time (${todayHeat.peak_in_house_covers ?? 0}${todayHeat.concurrent_cap != null ? ` of ${todayHeat.concurrent_cap}` : ''} covers) - walk-in availability may be limited.`,
    });
  }
  if (todayBookings.some((b) => b.status === 'Pending')) {
    const pend = todayBookings.filter((b) => b.status === 'Pending').length;
    alerts.push({
      type: 'info',
      message: `${pend} pending ${alertsUseAppointmentTone ? 'appointment' : 'booking'}${pend > 1 ? 's' : ''} awaiting payment.`,
    });
  }
  const tomorrowStr = dateStrs[1];
  if (tomorrowStr) {
    const combinedTomorrowBookings = weekBookings.filter((b) => b.booking_date === tomorrowStr).length;
    const tomorrowDayLabel = forecast[1]?.day ?? weekdayShortForDateStr(tomorrowStr);
    if (combinedTomorrowBookings === 0) {
      alerts.push({
        type: 'info',
        message: `No bookings yet for tomorrow (${tomorrowDayLabel}).`,
      });
    }
  }

  const guestIds = [...new Set(todayBookings.slice(0, 10).map((b) => b.guest_id).filter(Boolean))] as string[];
  const guestNameById = new Map<string, string>();
  if (guestIds.length > 0) {
    const { data: guests } = await admin.from('guests').select('id, first_name, last_name').in('id', guestIds);
    for (const g of guests ?? []) {
      const row = g as { id: string; first_name: string | null; last_name: string | null };
      guestNameById.set(row.id, formatGuestDisplayName(row.first_name, row.last_name));
    }
  }

  const sortedTodayBookings = [...todayBookings].sort((a, b) =>
    String(a.booking_time).localeCompare(String(b.booking_time)),
  );

  const todayByModelMerged = mergeTodayByModelWithActiveModels(todayByModel, venueBookingModel, enabledModelsNorm);

  // CDE at-a-glance cards (today). Active set = primary + enabled secondaries.
  const activeModelSet = new Set<BookingModel>([venueBookingModel, ...enabledModelsNorm]);
  const cdeToday = await computeCdeTodaySummary(
    admin,
    todayBookings.map((b) => b as DashboardBookingOpsRow),
    activeModelSet,
  );

  return {
    booking_model: venueMode.bookingModel,
    pricing_tier: pricingTier ?? null,
    active_booking_models: venueMode.activeBookingModels,
    enabled_models: enabledModelsNorm,
    today_by_booking_model: todayByModelMerged,
    table_focus_secondaries_enabled: tableFocusSecondariesEnabled || undefined,
    secondary_booking_activity: secondaryBookingActivity,
    cde_today: cdeToday,
    today,
    forecast,
    heatmap,
    alerts,
    recent_bookings: sortedTodayBookings.slice(0, 10).map((b) => {
      const row = b as Record<string, unknown>;
      const m = inferBookingRowModel({
        experience_event_id: row.experience_event_id as string | null | undefined,
        class_instance_id: row.class_instance_id as string | null | undefined,
        resource_id: row.resource_id as string | null | undefined,
        event_session_id: row.event_session_id as string | null | undefined,
        calendar_id: row.calendar_id as string | null | undefined,
        service_item_id: row.service_item_id as string | null | undefined,
        practitioner_id: row.practitioner_id as string | null | undefined,
        appointment_service_id: row.appointment_service_id as string | null | undefined,
      });
      return {
        id: b.id,
        time: typeof b.booking_time === 'string' ? b.booking_time.slice(0, 5) : '',
        party_size: b.party_size,
        status: b.status,
        guest_name: b.guest_id ? (guestNameById.get(b.guest_id) ?? 'Guest') : 'Guest',
        deposit_status: (b.deposit_status as string | undefined) ?? 'N/A',
        booking_model: m,
        kind_label: bookingModelShortLabel(m),
      };
    }),
  };
}
