'use client';

import {
  StaffSurfaceBookingModal,
  type StaffSurfaceBookingModalProps,
} from '@/components/booking/StaffSurfaceBookingModal';

/**
 * `staffRebookBootstrap` is allowed through for one case: the cross-account move
 * dialog books the client afresh on another venue's calendar with their details
 * filled in from the booking that was dragged.
 */
export type CalendarStaffBookingModalProps = Omit<StaffSurfaceBookingModalProps, 'heading'>;

/**
 * Staff booking flows for the practitioner calendar toolbar (parity with `/dashboard/bookings/new`
 * and public multi-tab booking): primary model + enabled secondaries.
 */
export function CalendarStaffBookingModal(props: CalendarStaffBookingModalProps) {
  return <StaffSurfaceBookingModal {...props} />;
}
