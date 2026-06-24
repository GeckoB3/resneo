import type { SupabaseClient } from '@supabase/supabase-js';
import { cancelStaffBookingWithNotify } from '@/lib/booking/staff-cancel-booking';

/**
 * Active booking statuses that should be cancelled when a class session is cancelled.
 * Mirrors the CANCELLABLE set used by {@link cancelStaffBookingWithNotify}.
 */
const ACTIVE_BOOKING_STATUSES: string[] = ['Pending', 'Booked', 'Confirmed', 'Seated'];

export interface CancelClassInstanceBookingsParams {
  venueId: string;
  classInstanceId: string;
  /** Class type name, used in the refund/notify copy. */
  className: string;
  /** Instance date (YYYY-MM-DD), used in the refund/notify copy. */
  instanceDate: string;
  /** Staff id performing the cancellation (null for system). */
  actorId: string | null;
}

export interface CancelClassInstanceBookingsResult {
  cancelledCount: number;
  refundFailures: number;
  /**
   * Notification closures to run inside `after()` so the HTTP response is not
   * blocked. Each sends the guest cancellation comm for one cancelled booking.
   */
  notificationWork: Array<() => Promise<void>>;
}

/**
 * Cancel every active booking attached to a class instance, refunding per policy
 * and queuing guest cancellation comms — the shared pipeline behind both the
 * admin-only `POST /class-instances/[id]/cancel` route and the calendar-scoped
 * `PATCH /classes { entity_type: 'instance', is_cancelled: true }` path, so a
 * session cancellation never strands paid guests regardless of which surface
 * triggered it.
 *
 * Group bookings (`group_booking_id`) are de-duplicated so a multi-session group
 * is cancelled once. The caller is responsible for flipping `is_cancelled` on the
 * instance and removing any calendar block.
 */
export async function cancelClassInstanceBookings(
  admin: SupabaseClient,
  staffDb: SupabaseClient,
  params: CancelClassInstanceBookingsParams,
): Promise<CancelClassInstanceBookingsResult> {
  const { venueId, classInstanceId, className, instanceDate, actorId } = params;

  const { data: bookingRows, error: bookErr } = await admin
    .from('bookings')
    .select('id, group_booking_id, status')
    .eq('venue_id', venueId)
    .eq('class_instance_id', classInstanceId)
    .in('status', ACTIVE_BOOKING_STATUSES);

  if (bookErr) {
    console.error('[cancelClassInstanceBookings] list bookings failed:', bookErr);
    throw new Error('Failed to list bookings');
  }

  const rows = bookingRows ?? [];
  const seenGroups = new Set<string>();
  const result: CancelClassInstanceBookingsResult = {
    cancelledCount: 0,
    refundFailures: 0,
    notificationWork: [],
  };

  const prefix = `The venue has cancelled "${className}" on ${instanceDate}.`;

  for (const row of rows) {
    const gid = (row as { group_booking_id?: string | null }).group_booking_id;
    if (gid) {
      if (seenGroups.has(gid)) continue;
      seenGroups.add(gid);
    }

    const bid = (row as { id: string }).id;
    const cancelResult = await cancelStaffBookingWithNotify(admin, staffDb, venueId, bid, {
      refundMessagePrefix: prefix,
      actorId,
    });

    if (cancelResult.cancelled) {
      result.cancelledCount += 1;
      if (cancelResult.scheduleNotification) {
        result.notificationWork.push(cancelResult.scheduleNotification);
      }
    } else if (cancelResult.refundFailed) {
      result.refundFailures += 1;
    }
  }

  return result;
}
