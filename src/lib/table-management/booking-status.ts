/**
 * Booking lifecycle.
 *
 * - `Pending`   — Awaiting deposit payment or manual approval.
 * - `Booked`    — Booking exists, slot is held. Default state when no deposit
 *                 is required, or once the deposit is paid. (Was historically
 *                 called "Confirmed" — see migration 20260424…booked_status.)
 * - `Confirmed` — Guest has explicitly confirmed attendance via the public
 *                 reminder/confirm link, OR a staff member has manually
 *                 marked the booking confirmed. Optional milestone — bookings
 *                 may go `Booked` → `Seated` directly without ever reaching
 *                 `Confirmed`.
 * - `Seated`    — Guest has arrived / appointment has started.
 * - `Completed` — Visit finished.
 * - `No-Show`   — Guest did not arrive.
 * - `Cancelled` — Booking cancelled by guest or staff.
 */
export const BOOKING_STATUSES = [
  'Pending',
  'Booked',
  'Confirmed',
  'Seated',
  'Completed',
  'No-Show',
  'Cancelled',
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_STATUS_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  Pending: ['Booked', 'Cancelled'],
  Booked: ['Confirmed', 'Seated', 'No-Show', 'Cancelled'],
  Confirmed: ['Booked', 'Seated', 'No-Show', 'Cancelled'],
  Seated: ['Completed', 'Cancelled', 'Booked', 'Confirmed'],
  Completed: ['Seated'],
  'No-Show': ['Booked', 'Confirmed'],
  Cancelled: [],
};

export const BOOKING_PRIMARY_ACTIONS: Partial<Record<BookingStatus, { label: string; target: BookingStatus }>> = {
  Pending: { label: 'Confirm', target: 'Booked' },
  Booked: { label: 'Seat', target: 'Seated' },
  Confirmed: { label: 'Seat', target: 'Seated' },
  Seated: { label: 'Complete', target: 'Completed' },
};

export const BOOKING_REVERT_ACTIONS: Partial<Record<BookingStatus, { label: string; target: BookingStatus }>> = {
  Booked: { label: 'Mark pending', target: 'Pending' },
  Confirmed: { label: 'Undo confirm', target: 'Booked' },
  Seated: { label: 'Unseat', target: 'Booked' },
  Completed: { label: 'Reopen', target: 'Seated' },
  'No-Show': { label: 'Revert No-Show', target: 'Booked' },
};

export function isRevertTransition(from: BookingStatus | string, to: BookingStatus | string): boolean {
  if (!isBookingStatus(from) || !isBookingStatus(to)) return false;
  return BOOKING_REVERT_ACTIONS[from]?.target === to;
}

/**
 * Undo confirm (`Confirmed` → `Booked`) and Undo start (`Seated` → `Booked`, non-table only):
 * skip an extra confirmation step before applying the transition.
 * Table unseat (`Seated` → `Booked`) keeps confirmation when `bookingIsTableReservation`.
 */
export function isUndoConfirmOrUndoStartInstantRevert(
  fromStatus: BookingStatus | string,
  toStatus: BookingStatus | string,
  bookingIsTableReservation: boolean,
): boolean {
  if (!isBookingStatus(fromStatus) || !isBookingStatus(toStatus)) return false;
  if (fromStatus === 'Confirmed' && toStatus === 'Booked') return true;
  return fromStatus === 'Seated' && toStatus === 'Booked' && !bookingIsTableReservation;
}

/**
 * Reverts applied immediately without an extra modal (expanded panel, dashboards, timeline).
 * Includes Reopen (`Completed` → `Seated`) and {@link isUndoConfirmOrUndoStartInstantRevert}.
 */
export function isBookingInstantRevertTransition(
  fromStatus: BookingStatus | string,
  toStatus: BookingStatus | string,
  bookingIsTableReservation: boolean,
): boolean {
  if (!isBookingStatus(fromStatus) || !isBookingStatus(toStatus)) return false;
  if (fromStatus === 'Completed' && toStatus === 'Seated') return true;
  return isUndoConfirmOrUndoStartInstantRevert(fromStatus, toStatus, bookingIsTableReservation);
}

/** Statuses that warrant an explicit staff confirm (cancel / no-show). Excludes `Completed` — routine end-of-visit. */
export const BOOKING_DESTRUCTIVE_STATUSES: BookingStatus[] = ['No-Show', 'Cancelled'];

/** Closed-out rows (dimmed UI); includes completed visits. */
export const BOOKING_TERMINAL_STATUSES: BookingStatus[] = ['Completed', 'No-Show', 'Cancelled'];

export function isBookingStatus(value: string): value is BookingStatus {
  return (BOOKING_STATUSES as readonly string[]).includes(value);
}

export function canTransitionBookingStatus(
  fromStatus: BookingStatus | string,
  toStatus: BookingStatus | string
): boolean {
  if (!isBookingStatus(fromStatus) || !isBookingStatus(toStatus)) return false;
  return BOOKING_STATUS_TRANSITIONS[fromStatus].includes(toStatus);
}

export function isDestructiveBookingStatus(status: BookingStatus | string): boolean {
  return isBookingStatus(status) && BOOKING_DESTRUCTIVE_STATUSES.includes(status);
}

export function isTerminalBookingStatus(status: BookingStatus | string): boolean {
  return isBookingStatus(status) && BOOKING_TERMINAL_STATUSES.includes(status);
}

export function canMarkNoShowForSlot(
  bookingDate: string,
  bookingTime: string,
  graceMinutes: number,
  nowDate = new Date(),
): boolean {
  const today = nowDate.toISOString().slice(0, 10);
  if (bookingDate < today) return true;
  if (bookingDate > today) return false;
  const [hours, minutes] = bookingTime.slice(0, 5).split(':').map(Number);
  const bookingMin = (hours ?? 0) * 60 + (minutes ?? 0);
  const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();
  return nowMin >= bookingMin + graceMinutes;
}
