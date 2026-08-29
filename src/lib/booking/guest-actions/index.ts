/**
 * Guest booking actions (AD1, P0-4).
 *
 * The four service functions a guest can drive, plus the actor model and result
 * type they share. See `./types.ts` for why this layer exists and what it may
 * not import.
 *
 * Related, and deliberately separate: `../staff-cancel-booking.ts` is the STAFF
 * cancel path. The two are not merged; the reason is recorded in both files.
 */
export { cancelBookingForGuest, type CancelBookingData } from './cancel';
export {
  rescheduleBookingForGuest,
  type RescheduleData,
  type RescheduleRequest,
} from './reschedule';
export { confirmAttendanceForGuest, type ConfirmAttendanceData } from './confirm-attendance';
export { loadGuestBookingDetail } from './load-detail';
export { getBookingDetailForGuest } from './booking-detail';
export {
  getRescheduleOptionsForGuest,
  type RescheduleOptionsData,
  type RescheduleBlockedReason,
} from './reschedule-options';
export { loadAndAuthoriseGuestBooking, GUEST_ACTION_BOOKING_COLUMNS } from './authorise';
export {
  actionFailure,
  actionSuccess,
  jsonActionResult,
  type GuestActionActor,
  type GuestActionBooking,
  type GuestActionClients,
  type GuestActionResult,
} from './types';
