'use client';

import {
  StaffSurfaceBookingModal,
  type StaffSurfaceBookingModalProps,
} from '@/components/booking/StaffSurfaceBookingModal';

export type CalendarStaffBookingModalProps = Omit<
  StaffSurfaceBookingModalProps,
  'staffRebookBootstrap' | 'heading'
>;

/**
 * Staff booking flows for the practitioner calendar toolbar (parity with `/dashboard/bookings/new`
 * and public multi-tab booking): primary model + enabled secondaries.
 */
export function CalendarStaffBookingModal(props: CalendarStaffBookingModalProps) {
  return <StaffSurfaceBookingModal {...props} />;
}
