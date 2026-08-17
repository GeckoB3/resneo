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
  effectiveProcessingBlocksForTemplate,
  fitProcessingBlocksToDuration,
  parseProcessingTimeBlocksFromDb,
  practitionerBusyMinuteOffsets,
  validateProcessingTimeBlocks,
} from '@/lib/appointments/processing-time';
import { mergeAppointmentServiceWithPractitionerLink } from '@/lib/appointments/merge-service-with-overrides';
import { candidateStartMinutes, sanitizeBookingStartTimes } from '@/lib/appointments/booking-interval';
import type { OpeningHours } from '@/types/availability';
import { timeToMinutes, minutesToTime } from '@/lib/availability';
import { getDayOfWeek } from '@/lib/availability/engine';
import { getVenueLocalDateAndMinutes } from '@/lib/venue/venue-local-clock';
import { unifiedCalendarRowToPractitioner } from '@/lib/availability/unified-calendar-mapper';
import {
  reportAvailabilityReadFailure,
  reportAvailabilityReadFailures,
} from '@/lib/availability/availability-read-failure';
import {
  mapCalendarToResource,
  attachHostCalendarsToResources,
  mergedResourceEffectiveRangesForHost,
} from '@/lib/availability/resource-booking-engine';
import type { EntityBookingWindow } from '@/lib/booking/entity-booking-window';
import { DEFAULT_ENTITY_BOOKING_WINDOW } from '@/lib/booking/entity-booking-window';
import { parseVenueOpeningExceptions } from '@/types/venue-opening-exceptions';
import type { AvailabilityBlock } from '@/types/availability';
import { venueOpeningExceptionsToBlocks } from '@/lib/availability/venue-exceptions-adapter';
import {
  resolveVenueWideAllowedMinuteRanges,
  venueClosureWindowsForDate,
  venueHoursToNullableRanges,
} from '@/lib/availability/venue-wide-business-hours';
import { intersectEffectiveRangesWithServiceCustom, parseCustomWorkingHoursFromDb } from '@/lib/service-custom-availability';
import { fetchScheduledSessionBlocksForCalendar } from '@/lib/availability/calendar-session-blocks';
import {
  VENUE_BOOKING_MODEL_COLUMNS,
  blockSourcesFromVenueRow,
} from '@/lib/availability/blocked-range-models';
import { VENUE_WIDE_BLOCK_SELECT } from '@/lib/availability/venue-wide-blocks-fetch';

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
  /**
   * Source of the block, used to give a specific conflict reason. Defaults to a generic
   * "Blocked time" when omitted. `scheduled_session` = a class/event on this calendar column;
   * `leave` = a partial staff-leave window; `resource` = a bookable resource occupying the
   * calendar it is displayed on.
   */
  kind?: 'blocked_time' | 'scheduled_session' | 'leave' | 'resource';
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
   * Venue-wide `availability_blocks` rows for the date (closures, special events, amended
   * hours). Replaces the old `venueWideBlocks`, so this engine and every other
   * consumer now resolve venue hours through the same function.
   */
  venueWideBlocks?: AvailabilityBlock[] | null;
  /**
   * Calendars on FULL-DAY leave for `date`.
   *
   * Carried separately because full-day leave is folded into `days_off` by
   * `leaveRowsToDaysOffAndBlocks`, and `days_off` is consumed by the
   * working-hours gate, which staff overrides skip. That made leave
   * unenforceable on any path passing `allowOutsideHours`, while the code
   * comments claimed the opposite (SA-M3). Partial leave never had this problem:
   * it arrives as a `practitionerBlockedRange` with kind `leave`, which is
   * checked unconditionally.
   */
  fullDayLeavePractitionerIds?: string[];
}

/** Apply venue timezone + per-service booking window to appointment availability (guest-facing paths should always call this). */
export function attachVenueClockToAppointmentInput(
  input: AppointmentEngineInput,
  venue: {
    id?: string | null;
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
  if (venueBlocks != null) {
    input.venueWideBlocks = venueBlocks;
  } else if (venue.venue_opening_exceptions !== undefined && input.venueWideBlocks == null) {
    /**
     * The legacy `venues.venue_opening_exceptions` JSON is a FALLBACK, never an override.
     *
     * It used to win whenever it parsed non-empty, which quietly discarded the
     * block-derived list the caller's fetcher had already built. Filling only when
     * genuinely absent keeps the escape hatch for a caller that has no blocks at all,
     * without letting it outrank the table. SA-L1.
     *
     * Converted up to `availability_blocks` shape so there is one resolution path rather
     * than two. Q9 found no venue carrying legacy JSON, so this branch is dead in practice.
     */
    const parsed = parseVenueOpeningExceptions(venue.venue_opening_exceptions);
    input.venueWideBlocks = venueOpeningExceptionsToBlocks(parsed, String(venue.id ?? ''));
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

export function getWorkingRanges(practitioner: Practitioner, dateStr: string): Array<{ start: number; end: number }> {
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

export function getBreakRanges(practitioner: Practitioner, dateStr: string): Array<{ start: number; end: number }> {
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

/** Specific conflict reason for a blocked-range hit, by source kind (defaults to generic blocked time). */
function blockedRangeReason(kind?: PractitionerCalendarBlockedRange['kind']): string {
  if (kind === 'scheduled_session') return 'Overlaps a scheduled class or event';
  if (kind === 'leave') return 'Staff is on leave at this time';
  if (kind === 'resource') return 'Overlaps a resource booking';
  return 'Blocked time';
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

/**
 * The most bookings running AT ONCE anywhere the candidate would be present.
 *
 * `parallel_clients` caps how many clients a calendar handles simultaneously, so
 * this counts concurrency, not how many rows the candidate happens to touch. The
 * old count refused a candidate that merely spanned two back-to-back bookings:
 * with a cap of 2 and bookings at 09:00-10:00 and 10:00-11:00, a 09:30 candidate
 * touched both and was rejected even though only two clients are ever in the
 * room at once. That silently cost capacity on every calendar with a cap above 1.
 *
 * Each booking contributes at most 1 at any instant, because its own busy
 * intervals are disjoint (a processing gap splits them but they never overlap).
 */
function peakConcurrentBookings(
  bookings: AppointmentBooking[],
  phantoms: PhantomBooking[],
  candidateBusyWall: Array<{ start: number; end: number }>,
  excludeBookingId?: string,
): number {
  const excludeLc = excludeBookingId?.toLowerCase();
  const busyPerEntity: Array<Array<{ start: number; end: number }>> = [];
  for (const b of bookings) {
    if (excludeLc && b.id.toLowerCase() === excludeLc) continue;
    busyPerEntity.push(wallBusyIntervalsForBooking(b));
  }
  for (const p of phantoms) {
    busyPerEntity.push(wallBusyIntervalsForPhantom(p));
  }

  // Clip every existing interval to the candidate's own busy span: concurrency
  // outside the candidate is irrelevant to whether the candidate fits.
  const events: Array<{ at: number; delta: number }> = [];
  for (const entity of busyPerEntity) {
    for (const iv of entity) {
      for (const c of candidateBusyWall) {
        const start = Math.max(iv.start, c.start);
        const end = Math.min(iv.end, c.end);
        if (start < end) {
          events.push({ at: start, delta: 1 });
          events.push({ at: end, delta: -1 });
        }
      }
    }
  }
  if (events.length === 0) return 0;

  // Ends before starts at the same instant, matching the half-open intervals
  // used everywhere else: a booking ending at 11:00 does not overlap one
  // starting at 11:00.
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let current = 0;
  let peak = 0;
  for (const ev of events) {
    current += ev.delta;
    if (current > peak) peak = current;
  }
  return peak;
}

function parallelCapacityFor(practitioner: Practitioner): number {
  const p = practitioner.parallel_clients;
  if (typeof p === 'number' && p >= 1) return Math.min(50, Math.floor(p));
  return 1;
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

/** Whole days from `fromYmd` to `toYmd`, negative when `toYmd` is earlier. */
function wholeDaysBetweenYmd(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split('-').map(Number);
  const [ty, tm, td] = toYmd.split('-').map(Number);
  const from = Date.UTC(fy!, fm! - 1, fd!);
  const to = Date.UTC(ty!, tm! - 1, td!);
  return Math.round((to - from) / 86_400_000);
}

/**
 * How far ahead a slot is, in venue-local wall-clock minutes.
 *
 * The minimum-notice gate used to be written as minutes-since-midnight and
 * applied only when the requested date WAS today, so it could never express
 * notice that crosses midnight: a service asking for 48 hours accepted a 09:00
 * booking made at 23:00 the night before, and above 24 hours the rule was inert
 * for every date except today. Measuring from the date as well as the clock
 * makes one comparison work for every date.
 *
 * Deliberately wall-clock rather than elapsed real time: a venue promising "48
 * hours notice" means the calendar, and matching that keeps the rule stable
 * across a DST boundary.
 */
function slotMinutesFromNow(params: {
  dateStr: string;
  todayStr: string;
  slotMinute: number;
  currentMinute: number;
}): number {
  const { dateStr, todayStr, slotMinute, currentMinute } = params;
  return wholeDaysBetweenYmd(todayStr, dateStr) * 24 * 60 + slotMinute - currentMinute;
}

/**
 * The venue's ANCHORING hours for a date: weekly baseline after Hours overrides replace it,
 * with closures NOT subtracted. Null means the venue imposes no constraint.
 *
 * Closures are deliberately excluded and vetoed per candidate instead. Subtracting a
 * part-day closure here would split the anchoring range and re-anchor every slot after it,
 * so a 12:00-12:45 closure would move the afternoon grid from 13:00/13:30 to 12:45/13:15
 * and `validateExactAppointmentStart` would start refusing previously-bookable times. That
 * is the harm §2.7 forbids for breaks, and it applies identically here. See plan §2.1.
 */
function venueAnchorRangesForDate(
  venueOpeningHours: OpeningHours | null | undefined,
  dateStr: string,
  venueWideBlocks: AvailabilityBlock[] | null | undefined,
): Array<{ start: number; end: number }> | null {
  const res = resolveVenueWideAllowedMinuteRanges(venueOpeningHours, dateStr, venueWideBlocks ?? []);
  // Nothing survives the day at all: no anchoring set, and the caller drops the calendar
  // rather than returning it with an empty slot list. Only a WHOLE-day closure (or a
  // weekly-closed weekday) reaches here; a part-day closure leaves ranges behind and is
  // vetoed per candidate below, which is what preserves the grid alignment.
  if (res.kind === 'closed') return [];
  return venueHoursToNullableRanges(res.hours);
}

/** Venue closure windows for the date, as a veto set. */
function venueClosureRangesForDate(
  dateStr: string,
  venueWideBlocks: AvailabilityBlock[] | null | undefined,
): Array<{ start: number; end: number }> {
  return venueClosureWindowsForDate(venueWideBlocks ?? [], dateStr);
}

/**
 * Staff working ranges intersected with the venue's anchoring hours for that date.
 * When the venue imposes no constraint, returns the staff ranges unchanged.
 */
function effectiveWorkingRangesForAppointments(
  workingRanges: Array<{ start: number; end: number }>,
  venueOpeningHours: OpeningHours | null | undefined,
  dateStr: string,
  venueWideBlocks?: AvailabilityBlock[] | null,
): Array<{ start: number; end: number }> {
  const venueRanges = venueAnchorRangesForDate(venueOpeningHours, dateStr, venueWideBlocks);
  if (venueRanges === null) return workingRanges;
  if (venueRanges.length === 0) return [];
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
  // Keyed by service so the result follows the order of `services` (callers pass it
  // sorted by sort_order), not the arbitrary order of the link rows. First link wins
  // on (impossible-by-constraint) duplicates, matching the previous find() semantics.
  const linkByServiceId = new Map<string, PractitionerService>();
  for (const ps of practitionerServices) {
    if (ps.practitioner_id !== practitioner.id) continue;
    if (!linkByServiceId.has(ps.service_id)) linkByServiceId.set(ps.service_id, ps);
  }
  return services
    .map((svc) => {
      if (!svc.is_active) return null;
      const link = linkByServiceId.get(svc.id);
      if (!link) return null;
      return mergeAppointmentServiceWithPractitionerLink(svc, link);
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
    venueWideBlocks,
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
  const minNoticeMinutes = Math.max(0, minNoticeHours * 60);

  // Venue closures are a VETO, not a subtraction from the anchoring set. See
  // venueAnchorRangesForDate for why: subtracting would re-anchor every slot after a
  // part-day closure.
  const venueClosures = venueClosureRangesForDate(date, venueWideBlocks);

  const result: AppointmentAvailabilityResult = { practitioners: [] };

  for (const practitioner of practitioners) {
    if (!practitioner.is_active) continue;

    const workingRanges = getWorkingRanges(practitioner, date);
    if (workingRanges.length === 0) continue;

    const effectiveWorkingRanges = effectiveWorkingRangesForAppointments(
      workingRanges,
      venueOpeningHours,
      date,
      venueWideBlocks,
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

      // Candidate start times: fixed times of day when the service sets them, otherwise the
      // interval grid (see candidateStartMinutes for the exact anchoring rules).
      const candidateStarts = candidateStartMinutes({
        ranges: serviceEffectiveRanges,
        totalSpan,
        interval_minutes: svc.booking_interval_minutes,
        minute_marks: svc.booking_minute_marks,
        start_times: svc.booking_start_times,
      });

      for (const t of candidateStarts) {
        // Guest flow: venue-local “now” + minimum notice (hours), on ANY date.
        // Staff reschedule uses skipPastSlotFilter.
        if (
          !skipPastSlotFilter &&
          slotMinutesFromNow({ dateStr: date, todayStr, slotMinute: t, currentMinute }) <
            minNoticeMinutes
        ) {
          continue;
        }

        const slotEnd = t + totalSpan;
        const candidateBusy = wallBusyIntervalsForServiceSlot(t, svc);

        // Venue closure covering this candidate. Vetoed rather than subtracted, so the
        // times either side of a part-day closure keep their grid alignment.
        if (venueClosures.some((c) => overlaps(t, slotEnd, c.start, c.end))) continue;

        // Check breaks
        const hitsBreak = breakRanges.some((b) => overlaps(t, slotEnd, b.start, b.end));
        if (hitsBreak) continue;

        // Staff calendar blocks (blocked time ranges)
        const hitsCalendarBlock = dayBlocks.some((b) => overlaps(t, slotEnd, b.start, b.end));
        if (hitsCalendarBlock) continue;

        // Existing + phantom bookings vs parallel_clients (USE / unified_calendars)
        const concurrent = peakConcurrentBookings(
          practitionerBookings,
          practitionerPhantoms,
          candidateBusy,
        );
        if (concurrent >= parallelCap) continue;

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
 * Validates that an appointment can start at an exact time (not limited to the interval grid).
 * Used for consecutive multi-service bookings where follow-on start times are derived from
 * previous service end + buffer.
 *
 * Fixed start times are still enforced. The interval grid is deliberately relaxed here so a chain
 * can begin a follow-on service the moment the previous one ends, but fixed times are an explicit
 * list of when the service runs, not a granularity, so a booking outside that list is not offered
 * and must not be creatable by posting the time directly.
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
    venueWideBlocks,
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

  const fixedStarts = sanitizeBookingStartTimes(svc.booking_start_times ?? null);
  if (fixedStarts.length > 0 && !fixedStarts.includes(startTimeHHmm.slice(0, 5))) {
    return { ok: false, reason: 'This service only starts at set times of day' };
  }

  const workingRanges = getWorkingRanges(practitioner, date);
  if (workingRanges.length === 0) {
    return { ok: false, reason: 'Staff not working this day' };
  }

  const effectiveWorkingRanges = effectiveWorkingRangesForAppointments(
    workingRanges,
    venueOpeningHours,
    date,
    venueWideBlocks,
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

  if (
    !skipPastSlotFilter &&
    slotMinutesFromNow({ dateStr: date, todayStr, slotMinute: t, currentMinute }) < minNoticeMinutes
  ) {
    return { ok: false, reason: 'Past minimum notice window' };
  }

  // Venue closure covering this exact start. Same veto as slot generation, so the two
  // stay in agreement -- the read/write pair the parity harness asserts.
  if (venueClosureRangesForDate(date, venueWideBlocks).some((c) => overlaps(t, slotEnd, c.start, c.end))) {
    return { ok: false, reason: 'The venue is closed for this date or time.' };
  }

  const breakRanges = getBreakRanges(practitioner, date);
  if (breakRanges.some((b) => overlaps(t, slotEnd, b.start, b.end))) {
    return { ok: false, reason: 'Conflicts with a break' };
  }

  const dayBlocks = practitionerBlockedRanges.filter((b) => b.practitioner_id === practitioner.id);
  const blockHitExact = dayBlocks.find((b) => overlaps(t, slotEnd, b.start, b.end));
  if (blockHitExact) {
    return { ok: false, reason: blockedRangeReason(blockHitExact.kind) };
  }

  const practitionerBookings = existingBookings.filter(
    (b) => b.practitioner_id === practitioner.id && CAPACITY_CONSUMING_STATUSES.includes(b.status),
  );

  const practitionerPhantoms = phantomBookings.filter((p) => p.practitioner_id === practitioner.id);
  const parallelCap = parallelCapacityFor(practitioner);
  const concurrent = peakConcurrentBookings(practitionerBookings, practitionerPhantoms, candidateBusy);
  if (concurrent >= parallelCap) {
    return { ok: false, reason: 'Conflicts with another booking' };
  }

  return { ok: true };
}

export const MAX_APPOINTMENT_CORE_DURATION_MINUTES = 14 * 60;
/**
 * Shortest bookable appointment, in minutes.
 *
 * Matches the floor `appointment_services.duration_minutes` has always allowed
 * (`z.number().int().min(5)`). It was 15 here, which made a service between 5
 * and 14 minutes configurable but unbookable and unresizable — a fringe trim or
 * a blood-pressure check could be set up and then refused with "End time must be
 * at least 15 minutes after start". The two limits have to agree; 5 is the one
 * services already promise, and it matches the calendar's 5-minute drag snap.
 */
export const MIN_APPOINTMENT_CORE_DURATION_MINUTES = 5;

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
    /**
     * Skip the opening-hours / working-hours / "not working this day" gates.
     * Used for staff-initiated walk-ins, moves and resizes, which are deliberately
     * allowed to run outside the business's / calendar's opening hours (the staff
     * accepts a warning in the UI). Breaks, blocks, overlap, minimum-notice and
     * duration limits are unaffected by this flag; relax those separately.
     *
     * Full-day leave is also unaffected, and is checked ahead of this flag via
     * `input.fullDayLeavePractitionerIds`. It used to be skipped here, because
     * full-day leave reaches the gate as a `days_off` entry (SA-M3).
     */
    allowOutsideHours?: boolean;
    /**
     * Skip the minimum-booking-notice ("booked too soon" / past-slot) gate.
     * A staff walk-in taken on the spot is immediate by definition, so the
     * service's min-booking-notice window does not apply — the slot is "now".
     */
    allowInsideNoticeWindow?: boolean;
    /**
     * Skip the staff-break overlap gate. A staff walk-in is taken regardless of
     * the practitioner's configured breaks — the front desk has chosen to take it.
     */
    allowDuringBreaks?: boolean;
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
    venueWideBlocks,
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
  if (!(coreDuration >= MIN_APPOINTMENT_CORE_DURATION_MINUTES)) {
    return {
      ok: false,
      reason: `End time must be at least ${MIN_APPOINTMENT_CORE_DURATION_MINUTES} minutes after start`,
    };
  }
  if (coreDuration > MAX_APPOINTMENT_CORE_DURATION_MINUTES) {
    return { ok: false, reason: 'Appointment duration is too long' };
  }

  const callerBlocks =
    options?.processingTimeBlocks !== undefined && options.processingTimeBlocks !== null
      ? options.processingTimeBlocks
      : null;

  let useBlocks: ProcessingTimeBlock[];
  if (callerBlocks) {
    /**
     * The caller asserted a specific pattern for THIS booking, so an overrun is
     * a real contradiction and is still refused.
     */
    const blockCheck = validateProcessingTimeBlocks(callerBlocks, coreDuration);
    if (!blockCheck.ok) {
      return { ok: false, reason: blockCheck.error ?? 'Invalid processing time for this duration' };
    }
    useBlocks = blockCheck.normalized ?? [];
  } else {
    /**
     * No assertion, so this is the service TEMPLATE being applied to whatever
     * duration was asked about. Fit it rather than refusing: the availability
     * routes pass a custom duration and no blocks, so a template that overran
     * failed identically for every candidate start and returned an empty day and
     * an empty month with nothing explaining why. Whether a booking may PERSIST
     * a given pattern is a separate question, still answered strictly on the
     * write path.
     */
    useBlocks = fitProcessingBlocksToDuration(svc.processing_time_blocks ?? [], coreDuration).blocks;
  }
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

  // Full-day leave is NOT an opening-hours question and is checked before the
  // override below can skip anything. It used to sit inside that block by
  // accident: `leaveRowsToDaysOffAndBlocks` folds full-day leave into
  // `days_off`, so the only thing enforcing it was the "not working this day"
  // gate, and every staff move, resize and walk-in skipped it while the
  // comments here claimed leave was still honoured (SA-M3). Partial leave was
  // always safe: it arrives as a blocked range of kind `leave`, checked below.
  if (input.fullDayLeavePractitionerIds?.includes(practitioner.id)) {
    return { ok: false, reason: 'Staff on leave this day' };
  }

  // Opening-hours / working-hours gates. Staff-initiated walk-ins, moves and
  // resizes pass `allowOutsideHours` to deliberately book past opening hours.
  if (!options?.allowOutsideHours) {
    const workingRanges = getWorkingRanges(practitioner, date);
    if (workingRanges.length === 0) {
      return { ok: false, reason: 'Staff not working this day' };
    }

    const effectiveWorkingRanges = effectiveWorkingRangesForAppointments(
      workingRanges,
      venueOpeningHours,
      date,
      venueWideBlocks,
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

    // Venue closure covering this window. Inside the allowOutsideHours gate, because a
    // venue closure is an `hours` rule that staff can deliberately book through today --
    // unlike leave, which is checked above and which nothing may skip. See plan §2.1.
    if (venueClosureRangesForDate(date, venueWideBlocks).some((c) => overlaps(t, busyEnd, c.start, c.end))) {
      return { ok: false, reason: 'The venue is closed for this date or time.' };
    }
  }

  if (
    !options?.allowInsideNoticeWindow &&
    !skipPastSlotFilter &&
    slotMinutesFromNow({ dateStr: date, todayStr, slotMinute: t, currentMinute }) < minNoticeMinutes
  ) {
    return { ok: false, reason: 'Past minimum notice window' };
  }

  if (!options?.allowDuringBreaks) {
    const breakRanges = getBreakRanges(practitioner, date);
    if (breakRanges.some((b) => overlaps(t, busyEnd, b.start, b.end))) {
      return { ok: false, reason: 'Conflicts with a break' };
    }
  }

  const dayBlocks = practitionerBlockedRanges.filter((b) => b.practitioner_id === practitioner.id);
  const blockHit = dayBlocks.find((b) => overlaps(t, busyEnd, b.start, b.end));
  if (blockHit) {
    return { ok: false, reason: blockedRangeReason(blockHit.kind) };
  }

  if (!options?.allowBookingOverlap) {
    const practitionerBookings = existingBookings.filter(
      (b) => b.practitioner_id === practitioner.id && CAPACITY_CONSUMING_STATUSES.includes(b.status),
    );

    const practitionerPhantoms = phantomBookings.filter((p) => p.practitioner_id === practitioner.id);
    const parallelCap = parallelCapacityFor(practitioner);
    const concurrent = peakConcurrentBookings(
      practitionerBookings,
      practitionerPhantoms,
      busyWall,
      excludeBookingId,
    );
    if (concurrent >= parallelCap) {
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

/** The booking columns both fetchers select, before any engine interpretation. */
export interface EngineBookingRow {
  id: string;
  booking_time: string;
  status: string;
  practitioner_id?: string | null;
  calendar_id?: string | null;
  appointment_service_id?: string | null;
  service_item_id?: string | null;
  service_variant_id?: string | null;
  processing_time_blocks?: unknown;
  booking_end_time?: string | null;
}

/**
 * One row of `bookings` as the engine sees it: how much of the calendar it holds.
 *
 * Shared by both fetchers on purpose. These were duplicated blocks that drifted:
 * the unified one resolved neighbour services against a list narrowed to the
 * service being browsed, so every booking of a DIFFERENT service came back with
 * no buffer and a 30-minute default, and the engine handed out slots that ran
 * into it. Keeping one implementation is what stops that recurring.
 *
 * `serviceMap` must therefore cover the whole catalogue, not just the requested
 * service.
 *
 * `forPractitionerId` pins both the returned anchor and the service-link lookup
 * to the calendar the rows were fetched for. The unified fetcher passes it
 * because its rows are already scoped by `calendar_id.eq` / `practitioner_id.eq`
 * and its links are keyed by calendar: a row carrying a stale foreign
 * `practitioner_id` would otherwise miss its link (losing the calendar's custom
 * duration) and be filed under a practitioner the engine is not evaluating.
 */
export function mapRowToAppointmentBooking(params: {
  row: EngineBookingRow;
  serviceMap: Map<string, AppointmentService>;
  practitionerServices: PractitionerService[];
  variantBlocksById: Map<string, ProcessingTimeBlock[]>;
  forPractitionerId?: string;
}): AppointmentBooking {
  const { row, serviceMap, practitionerServices, variantBlocksById, forPractitionerId } = params;

  const sid = row.service_item_id ?? row.appointment_service_id ?? null;
  const svc = sid ? serviceMap.get(sid) : null;
  const practId = forPractitionerId ?? row.practitioner_id ?? row.calendar_id;
  const ps =
    sid && practId
      ? practitionerServices.find((p) => p.practitioner_id === practId && p.service_id === sid)
      : undefined;
  const merged = svc ? mergeAppointmentServiceWithPractitionerLink(svc, ps) : null;

  const startMin = timeToMinutes(row.booking_time.slice(0, 5));
  let coreDuration = merged?.duration_minutes ?? 30;
  const rawBet = row.booking_end_time;
  if (rawBet != null && String(rawBet).trim() !== '') {
    const endMin = timeToMinutes(String(rawBet).slice(0, 5));
    /**
     * Deliberately NOT wrapped past midnight. An end before the start is far
     * more often a stale row (a reschedule that moved `booking_time` and left
     * `booking_end_time` behind) than a real overnight appointment, and wrapping
     * would turn that into a 23-hour block that swallows the practitioner's day.
     * Falling through to the catalogue duration keeps a corrupt row survivable.
     * Revisit once every writer maintains `booking_end_time`.
     */
    const d = endMin - startMin;
    // Trust the row's OWN end time down to the same floor a booking may be
    // created at. Pinned at 15 this silently replaced a shorter booking's real
    // span with the service's default duration, so a 10-minute appointment
    // would hold 30 minutes of the calendar against every conflict check.
    if (d >= MIN_APPOINTMENT_CORE_DURATION_MINUTES) coreDuration = d;
  }

  return {
    id: row.id,
    practitioner_id: practId!,
    booking_time: row.booking_time.slice(0, 5),
    duration_minutes: coreDuration,
    buffer_minutes: merged?.buffer_minutes ?? 0,
    processing_time_minutes: merged?.processing_time_minutes ?? 0,
    processing_time_blocks: resolveEngineBookingProcessingBlocks({
      snapshotRaw: row.processing_time_blocks,
      mergedService: merged,
      variantBlocks: row.service_variant_id ? variantBlocksById.get(row.service_variant_id) : undefined,
    }),
    status: row.status,
  };
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
    const { data: ucRow, error: ucLookupErr } = await supabase
      .from('unified_calendars')
      .select('id')
      .eq('venue_id', venueId)
      .eq('id', practitionerId)
      .maybeSingle();
    if (ucLookupErr) {
      // Every venue is on unified scheduling, so a failure here routes the
      // request down the legacy branch, which has no rows to find.
      reportAvailabilityReadFailure(
        {
          source: 'fetchAppointmentInput',
          table: 'unified_calendars (routing lookup)',
          assumed: 'this id is not a calendar, so the legacy path runs and finds nothing',
          venueId,
          practitionerId,
          date,
        },
        ucLookupErr,
      );
    }
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
    supabase
      .from('venues')
      .select(`opening_hours, venue_opening_exceptions, ${VENUE_BOOKING_MODEL_COLUMNS}`)
      .eq('id', venueId)
      .single(),
    supabase
      .from('availability_blocks')
      .select(VENUE_WIDE_BLOCK_SELECT)
      .eq('venue_id', venueId)
      .is('service_id', null)
      .in('block_type', ['closed', 'amended_hours', 'special_event'])
      .lte('date_start', date)
      .gte('date_end', date),
  ]);

  /**
   * Every read above fails open: each consumer below substitutes an empty
   * result, so a failed query becomes "nothing is booked" or "nothing is
   * blocked" rather than an error. Report before that substitution (SA-C3).
   */
  reportAvailabilityReadFailures(
    'fetchAppointmentInput',
    { venueId, date, practitionerId: practitionerId ?? null },
    [
      { table: 'practitioners', assumed: 'the venue has no active practitioners', error: practitionersRes.error },
      { table: 'appointment_services', assumed: 'the venue offers no services', error: allServicesRes.error },
      { table: 'practitioner_services', assumed: 'no practitioner is linked to any service', error: psRes.error },
      { table: 'bookings', assumed: 'nothing is booked, so every slot is free', error: bookingsRes.error },
      { table: 'practitioner_calendar_blocks', assumed: 'no practitioner has blocked time', error: blocksRes.error },
      { table: 'practitioner_leave_periods', assumed: 'nobody is on leave', error: leaveRes.error },
      { table: 'venues.opening_hours', assumed: 'the venue has no opening hours to clip against', error: venueRes.error },
      { table: 'availability_blocks', assumed: 'the venue has no closures or amended hours', error: venueBlocksRes.error },
    ],
  );

  /** A model that is switched off must not block; see `blocked-range-models.ts`. */
  const blockSources = blockSourcesFromVenueRow(venueRes.error ? null : venueRes.data);

  let practitioners = (practitionersRes.data ?? []) as Practitioner[];

  let leavePartialBlocks: PractitionerCalendarBlockedRange[] = [];
  let fullDayLeaveIds: string[] = [];
  if (!leaveRes.error && leaveRes.data?.length) {
    const { fullDayPractitionerIds, partialBlocks } = leaveRowsToDaysOffAndBlocks(
      leaveRes.data as Array<{
        practitioner_id: string;
        unavailable_start_time?: string | null;
        unavailable_end_time?: string | null;
      }>,
    );
    leavePartialBlocks = partialBlocks;
    // Kept alongside the `days_off` fold rather than instead of it: the fold is
    // what hides the day from guests, and this is what survives a staff
    // override (SA-M3).
    fullDayLeaveIds = [...fullDayPractitionerIds];
    practitioners = practitioners.map((p) => {
      if (!fullDayPractitionerIds.has(p.id)) return p;
      const existing = Array.isArray(p.days_off) ? [...p.days_off] : [];
      if (!existing.includes(date)) existing.push(date);
      return { ...p, days_off: existing };
    });
  }
  let allServices = (allServicesRes.data ?? []).map((raw) => {
    const s = raw as Record<string, unknown>;
    return {
      ...(raw as AppointmentService),
      processing_time_blocks: parseProcessingTimeBlocksFromDb(s.processing_time_blocks),
    };
  }) as AppointmentService[];
  if (allServices.length > 0) {
    const { data: procRows, error: procErr } = await supabase
      .from('service_items')
      .select('id, processing_time_minutes, processing_time_blocks')
      .eq('venue_id', venueId)
      .in(
        'id',
        allServices.map((s) => s.id),
      );
    if (procErr) {
      // Fails closed rather than open: without the gaps, a booking occupies its
      // whole duration and the practitioner looks busier than they are.
      reportAvailabilityReadFailure(
        {
          source: 'fetchAppointmentInput',
          table: 'service_items.processing_time_blocks',
          assumed: 'services have no processing gaps, so fewer slots are offered',
          venueId,
          date,
        },
        procErr,
      );
    }
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
    const { data: vrows, error: vrowsErr } = await supabase
      .from('service_variants')
      .select('id, processing_time_blocks')
      .in('id', variantIds);
    if (vrowsErr) {
      reportAvailabilityReadFailure(
        {
          source: 'fetchAppointmentInput',
          table: 'service_variants.processing_time_blocks',
          assumed: 'variants have no processing gaps, so fewer slots are offered',
          venueId,
          date,
        },
        vrowsErr,
      );
    }
    variantBlocksById = new Map(
      (vrows ?? []).map((r) => {
        const row = r as { id: string; processing_time_blocks?: unknown };
        return [row.id, parseProcessingTimeBlocksFromDb(row.processing_time_blocks)];
      }),
    );
  }

  const existingBookings: AppointmentBooking[] = (bookingsRes.data ?? []).map((b) =>
    mapRowToAppointmentBooking({
      row: b as unknown as EngineBookingRow,
      serviceMap: serviceMapForBookings,
      practitionerServices,
      variantBlocksById,
    }),
  );

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
    ...leavePartialBlocks.map((b) => ({ ...b, kind: 'leave' as const })),
  ];

  /**
   * For each practitioner whose id also exists as a `unified_calendars` column, fold
   * scheduled classes and events on that column into the block list so appointments
   * cannot overlap them (mirror of the calendar-path behaviour above).
   */
  const sessionRangesByPractitioner = await Promise.all(
    practitioners.map((p) =>
      fetchScheduledSessionBlocksForCalendar(supabase, venueId, p.id, date, blockSources).then((ranges) => ({
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
        kind: 'scheduled_session',
      });
    }
  }

  const venueOpeningHours = venueRes.error
    ? null
    : ((venueRes.data?.opening_hours as OpeningHours | null) ?? null);

  const venueBlocks = (venueBlocksRes.data ?? []) as AvailabilityBlock[];



  return {
    date,
    practitioners,
    services,
    practitionerServices,
    existingBookings,
    practitionerBlockedRanges,
    venueOpeningHours,
    venueWideBlocks: venueBlocks,
    fullDayLeavePractitionerIds: fullDayLeaveIds,
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
    venueWideBlocks: null,
  });

  const { data: ucRow, error: ucErr } = await supabase
    .from('unified_calendars')
    .select('*')
    .eq('id', calendarId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (ucErr || !ucRow) {
    // A missing row is a legitimate answer (no such calendar); an error is not,
    // and produces an identical empty result. Only the error is worth an alert.
    if (ucErr) {
      reportAvailabilityReadFailure(
        {
          source: 'fetchCalendarAppointmentInput',
          table: 'unified_calendars',
          assumed: 'the calendar does not exist, so it offers nothing',
          venueId,
          calendarId,
          date,
        },
        ucErr,
      );
    }
    return empty();
  }

  let practitioner: Practitioner = unifiedCalendarRowToPractitioner(ucRow as Record<string, unknown>);

  const { data: assignments, error: assignmentsErr } = await supabase
    .from('calendar_service_assignments')
    .select('id, service_item_id, custom_duration_minutes, custom_price_pence')
    .eq('calendar_id', calendarId);

  if (assignmentsErr) {
    reportAvailabilityReadFailure(
      {
        source: 'fetchCalendarAppointmentInput',
        table: 'calendar_service_assignments',
        assumed: 'the calendar offers no services',
        venueId,
        calendarId,
        date,
      },
      assignmentsErr,
    );
  }

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

  const allServices: AppointmentService[] = (svcRows ?? []).map((raw) => {
    const s = raw as Record<string, unknown>;
    const a = assignMap.get(s.id as string) as
      | { custom_duration_minutes?: number | null; custom_price_pence?: number | null }
      | undefined;
    const customDur = a?.custom_duration_minutes;
    const customPrice = a?.custom_price_pence;
    const effectiveDuration = (customDur ?? s.duration_minutes) as number;
    /**
     * A calendar's `custom_duration_minutes` shortens the service without
     * touching its processing pattern, so the catalogue's blocks can fall
     * outside the duration this calendar actually books. Unfitted, they failed
     * validation downstream and were dropped wholesale, which silently held the
     * practitioner busy for the entire appointment and lost the parallel-booking
     * capacity the venue had deliberately configured. Trimming keeps as much of
     * the gap as still fits.
     */
    const fittedBlocks = fitProcessingBlocksToDuration(
      parseProcessingTimeBlocksFromDb(s.processing_time_blocks),
      effectiveDuration,
    ).blocks;
    return {
      id: s.id as string,
      venue_id: venueId,
      name: s.name as string,
      description: (s.description as string) ?? null,
      duration_minutes: effectiveDuration,
      buffer_minutes: (s.buffer_minutes as number) ?? 0,
      processing_time_minutes: (s.processing_time_minutes as number) ?? 0,
      processing_time_blocks: fittedBlocks,
      price_pence: (customPrice ?? s.price_pence) as number | null,
      payment_requirement: (s.payment_requirement as ClassPaymentRequirement | undefined) ?? undefined,
      deposit_pence: (s.deposit_pence as number | null) ?? null,
      colour: (s.colour as string) ?? '#3B82F6',
      is_active: true,
      sort_order: (s.sort_order as number) ?? 0,
      created_at: (s.created_at as string) ?? new Date().toISOString(),
      booking_interval_minutes: (s.booking_interval_minutes as number | undefined) ?? undefined,
      booking_minute_marks: (s.booking_minute_marks as number[] | null | undefined) ?? null,
      booking_start_times: (s.booking_start_times as string[] | null | undefined) ?? null,
      custom_availability_enabled: Boolean(s.custom_availability_enabled),
      custom_working_hours: parseCustomWorkingHoursFromDb(s.custom_working_hours),
    };
  });
  /**
   * Narrowed for SLOT GENERATION only. Existing bookings on this calendar can be
   * for any service, so their duration and buffer must resolve against the full
   * catalogue (see `serviceMapForBookings` below). Building that map from the
   * narrowed list left every neighbouring booking of a different service with
   * `buffer_minutes: 0` and a 30-minute default, which handed out slots that ran
   * straight into them. The legacy sibling keeps the same split deliberately.
   */
  const services = serviceId ? allServices.filter((s) => s.id === serviceId) : allServices;

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
      /**
       * Deliberately NOT carried: `custom_duration_minutes` is already baked
       * into `allServices[].duration_minutes` above. Carrying it here too made
       * `getOfferedAppointmentServicesForPractitioner` re-apply it on top of any
       * duration a caller had deliberately set, silently reverting a chosen
       * variant's length and any add-on minutes back to the override. The slot
       * was then validated for a shorter appointment than the one being booked.
       *
       * Callers that need to force a duration still set this on their own copy
       * (see `unified-availability.ts`), which keeps working because the merge
       * itself is unchanged.
       */
      custom_duration_minutes: null,
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
  let fullDayLeaveIdsForCalendar: string[] = [];
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
      // See the `days_off` note in `fetchAppointmentInput` (SA-M3).
      fullDayLeaveIdsForCalendar = [calendarId];
      const existing = Array.isArray(practitioner.days_off) ? [...practitioner.days_off] : [];
      if (!existing.includes(date)) existing.push(date);
      practitioner = { ...practitioner, days_off: existing };
    }
  }

  if (leaveErr) {
    reportAvailabilityReadFailure(
      {
        source: 'fetchCalendarAppointmentInput',
        table: 'practitioner_leave_periods',
        assumed: 'nobody is on leave',
        venueId,
        calendarId,
        date,
      },
      leaveErr,
    );
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
    supabase
      .from('venues')
      .select(`opening_hours, venue_opening_exceptions, ${VENUE_BOOKING_MODEL_COLUMNS}`)
      .eq('id', venueId)
      .single(),
    supabase
      .from('unified_calendars')
      .select('*')
      .eq('venue_id', venueId)
      .eq('calendar_type', 'resource')
      .eq('display_on_calendar_id', calendarId)
      .eq('is_active', true),
    supabase
      .from('availability_blocks')
      .select(VENUE_WIDE_BLOCK_SELECT)
      .eq('venue_id', venueId)
      .is('service_id', null)
      .in('block_type', ['closed', 'amended_hours', 'special_event'])
      .lte('date_start', date)
      .gte('date_end', date),
  ]);

  /** Same fail-open shape as `fetchAppointmentInput`; see the note there (SA-C3). */
  reportAvailabilityReadFailures(
    'fetchCalendarAppointmentInput',
    { venueId, calendarId, date },
    [
      { table: 'bookings', assumed: 'nothing is booked, so every slot is free', error: bookingsRes.error },
      { table: 'practitioner_calendar_blocks', assumed: 'the calendar has no blocked time', error: blocksRes.error },
      { table: 'calendar_blocks', assumed: 'the calendar has no blocked time', error: calBlocksRes.error },
      { table: 'venues.opening_hours', assumed: 'the venue has no opening hours to clip against', error: venueRes.error },
      { table: 'unified_calendars (sibling resources)', assumed: 'the calendar hosts no resources', error: siblingResourcesRes.error },
      { table: 'availability_blocks', assumed: 'the venue has no closures or amended hours', error: venueBlocksRes.error },
    ],
  );

  const serviceMapForBookings = new Map(allServices.map((s) => [s.id, s]));

  const calVariantIds = [
    ...new Set(
      (bookingsRes.data ?? [])
        .map((b) => (b as { service_variant_id?: string | null }).service_variant_id)
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  let calVariantBlocksById = new Map<string, ProcessingTimeBlock[]>();
  if (calVariantIds.length > 0) {
    const { data: calVrows, error: calVrowsErr } = await supabase
      .from('service_variants')
      .select('id, processing_time_blocks')
      .in('id', calVariantIds);
    if (calVrowsErr) {
      reportAvailabilityReadFailure(
        {
          source: 'fetchCalendarAppointmentInput',
          table: 'service_variants.processing_time_blocks',
          assumed: 'variants have no processing gaps, so fewer slots are offered',
          venueId,
          calendarId,
          date,
        },
        calVrowsErr,
      );
    }
    calVariantBlocksById = new Map(
      (calVrows ?? []).map((r) => {
        const row = r as { id: string; processing_time_blocks?: unknown };
        return [row.id, parseProcessingTimeBlocksFromDb(row.processing_time_blocks)];
      }),
    );
  }

  const existingBookings: AppointmentBooking[] = (bookingsRes.data ?? []).map((b) => {
    return mapRowToAppointmentBooking({
      row: b as unknown as EngineBookingRow,
      serviceMap: serviceMapForBookings,
      practitionerServices,
      variantBlocksById: calVariantBlocksById,
      forPractitionerId: calendarId,
    });
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

  /**
   * A model that is switched off must not block; see `blocked-range-models.ts`. The sibling
   * query above still runs because it shares the venue row's round-trip, but its windows are
   * dropped rather than folded in: with the resource model off they held time on a column
   * that drew nothing there, and the engine refused every appointment as "Blocked time".
   */
  const blockSources = blockSourcesFromVenueRow(venueRes.error ? null : venueRes.data);

  let resourceHostBlockRanges: PractitionerCalendarBlockedRange[] = [];
  if (blockSources.resources && !siblingResourcesRes.error && (siblingResourcesRes.data?.length ?? 0) > 0) {
    let siblings = (siblingResourcesRes.data ?? []).map((r) =>
      mapCalendarToResource(r as Record<string, unknown>),
    );
    siblings = await attachHostCalendarsToResources(supabase, venueId, siblings);
    const union = mergedResourceEffectiveRangesForHost(siblings, date);
    resourceHostBlockRanges = union.map((r) => ({
      practitioner_id: calendarId,
      start: r.start,
      end: r.end,
      kind: 'resource' as const,
    }));
  }

  /**
   * Scheduled classes and events render on this calendar column via the schedule feed,
   * not via `calendar_blocks`. Treat them as blocks so appointments cannot overlap a
   * class/event even before any tickets have been booked.
   */
  const sessionRanges = await fetchScheduledSessionBlocksForCalendar(
    supabase,
    venueId,
    calendarId,
    date,
    blockSources,
  );
  const scheduledSessionBlockRanges: PractitionerCalendarBlockedRange[] = sessionRanges.map((r) => ({
    practitioner_id: calendarId,
    start: r.start,
    end: r.end,
    kind: 'scheduled_session' as const,
  }));

  const practitionerBlockedRanges: PractitionerCalendarBlockedRange[] = [
    ...legacyBlockRanges,
    ...unifiedCalBlockRanges,
    ...resourceHostBlockRanges,
    ...scheduledSessionBlockRanges,
    ...leavePartialForCalendar.map((b) => ({ ...b, kind: 'leave' as const })),
  ];

  const venueOpeningHours = venueRes.error
    ? null
    : ((venueRes.data?.opening_hours as OpeningHours | null) ?? null);

  const calVenueBlocks = (venueBlocksRes.data ?? []) as AvailabilityBlock[];


  return {
    date,
    practitioners: [practitioner],
    services,
    practitionerServices,
    existingBookings,
    practitionerBlockedRanges,
    venueOpeningHours,
    venueWideBlocks: calVenueBlocks,
    fullDayLeavePractitionerIds: fullDayLeaveIdsForCalendar,
  };
}
