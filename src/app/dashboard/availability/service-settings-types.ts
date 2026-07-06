/** Shared types and defaults for dining service configuration (availability). */

export interface VenueServiceRow {
  id: string;
  name: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  last_booking_time: string;
  is_active: boolean;
  sort_order: number;
}

export interface ServiceCapacityRule {
  id: string;
  service_id: string;
  max_covers_per_slot: number;
  max_bookings_per_slot: number;
  slot_interval_minutes: number;
  buffer_minutes: number;
  day_of_week: number | null;
  time_range_start: string | null;
  time_range_end: string | null;
}

export interface PartySizeDuration {
  id: string;
  service_id: string;
  min_party_size: number;
  max_party_size: number;
  duration_minutes: number;
  day_of_week: number | null;
}

export interface ServiceBookingRestriction {
  id: string;
  service_id: string;
  min_advance_minutes: number;
  max_advance_days: number;
  min_party_size_online: number;
  max_party_size_online: number;
  large_party_threshold: number | null;
  large_party_message: string | null;
  deposit_required_from_party_size: number | null;
  deposit_amount_per_person_gbp: number | null;
  /** 'charge' takes a deposit payment; 'card_hold' saves the card for a no-show fee. */
  deposit_type?: 'charge' | 'card_hold' | null;
  online_requires_deposit?: boolean;
  cancellation_notice_hours?: number;
}

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function emptyService(): Omit<VenueServiceRow, 'id'> {
  return {
    name: '',
    days_of_week: [1, 2, 3, 4, 5, 6],
    start_time: '12:00',
    end_time: '22:00',
    last_booking_time: '21:00',
    is_active: true,
    sort_order: 0,
  };
}

export function defaultCapacityRule(serviceId: string): Omit<ServiceCapacityRule, 'id'> {
  return {
    service_id: serviceId,
    max_covers_per_slot: 20,
    max_bookings_per_slot: 10,
    slot_interval_minutes: 15,
    buffer_minutes: 0,
    day_of_week: null,
    time_range_start: null,
    time_range_end: null,
  };
}

/** Bands used by "Add smart defaults" and when provisioning defaults for a new service. */
export const DURATION_SMART_DEFAULTS: ReadonlyArray<{ min: number; max: number; dur: number }> = [
  { min: 1, max: 2, dur: 90 },
  { min: 3, max: 4, dur: 105 },
  { min: 5, max: 6, dur: 120 },
  { min: 7, max: 8, dur: 135 },
  { min: 9, max: 20, dur: 150 },
];

export function defaultBookingRestriction(serviceId: string): Omit<ServiceBookingRestriction, 'id'> {
  return {
    service_id: serviceId,
    min_advance_minutes: 60,
    max_advance_days: 60,
    min_party_size_online: 1,
    max_party_size_online: 9,
    large_party_threshold: null,
    large_party_message: null,
    deposit_required_from_party_size: null,
    deposit_amount_per_person_gbp: null,
    deposit_type: 'charge',
    cancellation_notice_hours: 48,
  };
}
