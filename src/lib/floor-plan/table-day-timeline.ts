import type { TableGridData } from '@/types/table-management';

export interface TableDayBookingSegment {
  booking_id: string;
  guest_name: string;
  party_size: number;
  status: string;
  start_time: string;
  end_time: string;
  /** Minutes since midnight for stable sort */
  start_sort_min: number;
}

function startDisplayAndMinutes(raw: string): { label: string; min: number } {
  let hhmm = raw.slice(0, 5);
  if (raw.includes('T')) {
    try {
      const d = new Date(raw);
      hhmm = d.toISOString().slice(11, 16);
    } catch {
      hhmm = raw.slice(11, 16);
    }
  }
  const [h, m] = hhmm.split(':').map(Number);
  const label =
    raw.includes('T') && !Number.isNaN(Date.parse(raw))
      ? new Date(raw).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : hhmm;
  return { label, min: (h ?? 0) * 60 + (m ?? 0) };
}

/**
 * Distinct bookings that touch this table on the grid day (from slot cells).
 */
export function collectTableDayBookings(grid: TableGridData | null, tableId: string): TableDayBookingSegment[] {
  if (!grid?.cells?.length) return [];
  const byId = new Map<string, TableDayBookingSegment>();
  for (const c of grid.cells) {
    if (c.table_id !== tableId || !c.booking_id || !c.booking_details) continue;
    const id = c.booking_id;
    if (byId.has(id)) continue;
    const bd = c.booking_details;
    const { label, min } = startDisplayAndMinutes(bd.start_time);
    byId.set(id, {
      booking_id: id,
      guest_name: bd.guest_name,
      party_size: bd.party_size,
      status: bd.status,
      start_time: label,
      end_time: bd.end_time ? bd.end_time.slice(0, 5) : '—',
      start_sort_min: min,
    });
  }
  return [...byId.values()].sort((a, b) => a.start_sort_min - b.start_sort_min);
}
