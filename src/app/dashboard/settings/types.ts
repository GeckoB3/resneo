import type { BookingModel } from '@/types/booking-models';
import type { VenueOpeningException } from '@/types/venue-opening-exceptions';

/** Venue shape used by the settings dashboard (matches API). */
export interface VenueSettings {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  /** Synced with email from Profile; used as Reply-To on guest emails. */
  reply_to_email?: string | null;
  /** Public https URL for the business website; shown on the booking page when set. */
  website_url: string | null;
  cover_photo_url: string | null;
  /** Square logo shown as avatar on the booking page and in emails. */
  logo_url: string | null;
  cuisine_type: string | null;
  price_band: string | null;
  no_show_grace_minutes: number;
  kitchen_email: string | null;
  communication_templates: Record<string, { subject?: string; body?: string }> | null;
  opening_hours: OpeningHoursSettings | null;
  /** Unified / appointment venues: date-range closures or amended opening hours (see venue-opening-exceptions API). */
  venue_opening_exceptions?: VenueOpeningException[] | null;
  booking_rules: BookingRulesSettings | null;
  deposit_config: DepositConfigSettings | null;
  availability_config: AvailabilityConfigSettings | null;
  stripe_connected_account_id: string | null;
  timezone: string;
  table_management_enabled?: boolean;
  combination_threshold?: number;
  pricing_tier?: string;
  /** `stripe` | `superuser_free` — how ReserveNI platform billing is satisfied. */
  billing_access_source?: string | null;
  free_access_granted_at?: string | null;
  free_access_granted_by?: string | null;
  free_access_reason?: string | null;
  plan_status?: string;
  /** Start of current Stripe billing period (ISO), for SMS tallies and metered billing alignment. */
  subscription_current_period_start?: string | null;
  /** End of current Stripe billing period (ISO), for cancel-at-period-end messaging. */
  subscription_current_period_end?: string | null;
  calendar_count?: number | null;
  booking_model?: string;
  /** Canonical active booking model set for the venue. */
  active_booking_models?: BookingModel[];
  /** Secondary bookable models (C/D/E); admin-only. */
  enabled_models?: BookingModel[];
  /** Included SMS per billing month (unified scheduling / tier). */
  sms_monthly_allowance?: number | null;
  /** SMS segments used this billing period (from sms_usage), when loaded. */
  sms_messages_sent_this_month?: number | null;
  /** Stripe subscription id when loaded (Plan tab actions). */
  stripe_subscription_id?: string | null;
  /** Venue row created_at (ISO) for promotional banners. */
  created_at?: string;
  /**
   * Multi-area table venues: `auto` = combined slot list on public + staff booking; `manual` = area tabs to view times per area.
   */
  public_booking_area_mode?: 'auto' | 'manual';
  /**
   * When true, guests must sign in to ReserveNI (magic link) before completing an online booking.
   * See `venues.require_account_login_for_bookings`.
   */
  require_account_login_for_bookings?: boolean;
}

export type OpeningHoursDaySettings =
  | { closed: true }
  | { periods: { open: string; close: string }[] };

export type OpeningHoursSettings = Record<string, OpeningHoursDaySettings>;

export interface BookingRulesSettings {
  min_party_size: number;
  max_party_size: number;
  max_advance_booking_days: number;
  min_notice_hours: number;
  cancellation_notice_hours?: number;
  allow_same_day_booking?: boolean;
}

export interface DepositConfigSettings {
  enabled: boolean;
  amount_per_person_gbp: number;
  online_requires_deposit: boolean;
  phone_requires_deposit: boolean;
  min_party_size_for_deposit?: number;
  weekend_only?: boolean;
}

export interface FixedIntervalsSettings {
  model: 'fixed_intervals';
  interval_minutes: 15 | 30;
  max_covers_by_day?: Record<string, number>;
  turn_time_enabled?: boolean;
  sitting_duration_minutes?: number;
  blocked_dates?: string[];
  blocked_slots?: { date: string; start_time?: string; end_time?: string }[];
}

export interface NamedSittingSettings {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  max_covers: number;
  max_covers_by_day?: Record<string, number>;
}

export interface NamedSittingsSettings {
  model: 'named_sittings';
  sittings: NamedSittingSettings[];
  blocked_dates?: string[];
  blocked_slots?: { date: string; start_time?: string; end_time?: string }[];
}

export type AvailabilityConfigSettings = FixedIntervalsSettings | NamedSittingsSettings;

export interface StaffMember {
  id: string;
  email: string;
  name: string | null;
  phone?: string | null;
  role: string;
  created_at: string;
  /** Unified scheduling: bookable calendars this login may manage. */
  linked_calendar_ids?: string[];
  /** First linked calendar id (compat for single-select consumers). */
  linked_practitioner_id?: string | null;
  /** Comma-separated calendar names for display. */
  linked_practitioner_name?: string | null;
}
