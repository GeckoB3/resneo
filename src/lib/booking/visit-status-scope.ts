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

/**
 * C12 — true only for a genuine MULTI-SERVICE VISIT, the one kind of group a
 * status change should cascade across.
 *
 * `group_booking_id` carries three meanings, and a null `person_label` alone
 * cannot tell them apart. A CLASS CART is several class sessions bought in one
 * checkout: the rows share a group id and carry no `person_label`, so the
 * old predicate read a cart as a visit. Marking one session a no-show then
 * cascaded to every other session in the basket — including sessions weeks in
 * the FUTURE, since the sibling load applies no status or date filter — and
 * forfeited their deposits.
 *
 * A cart row is a class row; a visit row never is. `class_instance_id` is
 * therefore the discriminator, and it is a cheap one: no column to add, no
 * migration, no backfill.
 *
 * Verified across every writer that sets `bookings.group_booking_id` rather
 * than assumed. The four party/visit writers (`create-group`,
 * `create-multi-service`, `visits/[groupBookingId]/schedule`,
 * `visits/[groupBookingId]/services`) contain **no reference to
 * `class_instance_id` at all**, so they cannot set it. Both class inserters
 * (`insert-free-class-session-booking`, `insert-pending-paid-class-session-booking`,
 * which the cart orchestrator routes through) set it unconditionally. The
 * import writes `class_instance_id` for class rows but never writes
 * `bookings.group_booking_id`, so its rows never reach this predicate.
 *
 * It lives here, beside the other visit rules, so every caller applies the SAME
 * rule rather than a second copy of it that can drift: `resolveCascadingVisitGroupId`,
 * `cancelStaffBookingWithNotify` (whose own sibling query also carries the money
 * columns the resolver's projection lacks), and the guest visit count in
 * `table-management/lifecycle`, which cannot import the status-sync module
 * without a cycle.
 */
export function isCascadingVisitGroup(
  rows: ReadonlyArray<{ person_label?: string | null; class_instance_id?: string | null }>,
): boolean {
  return rows.every((r) => !r.person_label?.trim() && !r.class_instance_id);
}
