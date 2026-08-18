import type { AvailabilityBlock, OpeningHours, OpeningHoursPeriod } from '@/types/availability';
import { resolveVenueWideAllowedMinuteRanges } from '@/lib/availability/venue-wide-business-hours';
import { getDayOfWeekForYmdInTimezone } from '@/lib/venue/venue-local-clock';

function timeToMinutesHM(t: string): number {
  if (typeof t !== 'string' || t.trim() === '') return NaN;
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  const hh = h ?? 0;
  const mm = m ?? 0;
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return NaN;
  return hh * 60 + mm;
}

/** UTC weekday 0–6 for YYYY-MM-DD (aligned with appointment engine). */
export function utcWeekdayKey(dateStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return String(new Date(Date.UTC(y!, mo! - 1, d!)).getUTCDay());
}

function periodsForDay(day: OpeningHours[keyof OpeningHours] | undefined): OpeningHoursPeriod[] {
  if (!day || typeof day !== 'object') return [];
  const d = day as Record<string, unknown>;
  if (d.closed === true) return [];
  if (Array.isArray(d.periods)) return d.periods as OpeningHoursPeriod[];
  if (typeof d.open === 'string' && typeof d.close === 'string') {
    return [{ open: d.open, close: d.close }];
  }
  return [];
}

/**
 * Whether venue `opening_hours` indicate the business trades on this civil date.
 * Weekday resolution matches `getCalendarGridBounds` (venue-local when `timeZone` is set).
 *
 * @returns `open` | `closed`, or `null` when opening hours are not configured (caller may default to “open”).
 */
export function getVenueBusinessDayStatus(
  dateStr: string,
  openingHours: OpeningHours | null | undefined,
  timeZone?: string | null,
  venueWideBlocks?: AvailabilityBlock[] | null,
): 'open' | 'closed' | null {
  /**
   * `venueWideBlocks` is optional and omitting it reproduces the weekly-only answer this
   * gave before Stage 4. When supplied, the month grid greys a day out only if the venue is
   * ACTUALLY shut on it: a day the owner amended to open specially stopped being greyed,
   * and a day an override closed starts being greyed even though the weekly shape says open.
   */
  if (venueWideBlocks && venueWideBlocks.length > 0) {
    const res = resolveVenueWideAllowedMinuteRanges(openingHours ?? null, dateStr, venueWideBlocks);
    if (res.kind === 'unrestricted') return null;
    return res.kind === 'closed' ? 'closed' : 'open';
  }
  if (!openingHours || Object.keys(openingHours).length === 0) {
    return null;
  }
  const tz = timeZone?.trim();
  const key = tz ? String(getDayOfWeekForYmdInTimezone(dateStr, tz)) : utcWeekdayKey(dateStr);
  const day = openingHours[key];
  if (day && typeof day === 'object' && 'closed' in day && (day as { closed?: boolean }).closed === true) {
    return 'closed';
  }
  const periods = periodsForDay(day);
  if (periods.length === 0) {
    return 'closed';
  }
  let anyValid = false;
  for (const p of periods) {
    if (typeof p.open !== 'string' || typeof p.close !== 'string') continue;
    const openM = timeToMinutesHM(p.open);
    const closeM = timeToMinutesHM(p.close);
    if (!Number.isFinite(openM) || !Number.isFinite(closeM)) continue;
    if (closeM > openM) anyValid = true;
  }
  return anyValid ? 'open' : 'closed';
}

export interface CalendarGridBoundsOptions {
  /** IANA timezone (e.g. Europe/London). When set, weekday matches Settings → Business Hours for that civil date. */
  timeZone?: string | null;
  /**
   * Venue-wide `availability_blocks` for the date. OPTIONAL, and omitting it reproduces the
   * pre-Stage-4 behaviour exactly, which is what keeps the restaurant call sites provably
   * untouched.
   *
   * When supplied, bounds are derived from the venue's RESOLVED hours for that date rather
   * than from the weekly shape alone. Without it, a day amended to run until 20:00 at a
   * venue whose weekly hours end at 17:00 produced a grid ending at 17:00 and the amended
   * stripe was clipped away by `schedule-closure-blocks`, so the very hours the owner had
   * just entered were the ones they could not see or drag into.
   */
  venueWideBlocks?: AvailabilityBlock[] | null;
}

/**
 * Resolved open ranges for the date, or null when blocks are not supplied or impose nothing.
 * Closures are NOT subtracted: the grid should still SHOW a closed window so the diary can
 * draw it, and drawing is what `schedule-closure-blocks` does with the same data.
 */
function resolvedHourRangesForBounds(
  dateStr: string,
  openingHours: OpeningHours | null | undefined,
  venueWideBlocks: AvailabilityBlock[] | null | undefined,
): Array<{ start: number; end: number }> | null {
  if (!venueWideBlocks || venueWideBlocks.length === 0) return null;
  const res = resolveVenueWideAllowedMinuteRanges(openingHours ?? null, dateStr, venueWideBlocks);
  if (res.hours.kind === 'ranges') return res.hours.ranges;
  return null;
}

/**
 * Calendar grid vertical range from venue opening_hours for one date.
 * Falls back to 07:00–21:00 when closed or missing.
 */
export function getCalendarGridBounds(
  dateStr: string,
  openingHours: OpeningHours | null | undefined,
  fallbackStart = 7,
  fallbackEnd = 21,
  options?: CalendarGridBoundsOptions,
): { startHour: number; endHour: number } {
  if (!openingHours || Object.keys(openingHours).length === 0) {
    return { startHour: fallbackStart, endHour: fallbackEnd };
  }
  const tz = options?.timeZone?.trim();
  const key = tz
    ? String(getDayOfWeekForYmdInTimezone(dateStr, tz))
    : utcWeekdayKey(dateStr);
  const resolved = resolvedHourRangesForBounds(dateStr, openingHours, options?.venueWideBlocks);

  let minM = Infinity;
  let maxM = -Infinity;

  if (resolved) {
    // An Hours override REPLACES the weekly shape, so the grid follows the override --
    // including on a weekday the venue would otherwise not trade at all.
    for (const r of resolved) {
      minM = Math.min(minM, r.start);
      maxM = Math.max(maxM, r.end);
    }
  } else {
    const day = openingHours[key];
    const periods = periodsForDay(day);
    if (periods.length === 0) {
      return { startHour: fallbackStart, endHour: fallbackEnd };
    }
    for (const p of periods) {
      if (typeof p.open !== 'string' || typeof p.close !== 'string') continue;
      const openM = timeToMinutesHM(p.open);
      const closeM = timeToMinutesHM(p.close);
      if (!Number.isFinite(openM) || !Number.isFinite(closeM)) continue;
      minM = Math.min(minM, openM);
      maxM = Math.max(maxM, closeM);
    }
  }
  if (!Number.isFinite(minM) || minM === Infinity || !Number.isFinite(maxM) || maxM === -Infinity) {
    return { startHour: fallbackStart, endHour: fallbackEnd };
  }
  if (maxM < minM) {
    return { startHour: fallbackStart, endHour: fallbackEnd };
  }
  const startHour = Math.max(0, Math.floor(minM / 60));
  let endHour = Math.ceil(maxM / 60);
  if (endHour <= startHour) endHour = startHour + 1;
  endHour = Math.min(24, Math.max(endHour, startHour + 1));
  return { startHour, endHour };
}

/**
 * Valid trading periods for one civil date from `opening_hours` (venue-local weekday when `timeZone` is set).
 */
export function getOpeningPeriodsForVenueDate(
  dateStr: string,
  openingHours: OpeningHours | null | undefined,
  options?: CalendarGridBoundsOptions,
): OpeningHoursPeriod[] {
  if (!openingHours || Object.keys(openingHours).length === 0) {
    return [];
  }
  const tz = options?.timeZone?.trim();
  const key = tz ? String(getDayOfWeekForYmdInTimezone(dateStr, tz)) : utcWeekdayKey(dateStr);
  const day = openingHours[key];
  const raw = periodsForDay(day);
  return raw.filter((p) => {
    if (typeof p.open !== 'string' || typeof p.close !== 'string') return false;
    const openM = timeToMinutesHM(p.open);
    const closeM = timeToMinutesHM(p.close);
    return Number.isFinite(openM) && Number.isFinite(closeM) && closeM > openM;
  });
}

/**
 * Grid hour bounds for a single open/close period. Uses the same rules as
 * {@link getCalendarGridBounds} when that day has one period.
 */
export function periodToCalendarGridHours(open: string, close: string): { startHour: number; endHour: number } | null {
  const openM = timeToMinutesHM(open);
  const closeM = timeToMinutesHM(close);
  if (!Number.isFinite(openM) || !Number.isFinite(closeM)) return null;
  if (closeM <= openM) return null;
  const startHour = Math.max(0, Math.floor(openM / 60));
  let endHour = Math.ceil(closeM / 60);
  if (endHour <= startHour) endHour = startHour + 1;
  endHour = Math.min(24, Math.max(endHour, startHour + 1));
  return { startHour, endHour };
}
