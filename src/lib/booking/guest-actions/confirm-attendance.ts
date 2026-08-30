import {
  applyBookingLifecycleStatusEffects,
  validateBookingStatusTransition,
} from '@/lib/table-management/lifecycle';
import { loadAndAuthoriseGuestBooking } from './authorise';
import {
  actionFailure,
  actionSuccess,
  type GuestActionActor,
  type GuestActionClients,
  type GuestActionResult,
} from './types';

/**
 * A guest confirming they will attend (AD1, extracted from `/api/confirm`).
 *
 * Lifted from the route rather than rewritten. Every branch, message and write
 * below is the route's, unchanged; only the return shape moved from
 * `NextResponse.json` to a result. P0-9's snapshots are the gate.
 */

export interface ConfirmAttendanceData {
  success: true;
  message: string;
  guest_attendance_confirmed_at?: string;
}

export async function confirmAttendanceForGuest(
  clients: GuestActionClients,
  params: { bookingId: string; actor: GuestActionActor; now?: string },
): Promise<GuestActionResult<ConfirmAttendanceData>> {
  const { bookingId, actor } = params;
  const loaded = await loadAndAuthoriseGuestBooking(clients, bookingId, actor);
  if (!loaded.ok) return loaded;

  const booking = loaded.data;
  const supabase = clients.admin;
  const now = params.now ?? new Date().toISOString();
  const usedAt = now;

  const currentStatus = booking.status;
  const attendanceAlready = booking.guest_attendance_confirmed_at as string | null | undefined;

  // Guests cannot confirm attendance on a booking still awaiting deposit
  // payment (`Pending`). They must complete the deposit first; once paid
  // the booking moves to `Booked` and becomes confirmable.
  if (currentStatus === 'Pending') {
    return actionFailure(
      400,
      'DEPOSIT_UNPAID',
      'This booking is awaiting deposit payment. Please complete the deposit before confirming your attendance.',
    );
  }

  // Idempotent: if the booking is already in `Confirmed`, just record the
  // guest timestamp if missing — never attempt Confirmed → Confirmed.
  if (currentStatus === 'Confirmed') {
    if (attendanceAlready) {
      return actionSuccess({
        success: true,
        message: 'Thanks. We already have your confirmation on file for this booking.',
        guest_attendance_confirmed_at: attendanceAlready,
      });
    }
    await supabase
      .from('bookings')
      .update({
        guest_attendance_confirmed_at: now,
        updated_at: now,
      })
      .eq('id', bookingId);

    return actionSuccess({
      success: true,
      message: 'Thanks! Your appointment is already confirmed. We look forward to seeing you.',
      guest_attendance_confirmed_at: now,
    });
  }

  // Standard path: Booked → Confirmed (guest tapped the confirm link).
  const confirmCheck = validateBookingStatusTransition(currentStatus, 'Confirmed');
  if (!confirmCheck.ok) {
    return actionFailure(400, 'CONFLICT', confirmCheck.error);
  }

  const previousStatus = currentStatus;
  await supabase
    .from('bookings')
    .update({
      status: 'Confirmed',
      // Token and HMAC actors consume the link, exactly as the route did. A
      // session actor does not: a portal session is not the emailed link, and
      // burning it here would invalidate an email the customer may still need.
      // The key is omitted rather than written back, so the update payload is
      // byte-identical for the other two actors and P0-9's snapshot holds.
      ...(actor.kind !== 'session' ? { confirm_token_used_at: usedAt } : {}),
      guest_attendance_confirmed_at: now,
      updated_at: now,
    })
    .eq('id', bookingId);

  await applyBookingLifecycleStatusEffects(supabase, {
    bookingId,
    guestId: booking.guest_id,
    previousStatus,
    nextStatus: 'Confirmed',
    actorId: null,
  });

  return actionSuccess({
    success: true,
    message: 'Thanks! Your appointment is confirmed. We look forward to seeing you.',
  });
}
