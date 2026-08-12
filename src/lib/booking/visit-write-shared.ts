/**
 * The bits both visit write endpoints owe a visit whose start moves.
 *
 * `/visits/[gid]/schedule` and `/visits/[gid]/services` can each move a visit, so
 * each owes the same two things afterwards. Kept here rather than copied into
 * both: the availability engine already carries one duplicated assembly that
 * drifted, and two sibling routes are just as capable of it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { cancellationDeadlineHoursBefore } from '@/lib/booking/cancellation-deadline';
import { resolveCancellationNoticeHoursForCreate } from '@/lib/booking/resolve-cancellation-notice-hours';
import { COMMUNICATION_LOG_TYPES_RESET_ON_BOOKING_START_CHANGE } from '@/lib/communications/scheduled-log-reset';

export interface VisitCancellationFields {
  cancellation_deadline: string;
  cancellation_policy_snapshot: { refund_window_hours: number; policy: string };
}

/**
 * One deadline for the whole visit, pinned to its start, the way
 * `create-multi-service` writes it. Per-row deadlines would promise the guest a
 * different refund window for each service of one appointment, and a move that
 * re-pinned nothing would leave a booking enforcing a window its own stored
 * policy no longer matches.
 */
export async function visitCancellationFields(params: {
  admin: SupabaseClient;
  venueId: string;
  anchorRow: { service_item_id?: string | null; appointment_service_id?: string | null };
  dateYmd: string;
  startHm: string;
}): Promise<VisitCancellationFields> {
  const { admin, venueId, anchorRow, dateYmd, startHm } = params;
  const refundWindowHours = await resolveCancellationNoticeHoursForCreate({
    supabase: admin,
    venueId,
    effectiveModel: anchorRow.service_item_id ? 'unified_scheduling' : 'practitioner_appointment',
    serviceItemId: anchorRow.service_item_id ?? null,
    appointmentServiceId: anchorRow.appointment_service_id ?? null,
  });
  return {
    cancellation_deadline: cancellationDeadlineHoursBefore(dateYmd, startHm, refundWindowHours),
    cancellation_policy_snapshot: {
      refund_window_hours: refundWindowHours,
      policy: `Full refund if cancelled ${refundWindowHours}+ hours before appointment start. No refund within ${refundWindowHours} hours of the appointment or for no-shows.`,
    },
  };
}

/**
 * Clear the scheduled communications for every row of a visit that moved, so the
 * reminders re-trigger against the new time instead of the one the guest is no
 * longer coming at. Reminders are scheduled per row, so every row is cleared.
 */
export async function resetVisitScheduledComms(
  admin: SupabaseClient,
  bookingIds: readonly string[],
): Promise<void> {
  if (bookingIds.length === 0) return;
  try {
    await admin
      .from('communication_logs')
      .delete()
      .in('booking_id', [...bookingIds])
      .in('message_type', [...COMMUNICATION_LOG_TYPES_RESET_ON_BOOKING_START_CHANGE]);
  } catch (err) {
    console.error('Communication log reset failed after a visit move:', err);
  }
}
