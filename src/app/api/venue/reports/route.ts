import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import type { BookingModel } from '@/types/booking-models';
import { BOOKING_MODEL_ORDER } from '@/lib/booking/enabled-models';
import { inferBookingRowModel, bookingModelShortLabel } from '@/lib/booking/infer-booking-row-model';
import { isAppointmentDashboardExperience, isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import { normalizeEnabledModels, venueExposesBookingModel } from '@/lib/booking/enabled-models';
import { CAPACITY_CONSUMING_STATUSES } from '@/lib/availability/capacity-status';
import type { WorkingHours } from '@/types/booking-models';
import { normalizeBookingLogEmailConfig } from '@/lib/reports/booking-log-email-config';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { computeVenueBaselineMetrics } from '@/lib/metrics/compute-venue-baseline-metrics';
import type { VenueBaselineMetrics } from '@/lib/metrics/baseline-metrics-types';

export interface ReportByBookingModelRow {
  booking_model: BookingModel;
  label: string;
  booking_count: number;
  covers: number;
  cancelled_count: number;
  completed_count: number;
  checked_in_count: number;
  deposit_pence_collected: number;
}

type BookingBreakdownInput = {
  party_size: number | null;
  status: string | null;
  deposit_amount_pence: number | null;
  deposit_status: string | null;
  experience_event_id: string | null;
  class_instance_id: string | null;
  resource_id: string | null;
  event_session_id: string | null;
  calendar_id: string | null;
  service_item_id: string | null;
  practitioner_id: string | null;
  appointment_service_id: string | null;
  checked_in_at: string | null;
};

function buildBookingModelBreakdown(rows: BookingBreakdownInput[]): ReportByBookingModelRow[] {
  const acc = new Map<
    BookingModel,
    {
      booking_count: number;
      covers: number;
      cancelled_count: number;
      completed_count: number;
      checked_in_count: number;
      deposit_pence_collected: number;
    }
  >();

  for (const r of rows) {
    const m = inferBookingRowModel(r);
    const cur =
      acc.get(m) ?? {
        booking_count: 0,
        covers: 0,
        cancelled_count: 0,
        completed_count: 0,
        checked_in_count: 0,
        deposit_pence_collected: 0,
      };
    cur.booking_count += 1;
    cur.covers += typeof r.party_size === 'number' && r.party_size > 0 ? r.party_size : 0;
    if (r.status === 'Cancelled') cur.cancelled_count += 1;
    if (r.status === 'Completed') cur.completed_count += 1;
    if (r.checked_in_at) cur.checked_in_count += 1;
    if (r.deposit_status === 'Paid' && typeof r.deposit_amount_pence === 'number') {
      cur.deposit_pence_collected += r.deposit_amount_pence;
    }
    acc.set(m, cur);
  }

  return BOOKING_MODEL_ORDER.filter((bm) => acc.has(bm)).map((booking_model) => {
    const v = acc.get(booking_model)!;
    return {
      booking_model,
      label: bookingModelShortLabel(booking_model),
      booking_count: v.booking_count,
      covers: v.covers,
      cancelled_count: v.cancelled_count,
      completed_count: v.completed_count,
      checked_in_count: v.checked_in_count,
      deposit_pence_collected: v.deposit_pence_collected,
    };
  });
}

// ── D2 (a): Event ticket-tier sales breakdown ──────────────────────────────
// Tickets sold + revenue per ticket type, from immutable `booking_ticket_lines`
// snapshots so historic numbers stay correct even after a tier is edited or its
// row is re-minted on save (see review §5.3 C3). Cancelled bookings are excluded.

export interface EventTicketTierRow {
  /** Ticket type id, or a synthetic `label:<name>` key when the line predates a tier. */
  ticket_type_key: string;
  ticket_type_label: string;
  tickets_sold: number;
  revenue_pence: number;
  /** Distinct bookings that included at least one ticket of this tier. */
  booking_count: number;
}

async function buildEventTicketTierBreakdown(
  supabase: SupabaseClient,
  venueId: string,
  from: string,
  to: string,
): Promise<EventTicketTierRow[]> {
  const { data: rows, error } = await supabase
    .from('booking_ticket_lines')
    .select(
      'booking_id, ticket_type_id, label, quantity, unit_price_pence, booking:bookings!inner(venue_id, booking_date, status)',
    )
    .eq('booking.venue_id', venueId)
    .gte('booking.booking_date', from)
    .lte('booking.booking_date', to)
    .neq('booking.status', 'Cancelled');

  if (error) {
    console.error('[reports] event ticket tier query failed:', error);
    return [];
  }

  const acc = new Map<
    string,
    { label: string; tickets_sold: number; revenue_pence: number; bookings: Set<string> }
  >();

  for (const row of (rows ?? []) as Array<{
    booking_id: string;
    ticket_type_id: string | null;
    label: string | null;
    quantity: number | null;
    unit_price_pence: number | null;
    booking: { booking_date?: string | null; status?: string | null } | Array<unknown> | null;
  }>) {
    const label = (row.label ?? '').trim() || 'Ticket';
    // Key by tier id when present so renamed tiers still aggregate; otherwise key
    // by snapshot label so legacy lines with no tier id don't all collapse together.
    const key = row.ticket_type_id ?? `label:${label}`;
    const qty = typeof row.quantity === 'number' && row.quantity > 0 ? row.quantity : 0;
    const unit = typeof row.unit_price_pence === 'number' ? row.unit_price_pence : 0;
    const cur = acc.get(key) ?? { label, tickets_sold: 0, revenue_pence: 0, bookings: new Set<string>() };
    cur.tickets_sold += qty;
    cur.revenue_pence += qty * unit;
    cur.bookings.add(row.booking_id);
    acc.set(key, cur);
  }

  return [...acc.entries()]
    .map(([ticket_type_key, v]) => ({
      ticket_type_key,
      ticket_type_label: v.label,
      tickets_sold: v.tickets_sold,
      revenue_pence: v.revenue_pence,
      booking_count: v.bookings.size,
    }))
    .sort((a, b) => b.revenue_pence - a.revenue_pence || b.tickets_sold - a.tickets_sold);
}

// ── D2 (b): Resource utilisation ───────────────────────────────────────────
// Booked slot-hours vs theoretical available hours per resource, plus booking
// count. Resources live on `unified_calendars` (calendar_type='resource'); their
// time span is `booking_time` + `booking_end_time` (both HH:mm wall-clock). Only
// capacity-consuming statuses count toward occupancy (review T4).

export interface ResourceUtilisationRow {
  resource_id: string;
  resource_name: string;
  booking_count: number;
  occupied_hours: number;
  available_hours: number;
  utilisation_pct: number;
}

const RESOURCE_DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Minutes since midnight for an "HH:mm[:ss]" string; null/garbage → null. */
function resourceTimeToMinutes(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const hh = Number(raw.slice(0, 2));
  const mm = Number(raw.slice(3, 5));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return hh * 60 + mm;
}

/** Open hours for one calendar date from day-keyed `working_hours` (mirrors the resource engine). */
function resourceOpenHoursForDate(hours: WorkingHours | null | undefined, dateStr: string): number {
  if (!hours) return 0;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  const ranges = hours[String(dow)] ?? hours[RESOURCE_DAY_NAMES[dow]!];
  if (!ranges || ranges.length === 0) return 0;
  let minutes = 0;
  for (const r of ranges) {
    const start = resourceTimeToMinutes(r.start);
    const end = resourceTimeToMinutes(r.end);
    if (start == null || end == null || end <= start) continue;
    minutes += end - start;
  }
  return minutes / 60;
}

/** Inclusive list of YYYY-MM-DD dates between `from` and `to` (capped for safety). */
function eachDateInRange(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return out;
  for (let t = start, guard = 0; t <= end && guard < 400; t += 86400000, guard += 1) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

async function buildResourceUtilisation(
  supabase: SupabaseClient,
  venueId: string,
  from: string,
  to: string,
): Promise<ResourceUtilisationRow[]> {
  const [{ data: resources, error: resErr }, { data: bookings, error: bkErr }] = await Promise.all([
    supabase
      .from('unified_calendars')
      .select('id, name, working_hours')
      .eq('venue_id', venueId)
      .eq('calendar_type', 'resource')
      .eq('is_active', true),
    supabase
      .from('bookings')
      .select('resource_id, booking_time, booking_end_time, status')
      .eq('venue_id', venueId)
      .not('resource_id', 'is', null)
      .gte('booking_date', from)
      .lte('booking_date', to)
      .in('status', CAPACITY_CONSUMING_STATUSES as readonly string[]),
  ]);

  if (resErr) console.error('[reports] resource utilisation resources query failed:', resErr);
  if (bkErr) console.error('[reports] resource utilisation bookings query failed:', bkErr);
  if (!resources || resources.length === 0) return [];

  const dates = eachDateInRange(from, to);

  const occupiedByResource = new Map<string, number>();
  const countByResource = new Map<string, number>();
  for (const b of (bookings ?? []) as Array<{
    resource_id: string | null;
    booking_time: string | null;
    booking_end_time: string | null;
    status: string | null;
  }>) {
    if (!b.resource_id) continue;
    countByResource.set(b.resource_id, (countByResource.get(b.resource_id) ?? 0) + 1);
    const start = resourceTimeToMinutes(b.booking_time);
    const end = resourceTimeToMinutes(b.booking_end_time);
    if (start == null || end == null || end <= start) continue;
    occupiedByResource.set(
      b.resource_id,
      (occupiedByResource.get(b.resource_id) ?? 0) + (end - start) / 60,
    );
  }

  return (resources as Array<{ id: string; name: string; working_hours: WorkingHours | null }>)
    .map((res) => {
      const available = dates.reduce((sum, dateStr) => sum + resourceOpenHoursForDate(res.working_hours, dateStr), 0);
      const occupied = occupiedByResource.get(res.id) ?? 0;
      const utilisation = available > 0 ? Math.min(100, Math.round((occupied / available) * 100)) : 0;
      return {
        resource_id: res.id,
        resource_name: res.name,
        booking_count: countByResource.get(res.id) ?? 0,
        occupied_hours: Number(occupied.toFixed(2)),
        available_hours: Number(available.toFixed(2)),
        utilisation_pct: utilisation,
      };
    })
    .sort((a, b) => b.booking_count - a.booking_count || b.occupied_hours - a.occupied_hours);
}

export interface AppointmentInsightsRow {
  /**
   * Legacy practitioner id, or unified calendar id (USE storage puts staff/column on `calendar_id`).
   */
  practitioner_id: string;
  practitioner_name: string;
  booking_count: number;
  completed_count: number;
}

export interface AppointmentServiceInsightsRow {
  /** `appointment_services` id or `service_items` id depending on booking storage. */
  service_id: string;
  service_name: string;
  booking_count: number;
}

/** Appointment scheduling rows only — same inference as the rest of staff reporting (excludes table dining, events, classes, etc.). */
function isAppointmentSchedulingBooking(row: Parameters<typeof inferBookingRowModel>[0]): boolean {
  const m = inferBookingRowModel(row);
  return m === 'practitioner_appointment' || m === 'unified_scheduling';
}

/** True when the UI should count a booking as "arrived or completed" for staff performance. */
function isArrivedOrCompletedAppointmentBooking(r: {
  status: string | null;
  client_arrived_at?: string | null;
}): boolean {
  if (r.status === 'Seated' || r.status === 'Completed') return true;
  return typeof r.client_arrived_at === 'string' && r.client_arrived_at.trim() !== '';
}

interface AddonRevenueInsights {
  total_pence: number;
  bookings_with_addons: number;
  top_addons: Array<{
    addon_name_snapshot: string;
    addon_group_name_snapshot: string | null;
    bookings: number;
    revenue_pence: number;
    total_duration_minutes: number;
  }>;
  by_group: Array<{
    addon_group_name_snapshot: string;
    bookings: number;
    revenue_pence: number;
  }>;
}

async function buildAppointmentInsights(
  supabase: SupabaseClient,
  venueId: string,
  from: string,
  to: string,
): Promise<{
  by_practitioner: AppointmentInsightsRow[];
  by_service: AppointmentServiceInsightsRow[];
  by_booking_source: Record<string, number>;
  addon_revenue: AddonRevenueInsights;
}> {
  const emptyAddonRevenue: AddonRevenueInsights = {
    total_pence: 0,
    bookings_with_addons: 0,
    top_addons: [],
    by_group: [],
  };
  const empty = {
    by_practitioner: [] as AppointmentInsightsRow[],
    by_service: [] as AppointmentServiceInsightsRow[],
    by_booking_source: {} as Record<string, number>,
    addon_revenue: emptyAddonRevenue,
  };

  const { data: rows, error } = await supabase
    .from('bookings')
    .select(
      'id, status, source, practitioner_id, appointment_service_id, booking_model, experience_event_id, class_instance_id, resource_id, event_session_id, calendar_id, service_item_id, client_arrived_at',
    )
    .eq('venue_id', venueId)
    .gte('booking_date', from)
    .lte('booking_date', to)
    .neq('status', 'Cancelled');

  if (error) {
    console.error('[reports] appointment insights bookings query failed:', error);
    return empty;
  }

  const appointmentRows = (rows ?? []).filter((r) => isAppointmentSchedulingBooking(r));
  if (!appointmentRows.length) return empty;

  const legacyPracIds = [...new Set(appointmentRows.map((r) => r.practitioner_id).filter(Boolean))] as string[];
  const calendarIds = [...new Set(appointmentRows.map((r) => r.calendar_id).filter(Boolean))] as string[];
  const appointmentServiceIds = [...new Set(appointmentRows.map((r) => r.appointment_service_id).filter(Boolean))] as string[];
  const serviceItemIds = [...new Set(appointmentRows.map((r) => r.service_item_id).filter(Boolean))] as string[];

  const [pracRes, ucRes, apptSvcRes, itemRes] = await Promise.all([
    legacyPracIds.length
      ? supabase.from('practitioners').select('id, name').eq('venue_id', venueId).in('id', legacyPracIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    calendarIds.length
      ? supabase.from('unified_calendars').select('id, name').eq('venue_id', venueId).in('id', calendarIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    appointmentServiceIds.length
      ? supabase.from('appointment_services').select('id, name').eq('venue_id', venueId).in('id', appointmentServiceIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    serviceItemIds.length
      ? supabase.from('service_items').select('id, name').eq('venue_id', venueId).in('id', serviceItemIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
  ]);

  if (pracRes.error) console.error('[reports] practitioners lookup:', pracRes.error);
  if (ucRes.error) console.error('[reports] unified_calendars lookup:', ucRes.error);
  if (apptSvcRes.error) console.error('[reports] appointment_services lookup:', apptSvcRes.error);
  if (itemRes.error) console.error('[reports] service_items lookup:', itemRes.error);

  const legacyPracName = new Map((pracRes.data ?? []).map((p) => [p.id, p.name]));
  const calendarName = new Map((ucRes.data ?? []).map((c) => [c.id, c.name]));
  const appointmentServiceName = new Map((apptSvcRes.data ?? []).map((s) => [s.id, s.name]));
  const serviceItemName = new Map((itemRes.data ?? []).map((s) => [s.id, s.name]));

  const byPrac = new Map<string, { name: string; booking_count: number; completed_count: number }>();
  const bySvc = new Map<string, { name: string; booking_count: number }>();
  const bySource = new Map<string, number>();

  const UNASSIGNED = '__unassigned__';
  const NO_SERVICE = '__no_service__';

  for (const r of appointmentRows) {
    const src = String(r.source ?? 'unknown');
    bySource.set(src, (bySource.get(src) ?? 0) + 1);

    let pkey: string;
    let pname: string;
    if (r.practitioner_id) {
      pkey = r.practitioner_id;
      pname = legacyPracName.get(r.practitioner_id) ?? 'Unknown';
    } else if (r.calendar_id) {
      pkey = r.calendar_id;
      pname = calendarName.get(r.calendar_id) ?? 'Unknown calendar';
    } else {
      pkey = UNASSIGNED;
      pname = 'Unassigned';
    }
    const pcur = byPrac.get(pkey) ?? { name: pname, booking_count: 0, completed_count: 0 };
    pcur.booking_count += 1;
    if (isArrivedOrCompletedAppointmentBooking(r)) pcur.completed_count += 1;
    byPrac.set(pkey, pcur);

    let skey: string;
    let sname: string;
    if (r.appointment_service_id) {
      skey = r.appointment_service_id;
      sname = appointmentServiceName.get(r.appointment_service_id) ?? 'Unknown';
    } else if (r.service_item_id) {
      skey = r.service_item_id;
      sname = serviceItemName.get(r.service_item_id) ?? 'Unknown';
    } else {
      skey = NO_SERVICE;
      sname = 'No service linked';
    }
    const scur = bySvc.get(skey) ?? { name: sname, booking_count: 0 };
    scur.booking_count += 1;
    bySvc.set(skey, scur);
  }

  // ── Add-on revenue (acceptance criterion §20.6) ──
  // Aggregate snapshot rows in `booking_addons` for the appointment bookings in
  // this window. Snapshots are immutable, so historic numbers stay accurate even
  // if the catalog is edited later. Cancelled bookings are already excluded by
  // the parent query above.
  const appointmentBookingIds = appointmentRows.map((r) => r.id as string);
  let addonRevenue: AddonRevenueInsights = emptyAddonRevenue;
  if (appointmentBookingIds.length > 0) {
    const { data: addonRows, error: addonErr } = await supabase
      .from('booking_addons')
      .select(
        'booking_id, addon_id, addon_name_snapshot, addon_group_name_snapshot, price_pence_at_booking, duration_minutes_at_booking',
      )
      .in('booking_id', appointmentBookingIds);
    if (addonErr) {
      console.error('[reports] booking_addons query failed:', addonErr);
    } else if (addonRows && addonRows.length > 0) {
      // Top add-ons keyed by snapshot name so historic numbers stay accurate
      // even after the live row's id changes on a save+reinsert.
      const topMap = new Map<
        string,
        { name: string; group: string | null; bookings: Set<string>; revenue: number; duration: number }
      >();
      const groupMap = new Map<
        string,
        { name: string; bookings: Set<string>; revenue: number }
      >();
      const bookingsWithAddons = new Set<string>();
      let totalPence = 0;
      for (const row of addonRows as Array<{
        booking_id: string;
        addon_id: string | null;
        addon_name_snapshot: string;
        addon_group_name_snapshot: string | null;
        price_pence_at_booking: number;
        duration_minutes_at_booking: number;
      }>) {
        totalPence += row.price_pence_at_booking;
        bookingsWithAddons.add(row.booking_id);
        const topKey = `${row.addon_group_name_snapshot ?? ''}|${row.addon_name_snapshot}`;
        const t =
          topMap.get(topKey) ??
          {
            name: row.addon_name_snapshot,
            group: row.addon_group_name_snapshot,
            bookings: new Set<string>(),
            revenue: 0,
            duration: 0,
          };
        t.bookings.add(row.booking_id);
        t.revenue += row.price_pence_at_booking;
        t.duration += row.duration_minutes_at_booking;
        topMap.set(topKey, t);

        const groupName = row.addon_group_name_snapshot?.trim();
        if (groupName) {
          const g =
            groupMap.get(groupName) ?? { name: groupName, bookings: new Set<string>(), revenue: 0 };
          g.bookings.add(row.booking_id);
          g.revenue += row.price_pence_at_booking;
          groupMap.set(groupName, g);
        }
      }
      addonRevenue = {
        total_pence: totalPence,
        bookings_with_addons: bookingsWithAddons.size,
        top_addons: [...topMap.values()]
          .map((t) => ({
            addon_name_snapshot: t.name,
            addon_group_name_snapshot: t.group,
            bookings: t.bookings.size,
            revenue_pence: t.revenue,
            total_duration_minutes: t.duration,
          }))
          .sort((a, b) => b.revenue_pence - a.revenue_pence)
          .slice(0, 10),
        by_group: [...groupMap.values()]
          .map((g) => ({
            addon_group_name_snapshot: g.name,
            bookings: g.bookings.size,
            revenue_pence: g.revenue,
          }))
          .sort((a, b) => b.revenue_pence - a.revenue_pence),
      };
    }
  }

  return {
    by_practitioner: [...byPrac.entries()]
      .map(([practitioner_id, v]) => ({
        practitioner_id,
        practitioner_name: v.name,
        booking_count: v.booking_count,
        completed_count: v.completed_count,
      }))
      .sort((a, b) => b.booking_count - a.booking_count),
    by_service: [...bySvc.entries()]
      .map(([service_id, v]) => ({
        service_id,
        service_name: v.name,
        booking_count: v.booking_count,
      }))
      .sort((a, b) => b.booking_count - a.booking_count),
    by_booking_source: Object.fromEntries(
      [...bySource.entries()].sort((a, b) => b[1] - a[1]),
    ),
    addon_revenue: addonRevenue,
  };
}

/**
 * GET /api/venue/reports?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns report payloads for the authenticated venue (events as source of truth where applicable).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const fromParam = request.nextUrl.searchParams.get('from');
    const toParam = request.nextUrl.searchParams.get('to');
    const fromStr = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : null;
    const toStr = toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam) ? toParam : null;

    const now = new Date();
    const defaultTo = new Date(now);
    const defaultFrom = new Date(now);
    defaultFrom.setDate(defaultFrom.getDate() - 7);
    const from = fromStr ?? defaultFrom.toISOString().slice(0, 10);
    const to = toStr ?? defaultTo.toISOString().slice(0, 10);
    const pStart = `${from}T00:00:00.000Z`;
    const pEnd = `${to}T23:59:59.999Z`;

    const [
      { data: summary, error: e1 },
      { data: noShowSeries, error: e2 },
      { data: cancellation, error: e3 },
      { data: deposit, error: e4 },
      { data: venueFlags },
      { data: clientSummaryRaw, error: eClient },
      { data: firstAdmin },
    ] = await Promise.all([
      supabase.rpc('report_booking_summary', { p_venue_id: staff.venue_id, p_start: pStart, p_end: pEnd }),
      supabase.rpc('report_no_show_series', { p_venue_id: staff.venue_id, p_start: pStart, p_end: pEnd, p_granularity: 'day' }),
      supabase.rpc('report_cancellation', { p_venue_id: staff.venue_id, p_start: pStart, p_end: pEnd }),
      supabase.rpc('report_deposit_summary', { p_venue_id: staff.venue_id, p_start: pStart, p_end: pEnd }),
      staff.db
        .from('venues')
        .select('table_management_enabled, booking_model, pricing_tier, enabled_models, daily_booking_log_email_config')
        .eq('id', staff.venue_id)
        .single(),
      staff.db.rpc('report_client_summary', {
        p_venue_id: staff.venue_id,
        p_from: from,
        p_to: to,
      }),
      staff.db
        .from('staff')
        .select('email')
        .eq('venue_id', staff.venue_id)
        .eq('role', 'admin')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    if (e1 || e2 || e3 || e4) {
      console.error('reports rpc errors:', e1, e2, e3, e4);
      return NextResponse.json({ error: 'Failed to load reports' }, { status: 500 });
    }

    if (eClient) {
      console.error('report_client_summary failed:', eClient);
    }

    const { data: bookingRowsForModel, error: eBm } = await staff.db
      .from('bookings')
      .select(
        `party_size, status, deposit_amount_pence, deposit_status, experience_event_id, class_instance_id, resource_id, event_session_id, calendar_id, service_item_id, practitioner_id, appointment_service_id, checked_in_at`,
      )
      .eq('venue_id', staff.venue_id)
      .gte('booking_date', from)
      .lte('booking_date', to);

    if (eBm) {
      console.error('[reports] booking model breakdown query failed:', eBm);
    }
    const report_by_booking_model = buildBookingModelBreakdown((bookingRowsForModel ?? []) as BookingBreakdownInput[]);

    const clientSummaryParsed = clientSummaryRaw as Record<string, unknown> | null;
    const client_summary = {
      identified_clients_total: Number(clientSummaryParsed?.identified_clients_total ?? 0),
      new_clients_in_period: Number(clientSummaryParsed?.new_clients_in_period ?? 0),
      returning_clients_in_period: Number(clientSummaryParsed?.returning_clients_in_period ?? 0),
      anonymous_visits_in_period: Number(clientSummaryParsed?.anonymous_visits_in_period ?? 0),
    };

    const bookingModel = (venueFlags?.booking_model as BookingModel | undefined) ?? 'table_reservation';
    const pricingTier = (venueFlags as { pricing_tier?: string | null } | null)?.pricing_tier;
    const enabledModelsNorm = normalizeEnabledModels(
      (venueFlags as { enabled_models?: unknown } | null)?.enabled_models,
      bookingModel,
    );
    const defaultBookingLogEmail =
      typeof firstAdmin?.email === 'string' && firstAdmin.email.trim() ? firstAdmin.email.trim().toLowerCase() : null;
    const bookingLogEmailConfig = normalizeBookingLogEmailConfig(
      (venueFlags as { daily_booking_log_email_config?: unknown } | null)?.daily_booking_log_email_config,
      defaultBookingLogEmail,
    );
    const appointmentDashboard = isAppointmentDashboardExperience(pricingTier, bookingModel, enabledModelsNorm);

    const summaryObj = Array.isArray(summary) ? summary[0] : summary;
    const cancellationObj = Array.isArray(cancellation) ? cancellation[0] : cancellation;
    const depositObj = Array.isArray(deposit) ? deposit[0] : deposit;
    let tableUtilisation: Array<{ table_id: string; table_name: string; utilisation_pct: number; occupied_hours: number; available_hours: number }> = [];

    if (venueFlags?.table_management_enabled && !isUnifiedSchedulingVenue(bookingModel)) {
      const [{ data: tables }, { data: assignments }] = await Promise.all([
        staff.db.from('venue_tables').select('id, name').eq('venue_id', staff.venue_id).eq('is_active', true),
        staff.db
          .from('booking_table_assignments')
          .select('table_id, booking:bookings!inner(booking_date, booking_time, estimated_end_time, status, venue_id)')
          .eq('booking.venue_id', staff.venue_id)
          .gte('booking.booking_date', from)
          .lte('booking.booking_date', to)
          .in('booking.status', ['Booked', 'Confirmed', 'Seated', 'Completed']),
      ]);

      const days = Math.max(1, Math.ceil((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000) + 1);
      const availableHours = days * 12;
      const occupiedByTable = new Map<string, number>();
      for (const assignment of assignments ?? []) {
        const bookingRaw = assignment.booking as
          | { booking_time?: string | null; estimated_end_time?: string | null }
          | Array<{ booking_time?: string | null; estimated_end_time?: string | null }>
          | null;
        const booking = Array.isArray(bookingRaw) ? bookingRaw[0] : bookingRaw;
        const startRaw = booking?.booking_time?.slice(0, 5) ?? '00:00';
        const start = Number(startRaw.slice(0, 2)) * 60 + Number(startRaw.slice(3, 5));
        const endRaw = booking?.estimated_end_time?.includes('T')
          ? (booking.estimated_end_time.split('T')[1] ?? '').slice(0, 5)
          : booking?.estimated_end_time?.slice(0, 5);
        const end = endRaw ? Number(endRaw.slice(0, 2)) * 60 + Number(endRaw.slice(3, 5)) : start + 90;
        const durationHours = Math.max(0.25, (end - start) / 60);
        occupiedByTable.set(assignment.table_id, (occupiedByTable.get(assignment.table_id) ?? 0) + durationHours);
      }

      tableUtilisation = (tables ?? []).map((table: { id: string; name: string }) => {
        const occupied = occupiedByTable.get(table.id) ?? 0;
        const utilisation = availableHours > 0 ? Math.min(100, Math.round((occupied / availableHours) * 100)) : 0;
        return {
          table_id: table.id,
          table_name: table.name,
          utilisation_pct: utilisation,
          occupied_hours: Number(occupied.toFixed(2)),
          available_hours: availableHours,
        };
      });
    }

    // ── D2 analytics — only computed when the venue actually exposes the model ──
    const exposesEvents = venueExposesBookingModel(bookingModel, enabledModelsNorm, 'event_ticket');
    const exposesResources = venueExposesBookingModel(bookingModel, enabledModelsNorm, 'resource_booking');
    const [report_event_ticket_tiers, report_resource_utilisation] = await Promise.all([
      exposesEvents
        ? buildEventTicketTierBreakdown(staff.db, staff.venue_id, from, to)
        : Promise.resolve([] as EventTicketTierRow[]),
      exposesResources
        ? buildResourceUtilisation(staff.db, staff.venue_id, from, to)
        : Promise.resolve([] as ResourceUtilisationRow[]),
    ]);

    let report7_appointment_insights: Awaited<ReturnType<typeof buildAppointmentInsights>> | null = null;
    let report8_baseline_metrics: VenueBaselineMetrics | null = null;
    let report8_baseline_snapshot: {
      period_start: string;
      period_end: string;
      snapshot_kind: string;
      created_at: string;
      metrics: VenueBaselineMetrics;
    } | null = null;

    if (appointmentDashboard) {
      report7_appointment_insights = await buildAppointmentInsights(staff.db, staff.venue_id, from, to);
      const admin = getSupabaseAdminClient();
      try {
        report8_baseline_metrics = await computeVenueBaselineMetrics(
          admin,
          staff.venue_id,
          from,
          to,
          { appointmentsOnly: true },
        );
        const { data: snapRow, error: snapErr } = await admin
          .from('venue_baseline_metrics_snapshots')
          .select('period_start, period_end, snapshot_kind, created_at, metrics')
          .eq('venue_id', staff.venue_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (snapErr) {
          console.error('[reports] baseline snapshot load failed:', snapErr.message);
        } else if (snapRow) {
          report8_baseline_snapshot = {
            period_start: String(snapRow.period_start),
            period_end: String(snapRow.period_end),
            snapshot_kind: String(snapRow.snapshot_kind),
            created_at: String(snapRow.created_at),
            metrics: snapRow.metrics as VenueBaselineMetrics,
          };
        }
      } catch (baselineErr) {
        console.error('[reports] baseline metrics compute failed:', baselineErr);
      }
    }

    return NextResponse.json({
      from,
      to,
      booking_model: bookingModel,
      pricing_tier: pricingTier ?? null,
      enabled_models: enabledModelsNorm,
      table_management_enabled: venueFlags?.table_management_enabled ?? false,
      report1_booking_summary: summaryObj ?? null,
      report2_no_show_series: noShowSeries ?? [],
      report3_cancellation: cancellationObj ?? null,
      report4_deposit: depositObj ?? null,
      report5_table_utilisation: tableUtilisation,
      report7_appointment_insights: report7_appointment_insights,
      report8_baseline_metrics: report8_baseline_metrics,
      report8_baseline_snapshot: report8_baseline_snapshot,
      report_by_booking_model,
      report_event_ticket_tiers,
      report_resource_utilisation,
      client_summary,
      booking_log_email_config: bookingLogEmailConfig,
      default_booking_log_email: defaultBookingLogEmail,
    });
  } catch (err) {
    console.error('GET /api/venue/reports failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
