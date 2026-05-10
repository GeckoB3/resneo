/**
 * Model B: Practitioner appointment availability engine.
 * Pure functions - given practitioners, services, and existing bookings,
 * returns available appointment start times per practitioner.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ClassPaymentRequirement,
  Practitioner,
  AppointmentService,
  PractitionerService,
  ProcessingTimeBlock,
} from '@/types/booking-models';
import {
  busyIntervalsOverlap,
  effectiveProcessingBlocksForTemplate,
  parseProcessingTimeBlocksFromDb,
  practitionerBusyMinuteOffsets,
  validateProcessingTimeBlocks,
} from '@/lib/appointments/processing-time';
import { mergeAppointmentServiceWithPractitionerLink } from '@/lib/appointments/merge-service-with-overrides';
import type { OpeningHours } from '@/types/availability';
import { getOpeningPeriodsForDay, timeToMinutes, minutesToTime } from '@/lib/availability';
import { getDayOfWeek } from '@/lib/availability/engine';
import { getVenueLocalDateAndMinutes } from '@/lib/venue/venue-local-clock';
import { unifiedCalendarRowToPractitioner } from '@/lib/availability/unified-calendar-mapper';
import {
  mapCalendarToResource,
  attachHostCalendarsToResources,
  mergedResourceEffectiveRangesForHost,
} from '@/lib/availability/resource-booking-engine';
import type { EntityBookingWindow } from '@/lib/booking/entity-booking-window';
import { DEFAULT_ENTITY_BOOKING_WINDOW } from '@/lib/booking/entity-booking-window';
import type { VenueOpeningException } from '@/types/venue-opening-exceptions';
import { parseVenueOpeningExceptions } from '@/types/venue-opening-exceptions';
import type { AvailabilityBlock } from '@/types/availability';
import { blocksToVenueOpeningExceptions } from '@/lib/availability/venue-exceptions-adapter';
import { intersectEffectiveRangesWithServiceCustom, parseCustomWorkingHoursFromDb } from '@/lib/service-custom-availability';
import { fetchScheduledSessionBlocksForCalendar } from '@/lib/availability/calendar-session-blocks';

// Types

export interface PhantomBooking {
  practitioner_id: string;
  start_time: string;         // "HH:mm"
  duration_minutes: number;
  buffer_minutes: number;
  processing_time_minutes?: number;
  processing_time_blocks?: ProcessingTimeBlock[];
}

/** Staff blocks on the practitioner calendar (breaks / blocked time). Minutes from midnight. */
export interface PractitionerCalendarBlockedRange {
  practitioner_id: string;
  start: number;
  end: number;
}

export interface AppointmentEngineInput {
  date: string; // "YYYY-MM-DD"
  practitioners: Practitioner[];
  services: AppointmentService[];
  practitionerServices: PractitionerService[];
  existingBookings: AppointmentBooking[];
  phantomBookings?: PhantomBooking[];
  practitionerBlockedRanges?: PractitionerCalendarBlockedRange[];
  /**
   * When true, do not hide today's slots before the current clock time.
   * Used for staff reschedule validation - the guest booking may move to a time
   * that is already "past" relative to when staff edit (same-day corrections).
   */
  skipPastSlotFilter?: boolean;
  /** IANA timezone for same-day slot cutoffs (e.g. Europe/London). Omit for legacy server-local behaviour (tests). */
  venueTimezone?: string;
  /** Minimum hours before slot start for guest booking; 0 = from current venue-local time onward. */
  minNoticeHours?: number;
  /** When false, no guest slots are returned for the venue-local calendar day that is “today”. */
  allowSameDayBooking?: boolean;
  /**
   * Premises opening hours (venues.opening_hours). When set with at least one day configured,
   * appointment slots are clipped to the intersection of staff working hours and venue open periods.
   * When omitted, null, or {}, only staff hours apply (tests / legacy).
   */
  venueOpeningHours?: OpeningHours | null;
  /**
   * Venue-wide date exceptions (venues.venue_opening_exceptions): closed days or amended opening periods.
   * Applied together with weekly opening hours; the first matching range wins.
   */
  venueOpeningExceptions?: VenueOpeningException[] | null;
}

/** Apply venue timezone + per-service booking window to appointment availability (guest-facing paths should always call this). */
export function attachVenueClockToAppointmentInput(
  input: AppointmentEngineInput,
  venue: {
    timezone?: string | null;
    booking_rules?: unknown;
    opening_hours?: unknown;
    venue_opening_exceptions?: unknown;
  },
  bookingWindow?: EntityBookingWindow | null,
  venueBlocks?: AvailabilityBlock[] | null,
): void {
  const tz =
    typeof venue.timezone === 'string' && venue.timezone.trim() !== '' ? venue.timezone.trim() : 'Europe/London';
  input.venueTimezone = tz;
  const w = bookingWindow ?? DEFAULT_ENTITY_BOOKING_WINDOW;
  input.minNoticeHours = w.min_booking_notice_hours;
  input.allowSameDayBooking = w.allow_same_day_booking;
  if (venue.opening_hours !== undefined) {
    input.venueOpeningHours = venue.opening_hours as OpeningHours | null;
  }
  if (venueBlocks != null && venueBlocks.length > 0) {
    input.venueOpeningExceptions = blocksToVenueOpeningExceptions(venueBlocks);
  } else if (venueBlocks != null && venueBlocks.length === 0) {
    input.venueOpeningExceptions = [];
  } else if (venue.venue_opening_exceptions !== undefined) {
    const parsed = parseVenueOpeningExceptions(venue.venue_opening_exceptions);
    if (parsed.length > 0) {
      input.venueOpeningExceptions = parsed;
    } else if (input.venueOpeningExceptions == null) {
      input.venueOpeningExceptions = parsed;
    }
  }
}

export interface AppointmentBooking {
  id: string;
  practitioner_id: string;
  booking_time: string;       // "HH:mm"
  duration_minutes: number;
  buffer_minutes: number;
  processing_time_minutes?: number;
  /** Salon processing gaps for this row; when set, overrides template from catalog. */
  processing_time_blocks?: ProcessingTimeBlock[];
  status: string;
}

export interface PractitionerSlot {
  practitioner_id: string;
  practitioner_name: string;
  service_id: string;
  service_name: string;
  start_time: string;         // "HH:mm"
  duration_minutes: number;
  price_pence: number | null;
}

export interface AppointmentAvailabilityResult {
  practitioners: Array<{
    id: string;
    name: string;
    services: Array<{
      id: string;
      name: string;
      duration_minutes: number;
      price_pence: number | null;
      deposit_pence: number | null;
    }>;
    slots: PractitionerSlot[];
  }>;
}

// Helpers

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Align with dashboard working-hours keys (JS getDay, 0=Sun) - same as getDayOfWeek() in engine.ts. */
function dayKeyForDate(dateStr: string): string {
  return String(getDayOfWeek(dateStr));
}

function dayNameForDate(dateStr: string): string {
  const dow = getDayOfWeek(dateStr);
  return DAY_NAMES[dow]!;
}

function getWorkingRanges(practitioner: Practitioner, dateStr: string): Array<{ start: number; end: number }> {
  const dayKey = dayKeyForDate(dateStr);
  const dayName = dayNameForDate(dateStr);

  // Check specific date days-off
  if (Array.isArray(practitioner.days_off)) {
    for (const d of practitioner.days_off) {
      if (d === dateStr || d === dayName) return [];
    }
  }

  const hours = practitioner.working_hours as Record<string, Array<{ start: string; end: string }>>;
  const ranges = hours[dayKey] ?? hours[dayName];
  if (!ranges || ranges.length === 0) return [];

  return ranges.map((r) => ({ start: timeToMinutes(r.start), end: timeToMinutes(r.end) }));
}

function getBreakRanges(practitioner: Practitioner, dateStr: string): Array<{ start: number; end: number }> {
  const byDay = practitioner.break_times_by_day;
  if (byDay && typeof byDay === 'object' && !Array.isArray(byDay) && Object.keys(byDay).length > 0) {
    const dayKey = dayKeyForDate(dateStr);
    const dayName = dayNameForDate(dateStr);
    const ranges = byDay[dayKey] ?? byDay[dayName];
    if (!ranges || !Array.isArray(ranges) || ranges.length === 0) return [];
    return ranges.map((b) => ({ start: timeToMinutes(b.start), end: timeToMinutes(b.end) }));
  }

  const breaks = practitioner.break_times as Array<{ start: string; end: string }>;
  if (!Array.isArray(breaks)) return [];
  return breaks.map((b) => ({ start: timeToMinutes(b.start), end: timeToMinutes(b.end) }));
}

function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}

function minutesBetweenStartAndEnd(startHHmm: string, endHHmm: string): number {
  const start = timeToMinutes(startHHmm);
  let end = timeToMinutes(endHHmm);
  if (end <= start) {
    end += 24 * 60;
  }
  return end - start;
}

/**
 * For rows already scoped to a calendar date: full-day rows add to `days_off` via Set; partial rows become
 * practitioner block ranges (same shape as `practitioner_calendar_blocks` in the engine).
 */
export function leaveRowsToDaysOffAndBlocks(
  leaveRows: Array<{
    practitioner_id: string;
    unavailable_start_time?: string | null;
    unavailable_end_time?: string | null;
  }>,
): { fullDayPractitionerIds: Set<string>; partialBlocks: PractitionerCalendarBlockedRange[] } {
  const fullDayPractitionerIds = new Set<string>();
  const partialBlocks: PractitionerCalendarBlockedRange[] = [];

  for (const row of leaveRows) {
    const st = row.unavailable_start_time;
    const en = row.unavailable_end_time;
    if (st == null && en == null) {
      fullDayPractitionerIds.add(row.practitioner_id);
      continue;
    }
    if (st != null && en != null) {
      const start = timeToMinutes(String(st).slice(0, 5));
      const end = timeToMinutes(String(en).slice(0, 5));
      if (end > start) {
        partialBlocks.push({ practitioner_id: row.practitioner_id, start, end });
      }
    }
  }

  return { fullDayPractitionerIds, partialBlocks };
}

function wallBusyIntervalsForBooking(b: AppointmentBooking): Array<{ start: number; end: number }> {
  const wallStart = timeToMinutes(b.booking_time);
  const blocks = b.processing_time_blocks ?? [];
  const offsets = practitionerBusyMinuteOffsets({
    durationMinutes: b.duration_minutes,
    bufferMinutes: b.buffer_minutes,
    processingBlocks: blocks,
    legacyProcessingTailMinutes: blocks.length > 0 ? 0 : (b.processing_time_minutes ?? 0),
  });
  return offsets.map((o) => ({ start: wallStart + o.start, end: wallStart + o.end }));
}

function wallBusyIntervalsForPhantom(p: PhantomBooking): Array<{ start: number; end: number }> {
  const wallStart = timeToMinutes(p.start_time);
  const blocks = p.processing_time_blocks ?? [];
  const offsets = practitionerBusyMinuteOffsets({
    durationMinutes: p.duration_minutes,
    bufferMinutes: p.buffer_minutes,
    processingBlocks: blocks,
    legacyProcessingTailMinutes: blocks.length > 0 ? 0 : (p.processing_time_minutes ?? 0),
  });
  return offsets.map((o) => ({ start: wallStart + o.start, end: wallStart + o.end }));
}

/** Scheduling span for breaks / venue clip: core + buffer + legacy tail when no salon blocks. */
function serviceSchedulingSpanMinutes(svc: AppointmentService): number {
  const blocks = svc.processing_time_blocks ?? [];
  const legacy = blocks.length > 0 ? 0 : (svc.processing_time_minutes ?? 0);
  return svc.duration_minutes + svc.buffer_minutes + legacy;
}

function wallBusyIntervalsForServiceSlot(
  startMin: number,
  svc: AppointmentService,
): Array<{ start: number; end: number }> {
  const blocks = svc.processing_time_blocks ?? [];
  const offsets = practitionerBusyMinuteOffsets({
    durationMinutes: svc.duration_minutes,
    bufferMinutes: svc.buffer_minutes,
    processingBlocks: blocks,
    legacyProcessingTailMinutes: blocks.length > 0 ? 0 : (svc.processing_time_minutes ?? 0),
  });
  return offsets.map((o) => ({ start: startMin + o.start, end: startMin + o.end }));
}

function countOverlappingBookings(
  bookings: AppointmentBooking[],
  candidateBusyWall: Array<{ start: number; end: number }>,
  excludeBookingId?: string,
): number {
  const excludeLc = excludeBookingId?.toLowerCase();
  let n = 0;
  for (const b of bookings) {
    if (excludeLc && b.id.toLowerCase() === excludeLc) continue;
    if (busyIntervalsOverlap(candidateBusyWall, wallBusyIntervalsForBooking(b))) n++;
  }
  return n;
}

function countOverlappingPhantoms(
  phantoms: PhantomBooking[],
  candidateBusyWall: Array<{ start: number; end: number }>,
): number {
  let n = 0;
  for (const p of phantoms) {
    if (busyIntervalsOverlap(candidateBusyWall, wallBusyIntervalsForPhantom(p))) n++;
  }
  return n;
}

function parallelCapacityFor(practitioner: Practitioner): number {
  const p = practitioner.parallel_clients;
  if (typeof p === 'number' && p >= 1) return Math.min(50, Math.floor(p));
  return 1;
}

/** True when the venue has saved opening hours (non-empty object). */
function isVenueOpeningHoursConfigured(openingHours: OpeningHours | null | undefined): boolean {
  return openingHours != null && typeof openingHours === 'object' && Object.keys(openingHours).length > 0;
}

/** Intersect two lists of [start,end) minute ranges (half-open style end at boundary). */
function intersectMinuteRanges(
  a: Array<{ start: number; end: number }>,
  b: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (const ra of a) {
    for (const rb of b) {
      const s = Math.max(ra.start, rb.start);
      const e = Math.min(ra.end, rb.end);
      if (s < e) out.push({ start: s, end: e });
    }
  }
  return out.sort((x, y) => x.start - y.start);
}

function findApplicableVenueOpeningException(
  exceptions: VenueOpeningException[] | null | undefined,
  dateStr: string,
): VenueOpeningException | null {
  if (!exceptions?.length) return null;
  for (const ex of exceptions) {
    if (ex.date_start <= dateStr && dateStr <= ex.date_end) return ex;
  }
  return null;
}

/**
 * Venue-wide minute ranges for `dateStr` after weekly hours and per-date exceptions.
 * Returns null when no venue boundary applies (legacy: staff hours only).
 */
function venueMinuteRangesForAppointmentDate(
  venueOpeningHours: OpeningHours | null | undefined,
  dateStr: string,
  exceptions: VenueOpeningException[] | null | undefined,
): Array<{ start: number; end: number }> | null {
  const ex = findApplicableVenueOpeningException(exceptions, dateStr);
  if (ex) {
    if (ex.closed) return [];
    if (ex.periods?.length) {
      return ex.periods.map((p) => ({
        start: timeToMinutes(p.open.slice(0, 5)),
        end: timeToMinutes(p.close.slice(0, 5)),
      }));
    }
  }
  if (isVenueOpeningHoursConfigured(venueOpeningHours)) {
    const day = getDayOfWeek(dateStr);
    const periods = getOpeningPeriodsForDay(venueOpeningHours, day);
    return periods.map((p) => ({ start: timeToMinutes(p.open), end: timeToMinutes(p.close) }));
  }
  return null;
}

/**
 * Staff working ranges intersected with venue opening periods for that calendar date.
 * When venue has no opening-hours config and no applicable exception, returns staff ranges unchanged.
 */
function effectiveWorkingRangesForAppointments(
  workingRanges: Array<{ start: number; end: number }>,
  venueOpeningHours: OpeningHours | null | undefined,
  dateStr: string,
  venueOpeningExceptions?: VenueOpeningException[] | null,
): Array<{ start: number; end: number }> {
  const venueRanges = venueMinuteRangesForAppointmentDate(venueOpeningHours, dateStr, venueOpeningExceptions);
  if (venueRanges === null) {
    return workingRanges;
  }
  if (venueRanges.length === 0) {
    return [];
  }
  return intersectMinuteRanges(workingRanges, venueRanges);
}

const CAPACITY_CONSUMING_STATUSES = ['Booked', 'Confirmed', 'Pending', 'Seated'];

/**
 * Services a practitioner/calendar offers for appointment booking (only rows explicitly linked in
 * practitioner_services or calendar_service_assignments). No links means no appointment services on that column.
 */
export function getOfferedAppointmentServicesForPractitioner(
  practitioner: Practitioner,
  services: AppointmentService[],
  practitionerServices: PractitionerService[],
): AppointmentService[] {
  const serviceMap = new Map(services.map((s) => [s.id, s]));
  const allLinksForPractitioner = practitionerServices.filter((ps) => ps.practitioner_id === practitioner.id);
  return allLinksForPractitioner
    .map((ps) => {
      const svc = serviceMap.get(ps.service_id);
      if (!svc || !svc.is_active) return null;
      return mergeAppointmentServiceWithPractitionerLink(svc, ps);
    })
    .filter(Boolean) as AppointmentService[];
}

// Core engine

export function computeAppointmentAvailability(input: AppointmentEngineInput, nowMinutes?: number): AppointmentAvailabilityResult {
  const {
    date,
    practitioners,
    services,
    practitionerServices,
    existingBookings,
    phantomBookings = [],
    practitionerBlockedRanges = [],
    skipPastSlotFilter = false,
    venueTimezone,
    minNoticeHours = 0,
    venueOpeningHours,
    venueOpeningExceptions,
  } = input;

  // “Today” and clock are venue-local when timezone is set (production); otherwise server-local (tests).
  let todayStr: string;
  let currentMinute: number;
  if (venueTimezone) {
    const local = getVenueLocalDateAndMinutes(venueTimezone, new Date());
    todayStr = local.dateYmd;
    currentMinute = nowMinutes ?? local.minutesSinceMidnight;
  } else {
    const now = new Date();
    todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    currentMinute = nowMinutes ?? (now.getHours() * 60 + now.getMinutes());
  }
  const isToday = date === todayStr;
  const minNoticeMinutes = Math.max(0, minNoticeHours * 60);

  const result: AppointmentAvailabilityResult = { practitioners: [] };

  for (const practitioner of practitioners) {
    if (!practitioner.is_active) continue;

    const workingRanges = getWorkingRanges(practitioner, date);
    if (workingRanges.length === 0) continue;

    const effectiveWorkingRanges = effectiveWorkingRangesForAppointments(
      workingRanges,
      venueOpeningHours,
      date,
      venueOpeningExceptions,
    );
    if (effectiveWorkingRanges.length === 0) continue;

    const breakRanges = getBreakRanges(practitioner, date);

    const practitionerBookings = existingBookings.filter(
      (b) => b.practitioner_id === practitioner.id && CAPACITY_CONSUMING_STATUSES.includes(b.status)
    );

    const practitionerPhantoms = phantomBookings.filter(
      (p) => p.practitioner_id === practitioner.id
    );

    const dayBlocks = practitionerBlockedRanges.filter((b) => b.practitioner_id === practitioner.id);
    const parallelCap = parallelCapacityFor(practitioner);

    const offeredServices = getOfferedAppointmentServicesForPractitioner(practitioner, services, practitionerServices);

    const allSlots: PractitionerSlot[] = [];
    const practitionerServiceList: Array<{
      id: string;
      name: string;
      duration_minutes: number;
      price_pence: number | null;
      deposit_pence: number | null;
      payment_requirement?: ClassPaymentRequirement;
    }> = [];

    for (const svc of offeredServices) {
      const totalSpan = serviceSchedulingSpanMinutes(svc);
      const serviceSlots: PractitionerSlot[] = [];

      practitionerServiceList.push({
        id: svc.id,
        name: svc.name,
        duration_minutes: svc.duration_minutes,
        price_pence: svc.price_pence,
        deposit_pence: svc.deposit_pence,
        payment_requirement: svc.payment_requirement,
      });

      const serviceEffectiveRanges = intersectEffectiveRangesWithServiceCustom(
        effectiveWorkingRanges,
        svc,
        date,
      );

      for (const range of serviceEffectiveRanges) {
        for (let t = range.start; t + totalSpan <= range.end; t += 15) {
          // Guest flow: venue-local “now” + minimum notice (hours). Staff reschedule uses skipPastSlotFilter.
          if (isToday && !skipPastSlotFilter && t < currentMinute + minNoticeMinutes) continue;

          const slotEnd = t + totalSpan;
          const candidateBusy = wallBusyIntervalsForServiceSlot(t, svc);

          // Check breaks
          const hitsBreak = breakRanges.some((b) => overlaps(t, slotEnd, b.start, b.end));
          if (hitsBreak) continue;

          // Staff calendar blocks (blocked time ranges)
          const hitsCalendarBlock = dayBlocks.some((b) => overlaps(t, slotEnd, b.start, b.end));
          if (hitsCalendarBlock) continue;

          // Existing + phantom bookings vs parallel_clients (USE / unified_calendars)
          const overlapping =
            countOverlappingBookings(practitionerBookings, candidateBusy, undefined) +
            countOverlappingPhantoms(practitionerPhantoms, candidateBusy);
          if (overlapping >= parallelCap) continue;

          serviceSlots.push({
            practitioner_id: practitioner.id,
            practitioner_name: practitioner.name,
            service_id: svc.id,
            service_name: svc.name,
            start_time: minutesToTime(t),
            duration_minutes: svc.duration_minutes,
            price_pence: svc.price_pence,
          });
        }
      }

      allSlots.push(...serviceSlots);
    }

    if (allSlots.length > 0 || offeredServices.length > 0) {
      result.practitioners.push({
        id: practitioner.id,
        name: practitioner.name,
        services: practitionerServiceList,
        slots: allSlots,
      });
    }
  }

  return result;
}

/**
 * Validates that an appointment can start at an exact time (not limited to 15-minute grid).
 * Used for consecutive multi-service bookings where follow-on start times are derived from
 * previous service end + buffer.
 */
export function validateExactAppointmentStart(
  input: AppointmentEngineInput,
  practitionerId: string,
  serviceId: string,
  startTimeHHmm: string,
): { ok: boolean; reason?: string } {
  const {
    date,
    practitioners,
    services,
    practitionerServices,
    existingBookings,
    phantomBookings = [],
    practitionerBlockedRanges = [],
    skipPastSlotFilter = false,
    venueTimezone,
    minNoticeHours = 0,
    venueOpeningHours,
    venueOpeningExceptions,
  } = input;

  let todayStr: string;
  let currentMinute: number;
  if (venueTimezone) {
    const local = getVenueLocalDateAndMinutes(venueTimezone, new Date());
    todayStr = local.dateYmd;
    currentMinute = local.minutesSinceMidnight;
  } else {
    const now = new Date();
    todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    currentMinute = now.getHours() * 60 + now.getMinutes();
  }
  const isToday = date === todayStr;
  const minNoticeMinutes = Math.max(0, minNoticeHours * 60);

  const practitioner = practitioners.find((p) => p.id === practitionerId && p.is_active);
  if (!practitioner) {
    return { ok: false, reason: 'Staff not available' };
  }

  const offeredServices = getOfferedAppointmentServicesForPractitioner(practitioner, services, practitionerServices);
  const svc = offeredServices.find((s) => s.id === serviceId);
  if (!svc) {
    return { ok: false, reason: 'Service not available with this staff member' };
  }

  const totalDuration = serviceSchedulingSpanMinutes(svc);
  const t = timeToMinutes(startTimeHHmm.slice(0, 5));
  const slotEnd = t + totalDuration;
  const candidateBusy = wallBusyIntervalsForServiceSlot(t, svc);

  const workingRanges = getWorkingRanges(practitioner, date);
  if (workingRanges.length === 0) {
    return { ok: false, reason: 'Staff not working this day' };
  }

  const effectiveWorkingRanges = effectiveWorkingRangesForAppointments(
    workingRanges,
    venueOpeningHours,
    date,
    venueOpeningExceptions,
  );
  if (effectiveWorkingRanges.length === 0) {
    return { ok: false, reason: 'Outside opening hours' };
  }

  const afterServiceCustom = intersectEffectiveRangesWithServiceCustom(effectiveWorkingRanges, svc, date);
  if (afterServiceCustom.length === 0) {
    return { ok: false, reason: 'Outside service availability hours' };
  }

  const fitsInRange = afterServiceCustom.some((r) => t >= r.start && slotEnd <= r.end);
  if (!fitsInRange) {
    return { ok: false, reason: 'Outside working hours' };
  }

  if (isToday && !skipPastSlotFilter && t < currentMinute + minNoticeMinutes) {
    return { ok: false, reason: 'Past minimum notice window' };
  }

  const breakRanges = getBreakRanges(practitioner, date);
  if (breakRanges.some((b) => overlaps(t, slotEnd, b.start, b.end))) {
    return { ok: false, reason: 'Conflicts with a break' };
  }

  const dayBlocks = practitionerBlockedRanges.filter((b) => b.practitioner_id === practitioner.id);
  if (dayBlocks.some((b) => overlaps(t, slotEnd, b.start, b.end))) {
    return { ok: false, reason: 'Blocked time' };
  }

  const practitionerBookings = existingBookings.filter(
    (b) => b.practitioner_id === practitioner.id && CAPACITY_CONSUMING_STATUSES.includes(b.status),
  );

  const practitionerPhantoms = phantomBookings.filter((p) => p.practitioner_id === practitioner.id);
  const parallelCap = parallelCapacityFor(practitioner);
  const overlapping =
    countOverlappingBookings(practitionerBookings, candidateBusy, undefined) +
    countOverlappingPhantoms(practitionerPhantoms, candidateBusy);
  if (overlapping >= parallelCap) {
    return { ok: false, reason: 'Conflicts with another booking' };
  }

  return { ok: true };
}

const MAX_APPOINTMENT_CORE_DURATION_MINUTES = 14 * 60;

/**
 * Staff reschedule / calendar resize: validate [start, endCore) plus service buffer + processing
 * fits working hours, breaks, calendar blocks, and parallel capacity vs other bookings.
 * `endCoreHHmm` is the wall-clock end of the bookable segment (same semantics as `booking_end_time` on the row).
 */
export function validateAppointmentCustomInterval(
  input: AppointmentEngineInput,
  practitionerId: string,
  serviceId: string,
  startTimeHHmm: string,
  endCoreHHmm: string,
  excludeBookingId?: string,
  options?: {
    allowBookingOverlap?: boolean;
    /** Snapshot blocks for this booking; when omitted, uses service template. */
    processingTimeBlocks?: ProcessingTimeBlock[] | null;
  },
): { ok: boolean; reason?: string } {
  const {
    date,
    practitioners,
    services,
    practitionerServices,
    existingBookings,
    phantomBookings = [],
    practitionerBlockedRanges = [],
    skipPastSlotFilter = false,
    venueTimezone,
    minNoticeHours = 0,
    venueOpeningHours,
    venueOpeningExceptions,
  } = input;

  let todayStr: string;
  let currentMinute: number;
  if (venueTimezone) {
    const local = getVenueLocalDateAndMinutes(venueTimezone, new Date());
    todayStr = local.dateYmd;
    currentMinute = local.minutesSinceMidnight;
  } else {
    const now = new Date();
    todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    currentMinute = now.getHours() * 60 + now.getMinutes();
  }
  const isToday = date === todayStr;
  const minNoticeMinutes = Math.max(0, minNoticeHours * 60);

  const practitioner = practitioners.find((p) => p.id === practitionerId && p.is_active);
  if (!practitioner) {
    return { ok: false, reason: 'Staff not available' };
  }

  const offeredServices = getOfferedAppointmentServicesForPractitioner(practitioner, services, practitionerServices);
  const svc = offeredServices.find((s) => s.id === serviceId);
  if (!svc) {
    return { ok: false, reason: 'Service not available with this staff member' };
  }

  const buffer = svc.buffer_minutes ?? 0;

  const t = timeToMinutes(startTimeHHmm.slice(0, 5));
  const coreDuration = minutesBetweenStartAndEnd(startTimeHHmm.slice(0, 5), endCoreHHmm.slice(0, 5));
  if (!(coreDuration >= 15)) {
    return { ok: false, reason: 'End time must be at least 15 minutes after start' };
  }
  if (coreDuration > MAX_APPOINTMENT_CORE_DURATION_MINUTES) {
    return { ok: false, reason: 'Appointment duration is too long' };
  }

  const templateBlocks = options?.processingTimeBlocks !== undefined && options.processingTimeBlocks !== null
    ? options.processingTimeBlocks
    : (svc.processing_time_blocks ?? []);
  const blockCheck = validateProcessingTimeBlocks(templateBlocks, coreDuration);
  if (!blockCheck.ok) {
    return { ok: false, reason: blockCheck.error ?? 'Invalid processing time for this duration' };
  }
  const useBlocks = blockCheck.normalized ?? [];
  const legacyTail = useBlocks.length > 0 ? 0 : (svc.processing_time_minutes ?? 0);
  const busyOffsets = practitionerBusyMinuteOffsets({
    durationMinutes: coreDuration,
    bufferMinutes: buffer,
    processingBlocks: useBlocks,
    legacyProcessingTailMinutes: legacyTail,
  });
  const busyWall = busyOffsets.map((o) => ({ start: t + o.start, end: t + o.end }));
  const customerEnd = t + coreDuration + buffer;
  const practMaxEnd = busyWall.length > 0 ? Math.max(...busyWall.map((i) => i.end)) : t;
  const busyEnd = Math.max(customerEnd, practMaxEnd);

  const workingRanges = getWorkingRanges(practitioner, date);
  if (workingRanges.length === 0) {
    return { ok: false, reason: 'Staff not working this day' };
  }

  const effectiveWorkingRanges = effectiveWorkingRangesForAppointments(
    workingRanges,
    venueOpeningHours,
    date,
    venueOpeningExceptions,
  );
  if (effectiveWorkingRanges.length === 0) {
    return { ok: false, reason: 'Outside opening hours' };
  }

  const afterServiceCustom = intersectEffectiveRangesWithServiceCustom(effectiveWorkingRanges, svc, date);
  if (afterServiceCustom.length === 0) {
    return { ok: false, reason: 'Outside service availability hours' };
  }

  const fitsInRange = afterServiceCustom.some((r) => t >= r.start && busyEnd <= r.end);
  if (!fitsInRange) {
    return { ok: false, reason: 'Outside working hours' };
  }

  if (isToday && !skipPastSlotFilter && t < currentMinute + minNoticeMinutes) {
    return { ok: false, reason: 'Past minimum notice window' };
  }

  const breakRanges = getBreakRanges(practitioner, date);
  if (breakRanges.some((b) => overlaps(t, busyEnd, b.start, b.end))) {
    return { ok: false, reason: 'Conflicts with a break' };
  }

  const dayBlocks = practitionerBlockedRanges.filter((b) => b.practitioner_id === practitioner.id);
  if (dayBlocks.some((b) => overlaps(t, busyEnd, b.start, b.end))) {
    return { ok: false, reason: 'Blocked time' };
  }

  if (!options?.allowBookingOverlap) {
    const practitionerBookings = existingBookings.filter(
      (b) => b.practitioner_id === practitioner.id && CAPACITY_CONSUMING_STATUSES.includes(b.status),
    );

    const practitionerPhantoms = phantomBookings.filter((p) => p.practitioner_id === practitioner.id);
    const parallelCap = parallelCapacityFor(practitioner);
    const overlapping =
      countOverlappingBookings(practitionerBookings, busyWall, excludeBookingId) +
      countOverlappingPhantoms(practitionerPhantoms, busyWall);
    if (overlapping >= parallelCap) {
      return { ok: false, reason: 'Conflicts with another booking' };
    }
  }

  return { ok: true };
}

export function resolveEngineBookingProcessingBlocks(params: {
  snapshotRaw: unknown;
  mergedService: AppointmentService | null;
  variantBlocks: ProcessingTimeBlock[] | undefined;
}): ProcessingTimeBlock[] {
  if (params.snapshotRaw !== null && params.snapshotRaw !== undefined) {
    return parseProcessingTimeBlocksFromDb(params.snapshotRaw);
  }
  return effectiveProcessingBlocksForTemplate({
    parentBlocks: params.mergedService?.processing_time_blocks ?? [],
    variantBlocks: params.variantBlocks,
  });
}

// Fetcher

export async function fetchAppointmentInput(params: {
  supabase: SupabaseClient;
  venueId: string;
  date: string;
  practitionerId?: string;
  serviceId?: string;
}): Promise<AppointmentEngineInput> {
  const { supabase, venueId, date, practitionerId, serviceId } = params;

  /** Unified scheduling exposes staff as `unified_calendars` rows; the same UUID is sent as `practitioner_id`. */
  if (practitionerId) {
    const { data: ucRow } = await supabase
      .from('unified_calendars')
      .select('id')
      .eq('venue_id', venueId)
      .eq('id', practitionerId)
      .maybeSingle();
    if (ucRow) {
      return fetchCalendarAppointmentInput({ supabase, venueId, date, calendarId: practitionerId, serviceId });
    }
  }

  let practitionerQuery = supabase
    .from('practitioners')
    .select('*')
    .eq('venue_id', venueId)
    .eq('is_active', true)
    .order('sort_order');
  if (practitionerId) {
    practitionerQuery = practitionerQuery.eq('id', practitionerId);
  }

  let bookingsQuery = supabase
    .from('bookings')
    .select(
      'id, practitioner_id, calendar_id, booking_time, booking_end_time, appointment_service_id, service_item_id, service_variant_id, processing_time_blocks, status',
    )
    .eq('venue_id', venueId)
    .eq('booking_date', date)
    .in('status', CAPACITY_CONSUMING_STATUSES);
  if (practitionerId) {
    bookingsQuery = bookingsQuery.or(
      `practitioner_id.eq.${practitionerId},calendar_id.eq.${practitionerId}`,
    );
  } else {
    bookingsQuery = bookingsQuery.not('practitioner_id', 'is', null);
  }

  const [practitionersRes, allServicesRes, psRes, bookingsRes, blocksRes, leaveRes, venueRes, venueBlocksRes] = await Promise.all([
    practitionerQuery,
    supabase
      .from('appointment_services')
      .select('*')
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .order('sort_order'),
    supabase.from('practitioner_services').select('*, practitioners!inner(venue_id)').eq('practitioners.venue_id', venueId),
    bookingsQuery,
    supabase
      .from('practitioner_calendar_blocks')
      .select('practitioner_id, start_time, end_time')
      .eq('venue_id', venueId)
      .eq('block_date', date),
    supabase
      .from('practitioner_leave_periods')
      .select('practitioner_id, unavailable_start_time, unavailable_end_time')
      .eq('venue_id', venueId)
      .lte('start_date', date)
      .gte('end_date', date),
    supabase.from('venues').select('opening_hours, venue_opening_exceptions').eq('id', venueId).single(),
    supabase
      .from('availability_blocks')
      .select('id, venue_id, service_id, block_type, date_start, date_end, time_start, time_end, override_max_covers, reason, yield_overrides, override_periods')
      .eq('venue_id', venueId)
      .is('service_id', null)
      .in('block_type', ['closed', 'amended_hours', 'special_event'])
      .lte('date_start', date)
      .gte('date_end', date),
  ]);

  let practitioners = (practitionersRes.data ?? []) as Practitioner[];

  let leavePartialBlocks: PractitionerCalendarBlockedRange[] = [];
  if (!leaveRes.error && leaveRes.data?.length) {
    const { fullDayPractitionerIds, partialBlocks } = leaveRowsToDaysOffAndBlocks(
      leaveRes.data as Array<{
        practitioner_id: string;
        unavailable_start_time?: string | null;
        unavailable_end_time?: string | null;
      }>,
    );
    leavePartialBlocks = partialBlocks;
    practitioners = practitioners.map((p) => {
      if (!fullDayPractitionerIds.has(p.id)) return p;
      const existing = Array.isArray(p.days_off) ? [...p.days_off] : [];
      if (!existing.includes(date)) existing.push(date);
      return { ...p, days_off: existing };
    });
  } else if (leaveRes.error) {
    console.warn('[fetchAppointmentInput] practitioner_leave_periods:', leaveRes.error.message);
  }
  let allServices = (allServicesRes.data ?? []).map((raw) => {
    const s = raw as Record<string, unknown>;
    return {
      ...(raw as AppointmentService),
      processing_time_blocks: parseProcessingTimeBlocksFromDb(s.processing_time_blocks),
    };
  }) as AppointmentService[];
  if (allServices.length > 0) {
    const { data: procRows } = await supabase
      .from('service_items')
      .select('id, processing_time_minutes, processing_time_blocks')
      .eq('venue_id', venueId)
      .in(
        'id',
        allServices.map((s) => s.id),
      );
    const procMap = new Map(
      (procRows ?? []).map((r) => {
        const row = r as {
          id: string;
          processing_time_minutes?: number;
          processing_time_blocks?: unknown;
        };
        return [
          row.id,
          {
            processing_time_minutes: row.processing_time_minutes ?? 0,
            processing_time_blocks: parseProcessingTimeBlocksFromDb(row.processing_time_blocks),
          },
        ] as const;
      }),
    );
    allServices = allServices.map((s) => {
      const meta = procMap.get(s.id);
      if (!meta) return s;
      return {
        ...s,
        processing_time_minutes: meta.processing_time_minutes,
        processing_time_blocks: meta.processing_time_blocks,
      };
    });
  }
  const services = serviceId ? allServices.filter((s) => s.id === serviceId) : allServices;
  const practitionerServices = (psRes.data ?? []) as PractitionerService[];
  const serviceMapForBookings = new Map(allServices.map((s) => [s.id, s]));

  const variantIds = [
    ...new Set(
      (bookingsRes.data ?? [])
        .map((b) => (b as { service_variant_id?: string | null }).service_variant_id)
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  let variantBlocksById = new Map<string, ProcessingTimeBlock[]>();
  if (variantIds.length > 0) {
    const { data: vrows } = await supabase
      .from('service_variants')
      .select('id, processing_time_blocks')
      .in('id', variantIds);
    variantBlocksById = new Map(
      (vrows ?? []).map((r) => {
        const row = r as { id: string; processing_time_blocks?: unknown };
        return [row.id, parseProcessingTimeBlocksFromDb(row.processing_time_blocks)];
      }),
    );
  }

  const existingBookings: AppointmentBooking[] = (bookingsRes.data ?? []).map((b) => {
    const row = b as {
      practitioner_id: string | null;
      calendar_id?: string | null;
      appointment_service_id: string | null;
      service_item_id: string | null;
      service_variant_id?: string | null;
      processing_time_blocks?: unknown;
      booking_end_time?: string | null;
    };
    const sid = (row.service_item_id ?? row.appointment_service_id) as string | null;
    const svc = sid ? serviceMapForBookings.get(sid) : null;
    const practId = row.practitioner_id ?? row.calendar_id;
    const ps = sid && practId
      ? practitionerServices.find((pRow) => pRow.practitioner_id === practId && pRow.service_id === sid)
      : undefined;
    const merged = svc ? mergeAppointmentServiceWithPractitionerLink(svc, ps) : null;
    const startMin = timeToMinutes((b.booking_time as string).slice(0, 5));
    let coreDuration = merged?.duration_minutes ?? 30;
    const rawBet = row.booking_end_time;
    if (rawBet != null && String(rawBet).trim() !== '') {
      const endMin = timeToMinutes(String(rawBet).slice(0, 5));
      const d = endMin - startMin;
      if (d >= 15) coreDuration = d;
    }
    const variantBl = row.service_variant_id
      ? variantBlocksById.get(row.service_variant_id)
      : undefined;
    const processingBlocks = resolveEngineBookingProcessingBlocks({
      snapshotRaw: row.processing_time_blocks,
      mergedService: merged,
      variantBlocks: variantBl,
    });
    return {
      id: b.id,
      practitioner_id: practId!,
      booking_time: (b.booking_time as string).slice(0, 5),
      duration_minutes: coreDuration,
      buffer_minutes: merged?.buffer_minutes ?? 0,
      processing_time_minutes: merged?.processing_time_minutes ?? 0,
      processing_time_blocks: processingBlocks,
      status: b.status,
    };
  });

  const practitionerBlockedRanges: PractitionerCalendarBlockedRange[] = [
    ...(blocksRes.error
      ? []
      : (blocksRes.data ?? [])
          .map((row: { practitioner_id: string; start_time: string; end_time: string }) => ({
            practitioner_id: row.practitioner_id,
            start: timeToMinutes(String(row.start_time).slice(0, 5)),
            end: timeToMinutes(String(row.end_time).slice(0, 5)),
          }))
          .filter((b) => b.end > b.start)),
    ...leavePartialBlocks,
  ];

  /**
   * For each practitioner whose id also exists as a `unified_calendars` column, fold
   * scheduled classes and events on that column into the block list so appointments
   * cannot overlap them (mirror of the calendar-path behaviour above).
   */
  const sessionRangesByPractitioner = await Promise.all(
    practitioners.map((p) =>
      fetchScheduledSessionBlocksForCalendar(supabase, venueId, p.id, date).then((ranges) => ({
        practitioner_id: p.id,
        ranges,
      })),
    ),
  );
  for (const entry of sessionRangesByPractitioner) {
    for (const r of entry.ranges) {
      practitionerBlockedRanges.push({
        practitioner_id: entry.practitioner_id,
        start: r.start,
        end: r.end,
      });
    }
  }

  if (blocksRes.error) {
    console.warn('[fetchAppointmentInput] practitioner_calendar_blocks:', blocksRes.error.message);
  }

  const venueOpeningHours = venueRes.error
    ? null
    : ((venueRes.data?.opening_hours as OpeningHours | null) ?? null);

  const venueBlocks = (venueBlocksRes.data ?? []) as AvailabilityBlock[];
  const venueOpeningExceptions = venueBlocks.length > 0
    ? blocksToVenueOpeningExceptions(venueBlocks)
    : venueRes.error
      ? null
      : parseVenueOpeningExceptions(
          (venueRes.data as { venue_opening_exceptions?: unknown } | null)?.venue_opening_exceptions,
        );

  if (venueRes.error) {
    console.warn('[fetchAppointmentInput] venues.opening_hours:', venueRes.error.message);
  }

  return {
    date,
    practitioners,
    services,
    practitionerServices,
    existingBookings,
    practitionerBlockedRanges,
    venueOpeningHours,
    venueOpeningExceptions,
  };
}

/**
 * Availability input for a unified calendar row (resource, or practitioner without legacy row).
 * Uses service_items + calendar_service_assignments; calendar UUID is both calendar and practitioner id.
 */
export async function fetchCalendarAppointmentInput(params: {
  supabase: SupabaseClient;
  venueId: string;
  date: string;
  calendarId: string;
  serviceId?: string;
}): Promise<AppointmentEngineInput> {
  const { supabase, venueId, date, calendarId, serviceId } = params;

  const empty = (): AppointmentEngineInput => ({
    date,
    practitioners: [],
    services: [],
    practitionerServices: [],
    existingBookings: [],
    practitionerBlockedRanges: [],
    venueOpeningHours: null,
    venueOpeningExceptions: null,
  });

  const { data: ucRow, error: ucErr } = await supabase
    .from('unified_calendars')
    .select('*')
    .eq('id', calendarId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (ucErr || !ucRow) {
    console.warn('[fetchCalendarAppointmentInput] unified_calendars:', ucErr?.message);
    return empty();
  }

  let practitioner: Practitioner = unifiedCalendarRowToPractitioner(ucRow as Record<string, unknown>);

  const { data: assignments } = await supabase
    .from('calendar_service_assignments')
    .select('id, service_item_id, custom_duration_minutes, custom_price_pence')
    .eq('calendar_id', calendarId);

  const assignList = assignments ?? [];
  const serviceIds = assignList.map((a) => (a as { service_item_id: string }).service_item_id);

  let svcRows: Record<string, unknown>[] | null;
  if (serviceIds.length > 0) {
    const { data } = await supabase
      .from('service_items')
      .select('*')
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .in('id', serviceIds);
    svcRows = data ?? [];
  } else {
    svcRows = [];
  }

  const assignMap = new Map(
    assignList.map((a) => [(a as { service_item_id: string }).service_item_id, a]),
  );

  let services: AppointmentService[] = (svcRows ?? []).map((raw) => {
    const s = raw as Record<string, unknown>;
    const a = assignMap.get(s.id as string) as
      | { custom_duration_minutes?: number | null; custom_price_pence?: number | null }
      | undefined;
    const customDur = a?.custom_duration_minutes;
    const customPrice = a?.custom_price_pence;
    return {
      id: s.id as string,
      venue_id: venueId,
      name: s.name as string,
      description: (s.description as string) ?? null,
      duration_minutes: (customDur ?? s.duration_minutes) as number,
      buffer_minutes: (s.buffer_minutes as number) ?? 0,
      processing_time_minutes: (s.processing_time_minutes as number) ?? 0,
      processing_time_blocks: parseProcessingTimeBlocksFromDb(s.processing_time_blocks),
      price_pence: (customPrice ?? s.price_pence) as number | null,
      payment_requirement: (s.payment_requirement as ClassPaymentRequirement | undefined) ?? undefined,
      deposit_pence: (s.deposit_pence as number | null) ?? null,
      colour: (s.colour as string) ?? '#3B82F6',
      is_active: true,
      sort_order: (s.sort_order as number) ?? 0,
      created_at: (s.created_at as string) ?? new Date().toISOString(),
      custom_availability_enabled: Boolean(s.custom_availability_enabled),
      custom_working_hours: parseCustomWorkingHoursFromDb(s.custom_working_hours),
    };
  });
  if (serviceId) {
    services = services.filter((s) => s.id === serviceId);
  }

  const practitionerServices: PractitionerService[] = assignList.map((a) => {
    const row = a as {
      id: string;
      service_item_id: string;
      custom_duration_minutes: number | null;
      custom_price_pence: number | null;
    };
    return {
      id: row.id,
      practitioner_id: calendarId,
      service_id: row.service_item_id,
      custom_duration_minutes: row.custom_duration_minutes,
      custom_price_pence: row.custom_price_pence,
    };
  });

  const { data: leaveRows, error: leaveErr } = await supabase
    .from('practitioner_leave_periods')
    .select('practitioner_id, unavailable_start_time, unavailable_end_time')
    .eq('venue_id', venueId)
    .eq('practitioner_id', calendarId)
    .lte('start_date', date)
    .gte('end_date', date);

  let leavePartialForCalendar: PractitionerCalendarBlockedRange[] = [];
  if (!leaveErr && leaveRows?.length) {
    const { fullDayPractitionerIds, partialBlocks } = leaveRowsToDaysOffAndBlocks(
      leaveRows as Array<{
        practitioner_id: string;
        unavailable_start_time?: string | null;
        unavailable_end_time?: string | null;
      }>,
    );
    leavePartialForCalendar = partialBlocks;
    if (fullDayPractitionerIds.has(calendarId)) {
      const existing = Array.isArray(practitioner.days_off) ? [...practitioner.days_off] : [];
      if (!existing.includes(date)) existing.push(date);
      practitioner = { ...practitioner, days_off: existing };
    }
  } else if (leaveErr) {
    console.warn('[fetchCalendarAppointmentInput] practitioner_leave_periods:', leaveErr.message);
  }

  const [bookingsRes, blocksRes, calBlocksRes, venueRes, siblingResourcesRes, venueBlocksRes] = await Promise.all([
    supabase
      .from('bookings')
      .select(
        'id, practitioner_id, calendar_id, booking_time, booking_end_time, appointment_service_id, service_item_id, service_variant_id, processing_time_blocks, status',
      )
      .eq('venue_id', venueId)
      .eq('booking_date', date)
      .or(`practitioner_id.eq.${calendarId},calendar_id.eq.${calendarId}`)
      .in('status', CAPACITY_CONSUMING_STATUSES),
    supabase
      .from('practitioner_calendar_blocks')
      .select('practitioner_id, start_time, end_time')
      .eq('venue_id', venueId)
      .eq('block_date', date)
      .eq('practitioner_id', calendarId),
    supabase
      .from('calendar_blocks')
      .select('start_time, end_time')
      .eq('venue_id', venueId)
      .eq('calendar_id', calendarId)
      .eq('block_date', date),
    supabase.from('venues').select('opening_hours, venue_opening_exceptions').eq('id', venueId).single(),
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
      .lte('date_start', date)
      .gte('date_end', date),
  ]);

  const serviceMapForBookings = new Map(services.map((s) => [s.id, s]));

  const calVariantIds = [
    ...new Set(
      (bookingsRes.data ?? [])
        .map((b) => (b as { service_variant_id?: string | null }).service_variant_id)
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  let calVariantBlocksById = new Map<string, ProcessingTimeBlock[]>();
  if (calVariantIds.length > 0) {
    const { data: calVrows } = await supabase
      .from('service_variants')
      .select('id, processing_time_blocks')
      .in('id', calVariantIds);
    calVariantBlocksById = new Map(
      (calVrows ?? []).map((r) => {
        const row = r as { id: string; processing_time_blocks?: unknown };
        return [row.id, parseProcessingTimeBlocksFromDb(row.processing_time_blocks)];
      }),
    );
  }

  const existingBookings: AppointmentBooking[] = (bookingsRes.data ?? []).map((b) => {
    const row = b as {
      practitioner_id: string | null;
      calendar_id?: string | null;
      appointment_service_id: string | null;
      service_item_id: string | null;
      service_variant_id?: string | null;
      processing_time_blocks?: unknown;
      booking_end_time?: string | null;
    };
    const sid = (row.service_item_id ?? row.appointment_service_id) as string | null;
    const svc = sid ? serviceMapForBookings.get(sid) : null;
    const practKey = row.practitioner_id ?? row.calendar_id ?? calendarId;
    const ps = sid
      ? practitionerServices.find((pRow) => pRow.practitioner_id === calendarId && pRow.service_id === sid)
      : undefined;
    const merged = svc ? mergeAppointmentServiceWithPractitionerLink(svc, ps) : null;
    const startMin = timeToMinutes((b.booking_time as string).slice(0, 5));
    let coreDuration = merged?.duration_minutes ?? 30;
    const rawBet = row.booking_end_time;
    if (rawBet != null && String(rawBet).trim() !== '') {
      const endMin = timeToMinutes(String(rawBet).slice(0, 5));
      const d = endMin - startMin;
      if (d >= 15) coreDuration = d;
    }
    const variantBl = row.service_variant_id ? calVariantBlocksById.get(row.service_variant_id) : undefined;
    const processingBlocks = resolveEngineBookingProcessingBlocks({
      snapshotRaw: row.processing_time_blocks,
      mergedService: merged,
      variantBlocks: variantBl,
    });
    return {
      id: b.id,
      practitioner_id: practKey,
      booking_time: (b.booking_time as string).slice(0, 5),
      duration_minutes: coreDuration,
      buffer_minutes: merged?.buffer_minutes ?? 0,
      processing_time_minutes: merged?.processing_time_minutes ?? 0,
      processing_time_blocks: processingBlocks,
      status: b.status,
    };
  });

  const legacyBlockRanges: PractitionerCalendarBlockedRange[] = blocksRes.error
    ? []
    : (blocksRes.data ?? [])
        .map((row: { practitioner_id: string; start_time: string; end_time: string }) => ({
          practitioner_id: row.practitioner_id,
          start: timeToMinutes(String(row.start_time).slice(0, 5)),
          end: timeToMinutes(String(row.end_time).slice(0, 5)),
        }))
        .filter((b) => b.end > b.start);

  const unifiedCalBlockRanges: PractitionerCalendarBlockedRange[] = calBlocksRes.error
    ? []
    : (calBlocksRes.data ?? []).map((row: { start_time: string; end_time: string }) => ({
        practitioner_id: calendarId,
        start: timeToMinutes(String(row.start_time).slice(0, 5)),
        end: timeToMinutes(String(row.end_time).slice(0, 5)),
      }))
      .filter((b) => b.end > b.start);

  let resourceHostBlockRanges: PractitionerCalendarBlockedRange[] = [];
  if (!siblingResourcesRes.error && (siblingResourcesRes.data?.length ?? 0) > 0) {
    let siblings = (siblingResourcesRes.data ?? []).map((r) =>
      mapCalendarToResource(r as Record<string, unknown>),
    );
    siblings = await attachHostCalendarsToResources(supabase, venueId, siblings);
    const union = mergedResourceEffectiveRangesForHost(siblings, date);
    resourceHostBlockRanges = union.map((r) => ({
      practitioner_id: calendarId,
      start: r.start,
      end: r.end,
    }));
  }

  /**
   * Scheduled classes and events render on this calendar column via the schedule feed,
   * not via `calendar_blocks`. Treat them as blocks so appointments cannot overlap a
   * class/event even before any tickets have been booked.
   */
  const sessionRanges = await fetchScheduledSessionBlocksForCalendar(supabase, venueId, calendarId, date);
  const scheduledSessionBlockRanges: PractitionerCalendarBlockedRange[] = sessionRanges.map((r) => ({
    practitioner_id: calendarId,
    start: r.start,
    end: r.end,
  }));

  const practitionerBlockedRanges: PractitionerCalendarBlockedRange[] = [
    ...legacyBlockRanges,
    ...unifiedCalBlockRanges,
    ...resourceHostBlockRanges,
    ...scheduledSessionBlockRanges,
    ...leavePartialForCalendar,
  ];

  if (blocksRes.error) {
    console.warn('[fetchCalendarAppointmentInput] practitioner_calendar_blocks:', blocksRes.error.message);
  }
  if (calBlocksRes.error) {
    console.warn('[fetchCalendarAppointmentInput] calendar_blocks:', calBlocksRes.error.message);
  }
  if (siblingResourcesRes.error) {
    console.warn('[fetchCalendarAppointmentInput] sibling resources:', siblingResourcesRes.error.message);
  }

  const venueOpeningHours = venueRes.error
    ? null
    : ((venueRes.data?.opening_hours as OpeningHours | null) ?? null);

  const calVenueBlocks = (venueBlocksRes.data ?? []) as AvailabilityBlock[];
  const venueOpeningExceptions = calVenueBlocks.length > 0
    ? blocksToVenueOpeningExceptions(calVenueBlocks)
    : venueRes.error
      ? null
      : parseVenueOpeningExceptions(
          (venueRes.data as { venue_opening_exceptions?: unknown } | null)?.venue_opening_exceptions,
        );

  return {
    date,
    practitioners: [practitioner],
    services,
    practitionerServices,
    existingBookings,
    practitionerBlockedRanges,
    venueOpeningHours,
    venueOpeningExceptions,
  };
}
