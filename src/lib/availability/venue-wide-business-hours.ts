/**
 * Venue-wide closures and amended hours from `availability_blocks` (service_id null)
 * must constrain all booking models (table uses dining engine; this module covers
 * event / class / resource listing and time-range validation).
 */

import type { AvailabilityBlock, OpeningHours } from '@/types/availability';
import { getOpeningPeriodsForDay, timeToMinutes } from '@/lib/availability';
import { getDayOfWeek } from '@/lib/availability/engine';
import { unionMinuteRanges } from '@/lib/availability/calendar-resource-occupancy';

function isOpeningHoursConfigured(openingHours: OpeningHours | null | undefined): boolean {
  return openingHours != null && typeof openingHours === 'object' && Object.keys(openingHours).length > 0;
}

function sliceTime(t: string | null | undefined): string | null {
  if (t == null || String(t).trim() === '') return null;
  return String(t).slice(0, 5);
}

export function blocksForDate(venueWideBlocks: AvailabilityBlock[], dateStr: string): AvailabilityBlock[] {
  return venueWideBlocks.filter(
    (b) =>
      b.service_id == null &&
      dateStr >= b.date_start &&
      dateStr <= b.date_end &&
      (b.block_type === 'closed' || b.block_type === 'special_event' || b.block_type === 'amended_hours'),
  );
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

export function intersectMinuteRangeArrays(
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
  // Merge, do not merely sort. When two amended blocks overlap on a date this produced
  // OVERLAPPING output ranges, and `candidateStartMinutes` iterates ranges without
  // deduping, so a guest was offered the same start time twice. The diary's
  // `closedRangesFromOpenWindows` mis-rendered the same day for the same reason.
  // Merging is behaviour-preserving for coverage checks, which already tolerate overlap.
  return unionMinuteRanges(out);
}

function unionAmendedPeriods(blocks: AvailabilityBlock[]): Array<{ start: number; end: number }> {
  const periods: Array<{ start: number; end: number }> = [];
  for (const b of blocks) {
    if (b.block_type !== 'amended_hours' || !Array.isArray(b.override_periods)) continue;
    for (const p of b.override_periods) {
      periods.push({ start: timeToMinutes(p.open), end: timeToMinutes(p.close) });
    }
  }
  // Note this is a concat across every amended block on the date, not a per-block choice.
  // Which block wins when several apply is operator decision (E), and lands in Stage 3.
  // Merging here only removes duplicate and overlapping output; it does not pick a winner.
  return unionMinuteRanges(periods.filter((r) => r.end > r.start));
}

/**
 * Why the venue is closed, when it is.
 *
 * `weekly` means the venue simply does not trade this weekday: opening hours are
 * configured and this weekday has no periods. That is an ABSENCE of configuration, not a
 * decision to shut, and scheduled instances someone deliberately put on the calendar are
 * still allowed to run (operator decision H).
 *
 * `override` means something explicitly closed it: a closure block, a special event, or an
 * amended-hours row that resolved to nothing.
 *
 * Collapsing these two into a bare `closed` is what forced `isWeeklyScheduleClosedForDate`
 * to exist, and that helper had to re-derive the distinction from the block list -- which
 * it got wrong, returning false the moment ANY block existed on the date. See the resolver
 * plan §2.3 step 5.
 */
export type VenueClosedCause = 'weekly' | 'override';

export type VenueWideResolution =
  | { kind: 'unrestricted'; closures: Array<{ start: number; end: number }> }
  | { kind: 'closed'; cause: VenueClosedCause; closures: Array<{ start: number; end: number }> }
  | {
      kind: 'allowed';
      ranges: Array<{ start: number; end: number }>;
      closures: Array<{ start: number; end: number }>;
    };

/**
 * Closed / special_event windows for the date, materialised. A block with no times covers
 * the whole day. Exposed on every resolution so a consumer can ask "does a closure overlap
 * MY window?" without re-deriving it from the block list.
 */
export function venueClosureWindowsForDate(
  venueWideBlocks: AvailabilityBlock[],
  dateStr: string,
): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (const b of blocksForDate(venueWideBlocks, dateStr)) {
    if (b.block_type !== 'closed' && b.block_type !== 'special_event') continue;
    const ts = sliceTime(b.time_start);
    const te = sliceTime(b.time_end);
    if (ts == null || te == null) {
      out.push({ start: 0, end: 24 * 60 });
      continue;
    }
    const a = timeToMinutes(ts);
    const c = timeToMinutes(te);
    if (c > a) out.push({ start: a, end: c });
  }
  return unionMinuteRanges(out);
}

const FULL_DAY = [{ start: 0, end: 24 * 60 }];

/** Single source for the guest-facing refusal, so both gates say the same thing. */
const CLOSED_MESSAGE = 'The venue is closed for this date or time.';

/**
 * Allowed venue-local minute ranges for a calendar date after applying venue-wide
 * closed / special_event / amended_hours blocks and weekly opening_hours.
 */
export function resolveVenueWideAllowedMinuteRanges(
  openingHours: OpeningHours | null | undefined,
  dateStr: string,
  venueWideBlocks: AvailabilityBlock[],
): VenueWideResolution {
  const dayBlocks = blocksForDate(venueWideBlocks, dateStr);
  const hasWeekly = isOpeningHoursConfigured(openingHours);
  const closures = venueClosureWindowsForDate(venueWideBlocks, dateStr);

  if (dayBlocks.length === 0) {
    if (!hasWeekly) return { kind: 'unrestricted', closures };
    const day = getDayOfWeek(dateStr);
    const periods = getOpeningPeriodsForDay(openingHours!, day);
    const ranges = periods.map((p) => ({ start: timeToMinutes(p.open), end: timeToMinutes(p.close) }));
    return ranges.length === 0
      ? { kind: 'closed', cause: 'weekly', closures }
      : { kind: 'allowed', ranges, closures };
  }

  const closedLike = dayBlocks.filter((b) => b.block_type === 'closed' || b.block_type === 'special_event');
  const amended = dayBlocks.filter((b) => b.block_type === 'amended_hours');

  let base: Array<{ start: number; end: number }>;
  if (hasWeekly) {
    const day = getDayOfWeek(dateStr);
    const periods = getOpeningPeriodsForDay(openingHours!, day);
    base = periods.map((p) => ({ start: timeToMinutes(p.open), end: timeToMinutes(p.close) }));
    if (base.length === 0) {
      // The weekday has no periods. A CLOSURE on the date does not change why it is shut,
      // so the weekly allowance still applies. An AMENDED-HOURS row does: it is the venue
      // stating hours for this specific date. Until Stage 3 makes amended hours replace
      // the weekly baseline, this resolver cannot honour those hours, and granting the
      // weekly allowance here would put an instance on sale at ANY time of day while the
      // venue had named a window. Report it as an override-closed day instead, which is
      // exactly today's behaviour for this shape.
      const cause: VenueClosedCause = amended.length > 0 ? 'override' : 'weekly';
      return { kind: 'closed', cause, closures };
    }
  } else {
    base = [...FULL_DAY];
  }

  const fullDayClosed = closedLike.some((b) => {
    const ts = sliceTime(b.time_start);
    const te = sliceTime(b.time_end);
    return ts == null || te == null;
  });
  if (fullDayClosed) return { kind: 'closed', cause: 'override', closures };

  const partialClosed: Array<{ start: number; end: number }> = [];
  for (const b of closedLike) {
    const ts = sliceTime(b.time_start);
    const te = sliceTime(b.time_end);
    if (ts != null && te != null) {
      const a = timeToMinutes(ts);
      const c = timeToMinutes(te);
      if (c > a) partialClosed.push({ start: a, end: c });
    }
  }
  if (partialClosed.length > 0) {
    base = subtractRangesFromRanges(base, partialClosed);
  }

  if (amended.length > 0) {
    const union = unionAmendedPeriods(amended);
    if (union.length === 0) return { kind: 'closed', cause: 'override', closures };
    base = intersectMinuteRangeArrays(base, union);
  }

  const cleaned = base.filter((r) => r.end > r.start);
  if (cleaned.length === 0) return { kind: 'closed', cause: 'override', closures };

  return { kind: 'allowed', ranges: cleaned, closures };
}

/** Exported for tests / event validation edge cases. */
export function isMinuteSubintervalCoveredByRanges(
  startMin: number,
  endMin: number,
  allowed: Array<{ start: number; end: number }>,
): boolean {
  if (endMin <= startMin) return false;
  const sorted = [...allowed].filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  let cur = startMin;
  for (const seg of sorted) {
    if (cur >= endMin) return true;
    if (endMin <= seg.start) return false;
    if (cur < seg.start) return false;
    cur = Math.max(cur, Math.min(endMin, seg.end));
  }
  return cur >= endMin;
}

/**
 * Returns a user-facing error message if the window is not bookable, else null.
 */
export function venueWideBlocksRejectBookingWindow(
  openingHours: OpeningHours | null | undefined,
  dateStr: string,
  startHhMm: string,
  endHhMm: string,
  venueWideBlocks: AvailabilityBlock[],
): string | null {
  const res = resolveVenueWideAllowedMinuteRanges(openingHours, dateStr, venueWideBlocks);
  if (res.kind === 'unrestricted') return null;
  if (res.kind === 'closed') {
    return CLOSED_MESSAGE;
  }
  const start = timeToMinutes(startHhMm.slice(0, 5));
  const end = timeToMinutes(endHhMm.slice(0, 5));
  if (!isMinuteSubintervalCoveredByRanges(start, end, res.ranges)) {
    return CLOSED_MESSAGE;
  }
  return null;
}

/**
 * Venue gate for a SCHEDULED INSTANCE: a class, an event, or an `event_sessions` row.
 *
 * Different from {@link venueWideBlocksRejectBookingWindow}, which stays the gate for slot
 * generation (resources, appointments). A scheduled instance is not a slot someone picked
 * off a grid; it is a fixed time staff deliberately put on the calendar, so a weekday the
 * venue has no hours for does not by itself refuse it (operator decision H).
 *
 * The rules, in order:
 *  1. An explicit closure overlapping the window always refuses. This is checked against
 *     the closure windows directly, so an UNRELATED closure elsewhere in the day no longer
 *     changes the answer -- which is §1.2 item 7, fixed for scheduled instances.
 *  2. `weekly` closed, with no overlapping closure, is ALLOWED. This is what
 *     `isWeeklyScheduleClosedForDate` used to express, minus its bug: that helper returned
 *     false the moment any block existed on the date, so one unrelated morning closure
 *     silently took every evening event off sale.
 *  3. Otherwise the window must fit inside the resolved open ranges, as before.
 *
 * Classes being bookable outside weekly hours on an OPEN weekday is a separate rule and is
 * still enforced by rule 3 here; splitting that by `calendar_type` is Stage 5 work.
 *
 * See Docs/Resneo_Scheduling_Resolver_Plan_August_2026.md §2.6 and Stage 2.
 */
export function scheduledInstanceRejectBookingWindow(
  openingHours: OpeningHours | null | undefined,
  dateStr: string,
  startHhMm: string,
  endHhMm: string,
  venueWideBlocks: AvailabilityBlock[],
): string | null {
  const res = resolveVenueWideAllowedMinuteRanges(openingHours, dateStr, venueWideBlocks);

  const start = timeToMinutes(startHhMm.slice(0, 5));
  const rawEnd = timeToMinutes(endHhMm.slice(0, 5));
  // An instance ending at or before its start crosses midnight; compare against the tail
  // that falls on this date. Matches the class and event engines.
  const end = rawEnd <= start ? 24 * 60 : rawEnd;

  const overlapsClosure = res.closures.some((c) => start < c.end && c.start < end);
  if (overlapsClosure) return CLOSED_MESSAGE;

  if (res.kind === 'unrestricted') return null;
  if (res.kind === 'closed') {
    return res.cause === 'weekly' ? null : CLOSED_MESSAGE;
  }
  if (!isMinuteSubintervalCoveredByRanges(start, end, res.ranges)) return CLOSED_MESSAGE;
  return null;
}

export function venueWideResolutionToNullableRanges(
  res: VenueWideResolution,
): Array<{ start: number; end: number }> | null {
  if (res.kind === 'unrestricted') return null;
  if (res.kind === 'closed') return [];
  return res.ranges;
}

/** Intersect resource bookable ranges with venue-wide Business Hours resolution. */
export function intersectRangesWithVenueWideResolution(
  resourceRanges: Array<{ start: number; end: number }>,
  venueResolution: VenueWideResolution,
): Array<{ start: number; end: number }> {
  if (venueResolution.kind === 'unrestricted') return resourceRanges;
  if (venueResolution.kind === 'closed') return [];
  return intersectMinuteRangeArrays(resourceRanges, venueResolution.ranges);
}
