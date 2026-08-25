export interface CronGuestInfo {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * Booking row shape consumed by cron comms loops. Joined `guest` is
 * normalised from the Supabase one-to-many shape into a single object.
 * `suppress_import_comms` is optional because legacy comms loops select
 * it but the venue-wide loop does not.
 */
export interface CronBookingRow {
  id: string;
  venue_id: string;
  guest_id: string;
  /** Row-level model; required for hybrid venues so cron picks the correct communications lane. */
  booking_model?: string | null;
  guest_email: string | null;
  booking_date: string;
  booking_time: string;
  party_size: number;
  special_requests: string | null;
  dietary_notes: string | null;
  deposit_amount_pence: number | null;
  deposit_status: string | null;
  cancellation_deadline: string | null;
  status: string;
  /** Ties a multi-service visit's rows together, so cron sends once per visit. */
  group_booking_id?: string | null;
  experience_event_id: string | null;
  class_instance_id: string | null;
  resource_id: string | null;
  event_session_id?: string | null;
  calendar_id?: string | null;
  service_item_id?: string | null;
  practitioner_id?: string | null;
  appointment_service_id?: string | null;
  suppress_import_comms?: boolean | null;
  guest: CronGuestInfo | null;
}
