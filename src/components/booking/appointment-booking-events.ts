/** Dispatched when the guest taps the venue name on the public book page to restart the appointment flow. */
export const APPOINTMENT_BOOKING_RESET_EVENT = 'reserve-ni:reset-appointment-booking';

/** Brings the booking form back into view after a restart. No-op inside an embed with no anchor. */
export function scrollToBookingFormStart(): void {
  document.getElementById('booking-form-start')?.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Send the appointment flow back to its first step and scroll there.
 *
 * Routed through the event the flow already listens for rather than reaching
 * into its state, so every way of starting over (the venue name, the button on
 * the confirmation screen) clears exactly the same things.
 */
export function restartPublicAppointmentBooking(): void {
  window.dispatchEvent(new CustomEvent(APPOINTMENT_BOOKING_RESET_EVENT));
  scrollToBookingFormStart();
}
