import type { SupabaseClient } from '@supabase/supabase-js';
import { canTransitionBookingStatus, type BookingStatus } from '@/lib/table-management/booking-status';
import { applyBookingLifecycleStatusEffects } from '@/lib/table-management/lifecycle';

export type GroupBookingStatusRow = {
  id: string;
  status: string;
  practitioner_id?: string | null;
  calendar_id?: string | null;
  deposit_status?: string | null;
  guest_id: string;
  person_label?: string | null;
  class_instance_id?: string | null;
};

/** Every row sharing a `group_booking_id`, whatever kind of group it is. */
export async function loadGroupBookingSiblings(
  db: SupabaseClient,
  venueId: string,
  groupBookingId: string,
): Promise<GroupBookingStatusRow[]> {
  const { data, error } = await db
    .from('bookings')
    .select(
      'id, status, practitioner_id, calendar_id, deposit_status, guest_id, person_label, class_instance_id',
    )
    .eq('venue_id', venueId)
    .eq('group_booking_id', groupBookingId);

  if (error) {
    console.error('[loadGroupBookingSiblings] failed:', error.message, { venueId, groupBookingId });
    return [];
  }
  return (data ?? []) as GroupBookingStatusRow[];
}

/**
 * The group id to CASCADE a status change across, or null when there is nothing
 * to cascade.
 *
 * `group_booking_id` links two different things. A MULTI-SERVICE VISIT is one
 * guest booked into consecutive services, every row with a null `person_label`;
 * cascading there is right, because it is one visit. A GROUP BOOKING is several
 * distinct people, each with a `person_label`, often on different calendars at
 * different times; cascading there was wrong and expensive, because marking one
 * attendee a no-show flipped every other attendee to no-show and forfeited their
 * paid deposits.
 *
 * Returning null for a group booking makes the caller fall through to its
 * ordinary single-row path, which is the correct treatment for one attendee. The
 * read side already drew this distinction ({@link isMultiServiceVisitGroup} in
 * `booking-list-row-schedule`); it had simply never reached the API.
 */
export async function resolveCascadingVisitGroupId(
  db: SupabaseClient,
  venueId: string,
  groupBookingId: string | null | undefined,
): Promise<string | null> {
  if (!groupBookingId) return null;
  const rows = await loadGroupBookingSiblings(db, venueId, groupBookingId);
  if (rows.length <= 1) return null;
  return isCascadingVisitGroup(rows) ? groupBookingId : null;
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
 * Exported so the one caller that cannot use `resolveCascadingVisitGroupId` —
 * `cancelStaffBookingWithNotify`, whose own sibling query also carries the
 * money columns the resolver's projection lacks — applies the SAME rule rather
 * than a second copy of it that can drift.
 */
export function isCascadingVisitGroup(
  rows: ReadonlyArray<Pick<GroupBookingStatusRow, 'person_label' | 'class_instance_id'>>,
): boolean {
  return rows.every((r) => !r.person_label?.trim() && !r.class_instance_id);
}

/**
 * Build the same status PATCH payload as `PATCH /api/venue/bookings/[id]` for one row.
 * Returns null when the transition is not allowed for that row.
 */
export function buildStatusPatchPayloadForRow(
  row: GroupBookingStatusRow,
  newStatus: BookingStatus,
  options?: {
    actualDepartedTime?: string | null;
  },
): Record<string, unknown> | null {
  if (!canTransitionBookingStatus(row.status, newStatus)) {
    return null;
  }

  const statusPayload: Record<string, unknown> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  };

  if (newStatus === 'Seated' && !row.practitioner_id && !row.calendar_id) {
    statusPayload.client_arrived_at = null;
  }
  if (newStatus === 'Confirmed' && row.status !== 'Confirmed') {
    statusPayload.staff_attendance_confirmed_at = new Date().toISOString();
  }
  if (row.status === 'Confirmed' && newStatus === 'Booked') {
    statusPayload.staff_attendance_confirmed_at = null;
    statusPayload.guest_attendance_confirmed_at = null;
  }
  if (newStatus === 'Completed') {
    statusPayload.actual_departed_time = options?.actualDepartedTime ?? new Date().toISOString();
  }
  if (row.status === 'Completed' && newStatus === 'Seated') {
    statusPayload.actual_departed_time = null;
  }
  if (
    row.status === 'No-Show' &&
    (newStatus === 'Booked' || newStatus === 'Confirmed') &&
    row.deposit_status === 'Forfeited'
  ) {
    statusPayload.deposit_status = 'Paid';
  }

  return statusPayload;
}

export interface ApplyGroupBookingStatusChangeParams {
  db: SupabaseClient;
  admin: SupabaseClient;
  venueId: string;
  groupBookingId: string;
  newStatus: BookingStatus;
  actorId: string;
  /** When set, only this row must allow the transition (staff clicked this segment). */
  primaryBookingId: string;
  primaryPreviousStatus: string;
  actualDepartedTime?: string | null;
}

/**
 * Apply a lifecycle status change to every sibling in a multi-service group where the
 * transition is valid. Keeps visit segments in sync (confirm / start / complete together).
 */
export async function applyGroupBookingStatusChange(
  params: ApplyGroupBookingStatusChangeParams,
): Promise<string[]> {
  const {
    db,
    admin,
    venueId,
    groupBookingId,
    newStatus,
    actorId,
    primaryPreviousStatus,
    actualDepartedTime,
  } = params;

  if (!canTransitionBookingStatus(primaryPreviousStatus, newStatus)) {
    return [];
  }

  const siblings = await loadGroupBookingSiblings(db, venueId, groupBookingId);
  if (siblings.length === 0) {
    return [];
  }

  const updatedIds: string[] = [];

  for (const row of siblings) {
    const payload = buildStatusPatchPayloadForRow(row, newStatus, { actualDepartedTime });
    if (!payload) continue;

    const previousStatus = row.status;
    const { error } = await db
      .from('bookings')
      .update(payload)
      .eq('id', row.id)
      .eq('venue_id', venueId);

    if (error) {
      console.error('[applyGroupBookingStatusChange] update failed:', error.message, {
        bookingId: row.id,
        newStatus,
      });
      continue;
    }

    updatedIds.push(row.id);

    if (payload.status && payload.status !== previousStatus) {
      await applyBookingLifecycleStatusEffects(admin, {
        bookingId: row.id,
        guestId: row.guest_id,
        previousStatus,
        nextStatus: newStatus,
        actorId,
      });
    }
  }

  return updatedIds;
}

/**
 * Staff “Confirm” / “Cancel confirmation” attendance toggle for every segment in a visit.
 * Mirrors `PATCH` `staff_attendance_confirmed` on a single booking.
 */
export async function applyGroupStaffAttendanceChange(params: {
  db: SupabaseClient;
  admin: SupabaseClient;
  venueId: string;
  groupBookingId: string;
  confirmed: boolean;
  actorId: string;
}): Promise<string[]> {
  const { db, admin, venueId, groupBookingId, confirmed, actorId } = params;
  const siblings = await loadGroupBookingSiblings(db, venueId, groupBookingId);
  if (siblings.length === 0) return [];

  const updatedIds: string[] = [];

  for (const row of siblings) {
    const currentStatus = row.status;
    const updatePayload: Record<string, unknown> = {
      staff_attendance_confirmed_at: confirmed ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    if (
      confirmed &&
      (currentStatus === 'Booked' ||
        currentStatus === 'Pending' ||
        currentStatus === 'Deposit Pending')
    ) {
      updatePayload.status = 'Confirmed';
    } else if (
      !confirmed &&
      (currentStatus === 'Pending' || currentStatus === 'Booked' || currentStatus === 'Confirmed')
    ) {
      updatePayload.guest_attendance_confirmed_at = null;
      if (currentStatus === 'Confirmed') {
        updatePayload.status = 'Booked';
      }
    }

    const { error } = await db
      .from('bookings')
      .update(updatePayload)
      .eq('id', row.id)
      .eq('venue_id', venueId);

    if (error) {
      console.error('[applyGroupStaffAttendanceChange] update failed:', error.message, {
        bookingId: row.id,
        confirmed,
      });
      continue;
    }

    updatedIds.push(row.id);

    if (updatePayload.status && updatePayload.status !== currentStatus) {
      await applyBookingLifecycleStatusEffects(admin, {
        bookingId: row.id,
        guestId: row.guest_id,
        previousStatus: currentStatus,
        nextStatus: updatePayload.status as BookingStatus,
        actorId,
      });
    }
  }

  return updatedIds;
}

/** Sync `client_arrived_at` across a multi-service visit. */
export async function applyGroupClientArrivedChange(
  db: SupabaseClient,
  venueId: string,
  groupBookingId: string,
  arrived: boolean,
): Promise<void> {
  const siblings = await loadGroupBookingSiblings(db, venueId, groupBookingId);
  const eligible = siblings.filter((row) =>
    ['Pending', 'Booked', 'Confirmed'].includes(row.status),
  );
  if (eligible.length === 0) return;

  const timestamp = arrived ? new Date().toISOString() : null;
  const { error } = await db
    .from('bookings')
    .update({
      client_arrived_at: timestamp,
      updated_at: new Date().toISOString(),
    })
    .in(
      'id',
      eligible.map((row) => row.id),
    )
    .eq('venue_id', venueId);

  if (error) {
    console.error('[applyGroupClientArrivedChange] failed:', error.message, {
      venueId,
      groupBookingId,
    });
  }
}
