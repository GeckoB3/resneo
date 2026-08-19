/**
 * Venue opening hours as context for the calendar-hours editor (decision (K), step 6).
 *
 * A calendar can only sell where its hours fall INSIDE the venue's. That composition is the
 * subject of this whole programme, and until now the editor described it in prose and left
 * the reader to work out whether their own hours actually complied. Time set outside the
 * venue's hours is not an error and is not rejected: it simply never becomes bookable, which
 * is the most confusing possible outcome because nothing anywhere says so.
 *
 * This computes what to show per day. It deliberately does NOT change what is saved: the
 * venue layer already decides what is bookable, and clamping the input here would silently
 * discard a setting a venue may want back the moment its opening hours widen again.
 */

import type { OpeningHours } from '@/types/availability';

export interface HoursPeriodLike {
  open: string;
  close: string;
}

export type VenueDayContext =
  | { kind: 'unset' }
  | { kind: 'closed' }
  | { kind: 'open'; periods: HoursPeriodLike[] };

function toMinutes(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

/**
 * The venue's shape for one weekday, normalised across the three stored forms: absent,
 * `{ closed: true }`, `{ periods: [...] }`, and the legacy single `{ open, close }`.
 *
 * `unset` is distinct from `closed` on purpose. A venue that has never set opening hours
 * imposes no constraint at all, so telling that venue its calendar is "outside opening
 * hours" would be both wrong and alarming.
 */
export function venueDayContext(hours: OpeningHours | null | undefined, dayKey: string): VenueDayContext {
  if (!hours || typeof hours !== 'object') return { kind: 'unset' };

  const raw = (hours as Record<string, unknown>)[dayKey] as
    | { closed?: boolean; periods?: HoursPeriodLike[]; open?: string; close?: string }
    | undefined;

  if (raw === undefined || raw === null) return { kind: 'unset' };
  if (raw.periods?.length) return { kind: 'open', periods: raw.periods };
  if (raw.closed === true) return { kind: 'closed' };
  if (typeof raw.open === 'string' && typeof raw.close === 'string') {
    return { kind: 'open', periods: [{ open: raw.open, close: raw.close }] };
  }
  // An entry with nothing usable in it is invalid data, not an intent to close (plan §2.2).
  return { kind: 'unset' };
}

/** "09:00 to 17:00", or two windows joined, for display. */
export function describeVenueDay(context: VenueDayContext): string {
  switch (context.kind) {
    case 'unset':
      return 'No business hours set';
    case 'closed':
      return 'Venue closed';
    case 'open':
      return context.periods.map((p) => `${p.open} to ${p.close}`).join(', ');
  }
}

/**
 * True when any part of `calendarPeriods` falls outside the venue's hours for that day, so
 * the time is set but will never be bookable.
 *
 * Returns false for `unset`: no opening hours means no constraint. Returns true for a
 * `closed` day carrying any calendar hours at all, which is the starkest version of the
 * problem and the easiest to set by accident with "copy to other open days".
 */
export function calendarHoursOutsideVenue(
  calendarPeriods: readonly HoursPeriodLike[] | null | undefined,
  context: VenueDayContext,
): boolean {
  if (!calendarPeriods?.length) return false;
  if (context.kind === 'unset') return false;
  if (context.kind === 'closed') return true;

  const venue = context.periods
    .map((p) => ({ start: toMinutes(p.open), end: toMinutes(p.close) }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .sort((a, b) => a.start - b.start);

  if (venue.length === 0) return false;

  return calendarPeriods.some((p) => {
    let cursor = toMinutes(p.open);
    const end = toMinutes(p.close);
    if (!Number.isFinite(cursor) || !Number.isFinite(end) || end <= cursor) return false;

    // Walk the venue windows in order, consuming the covered part of this period. Anything
    // left when they run out is time the venue is not open for.
    for (const window of venue) {
      if (window.end <= cursor) continue;
      if (window.start > cursor) return true; // gap before this window
      cursor = Math.max(cursor, window.end);
      if (cursor >= end) return false;
    }
    return cursor < end;
  });
}
