/**
 * Types for the five booking models and their associated entities.
 * Model A (table_reservation) types live in availability.ts / table-management.ts.
 */

// Booking model enum

export type BookingModel =
  | 'table_reservation'
  | 'practitioner_appointment'
  | 'unified_scheduling'
  | 'event_ticket'
  | 'class_session'
  | 'resource_booking';

// Terminology

export interface VenueTerminology {
  client: string;   // Guest / Client / Patient / Member / Booker
  booking: string;  // Reservation / Appointment / Booking / Session
  staff: string;    // Staff / Barber / Stylist / Instructor / Manager
  /** Dining section label (e.g. "Area", "Room", "Section") — table_reservation. */
  area?: string;
}

export const DEFAULT_TERMINOLOGY: Record<BookingModel, VenueTerminology> = {
  table_reservation:        { client: 'Guest',  booking: 'Reservation',  staff: 'Staff', area: 'Area' },
  practitioner_appointment: { client: 'Client', booking: 'Appointment',  staff: 'Staff', area: 'Area' },
  unified_scheduling:       { client: 'Client', booking: 'Appointment',  staff: 'Staff', area: 'Area' },
  event_ticket:             { client: 'Guest',  booking: 'Booking',      staff: 'Host', area: 'Area' },
  class_session:            { client: 'Member', booking: 'Booking',      staff: 'Instructor', area: 'Area' },
  resource_booking:         { client: 'Booker', booking: 'Booking',      staff: 'Manager', area: 'Area' },
};

// Working hours (shared by practitioners & resources)

export interface TimeRange {
  start: string; // "HH:mm"
  end: string;   // "HH:mm"
}

/** Day-keyed working hours: keys are lowercase day names or "0"–"6". */
export type WorkingHours = Record<string, TimeRange[]>;

/**
 * Optional per-service online availability (intersected with venue + calendar hours).
 * @see ServiceCustomScheduleV2 — supports weekly, one-off dates, and date-range patterns combined.
 */
export type ServiceCustomRule =
  | { id: string; kind: 'weekly'; windows: WorkingHours }
  | { id: string; kind: 'specific_dates'; entries: Array<{ date: string; ranges: TimeRange[] }> }
  | {
      id: string;
      kind: 'date_range_pattern';
      start_date: string;
      end_date: string;
      /** JS weekday: 0 = Sunday … 6 = Saturday */
      days_of_week: number[];
      ranges: TimeRange[];
    };

export interface ServiceCustomScheduleV2 {
  version: 2;
  rules: ServiceCustomRule[];
}

/** Stored JSON in `custom_working_hours`: legacy weekly map or versioned rule list. */
export type ServiceCustomScheduleStored = WorkingHours | ServiceCustomScheduleV2;

// Model B: Practitioner appointment

/** Stored as Postgres enum `class_payment_requirement` (shared with classes / resources). */
export type ClassPaymentRequirement = 'none' | 'deposit' | 'full_payment';

/** Salon processing gap inside service core duration (see `lib/appointments/processing-time.ts`). */
export interface ProcessingTimeBlock {
  id: string;
  start_minute: number;
  duration_minutes: number;
}

export interface Practitioner {
  id: string;
  venue_id: string;
  staff_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  working_hours: WorkingHours;
  break_times: TimeRange[];
  /**
   * When set to a non-empty object, breaks use these weekday keys ("0"–"6", or sun–sat) instead of `break_times`.
   * When null/undefined, `break_times` applies to every working day.
   */
  break_times_by_day?: WorkingHours | null;
  days_off: string[]; // recurring day names or "YYYY-MM-DD" dates
  is_active: boolean;
  sort_order: number;
  created_at: string;
  /** Public booking URL segment under /book/{venue-slug}/{slug} */
  slug?: string | null;
  /**
   * Concurrent overlapping appointments allowed (`unified_calendars.parallel_clients`).
   * Omitted or 1 = one busy occupancy interval at a time (default).
   */
  parallel_clients?: number;
}

/**
 * Full-day calendar unavailability — stored in `practitioner_leave_periods`.
 * Enum values are legacy keys: map in UI to Closed / Unavailable / Other.
 */
export type PractitionerLeaveType = 'annual' | 'sick' | 'other';

export interface PractitionerLeavePeriod {
  id: string;
  venue_id: string;
  practitioner_id: string;
  start_date: string;
  end_date: string;
  leave_type: PractitionerLeaveType;
  notes: string | null;
  created_at: string;
  /** When set with `unavailable_end_time`, blocks only this clock window on each date in the range (HH:mm). */
  unavailable_start_time?: string | null;
  unavailable_end_time?: string | null;
}

export interface AppointmentService {
  id: string;
  venue_id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  buffer_minutes: number;
  /** Turnover after service (resource / unified); included in slot occupancy in appointment engine. */
  processing_time_minutes?: number;
  /**
   * Internal gaps within `duration_minutes` where the practitioner is free for another booking.
   * When non-empty, `processing_time_minutes` is not used for practitioner conflict math.
   */
  processing_time_blocks?: ProcessingTimeBlock[];
  price_pence: number | null;
  /** How much to charge online at booking (reuses class_payment_requirement enum). */
  payment_requirement?: ClassPaymentRequirement;
  deposit_pence: number | null;
  colour: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  /** Admin: which fields individual staff may override for their own calendar. */
  staff_may_customize_name?: boolean;
  staff_may_customize_description?: boolean;
  staff_may_customize_duration?: boolean;
  staff_may_customize_buffer?: boolean;
  staff_may_customize_price?: boolean;
  staff_may_customize_deposit?: boolean;
  staff_may_customize_colour?: boolean;
  /** Guest online booking window for this service (replaces venue-level appointment rules). */
  max_advance_booking_days?: number;
  min_booking_notice_hours?: number;
  cancellation_notice_hours?: number;
  allow_same_day_booking?: boolean;
  /**
   * When true, guest bookable slots for this service are the intersection of
   * venue + calendar hours with `custom_working_hours` for each calendar day.
   */
  custom_availability_enabled?: boolean;
  /**
   * When `custom_availability_enabled`, guest slots are intersected with this schedule (weekly map,
   * or `{ version: 2, rules }` with weekly / specific dates / date-range patterns — union of rules).
   */
  custom_working_hours?: ServiceCustomScheduleStored | null;
  /**
   * Optional bookable sub-options. When non-empty (and any active), the booking flow must collect
   * a variant choice before computing slots. Variant values override the parent for duration,
   * buffer, price and (optionally) deposit; parent payment_requirement is preserved.
   */
  variants?: ServiceVariant[];
}

export interface PractitionerService {
  id: string;
  practitioner_id: string;
  service_id: string;
  custom_duration_minutes: number | null;
  custom_price_pence: number | null;
  custom_name?: string | null;
  custom_description?: string | null;
  custom_buffer_minutes?: number | null;
  custom_deposit_pence?: number | null;
  custom_colour?: string | null;
}

/**
 * Optional sub-option for an appointment-style service (hair colour: full head vs roots, etc.).
 * When a parent service has 1+ active variants, the guest must pick one before booking.
 * Variant duration / buffer / price / deposit override the parent's bookable values.
 * Parent service still owns payment_requirement and staff/calendar assignments.
 */
export interface ServiceVariant {
  id: string;
  venue_id: string;
  /** Set when the venue stores services in `service_items` (unified scheduling). */
  service_item_id: string | null;
  /** Set when the venue stores services in legacy `appointment_services`. */
  appointment_service_id: string | null;
  name: string;
  description: string | null;
  duration_minutes: number;
  buffer_minutes: number;
  processing_time_blocks?: ProcessingTimeBlock[];
  price_pence: number | null;
  /** When null and the parent uses deposit payment, fall back to the parent's deposit. */
  deposit_pence: number | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

// Model C: Event / experience ticket

export interface ExperienceEvent {
  id: string;
  venue_id: string;
  name: string;
  description: string | null;
  event_date: string; // "YYYY-MM-DD"
  start_time: string; // "HH:mm"
  end_time: string;   // "HH:mm"
  capacity: number;
  image_url: string | null;
  is_recurring: boolean;
  recurrence_rule: string | null;
  parent_event_id: string | null;
  is_active: boolean;
  created_at: string;
  max_advance_booking_days?: number;
  min_booking_notice_hours?: number;
  cancellation_notice_hours?: number;
  allow_same_day_booking?: boolean;
  payment_requirement?: 'none' | 'deposit' | 'full_payment';
  deposit_amount_pence?: number | null;
}

export interface EventTicketType {
  id: string;
  event_id: string;
  name: string;
  price_pence: number;
  capacity: number | null;
  sort_order: number;
}

// Model D: Class / group session

export interface ClassType {
  id: string;
  venue_id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  capacity: number;
  instructor_id: string | null;
  /** Guest-facing label when no FK or as display override. */
  instructor_name: string | null;
  price_pence: number | null;
  /** Replaces legacy requires_online_payment boolean. */
  payment_requirement?: ClassPaymentRequirement;
  /** Per-person deposit when payment_requirement is deposit; must be <= price_pence. */
  deposit_amount_pence?: number | null;
  /** @deprecated Use payment_requirement; kept for older API responses until fully migrated. */
  requires_online_payment?: boolean;
  colour: string;
  is_active: boolean;
  created_at: string;
  max_advance_booking_days?: number;
  min_booking_notice_hours?: number;
  cancellation_notice_hours?: number;
  allow_same_day_booking?: boolean;
}

export interface ClassTimetableEntry {
  id: string;
  class_type_id: string;
  day_of_week: number; // 0=Sun, 6=Sat
  start_time: string;  // "HH:mm"
  is_active: boolean;
  /** Repeat every N weeks (1 = weekly, 2 = bi-weekly). */
  interval_weeks?: number;
  /** weekly | custom_interval (uses interval_weeks). */
  recurrence_type?: string;
  recurrence_end_date?: string | null;
  total_occurrences?: number | null;
}

export interface ClassInstance {
  id: string;
  class_type_id: string;
  timetable_entry_id: string | null;
  instance_date: string; // "YYYY-MM-DD"
  start_time: string;    // "HH:mm"
  capacity_override: number | null;
  is_cancelled: boolean;
  cancel_reason: string | null;
  created_at: string;
}

// Model E: Resource / facility

/** Per-date override for resource opening hours (`venue_resources.availability_exceptions`). */
export type ResourceAvailabilityException = { closed: true } | { periods: Array<{ start: string; end: string }> };

export type ResourceAvailabilityExceptions = Record<string, ResourceAvailabilityException>;

export interface VenueResource {
  id: string;
  venue_id: string;
  name: string;
  resource_type: string | null;
  min_booking_minutes: number;
  max_booking_minutes: number;
  slot_interval_minutes: number;
  price_per_slot_pence: number | null;
  /** Same enum as class types; only used when this row is calendar_type = resource. */
  payment_requirement: ClassPaymentRequirement;
  /** Total deposit (pence) for one booking when payment_requirement = deposit. */
  deposit_amount_pence: number | null;
  /** Hours before start for deposit / prepayment refund (`unified_calendars`). */
  cancellation_notice_hours?: number;
  availability_hours: WorkingHours;
  /** Optional per-date closed days or replacement `periods` for that date only. */
  availability_exceptions?: ResourceAvailabilityExceptions;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  /**
   * Host unified calendar column (non-resource) where this resource is displayed.
   * When set, bookable slots must fall within both resource availability and this calendar's hours.
   */
  display_on_calendar_id?: string | null;
  /** Loaded server-side when computing availability; mirrors the host `unified_calendars` row. */
  host_calendar?: {
    id: string;
    working_hours: WorkingHours;
    days_off: string[];
    break_times: Array<{ start: string; end: string }>;
    break_times_by_day: WorkingHours | null;
  } | null;
}

// Booking ticket lines (for events and classes)

export interface BookingTicketLine {
  id: string;
  booking_id: string;
  ticket_type_id: string | null;
  label: string;
  quantity: number;
  unit_price_pence: number;
  created_at: string;
}
