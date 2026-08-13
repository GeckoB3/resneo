/**
 * What a visit's rows must become for a schedule edit, worked out in one place.
 *
 * A multi-service visit is N rows, so moving it or changing its length rewrites
 * every one of them. Doing that as N client PATCHes is what tore a visit on the
 * calendar: one service landed somewhere the engine refused and the rest went
 * anyway, leaving a booking that ran 10:11 to 18:16 (fixed in 281d1d8d by
 * checking every service before moving any). The modify form's duration control
 * has the same shape of problem waiting for it.
 *
 * The arithmetic lives here, away from any request, so the endpoint that writes
 * a visit and the tests that pin its behaviour judge one plan. The re-laying
 * itself is `resequenceVisit` / `distributeVisitDuration`, which the calendar
 * already uses: this only decides what to ask them for and what to refuse.
 */

import {
  distributeVisitDuration,
  minimumVisitMinutes,
  resequenceVisit,
  resolveAppointmentVisit,
  type AppointmentVisit,
  type VisitServiceRow,
  type VisitServiceSchedule,
} from './appointment-visit';

/** One service's slot before and after the edit. */
export interface PlannedVisitService extends VisitServiceSchedule {
  /** The slot this service holds today, so a caller can write only what moved. */
  previous: { startHm: string; endHm: string; durationMinutes: number };
  changed: boolean;
}

export interface VisitSchedulePlan {
  visit: AppointmentVisit;
  /** Every service, earliest first. Unchanged services are included. */
  services: PlannedVisitService[];
  startHm: string;
  endHm: string;
  /** Wall-clock span from the first service's start to the last one's end. */
  totalMinutes: number;
  /** False when the request asks for the shape the visit already has. */
  changed: boolean;
}

export type VisitSchedulePlanResult =
  | { ok: true; plan: VisitSchedulePlan }
  | { ok: false; reason: string };

function hmToMinutes(hm: string): number {
  const [h, m] = hm.slice(0, 5).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Plan a visit's new layout.
 *
 * `startHm` moves the visit; `totalDurationMinutes` sets its wall-clock span.
 * Either may be omitted to keep what the rows already have, and passing neither
 * is legitimate: it re-lays the visit, which closes any dead time an earlier
 * per-service edit left behind (the 11:30 to 11:45 hole in the reported
 * booking). Configured gaps are preserved by `resequenceVisit` throughout.
 */
export function planVisitSchedule(params: {
  rows: readonly VisitServiceRow[];
  /** New visit start, HH:mm or HH:mm:ss. */
  startHm?: string | null;
  /** New wall-clock span for the whole visit, gaps included. */
  totalDurationMinutes?: number | null;
}): VisitSchedulePlanResult {
  const { rows, startHm, totalDurationMinutes } = params;

  if (rows.length === 0) {
    return { ok: false, reason: 'This visit has no services to move.' };
  }

  const visit = resolveAppointmentVisit(rows);
  if (!visit) {
    /**
     * `group_booking_id` carries multi-person parties too, and they must never
     * be re-laid as one appointment: four guests at 10:00 would come out as
     * four consecutive bookings.
     */
    return {
      ok: false,
      reason: 'These bookings are not a single visit, so they cannot be moved as one.',
    };
  }

  const targetStartHm =
    typeof startHm === 'string' && startHm.trim() !== '' ? startHm.slice(0, 5) : visit.startHm;

  let durations = new Map(visit.services.map((s) => [s.id, s.durationMinutes]));
  if (typeof totalDurationMinutes === 'number') {
    const floor = minimumVisitMinutes(visit);
    if (!Number.isFinite(totalDurationMinutes) || Math.round(totalDurationMinutes) < floor) {
      /**
       * `distributeVisitDuration` clamps at the floor rather than refusing, so
       * asking for less would quietly return a longer visit than the caller
       * asked for. Say what the floor is instead.
       */
      return {
        ok: false,
        reason: `This visit cannot be shorter than ${floor} minutes with the services it has.`,
      };
    }
    durations = distributeVisitDuration(visit, Math.round(totalDurationMinutes));
  }

  const laid = resequenceVisit(visit, durations, targetStartHm);
  const byId = new Map(visit.services.map((s) => [s.id, s]));

  const services: PlannedVisitService[] = laid.map((s) => {
    const before = byId.get(s.id)!;
    return {
      ...s,
      previous: {
        startHm: before.startHm,
        endHm: before.endHm,
        durationMinutes: before.durationMinutes,
      },
      changed:
        s.startHm !== before.startHm ||
        s.endHm !== before.endHm ||
        s.durationMinutes !== before.durationMinutes,
    };
  });

  const first = services[0]!;
  const last = services[services.length - 1]!;
  const span = hmToMinutes(last.endHm) - hmToMinutes(first.startHm);

  return {
    ok: true,
    plan: {
      visit,
      services,
      startHm: first.startHm,
      endHm: last.endHm,
      totalMinutes: span < 0 ? span + 1440 : span,
      changed: services.some((s) => s.changed),
    },
  };
}
