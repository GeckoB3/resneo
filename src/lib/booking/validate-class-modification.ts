import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClassInstance, ClassType } from '@/types/booking-models';
import { CAPACITY_CONSUMING_STATUSES } from '@/lib/availability/capacity-status';
import { entityBookingWindowFromRow } from '@/lib/booking/entity-booking-window';
import { isClassInstanceBookableForGuest } from '@/lib/availability/class-session-engine';

/**
 * Shared dry-run for moving a class_session booking to a different FUTURE
 * class_instance of the SAME class type (guest self-reschedule and staff
 * slot-move both validate through here, mirroring
 * {@link import('./validate-resource-booking-modification')}).
 *
 * Rules enforced:
 *  - target instance exists, belongs to the same `class_type_id`, same venue,
 *    and is not cancelled;
 *  - target instance start is in the future (venue-local, honouring the class
 *    type's min booking notice for guest moves);
 *  - target instance has remaining capacity for `partySize` once the booking
 *    being moved is excluded.
 *
 * Capacity here is a friendly pre-check; the authoritative race-safe guard is
 * the `enforce_cde_capacity` DB trigger, which the caller relies on after the
 * UPDATE (it RAISEs SQLSTATE 23P01 / 'CDE_CAPACITY' on oversell). Returning the
 * resolved date/time lets the caller set booking_date/booking_time correctly.
 */

export interface ValidateClassModificationParams {
  admin: SupabaseClient;
  venueId: string;
  /** Booking being moved — excluded from the capacity tally on the target instance. */
  bookingId: string;
  /** Class type the booking currently belongs to; the move must stay within it. */
  currentClassTypeId: string;
  /** Target class_instance the guest/staff want to move to. */
  targetInstanceId: string;
  /** Seats required on the target instance (the booking's party size). */
  partySize: number;
  venueTimezone: string;
  /**
   * When true (guest self-reschedule), the target start must also satisfy the
   * class type's `min_booking_notice_hours`. Staff moves pass false so they can
   * shuffle into a same-day slot.
   */
  enforceGuestNotice?: boolean;
  /** For tests; defaults to Date.now() when omitted. */
  referenceNowMs?: number;
}

export type ValidateClassModificationResult =
  | {
      ok: true;
      instanceDate: string;
      startTime: string;
      classTypeId: string;
      capacity: number;
      remaining: number;
      cancellationNoticeHours: number;
      durationMinutes: number;
    }
  | { ok: false; reason: string };

export async function validateClassModification(
  params: ValidateClassModificationParams,
): Promise<ValidateClassModificationResult> {
  const {
    admin,
    venueId,
    bookingId,
    currentClassTypeId,
    targetInstanceId,
    partySize,
    venueTimezone,
    enforceGuestNotice = false,
    referenceNowMs,
  } = params;

  if (!targetInstanceId) {
    return { ok: false, reason: 'A target class session is required' };
  }
  if (!Number.isInteger(partySize) || partySize < 1) {
    return { ok: false, reason: 'Invalid party size' };
  }

  const { data: instRow } = await admin
    .from('class_instances')
    .select('id, class_type_id, instance_date, start_time, capacity_override, is_cancelled')
    .eq('id', targetInstanceId)
    .maybeSingle();
  const instance = instRow as
    | Pick<
        ClassInstance,
        'id' | 'class_type_id' | 'instance_date' | 'start_time' | 'capacity_override' | 'is_cancelled'
      >
    | null;

  if (!instance) {
    return { ok: false, reason: 'That class session could not be found' };
  }
  if (instance.class_type_id !== currentClassTypeId) {
    return {
      ok: false,
      reason: 'You can only move to another session of the same class',
    };
  }
  if (instance.is_cancelled) {
    return { ok: false, reason: 'That class session has been cancelled' };
  }

  const { data: ctRow } = await admin
    .from('class_types')
    .select('*')
    .eq('id', currentClassTypeId)
    .eq('venue_id', venueId)
    .maybeSingle();
  const classType = ctRow as ClassType | null;
  if (!classType) {
    return { ok: false, reason: 'That class is no longer available' };
  }
  if (!classType.is_active) {
    return { ok: false, reason: 'That class is no longer available' };
  }

  const win = entityBookingWindowFromRow(classType as unknown as Record<string, unknown>);

  // Future-only. Staff moves still require the start to be ahead of "now" (no
  // moving into a session that already started); guests additionally honour the
  // class type's min booking notice.
  const minNoticeHours = enforceGuestNotice ? win.min_booking_notice_hours : 0;
  const startInFuture = isClassInstanceBookableForGuest(
    { instance_date: instance.instance_date, start_time: instance.start_time },
    {
      minNoticeHours,
      venueTimezone,
      ...(referenceNowMs != null ? { referenceNowMs } : {}),
    },
  );
  if (!startInFuture) {
    return {
      ok: false,
      reason: enforceGuestNotice
        ? 'That session is too soon to move into. Please choose a later session.'
        : 'That session has already started',
    };
  }

  // Capacity pre-check: sum capacity-consuming bookings on the target instance,
  // excluding the booking being moved (so an in-place "move" never blocks itself).
  const capacity = instance.capacity_override ?? classType.capacity;
  const bookingIdLc = bookingId.toLowerCase();
  const { data: bookingRows } = await admin
    .from('bookings')
    .select('id, party_size')
    .eq('venue_id', venueId)
    .eq('class_instance_id', targetInstanceId)
    .in('status', [...CAPACITY_CONSUMING_STATUSES]);

  let booked = 0;
  for (const raw of bookingRows ?? []) {
    const row = raw as { id: string; party_size: number | null };
    if (String(row.id).toLowerCase() === bookingIdLc) continue;
    booked += row.party_size ?? 1;
  }
  const remaining = Math.max(0, capacity - booked);
  if (partySize > remaining) {
    return { ok: false, reason: 'That session is full' };
  }

  return {
    ok: true,
    instanceDate: instance.instance_date,
    startTime: String(instance.start_time).slice(0, 5),
    classTypeId: currentClassTypeId,
    capacity,
    remaining,
    cancellationNoticeHours: win.cancellation_notice_hours,
    durationMinutes: classType.duration_minutes,
  };
}
