import type { BookingModel } from '@/types/booking-models';

export type OpeningHourDay =
  | { closed: true }
  | { periods: { open: string; close: string }[] };

export type OpeningHours = Record<string, OpeningHourDay>;

export interface VenuePublic {
  id: string;
  name: string;
  slug: string;
  cover_photo_url: string | null;
  /** Square logo shown as avatar on the booking page and in emails. */
  logo_url?: string | null;
  address: string | null;
  phone: string | null;
  /** Business website; shown in booking header when set. */
  website_url?: string | null;
  deposit_config: DepositConfigPublic | null;
  booking_rules: BookingRulesPublic | null;
  opening_hours: OpeningHours | null;
  timezone: string;
  booking_model?: string;
  /** Canonical active booking model set for the venue. */
  active_booking_models?: BookingModel[];
  /** Normalised secondary models (C/D/E); from `venues.enabled_models`. */
  enabled_models?: BookingModel[];
  terminology?: { client: string; booking: string; staff: string; area?: string };
  currency?: string;
  /** Guest booking: combined slots vs pick-area-first (multi-area table venues). */
  public_booking_area_mode?: 'auto' | 'manual';
  /** Active dining areas when `booking_model` is table_reservation. */
  areas?: Array<{ id: string; name: string; colour: string; sort_order: number }>;
  /** Appointments Light: booking page paused when free period ended without payment. */
  booking_paused?: boolean;
}

export interface DepositConfigPublic {
  enabled: boolean;
  amount_per_person_gbp: number;
  online_requires_deposit?: boolean;
  min_party_size_for_deposit?: number;
  weekend_only?: boolean;
}

export interface BookingRulesPublic {
  min_party_size: number;
  max_party_size: number;
  /** Table booking: last bookable day is today + this many days (venue settings + / or booking_restrictions). */
  max_advance_booking_days?: number;
  /** Model B: hours before appointment start to cancel for deposit refund */
  cancellation_notice_hours?: number;
  allow_same_day_booking?: boolean;
}

export interface AvailableSlot {
  key: string;
  label: string;
  start_time: string;
  end_time: string;
  available_covers: number;
  sitting_id?: string;
  service_name?: string;
  service_id?: string;
  estimated_duration?: number;
  deposit_required?: boolean;
  deposit_amount?: number | null;
  /** When deposits apply for this dining service, require them for online/widget checkout. */
  online_requires_deposit?: boolean;
  /** Hours before start for deposit refund (from dining `booking_restrictions`). */
  cancellation_notice_hours?: number;
  limited?: boolean;
  available_bookings?: number;
  area_id?: string;
  area_name?: string;
  area_colour?: string;
}

export interface ServiceGroup {
  id: string;
  name: string;
  slots: AvailableSlot[];
  large_party_redirect?: boolean;
  large_party_message?: string | null;
}

export interface AvailabilityResponse {
  date: string;
  venue_id: string;
  slots: AvailableSlot[];
  services?: ServiceGroup[];
  large_party_redirect?: boolean;
  large_party_message?: string | null;
}

export interface GuestDetails {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  dietary_notes?: string;
  occasion?: string;
  /** Public booking flow: venue marketing consent from confirm step. */
  marketing_consent?: boolean;
}

export type BookingStep = 'date' | 'slot' | 'details' | 'payment' | 'confirmation';
