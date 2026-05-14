/**
 * Month-level appointment availability for the visual calendar date picker.
 *
 * The calendar endpoint is latency-sensitive: the user is waiting for green
 * date indicators. Fetch month-scoped source data once, then evaluate each day
 * in memory instead of rebuilding the full appointment input 28-31 times.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AppointmentService,
  ClassPaymentRequirement,
  Practitioner,
  PractitionerService,
  ServiceVariant,
} from '@/types/booking-models';
import { applyVariantToService } from '@/lib/appointments/service-variant';
import type { OpeningHours } from '@/types/availability';
import type { AvailabilityBlock } from '@/types/availability';
import {
  attachVenueClockToAppointmentInput,
  computeAppointmentAvailability,
  resolveEngineBookingProcessingBlocks,
  validateAppointmentCustomInterval,
  type AppointmentBooking,
  type AppointmentEngineInput,
  type PractitionerCalendarBlockedRange,
} from '@/lib/availability/appointment-engine';
import { parseProcessingTimeBlocksFromDb } from '@/lib/appointments/processing-time';
import type { ProcessingTimeBlock } from '@/types/booking-models';
import { timeToMinutes } from '@/lib/availability';
import { blocksToVenueOpeningExceptions } from '@/lib/availability/venue-exceptions-adapter';
import { parseVenueOpeningExceptions, type VenueOpeningException } from '@/types/venue-opening-exceptions';
import { unifiedCalendarRowToPractitioner } from '@/lib/availability/unified-calendar-mapper';
import { parseCustomWorkingHoursFromDb } from '@/lib/service-custom-availability';
import {
  attachHostCalendarsToResources,
  mapCalendarToResource,
  mergedResourceEffectiveRangesForHost,
} from '@/lib/availability/resource-booking-engine';
import { mergeAppointmentServiceWithPractitionerLink } from '@/lib/appointments/merge-service-with-overrides';
import { resolveInstructorCalendarIdForClass } from '@/lib/class-instances/instructor-calendar-block';
import {
  DEFAULT_ENTITY_BOOKING_WINDOW,
  type EntityBookingWindow,
  isGuestBookingDateAllowed,
  isStaffWalkInBookingDateAllowed,
  loadServiceEntityBookingWindow,
} from '@/lib/booking/entity-booking-window';

interface VenueClockRow {
  timezone?: string | null;
  booking_rules?: unknown;
  opening_hours?: unknown;
  venue_opening_exceptions?: unknown;
}

const CAPACITY_CONSUMING_STATUSES = ['Booked', 'Confirmed', 'Pending', 'Seated'] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function monthBounds(year: number, month: number): { monthStart: string; monthEnd: string; dates: string[] } {
  const lastDay = new Date(year, month, 0).getDate();
  const dates = Array.from({ length: lastDay }, (_, index) => `${year}-${pad2(month)}-${pad2(index + 1)}`);
  return {
    monthStart: dates[0]!,
    monthEnd: dates[dates.length - 1]!,
    dates,
  };
}

function rowsByDate<T extends Record<string, unknown>>(rows: T[], dateKey: keyof T): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const date = String(row[dateKey] ?? '');
    if (!date) continue;
    const list = map.get(date) ?? [];
    list.push(row);
    map.set(date, list);
  }
  return map;
}

function parseMinuteRange(row: { start_time?: string | null; end_time?: string | null }): { start: number; end: number } | null {
  if (!row.start_time || !row.end_time) return null;
  const start = timeToMinutes(String(row.start_time).slice(0, 5));
  const end = timeToMinutes(String(row.end_time).slice(0, 5));
  return end > start ? { start, end } : null;
}

function applyLeaveForDate(
  practitioner: Practitioner,
  leaveRows: Array<{
    practitioner_id: string;
    start_date: string;
    end_date: string;
    unavailable_start_time?: string | null;
    unavailable_end_time?: string | null;
  }>,
  date: string,
): { practitioner: Practitioner; partialBlocks: PractitionerCalendarBlockedRange[] } {
  let nextPractitioner = practitioner;
  const partialBlocks: PractitionerCalendarBlockedRange[] = [];

  for (const row of leaveRows) {
    if (row.practitioner_id !== practitioner.id) continue;
    if (row.start_date > date || row.end_date < date) continue;

    if (row.unavailable_start_time == null && row.unavailable_end_time == null) {
      const existing = Array.isArray(nextPractitioner.days_off) ? [...nextPractitioner.days_off] : [];
      if (!existing.includes(date)) {
        nextPractitioner = { ...nextPractitioner, days_off: [...existing, date] };
      }
      continue;
    }

    const range = parseMinuteRange({
      start_time: row.unavailable_start_time,
      end_time: row.unavailable_end_time,
    });
    if (range) {
      partialBlocks.push({ practitioner_id: practitioner.id, ...range });
    }
  }

  return { practitioner: nextPractitioner, partialBlocks };
}

function venueOpeningExceptionsForDate(
  date: string,
  venueClockRow: VenueClockRow,
  venueBlockRows: AvailabilityBlock[],
): VenueOpeningException[] | null {
  const matchingBlocks = venueBlockRows.filter((block) => block.date_start <= date && block.date_end >= date);
  if (matchingBlocks.length > 0) return blocksToVenueOpeningExceptions(matchingBlocks);
  return parseVenueOpeningExceptions(venueClockRow.venue_opening_exceptions);
}

function mapServiceItemToAppointmentService(raw: Record<string, unknown>, venueId: string): AppointmentService {
  return {
    id: raw.id as string,
    venue_id: venueId,
    name: raw.name as string,
    description: (raw.description as string | null) ?? null,
    duration_minutes: (raw.duration_minutes as number) ?? 30,
    buffer_minutes: (raw.buffer_minutes as number) ?? 0,
    processing_time_minutes: (raw.processing_time_minutes as number) ?? 0,
    processing_time_blocks: parseProcessingTimeBlocksFromDb(raw.processing_time_blocks),
    price_pence: (raw.price_pence as number | null) ?? null,
    payment_requirement: (raw.payment_requirement as ClassPaymentRequirement | undefined) ?? undefined,
    deposit_pence: (raw.deposit_pence as number | null) ?? null,
    colour: (raw.colour as string) ?? '#3B82F6',
    is_active: raw.is_active !== false,
    sort_order: (raw.sort_order as number) ?? 0,
    created_at: (raw.created_at as string) ?? new Date().toISOString(),
    custom_availability_enabled: Boolean(raw.custom_availability_enabled),
    custom_working_hours: parseCustomWorkingHoursFromDb(raw.custom_working_hours),
  };
}

function bookingRowsToAppointmentBookings(
  rows: Record<string, unknown>[],
  servicesForBookings: Map<string, AppointmentService>,
  practitionerServices: PractitionerService[],
  fallbackPractitionerId: string,
  variantBlocksById: Map<string, ProcessingTimeBlock[]>,
): AppointmentBooking[] {
  return rows.map((b) => {
    const practitionerId = ((b.practitioner_id as string | null) ?? (b.calendar_id as string | null) ?? fallbackPractitionerId);
    const serviceId = ((b.service_item_id as string | null) ?? (b.appointment_service_id as string | null));
    const service = serviceId ? servicesForBookings.get(serviceId) : null;
    const practitionerService = serviceId
      ? practitionerServices.find((row) => row.practitioner_id === practitionerId && row.service_id === serviceId)
      : undefined;
    const merged = service ? mergeAppointmentServiceWithPractitionerLink(service, practitionerService) : null;
    const variantId = b.service_variant_id as string | null | undefined;
    const variantBl = variantId ? variantBlocksById.get(variantId) : undefined;
    const processingBlocks = resolveEngineBookingProcessingBlocks({
      snapshotRaw: b.processing_time_blocks,
      mergedService: merged,
      variantBlocks: variantBl,
    });
    return {
      id: b.id as string,
      practitioner_id: practitionerId,
      booking_time: String(b.booking_time ?? '00:00').slice(0, 5),
      duration_minutes: merged?.duration_minutes ?? 30,
      buffer_minutes: merged?.buffer_minutes ?? 0,
      processing_time_minutes: merged?.processing_time_minutes ?? 0,
      processing_time_blocks: processingBlocks,
      status: b.status as string,
    };
  });
}

async function fetchScheduledSessionBlocksForCalendarMonth(
  supabase: SupabaseClient,
  venueId: string,
  calendarId: string,
  monthStart: string,
  monthEnd: string,
): Promise<Map<string, PractitionerCalendarBlockedRange[]>> {
  const result = new Map<string, PractitionerCalendarBlockedRange[]>();

  const [eventsRes, typeRowsRes] = await Promise.all([
    supabase
      .from('experience_events')
      .select('event_date, start_time, end_time')
      .eq('venue_id', venueId)
      .eq('calendar_id', calendarId)
      .gte('event_date', monthStart)
      .lte('event_date', monthEnd)
      .eq('is_active', true),
    supabase
      .from('class_types')
      .select('id, duration_minutes, instructor_id')
      .eq('venue_id', venueId)
      .eq('is_active', true),
  ]);

  if (!eventsRes.error) {
    for (const raw of eventsRes.data ?? []) {
      const row = raw as { event_date: string; start_time: string; end_time: string };
      const range = parseMinuteRange(row);
      if (!range) continue;
      const list = result.get(row.event_date) ?? [];
      list.push({ practitioner_id: calendarId, ...range });
      result.set(row.event_date, list);
    }
  } else {
    console.warn('[appointment-month-availability] experience_events:', eventsRes.error.message);
  }

  if (typeRowsRes.error || !typeRowsRes.data?.length) {
    if (typeRowsRes.error) console.warn('[appointment-month-availability] class_types:', typeRowsRes.error.message);
    return result;
  }

  const typeDuration = new Map<string, number>();
  const matchingTypeIds = new Set<string>();
  const resolvedByInstructor = new Map<string, string | null>();
  for (const raw of typeRowsRes.data) {
    const row = raw as { id: string; duration_minutes: number | null; instructor_id: string | null };
    typeDuration.set(row.id, row.duration_minutes && row.duration_minutes > 0 ? row.duration_minutes : 60);
    const instructorId = row.instructor_id;
    if (!instructorId) continue;
    if (instructorId === calendarId) {
      matchingTypeIds.add(row.id);
      continue;
    }
    if (!resolvedByInstructor.has(instructorId)) {
      resolvedByInstructor.set(instructorId, await resolveInstructorCalendarIdForClass(supabase, venueId, instructorId));
    }
    if (resolvedByInstructor.get(instructorId) === calendarId) {
      matchingTypeIds.add(row.id);
    }
  }
  if (matchingTypeIds.size === 0) return result;

  const { data: instances, error: instErr } = await supabase
    .from('class_instances')
    .select('instance_date, start_time, class_type_id')
    .gte('instance_date', monthStart)
    .lte('instance_date', monthEnd)
    .eq('is_cancelled', false)
    .in('class_type_id', [...matchingTypeIds]);

  if (instErr) {
    console.warn('[appointment-month-availability] class_instances:', instErr.message);
    return result;
  }

  for (const raw of instances ?? []) {
    const row = raw as { instance_date: string; start_time: string; class_type_id: string };
    const start = timeToMinutes(String(row.start_time).slice(0, 5));
    const end = start + (typeDuration.get(row.class_type_id) ?? 60);
    const list = result.get(row.instance_date) ?? [];
    list.push({ practitioner_id: calendarId, start, end });
    result.set(row.instance_date, list);
  }

  return result;
}

export interface ComputeAppointmentMonthOptions {
  /** Staff audience allows same-day even when service rule says otherwise; defaults to public. */
  audience?: 'public' | 'staff';
  /** Deprecated: month evaluation is now batched and synchronous after the fetch phase. */
  concurrency?: number;
  /** Prefetched venue clock row to avoid an extra `venues` round-trip per call. */
  venueClockRow?: VenueClockRow | null;
  /** Prefetched booking window for the service, if already loaded. */
  bookingWindow?: EntityBookingWindow | null;
  /**
   * When the guest has chosen a variant, swap its duration / buffer / price into the parent
   * service before evaluating slots. The calendar then accurately reflects what fits.
   */
  variantOverride?: ServiceVariant | null;
  /** Staff-only per-booking duration override; filters dates by fitting this custom interval. */
  customDurationMinutes?: number | null;
}

/**
 * Dates in the given month (YYYY-MM-DD) where `practitionerId` has at least one
 * bookable slot for `serviceId` under the service booking window.
 */
export async function computeAppointmentAvailableDatesInMonth(
  supabase: SupabaseClient,
  venueId: string,
  practitionerId: string,
  serviceId: string,
  year: number,
  month: number,
  options: ComputeAppointmentMonthOptions = {},
): Promise<string[]> {
  const audience = options.audience ?? 'public';
  const { monthStart, monthEnd, dates } = monthBounds(year, month);

  const venueClockRow: VenueClockRow =
    options.venueClockRow ??
    ((
      await supabase
        .from('venues')
        .select('timezone, booking_rules, opening_hours, venue_opening_exceptions')
        .eq('id', venueId)
        .maybeSingle()
    ).data as VenueClockRow | null) ??
    {};

  const bookingWindow =
    options.bookingWindow ??
    (await loadServiceEntityBookingWindow(supabase, venueId, '', serviceId)) ??
    DEFAULT_ENTITY_BOOKING_WINDOW;

  const tz =
    typeof venueClockRow.timezone === 'string' && venueClockRow.timezone.trim() !== ''
      ? venueClockRow.timezone.trim()
      : 'Europe/London';

  const allowed = (iso: string): boolean =>
    audience === 'staff'
      ? isStaffWalkInBookingDateAllowed(iso, bookingWindow, tz)
      : isGuestBookingDateAllowed(iso, bookingWindow, tz);

  const { data: unifiedCalendarRow } = await supabase
    .from('unified_calendars')
    .select('*')
    .eq('venue_id', venueId)
    .eq('id', practitionerId)
    .maybeSingle();

  const inputForDate = unifiedCalendarRow
    ? await buildUnifiedCalendarMonthInputFactory({
        supabase,
        venueId,
        calendarRow: unifiedCalendarRow as Record<string, unknown>,
        serviceId,
        monthStart,
        monthEnd,
        venueClockRow,
      })
    : await buildLegacyPractitionerMonthInputFactory({
        supabase,
        venueId,
        practitionerId,
        serviceId,
        monthStart,
        monthEnd,
        venueClockRow,
      });

  const availableDates: string[] = [];
  for (const date of dates) {
    if (!allowed(date)) continue;
    const input = inputForDate(date);
    if (options.variantOverride) {
      input.services = input.services.map((svc) =>
        svc.id === serviceId ? applyVariantToService(svc, options.variantOverride!) : svc,
      );
    }
    attachVenueClockToAppointmentInput(input, venueClockRow, bookingWindow);
    const out = computeAppointmentAvailability(input);
    const practitioner = out.practitioners.find((p) => p.id === practitionerId);
    const hasSlot = practitioner?.slots.some((slot) => {
      if (slot.service_id !== serviceId) return false;
      if (options.customDurationMinutes == null) return true;
      const startMin = timeToMinutes(slot.start_time);
      const endHHmm = `${pad2(Math.floor(((startMin + options.customDurationMinutes) % (24 * 60)) / 60))}:${pad2((startMin + options.customDurationMinutes) % 60)}`;
      return validateAppointmentCustomInterval(
        input,
        practitionerId,
        serviceId,
        slot.start_time,
        endHHmm,
      ).ok;
    });
    if (hasSlot) {
      availableDates.push(date);
    }
  }

  return availableDates;
}

async function buildLegacyPractitionerMonthInputFactory({
  supabase,
  venueId,
  practitionerId,
  serviceId,
  monthStart,
  monthEnd,
  venueClockRow,
}: {
  supabase: SupabaseClient;
  venueId: string;
  practitionerId: string;
  serviceId: string;
  monthStart: string;
  monthEnd: string;
  venueClockRow: VenueClockRow;
}): Promise<(date: string) => AppointmentEngineInput> {
  const practitionerQuery = supabase
    .from('practitioners')
    .select('*')
    .eq('venue_id', venueId)
    .eq('is_active', true)
    .eq('id', practitionerId)
    .order('sort_order');

  const [
    practitionersRes,
    servicesRes,
    practitionerServicesRes,
    bookingsRes,
    blocksRes,
    leaveRes,
    venueBlocksRes,
    scheduledSessionBlocksByDate,
  ] = await Promise.all([
    practitionerQuery,
    supabase
      .from('appointment_services')
      .select('*')
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('practitioner_services')
      .select('*, practitioners!inner(venue_id)')
      .eq('practitioners.venue_id', venueId),
    supabase
      .from('bookings')
      .select(
        'id, practitioner_id, calendar_id, booking_date, booking_time, appointment_service_id, service_item_id, service_variant_id, processing_time_blocks, status',
      )
      .eq('venue_id', venueId)
      .gte('booking_date', monthStart)
      .lte('booking_date', monthEnd)
      .or(`practitioner_id.eq.${practitionerId},calendar_id.eq.${practitionerId}`)
      .in('status', [...CAPACITY_CONSUMING_STATUSES]),
    supabase
      .from('practitioner_calendar_blocks')
      .select('practitioner_id, block_date, start_time, end_time')
      .eq('venue_id', venueId)
      .eq('practitioner_id', practitionerId)
      .gte('block_date', monthStart)
      .lte('block_date', monthEnd),
    supabase
      .from('practitioner_leave_periods')
      .select('practitioner_id, start_date, end_date, unavailable_start_time, unavailable_end_time')
      .eq('venue_id', venueId)
      .eq('practitioner_id', practitionerId)
      .lte('start_date', monthEnd)
      .gte('end_date', monthStart),
    supabase
      .from('availability_blocks')
      .select('id, venue_id, service_id, block_type, date_start, date_end, time_start, time_end, override_max_covers, reason, yield_overrides, override_periods')
      .eq('venue_id', venueId)
      .is('service_id', null)
      .in('block_type', ['closed', 'amended_hours', 'special_event'])
      .lte('date_start', monthEnd)
      .gte('date_end', monthStart),
    fetchScheduledSessionBlocksForCalendarMonth(supabase, venueId, practitionerId, monthStart, monthEnd),
  ]);

  const practitioners = (practitionersRes.data ?? []) as Practitioner[];
  const basePractitioner = practitioners[0];
  let allServices = ((servicesRes.data ?? []) as Record<string, unknown>[]).map((row) =>
    mapServiceItemToAppointmentService(row, venueId),
  );
  if (allServices.length > 0) {
    const { data: processingRows } = await supabase
      .from('service_items')
      .select('id, processing_time_minutes, processing_time_blocks')
      .eq('venue_id', venueId)
      .in(
        'id',
        allServices.map((service) => service.id),
      );
    const processingByServiceId = new Map(
      (processingRows ?? []).map((row) => {
        const r = row as { id: string; processing_time_minutes?: number; processing_time_blocks?: unknown };
        return [
          r.id,
          {
            processing_time_minutes: r.processing_time_minutes ?? 0,
            processing_time_blocks: parseProcessingTimeBlocksFromDb(r.processing_time_blocks),
          },
        ] as const;
      }),
    );
    allServices = allServices.map((service) => {
      const meta = processingByServiceId.get(service.id);
      if (!meta) return service;
      return {
        ...service,
        processing_time_minutes: meta.processing_time_minutes,
        processing_time_blocks: meta.processing_time_blocks,
      };
    });
  }
  const services = allServices.filter((service) => service.id === serviceId);
  const practitionerServices = (practitionerServicesRes.data ?? []) as PractitionerService[];
  const servicesForBookings = new Map(allServices.map((service) => [service.id, service]));
  const monthVariantIdsLegacy = [
    ...new Set(
      (bookingsRes.data ?? [])
        .map((row) => (row as { service_variant_id?: string | null }).service_variant_id)
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  let monthVariantBlocksLegacy = new Map<string, ProcessingTimeBlock[]>();
  if (monthVariantIdsLegacy.length > 0) {
    const { data: vrows } = await supabase
      .from('service_variants')
      .select('id, processing_time_blocks')
      .in('id', monthVariantIdsLegacy);
    monthVariantBlocksLegacy = new Map(
      (vrows ?? []).map((r) => {
        const row = r as { id: string; processing_time_blocks?: unknown };
        return [row.id, parseProcessingTimeBlocksFromDb(row.processing_time_blocks)];
      }),
    );
  }
  const bookingsByDate = rowsByDate((bookingsRes.data ?? []) as Record<string, unknown>[], 'booking_date');
  const blocksByDate = rowsByDate((blocksRes.data ?? []) as Record<string, unknown>[], 'block_date');
  const leaveRows = (leaveRes.data ?? []) as Array<{
    practitioner_id: string;
    start_date: string;
    end_date: string;
    unavailable_start_time?: string | null;
    unavailable_end_time?: string | null;
  }>;
  const venueBlocks = (venueBlocksRes.data ?? []) as AvailabilityBlock[];

  return (date: string): AppointmentEngineInput => {
    if (!basePractitioner) {
      return emptyAppointmentInput(date);
    }

    const leave = applyLeaveForDate(basePractitioner, leaveRows, date);
    const blockRanges = (blocksByDate.get(date) ?? [])
      .map((row) => parseMinuteRange(row as { start_time?: string | null; end_time?: string | null }))
      .filter((range): range is { start: number; end: number } => Boolean(range))
      .map((range) => ({ practitioner_id: practitionerId, ...range }));
    const existingBookings = bookingRowsToAppointmentBookings(
      bookingsByDate.get(date) ?? [],
      servicesForBookings,
      practitionerServices,
      practitionerId,
      monthVariantBlocksLegacy,
    );

    return {
      date,
      practitioners: [leave.practitioner],
      services,
      practitionerServices,
      existingBookings,
      practitionerBlockedRanges: [
        ...blockRanges,
        ...(scheduledSessionBlocksByDate.get(date) ?? []),
        ...leave.partialBlocks,
      ],
      venueOpeningHours: (venueClockRow.opening_hours as OpeningHours | null) ?? null,
      venueOpeningExceptions: venueOpeningExceptionsForDate(date, venueClockRow, venueBlocks),
    };
  };
}

async function buildUnifiedCalendarMonthInputFactory({
  supabase,
  venueId,
  calendarRow,
  serviceId,
  monthStart,
  monthEnd,
  venueClockRow,
}: {
  supabase: SupabaseClient;
  venueId: string;
  calendarRow: Record<string, unknown>;
  serviceId: string;
  monthStart: string;
  monthEnd: string;
  venueClockRow: VenueClockRow;
}): Promise<(date: string) => AppointmentEngineInput> {
  const calendarId = calendarRow.id as string;
  const practitioner = unifiedCalendarRowToPractitioner(calendarRow);

  const { data: assignments } = await supabase
    .from('calendar_service_assignments')
    .select('id, service_item_id, custom_duration_minutes, custom_price_pence')
    .eq('calendar_id', calendarId);
  const assignmentRows = (assignments ?? []) as Array<{
    id: string;
    service_item_id: string;
    custom_duration_minutes: number | null;
    custom_price_pence: number | null;
  }>;
  const serviceIds = assignmentRows.map((row) => row.service_item_id);

  const servicesRes = serviceIds.length > 0
    ? await supabase
        .from('service_items')
        .select('*')
        .eq('venue_id', venueId)
        .eq('is_active', true)
        .in('id', serviceIds)
    : { data: [], error: null };

  const assignmentByServiceId = new Map(assignmentRows.map((row) => [row.service_item_id, row]));
  const allServices = ((servicesRes.data ?? []) as Record<string, unknown>[]).map((row) => {
    const service = mapServiceItemToAppointmentService(row, venueId);
    const assignment = assignmentByServiceId.get(service.id);
    return {
      ...service,
      duration_minutes: assignment?.custom_duration_minutes ?? service.duration_minutes,
      price_pence: assignment?.custom_price_pence ?? service.price_pence,
    };
  });
  const services = allServices.filter((service) => service.id === serviceId);
  const practitionerServices: PractitionerService[] = assignmentRows.map((row) => ({
    id: row.id,
    practitioner_id: calendarId,
    service_id: row.service_item_id,
    custom_duration_minutes: row.custom_duration_minutes,
    custom_price_pence: row.custom_price_pence,
  }));
  const servicesForBookings = new Map(allServices.map((service) => [service.id, service]));

  const [
    bookingsRes,
    legacyBlocksRes,
    calendarBlocksRes,
    leaveRes,
    siblingResourcesRes,
    venueBlocksRes,
    scheduledSessionBlocksByDate,
  ] = await Promise.all([
    supabase
      .from('bookings')
      .select(
        'id, practitioner_id, calendar_id, booking_date, booking_time, appointment_service_id, service_item_id, service_variant_id, processing_time_blocks, status',
      )
      .eq('venue_id', venueId)
      .gte('booking_date', monthStart)
      .lte('booking_date', monthEnd)
      .or(`practitioner_id.eq.${calendarId},calendar_id.eq.${calendarId}`)
      .in('status', [...CAPACITY_CONSUMING_STATUSES]),
    supabase
      .from('practitioner_calendar_blocks')
      .select('practitioner_id, block_date, start_time, end_time')
      .eq('venue_id', venueId)
      .eq('practitioner_id', calendarId)
      .gte('block_date', monthStart)
      .lte('block_date', monthEnd),
    supabase
      .from('calendar_blocks')
      .select('block_date, start_time, end_time')
      .eq('venue_id', venueId)
      .eq('calendar_id', calendarId)
      .gte('block_date', monthStart)
      .lte('block_date', monthEnd),
    supabase
      .from('practitioner_leave_periods')
      .select('practitioner_id, start_date, end_date, unavailable_start_time, unavailable_end_time')
      .eq('venue_id', venueId)
      .eq('practitioner_id', calendarId)
      .lte('start_date', monthEnd)
      .gte('end_date', monthStart),
    supabase
      .from('unified_calendars')
      .select('*')
      .eq('venue_id', venueId)
      .eq('calendar_type', 'resource')
      .eq('display_on_calendar_id', calendarId)
      .eq('is_active', true),
    supabase
      .from('availability_blocks')
      .select('id, venue_id, service_id, block_type, date_start, date_end, time_start, time_end, override_max_covers, reason, yield_overrides, override_periods')
      .eq('venue_id', venueId)
      .is('service_id', null)
      .in('block_type', ['closed', 'amended_hours', 'special_event'])
      .lte('date_start', monthEnd)
      .gte('date_end', monthStart),
    fetchScheduledSessionBlocksForCalendarMonth(supabase, venueId, calendarId, monthStart, monthEnd),
  ]);

  const monthVariantIdsCal = [
    ...new Set(
      (bookingsRes.data ?? [])
        .map((row) => (row as { service_variant_id?: string | null }).service_variant_id)
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  let monthVariantBlocksCal = new Map<string, ProcessingTimeBlock[]>();
  if (monthVariantIdsCal.length > 0) {
    const { data: vrowsCal } = await supabase
      .from('service_variants')
      .select('id, processing_time_blocks')
      .in('id', monthVariantIdsCal);
    monthVariantBlocksCal = new Map(
      (vrowsCal ?? []).map((r) => {
        const row = r as { id: string; processing_time_blocks?: unknown };
        return [row.id, parseProcessingTimeBlocksFromDb(row.processing_time_blocks)];
      }),
    );
  }

  const bookingsByDate = rowsByDate((bookingsRes.data ?? []) as Record<string, unknown>[], 'booking_date');
  const legacyBlocksByDate = rowsByDate((legacyBlocksRes.data ?? []) as Record<string, unknown>[], 'block_date');
  const calendarBlocksByDate = rowsByDate((calendarBlocksRes.data ?? []) as Record<string, unknown>[], 'block_date');
  const leaveRows = (leaveRes.data ?? []) as Array<{
    practitioner_id: string;
    start_date: string;
    end_date: string;
    unavailable_start_time?: string | null;
    unavailable_end_time?: string | null;
  }>;
  const venueBlocks = (venueBlocksRes.data ?? []) as AvailabilityBlock[];

  let siblingResources = ((siblingResourcesRes.data ?? []) as Record<string, unknown>[]).map(mapCalendarToResource);
  if (siblingResources.length > 0) {
    siblingResources = await attachHostCalendarsToResources(supabase, venueId, siblingResources);
  }

  return (date: string): AppointmentEngineInput => {
    const leave = applyLeaveForDate(practitioner, leaveRows, date);
    const legacyBlocks = (legacyBlocksByDate.get(date) ?? [])
      .map((row) => parseMinuteRange(row as { start_time?: string | null; end_time?: string | null }))
      .filter((range): range is { start: number; end: number } => Boolean(range))
      .map((range) => ({ practitioner_id: calendarId, ...range }));
    const calendarBlocks = (calendarBlocksByDate.get(date) ?? [])
      .map((row) => parseMinuteRange(row as { start_time?: string | null; end_time?: string | null }))
      .filter((range): range is { start: number; end: number } => Boolean(range))
      .map((range) => ({ practitioner_id: calendarId, ...range }));
    const resourceHostBlocks = mergedResourceEffectiveRangesForHost(siblingResources, date).map((range) => ({
      practitioner_id: calendarId,
      start: range.start,
      end: range.end,
    }));

    return {
      date,
      practitioners: [leave.practitioner],
      services,
      practitionerServices,
      existingBookings: bookingRowsToAppointmentBookings(
        bookingsByDate.get(date) ?? [],
        servicesForBookings,
        practitionerServices,
        calendarId,
        monthVariantBlocksCal,
      ),
      practitionerBlockedRanges: [
        ...legacyBlocks,
        ...calendarBlocks,
        ...resourceHostBlocks,
        ...(scheduledSessionBlocksByDate.get(date) ?? []),
        ...leave.partialBlocks,
      ],
      venueOpeningHours: (venueClockRow.opening_hours as OpeningHours | null) ?? null,
      venueOpeningExceptions: venueOpeningExceptionsForDate(date, venueClockRow, venueBlocks),
    };
  };
}

function emptyAppointmentInput(date: string): AppointmentEngineInput {
  return {
    date,
    practitioners: [],
    services: [],
    practitionerServices: [],
    existingBookings: [],
    practitionerBlockedRanges: [],
    venueOpeningHours: null,
    venueOpeningExceptions: null,
  };
}
