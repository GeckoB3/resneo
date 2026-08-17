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

/**
 * True when there are no venue-wide blocks on this date, weekly opening hours are configured,
 * but this weekday has no periods (e.g. restaurant closed Mon–Wed). In that case
 * {@link resolveVenueWideAllowedMinuteRanges} returns `closed` even though there is no explicit
 * closure block — ticketed events may still run that day.
 */
export function isWeeklyScheduleClosedForDate(
  openingHours: OpeningHours | null | undefined,
  dateStr: string,
  venueWideBlocks: AvailabilityBlock[],
): boolean {
  if (blocksForDate(venueWideBlocks, dateStr).length > 0) return false;
  if (!isOpeningHoursConfigured(openingHours)) return false;
  const day = getDayOfWeek(dateStr);
  const periods = getOpeningPeriodsForDay(openingHours!, day);
  return periods.length === 0;
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

export type VenueWideResolution =
  | { kind: 'unrestricted' }
  | { kind: 'closed' }
  | { kind: 'allowed'; ranges: Array<{ start: number; end: number }> };

const FULL_DAY = [{ start: 0, end: 24 * 60 }];

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

  if (dayBlocks.length === 0) {
    if (!hasWeekly) return { kind: 'unrestricted' };
    const day = getDayOfWeek(dateStr);
    const periods = getOpeningPeriodsForDay(openingHours!, day);
    const ranges = periods.map((p) => ({ start: timeToMinutes(p.open), end: timeToMinutes(p.close) }));
    return ranges.length === 0 ? { kind: 'closed' } : { kind: 'allowed', ranges };
  }

  const closedLike = dayBlocks.filter((b) => b.block_type === 'closed' || b.block_type === 'special_event');
  const amended = dayBlocks.filter((b) => b.block_type === 'amended_hours');

  let base: Array<{ start: number; end: number }>;
  if (hasWeekly) {
    const day = getDayOfWeek(dateStr);
    const periods = getOpeningPeriodsForDay(openingHours!, day);
    base = periods.map((p) => ({ start: timeToMinutes(p.open), end: timeToMinutes(p.close) }));
    if (base.length === 0) return { kind: 'closed' };
  } else {
    base = [...FULL_DAY];
  }

  const fullDayClosed = closedLike.some((b) => {
    const ts = sliceTime(b.time_start);
    const te = sliceTime(b.time_end);
    return ts == null || te == null;
  });
  if (fullDayClosed) return { kind: 'closed' };

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
    if (union.length === 0) return { kind: 'closed' };
    base = intersectMinuteRangeArrays(base, union);
  }

  const cleaned = base.filter((r) => r.end > r.start);
  if (cleaned.length === 0) return { kind: 'closed' };

  return { kind: 'allowed', ranges: cleaned };
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
    return 'The venue is closed for this date or time.';
  }
  const start = timeToMinutes(startHhMm.slice(0, 5));
  const end = timeToMinutes(endHhMm.slice(0, 5));
  if (!isMinuteSubintervalCoveredByRanges(start, end, res.ranges)) {
    return 'The venue is closed for this date or time.';
  }
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
