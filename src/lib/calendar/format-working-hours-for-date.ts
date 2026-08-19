import { getDayOfWeekForYmdInTimezone } from '@/lib/venue/venue-local-clock';
import type { TimeRange, WorkingHours } from '@/types/booking-models';

const LEGACY_DAY_NAME_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function periodsForCalendarDay(wh: WorkingHours, dow: number): TimeRange[] | undefined {
  const numeric = wh[String(dow)];
  if (Array.isArray(numeric) && numeric.length > 0) return numeric;
  const legacy = wh[LEGACY_DAY_NAME_KEYS[dow] as string];
  if (Array.isArray(legacy) && legacy.length > 0) return legacy;
  return undefined;
}

/** Minute range, matching the resolver's shape. */
export interface MinuteRangeLike {
  start: number;
  end: number;
}

function toMinutes(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

function toHhMm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Overlap of the calendar's periods with the venue's allowed ranges. */
function intersect(periods: TimeRange[], venue: readonly MinuteRangeLike[]): MinuteRangeLike[] {
  const out: MinuteRangeLike[] = [];
  for (const p of periods) {
    const s = toMinutes((p.start ?? '').trim().slice(0, 5));
    const e = toMinutes((p.end ?? '').trim().slice(0, 5));
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
    for (const v of venue) {
      const start = Math.max(s, v.start);
      const end = Math.min(e, v.end);
      if (end > start) out.push({ start, end });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Human-readable working hours for one calendar column on a given civil date (venue timezone).
 * Uses practitioner / unified calendar `working_hours` (Settings → Calendar availability).
 *
 * `venueRanges` is OPTIONAL, and omitting it keeps the previous behaviour exactly. Pass it
 * only for columns belonging to THIS venue: linked columns come from another venue with its
 * own opening hours, and constraining them by this one's would be actively wrong.
 *
 * When passed, the line shows the hours a guest can actually book, with the calendar's own
 * hours in brackets when the two differ. Before this, the header showed the raw calendar
 * hours while the grid beside it drew the effective ones, so on a Tuesday where the venue
 * closes at 18:00 and the calendar runs to 22:00 the two halves of the same screen
 * disagreed, and only the smaller number was true.
 *
 * Closures are NOT subtracted here. A part-day closure would fragment the line into
 * something unreadable, and the grid already draws closure stripes in place. This answers
 * "what hours does this column work today", not "which minutes are free".
 */
export function formatWorkingHoursLineForDate(
  workingHours: WorkingHours | null | undefined,
  dateYmd: string,
  timeZone: string,
  venueRanges?: readonly MinuteRangeLike[] | null,
): string {
  const wh = workingHours ?? {};
  const dow = getDayOfWeekForYmdInTimezone(dateYmd, timeZone);
  const periods = periodsForCalendarDay(wh, dow);
  if (!periods || periods.length === 0) return 'Closed';

  const format = (list: TimeRange[]) =>
    list
      .map((p) => {
        const s = (p.start ?? '').trim().slice(0, 5);
        const e = (p.end ?? '').trim().slice(0, 5);
        return s && e ? `${s}–${e}` : '';
      })
      .filter(Boolean)
      .join(', ');

  const own = format(periods);

  // No venue context supplied, or the venue imposes no constraint: unchanged behaviour.
  if (!venueRanges) return own || 'Closed';

  const effective = intersect(periods, venueRanges);
  if (effective.length === 0) return 'Closed (outside business hours)';

  const effectiveLine = effective.map((r) => `${toHhMm(r.start)}–${toHhMm(r.end)}`).join(', ');
  // Only mention the calendar's own hours when they differ, so the common case stays terse.
  return effectiveLine === own ? effectiveLine : `${effectiveLine} (calendar ${own})`;
}
