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

/** Inclusive day span of a block's date range, for decision (E)'s specificity rule. */
function blockSpanDays(b: AvailabilityBlock): number {
  const a = Date.parse(`${b.date_start}T00:00:00Z`);
  const c = Date.parse(`${b.date_end}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(c)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.round((c - a) / 86_400_000));
}

/** Valid periods of one amended block. An override with none is IGNORED, not a closure (§2.2). */
function amendedPeriodsOf(b: AvailabilityBlock): Array<{ start: number; end: number }> {
  if (!Array.isArray(b.override_periods)) return [];
  return b.override_periods
    .map((p) => ({ start: timeToMinutes(p.open), end: timeToMinutes(p.close) }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start);
}

/**
 * Which Hours override wins when several cover the same date. Operator decision (E).
 *
 * Most specific wins: the smallest inclusive date span. Ties break on the later
 * `created_at`, then on `id` so the answer is deterministic even when the column is absent
 * (it is optional on the type, and older callers do not select it). Genuinely tied
 * overrides union.
 *
 * The old rule concatenated the periods of EVERY applicable block, so a one-day
 * 10:00-14:00 override nested inside a three-month 08:00-20:00 one widened to the union
 * instead of narrowing that day -- silently, with no error. Q4 confirmed no venue has
 * overlapping overrides today, so this changes nobody's hours on the day it ships.
 */
function winningAmendedPeriods(blocks: AvailabilityBlock[]): Array<{ start: number; end: number }> {
  const applicable = blocks
    .filter((b) => b.block_type === 'amended_hours')
    .map((b) => ({ block: b, periods: amendedPeriodsOf(b) }))
    .filter((x) => x.periods.length > 0);
  if (applicable.length === 0) return [];

  const minSpan = Math.min(...applicable.map((x) => blockSpanDays(x.block)));
  let tied = applicable.filter((x) => blockSpanDays(x.block) === minSpan);

  if (tied.length > 1) {
    // Tie-break on created_at ONLY. Do not fall back to `id`: that would make a genuine tie
    // impossible, and two equally-specific overrides an owner saved for the same date are
    // both real statements about it. Decision (E) unions those rather than picking one at
    // random, which is also the behaviour that does not depend on a column callers may not
    // have selected.
    const latest = tied.reduce((acc, x) => {
      const at = x.block.created_at ?? '';
      return at > acc ? at : acc;
    }, '');
    const stillTied = tied.filter((x) => (x.block.created_at ?? '') === latest);
    if (stillTied.length > 0) tied = stillTied;
  }

  return unionMinuteRanges(tied.flatMap((x) => x.periods));
}

export type VenueClosedCause = 'weekly' | 'override';

/**
 * The venue's hours for a date, BEFORE closures are subtracted.
 *
 * `weekly-closed` is distinct from an empty range list: the venue trades, just not this
 * weekday. Every consumer that has to tell "does not trade this weekday" from "an override
 * shut it" reads this rather than re-deriving it from the block list.
 */
export type VenueHours =
  | { kind: 'unrestricted' }
  | { kind: 'weekly-closed' }
  | { kind: 'ranges'; ranges: Array<{ start: number; end: number }> };

/**
 * `kind`/`ranges` is the EFFECTIVE answer (hours minus closures) and is what containment
 * consumers test against. `hours` and `closures` are exposed separately because slot
 * generation must anchor to `hours` and veto `closures` per candidate: subtracting a
 * part-day closure from the anchoring set would re-anchor every slot after it, which is
 * the harm §2.7 forbids for breaks, applied to a different rule. See plan §2.1.
 */
export type VenueWideResolution =
  | { kind: 'unrestricted'; hours: VenueHours; closures: Array<{ start: number; end: number }> }
  | {
      kind: 'closed';
      cause: VenueClosedCause;
      hours: VenueHours;
      closures: Array<{ start: number; end: number }>;
    }
  | {
      kind: 'allowed';
      ranges: Array<{ start: number; end: number }>;
      hours: VenueHours;
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
  const closures = venueClosureWindowsForDate(venueWideBlocks, dateStr);

  // 1. The weekly baseline, in three states. "Configured but no periods this weekday" is
  //    NOT the same as "no hours configured at all", and collapsing them is what made the
  //    weekly-closed carve-out impossible to express.
  let hours: VenueHours;
  if (!isOpeningHoursConfigured(openingHours)) {
    hours = { kind: 'unrestricted' };
  } else {
    const periods = getOpeningPeriodsForDay(openingHours!, getDayOfWeek(dateStr));
    const ranges = periods
      .map((p) => ({ start: timeToMinutes(p.open), end: timeToMinutes(p.close) }))
      .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start);
    hours = ranges.length === 0 ? { kind: 'weekly-closed' } : { kind: 'ranges', ranges: unionMinuteRanges(ranges) };
  }

  // 2. Hours overrides REPLACE the baseline, including replacing 'weekly-closed'. That is
  //    what lets a venue open specially on a normally-closed weekday, and it is the single
  //    most broken case in the old resolver, which returned closed before it ever looked at
  //    amended hours. Which override wins is decision (E).
  const overridePeriods = winningAmendedPeriods(dayBlocks);
  if (overridePeriods.length > 0) {
    hours = { kind: 'ranges', ranges: overridePeriods };
  }

  // 3. A weekday the venue does not trade, with no override claiming otherwise.
  if (hours.kind === 'weekly-closed') {
    return { kind: 'closed', cause: 'weekly', hours, closures };
  }

  // 4. Materialise before subtracting. Without this a part-day closure at a venue with no
  //    weekly hours is a silent no-op, and that is the most common appointments shape.
  if (hours.kind === 'unrestricted') {
    if (closures.length === 0) return { kind: 'unrestricted', hours, closures };
    const effective = subtractRangesFromRanges([...FULL_DAY], closures);
    return effective.length === 0
      ? { kind: 'closed', cause: 'override', hours, closures }
      : { kind: 'allowed', ranges: effective, hours, closures };
  }

  // 5. Closures subtract last, so a closure always beats an Hours override.
  const effective = subtractRangesFromRanges(hours.ranges, closures).filter((r) => r.end > r.start);
  if (effective.length === 0) {
    return { kind: 'closed', cause: 'override', hours, closures };
  }
  return { kind: 'allowed', ranges: unionMinuteRanges(effective), hours, closures };
}

/**
 * The anchoring set for slot generation: hours only, closures NOT subtracted.
 *
 * Returns null when the venue imposes no constraint, and an empty array when it is shut for
 * the whole day on the weekly shape. Callers veto `resolution.closures` per candidate.
 */
export function venueHoursToNullableRanges(hours: VenueHours): Array<{ start: number; end: number }> | null {
  if (hours.kind === 'unrestricted') return null;
  if (hours.kind === 'weekly-closed') return [];
  return hours.ranges;
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
