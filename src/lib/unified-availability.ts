/**
 * Unified Scheduling Engine - availability for unified_calendars + service_items.
 * Practitioner calendars reuse the same UUIDs as legacy practitioners after migration;
 * this module merges calendar_blocks and delegates practitioner slots to appointment-engine.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  attachVenueClockToAppointmentInput,
  computeAppointmentAvailability,
  fetchAppointmentInput,
  fetchCalendarAppointmentInput,
  type AppointmentEngineInput,
  type PractitionerCalendarBlockedRange,
} from '@/lib/availability/appointment-engine';
import { timeToMinutes } from '@/lib/availability';
import { getDayOfWeek } from '@/lib/availability/engine';
import type { EntityBookingWindow } from '@/lib/booking/entity-booking-window';
import { entityBookingWindowFromRow, isGuestBookingDateAllowed } from '@/lib/booking/entity-booking-window';
import type { AvailabilityBlock } from '@/types/availability';
import { formatGuestDisplayName } from '@/lib/guests/name';

export interface UnifiedAvailableSlot {
  time: string;
  endTime: string;
  available: boolean;
  remainingCapacity?: number;
  eventSessionId?: string;
  durationMinutes?: number;
}

export interface CalendarGridBooking {
  id: string;
  guestName: string;
  serviceName: string;
  startTime: string;
  endTime: string;
  status: string;
  colour?: string | null;
  /** Arrived/attendance overlay — lets calendar bars colour an arrived-waiting guest (amber). */
  client_arrived_at?: string | null;
  staff_attendance_confirmed_at?: string | null;
  guest_attendance_confirmed_at?: string | null;
}

export interface CalendarGridDay {
  date: string;
  workingHours: Array<{ start: string; end: string }>;
  bookings: CalendarGridBooking[];
  blocks: Array<{ id: string; startTime: string; endTime: string; reason: string | null; type: string }>;
  sessions: Array<{
    id: string;
    startTime: string;
    endTime: string;
    capacity: number;
    bookedCount: number;
  }>;
}

export interface CalendarGridData {
  calendars: Array<{
    calendarId: string;
    calendarName: string;
    dates: CalendarGridDay[];
  }>;
}

const ACTIVE_BOOKING_STATUSES = ['Pending', 'Booked', 'Confirmed', 'Seated'];

async function fetchCalendarBlocksMerged(
  supabase: SupabaseClient,
  venueId: string,
  calendarId: string,
  date: string,
): Promise<PractitionerCalendarBlockedRange[]> {
  const { data, error } = await supabase
    .from('calendar_blocks')
    .select('start_time, end_time')
    .eq('venue_id', venueId)
    .eq('calendar_id', calendarId)
    .eq('block_date', date);

  if (error) {
    console.warn('[unified-availability] calendar_blocks:', error.message);
    return [];
  }

  return (data ?? [])
    .map((row: { start_time: string; end_time: string }) => ({
      practitioner_id: calendarId,
      start: timeToMinutes(String(row.start_time).slice(0, 5)),
      end: timeToMinutes(String(row.end_time).slice(0, 5)),
    }))
    .filter((b) => b.end > b.start);
}

/** §3.5: valid booking lengths for resource calendars (min/max + slot step). */
function resourceDurationCandidates(
  minM: number | null | undefined,
  maxM: number | null | undefined,
  slotStep: number | null | undefined,
): number[] | null {
  if (minM == null || maxM == null || maxM < minM) return null;
  const step = Math.max(5, slotStep ?? 15);
  const out: number[] = [];
  for (let d = minM; d <= maxM; d += step) {
    out.push(d);
  }
  return out.length > 0 ? out : null;
}

async function slotsFromEngineInput(params: {
  input: AppointmentEngineInput;
  calendarId: string;
  serviceItemId: string;
  venueRow: {
    timezone?: string | null;
    booking_rules?: unknown;
    opening_hours?: unknown;
    venue_opening_exceptions?: unknown;
  } | null;
  bookingWindow: EntityBookingWindow;
  extraBlocks: PractitionerCalendarBlockedRange[];
  venueBlocks?: AvailabilityBlock[] | null;
}): Promise<UnifiedAvailableSlot[]> {
  const { input, calendarId, serviceItemId, venueRow, bookingWindow, extraBlocks, venueBlocks } = params;
  const merged: AppointmentEngineInput = {
    ...input,
    practitionerBlockedRanges: [...(input.practitionerBlockedRanges ?? []), ...extraBlocks],
  };
  if (venueRow) {
    attachVenueClockToAppointmentInput(merged, venueRow, bookingWindow, venueBlocks ?? null);
  }
  const result = computeAppointmentAvailability(merged);
  const practitioner = result.practitioners.find((p) => p.id === calendarId);
  if (!practitioner) return [];
  return practitioner.slots
    .filter((s) => s.service_id === serviceItemId)
    .map((s) => ({
      time: s.start_time,
      endTime: addMinutesToHHmm(s.start_time, s.duration_minutes),
      available: true,
      durationMinutes: s.duration_minutes,
    }));
}

/**
 * Available slots for one calendar + service on a date.
 * Resource calendars with min/max booking minutes return a union grid (§3.5); optional `durationMinutesOverride` fixes one length.
 * Event/class calendars return materialised session rows.
 */
export async function getUnifiedAvailableSlots(params: {
  supabase: SupabaseClient;
  venueId: string;
  calendarId: string;
  date: string; // YYYY-MM-DD
  serviceItemId: string;
  durationMinutesOverride?: number;
}): Promise<UnifiedAvailableSlot[]> {
  const { supabase, venueId, calendarId, date, serviceItemId, durationMinutesOverride } = params;

  const { data: calRow, error: calErr } = await supabase
    .from('unified_calendars')
    .select('*')
    .eq('id', calendarId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (calErr || !calRow) {
    console.warn('[getUnifiedAvailableSlots] calendar not found:', calErr?.message);
    return [];
  }

  const cal = calRow as {
    calendar_type?: string;
    min_booking_minutes?: number | null;
    max_booking_minutes?: number | null;
    slot_interval_minutes?: number | null;
    min_booking_notice_hours?: number;
    max_advance_booking_days?: number;
    cancellation_notice_hours?: number;
    allow_same_day_booking?: boolean;
  };
  const calendarType = cal.calendar_type ?? 'practitioner';

  if (calendarType === 'event' || calendarType === 'class') {
    return await getEventClassSlots(supabase, venueId, calendarId, date, serviceItemId);
  }

  const [{ data: venue }, extraBlocks, serviceItemRes, venueBlocksRes] = await Promise.all([
    supabase.from('venues').select('timezone, booking_rules, opening_hours, venue_opening_exceptions').eq('id', venueId).maybeSingle(),
    fetchCalendarBlocksMerged(supabase, venueId, calendarId, date),
    calendarType === 'resource'
      ? Promise.resolve({ data: null })
      : supabase
          .from('service_items')
          .select('max_advance_booking_days, min_booking_notice_hours, cancellation_notice_hours, allow_same_day_booking')
          .eq('id', serviceItemId)
          .eq('venue_id', venueId)
          .maybeSingle(),
    supabase
      .from('availability_blocks')
      .select('id, venue_id, service_id, block_type, date_start, date_end, time_start, time_end, override_max_covers, reason, yield_overrides, override_periods')
      .eq('venue_id', venueId)
      .is('service_id', null)
      .in('block_type', ['closed', 'amended_hours'])
      .lte('date_start', date)
      .gte('date_end', date),
  ]);

  const venueRow = venue as {
    timezone?: string | null;
    booking_rules?: unknown;
    opening_hours?: unknown;
    venue_opening_exceptions?: unknown;
  } | null;
  const venueBlocks = (venueBlocksRes.data ?? []) as AvailabilityBlock[];
  const tz =
    typeof venueRow?.timezone === 'string' && venueRow.timezone.trim() !== ''
      ? venueRow.timezone.trim()
      : 'Europe/London';

  const bookingWindow: EntityBookingWindow =
    calendarType === 'resource'
      ? entityBookingWindowFromRow(calRow as Record<string, unknown>)
      : entityBookingWindowFromRow((serviceItemRes.data ?? {}) as Record<string, unknown>);

  if (!isGuestBookingDateAllowed(date, bookingWindow, tz)) {
    return [];
  }

  if (calendarType === 'resource') {
    const baseInput = await fetchCalendarAppointmentInput({
      supabase,
      venueId,
      date,
      calendarId,
      serviceId: serviceItemId,
    });

    const durationGrid =
      durationMinutesOverride != null
        ? [durationMinutesOverride]
        : resourceDurationCandidates(cal.min_booking_minutes, cal.max_booking_minutes, cal.slot_interval_minutes);

    if (durationGrid) {
      const mergedByKey = new Map<string, UnifiedAvailableSlot>();
      for (const d of durationGrid) {
        const input: AppointmentEngineInput = {
          ...baseInput,
          practitionerServices: baseInput.practitionerServices.map((ps) =>
            ps.service_id === serviceItemId ? { ...ps, custom_duration_minutes: d } : ps,
          ),
        };
        const slots = await slotsFromEngineInput({
          input,
          calendarId,
          serviceItemId,
          venueRow,
          bookingWindow,
          extraBlocks,
          venueBlocks,
        });
        for (const s of slots) {
          mergedByKey.set(`${s.time}|${s.durationMinutes ?? d}`, s);
        }
      }
      return [...mergedByKey.values()].sort(
        (a, b) => a.time.localeCompare(b.time) || (a.durationMinutes ?? 0) - (b.durationMinutes ?? 0),
      );
    }

    return slotsFromEngineInput({
      input: baseInput,
      calendarId,
      serviceItemId,
      venueRow,
      bookingWindow,
      extraBlocks,
      venueBlocks,
    });
  }

  const input = await fetchAppointmentInput({
    supabase,
    venueId,
    date,
    practitionerId: calendarId,
    serviceId: serviceItemId,
  });

  return slotsFromEngineInput({
    input,
    calendarId,
    serviceItemId,
    venueRow,
    bookingWindow,
    extraBlocks,
    venueBlocks,
  });
}

async function getEventClassSlots(
  supabase: SupabaseClient,
  venueId: string,
  calendarId: string,
  date: string,
  serviceItemId: string,
): Promise<UnifiedAvailableSlot[]> {
  const { data: sessions, error } = await supabase
    .from('event_sessions')
    .select('id, start_time, end_time, capacity_override, is_cancelled, service_item_id')
    .eq('venue_id', venueId)
    .eq('calendar_id', calendarId)
    .eq('session_date', date)
    .eq('is_cancelled', false);

  if (error || !sessions?.length) return [];

  const { data: cal } = await supabase.from('unified_calendars').select('capacity').eq('id', calendarId).single();
  const defaultCap = (cal as { capacity?: number } | null)?.capacity ?? 1;

  const { data: bookings } = await supabase
    .from('bookings')
    .select('event_session_id, capacity_used, status')
    .eq('venue_id', venueId)
    .eq('booking_date', date)
    .in('status', ACTIVE_BOOKING_STATUSES);

  const used = new Map<string, number>();
  for (const b of bookings ?? []) {
    const sid = (b as { event_session_id?: string }).event_session_id;
    if (!sid) continue;
    const u = (b as { capacity_used?: number }).capacity_used ?? 1;
    used.set(sid, (used.get(sid) ?? 0) + u);
  }

  const out: UnifiedAvailableSlot[] = [];
  for (const row of sessions) {
    const r = row as {
      id: string;
      start_time: string;
      end_time: string;
      capacity_override: number | null;
      service_item_id: string | null;
    };
    if (r.service_item_id && r.service_item_id !== serviceItemId) continue;
    const cap = r.capacity_override ?? defaultCap;
    const booked = used.get(r.id) ?? 0;
    const remaining = Math.max(0, cap - booked);
    const start = String(r.start_time).slice(0, 5);
    const end = String(r.end_time).slice(0, 5);
    out.push({
      time: start,
      endTime: end,
      available: remaining > 0,
      remainingCapacity: remaining,
      eventSessionId: r.id,
    });
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

function addMinutesToHHmm(hhmm: string, minutes: number): string {
  const m = timeToMinutes(hhmm.slice(0, 5)) + minutes;
  const h = Math.floor(m / 60) % 24;
  const mi = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

/** Dashboard: bookings + blocks + event sessions for calendars in a date range. */
export async function getCalendarGrid(params: {
  supabase: SupabaseClient;
  venueId: string;
  calendarIds: string[];
  startDate: string;
  endDate: string;
}): Promise<CalendarGridData> {
  const { supabase, venueId, calendarIds, startDate, endDate } = params;
  if (calendarIds.length === 0) return { calendars: [] };

  const { data: cals } = await supabase
    .from('unified_calendars')
    .select('id, name, working_hours')
    .eq('venue_id', venueId)
    .in('id', calendarIds);

  const [{ data: bookingRows }, { data: blockRows }, { data: sessionRows }] = await Promise.all([
    supabase
      .from('bookings')
      .select(
        'id, calendar_id, booking_date, booking_time, booking_end_time, status, guest_id, appointment_service_id, service_item_id, client_arrived_at, staff_attendance_confirmed_at, guest_attendance_confirmed_at',
      )
      .eq('venue_id', venueId)
      .in('calendar_id', calendarIds)
      .gte('booking_date', startDate)
      .lte('booking_date', endDate)
      .in('status', ACTIVE_BOOKING_STATUSES),
    supabase
      .from('calendar_blocks')
      .select('id, calendar_id, block_date, start_time, end_time, reason, block_type')
      .eq('venue_id', venueId)
      .in('calendar_id', calendarIds)
      .gte('block_date', startDate)
      .lte('block_date', endDate),
    supabase
      .from('event_sessions')
      .select('id, calendar_id, session_date, start_time, end_time, capacity_override')
      .eq('venue_id', venueId)
      .in('calendar_id', calendarIds)
      .gte('session_date', startDate)
      .lte('session_date', endDate)
      .eq('is_cancelled', false),
  ]);

  const guestIdList = [
    ...new Set(
      (bookingRows ?? [])
        .map((b) => (b as { guest_id?: string | null }).guest_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const { data: guestRows } =
    guestIdList.length > 0
      ? await supabase.from('guests').select('id, first_name, last_name').in('id', guestIdList)
      : { data: [] as { id: string; first_name: string | null; last_name: string | null }[] };

  const guestName = new Map(
    (guestRows ?? []).map((g) => [g.id, formatGuestDisplayName(g.first_name, g.last_name)] as const),
  );

  const serviceIds = new Set<string>();
  for (const b of bookingRows ?? []) {
    const sid = (b as { service_item_id?: string; appointment_service_id?: string }).service_item_id
      ?? (b as { appointment_service_id?: string }).appointment_service_id;
    if (sid) serviceIds.add(sid);
  }
  const serviceNames = new Map<string, string>();
  if (serviceIds.size > 0) {
    const { data: svcAppointment } = await supabase
      .from('appointment_services')
      .select('id, name')
      .eq('venue_id', venueId)
      .in('id', [...serviceIds]);
    const { data: svcItems } = await supabase
      .from('service_items')
      .select('id, name')
      .eq('venue_id', venueId)
      .in('id', [...serviceIds]);
    for (const s of [...(svcAppointment ?? []), ...(svcItems ?? [])]) {
      const row = s as { id: string; name: string };
      serviceNames.set(row.id, row.name);
    }
  }

  const bookingsByCalDate = new Map<string, CalendarGridBooking[]>();
  for (const b of bookingRows ?? []) {
    const row = b as {
      id: string;
      calendar_id: string;
      booking_date: string;
      booking_time: string;
      booking_end_time: string | null;
      status: string;
      guest_id: string;
      service_item_id?: string | null;
      appointment_service_id?: string | null;
      client_arrived_at?: string | null;
      staff_attendance_confirmed_at?: string | null;
      guest_attendance_confirmed_at?: string | null;
    };
    const key = `${row.calendar_id}|${row.booking_date}`;
    const sid = row.service_item_id ?? row.appointment_service_id;
    const list = bookingsByCalDate.get(key) ?? [];
    const end = row.booking_end_time ? String(row.booking_end_time).slice(0, 5) : '';
    list.push({
      id: row.id,
      guestName: guestName.get(row.guest_id) ?? 'Guest',
      serviceName: (sid && serviceNames.get(sid)) ?? 'Service',
      startTime: String(row.booking_time).slice(0, 5),
      endTime: end,
      status: row.status,
      client_arrived_at: row.client_arrived_at ?? null,
      staff_attendance_confirmed_at: row.staff_attendance_confirmed_at ?? null,
      guest_attendance_confirmed_at: row.guest_attendance_confirmed_at ?? null,
    });
    bookingsByCalDate.set(key, list);
  }

  const blocksByCalDate = new Map<string, CalendarGridDay['blocks']>();
  for (const bl of blockRows ?? []) {
    const row = bl as {
      id: string;
      calendar_id: string;
      block_date: string;
      start_time: string;
      end_time: string;
      reason: string | null;
      block_type: string;
    };
    const key = `${row.calendar_id}|${row.block_date}`;
    const list = blocksByCalDate.get(key) ?? [];
    list.push({
      id: row.id,
      startTime: String(row.start_time).slice(0, 5),
      endTime: String(row.end_time).slice(0, 5),
      reason: row.reason,
      type: row.block_type,
    });
    blocksByCalDate.set(key, list);
  }

  const sessionsByCalDate = new Map<string, CalendarGridDay['sessions']>();
  const sessionIds = (sessionRows ?? []).map((s: { id: string }) => s.id);
  const sessionBooked = new Map<string, number>();
  if (sessionIds.length > 0) {
    const { data: eb } = await supabase
      .from('bookings')
      .select('event_session_id, capacity_used')
      .eq('venue_id', venueId)
      .in('event_session_id', sessionIds)
      .in('status', ACTIVE_BOOKING_STATUSES);
    for (const r of eb ?? []) {
      const eid = (r as { event_session_id?: string }).event_session_id;
      if (!eid) continue;
      const u = (r as { capacity_used?: number }).capacity_used ?? 1;
      sessionBooked.set(eid, (sessionBooked.get(eid) ?? 0) + u);
    }
  }

  for (const s of sessionRows ?? []) {
    const row = s as {
      id: string;
      calendar_id: string;
      session_date: string;
      start_time: string;
      end_time: string;
      capacity_override: number | null;
    };
    const cal = (cals ?? []).find((c: { id: string }) => c.id === row.calendar_id) as { capacity?: number } | undefined;
    const cap = row.capacity_override ?? cal?.capacity ?? 0;
    const key = `${row.calendar_id}|${row.session_date}`;
    const list = sessionsByCalDate.get(key) ?? [];
    list.push({
      id: row.id,
      startTime: String(row.start_time).slice(0, 5),
      endTime: String(row.end_time).slice(0, 5),
      capacity: cap,
      bookedCount: sessionBooked.get(row.id) ?? 0,
    });
    sessionsByCalDate.set(key, list);
  }

  function enumerateDates(start: string, end: string): string[] {
    const out: string[] = [];
    const a = new Date(start + 'T12:00:00Z');
    const b = new Date(end + 'T12:00:00Z');
    for (let d = a; d <= b; d.setUTCDate(d.getUTCDate() + 1)) {
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }

  const dates = enumerateDates(startDate, endDate);
  const calendars: CalendarGridData['calendars'] = [];

  for (const cal of cals ?? []) {
    const calRecord = cal as { id: string; name: string; working_hours: unknown };
    const days: CalendarGridDay[] = [];
    for (const d of dates) {
      const wh = (calRecord.working_hours ?? {}) as Record<string, Array<{ start: string; end: string }>>;
      const dow = getDayOfWeek(d);
      const dayNum = String(dow);
      const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
      const dayName = dayNames[dow] ?? 'sun';
      const periods = wh[dayNum] ?? wh[dayName] ?? [];
      const key = `${calRecord.id}|${d}`;
      days.push({
        date: d,
        workingHours: periods,
        bookings: bookingsByCalDate.get(key) ?? [],
        blocks: blocksByCalDate.get(key) ?? [],
        sessions: sessionsByCalDate.get(key) ?? [],
      });
    }
    calendars.push({ calendarId: calRecord.id, calendarName: calRecord.name, dates: days });
  }

  return { calendars };
}
