import { isAttendanceConfirmed } from '@/lib/booking/booking-staff-indicators';
import {
  canTransitionBookingStatus,
  type BookingStatus,
} from '@/lib/table-management/booking-status';

/** List-row fields that drive ExpandedBookingContent action buttons. */
export type BookingRowOverlayFields = {
  status?: string;
  client_arrived_at?: string | null;
  staff_attendance_confirmed_at?: string | null;
  guest_attendance_confirmed_at?: string | null;
  deposit_status?: string;
  deposit_amount_pence?: number | null;
};

export type BookingRowOverlay = Partial<BookingRowOverlayFields>;

export function mergeBookingRowOverlay(
  base: BookingRowOverlay,
  patch: BookingRowOverlay,
): BookingRowOverlay {
  if (Object.keys(patch).length === 0) return base;
  return { ...base, ...patch };
}

/** Drop overlay keys once the parent row prop reflects the same values. */
export function pruneBookingRowOverlay(
  overlay: BookingRowOverlay,
  booking: BookingRowOverlayFields,
): BookingRowOverlay {
  if (Object.keys(overlay).length === 0) return overlay;
  const next: BookingRowOverlay = { ...overlay };
  for (const key of Object.keys(overlay) as (keyof BookingRowOverlayFields)[]) {
    const expected = overlay[key];
    const actual = booking[key];
    if (expected === actual) {
      delete next[key];
      continue;
    }
    if (key.endsWith('_at')) {
      if ((expected === null || expected === undefined) && (actual === null || actual === undefined)) {
        delete next[key];
      } else if (typeof expected === 'string' && expected.length > 0 && actual) {
        delete next[key];
      }
    }
  }
  return next;
}

/** Merge overlay fields onto a list row (status, attendance timestamps, deposit). */
export function applyBookingRowOverlayFields<T extends BookingRowOverlayFields>(
  row: T,
  overlay: BookingRowOverlay,
): T {
  if (Object.keys(overlay).length === 0) return row;
  return { ...row, ...overlay };
}

/**
 * Prune overlay keys once the parent row matches, but keep overlay while the row
 * still looks “confirmed” after an undo (stale list refetch can briefly regress props).
 */
export function retainBookingRowOverlay(
  overlay: BookingRowOverlay,
  booking: BookingRowOverlayFields,
): BookingRowOverlay {
  if (Object.keys(overlay).length === 0) return overlay;
  const intended = { ...booking, ...overlay };
  if (booking.status === 'Confirmed' && intended.status === 'Booked') {
    return overlay;
  }
  if (isAttendanceConfirmed(booking) && !isAttendanceConfirmed(intended)) {
    return overlay;
  }
  const overlayArrived = overlay.client_arrived_at;
  if (
    typeof overlayArrived === 'string' &&
    overlayArrived.length > 0 &&
    !booking.client_arrived_at
  ) {
    return overlay;
  }
  return pruneBookingRowOverlay(overlay, booking);
}

export function overlayFromPatchPayload(data: Record<string, unknown>): BookingRowOverlay {
  const overlay: BookingRowOverlay = {};
  if (typeof data.status === 'string') overlay.status = data.status;
  if ('client_arrived_at' in data) {
    overlay.client_arrived_at =
      typeof data.client_arrived_at === 'string' ? data.client_arrived_at : null;
  }
  if ('staff_attendance_confirmed_at' in data) {
    overlay.staff_attendance_confirmed_at =
      typeof data.staff_attendance_confirmed_at === 'string'
        ? data.staff_attendance_confirmed_at
        : null;
  }
  if ('guest_attendance_confirmed_at' in data) {
    overlay.guest_attendance_confirmed_at =
      typeof data.guest_attendance_confirmed_at === 'string'
        ? data.guest_attendance_confirmed_at
        : null;
  }
  if (typeof data.deposit_status === 'string') overlay.deposit_status = data.deposit_status;
  if (typeof data.deposit_amount_pence === 'number') {
    overlay.deposit_amount_pence = data.deposit_amount_pence;
  }
  return overlay;
}

/** Refine server PATCH payload onto overlay, respecting attendance-cancel intent. */
export function overlayFromPatchPayloadForBody(
  body: Record<string, unknown>,
  data: Record<string, unknown>,
): BookingRowOverlay {
  const overlay = overlayFromPatchPayload(data);
  if (body.staff_attendance_confirmed === false) {
    overlay.staff_attendance_confirmed_at = null;
    overlay.guest_attendance_confirmed_at = null;
    if (typeof data.status === 'string') {
      overlay.status = data.status;
    }
  }
  return overlay;
}

/** Optimistic `client_arrived_at` for calendar/list overlays (mirrors venue PATCH route). */
export function overlayFromClientArrivedPatch(arrived: boolean): BookingRowOverlay {
  return {
    client_arrived_at: arrived ? new Date().toISOString() : null,
  };
}

/** Optimistic overlay from PATCH body before the server responds (mirrors venue PATCH route). */
export function overlayFromPatchBody(
  body: Record<string, unknown>,
  row: BookingRowOverlayFields,
): BookingRowOverlay {
  if (body.client_arrived !== undefined) {
    return overlayFromClientArrivedPatch(Boolean(body.client_arrived));
  }
  if (body.staff_attendance_confirmed !== undefined) {
    const on = Boolean(body.staff_attendance_confirmed);
    const overlay: BookingRowOverlay = {
      staff_attendance_confirmed_at: on ? new Date().toISOString() : null,
    };
    if (
      on &&
      (row.status === 'Booked' || row.status === 'Pending' || row.status === 'Deposit Pending')
    ) {
      overlay.status = 'Confirmed';
    }
    if (!on) {
      overlay.guest_attendance_confirmed_at = null;
      if (row.status === 'Confirmed') {
        overlay.status = 'Booked';
      }
    }
    return overlay;
  }
  return {};
}

/** Optimistic overlay for lifecycle status changes (mirrors status PATCH branch in venue route). */
/** Optimistic list/calendar update for one row or every sibling in a multi-service visit. */
export function applyOptimisticStatusToBookingRows<
  T extends BookingRowOverlayFields & { id: string; group_booking_id?: string | null; status: string },
>(
  rows: T[],
  bookingId: string,
  newStatus: BookingStatus,
  isTableReservation: (row: T) => boolean,
): T[] {
  const anchor = rows.find((row) => row.id === bookingId);
  const groupId = anchor?.group_booking_id;
  return rows.map((row) => {
    const inGroup = Boolean(groupId && row.group_booking_id === groupId);
    if (!inGroup && row.id !== bookingId) return row;
    if (!canTransitionBookingStatus(row.status, newStatus)) return row;
    const overlay = overlayFromStatusTransition(
      row.status as BookingStatus,
      newStatus,
      isTableReservation(row),
    );
    return applyBookingRowOverlayFields(row, overlay);
  });
}

export function overlayFromStatusTransition(
  fromStatus: BookingStatus,
  toStatus: BookingStatus,
  isTableReservation: boolean,
): BookingRowOverlay {
  const overlay: BookingRowOverlay = { status: toStatus };
  if (toStatus === 'Seated' && isTableReservation) {
    overlay.client_arrived_at = null;
  }
  if (toStatus === 'Confirmed' && fromStatus !== 'Confirmed') {
    overlay.staff_attendance_confirmed_at = new Date().toISOString();
  }
  if (fromStatus === 'Confirmed' && toStatus === 'Booked') {
    overlay.staff_attendance_confirmed_at = null;
    overlay.guest_attendance_confirmed_at = null;
  }
  return overlay;
}
