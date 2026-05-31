import { minutesBetweenStartAndEndHM } from '@/lib/booking/validate-appointment-modification';
import { isAttendanceConfirmed } from '@/lib/booking/booking-staff-indicators';

/** Row shape for “Services in this visit” / group dining linked bookings. */
export interface GroupVisitBookingRow {
  id: string;
  booking_time: string;
  booking_end_time: string | null;
  status: string;
  guest_attendance_confirmed_at?: string | null;
  staff_attendance_confirmed_at?: string | null;
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

/** Apply the same lifecycle status to every segment in a multi-service visit (optimistic UI). */
export function applyStatusToAllGroupVisitRows(
  rows: GroupVisitBookingRow[],
  status: string,
): GroupVisitBookingRow[] {
  return rows.map((row) => (row.status === status ? row : { ...row, status }));
}

const VISIT_STATUS_RANK: Record<string, number> = {
  Pending: 0,
  'Deposit Pending': 0,
  Booked: 1,
  Confirmed: 2,
  Arrived: 2,
  Seated: 3,
  Started: 3,
  Completed: 4,
  'No-Show': 5,
  Cancelled: 6,
};

/** When two sources disagree, keep the further-along lifecycle (avoids stale list seeds regressing Confirmed → Booked). */
export function preferLaterBookingStatus(a: string, b: string): string {
  const ra = VISIT_STATUS_RANK[a] ?? -1;
  const rb = VISIT_STATUS_RANK[b] ?? -1;
  if (ra === rb) return a;
  return rb > ra ? b : a;
}

/** Status shown on visit segment pills — never below the expanded row’s effective status. */
export function resolveGroupVisitSegmentDisplayStatus(
  segmentStatus: string,
  anchorStatus: string,
): string {
  return preferLaterBookingStatus(segmentStatus, anchorStatus);
}

/** Visit-wide anchor for segment pills (expanded row + every loaded segment). */
export function resolveVisitPillAnchorStatus(
  anchorStatus: string,
  segments: ReadonlyArray<Pick<GroupVisitBookingRow, 'status'>>,
  visitAttendanceConfirmed: boolean,
): string {
  let anchor = anchorStatus;
  if (visitAttendanceConfirmed) {
    anchor = preferLaterBookingStatus(anchor, 'Confirmed');
  }
  for (const seg of segments) {
    anchor = preferLaterBookingStatus(anchor, seg.status);
  }
  return anchor;
}

/** Lifecycle status for a visit segment pill (attendance timestamps + visit anchor). */
export function groupVisitSegmentPillStatus(
  segment: Pick<
    GroupVisitBookingRow,
    'status' | 'guest_attendance_confirmed_at' | 'staff_attendance_confirmed_at'
  >,
  visitAnchorStatus: string,
  visitAttendanceConfirmed: boolean,
): string {
  let status = segment.status;
  if (isAttendanceConfirmed(segment)) {
    status = preferLaterBookingStatus(status, 'Confirmed');
  }
  if (visitAttendanceConfirmed) {
    status = preferLaterBookingStatus(status, 'Confirmed');
  }
  return resolveGroupVisitSegmentDisplayStatus(status, visitAnchorStatus);
}

/** Merge fetched visit rows with in-memory rows without regressing lifecycle status. */
export function mergePreferLaterGroupVisitRows(
  previous: GroupVisitBookingRow[],
  fetched: GroupVisitBookingRow[],
): GroupVisitBookingRow[] {
  if (fetched.length === 0) return previous;
  if (previous.length === 0) return fetched;
  const byId = new Map<string, GroupVisitBookingRow>();
  for (const row of [...previous, ...fetched]) {
    const existing = byId.get(row.id);
    if (!existing) {
      byId.set(row.id, row);
      continue;
    }
    byId.set(row.id, {
      ...existing,
      ...row,
      status: preferLaterBookingStatus(existing.status, row.status),
      guest_attendance_confirmed_at:
        row.guest_attendance_confirmed_at ?? existing.guest_attendance_confirmed_at ?? null,
      staff_attendance_confirmed_at:
        row.staff_attendance_confirmed_at ?? existing.staff_attendance_confirmed_at ?? null,
    });
  }
  return sortGroupVisitRows([...byId.values()]);
}

/** Optimistic visit confirm: every pre-arrival segment shows Confirmed in the visit card. */
export function applyVisitAttendanceConfirmToGroupVisitRows(
  rows: GroupVisitBookingRow[],
  confirmed: boolean,
): GroupVisitBookingRow[] {
  const confirmedAt = confirmed ? new Date().toISOString() : null;
  return rows.map((row) => {
    if (confirmed) {
      if (row.status === 'Booked' || row.status === 'Pending' || row.status === 'Deposit Pending') {
        return {
          ...row,
          status: 'Confirmed',
          staff_attendance_confirmed_at: confirmedAt,
          guest_attendance_confirmed_at: null,
        };
      }
      return row;
    }
    if (row.status === 'Confirmed') {
      return {
        ...row,
        status: 'Booked',
        staff_attendance_confirmed_at: null,
        guest_attendance_confirmed_at: null,
      };
    }
    return {
      ...row,
      staff_attendance_confirmed_at: null,
      guest_attendance_confirmed_at: null,
    };
  });
}

/** Prefer fresher `status` from parent list rows when the group-visit cache lags. */
export function mergeGroupVisitRowsWithSeeds(
  rows: GroupVisitBookingRow[],
  seeds: Array<Pick<GroupVisitListSeed, 'id' | 'status'>>,
): GroupVisitBookingRow[] {
  if (rows.length === 0 || seeds.length === 0) return rows;
  const statusById = new Map(seeds.map((s) => [s.id, s.status]));
  return rows.map((row) => {
    const seedStatus = statusById.get(row.id);
    if (seedStatus === undefined) return row;
    const merged = preferLaterBookingStatus(row.status, seedStatus);
    return merged === row.status ? row : { ...row, status: merged };
  });
}

/**
 * Short date phrase for “N consecutive services …” copy.
 * Returns `today`, `tomorrow`, or `on Mon, 3 Jun` (no “on” for relative days).
 */
export function multiServiceVisitDatePhrase(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return `on ${isoDate}`;
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'today';
  if (d.toDateString() === tomorrow.toDateString()) return 'tomorrow';
  const label = d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return `on ${label}`;
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
    guest_attendance_confirmed_at:
      typeof raw.guest_attendance_confirmed_at === 'string' && raw.guest_attendance_confirmed_at.trim()
        ? raw.guest_attendance_confirmed_at
        : null,
    staff_attendance_confirmed_at:
      typeof raw.staff_attendance_confirmed_at === 'string' && raw.staff_attendance_confirmed_at.trim()
        ? raw.staff_attendance_confirmed_at
        : null,
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

  const promise = fetch(
    `/api/venue/bookings/list?group_booking_id=${encodeURIComponent(gid)}&_=${Date.now()}`,
  )
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
