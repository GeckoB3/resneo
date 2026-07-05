/**
 * Availability engine types. Includes schemas for venues.availability_config and
 * opening_hours JSONB (legacy / display), service-engine types, and slot shapes
 * from computeAvailability.
 *
 * Live booking and slot APIs use the service engine only (active venue_services).
 * Legacy JSON helpers (e.g. getAvailableSlots) remain for tests and one-off tooling.
 */

/** Day of week 0=Sunday, 1=Monday, ..., 6=Saturday (matches JS Date.getDay()) */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// Legacy types (JSONB-based config on venues table)

/** One service period (open/close). */
export interface OpeningHoursPeriod {
  open: string;  // "HH:mm"
  close: string; // "HH:mm"
}

/** Legacy: single range per day. */
export interface OpeningHoursDayLegacy {
  open: string;
  close: string;
}

/** New format: closed or up to 2 periods per day. */
export type OpeningHoursDay =
  | { closed: true }
  | { periods: OpeningHoursPeriod[] };

/** Opening hours: keys "0".."6" (Sunday–Saturday). Legacy single range or new periods format. */
export type OpeningHours = Partial<Record<string, OpeningHoursDayLegacy | OpeningHoursDay>>;

/** Fixed-intervals model: interval 15 or 30 min, slots from opening hours. */
export interface FixedIntervalsConfig {
  model: 'fixed_intervals';
  interval_minutes: 15 | 30;
  max_covers_by_day?: Partial<Record<string, number>>;
  turn_time_enabled?: boolean;
  sitting_duration_minutes?: number;
}

/** One named sitting with start/end and max covers. */
export interface NamedSitting {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  max_covers: number;
  max_covers_by_day?: Partial<Record<string, number>>;
}

/** Named-sittings model: venue defines sittings; guests book into a sitting. */
export interface NamedSittingsConfig {
  model: 'named_sittings';
  sittings: NamedSitting[];
}

/** Blocked slot: specific date and optional time range. */
export interface BlockedSlot {
  date: string;
  start_time?: string;
  end_time?: string;
}

export type AvailabilityConfig =
  | (FixedIntervalsConfig & { blocked_dates?: string[]; blocked_slots?: BlockedSlot[] })
  | (NamedSittingsConfig & { blocked_dates?: string[]; blocked_slots?: BlockedSlot[] });

/** Venue shape needed by the LEGACY availability engine (subset of DB row). */
export interface VenueForAvailability {
  id: string;
  opening_hours: OpeningHours | null;
  availability_config: AvailabilityConfig | null;
  timezone: string;
}

/** Booking shape needed for capacity (subset of DB row). */
export interface BookingForAvailability {
  id: string;
  booking_date: string;
  booking_time: string;
  party_size: number;
  status: string;
}

/** One available slot or sitting returned to the client. */
export interface AvailableSlot {
  key: string;
  label: string;
  start_time: string;
  end_time: string;
  available_covers: number;
  sitting_id?: string;
}

// Service-based types (new tables)

/** Row from venue_services table. */
export interface VenueService {
  id: string;
  venue_id: string;
  name: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  last_booking_time: string;
  is_active: boolean;
  sort_order: number;
}

/** Row from service_capacity_rules table. */
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

/** Row from party_size_durations table. */
export interface PartySizeDuration {
  id: string;
  service_id: string;
  min_party_size: number;
  max_party_size: number;
  duration_minutes: number;
  day_of_week: number | null;
}

/** Row from booking_restrictions table. */
export interface BookingRestriction {
  id: string;
  service_id: string;
  min_advance_minutes: number;
  max_advance_days: number;
  min_party_size_online: number;
  max_party_size_online: number;
  large_party_threshold: number | null;
  large_party_message: string | null;
  deposit_required_from_party_size: number | null;
  /** Per-person deposit for this dining service; null falls back to legacy venue deposit_config amount. */
  deposit_amount_per_person_gbp: number | null;
  /**
   * Kind of protection for this service: 'charge' takes a deposit payment, 'card_hold'
   * saves the card for a possible no-show fee. Missing/null (no row loaded, or synthetic
   * defaults) falls back to legacy `deposit_config.type`, then 'charge'.
   */
  deposit_type?: 'charge' | 'card_hold' | null;
  /** When deposits apply, gate online/widget bookings (staff phone flow uses the Require deposit toggle only). */
  online_requires_deposit: boolean;
  /** Hours before start for deposit refund for this dining service. */
  cancellation_notice_hours?: number;
}

/** Optional JSON on availability_blocks (reduced_capacity); merged when several blocks apply. */
export interface BlockYieldOverridesPayload {
  max_bookings_per_slot?: number;
  slot_interval_minutes?: number;
  buffer_minutes?: number;
  duration_minutes?: number;
}

/** Row from availability_blocks table. */
export interface AvailabilityBlock {
  id: string;
  venue_id: string;
  service_id: string | null;
  block_type: 'closed' | 'reduced_capacity' | 'special_event' | 'amended_hours';
  date_start: string;
  date_end: string;
  time_start: string | null;
  time_end: string | null;
  override_max_covers: number | null;
  reason: string | null;
  yield_overrides?: BlockYieldOverridesPayload | null;
  override_periods?: Array<{ open: string; close: string }> | null;
}

/** Date-scoped overrides merged onto booking_restrictions for matching slots/days. */
export interface BookingRestrictionException {
  id: string;
  venue_id: string;
  service_id: string | null;
  date_start: string;
  date_end: string;
  time_start: string | null;
  time_end: string | null;
  min_advance_minutes: number | null;
  max_advance_days: number | null;
  min_party_size_online: number | null;
  max_party_size_online: number | null;
  large_party_threshold: number | null;
  large_party_message: string | null;
  deposit_required_from_party_size: number | null;
  reason: string | null;
}

/** Date-scoped service window: closed, extra open day, or custom times. */
export interface ServiceScheduleException {
  id: string;
  venue_id: string;
  service_id: string;
  date_start: string;
  date_end: string;
  is_closed: boolean;
  opens_extra_day: boolean;
  start_time: string | null;
  end_time: string | null;
  last_booking_time: string | null;
  reason: string | null;
}

/** Extended booking shape with service_id and estimated_end_time. */
export interface BookingForEngine {
  id: string;
  booking_date: string;
  booking_time: string;
  party_size: number;
  status: string;
  service_id: string | null;
  estimated_end_time: string | null;
}

/** Enhanced available slot returned by the new service-based engine. */
export interface ServiceAvailableSlot {
  key: string;
  label: string;
  start_time: string;
  end_time: string;
  service_name: string;
  service_id: string;
  available_covers: number;
  available_bookings: number;
  estimated_duration: number;
  deposit_required: boolean;
  /** Total deposit in GBP for this slot and party size (per-person × party_size). */
  deposit_amount: number | null;
  /**
   * Kind of protection configured for this service: 'charge' (take a deposit payment)
   * or 'card_hold' (save the card, charge a no-show fee on no-show). ALWAYS populated,
   * even when the party-size threshold is not met and `deposit_required` is false, so
   * staff surfaces can see the configured protection unconditionally (the engine is
   * audience-blind; the threshold-gated `deposit_required`/`deposit_amount` pair stays
   * the sole online gate). Flag-off or zero-fee card-hold config resolves to 'charge'
   * with `configured_deposit_per_person_gbp: null` (treated as no protection).
   */
  deposit_type: 'charge' | 'card_hold';
  /**
   * Configured per-person amount in GBP (deposit or no-show fee, per `deposit_type`),
   * ALWAYS populated when a positive amount is configured, regardless of the party-size
   * threshold. Null when nothing (or a non-positive amount) is configured.
   */
  configured_deposit_per_person_gbp: number | null;
  /** When deposits apply, whether online/widget bookings should require payment (public flow). */
  online_requires_deposit: boolean;
  /** From `booking_restrictions` for this service (merged with exceptions). */
  cancellation_notice_hours?: number;
  limited: boolean;
  /** Set when availability is computed per dining area (multi-area restaurants). */
  area_id?: string;
  area_name?: string;
  area_colour?: string;
}

/** All data the engine needs to compute availability for a single date, pre-fetched. */
export interface EngineInput {
  venue_id: string;
  date: string;
  party_size: number;
  services: VenueService[];
  capacity_rules: ServiceCapacityRule[];
  durations: PartySizeDuration[];
  restrictions: BookingRestriction[];
  blocks: AvailabilityBlock[];
  bookings: BookingForEngine[];
  /** Date-overlapping rows; engine picks best match per service/date. */
  schedule_exceptions: ServiceScheduleException[];
  restriction_exceptions: BookingRestrictionException[];
  /**
   * When `booking_restrictions.deposit_amount_per_person_gbp` is null, use this legacy
   * venue-level amount (from `venues.deposit_config`) so migrated venues stay stable.
   */
  deposit_legacy_amount_per_person_gbp: number | null;
  /**
   * Legacy `deposit_config.type` fallback used when the restriction row does not supply
   * `deposit_type` (rule: restriction.deposit_type ?? deposit_config.type ?? 'charge').
   */
  deposit_legacy_type?: 'charge' | 'card_hold' | null;
  /**
   * Resolved `card_hold_deposits` venue flag. When off (or omitted), card-hold config
   * resolves as no deposit (`deposit_required: false`) with a console.warn.
   */
  card_hold_deposits_enabled?: boolean;
  now: Date;
}

/** Result of engine computation for a single service. */
export interface EngineServiceResult {
  service: VenueService;
  slots: ServiceAvailableSlot[];
  restriction: BookingRestriction | null;
  large_party_redirect: boolean;
  large_party_message: string | null;
}
