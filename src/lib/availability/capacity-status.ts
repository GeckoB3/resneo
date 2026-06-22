/**
 * Canonical set of booking statuses that consume capacity / occupy a slot.
 *
 * This is the single source of truth shared by every availability engine
 * (appointments, classes, events, resources) and the dashboard schedule feed,
 * so "X / Y booked" counts, oversell checks, and calendar uptake all agree.
 *
 * Statuses NOT in this set (Cancelled, No-Show, Completed, Refunded, etc.) do
 * not hold a seat: a no-show or completed booking must not inflate live uptake
 * or block a new booking. Historically several modules diverged here (some used
 * `status !== 'Cancelled'`, some omitted `Seated`), producing mismatched counts
 * between the booking flow, the timetable, and the calendar — see the CDE review.
 */
export const CAPACITY_CONSUMING_STATUSES = ['Booked', 'Confirmed', 'Pending', 'Seated'] as const;

export type CapacityConsumingStatus = (typeof CAPACITY_CONSUMING_STATUSES)[number];

/** True when a booking status occupies a seat/slot (counts toward capacity). */
export function isCapacityConsumingStatus(status: string | null | undefined): boolean {
  return status != null && (CAPACITY_CONSUMING_STATUSES as readonly string[]).includes(status);
}
