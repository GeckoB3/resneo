import type { TableGridData } from '@/types/table-management';
import { BOOKING_ACTIVE_STATUSES } from '@/lib/table-management/constants';

function timeToMinutes(t: string): number {
  const clean = t.slice(0, 5);
  const [h, m] = clean.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function endMinutesAfterStart(start: string, end: string | null | undefined, fallbackMinutes = 90): number {
  const startMin = timeToMinutes(start);
  if (!end) return startMin + fallbackMinutes;
  let endMin = timeToMinutes(end);
  if (endMin <= startMin) {
    endMin += 24 * 60;
  }
  return endMin;
}

/**
 * Party sizes for unique bookings that overlap `timeMinutes` (minutes from midnight)
 * on the grid's date, optionally limited to visible tables. Each booking is counted once
 * (e.g. combo tables do not multiply covers).
 */
export function coversInUseAtTime(
  grid: TableGridData,
  timeMinutes: number,
  visibleTableIds?: Set<string>,
): number {
  const seen = new Set<string>();
  let total = 0;

  for (const cell of grid.cells) {
    if (visibleTableIds && !visibleTableIds.has(cell.table_id)) continue;
    if (!cell.booking_id || !cell.booking_details) continue;

    const bd = cell.booking_details;
    if (!BOOKING_ACTIVE_STATUSES.includes(bd.status as (typeof BOOKING_ACTIVE_STATUSES)[number])) {
      continue;
    }

    const start = timeToMinutes(bd.start_time);
    const end = endMinutesAfterStart(bd.start_time, bd.end_time);

    if (timeMinutes >= start && timeMinutes < end) {
      if (!seen.has(cell.booking_id)) {
        seen.add(cell.booking_id);
        total += bd.party_size;
      }
    }
  }

  return total;
}

/**
 * Unique tables whose assigned booking overlaps `timeMinutes` (minutes from
 * midnight) on the grid's date, optionally limited to visible tables.
 */
export function tablesInUseAtTime(
  grid: TableGridData,
  timeMinutes: number,
  visibleTableIds?: Set<string>,
): number {
  const inUse = new Set<string>();

  for (const cell of grid.cells) {
    if (visibleTableIds && !visibleTableIds.has(cell.table_id)) continue;
    if (!cell.booking_id || !cell.booking_details) continue;

    const bd = cell.booking_details;
    if (!BOOKING_ACTIVE_STATUSES.includes(bd.status as (typeof BOOKING_ACTIVE_STATUSES)[number])) {
      continue;
    }

    const start = timeToMinutes(bd.start_time);
    const end = endMinutesAfterStart(bd.start_time, bd.end_time);

    if (timeMinutes >= start && timeMinutes < end) {
      inUse.add(cell.table_id);
    }
  }

  return inUse.size;
}
