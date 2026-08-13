/**
 * A multi-service visit as one booking.
 *
 * A visit is stored as N rows in `bookings` sharing a `group_booking_id`. Only
 * the calendar ever merged them, so the detail panel and the modify form each
 * opened a single row: a three service visit showed one service's time and one
 * service's duration, and the bar had no duration control at all.
 *
 * Everything that presents or edits a visit reads through here, so the rows stay
 * an implementation detail (as they already are for price, which has been
 * visit-level all along).
 *
 * See Docs/multi-service-visit-plan.md.
 */

/** The smallest a service may be, matching the appointment engine's floor. */
import { MIN_APPOINTMENT_CORE_DURATION_MINUTES } from '@/lib/availability/appointment-engine';

export interface VisitServiceRow {
  id: string;
  /** Venue-local start, HH:mm or HH:mm:ss. */
  booking_time: string;
  /** Venue-local wall-clock end of the bookable segment. */
  booking_end_time?: string | null;
  group_booking_id?: string | null;
  /**
   * Set only on multi-PERSON group bookings (a party). Its presence is what
   * separates a party from a multi-service visit; they share the same column.
   */
  person_label?: string | null;
  booking_item_name?: string | null;
  service_variant_name?: string | null;
  addons_total_duration_minutes?: number | null;
  /**
   * The service's catalogue buffer, which is the gap this service is SUPPOSED to
   * leave after it. Undefined when the caller could not look the service up, in
   * which case the observed gap is preserved rather than guessed at.
   */
  buffer_minutes?: number | null;
}

export interface VisitService {
  id: string;
  name: string | null;
  startHm: string;
  endHm: string;
  /** Wall-clock minutes this service occupies, add-on minutes included. */
  durationMinutes: number;
  /**
   * Minutes actually observed between this service's end and the next one's
   * start. Zero on the tail.
   */
  gapAfterMinutes: number;
  /**
   * The gap this service is entitled to (its catalogue buffer). Preserved by
   * every edit.
   */
  expectedGapAfterMinutes: number;
  /**
   * Dead time beyond the buffer, left behind by an edit that shortened a service
   * without moving the ones after it. Closed by the next edit; never preserved.
   */
  orphanedGapAfterMinutes: number;
}

export interface AppointmentVisit {
  groupBookingId: string | null;
  services: VisitService[];
  startHm: string;
  endHm: string;
  /** Wall-clock span from the first service's start to the last one's end. */
  totalMinutes: number;
  /** Sum of the services themselves, excluding the gaps between them. */
  serviceMinutes: number;
}

function toHm(raw: string): string {
  return String(raw ?? '').slice(0, 5);
}

function hmToMinutes(hm: string): number {
  const [h, m] = toHm(hm).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function minutesToHm(mins: number): string {
  const wrapped = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Minutes from start to end, tolerating a visit that runs past midnight. */
function spanMinutes(startHm: string, endHm: string): number {
  const d = hmToMinutes(endHm) - hmToMinutes(startHm);
  return d < 0 ? d + 1440 : d;
}

/**
 * True when these rows are one guest's several services rather than a party.
 *
 * A party shares the same `group_booking_id`, so treating every group as a visit
 * would merge four people's bookings into one appointment.
 */
export function isServiceVisit(rows: readonly VisitServiceRow[]): boolean {
  if (rows.length === 0) return false;
  return !rows.some((r) => Boolean(r.person_label?.trim()));
}

/**
 * Builds the visit view of a set of rows, or null when they are not one.
 *
 * Returns null for a party, for an empty set, and for rows that do not share a
 * `group_booking_id`, so callers cannot accidentally present unrelated bookings
 * as a single visit.
 */
export function resolveAppointmentVisit(
  rows: readonly VisitServiceRow[],
): AppointmentVisit | null {
  if (rows.length === 0 || !isServiceVisit(rows)) return null;

  const groupIds = new Set(rows.map((r) => r.group_booking_id?.trim() || ''));
  if (groupIds.size !== 1) return null;
  const groupBookingId = [...groupIds][0] || null;

  const ordered = [...rows].sort(
    (a, b) => hmToMinutes(a.booking_time) - hmToMinutes(b.booking_time),
  );

  const services: VisitService[] = ordered.map((row, i) => {
    const startHm = toHm(row.booking_time);
    const addonMinutes = Math.max(0, Math.round(row.addons_total_duration_minutes ?? 0));
    const endHm = row.booking_end_time
      ? toHm(row.booking_end_time)
      : minutesToHm(hmToMinutes(startHm) + addonMinutes);
    const next = ordered[i + 1];
    const gapAfterMinutes = next ? spanMinutes(endHm, toHm(next.booking_time)) : 0;
    /**
     * A gap and a hole look identical in the rows: both are dead time between
     * two services. The catalogue buffer is what separates them. Without it the
     * observed gap is treated as intentional, so a missing lookup can never
     * silently delete a buffer a service genuinely needs.
     */
    const buffer = row.buffer_minutes;
    const expectedGapAfterMinutes = !next
      ? 0
      : typeof buffer === 'number' && Number.isFinite(buffer)
        ? Math.max(0, Math.round(buffer))
        : gapAfterMinutes;
    return {
      id: row.id,
      name: row.booking_item_name ?? null,
      startHm,
      endHm,
      durationMinutes: spanMinutes(startHm, endHm),
      gapAfterMinutes,
      expectedGapAfterMinutes,
      orphanedGapAfterMinutes: Math.max(0, gapAfterMinutes - expectedGapAfterMinutes),
    };
  });

  const startHm = services[0]!.startHm;
  const endHm = services[services.length - 1]!.endHm;

  return {
    groupBookingId,
    services,
    startHm,
    endHm,
    totalMinutes: spanMinutes(startHm, endHm),
    serviceMinutes: services.reduce((sum, s) => sum + s.durationMinutes, 0),
  };
}

/** One service's new schedule after a visit-level edit. */
export interface VisitServiceSchedule {
  id: string;
  startHm: string;
  endHm: string;
  durationMinutes: number;
}

/**
 * Re-lays a visit's services end to end, preserving each configured gap.
 *
 * Every edit goes through this, which is what stops a hole appearing: shortening
 * a service used to leave the ones after it where they were, so the Fri 14 Aug
 * visit ended up with 15 minutes of dead time between Olaplex and Toner.
 */
export function resequenceVisit(
  visit: AppointmentVisit,
  durations: ReadonlyMap<string, number>,
  startHm: string = visit.startHm,
): VisitServiceSchedule[] {
  let cursor = hmToMinutes(startHm);
  return visit.services.map((s) => {
    const duration = Math.max(
      MIN_APPOINTMENT_CORE_DURATION_MINUTES,
      Math.round(durations.get(s.id) ?? s.durationMinutes),
    );
    const start = cursor;
    cursor = start + duration + s.expectedGapAfterMinutes;
    return {
      id: s.id,
      startHm: minutesToHm(start),
      endHm: minutesToHm(start + duration),
      durationMinutes: duration,
    };
  });
}

/** The shortest a visit can be: every service at its floor, gaps preserved. */
export function minimumVisitMinutes(visit: AppointmentVisit): number {
  const gaps = visit.services.reduce((sum, s) => sum + s.expectedGapAfterMinutes, 0);
  return visit.services.length * MIN_APPOINTMENT_CORE_DURATION_MINUTES + gaps;
}

/**
 * Distributes a new total wall-clock span across a visit's services.
 *
 * Growth always extends the tail. Shrinkage comes off the tail first, and once
 * that reaches its floor it cascades backwards through the earlier services,
 * each down to its own floor. Configured gaps are never consumed: they belong to
 * the services' buffer and processing settings, and eating them would silently
 * delete a window the service actually needs.
 */
export function distributeVisitDuration(
  visit: AppointmentVisit,
  requestedTotalMinutes: number,
): Map<string, number> {
  const durations = new Map<string, number>(
    visit.services.map((s) => [s.id, s.durationMinutes]),
  );
  const gaps = visit.services.reduce((sum, s) => sum + s.expectedGapAfterMinutes, 0);
  const targetServiceMinutes = Math.max(
    visit.services.length * MIN_APPOINTMENT_CORE_DURATION_MINUTES,
    Math.round(requestedTotalMinutes) - gaps,
  );

  let delta = targetServiceMinutes - visit.serviceMinutes;
  if (delta === 0) return durations;

  const tail = visit.services[visit.services.length - 1]!;
  if (delta > 0) {
    durations.set(tail.id, tail.durationMinutes + delta);
    return durations;
  }

  // Shrinking: tail first, then backwards, each service to its own floor.
  for (let i = visit.services.length - 1; i >= 0 && delta < 0; i -= 1) {
    const s = visit.services[i]!;
    const current = durations.get(s.id)!;
    const canGive = current - MIN_APPOINTMENT_CORE_DURATION_MINUTES;
    if (canGive <= 0) continue;
    const take = Math.min(canGive, -delta);
    durations.set(s.id, current - take);
    delta += take;
  }
  return durations;
}
