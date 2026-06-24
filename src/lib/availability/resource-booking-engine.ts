/**
 * Model E: Resource / facility booking availability engine.
 * Given resources + their availability hours + existing bookings,
 * returns available start times per resource for a requested duration.
 *
 * Resources are stored in `unified_calendars` with `calendar_type = 'resource'`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AvailabilityBlock, OpeningHours } from '@/types/availability';
import type { ClassPaymentRequirement, VenueResource, WorkingHours } from '@/types/booking-models';
import { timeToMinutes, minutesToTime } from '@/lib/availability';
import { CAPACITY_CONSUMING_STATUSES, isCapacityConsumingStatus } from '@/lib/availability/capacity-status';
import { bookingRowEndMinutes, unionMinuteRanges } from '@/lib/availability/calendar-resource-occupancy';
import {
  resolveVenueWideAllowedMinuteRanges,
  intersectRangesWithVenueWideResolution,
} from '@/lib/availability/venue-wide-business-hours';
import {
  rowsToVenueWideBlocks,
  venueWideBlocksQueryForDate,
  venueWideBlocksQueryForRange,
} from '@/lib/availability/venue-wide-blocks-fetch';
import { sameDaySlotCutoffForBookingDate } from '@/lib/venue/venue-local-clock';
import { entityBookingWindowFromRow, isGuestBookingDateAllowed } from '@/lib/booking/entity-booking-window';
import {
  DEFAULT_RESOURCE_MIN_BOOKING_MINUTES,
  DEFAULT_RESOURCE_SLOT_INTERVAL_MINUTES,
} from '@/lib/booking/resource-booking-defaults';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResourceEngineInput {
  date: string;
  resources: VenueResource[];
  existingBookings: ResourceBooking[];
  /**
   * When set (from fetchResourceInput), per-resource bookable minute ranges after host/sibling conflict rules.
   * If absent, computeResourceAvailability derives ranges from each resource row.
   */
  effectiveAvailabilityRangesByResourceId?: Map<string, Array<{ start: number; end: number }>>;
  /**
   * When the booking `date` is "today" in the venue timezone, slots with start minute t where
   * t <= minutesNow are excluded so guests cannot book times that have already passed.
   */
  sameDaySlotCutoff?: { venueDateYmd: string; minutesNow: number };
}

export interface ResourceBooking {
  id: string;
  resource_id: string;
  booking_time: string;     // "HH:mm"
  booking_end_time: string; // "HH:mm"
  status: string;
}

export interface ResourceSlot {
  resource_id: string;
  resource_name: string;
  start_time: string; // "HH:mm"
  price_per_slot_pence: number | null;
}

export interface ResourceAvailabilityResult {
  id: string;
  name: string;
  resource_type: string | null;
  min_booking_minutes: number;
  max_booking_minutes: number;
  slot_interval_minutes: number;
  price_per_slot_pence: number | null;
  payment_requirement: ClassPaymentRequirement;
  deposit_amount_pence: number | null;
  cancellation_notice_hours: number;
  slots: ResourceSlot[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Statuses that consume resource capacity (must match bookings query in fetchResourceInput). */
export const RESOURCE_BOOKING_CAPACITY_STATUSES = CAPACITY_CONSUMING_STATUSES;

function dayKeyForDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return String(dow);
}

function dayNameForDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return DAY_NAMES[dow]!;
}

function getAvailabilityRanges(hours: WorkingHours, dateStr: string): Array<{ start: number; end: number }> {
  const dayKey = dayKeyForDate(dateStr);
  const dayName = dayNameForDate(dateStr);
  const ranges = hours[dayKey] ?? hours[dayName];
  if (!ranges || ranges.length === 0) return [];
  return ranges.map((r) => ({ start: timeToMinutes(r.start), end: timeToMinutes(r.end) }));
}

/** Working hours + days_off for the host calendar column (same key rules as resource availability). */
function getHostCalendarRanges(
  host: { working_hours: WorkingHours; days_off: string[] },
  dateStr: string,
): Array<{ start: number; end: number }> {
  const dayName = dayNameForDate(dateStr);
  if (Array.isArray(host.days_off)) {
    for (const d of host.days_off) {
      if (d === dateStr || d === dayName) return [];
    }
  }
  return getAvailabilityRanges(host.working_hours, dateStr);
}

function intersectRanges(
  a: Array<{ start: number; end: number }>,
  b: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (const x of a) {
    for (const y of b) {
      const s = Math.max(x.start, y.start);
      const e = Math.min(x.end, y.end);
      if (s < e) out.push({ start: s, end: e });
    }
  }
  return out;
}

/** Same rules as appointment `getBreakRanges` for a host calendar row. */
function getHostBreakRanges(
  host: {
    break_times: Array<{ start: string; end: string }>;
    break_times_by_day: WorkingHours | null | undefined;
  },
  dateStr: string,
): Array<{ start: number; end: number }> {
  const byDay = host.break_times_by_day;
  if (byDay && typeof byDay === 'object' && !Array.isArray(byDay) && Object.keys(byDay).length > 0) {
    const dayKey = dayKeyForDate(dateStr);
    const dayName = dayNameForDate(dateStr);
    const ranges = byDay[dayKey] ?? byDay[dayName];
    if (!ranges || !Array.isArray(ranges) || ranges.length === 0) return [];
    return ranges.map((b) => ({ start: timeToMinutes(b.start), end: timeToMinutes(b.end) }));
  }

  const breaks = host.break_times;
  if (!Array.isArray(breaks)) return [];
  return breaks.map((b) => ({ start: timeToMinutes(b.start), end: timeToMinutes(b.end) }));
}

function subtractOneRange(
  r: { start: number; end: number },
  cut: { start: number; end: number },
): Array<{ start: number; end: number }> {
  if (cut.end <= r.start || cut.start >= r.end) return [r];
  const out: Array<{ start: number; end: number }> = [];
  if (cut.start > r.start) {
    const segEnd = Math.min(cut.start, r.end);
    if (segEnd > r.start) out.push({ start: r.start, end: segEnd });
  }
  if (cut.end < r.end) {
    const segStart = Math.max(cut.end, r.start);
    if (r.end > segStart) out.push({ start: segStart, end: r.end });
  }
  return out;
}

function subtractRangesFromRanges(
  ranges: Array<{ start: number; end: number }>,
  toRemove: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  let result = ranges.filter((r) => r.end > r.start);
  for (const cut of toRemove) {
    if (cut.end <= cut.start) continue;
    const next: Array<{ start: number; end: number }> = [];
    for (const r of result) {
      next.push(...subtractOneRange(r, cut));
    }
    result = next;
  }
  return result;
}

/** Resource row only: exceptions and `availability_hours` (unified `working_hours` on resource). */
function getBaseResourceAvailabilityRanges(
  resource: VenueResource,
  dateStr: string,
): Array<{ start: number; end: number }> {
  const raw = resource.availability_exceptions;
  const ex = raw?.[dateStr];
  if (ex && 'closed' in ex && ex.closed === true) {
    return [];
  }
  if (ex && 'periods' in ex && Array.isArray(ex.periods) && ex.periods.length > 0) {
    return ex.periods.map((r) => ({ start: timeToMinutes(r.start), end: timeToMinutes(r.end) }));
  }
  return getAvailabilityRanges(resource.availability_hours, dateStr);
}

/**
 * Bookable windows for the resource on this date: resource row hours, intersected with the host
 * calendar column when `display_on_calendar_id` is set; host breaks are then carved out.
 */
export function getEffectiveAvailabilityRanges(
  resource: VenueResource,
  dateStr: string,
): Array<{ start: number; end: number }> {
  const base = getBaseResourceAvailabilityRanges(resource, dateStr);
  if (!resource.display_on_calendar_id) return base;
  if (!resource.host_calendar) {
    return [];
  }
  const hostRanges = getHostCalendarRanges(resource.host_calendar, dateStr);
  let intersected = intersectRanges(base, hostRanges);
  const hostBreaks = getHostBreakRanges(resource.host_calendar, dateStr);
  if (hostBreaks.length > 0) {
    intersected = subtractRangesFromRanges(intersected, hostBreaks);
  }
  return intersected;
}

function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}

/** Union of effective ranges for sibling resources on the same host, excluding one id. */
function mergedSiblingResourceRangesExcluding(
  siblingsOnHost: VenueResource[],
  excludeResourceId: string,
  dateStr: string,
): Array<{ start: number; end: number }> {
  const others = siblingsOnHost.filter((r) => r.id !== excludeResourceId);
  const all: Array<{ start: number; end: number }> = [];
  for (const r of others) {
    all.push(...getEffectiveAvailabilityRanges(r, dateStr));
  }
  return unionMinuteRanges(all);
}

/**
 * Union of effective bookable windows for resources attached to the same host column (same date).
 */
export function mergedResourceEffectiveRangesForHost(
  resourcesOnHost: VenueResource[],
  dateStr: string,
): Array<{ start: number; end: number }> {
  const all: Array<{ start: number; end: number }> = [];
  for (const r of resourcesOnHost) {
    all.push(...getEffectiveAvailabilityRanges(r, dateStr));
  }
  return unionMinuteRanges(all);
}

/** Earliest bookable start minute on the venue-local calendar day (same-day + min notice). Returns null when same-day is disabled. */
function earliestGuestSlotStartMinute(
  resource: VenueResource,
  date: string,
  sameDaySlotCutoff: { venueDateYmd: string; minutesNow: number } | undefined,
): number | null {
  if (!sameDaySlotCutoff || date !== sameDaySlotCutoff.venueDateYmd) return null;
  const win = entityBookingWindowFromRow(resource as unknown as Record<string, unknown>);
  if (!win.allow_same_day_booking) return null;
  return sameDaySlotCutoff.minutesNow + Math.max(0, win.min_booking_notice_hours) * 60;
}

function resourceDateAllowedForGuestBooking(
  resource: VenueResource,
  date: string,
  venueTimezone: string,
): boolean {
  const win = entityBookingWindowFromRow(resource as unknown as Record<string, unknown>);
  return isGuestBookingDateAllowed(date, win, venueTimezone);
}

/** True if this start time is today in the venue TZ and not strictly after "now" (minute precision). */
export function isResourceBookingStartInPast(
  bookingDateYmd: string,
  bookingTimeHhMm: string,
  venueTimezone: string,
  at: Date = new Date(),
): boolean {
  const cutoff = sameDaySlotCutoffForBookingDate(bookingDateYmd, venueTimezone, at);
  if (!cutoff) return false;
  const startM = timeToMinutes(bookingTimeHhMm.slice(0, 5));
  return startM <= cutoff.minutesNow;
}

export function computeResourceAvailability(
  input: ResourceEngineInput,
  requestedDurationMinutes: number,
): ResourceAvailabilityResult[] {
  const { date, resources, existingBookings, effectiveAvailabilityRangesByResourceId, sameDaySlotCutoff } =
    input;
  const results: ResourceAvailabilityResult[] = [];

  for (const resource of resources) {
    if (!resource.is_active) continue;

    const duration = Math.max(
      resource.min_booking_minutes,
      Math.min(requestedDurationMinutes, resource.max_booking_minutes),
    );

    const ranges =
      effectiveAvailabilityRangesByResourceId?.get(resource.id) ??
      getEffectiveAvailabilityRanges(resource, date);
    if (ranges.length === 0) continue;

    const earliestStart = earliestGuestSlotStartMinute(resource, date, sameDaySlotCutoff);
    if (sameDaySlotCutoff && date === sameDaySlotCutoff.venueDateYmd && earliestStart === null) {
      continue;
    }

    const resourceBookings = existingBookings.filter(
      (b) => b.resource_id === resource.id && isCapacityConsumingStatus(b.status)
    );

    const slots: ResourceSlot[] = [];

    for (const range of ranges) {
      for (let t = range.start; t + duration <= range.end; t += resource.slot_interval_minutes) {
        if (
          sameDaySlotCutoff &&
          date === sameDaySlotCutoff.venueDateYmd &&
          t <= sameDaySlotCutoff.minutesNow
        ) {
          continue;
        }
        if (earliestStart != null && t < earliestStart) {
          continue;
        }

        const slotEnd = t + duration;

        const conflict = resourceBookings.some((b) => {
          const bStart = timeToMinutes(b.booking_time);
          const bEnd = timeToMinutes(b.booking_end_time);
          return overlaps(t, slotEnd, bStart, bEnd);
        });

        if (!conflict) {
          slots.push({
            resource_id: resource.id,
            resource_name: resource.name,
            start_time: minutesToTime(t),
            price_per_slot_pence: resource.price_per_slot_pence,
          });
        }
      }
    }

    results.push({
      id: resource.id,
      name: resource.name,
      resource_type: resource.resource_type,
      min_booking_minutes: resource.min_booking_minutes,
      max_booking_minutes: resource.max_booking_minutes,
      slot_interval_minutes: resource.slot_interval_minutes,
      price_per_slot_pence: resource.price_per_slot_pence,
      payment_requirement: resource.payment_requirement,
      deposit_amount_pence: resource.deposit_amount_pence,
      cancellation_notice_hours: entityBookingWindowFromRow(resource as unknown as Record<string, unknown>).cancellation_notice_hours,
      slots,
    });
  }

  return results;
}

/**
 * True if the resource has at least one non-conflicting slot for any of the given duration candidates
 * (same rules as {@link computeResourceAvailability} for one resource). Used for month "any duration"
 * scans without calling {@link computeResourceAvailability} once per duration.
 */
export function resourceHasAvailabilityForAnyDurationCandidate(
  input: ResourceEngineInput,
  resourceId: string,
  durationCandidatesMinutes: number[],
): boolean {
  const resource = input.resources.find((r) => r.id === resourceId);
  if (!resource?.is_active) return false;

  const ranges =
    input.effectiveAvailabilityRangesByResourceId?.get(resource.id) ??
    getEffectiveAvailabilityRanges(resource, input.date);
  if (ranges.length === 0) return false;

  const earliestStart = earliestGuestSlotStartMinute(resource, input.date, input.sameDaySlotCutoff);
  if (
    input.sameDaySlotCutoff &&
    input.date === input.sameDaySlotCutoff.venueDateYmd &&
    earliestStart === null
  ) {
    return false;
  }

  const resourceBookings = input.existingBookings.filter(
    (b) => b.resource_id === resource.id && isCapacityConsumingStatus(b.status),
  );

  const { sameDaySlotCutoff } = input;

  for (const range of ranges) {
    for (let t = range.start; t < range.end; t += resource.slot_interval_minutes) {
      if (
        sameDaySlotCutoff &&
        input.date === sameDaySlotCutoff.venueDateYmd &&
        t <= sameDaySlotCutoff.minutesNow
      ) {
        continue;
      }
      if (earliestStart != null && t < earliestStart) {
        continue;
      }

      for (const durRaw of durationCandidatesMinutes) {
        const duration = Math.max(
          resource.min_booking_minutes,
          Math.min(durRaw, resource.max_booking_minutes),
        );
        if (t + duration > range.end) continue;

        const slotEnd = t + duration;
        const conflict = resourceBookings.some((b) => {
          const bStart = timeToMinutes(b.booking_time);
          const bEnd = timeToMinutes(b.booking_end_time);
          return overlaps(t, slotEnd, bStart, bEnd);
        });

        if (!conflict) return true;
      }
    }
  }
  return false;
}

/** Booking lengths (minutes) allowed for this resource: multiples of the slot interval within min/max. */
export function resourceDurationCandidatesMinutes(
  resource: Pick<VenueResource, 'min_booking_minutes' | 'max_booking_minutes' | 'slot_interval_minutes'>,
): number[] {
  const step = Math.max(1, resource.slot_interval_minutes);
  const minB = resource.min_booking_minutes;
  const maxB = resource.max_booking_minutes;
  const out: number[] = [];
  let d = Math.ceil(minB / step) * step;
  for (; d <= maxB; d += step) {
    out.push(d);
  }
  if (out.length === 0) {
    const fallback = Math.min(maxB, Math.max(minB, step));
    out.push(fallback);
  }
  return out;
}

/**
 * Assembles the same {@link ResourceEngineInput} as {@link fetchResourceInput} for one date,
 * from pre-fetched rows (used to avoid dozens of DB round-trips per calendar month).
 */
function resolveVenueTimezone(row: { timezone?: unknown } | null | undefined): string {
  const t = row?.timezone;
  return typeof t === 'string' && t.trim() !== '' ? t.trim() : 'Europe/London';
}

function filterResourceBookingsForDate(
  bookingsForDate: Record<string, unknown>[],
  excludeBookingId?: string,
): Record<string, unknown>[] {
  if (!excludeBookingId) return bookingsForDate;
  const lc = excludeBookingId.toLowerCase();
  return bookingsForDate.filter((row) => String(row.id).toLowerCase() !== lc);
}

function buildResourceEngineInputFromParts(params: {
  date: string;
  resources: VenueResource[];
  conflictResources: VenueResource[];
  bookingsForDate: Record<string, unknown>[];
  venueOpeningHours: OpeningHours | null;
  venueWideBlocks: AvailabilityBlock[];
  venueTimezone?: string;
  excludeBookingId?: string;
  skipPastSlotFilter?: boolean;
}): ResourceEngineInput {
  const {
    date,
    resources,
    conflictResources,
    bookingsForDate,
    venueOpeningHours,
    venueWideBlocks,
    venueTimezone,
    excludeBookingId,
    skipPastSlotFilter,
  } = params;
  const filteredBookingsForDate = filterResourceBookingsForDate(bookingsForDate, excludeBookingId);

  const resourceIdSet = new Set(resources.map((r) => r.id));

  const existingBookings: ResourceBooking[] = filteredBookingsForDate
    .filter((b) => {
      const rid = b.resource_id as string | null;
      const cid = b.calendar_id as string | null;
      return (rid && resourceIdSet.has(rid)) || (cid && resourceIdSet.has(cid));
    })
    .map((row) => {
      const rid = (row.resource_id as string | null) ?? (row.calendar_id as string | null) ?? '';
      return {
        id: row.id as string,
        resource_id: rid,
        booking_time: ((row.booking_time as string) ?? '00:00').slice(0, 5),
        booking_end_time: ((row.booking_end_time as string) ?? '00:00').slice(0, 5),
        status: row.status as string,
      };
    });

  const resourcesByHost = new Map<string, VenueResource[]>();
  for (const r of conflictResources) {
    const h = r.display_on_calendar_id;
    if (!h) continue;
    const list = resourcesByHost.get(h) ?? [];
    list.push(r);
    resourcesByHost.set(h, list);
  }

  const occupancyByHost = new Map<string, Array<{ start: number; end: number }>>();
  const hostIds = [...resourcesByHost.keys()];
  const dayRows = bookingsForDate;

  for (const hostId of hostIds) {
    const occ: Array<{ start: number; end: number }> = [];
    for (const raw of dayRows) {
      const row = raw;
      if (row.resource_id) continue;
      const cal = row.calendar_id as string | null | undefined;
      const pid = row.practitioner_id as string | null | undefined;
      if (cal !== hostId && pid !== hostId) continue;
      const bt = row.booking_time as string;
      const start = timeToMinutes(String(bt).slice(0, 5));
      const end = bookingRowEndMinutes({
        booking_time: String(bt).slice(0, 5),
        booking_end_time: (row.booking_end_time as string | null) ?? null,
        estimated_end_time: (row.estimated_end_time as string | null) ?? null,
      });
      if (end > start) occ.push({ start, end });
    }
    occupancyByHost.set(hostId, unionMinuteRanges(occ));
  }

  const venueWideResolution = resolveVenueWideAllowedMinuteRanges(venueOpeningHours, date, venueWideBlocks);

  const effectiveAvailabilityRangesByResourceId = new Map<string, Array<{ start: number; end: number }>>();
  for (const res of resources) {
    let ranges = getEffectiveAvailabilityRanges(res, date);
    const hostId = res.display_on_calendar_id;
    if (hostId) {
      ranges = subtractRangesFromRanges(ranges, occupancyByHost.get(hostId) ?? []);
      const siblings = resourcesByHost.get(hostId) ?? [];
      const siblingExcl = mergedSiblingResourceRangesExcluding(siblings, res.id, date);
      ranges = subtractRangesFromRanges(ranges, siblingExcl);
    }
    ranges = intersectRangesWithVenueWideResolution(ranges, venueWideResolution);
    effectiveAvailabilityRangesByResourceId.set(res.id, ranges);
  }

  const tz = venueTimezone ?? 'Europe/London';
  const sameDaySlotCutoff = skipPastSlotFilter ? undefined : sameDaySlotCutoffForBookingDate(date, tz);

  return {
    date,
    resources,
    existingBookings,
    effectiveAvailabilityRangesByResourceId,
    ...(sameDaySlotCutoff ? { sameDaySlotCutoff } : {}),
  };
}

/** Merge sibling resources on the same host column (same rules as fetchResourceInput). */
async function expandResourcesWithSiblings(
  supabase: SupabaseClient,
  venueId: string,
  resources: VenueResource[],
): Promise<VenueResource[]> {
  const hostIdsForSiblings = [...new Set(resources.map((r) => r.display_on_calendar_id).filter(Boolean))] as string[];
  let conflictResources = resources;
  if (hostIdsForSiblings.length === 0) {
    return conflictResources;
  }

  const { data: sibRows, error: sibErr } = await supabase
    .from('unified_calendars')
    .select('*')
    .eq('venue_id', venueId)
    .eq('calendar_type', 'resource')
    .eq('is_active', true)
    .in('display_on_calendar_id', hostIdsForSiblings);
  if (sibErr) {
    console.warn('[expandResourcesWithSiblings] sibling resources:', sibErr.message);
  }
  const byId = new Map(resources.map((r) => [r.id, r] as const));
  for (const row of sibRows ?? []) {
    const r = mapCalendarToResource(row as Record<string, unknown>);
    if (!byId.has(r.id)) byId.set(r.id, r);
  }
  conflictResources = [...byId.values()];
  return attachHostCalendarsToResources(supabase, venueId, conflictResources);
}

export interface PrefetchResourceMonthOptions {
  /**
   * When true, skip re-fetching `unified_calendars` for this resource and use `resource` as-is
   * (caller must already have run {@link attachHostCalendarsToResources}). Avoids duplicate DB work
   * when the route already loaded the row.
   */
  reuseEnrichedResourceRow?: boolean;
  /** When modifying a booking, exclude it from capacity so its current slot stays selectable. */
  excludeBookingId?: string;
  /** Staff modify: allow today's past start times and skip guest notice cutoff. */
  skipPastSlotFilter?: boolean;
}

/**
 * One batch of DB reads for a resource calendar month (vs one fetchResourceInput per day).
 */
async function prefetchResourceMonthForAvailability(
  supabase: SupabaseClient,
  venueId: string,
  resource: VenueResource,
  year: number,
  month: number,
  options?: PrefetchResourceMonthOptions,
): Promise<{
  resources: VenueResource[];
  conflictResources: VenueResource[];
  venueOpeningHours: OpeningHours | null;
  venueWideBlocks: AvailabilityBlock[];
  bookingsByDate: Map<string, Record<string, unknown>[]>;
  venueTimezone: string;
}> {
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  const monthStart = `${year}-${pad(month)}-01`;
  const monthEnd = `${year}-${pad(month)}-${pad(lastDay)}`;

  let resources: VenueResource[];
  if (options?.reuseEnrichedResourceRow) {
    resources = [resource];
  } else {
    const resourcesRes = await supabase
      .from('unified_calendars')
      .select('*')
      .eq('venue_id', venueId)
      .eq('calendar_type', 'resource')
      .eq('is_active', true)
      .eq('id', resource.id)
      .order('sort_order');

    resources = (resourcesRes.data ?? []).map((r) => mapCalendarToResource(r as Record<string, unknown>));
    resources = await attachHostCalendarsToResources(supabase, venueId, resources);
  }
  const conflictResources = await expandResourcesWithSiblings(supabase, venueId, resources);

  const [venueRes, blocksRes, bookingsRes] = await Promise.all([
    supabase.from('venues').select('opening_hours, timezone').eq('id', venueId).maybeSingle(),
    venueWideBlocksQueryForRange(supabase, venueId, monthStart, monthEnd),
    supabase
      .from('bookings')
      .select(
        'id, booking_date, resource_id, calendar_id, booking_time, booking_end_time, estimated_end_time, status, practitioner_id',
      )
      .eq('venue_id', venueId)
      .gte('booking_date', monthStart)
      .lte('booking_date', monthEnd)
      .in('status', CAPACITY_CONSUMING_STATUSES),
  ]);

  if (blocksRes.error) {
    console.warn('[prefetchResourceMonthForAvailability] availability_blocks:', blocksRes.error.message);
  }

  const excludeLc = options?.excludeBookingId?.toLowerCase();
  const bookingsByDate = new Map<string, Record<string, unknown>[]>();
  for (const raw of bookingsRes.data ?? []) {
    const row = raw as Record<string, unknown>;
    if (excludeLc && String(row.id).toLowerCase() === excludeLc) {
      continue;
    }
    const bd = row.booking_date as string;
    const list = bookingsByDate.get(bd) ?? [];
    list.push(row);
    bookingsByDate.set(bd, list);
  }

  return {
    resources,
    conflictResources,
    venueOpeningHours: (venueRes.data?.opening_hours as OpeningHours | null) ?? null,
    venueWideBlocks: rowsToVenueWideBlocks(blocksRes.data),
    bookingsByDate,
    venueTimezone: resolveVenueTimezone(venueRes.data),
  };
}

/**
 * Dates in the given month (YYYY-MM-DD) where the resource has at least one bookable slot
 * for the requested duration (after min/max clamping inside the engine).
 * Batches DB reads for the month then evaluates each day in memory (same rules as single-day availability).
 */
export async function computeResourceAvailableDatesInMonth(
  supabase: SupabaseClient,
  venueId: string,
  resource: VenueResource,
  year: number,
  month: number,
  durationMinutes: number,
  prefetchOptions?: PrefetchResourceMonthOptions,
): Promise<string[]> {
  const pad = (n: number) => String(n).padStart(2, '0');
  const out: string[] = [];
  const lastDay = new Date(year, month, 0).getDate();

  const prefetch = await prefetchResourceMonthForAvailability(
    supabase,
    venueId,
    resource,
    year,
    month,
    prefetchOptions,
  );

  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${year}-${pad(month)}-${pad(d)}`;
    if (!resourceDateAllowedForGuestBooking(resource, dateStr, prefetch.venueTimezone)) {
      continue;
    }
    const input = buildResourceEngineInputFromParts({
      date: dateStr,
      resources: prefetch.resources,
      conflictResources: prefetch.conflictResources,
      bookingsForDate: prefetch.bookingsByDate.get(dateStr) ?? [],
      venueOpeningHours: prefetch.venueOpeningHours,
      venueWideBlocks: prefetch.venueWideBlocks,
      venueTimezone: prefetch.venueTimezone,
      excludeBookingId: prefetchOptions?.excludeBookingId,
      skipPastSlotFilter: prefetchOptions?.skipPastSlotFilter,
    });
    const results = computeResourceAvailability(input, durationMinutes);
    const row = results.find((r) => r.id === resource.id);
    if (row && row.slots.length > 0) out.push(dateStr);
  }
  return out;
}

/**
 * Dates in the month where at least one allowed duration (slot-interval multiples) has a bookable slot.
 * Used when the user picks a date before choosing duration.
 */
export async function computeResourceAvailableDatesInMonthAnyDuration(
  supabase: SupabaseClient,
  venueId: string,
  resource: VenueResource,
  year: number,
  month: number,
  prefetchOptions?: PrefetchResourceMonthOptions,
): Promise<string[]> {
  const durations = resourceDurationCandidatesMinutes(resource);
  const pad = (n: number) => String(n).padStart(2, '0');
  const out: string[] = [];
  const lastDay = new Date(year, month, 0).getDate();

  const tPrefetch0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const prefetch = await prefetchResourceMonthForAvailability(
    supabase,
    venueId,
    resource,
    year,
    month,
    prefetchOptions,
  );
  const prefetchMs = typeof performance !== 'undefined' ? performance.now() - tPrefetch0 : 0;

  const tLoop0 = typeof performance !== 'undefined' ? performance.now() : 0;
  for (let day = 1; day <= lastDay; day++) {
    const dateStr = `${year}-${pad(month)}-${pad(day)}`;
    if (!resourceDateAllowedForGuestBooking(resource, dateStr, prefetch.venueTimezone)) {
      continue;
    }
    const input = buildResourceEngineInputFromParts({
      date: dateStr,
      resources: prefetch.resources,
      conflictResources: prefetch.conflictResources,
      bookingsForDate: prefetch.bookingsByDate.get(dateStr) ?? [],
      venueOpeningHours: prefetch.venueOpeningHours,
      venueWideBlocks: prefetch.venueWideBlocks,
      venueTimezone: prefetch.venueTimezone,
      excludeBookingId: prefetchOptions?.excludeBookingId,
      skipPastSlotFilter: prefetchOptions?.skipPastSlotFilter,
    });
    if (resourceHasAvailabilityForAnyDurationCandidate(input, resource.id, durations)) {
      out.push(dateStr);
    }
  }
  const loopMs = typeof performance !== 'undefined' ? performance.now() - tLoop0 : 0;

  if (process.env.DEBUG_RESOURCE_CALENDAR_TIMING === '1') {
    console.info('[computeResourceAvailableDatesInMonthAnyDuration]', {
      resourceId: resource.id,
      year,
      month,
      prefetchMs: Math.round(prefetchMs * 100) / 100,
      dayLoopMs: Math.round(loopMs * 100) / 100,
      daysEvaluated: lastDay,
    });
  }

  return out;
}

/**
 * Load bookings for one resource across a calendar month, grouped by booking_date.
 */
export async function fetchBookingsGroupedByDateForResourceMonth(
  supabase: SupabaseClient,
  venueId: string,
  resourceId: string,
  year: number,
  month: number,
): Promise<Map<string, ResourceBooking[]>> {
  const pad = (n: number) => String(n).padStart(2, '0');
  const monthStart = `${year}-${pad(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${pad(month)}-${pad(lastDay)}`;

  const { data } = await supabase
    .from('bookings')
    .select('id, resource_id, calendar_id, booking_time, booking_end_time, status, booking_date')
    .eq('venue_id', venueId)
    .gte('booking_date', monthStart)
    .lte('booking_date', monthEnd)
    .or(`resource_id.eq.${resourceId},calendar_id.eq.${resourceId}`)
    .in('status', [...RESOURCE_BOOKING_CAPACITY_STATUSES]);

  const map = new Map<string, ResourceBooking[]>();
  for (const raw of data ?? []) {
    const b = raw as Record<string, unknown>;
    const bd = b.booking_date as string;
    const rid = (b.resource_id as string | null) ?? (b.calendar_id as string | null) ?? '';
    const rb: ResourceBooking = {
      id: b.id as string,
      resource_id: rid,
      booking_time: ((b.booking_time as string) ?? '00:00').slice(0, 5),
      booking_end_time: ((b.booking_end_time as string) ?? '00:00').slice(0, 5),
      status: b.status as string,
    };
    const list = map.get(bd) ?? [];
    list.push(rb);
    map.set(bd, list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Fetcher — reads from unified_calendars (calendar_type='resource')
// ---------------------------------------------------------------------------

/** Map a unified_calendars row to the VenueResource shape the engine expects. */
export function mapCalendarToResource(row: Record<string, unknown>): VenueResource {
  const payReq = row.payment_requirement as ClassPaymentRequirement | null | undefined;
  const win = entityBookingWindowFromRow(row);
  return {
    id: row.id as string,
    venue_id: row.venue_id as string,
    name: row.name as string,
    resource_type: (row.resource_type as string | null) ?? null,
    min_booking_minutes: (row.min_booking_minutes as number | null) ?? DEFAULT_RESOURCE_MIN_BOOKING_MINUTES,
    max_booking_minutes: (row.max_booking_minutes as number | null) ?? 180,
    slot_interval_minutes: (row.slot_interval_minutes as number | null) ?? DEFAULT_RESOURCE_SLOT_INTERVAL_MINUTES,
    price_per_slot_pence: (row.price_per_slot_pence as number | null) ?? null,
    payment_requirement: payReq ?? 'none',
    deposit_amount_pence: (row.deposit_amount_pence as number | null) ?? null,
    cancellation_notice_hours: win.cancellation_notice_hours,
    max_advance_booking_days: win.max_advance_booking_days,
    min_booking_notice_hours: win.min_booking_notice_hours,
    allow_same_day_booking: win.allow_same_day_booking,
    availability_hours: (row.working_hours as WorkingHours) ?? {},
    availability_exceptions: (row.availability_exceptions as VenueResource['availability_exceptions']) ?? undefined,
    is_active: (row.is_active as boolean | null) ?? true,
    sort_order: (row.sort_order as number | null) ?? 0,
    created_at: (row.created_at as string) ?? '',
    display_on_calendar_id: (row.display_on_calendar_id as string | null | undefined) ?? null,
    host_calendar: undefined,
  };
}

/**
 * Loads host `unified_calendars` rows and attaches `host_calendar` for resource availability intersection.
 */
export async function attachHostCalendarsToResources(
  supabase: SupabaseClient,
  venueId: string,
  resources: VenueResource[],
): Promise<VenueResource[]> {
  const ids = [...new Set(resources.map((r) => r.display_on_calendar_id).filter(Boolean))] as string[];
  if (ids.length === 0) {
    return resources.map((r) => ({ ...r, host_calendar: null }));
  }

  const { data, error } = await supabase
    .from('unified_calendars')
    .select('id, working_hours, days_off, break_times, break_times_by_day')
    .eq('venue_id', venueId)
    .in('id', ids);

  if (error) {
    console.warn('[attachHostCalendarsToResources] unified_calendars:', error.message);
  }

  const map = new Map(
    (data ?? []).map((row) => {
      const id = row.id as string;
      const breakTimes = row.break_times;
      const byDay = row.break_times_by_day;
      return [
        id,
        {
          id,
          working_hours: (row.working_hours as WorkingHours) ?? {},
          days_off: Array.isArray(row.days_off) ? (row.days_off as string[]) : [],
          break_times: Array.isArray(breakTimes)
            ? (breakTimes as Array<{ start: string; end: string }>)
            : [],
          break_times_by_day:
            byDay && typeof byDay === 'object' && !Array.isArray(byDay)
              ? (byDay as WorkingHours)
              : null,
        },
      ] as const;
    }),
  );

  return resources.map((r) => {
    if (!r.display_on_calendar_id) {
      return { ...r, host_calendar: null };
    }
    const host = map.get(r.display_on_calendar_id);
    return { ...r, host_calendar: host ?? null };
  });
}

export async function fetchResourceInput(params: {
  supabase: SupabaseClient;
  venueId: string;
  date: string;
  resourceId?: string;
  excludeBookingId?: string;
  skipPastSlotFilter?: boolean;
}): Promise<ResourceEngineInput> {
  const { supabase, venueId, date, resourceId, excludeBookingId, skipPastSlotFilter } = params;

  let resourcesQuery = supabase
    .from('unified_calendars')
    .select('*')
    .eq('venue_id', venueId)
    .eq('calendar_type', 'resource')
    .eq('is_active', true)
    .order('sort_order');
  if (resourceId) {
    resourcesQuery = resourcesQuery.eq('id', resourceId);
  }

  const [resourcesRes, bookingsRes, venueRes, venueBlocksRes] = await Promise.all([
    resourcesQuery,
    supabase
      .from('bookings')
      .select(
        'id, booking_date, resource_id, calendar_id, booking_time, booking_end_time, estimated_end_time, status, practitioner_id',
      )
      .eq('venue_id', venueId)
      .eq('booking_date', date)
      .in('status', CAPACITY_CONSUMING_STATUSES),
    supabase.from('venues').select('opening_hours, timezone').eq('id', venueId).maybeSingle(),
    venueWideBlocksQueryForDate(supabase, venueId, date),
  ]);

  let resources = (resourcesRes.data ?? []).map((r) => mapCalendarToResource(r as Record<string, unknown>));
  resources = await attachHostCalendarsToResources(supabase, venueId, resources);
  const conflictResources = await expandResourcesWithSiblings(supabase, venueId, resources);

  if (venueBlocksRes.error) {
    console.warn('[fetchResourceInput] availability_blocks:', venueBlocksRes.error.message);
  }
  const venueOpeningHours = (venueRes.data?.opening_hours as OpeningHours | null) ?? null;
  const venueWideBlocks = rowsToVenueWideBlocks(venueBlocksRes.data);

  return buildResourceEngineInputFromParts({
    date,
    resources,
    conflictResources,
    bookingsForDate: (bookingsRes.data ?? []) as Record<string, unknown>[],
    venueOpeningHours,
    venueWideBlocks,
    venueTimezone: resolveVenueTimezone(venueRes.data),
    excludeBookingId,
    skipPastSlotFilter,
  });
}
