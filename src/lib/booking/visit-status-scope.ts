/**
 * Which status changes apply to a whole multi-service visit, and which to one service.
 *
 * A visit is one booking made of independent services (Docs/visit-services-independent-plan.md).
 * Confirming the booking, marking the client arrived, cancelling and a no-show are facts
 * about the visit: one client, one appointment in their diary. Starting and completing
 * are facts about a service: a colour can be finished while the cut has not begun, and
 * staff want the diary to say so.
 *
 * `PATCH /api/venue/bookings/[id]` used to cascade every lifecycle status across the visit
 * (`applyGroupBookingStatusChange`), so Start on one service started all of them. This is
 * the rule it now consults; Cancelled and No-Show keep their own cascade paths.
 */

import type { BookingStatus } from '@/lib/table-management/booking-status';

/** Lifecycle statuses that belong to one service rather than the visit. */
const SERVICE_LEVEL_STATUSES: ReadonlySet<string> = new Set(['Seated', 'Completed']);

/**
 * True when moving `previous` to `next` should be written to every service of the visit.
 *
 * Forward to Confirmed cascades. The revert of a confirm (Confirmed back to Booked)
 * cascades too, because it undoes a visit-wide fact. Anything into or out of Seated or
 * Completed is one service's: Start, Complete, Undo start (Seated to Booked or Confirmed)
 * and Undo complete (Completed to Seated).
 */
export function statusChangeCascadesAcrossVisit(previous: string, next: BookingStatus | string): boolean {
  if (SERVICE_LEVEL_STATUSES.has(next)) return false;
  if (SERVICE_LEVEL_STATUSES.has(previous)) return false;
  return true;
}

/** True when the status is one a single service carries on its own. */
export function isServiceLevelStatus(status: string | null | undefined): boolean {
  return status != null && SERVICE_LEVEL_STATUSES.has(status);
}
