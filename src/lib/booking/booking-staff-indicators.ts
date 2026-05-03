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
  if (row.deposit_status !== 'Pending') return false;
  const pence = row.deposit_amount_pence ?? 0;
  return pence > 0;
}

/**
 * True when the booking has reached the `Confirmed` lifecycle status (guest
 * confirmed via reminder link, or staff manually confirmed). For backwards
 * compatibility with rows from before the dedicated `Confirmed` status existed,
 * this also returns true if either attendance timestamp is set.
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

/** Staff "Confirm Booking" (attendance) — same rules as dashboard booking lists. */
export function canShowConfirmBookingAttendanceAction(
  row: BookingStaffIndicatorInput & { source?: string | null; status: string },
): boolean {
  if (row.source === 'walk-in') return false;
  if (Boolean(row.staff_attendance_confirmed_at?.trim())) return false;
  /** Lifecycle already `Confirmed`; use Cancel confirmation / status actions instead. */
  if (row.status === 'Confirmed') return false;
  return !['Cancelled', 'No-Show', 'Completed'].includes(row.status);
}

export function canShowCancelStaffAttendanceConfirmationAction(
  row: BookingStaffIndicatorInput & { source?: string | null; status: string },
): boolean {
  if (row.source === 'walk-in') return false;
  /** Show only when staff manually confirmed (timestamp set or status is Confirmed via staff path). */
  const staffConfirmed = Boolean(row.staff_attendance_confirmed_at?.trim());
  const guestConfirmed = Boolean(row.guest_attendance_confirmed_at?.trim());
  /** If status is Confirmed but no guest timestamp, treat as staff-confirmed for revert UX. */
  const inferStaff = row.status === 'Confirmed' && !guestConfirmed;
  if (!staffConfirmed && !inferStaff) return false;
  return !['Cancelled', 'No-Show', 'Completed'].includes(row.status);
}
