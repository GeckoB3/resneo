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
};

/** Rows in the same multi-service visit (`group_booking_id`). */
export async function loadGroupBookingSiblings(
  db: SupabaseClient,
  venueId: string,
  groupBookingId: string,
): Promise<GroupBookingStatusRow[]> {
  const { data, error } = await db
    .from('bookings')
    .select('id, status, practitioner_id, calendar_id, deposit_status, guest_id')
    .eq('venue_id', venueId)
    .eq('group_booking_id', groupBookingId);

  if (error) {
    console.error('[loadGroupBookingSiblings] failed:', error.message, { venueId, groupBookingId });
    return [];
  }
  return (data ?? []) as GroupBookingStatusRow[];
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
