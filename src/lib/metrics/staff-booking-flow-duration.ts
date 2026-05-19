/** Matches POST /api/venue/bookings staff_booking_duration_ms validation. */
export const STAFF_BOOKING_FLOW_MIN_MS = 500;
export const STAFF_BOOKING_FLOW_MAX_MS = 30 * 60 * 1000;

/** Returns duration for API when within valid range; omit field when not measurable. */
export function staffBookingFlowDurationMs(flowStartedAt: number | null): number | undefined {
  if (flowStartedAt == null) return undefined;
  const ms = Date.now() - flowStartedAt;
  if (ms < STAFF_BOOKING_FLOW_MIN_MS || ms > STAFF_BOOKING_FLOW_MAX_MS) return undefined;
  return ms;
}
