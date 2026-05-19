import { addCalendarDays } from '@/lib/calendar/schedule-blocks-grouping';
import { minutesToTime } from '@/lib/availability';
import { getBreakRanges, getWorkingRanges } from '@/lib/availability/appointment-engine';
import type { Practitioner } from '@/types/booking-models';

/** Synthetic calendar grid block derived from practitioner / calendar break settings. */
export interface PractitionerBreakCalendarBlock {
  id: string;
  practitioner_id: string;
  calendar_id: string | null;
  block_date: string;
  start_time: string;
  end_time: string;
  reason: string | null;
  block_type: 'break';
}

function enumerateDatesInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    if (cur === to) break;
    cur = addCalendarDays(cur, 1);
  }
  return out;
}

function breakBlockId(practitionerId: string, dateStr: string, startHm: string): string {
  return `break:${practitionerId}:${dateStr}:${startHm}`;
}

/**
 * Builds read-only break blocks for the staff calendar from each column's
 * `break_times` / `break_times_by_day` (Calendar availability settings).
 */
type PractitionerBreakInput = {
  id: string;
  is_active: boolean;
  break_times?: Practitioner['break_times'];
  break_times_by_day?: Practitioner['break_times_by_day'];
  working_hours?: Practitioner['working_hours'];
  days_off?: Practitioner['days_off'];
};

export function buildPractitionerBreakBlocks(
  practitioners: PractitionerBreakInput[],
  fromDate: string,
  toDate: string,
): PractitionerBreakCalendarBlock[] {
  const dates = enumerateDatesInclusive(fromDate, toDate);
  const out: PractitionerBreakCalendarBlock[] = [];

  for (const prac of practitioners) {
    if (!prac.is_active) continue;
    const asPractitioner = prac as Practitioner;

    for (const dateStr of dates) {
      if (getWorkingRanges(asPractitioner, dateStr).length === 0) continue;

      const breakRanges = getBreakRanges(asPractitioner, dateStr);
      for (const br of breakRanges) {
        if (br.end <= br.start) continue;
        const startHm = minutesToTime(br.start);
        const endHm = minutesToTime(br.end);
        out.push({
          id: breakBlockId(prac.id, dateStr, startHm),
          practitioner_id: prac.id,
          calendar_id: prac.id,
          block_date: dateStr,
          start_time: startHm,
          end_time: endHm,
          reason: null,
          block_type: 'break',
        });
      }
    }
  }

  return out;
}
