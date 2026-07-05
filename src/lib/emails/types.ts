import type { BookingModel } from '@/types/booking-models';

export interface VenueEmailData {
  name: string;
  address?: string | null;
  phone?: string | null;
  logo_url?: string | null;
  /** Business website from venue profile; used in confirmation emails (Venue button). */
  website_url?: string | null;
  booking_page_url?: string;
  timezone?: string;
  /** Business inbox for Reply-To on guest emails; from Profile / venues.reply_to_email. */
  reply_to_email?: string | null;
}

/**
 * Where the booked service is delivered, resolved from the booking snapshot + service.
 * Replaces the venue-address "Location" block in confirmation/reminder emails for
 * client-address and online services.
 */
export interface BookingLocationEmailData {
  kind: 'business_venue' | 'client_address' | 'online';
  /** client_address: one-line address captured at booking time. */
  client_address?: string | null;
  /** online: join link (read live from the service so corrections reach reminders). */
  online_url?: string | null;
  /** online: joining instructions shown with the link. */
  online_info?: string | null;
}

/** One line in a group appointment booking (shared guest, multiple treatments). */
export interface GroupAppointmentLine {
  person_label: string;
  booking_date: string;
  booking_time: string;
  practitioner_name: string;
  /** Service name, including the chosen variant (e.g. "Cut & Blow Dry - Long hair"). */
  service_name: string;
  /** Service + variant line price for this person, e.g. "£45.00" or "Price on enquiry". */
  price_display?: string | null;
  /** Per-person add-on summary lines, pre-formatted e.g. "Olaplex treatment (+£10.00, +15 min)". */
  addon_lines?: string[];
  /** Per-person subtotal including service + variant + add-ons, e.g. "£55.00". Set only when it differs from `price_display`. */
  subtotal_display?: string | null;
}

/** Event ticket line for confirmation email price breakdown. */
export interface BookingTicketPriceLine {
  label?: string | null;
  quantity: number;
  unit_price_pence: number;
}

export interface BookingEmailData {
  id: string;
  guest_name: string;
  guest_email?: string | null;
  guest_phone?: string | null;
  booking_date: string;
  booking_time: string;
  party_size: number;
  special_requests?: string | null;
  dietary_notes?: string | null;
  deposit_amount_pence?: number | null;
  deposit_status?: string | null;
  /**
   * Card-hold bookings (card_hold deposits §10.3): the consented no-show fee in pence.
   * Set by the card-request senders / cron payloads; rendered via formatCardHoldFeePence.
   */
  card_hold_fee_pence?: number | null;
  refund_cutoff?: string | null;
  manage_booking_link?: string | null;
  /** Signed-in account portal link for "manage all bookings" / unified booking history. */
  account_bookings_link?: string | null;
  confirm_cancel_link?: string | null;
  /**
   * Effective booking model for this row (compile/render). Set for C/D/E so comms stay model-aware
   * without separate message types per model.
   */
  booking_model?: BookingModel;
  /**
   * `appointment`: Model B. Copy and detail rows use service / staff / price wording.
   * Omit or `table`: restaurant / table reservations (covers, guests).
   */
  email_variant?: 'table' | 'appointment';
  /** Model B single booking: staff member name */
  practitioner_name?: string | null;
  /** Model B: treatment / service name */
  appointment_service_name?: string | null;
  /** Model B: formatted price, e.g. "£45.00"; omit if POA */
  appointment_price_display?: string | null;
  /**
   * Total booking price in pence when known (deposit vs full comparison, payment copy).
   * Optional; enriched from DB when not set by the booking API.
   */
  booking_total_price_pence?: number | null;
  /**
   * Per-seat or per-ticket unit price (e.g. class price per person). Used with
   * `booking_price_quantity` or `party_size` to show "£X each × n" in confirmations.
   */
  booking_unit_price_pence?: number | null;
  /**
   * Quantity for unit price breakdown (e.g. class seats). Defaults to `party_size` in templates when omitted.
   */
  booking_price_quantity?: number | null;
  /** Event bookings: one entry per ticket type from `booking_ticket_lines`. */
  booking_ticket_price_lines?: BookingTicketPriceLine[];
  /** Model B group: one row per person/treatment (omit for single appointment). */
  group_appointments?: GroupAppointmentLine[];
  /**
   * Optional override for calendar end time (minutes). When omitted, defaults by booking model
   * (e.g. 90 table, 60 appointment) for the “Add to calendar” link.
   */
  calendar_duration_minutes?: number;
  /**
   * Optional add-ons stacked on the booking. Each entry is a human-readable summary
   * line, e.g. "Olaplex treatment (+£10.00, +15 min)". Renders only when non-empty.
   */
  addon_lines?: string[];
  /**
   * Compliance forms the guest must complete before the visit (auto-send / Phase 1).
   * Each is a form name + public `/p/forms/{code}` URL. Rendered as a "Forms to
   * complete" block in the confirmation. Renders only when non-empty.
   */
  compliance_forms?: Array<{ name: string; url: string }>;
  /** Sum of add-on price (pence) for the booking; used in totals/headlines. */
  addons_total_price_pence?: number | null;
  /** Sum of add-on duration (minutes); informational. */
  addons_total_duration_minutes?: number | null;
  /**
   * Service delivery location. Omitted = business venue (legacy bookings / models
   * without a service location). Set by booking-email enrichment from the booking
   * snapshot; templates use it to swap the venue address for the client's address
   * or the online joining details.
   */
  booking_location?: BookingLocationEmailData;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface RenderedSms {
  body: string;
}

export type CommMessageType =
  | 'booking_confirmation_email'
  | 'booking_confirmation_sms'
  | 'deposit_request_sms'
  | 'deposit_request_email'
  | 'deposit_confirmation_email'
  | 'reminder_56h_email'
  | 'day_of_reminder_sms'
  | 'day_of_reminder_email'
  | 'post_visit_email'
  | 'reminder_1_email'
  | 'reminder_1_sms'
  | 'reminder_2_email'
  | 'reminder_2_sms'
  | 'unified_post_visit_email'
  | 'booking_modification_email'
  | 'booking_modification_sms'
  | 'cancellation_email'
  | 'cancellation_sms';
