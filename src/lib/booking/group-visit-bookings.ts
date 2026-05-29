import { minutesBetweenStartAndEndHM } from '@/lib/booking/validate-appointment-modification';

/** Row shape for “Services in this visit” / group dining linked bookings. */
export interface GroupVisitBookingRow {
  id: string;
  booking_time: string;
  booking_end_time: string | null;
  status: string;
  person_label: string | null;
  booking_item_name: string | null;
  service_variant_name: string | null;
  booking_addon_labels: string[];
  /** Wall-clock span from start to end (includes add-on minutes). */
  duration_minutes: number | null;
  addons_total_duration_minutes: number;
}

export function groupVisitRowsToScheduleSeeds(
  rows: GroupVisitBookingRow[],
): Array<{
  booking_time: string;
  booking_end_time: string | null;
  estimated_end_time?: string | null;
  addons_total_duration_minutes: number;
}> {
  return rows.map((r) => ({
    booking_time: r.booking_time,
    booking_end_time: r.booking_end_time,
    addons_total_duration_minutes: r.addons_total_duration_minutes,
  }));
}

/** Minimal list-row fields used to build or prime group visit segments. */
export interface GroupVisitListSeed {
  id: string;
  booking_time: string;
  booking_end_time?: string | null;
  estimated_end_time?: string | null;
  status: string;
  group_booking_id?: string | null;
  person_label?: string | null;
  booking_item_name?: string | null;
  service_variant_name?: string | null;
  booking_addon_labels?: string[];
  addons_total_duration_minutes?: number | null;
}

function parseDurationMinutesFromRow(raw: Record<string, unknown>): number {
  const n = raw.addons_total_duration_minutes;
  if (typeof n === 'number' && Number.isFinite(n) && n > 0) return Math.round(n);
  return 0;
}

function wallClockDurationMinutes(raw: Record<string, unknown>): number | null {
  const start = String(raw.booking_time ?? '').slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(start)) return null;

  let endHm: string | null = null;
  const wallEnd = raw.booking_end_time;
  if (typeof wallEnd === 'string' && wallEnd.trim().length >= 5) {
    endHm = wallEnd.slice(0, 5);
  } else {
    const estimated = raw.estimated_end_time;
    if (typeof estimated === 'string' && estimated.trim()) {
      const parsed = new Date(estimated);
      if (!Number.isNaN(parsed.getTime())) {
        endHm = parsed.toISOString().slice(11, 16);
      }
    }
  }

  if (!endHm || !/^\d{2}:\d{2}$/.test(endHm)) return null;
  const mins = minutesBetweenStartAndEndHM(start, endHm);
  return mins > 0 ? mins : null;
}

/** Human-readable duration for a visit segment (total wall time + extras breakdown). */
export function formatDurationMinutesLabel(totalMinutes: number): string {
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (mins === 0) return `${hours} hr`;
  return `${hours} hr ${mins} min`;
}

export function formatGroupVisitSegmentDurationLabel(seg: {
  duration_minutes: number | null;
  addons_total_duration_minutes: number;
}): string | null {
  const total = seg.duration_minutes;
  if (total == null || total <= 0) return null;

  const totalLabel = formatDurationMinutesLabel(total);
  const extras = Math.max(0, seg.addons_total_duration_minutes);
  if (extras <= 0) return totalLabel;

  const service = total - extras;
  if (service > 0) {
    return `${totalLabel} (${formatDurationMinutesLabel(service)} service + ${formatDurationMinutesLabel(extras)} extras)`;
  }
  return `${totalLabel} (${formatDurationMinutesLabel(extras)} extras)`;
}
export function mapGroupVisitListRow(raw: Record<string, unknown>): GroupVisitBookingRow {
  const addonLabels = raw.booking_addon_labels;
  return {
    id: String(raw.id),
    booking_time: String(raw.booking_time),
    booking_end_time:
      typeof raw.booking_end_time === 'string' && raw.booking_end_time.trim()
        ? raw.booking_end_time
        : null,
    status: String(raw.status),
    person_label:
      typeof raw.person_label === 'string' && raw.person_label.trim() ? raw.person_label.trim() : null,
    booking_item_name:
      typeof raw.booking_item_name === 'string' && raw.booking_item_name.trim()
        ? raw.booking_item_name.trim()
        : null,
    service_variant_name:
      typeof raw.service_variant_name === 'string' && raw.service_variant_name.trim()
        ? raw.service_variant_name.trim()
        : null,
    booking_addon_labels: Array.isArray(addonLabels)
      ? addonLabels.filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      : [],
    duration_minutes: wallClockDurationMinutes(raw),
    addons_total_duration_minutes: parseDurationMinutesFromRow(raw),
  };
}

export function mapGroupVisitListSeed(row: GroupVisitListSeed): GroupVisitBookingRow {
  return mapGroupVisitListRow(row as unknown as Record<string, unknown>);
}

function sortGroupVisitRows(rows: GroupVisitBookingRow[]): GroupVisitBookingRow[] {
  return [...rows].sort((a, b) => a.booking_time.localeCompare(b.booking_time));
}

export function groupVisitSegmentsFromList(
  rows: GroupVisitListSeed[],
  groupBookingId: string | null | undefined,
): GroupVisitBookingRow[] {
  const gid = groupBookingId?.trim();
  if (!gid) return [];
  return sortGroupVisitRows(
    rows.filter((r) => r.group_booking_id?.trim() === gid).map((r) => mapGroupVisitListSeed(r)),
  );
}

const groupVisitCache = new Map<string, GroupVisitBookingRow[]>();
const groupVisitFetchInFlight = new Map<string, Promise<GroupVisitBookingRow[]>>();

export function peekGroupVisitBookings(groupBookingId: string): GroupVisitBookingRow[] | undefined {
  return groupVisitCache.get(groupBookingId.trim());
}

export function primeGroupVisitBookings(groupBookingId: string, rows: GroupVisitBookingRow[]): void {
  const gid = groupBookingId.trim();
  if (!gid || rows.length === 0) return;
  groupVisitCache.set(gid, sortGroupVisitRows(rows));
}

export function invalidateGroupVisitBookings(groupBookingId: string): void {
  groupVisitCache.delete(groupBookingId.trim());
  groupVisitFetchInFlight.delete(groupBookingId.trim());
}

/** Prime cache from any bookings list response (day sheet, appointments, calendar). */
export function primeGroupVisitBookingsFromListSeeds(rows: GroupVisitListSeed[]): void {
  const byGroup = new Map<string, GroupVisitBookingRow[]>();
  for (const row of rows) {
    const gid = row.group_booking_id?.trim();
    if (!gid) continue;
    const list = byGroup.get(gid) ?? [];
    list.push(mapGroupVisitListSeed(row));
    byGroup.set(gid, list);
  }
  for (const [gid, segments] of byGroup) {
    if (segments.length >= 2) {
      primeGroupVisitBookings(gid, segments);
    }
  }
}

/** Prefer cached / in-memory list data; falls back to undefined when only one segment is known. */
export function resolveInitialGroupVisitBookings(
  rows: GroupVisitListSeed[],
  groupBookingId: string | null | undefined,
): GroupVisitBookingRow[] | undefined {
  const gid = groupBookingId?.trim();
  if (!gid) return undefined;
  const cached = peekGroupVisitBookings(gid);
  if (cached && cached.length > 1) return cached;
  const fromList = groupVisitSegmentsFromList(rows, gid);
  if (fromList.length > 1) {
    primeGroupVisitBookings(gid, fromList);
    return fromList;
  }
  return undefined;
}

export async function fetchGroupVisitBookings(groupBookingId: string): Promise<GroupVisitBookingRow[]> {
  const gid = groupBookingId.trim();
  if (!gid) return [];

  const inFlight = groupVisitFetchInFlight.get(gid);
  if (inFlight) return inFlight;

  const promise = fetch(`/api/venue/bookings/list?group_booking_id=${encodeURIComponent(gid)}`)
    .then(async (res) => {
      if (!res.ok) return peekGroupVisitBookings(gid) ?? [];
      const data = (await res.json()) as { bookings?: Record<string, unknown>[] };
      const rows = (data.bookings ?? []).map((b) => mapGroupVisitListRow(b));
      const sorted = sortGroupVisitRows(rows);
      if (sorted.length > 0) {
        primeGroupVisitBookings(gid, sorted);
      }
      return sorted;
    })
    .catch(() => peekGroupVisitBookings(gid) ?? [])
    .finally(() => {
      groupVisitFetchInFlight.delete(gid);
    });

  groupVisitFetchInFlight.set(gid, promise);
  return promise;
}

/** Best-effort prefetch (e.g. row hover before expand). */
export function warmGroupVisitBookings(groupBookingId: string | null | undefined): void {
  const gid = groupBookingId?.trim();
  if (!gid) return;
  const cached = peekGroupVisitBookings(gid);
  if (cached && cached.length > 1) return;
  void fetchGroupVisitBookings(gid);
}
