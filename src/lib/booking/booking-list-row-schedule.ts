import { bookingDisplayEndHm } from '@/lib/booking/booking-detail-from-row';
import {
  formatDurationMinutesLabel,
  formatGroupVisitSegmentDurationLabel,
  groupVisitRowsToScheduleSeeds,
  peekGroupVisitBookings,
} from '@/lib/booking/group-visit-bookings';
import { minutesBetweenStartAndEndHM } from '@/lib/booking/validate-appointment-modification';

/** Fields available on dashboard booking list rows for bar time/duration. */
export interface BookingListRowScheduleSeed {
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

  const inView = allRowsInView.filter((r) => r.group_booking_id?.trim() === groupId);
  if (inView.length > 1) return inView;

  const cached = peekGroupVisitBookings(groupId);
  if (cached && cached.length > 1) {
    return groupVisitRowsToScheduleSeeds(cached);
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
