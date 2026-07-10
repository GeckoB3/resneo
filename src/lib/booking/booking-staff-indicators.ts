/**
 * Staff-facing booking indicators (pills) — pure derivations from booking row fields.
 */

export interface BookingStaffIndicatorInput {
  status?: string | null;
  deposit_status?: string | null;
  deposit_amount_pence?: number | null;
  guest_attendance_confirmed_at?: string | null;
  staff_attendance_confirmed_at?: string | null;
}

export function showDepositPendingPill(row: BookingStaffIndicatorInput): boolean {
  // Card-hold states ('Card Held', 'Charged') intentionally do not show this pill: nothing is
  // owed upfront, so there is no pending deposit to chase.
  if (row.deposit_status !== 'Pending') return false;
  const pence = row.deposit_amount_pence ?? 0;
  return pence > 0;
}

/**
 * True when attendance is considered confirmed: lifecycle `Confirmed`, or either
 * attendance timestamp is set (guest link or staff confirm).
 */
export function isAttendanceConfirmed(row: BookingStaffIndicatorInput): boolean {
  if (row.status === 'Confirmed') return true;
  return (
    Boolean(row.guest_attendance_confirmed_at?.trim()) ||
    Boolean(row.staff_attendance_confirmed_at?.trim())
  );
}

/**
 * @deprecated Prefer reading the booking `status === 'Confirmed'` directly, or
 * use {@link isAttendanceConfirmed} for legacy support. Kept for callers that
 * render an "attendance confirmed" pill as an overlay on top of another status
 * (e.g. cards showing `Booked` with a green confirmation dot).
 */
export function showAttendanceConfirmedPill(row: BookingStaffIndicatorInput): boolean {
  return isAttendanceConfirmed(row);
}

/**
 * Second "Confirmed" pill for lists/cards: guest and/or staff confirmed, but lifecycle `status`
 * is not already `Confirmed` (the primary status pill already shows Confirmed).
 */
export function showAttendanceConfirmedSupplementPill(row: BookingStaffIndicatorInput): boolean {
  if (row.status === 'Confirmed') return false;
  return (
    Boolean(row.guest_attendance_confirmed_at?.trim()) ||
    Boolean(row.staff_attendance_confirmed_at?.trim())
  );
}

export interface AttendanceConfirmationSources {
  guestAt: string | null;
  staffAt: string | null;
}

export function attendanceConfirmationSources(row: BookingStaffIndicatorInput): AttendanceConfirmationSources {
  const g = row.guest_attendance_confirmed_at?.trim();
  const s = row.staff_attendance_confirmed_at?.trim();
  return {
    guestAt: g ? g : null,
    staffAt: s ? s : null,
  };
}

/** Staff “Confirm booking” when attendance is not yet confirmed by anyone (guest or staff). */
export function canShowConfirmBookingAttendanceAction(
  row: BookingStaffIndicatorInput & { source?: string | null; status: string },
): boolean {
  if (row.source === 'walk-in') return false;
  if (isAttendanceConfirmed(row)) return false;
  return !['Cancelled', 'No-Show', 'Completed', 'Seated'].includes(row.status);
}

/** Show staff control to undo attendance confirmation (via `staff_attendance_confirmed: false` PATCH). */
export function canShowCancelStaffAttendanceConfirmationAction(
  row: BookingStaffIndicatorInput & { source?: string | null; status: string },
): boolean {
  if (row.source === 'walk-in') return false;
  if (!isAttendanceConfirmed(row)) return false;
  return !['Cancelled', 'No-Show', 'Completed', 'Seated'].includes(row.status);
}
