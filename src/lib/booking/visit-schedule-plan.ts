/**
 * What a visit's rows must become for a schedule edit, worked out in one place.
 *
 * A multi-service visit is N rows sharing a `group_booking_id`, and since
 * Docs/visit-services-independent-plan.md each row keeps its own date, start,
 * calendar and length. A schedule edit is therefore one of two things:
 *
 *  - a SHIFT: every scheduled row moves by the same amount as the visit's
 *    earliest row, keeping every gap and every cross-day offset, and a calendar
 *    given here applies to all of them;
 *  - a per-SERVICE edit: named rows take exactly the date, start, calendar and
 *    length asked for, and rows not named are left where they are.
 *
 * Nothing here re-lays services against each other any more: an edit that
 * shortens one service does not pull the next one forward, and a gap between
 * two services is theirs to keep. The arithmetic lives away from any request so
 * the endpoint that writes a visit and the tests that pin its behaviour judge
 * one plan.
 */
import { MIN_APPOINTMENT_CORE_DURATION_MINUTES } from '@/lib/availability/appointment-engine';

export interface VisitScheduleRow {
  id: string;
  /** Venue-local date, YYYY-MM-DD. */
  booking_date: string;
  /** Venue-local start, HH:mm or HH:mm:ss. */
  booking_time: string;
  /** Venue-local wall-clock end of the bookable segment. */
  booking_end_time?: string | null;
  /** The calendar the row sits on (unified `calendar_id`, else legacy `practitioner_id`). */
  calendar_id: string | null;
  group_booking_id?: string | null;
  /** Set only on a multi-PERSON party, which shares a group id but is not a visit. */
  person_label?: string | null;
  booking_item_name?: string | null;
  /** Minutes a row with no end time occupies, add-ons only. */
  addons_total_duration_minutes?: number | null;
}

/** Where one service sits: a date, a start, a length and a calendar. */
export interface VisitServiceSlot {
  dateYmd: string;
  startHm: string;
  endHm: string;
  durationMinutes: number;
  calendarId: string | null;
}

export interface PlannedVisitService extends VisitServiceSlot {
  id: string;
  name: string | null;
  /** The slot this service holds today, so a caller can write only what changed. */
  previous: VisitServiceSlot;
  /** Date or start differs from today's. */
  moved: boolean;
  calendarChanged: boolean;
  durationChanged: boolean;
  /** Any of the three. */
  changed: boolean;
}

export interface VisitSchedulePlan {
  /** Every scheduled service, earliest first by its NEW date and start. */
  services: PlannedVisitService[];
  /** The earliest service's new slot. */
  startDateYmd: string;
  startHm: string;
  /** The latest service's new end. */
  endDateYmd: string;
  endHm: string;
  /** Wall-clock span from the earliest start to the latest end, days included. */
  totalMinutes: number;
  /** The earliest service's new calendar. */
  calendarId: string | null;
  changed: boolean;
  /** Some service's date or start changed, which is what the guest is told about. */
  startChanged: boolean;
  /** The visit's earliest slot itself moved, which is what its cancellation deadline hangs on. */
  visitStartChanged: boolean;
}

export type VisitSchedulePlanReason =
  | 'empty'
  | 'not_a_visit'
  | 'stale_visit'
  | 'unknown_service'
  | 'duplicate_service'
  | 'nothing_to_change';

export type VisitSchedulePlanResult =
  | { ok: true; plan: VisitSchedulePlan }
  | { ok: false; code: VisitSchedulePlanReason; reason: string };

export interface VisitShiftRequest {
  /** New date for the visit's earliest service; the rest keep their offset from it. */
  booking_date?: string | null;
  /** New start for the visit's earliest service, HH:mm or HH:mm:ss. */
  booking_time?: string | null;
  /** Applied to EVERY service when given. */
  practitioner_id?: string | null;
}

export interface VisitServiceScheduleRequest {
  booking_id: string;
  booking_date?: string | null;
  booking_time?: string | null;
  practitioner_id?: string | null;
  duration_minutes?: number | null;
}

const MINUTES_PER_DAY = 24 * 60;

function toHm(raw: string): string {
  return String(raw ?? '').slice(0, 5);
}

function hmToMinutes(hm: string): number {
  const [h, m] = toHm(hm).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function minutesToHm(mins: number): string {
  const wrapped = ((mins % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

/** Days since the epoch for a YYYY-MM-DD, with no time zone in the way. */
function dayNumber(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86_400_000);
}

function dayNumberToYmd(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/** Minutes since the epoch for a venue-local date and time, so day boundaries are plain arithmetic. */
function absoluteMinutes(ymd: string, hm: string): number {
  return dayNumber(ymd) * MINUTES_PER_DAY + hmToMinutes(hm);
}

function fromAbsoluteMinutes(abs: number): { dateYmd: string; hm: string } {
  const day = Math.floor(abs / MINUTES_PER_DAY);
  return { dateYmd: dayNumberToYmd(day), hm: minutesToHm(abs - day * MINUTES_PER_DAY) };
}

/** Minutes from a start to an end on the same row, tolerating a row that runs past midnight. */
function rowDurationMinutes(row: VisitScheduleRow): number {
  if (row.booking_end_time) {
    const d = hmToMinutes(row.booking_end_time) - hmToMinutes(row.booking_time);
    return d < 0 ? d + MINUTES_PER_DAY : d;
  }
  return Math.max(0, Math.round(row.addons_total_duration_minutes ?? 0));
}

function currentSlot(row: VisitScheduleRow): VisitServiceSlot {
  const durationMinutes = rowDurationMinutes(row);
  const startHm = toHm(row.booking_time);
  return {
    dateYmd: row.booking_date,
    startHm,
    endHm: minutesToHm(hmToMinutes(startHm) + durationMinutes),
    durationMinutes,
    calendarId: row.calendar_id ?? null,
  };
}

function sameSlot(a: VisitServiceSlot, b: VisitServiceSlot): boolean {
  return (
    a.dateYmd === b.dateYmd &&
    a.startHm === b.startHm &&
    a.durationMinutes === b.durationMinutes &&
    a.calendarId === b.calendarId
  );
}

function slotAt(abs: number, durationMinutes: number, calendarId: string | null): VisitServiceSlot {
  const start = fromAbsoluteMinutes(abs);
  return {
    dateYmd: start.dateYmd,
    startHm: start.hm,
    endHm: minutesToHm(hmToMinutes(start.hm) + durationMinutes),
    durationMinutes,
    calendarId,
  };
}

/**
 * Refuses what is not one visit. `group_booking_id` carries multi-person parties
 * too, and a party must never be moved as one appointment.
 */
function refuseUnlessVisit(rows: readonly VisitScheduleRow[]): VisitSchedulePlanResult | null {
  if (rows.length === 0) {
    return { ok: false, code: 'empty', reason: 'This visit has no services to move.' };
  }
  const party = rows.some((r) => Boolean(r.person_label?.trim()));
  const groupIds = new Set(rows.map((r) => r.group_booking_id?.trim() || ''));
  if (party || groupIds.size !== 1) {
    return {
      ok: false,
      code: 'not_a_visit',
      reason: 'These bookings are not a single visit, so they cannot be moved as one.',
    };
  }
  return null;
}

/**
 * Plan a visit's new layout.
 *
 * Exactly one of `shift` and `services` is applied; `shift` when both are
 * given. `knownBookingIds`, when given, must name exactly the scheduled rows
 * the visit has now: a caller planning against a visit that has since gained
 * or lost a service is told so rather than having its edit land on rows it
 * never saw.
 */
export function planVisitSchedule(params: {
  rows: readonly VisitScheduleRow[];
  shift?: VisitShiftRequest | null;
  services?: readonly VisitServiceScheduleRequest[] | null;
  knownBookingIds?: readonly string[] | null;
}): VisitSchedulePlanResult {
  const { rows, shift, services, knownBookingIds } = params;
  const refused = refuseUnlessVisit(rows);
  if (refused) return refused;

  if (knownBookingIds) {
    const current = new Set(rows.map((r) => r.id));
    const known = new Set(knownBookingIds);
    if (current.size !== known.size || [...current].some((id) => !known.has(id))) {
      return {
        ok: false,
        code: 'stale_visit',
        reason: 'This visit was changed somewhere else. Refresh and try again.',
      };
    }
  }

  const ordered = [...rows].sort(
    (a, b) =>
      absoluteMinutes(a.booking_date, a.booking_time) -
      absoluteMinutes(b.booking_date, b.booking_time),
  );
  const previousById = new Map(ordered.map((r) => [r.id, currentSlot(r)]));
  const nextById = new Map<string, VisitServiceSlot>();

  if (shift) {
    const earliest = ordered[0]!;
    const earliestAbs = absoluteMinutes(earliest.booking_date, earliest.booking_time);
    const targetDate =
      typeof shift.booking_date === 'string' && shift.booking_date.trim() !== ''
        ? shift.booking_date
        : earliest.booking_date;
    const targetHm =
      typeof shift.booking_time === 'string' && shift.booking_time.trim() !== ''
        ? toHm(shift.booking_time)
        : toHm(earliest.booking_time);
    const delta = absoluteMinutes(targetDate, targetHm) - earliestAbs;
    const calendarId =
      typeof shift.practitioner_id === 'string' && shift.practitioner_id.trim() !== ''
        ? shift.practitioner_id
        : null;
    for (const row of ordered) {
      const prev = previousById.get(row.id)!;
      nextById.set(
        row.id,
        slotAt(
          absoluteMinutes(row.booking_date, row.booking_time) + delta,
          prev.durationMinutes,
          calendarId ?? prev.calendarId,
        ),
      );
    }
  } else if (services) {
    if (services.length === 0) {
      return { ok: false, code: 'nothing_to_change', reason: 'Nothing to change.' };
    }
    const seen = new Set<string>();
    for (const edit of services) {
      const row = previousById.get(edit.booking_id);
      if (!row) {
        return {
          ok: false,
          code: 'unknown_service',
          reason: 'One of these services is not on this visit any more. Refresh and try again.',
        };
      }
      if (seen.has(edit.booking_id)) {
        return {
          ok: false,
          code: 'duplicate_service',
          reason: 'A service was named twice in this change.',
        };
      }
      seen.add(edit.booking_id);
      const dateYmd =
        typeof edit.booking_date === 'string' && edit.booking_date.trim() !== ''
          ? edit.booking_date
          : row.dateYmd;
      const startHm =
        typeof edit.booking_time === 'string' && edit.booking_time.trim() !== ''
          ? toHm(edit.booking_time)
          : row.startHm;
      const durationMinutes =
        typeof edit.duration_minutes === 'number' && Number.isFinite(edit.duration_minutes)
          ? Math.max(MIN_APPOINTMENT_CORE_DURATION_MINUTES, Math.round(edit.duration_minutes))
          : row.durationMinutes;
      const calendarId =
        typeof edit.practitioner_id === 'string' && edit.practitioner_id.trim() !== ''
          ? edit.practitioner_id
          : row.calendarId;
      nextById.set(edit.booking_id, slotAt(absoluteMinutes(dateYmd, startHm), durationMinutes, calendarId));
    }
    for (const row of ordered) {
      if (!nextById.has(row.id)) nextById.set(row.id, previousById.get(row.id)!);
    }
  } else {
    return { ok: false, code: 'nothing_to_change', reason: 'Nothing to change.' };
  }

  const planned: PlannedVisitService[] = ordered.map((row) => {
    const previous = previousById.get(row.id)!;
    const next = nextById.get(row.id)!;
    const moved = next.dateYmd !== previous.dateYmd || next.startHm !== previous.startHm;
    const calendarChanged = next.calendarId !== previous.calendarId;
    const durationChanged = next.durationMinutes !== previous.durationMinutes;
    return {
      id: row.id,
      name: row.booking_item_name ?? null,
      ...next,
      previous,
      moved,
      calendarChanged,
      durationChanged,
      changed: !sameSlot(next, previous),
    };
  });
  planned.sort(
    (a, b) => absoluteMinutes(a.dateYmd, a.startHm) - absoluteMinutes(b.dateYmd, b.startHm),
  );

  const first = planned[0]!;
  const lastEndAbs = Math.max(
    ...planned.map((s) => absoluteMinutes(s.dateYmd, s.startHm) + s.durationMinutes),
  );
  const end = fromAbsoluteMinutes(lastEndAbs);
  const previousFirst = [...previousById.values()].sort(
    (a, b) => absoluteMinutes(a.dateYmd, a.startHm) - absoluteMinutes(b.dateYmd, b.startHm),
  )[0]!;

  return {
    ok: true,
    plan: {
      services: planned,
      startDateYmd: first.dateYmd,
      startHm: first.startHm,
      endDateYmd: end.dateYmd,
      endHm: end.hm,
      totalMinutes: lastEndAbs - absoluteMinutes(first.dateYmd, first.startHm),
      calendarId: first.calendarId,
      changed: planned.some((s) => s.changed),
      startChanged: planned.some((s) => s.moved),
      visitStartChanged:
        first.dateYmd !== previousFirst.dateYmd || first.startHm !== previousFirst.startHm,
    },
  };
}
