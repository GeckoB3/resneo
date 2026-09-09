import { bookingDisplayEndHm } from '@/lib/booking/booking-detail-from-row';
import {
  formatDurationMinutesLabel,
  formatGroupVisitSegmentDurationLabel,
  groupVisitRowsToScheduleSeeds,
  peekGroupVisitBookings,
  visitLifecycleStatus,
} from '@/lib/booking/group-visit-bookings';
import { minutesBetweenStartAndEndHM } from '@/lib/booking/validate-appointment-modification';

/** Fields available on dashboard booking list rows for bar time/duration. */
export interface BookingListRowScheduleSeed {
  /** Each service of a visit has its own date; a bar only spans the services on its own day. */
  booking_date?: string | null;
  booking_time: string;
  booking_end_time?: string | null;
  estimated_end_time?: string | null;
  addons_total_duration_minutes?: number | null;
  group_booking_id?: string | null;
  person_label?: string | null;
}

export interface BookingListBarSchedule {
  timeRangeLabel: string;
  durationBarLabel: string | null;
  durationDetailLabel: string | null;
}

/** Consecutive multi-service visit (not group dining with person_label). */
export function isMultiServiceVisitGroup(
  rows: Array<Pick<BookingListRowScheduleSeed, 'person_label'>>,
): boolean {
  if (rows.length <= 1) return false;
  return rows.every((r) => !r.person_label?.trim());
}

/** A list line that stands for one day of a visit whose other services are on another day. */
export interface VisitListLineMarks {
  /**
   * Set on a line that is one service of a visit with nothing else of that visit on
   * this day in view: the rest of the visit is on another day, and the list says so.
   */
    visit_spans_days?: boolean;
  /**
   * Set on a lone service of a visit whose other services are not in view on
   * any day (cancelled, filtered out, or on a hidden calendar).
   */
  visit_rest_hidden?: boolean;
}

/**
 * Collapse multi-service visits to a single representative row per DAY, so one day of a
 * visit shows as one bar. A multi-service visit is several rows sharing a `group_booking_id`
 * with no per-person `person_label` (one guest, several services). Each service keeps its
 * own date, so a visit split across days shows one line on each of them. Group bookings
 * (distinct people, each with a `person_label`) and class carts are left untouched so they
 * still render as separate bars, as do standalone bookings. The earliest-start segment of
 * the day is kept as the representative, carrying the visit's derived status.
 */
export function collapseMultiServiceVisits<
  T extends {
    id: string;
    booking_date?: string | null;
    booking_time: string;
    group_booking_id?: string | null;
    person_label?: string | null;
    class_instance_id?: string | null;
    status?: string;
  },
>(rows: T[]): Array<T & VisitListLineMarks> {
  const dayKey = (row: T) => `${row.group_booking_id!.trim()}::${row.booking_date ?? ''}`;
  const byGroupDay = new Map<string, T[]>();
  const daysByGroup = new Map<string, Set<string>>();
  for (const row of rows) {
    const gid = row.group_booking_id?.trim();
    if (!gid || row.class_instance_id) continue;
    const key = dayKey(row);
    const list = byGroupDay.get(key) ?? [];
    list.push(row);
    byGroupDay.set(key, list);
    const days = daysByGroup.get(gid) ?? new Set<string>();
    days.add(row.booking_date ?? '');
    daysByGroup.set(gid, days);
  }

  /** group::day -> the single representative row id kept for that day of the visit. */
  const representativeId = new Map<string, string>();
  for (const [key, group] of byGroupDay) {
    if (!isMultiServiceVisitGroup(group)) continue;
    const earliest = [...group].sort((a, b) => a.booking_time.localeCompare(b.booking_time))[0]!;
    representativeId.set(key, earliest.id);
  }

  return rows.flatMap((row): Array<T & VisitListLineMarks> => {
    const gid = row.group_booking_id?.trim();
    if (!gid || row.class_instance_id) return [row];
    const key = dayKey(row);
    const repId = representativeId.get(key);
    if (!repId) {
      /**
       * A lone service of a visit: nothing else of the visit is on this day in view.
       * A party's rows arrive here too and are left alone; only a service of a visit
       * is marked (a standalone booking never carries a group id).
       */
            const group = byGroupDay.get(key) ?? [row];
      const loneVisitService = group.length === 1 && !row.person_label?.trim();
      if (!loneVisitService) return [row];
      const otherDayInView = (daysByGroup.get(gid)?.size ?? 1) > 1;
      return [otherDayInView ? { ...row, visit_spans_days: true } : { ...row, visit_rest_hidden: true }];
    }
    // Multi-service day: keep only the representative.
    if (row.id !== repId) return [];
    const spansDays = (daysByGroup.get(gid)?.size ?? 1) > 1;
    // Start and Complete are per service, so the line's status is the visit's derived
    // one rather than whatever the earliest row happens to be at.
    const group = byGroupDay.get(key) ?? [row];
    const status =
      typeof row.status === 'string'
        ? visitLifecycleStatus(group as Array<{ status: string }>, row.status)
        : row.status;
    return [
      {
        ...row,
        ...(typeof status === 'string' ? { status } : {}),
        ...(spansDays ? { visit_spans_days: true } : {}),
      },
    ];
  });
}

/**
 * Wall-clock span for an entire multi-service visit: first segment start → last segment end.
 */
export function multiServiceVisitWallClockSchedule(
  segments: BookingListRowScheduleSeed[],
): {
  timeRangeLabel: string;
  durationMinutes: number;
  addonsTotalMinutes: number;
} | null {
  if (!isMultiServiceVisitGroup(segments)) return null;

  const sorted = [...segments].sort((a, b) => a.booking_time.localeCompare(b.booking_time));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const start = first.booking_time.slice(0, 5);
  const lastEnd = bookingListRowEndHm(last);
  if (!lastEnd) return null;

  const durationMinutes = minutesBetweenStartAndEndHM(start, lastEnd);
  if (durationMinutes <= 0) return null;

  const addonsTotalMinutes = sorted.reduce(
    (sum, r) => sum + Math.max(0, r.addons_total_duration_minutes ?? 0),
    0,
  );

  return {
    timeRangeLabel: `${start}–${lastEnd}`,
    durationMinutes,
    addonsTotalMinutes,
  };
}

function siblingsForGroupVisitBar(
  row: BookingListRowScheduleSeed,
  allRowsInView: BookingListRowScheduleSeed[],
): BookingListRowScheduleSeed[] {
  const groupId = row.group_booking_id?.trim();
  if (!groupId) return [row];
  // A bar spans one day of the visit: a sibling booked for another day is its own line.
  const sameDay = (r: { booking_date?: string | null }) =>
    !row.booking_date || !r.booking_date || r.booking_date === row.booking_date;
  const inView = allRowsInView.filter((r) => r.group_booking_id?.trim() === groupId && sameDay(r));
  if (inView.length > 1) return inView;
  const cached = peekGroupVisitBookings(groupId);
  if (cached && cached.length > 1) {
    const cachedSameDay = cached.filter(sameDay);
    return groupVisitRowsToScheduleSeeds(cachedSameDay.length > 0 ? cachedSameDay : cached);
  }

  return inView.length > 0 ? inView : [row];
}

/** Time range and duration for a collapsed list bar (single row or full multi-service visit). */
export function resolveBookingListBarSchedule(
  row: BookingListRowScheduleSeed,
  allRowsInView: BookingListRowScheduleSeed[],
  catalogDefaultMinutes?: number | null,
): BookingListBarSchedule {
  const siblings = siblingsForGroupVisitBar(row, allRowsInView);
  const visit = multiServiceVisitWallClockSchedule(siblings);
  if (visit) {
    return {
      timeRangeLabel: visit.timeRangeLabel,
      durationBarLabel: formatDurationMinutesLabel(visit.durationMinutes),
      durationDetailLabel: formatGroupVisitSegmentDurationLabel({
        duration_minutes: visit.durationMinutes,
        addons_total_duration_minutes: visit.addonsTotalMinutes,
      }),
    };
  }

  return {
    timeRangeLabel: bookingListRowTimeRangeLabel(row),
    durationBarLabel: bookingListRowDurationBarLabel(row, catalogDefaultMinutes),
    durationDetailLabel: bookingListRowDurationDetailLabel(row, catalogDefaultMinutes),
  };
}

/** Wall-clock end HH:mm for list bars (end time, then estimated end). */
export function bookingListRowEndHm(row: BookingListRowScheduleSeed): string | null {
  return bookingDisplayEndHm(row);
}

/**
 * Total booked minutes for a list row: wall-clock span when end is known,
 * otherwise catalogue default plus add-on minutes.
 */
export function bookingListRowDurationMinutes(
  row: BookingListRowScheduleSeed,
  catalogDefaultMinutes?: number | null,
): number | null {
  const start = row.booking_time.slice(0, 5);
  const end = bookingListRowEndHm(row);
  if (end) {
    const mins = minutesBetweenStartAndEndHM(start, end);
    if (mins > 0) return mins;
  }
  if (catalogDefaultMinutes != null && catalogDefaultMinutes > 0) {
    const extras = Math.max(0, row.addons_total_duration_minutes ?? 0);
    return catalogDefaultMinutes + extras;
  }
  return null;
}

/** Full duration label (total + extras breakdown) for tooltips / detail. */
export function bookingListRowDurationDetailLabel(
  row: BookingListRowScheduleSeed,
  catalogDefaultMinutes?: number | null,
): string | null {
  const minutes = bookingListRowDurationMinutes(row, catalogDefaultMinutes);
  if (minutes == null || minutes <= 0) return null;
  return formatGroupVisitSegmentDurationLabel({
    duration_minutes: minutes,
    addons_total_duration_minutes: row.addons_total_duration_minutes ?? 0,
  });
}

/** Compact duration for collapsed booking bars. */
export function bookingListRowDurationBarLabel(
  row: BookingListRowScheduleSeed,
  catalogDefaultMinutes?: number | null,
): string | null {
  const minutes = bookingListRowDurationMinutes(row, catalogDefaultMinutes);
  if (minutes == null || minutes <= 0) return null;
  return formatDurationMinutesLabel(minutes);
}

/** `10:00–10:45` for booking bars. */
export function bookingListRowTimeRangeLabel(row: BookingListRowScheduleSeed): string {
  const start = row.booking_time.slice(0, 5);
  const end = bookingListRowEndHm(row);
  return end ? `${start}–${end}` : start;
}
