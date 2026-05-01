export const TABLE_SERVICE_STATUSES = [
  'available',
  'reserved',
  'seated',
  'starters',
  'mains',
  'dessert',
  'bill',
  'paid',
  'bussing',
] as const;

export type TableServiceStatus = (typeof TABLE_SERVICE_STATUSES)[number];

export const TABLE_STATUS_LABELS: Record<TableServiceStatus, string> = {
  available: 'Available',
  reserved: 'Booked',
  seated: 'Seated',
  starters: 'In Service (Starters)',
  mains: 'In Service (Mains)',
  dessert: 'In Service (Dessert)',
  bill: 'Bill Requested',
  paid: 'Payment Complete',
  bussing: 'Held / Resetting',
};

export const TABLE_STATUS_SEQUENCE: Record<TableServiceStatus, TableServiceStatus> = {
  available: 'reserved',
  reserved: 'seated',
  seated: 'starters',
  starters: 'mains',
  mains: 'dessert',
  dessert: 'bill',
  bill: 'paid',
  paid: 'bussing',
  bussing: 'available',
};

/**
 * Statuses that represent active/live bookings for capacity / table-availability checks.
 * IMPORTANT: These values MUST exist in the booking_status PostgreSQL enum.
 * `Booked` and `Confirmed` both consume a slot — `Confirmed` is just a stronger
 * signal that the guest is actually coming.
 */
export const BOOKING_ACTIVE_STATUSES = ['Pending', 'Booked', 'Confirmed', 'Seated'] as const;

/** Bookings shown on the dashboard timeline grid (includes historical Completed rows). */
export const BOOKING_TIMELINE_GRID_STATUSES = [...BOOKING_ACTIVE_STATUSES, 'Completed'] as const;

/**
 * Statuses that count as "the booking is held and the slot is consumed but the
 * guest has not yet arrived" — i.e. anything between creation and seating.
 * Used for filters, capacity, and "active" reporting.
 */
export const BOOKING_HELD_STATUSES = ['Booked', 'Confirmed'] as const;

export const BOOKING_MUTABLE_STATUSES = [
  'Pending',
  'Booked',
  'Confirmed',
  'Cancelled',
  'No-Show',
  'Completed',
  'Seated',
] as const;
